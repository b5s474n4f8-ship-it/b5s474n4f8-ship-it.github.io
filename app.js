(() => {
  "use strict";

  const STORAGE_KEY = "guiliu_video_state_v2";
  const SESSION_KEY = "guiliu_session_v2";
  const CONFIG = window.GUILIU_CONFIG || {};
  const THRESHOLDS = { continuous: 20 * 60, dailyReview: 45 * 60, dailyStop: 75 * 60 };
  const REASONS = ["低价值", "太长", "情绪消耗", "不喜欢主题", "不喜欢频道", "标题党", "重复内容"];
  const SOURCE = { subscription: "订阅", platform_recommendation: "平台推荐", channel: "频道", manual: "手动" };
  const PLATFORM = { youtube: "YouTube", bilibili: "B站", unknown: "视频" };
  const app = document.getElementById("app");

  let state = loadState();
  let session = loadSession();
  let ui = { tab: "all", selected: "", query: "", modal: null, toast: "", sync: "本地模式", token: "" };
  let runtime = { lastActive: Date.now(), lastTick: Date.now(), continuous: 0, saveTick: 0, toastTimer: 0, syncTimer: 0 };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").then((registration) => registration.update()).catch(() => {});
    bind();
    handleRecoveryHash();

    render();
    setInterval(tick, 1000);
    queueSync();
  }

  function bind() {
    app.addEventListener("click", onClick);
    app.addEventListener("submit", onSubmit);
    app.addEventListener("input", onInput);
    app.addEventListener("change", onChange);
    ["pointerdown", "keydown", "touchstart", "scroll"].forEach((name) => window.addEventListener(name, () => runtime.lastActive = Date.now(), { passive: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { runtime.continuous = 0; saveState(); }
      else { runtime.lastActive = Date.now(); runtime.lastTick = Date.now(); }
    });
    window.addEventListener("pagehide", saveState);
  }

  function onClick(event) {
    const el = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id || "";
    if (action === "tab") { ui.tab = el.dataset.tab || "all"; ui.selected = ""; render(); return; }
    if (action === "play") { ui.selected = id; render(); scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (action === "close-player") { ui.selected = ""; render(); return; }
    if (action === "feedback") { feedback(id, el.dataset.value || "later"); return; }
    if (action === "reason") { toggleReason(el.dataset.reason || ""); return; }
    if (action === "save-negative") { saveNegative(); return; }
    if (action === "cancel-modal") { ui.modal = null; render(); return; }
    if (action === "sync") { syncNow("manual"); return; }
    if (action === "token") { createToken(); return; }
    if (action === "logout") { logout(); return; }
    if (action === "recover") {
      const emailInput = document.querySelector('[data-form="login"] [name="email"]');
      if (!(emailInput instanceof HTMLInputElement) || !emailInput.value.trim()) { emailInput?.focus(); emailInput?.reportValidity(); return; }
      sendRecovery(clean(emailInput.value)); return;
    }
    if (action === "copy-token") { copyText(ui.token || state.settings.lastToken || ""); return; }
    if (action === "export") { exportData(); return; }
    if (action === "import") { document.querySelector("[data-import-file]")?.click(); return; }
    if (action === "rest") { state.settings.pauseUntil = Date.now() + 5 * 60 * 1000; runtime.continuous = 0; ui.modal = null; persist("已暂停 5 分钟"); return; }
    if (action === "reflect") { if (ui.modal) ui.modal.reflect = true; render(); return; }
    if (action === "continue") { state.settings.snoozeUntil = Date.now() + 10 * 60 * 1000; runtime.continuous = 0; ui.modal = null; persist("已延后 10 分钟"); }
  }

  function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === "settings") {
      state.settings.supabaseUrl = clean(data.get("supabaseUrl"));
      state.settings.supabaseAnonKey = clean(data.get("supabaseAnonKey"));
      persist("设置已保存"); return;
    }
    if (form.dataset.form === "login") {
      const mode = event.submitter?.dataset.authMode === "signup" ? "signup" : "login";
      authenticate(clean(data.get("email")), String(data.get("password") || ""), mode);
      return;
    }
    if (form.dataset.form === "password") { updatePassword(String(data.get("password") || "")); return; }
    if (form.dataset.form === "manual") {
      const url = normalizeUrl(data.get("url"));
      if (!url) { toast("链接不完整"); return; }
      mergeCards([normalizeCard({ url, title: clean(data.get("title")) || url, channelName: clean(data.get("channel")) || "手动加入", sourceType: "manual" })]);
      form.reset(); persist("已加入候选池"); return;
    }
    if (form.dataset.form === "reflection") {
      const text = clean(data.get("reflection"));
      if (text) dayRecord(today()).reflections.unshift({ id: id("reflection"), text, createdAt: now() });
      ui.modal = null; runtime.continuous = 0; state.settings.snoozeUntil = Date.now() + 10 * 60 * 1000; persist(text ? "复盘已保存" : "已关闭提醒");
    }
  }

  function onInput(event) {
    if (event.target instanceof HTMLInputElement && event.target.dataset.search !== undefined) {
      ui.query = event.target.value;
      const grid = document.querySelector("[data-grid]");
      if (grid) grid.innerHTML = feedHtml();
    }
  }

  function onChange(event) {
    if (event.target instanceof HTMLInputElement && event.target.dataset.importFile !== undefined) importData(event.target.files?.[0]);
  }

  function loadState() {
    const base = {
      version: 2,
      deviceId: id("device"),
      candidates: seed(),
      feedback: {},
      profile: { likeChannels: {}, skipChannels: {}, likeTerms: {}, skipTerms: {}, skipReasons: {} },
      stats: {},
      settings: { supabaseUrl: CONFIG.supabaseUrl || "", supabaseAnonKey: CONFIG.supabaseAnonKey || "", lastToken: "", pauseUntil: 0, snoozeUntil: 0, thresholds: THRESHOLDS },
      updatedAt: now(),
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return base;
      saved.candidates = Array.isArray(saved.candidates) ? saved.candidates.map(normalizeCard).filter(Boolean) : base.candidates;
      saved.feedback = saved.feedback || {};
      saved.profile = { ...base.profile, ...(saved.profile || {}) };
      saved.settings = { ...base.settings, ...(saved.settings || {}), thresholds: { ...THRESHOLDS, ...(saved.settings?.thresholds || {}) } };
      saved.stats = saved.stats || {};
      return { ...base, ...saved, version: 2 };
    } catch { return base; }
  }

  function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
  function saveSession() { session ? localStorage.setItem(SESSION_KEY, JSON.stringify(session)) : localStorage.removeItem(SESSION_KEY); }
  function saveState(options = {}) { state.updatedAt = now(); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); if (options.sync !== false) queueSync(); }
  function persist(message) { saveState(); toast(message); render(); }
  function toast(message) { ui.toast = message || ""; clearTimeout(runtime.toastTimer); if (message) runtime.toastTimer = setTimeout(() => { ui.toast = ""; render(); }, 2600); }

  function render() {
    const selected = state.candidates.find((card) => card.id === ui.selected);
    const totals = totalsFor(today());
    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand"><img src="./icon.svg" alt="" /><div><h1>归流</h1><p>你的 B站 / YouTube 视频主页</p></div></div>
          <div class="top-tools"><label class="search"><span>搜索</span><input data-search value="${esc(ui.query)}" placeholder="标题 / 频道" /></label><button class="icon-button" data-action="sync">↻</button><div class="time-pill"><span>今日</span><strong data-live-total>${fmtTime(totals.total)}</strong></div></div>
        </header>
        <nav class="tabs">${tab("all", "全部")}${tab("subscription", "订阅")}${tab("platform_recommendation", "平台推荐")}${tab("later", "稍后看")}${tab("hidden", "已隐藏")}</nav>
        ${selected ? playerHtml(selected) : ""}
        <main class="layout"><section class="feed"><div class="feed-head"><div><h2>${esc(titleForTab())}</h2><p>${esc(subtitleForTab())}</p></div><button class="text-button" data-action="import">导入备份</button><input class="sr-only" data-import-file type="file" accept="application/json" /></div><div class="video-grid" data-grid>${feedHtml()}</div></section><aside class="side">${setupHtml()}${profileHtml()}${manualHtml()}</aside></main>
      </div>${modalHtml()}${ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : ""}`;
  }

  function tab(key, label) { return `<button class="tab ${ui.tab === key ? "is-active" : ""}" data-action="tab" data-tab="${key}">${label}<span>${countTab(key)}</span></button>`; }
  function feedHtml() { const cards = currentFeed(); return cards.length ? cards.map(cardHtml).join("") : `<div class="empty-feed"><h2>把平台上的视频带进归流</h2><p>在电脑 Chrome/Edge 安装插件，打开 YouTube 或 B站首页/订阅页，点击“采集当前页面”。手机端刷新后就会看到真实视频流。</p></div>`; }
  function cardHtml(card) {
    const fb = state.feedback[card.id] || {};
    return `<article class="video-card ${fb.type === "not_interested" ? "is-hidden-card" : ""}"><button class="thumb" data-action="play" data-id="${esc(card.id)}">${card.thumbnailUrl ? `<img src="${esc(card.thumbnailUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<div class="thumb-fallback">${esc((card.channelName || "视").slice(0, 2))}</div>`}${card.durationText ? `<span class="duration">${esc(card.durationText)}</span>` : ""}<span class="play">▶</span></button><div class="video-body"><div class="source"><span>${esc(PLATFORM[card.platform] || card.platform)}</span><span>${esc(SOURCE[card.sourceType] || card.sourceType)}</span></div><h3>${esc(card.title)}</h3><p class="channel">${esc(card.channelName)}</p><p class="meta">${esc([card.viewCountText, card.publishedText].filter(Boolean).join(" · ") || "刚采集")}</p><p class="why">${esc(reason(card))}</p><div class="card-actions"><button class="choice like ${fb.type === "interested" ? "is-on" : ""}" data-action="feedback" data-value="interested" data-id="${esc(card.id)}">感兴趣</button><button class="choice skip ${fb.type === "not_interested" ? "is-on" : ""}" data-action="feedback" data-value="not_interested" data-id="${esc(card.id)}">不感兴趣</button><button class="choice later ${fb.type === "later" ? "is-on" : ""}" data-action="feedback" data-value="later" data-id="${esc(card.id)}">稍后看</button></div></div></article>`;
  }

  function playerHtml(card) {
    return `<section class="watch"><div class="watch-frame">${card.embedUrl ? `<iframe src="${esc(card.embedUrl)}" title="${esc(card.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>` : `<div class="fallback"><p>这个视频暂时不能内嵌播放。</p><a class="button primary" href="${esc(card.url)}" target="_blank" rel="noreferrer">打开原链接</a></div>`}</div><div class="watch-info"><div><p class="eyebrow">${esc(PLATFORM[card.platform] || card.platform)} · ${esc(SOURCE[card.sourceType] || card.sourceType)}</p><h2>${esc(card.title)}</h2><p>${esc(card.channelName)}${card.publishedText ? " · " + esc(card.publishedText) : ""}</p></div><div class="watch-actions"><a class="button" href="${esc(card.url)}" target="_blank" rel="noreferrer">原链接</a><button class="button" data-action="close-player">收起</button></div></div></section>`;
  }

  function setupHtml() {
    const ready = config().ready;
    const signed = Boolean(session?.accessToken);
    const account = signed
      ? `<div class="account-row"><div><span>当前账号</span><strong>${esc(session.user?.email || "已登录")}</strong></div><button class="button" data-action="logout">退出</button></div><form class="form inline" data-form="password"><input name="password" placeholder="设置或修改密码" type="password" autocomplete="new-password" minlength="6" required /><button class="button" type="submit">保存密码</button></form>`
      : `<form class="form auth-form" data-form="login"><input name="email" placeholder="邮箱" type="email" autocomplete="email" required /><input name="password" placeholder="密码（至少 6 位）" type="password" autocomplete="current-password" minlength="6" required /><div class="auth-actions"><button class="button primary" data-auth-mode="login" type="submit">登录</button><button class="button" data-auth-mode="signup" type="submit">注册账号</button></div><button class="text-button recovery-link" data-action="recover" type="button">发送密码重置邮件</button></form>`;
    return `<section class="panel setup"><div class="panel-title"><h2>采集与同步</h2><span>${esc(ui.sync || (signed ? "已登录" : ready ? "待登录" : "本地模式"))}</span></div><p class="muted">插件只采集当前页面上可见的视频卡片，不读取 cookie、私信、评论或账号资料。</p><form class="form" data-form="settings"><input name="supabaseUrl" value="${esc(state.settings.supabaseUrl)}" placeholder="Supabase URL" /><input name="supabaseAnonKey" value="${esc(state.settings.supabaseAnonKey)}" placeholder="Supabase anon / publishable key" type="password" /><button class="button" type="submit">保存</button></form>${account}<div class="token-box"><button class="button" data-action="token">生成插件采集码</button>${(ui.token || state.settings.lastToken) ? `<code>${esc(ui.token || state.settings.lastToken)}</code><button class="button" data-action="copy-token">复制</button>` : ""}</div><div class="button-row"><button class="text-button" data-action="sync">立即同步</button><button class="text-button" data-action="export">导出备份</button></div></section>`;
  }

  function profileHtml() {
    const terms = top(state.profile.likeTerms, 8).map(([name]) => name);
    const likes = top(state.profile.likeChannels, 4).map(([name]) => name);
    const skips = top(state.profile.skipChannels, 4).map(([name]) => name);
    return `<section class="panel"><div class="panel-title"><h2>我的取向</h2><span>${Object.keys(state.feedback).length} 次选择</span></div><div class="stats"><div><span>候选</span><strong>${state.candidates.length}</strong></div><div><span>喜欢</span><strong>${countFeedback("interested")}</strong></div><div><span>隐藏</span><strong>${countFeedback("not_interested")}</strong></div></div><div class="tag-cloud">${terms.length ? terms.map((t) => `<span>${esc(t)}</span>`).join("") : "<span>选择后生成主题</span>"}</div><p class="mini-title">常看频道</p><p class="muted">${esc(likes.join("、") || "还在学习")}</p><p class="mini-title">降低权重</p><p class="muted">${esc(skips.join("、") || "暂无")}</p></section>`;
  }

  function manualHtml() {
    return `<section class="panel"><div class="panel-title"><h2>临时补充</h2><span>兜底</span></div><form class="form" data-form="manual"><input name="url" placeholder="视频链接" type="url" required /><input name="title" placeholder="标题" /><input name="channel" placeholder="频道 / UP 主" /><button class="button" type="submit">加入候选池</button></form></section>`;
  }

  function modalHtml() {
    if (!ui.modal) return "";
    if (ui.modal.type === "negative") {
      return `<div class="modal-backdrop"><section class="modal"><h2>为什么不感兴趣？</h2><p>这会帮助归流减少相似视频，而不是只隐藏这一条。</p><div class="reason-grid">${REASONS.map((r) => `<button class="reason-chip ${ui.modal.reasons.includes(r) ? "is-on" : ""}" data-action="reason" data-reason="${esc(r)}">${esc(r)}</button>`).join("")}</div><div class="button-row right"><button class="button" data-action="cancel-modal">取消</button><button class="button primary" data-action="save-negative">隐藏并学习</button></div></section></div>`;
    }
    const copy = ui.modal.type === "dailyStop" ? ["今天已经够了", "这一轮可以收束，留下余味比继续刷更有价值。"] : ui.modal.type === "dailyReview" ? ["做一次小复盘", "今天在归流里的时间已经不少，可以写一句判断：这些视频对你有益吗？"] : ["暂停一下", "连续观看已经到 20 分钟。站起来、喝水，或者确认下一条是否值得看。"];
    return `<div class="modal-backdrop"><section class="modal"><h2>${copy[0]}</h2><p>${copy[1]}</p>${ui.modal.reflect ? `<form class="form" data-form="reflection"><textarea name="reflection" placeholder="一句复盘"></textarea><button class="button primary" type="submit">保存</button></form>` : `<div class="button-row"><button class="button primary" data-action="rest">休息一下</button><button class="button" data-action="reflect">写一句复盘</button><button class="button" data-action="continue">继续 10 分钟</button></div>`}</section></div>`;
  }

  function currentFeed() {
    let cards = state.candidates.filter(Boolean);
    const q = ui.query.trim().toLowerCase();
    if (q) cards = cards.filter((c) => `${c.title} ${c.channelName} ${c.platform} ${SOURCE[c.sourceType] || ""}`.toLowerCase().includes(q));
    if (ui.tab === "subscription") cards = cards.filter((c) => c.sourceType === "subscription" || c.sources.includes("subscription"));
    if (ui.tab === "platform_recommendation") cards = cards.filter((c) => c.sourceType === "platform_recommendation" || c.sources.includes("platform_recommendation"));
    if (ui.tab === "later") cards = cards.filter((c) => state.feedback[c.id]?.type === "later");
    if (ui.tab === "hidden") cards = cards.filter((c) => state.feedback[c.id]?.type === "not_interested");
    if (ui.tab !== "hidden") cards = cards.filter((c) => state.feedback[c.id]?.type !== "not_interested");
    cards = cards.map((card) => ({ card, score: score(card) })).sort((a, b) => b.score - a.score).map((x) => x.card);
    return ui.tab === "all" ? balance(cards) : cards;
  }

  function balance(cards) {
    const sub = cards.filter((c) => c.sourceType === "subscription" || c.sources.includes("subscription"));
    const rec = cards.filter((c) => c.sourceType === "platform_recommendation" || c.sources.includes("platform_recommendation"));
    const other = cards.filter((c) => !sub.includes(c) && !rec.includes(c));
    const out = [], seen = new Set();
    for (let i = 0; i < Math.max(sub.length, rec.length); i++) [sub[i], rec[i]].forEach((c) => { if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } });
    other.forEach((c) => { if (!seen.has(c.id)) out.push(c); });
    return out;
  }

  function score(card) {
    const fb = state.feedback[card.id];
    if (fb?.type === "not_interested") return -9999;
    let s = fresh(card.capturedAt) + (card.sourceType === "subscription" ? 2 : 1.5);
    if (fb?.type === "interested") s += 18;
    if (fb?.type === "later") s += 8;
    const channel = card.channelKey || card.channelName;
    s += Number(state.profile.likeChannels[channel] || 0) * 6;
    s -= Number(state.profile.skipChannels[channel] || 0) * 8;
    terms(card.title).forEach((t) => { s += Number(state.profile.likeTerms[t] || 0) * 2; s -= Number(state.profile.skipTerms[t] || 0) * 3; });
    return s;
  }

  function reason(card) {
    const fb = state.feedback[card.id];
    if (fb?.type === "interested") return "你标记过感兴趣，相似主题会提高权重。";
    if (fb?.type === "later") return "已放入稍后看。";
    const channel = card.channelKey || card.channelName;
    if (state.profile.likeChannels[channel]) return `来自你常给正反馈的频道：${card.channelName}`;
    const hit = terms(card.title).find((t) => state.profile.likeTerms[t]);
    if (hit) return `命中你最近感兴趣的主题：${hit}`;
    return card.sourceType === "subscription" ? "来自你的订阅池。" : "来自平台推荐池，等待你的判断。";
  }

  function feedback(idValue, type) {
    const card = state.candidates.find((c) => c.id === idValue);
    if (!card) return;
    if (type === "not_interested") { ui.modal = { type: "negative", id: idValue, reasons: [] }; render(); return; }
    applyFeedback(card, type, []);
    persist(type === "interested" ? "已记住：感兴趣" : "已放入稍后看");
  }

  function toggleReason(reasonValue) {
    if (!ui.modal || ui.modal.type !== "negative") return;
    ui.modal.reasons = ui.modal.reasons.includes(reasonValue) ? ui.modal.reasons.filter((r) => r !== reasonValue) : [...ui.modal.reasons, reasonValue];
    render();
  }

  function saveNegative() {
    const card = state.candidates.find((c) => c.id === ui.modal?.id);
    if (!card) return;
    applyFeedback(card, "not_interested", ui.modal.reasons);
    if (ui.selected === card.id) ui.selected = "";
    ui.modal = null;
    persist("已隐藏，并调整相似内容权重");
  }

  function applyFeedback(card, type, reasons) {
    state.feedback[card.id] = { type, reasons, updatedAt: now() };
    const channel = card.channelKey || card.channelName;
    const names = terms(card.title);
    if (type === "interested") { addWeight(state.profile.likeChannels, channel, 1); names.forEach((t) => addWeight(state.profile.likeTerms, t, 1)); }
    if (type === "not_interested") { addWeight(state.profile.skipChannels, channel, reasons.includes("不喜欢频道") ? 2 : 0.35); names.forEach((t) => addWeight(state.profile.skipTerms, t, 1)); reasons.forEach((r) => addWeight(state.profile.skipReasons, r, 1)); }
    pushFeedback(card, type, reasons);
  }

  function mergeCards(cards) {
    const map = new Map(state.candidates.map((c) => [key(c), c]));
    cards.map(normalizeCard).filter(Boolean).forEach((card) => {
      const old = map.get(key(card));
      if (!old) { map.set(key(card), card); return; }
      old.sources = uniq([...old.sources, ...card.sources, card.sourceType]);
      if (old.sourceType !== "subscription" && card.sourceType === "subscription") old.sourceType = "subscription";
      Object.assign(old, Object.fromEntries(Object.entries(card).filter(([, v]) => v !== "" && v != null)), { id: old.id, sources: old.sources, updatedAt: now() });
    });
    state.candidates = [...map.values()].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  }

  function handleRecoveryHash() {
    if (!location.hash) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.get("type") !== "recovery") return;
    if (hash.get("error")) {
      toast("密码恢复链接无效或已过期");
      history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    if (hash.get("access_token") && hash.get("refresh_token")) {
      session = {
        accessToken: hash.get("access_token"),
        refreshToken: hash.get("refresh_token"),
        expiresAt: Number(hash.get("expires_at") || 0),
        user: null,
        savedAt: now(),
      };
      saveSession();
      ui.sync = "请设置新密码";
      toast("身份已验证，请在右侧保存新密码");
    }
    history.replaceState(null, "", location.pathname + location.search);
  }

  function config() {
    const supabaseUrl = (state.settings.supabaseUrl || CONFIG.supabaseUrl || "").replace(/\/(rest\/v1)?\/?$/, "");
    const supabaseAnonKey = state.settings.supabaseAnonKey || CONFIG.supabaseAnonKey || "";
    return { supabaseUrl, supabaseAnonKey, ready: Boolean(supabaseUrl && supabaseAnonKey) };
  }

  function queueSync() { if (config().ready && session?.accessToken) { clearTimeout(runtime.syncTimer); runtime.syncTimer = setTimeout(() => syncNow("auto"), 1800); } }

  async function sendRecovery(email) {
    const cfg = config();
    if (!email) return toast("请先输入邮箱");
    if (!cfg.ready) return toast("先保存 Supabase 设置");
    try {
      const redirect = encodeURIComponent(location.href.split("#")[0]);
      const res = await fetch(`${cfg.supabaseUrl}/auth/v1/recover?redirect_to=${redirect}`, {
        method: "POST",
        headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(authError(data));
      ui.sync = "恢复邮件已发送";
      toast("请打开邮件中的重置链接");
    } catch (error) {
      ui.sync = "恢复邮件发送失败";
      toast(error instanceof Error ? error.message : "恢复邮件发送失败");
    }
    render();
  }

  async function authenticate(email, password, mode) {
    const cfg = config();
    if (!email) return toast("请输入邮箱");
    if (password.length < 6) return toast("密码至少需要 6 位");
    if (!cfg.ready) return toast("先保存 Supabase 设置");
    ui.sync = mode === "signup" ? "注册中" : "登录中";
    render();
    try {
      const endpoint = mode === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
      const res = await fetch(`${cfg.supabaseUrl}${endpoint}`, {
        method: "POST",
        headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(authError(data));
      if (!data.access_token || !data.refresh_token) {
        ui.sync = "待确认";
        toast("账号已创建，但 Supabase 仍要求邮箱确认，请关闭 Confirm email");
        render();
        return;
      }
      session = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
        savedAt: now(),
      };
      saveSession();
      toast(mode === "signup" ? "注册成功，正在同步" : "登录成功，正在同步");
      await syncNow("login");
      return;
    } catch (error) {
      ui.sync = "登录失败";
      toast(error instanceof Error ? error.message : "登录失败，请稍后重试");
    }
    render();
  }

  function authError(data) {
    const message = String(data?.msg || data?.message || data?.error_description || data?.error || "").toLowerCase();
    if (message.includes("invalid login credentials")) return "邮箱或密码不正确";
    if (message.includes("email not confirmed")) return "该账号仍需邮箱确认，请在 Supabase 关闭 Confirm email";
    if (message.includes("already registered") || message.includes("already been registered")) return "这个邮箱已经注册，请直接登录";
    if (message.includes("password")) return "密码不符合 Supabase 的安全要求";
    if (message.includes("rate limit")) return "操作太频繁，请稍后再试";
    return "认证失败，请检查邮箱、密码和 Supabase 设置";
  }

  async function updatePassword(password) {
    const cfg = config();
    if (password.length < 6) return toast("密码至少需要 6 位");
    if (!cfg.ready || !session?.accessToken) return toast("请先登录");
    try {
      await ensureSession(cfg);
      const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { method: "PUT", headers: { ...auth(cfg), "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(authError(data));
      toast("密码已保存，下次可直接登录");
    } catch (error) { toast(error instanceof Error ? error.message : "密码保存失败"); }
    render();
  }

  async function logout() {
    const cfg = config();
    const accessToken = session?.accessToken;
    session = null;
    saveSession();
    ui.sync = cfg.ready ? "未登录" : "本地模式";
    toast("已退出登录");
    render();
    if (!cfg.ready || !accessToken) return;
    await fetch(`${cfg.supabaseUrl}/auth/v1/logout`, { method: "POST", headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${accessToken}` } }).catch(() => {});
  }

  async function syncNow(mode = "manual") {
    const cfg = config();
    if (!cfg.ready) { ui.sync = "本地模式"; if (mode === "manual") toast("先配置 Supabase"); render(); return; }
    if (!session?.accessToken) { ui.sync = "未登录"; if (mode === "manual") toast("请先使用邮箱和密码登录"); render(); return; }
    ui.sync = "同步中"; render();
    try {
      await ensureSession(cfg); await fetchUser(cfg); await pullFeed(cfg); await pushAllFeedback(cfg);
      ui.sync = "已同步"; saveState({ sync: false });
    } catch { ui.sync = "同步失败"; if (mode === "manual") toast("同步失败，请检查新版 SQL 是否执行"); }
    render();
  }

  async function ensureSession(cfg) {
    if (!session?.refreshToken) throw new Error("no session");
    if (session.expiresAt && Date.now() < Number(session.expiresAt) * 1000 - 60000) return;
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: session.refreshToken }) });
    const data = await res.json(); if (!res.ok) throw new Error("refresh failed");
    session.accessToken = data.access_token; session.refreshToken = data.refresh_token || session.refreshToken; session.expiresAt = data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600); saveSession();
  }

  async function fetchUser(cfg) {
    if (session?.user?.id) return session.user;
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { headers: auth(cfg) });
    const data = await res.json(); if (!res.ok) throw new Error("user failed");
    session.user = { id: data.id, email: data.email }; saveSession(); return session.user;
  }

  async function pullFeed(cfg) {
    const [cardsRes, feedbackRes] = await Promise.all([
      fetch(`${cfg.supabaseUrl}/rest/v1/guiliu_feed_candidates?select=*&order=captured_at.desc&limit=600`, { headers: auth(cfg) }),
      fetch(`${cfg.supabaseUrl}/rest/v1/guiliu_feedback?select=*`, { headers: auth(cfg) }),
    ]);
    if (!cardsRes.ok || !feedbackRes.ok) throw new Error("pull failed");
    const cards = await cardsRes.json(); const feedbackRows = await feedbackRes.json();
    mergeCards(cards.map(remoteCard));
    feedbackRows.forEach((row) => {
      const card = state.candidates.find((c) => c.id === row.candidate_id || c.videoKey === row.video_key);
      if (card) state.feedback[card.id] = { type: row.feedback_type, reasons: row.reasons || [], updatedAt: row.updated_at };
    });
  }

  async function pushAllFeedback(cfg) {
    const rows = Object.entries(state.feedback).map(([cardId, fb]) => {
      const card = state.candidates.find((c) => c.id === cardId); if (!card) return null;
      return { user_id: session.user.id, candidate_id: card.id, video_key: card.videoKey, feedback_type: fb.type, reasons: fb.reasons || [], updated_at: fb.updatedAt || now() };
    }).filter(Boolean);
    if (!rows.length) return;
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/guiliu_feedback?on_conflict=user_id,video_key`, { method: "POST", headers: { ...auth(cfg), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(rows) });
    if (!res.ok) throw new Error("push feedback failed");
  }

  async function pushFeedback(card, type, reasons) {
    saveState();
    const cfg = config(); if (!cfg.ready || !session?.accessToken) return;
    try {
      await ensureSession(cfg); await fetchUser(cfg);
      await fetch(`${cfg.supabaseUrl}/rest/v1/guiliu_feedback?on_conflict=user_id,video_key`, { method: "POST", headers: { ...auth(cfg), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: session.user.id, candidate_id: card.id, video_key: card.videoKey, feedback_type: type, reasons, updated_at: now() }) });
    } catch {}
  }

  async function createToken() {
    const cfg = config();
    if (!cfg.ready || !session?.accessToken) { toast("先登录 Supabase，再生成采集码"); render(); return; }
    const token = `gl_${randomHex(24)}`;
    const tokenHash = await sha256(token);
    try {
      await ensureSession(cfg); await fetchUser(cfg);
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/guiliu_ingest_tokens`, { method: "POST", headers: { ...auth(cfg), "Content-Type": "application/json" }, body: JSON.stringify({ user_id: session.user.id, token_hash: tokenHash, label: "Chrome/Edge 插件", created_at: now() }) });
      if (!res.ok) throw new Error("token failed");
      ui.token = token; state.settings.lastToken = token; persist("采集码已生成，只完整显示这一次");
    } catch { toast("采集码生成失败，请先执行新版 SQL"); render(); }
  }

  function auth(cfg) { return { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${session.accessToken}` }; }
  function remoteCard(row) { return normalizeCard({ id: row.id, platform: row.platform, sourceType: row.source_type, sources: row.sources, videoKey: row.video_key, title: row.title, channelName: row.channel_name, channelKey: row.channel_key, thumbnailUrl: row.thumbnail_url, durationText: row.duration_text, publishedText: row.published_text, viewCountText: row.view_count_text, url: row.url, embedUrl: row.embed_url, capturedAt: row.captured_at, updatedAt: row.updated_at }); }

  function tick() {
    const nowTime = Date.now(); const delta = Math.min(5, Math.floor((nowTime - runtime.lastTick) / 1000)); runtime.lastTick = nowTime; if (delta <= 0) return;
    if (document.hidden || nowTime < Number(state.settings.pauseUntil || 0) || nowTime - runtime.lastActive > 2 * 60 * 1000) { runtime.continuous = 0; return; }
    const rec = dayRecord(today()); const dev = deviceStats(rec); dev.total += delta; ui.selected ? dev.player += delta : dev.feed += delta; runtime.continuous += delta; runtime.saveTick += delta;
    if (runtime.saveTick >= 10) { runtime.saveTick = 0; saveState(); }
    document.querySelectorAll("[data-live-total]").forEach((n) => n.textContent = fmtTime(totalsFor(today()).total));
    remind(rec);
  }

  function remind(rec) {
    if (ui.modal || Date.now() < Number(state.settings.snoozeUntil || 0)) return;
    const total = totalsFor(today()).total;
    if (total >= THRESHOLDS.dailyStop && !rec.reminders.dailyStop) { rec.reminders.dailyStop = true; ui.modal = { type: "dailyStop" }; saveState(); render(); return; }
    if (total >= THRESHOLDS.dailyReview && !rec.reminders.dailyReview) { rec.reminders.dailyReview = true; ui.modal = { type: "dailyReview" }; saveState(); render(); return; }
    if (runtime.continuous >= THRESHOLDS.continuous) { ui.modal = { type: "continuous" }; render(); }
  }

  function dayRecord(day) { if (!state.stats[day]) state.stats[day] = { devices: {}, reminders: {}, reflections: [] }; const rec = state.stats[day]; rec.devices ||= {}; rec.reminders ||= {}; rec.reflections = Array.isArray(rec.reflections) ? rec.reflections : []; deviceStats(rec); return rec; }
  function deviceStats(rec) { if (!rec.devices[state.deviceId]) rec.devices[state.deviceId] = { total: 0, feed: 0, player: 0 }; return rec.devices[state.deviceId]; }
  function totalsFor(day) { const rec = dayRecord(day); return Object.values(rec.devices).reduce((a, d) => ({ total: a.total + Number(d.total || d.totalSeconds || 0), feed: a.feed + Number(d.feed || d.feedSeconds || 0), player: a.player + Number(d.player || d.playerSeconds || 0) }), { total: 0, feed: 0, player: 0 }); }

  function normalizeCard(raw) {
    if (!raw) return null;
    const url = normalizeUrl(raw.url || raw.videoUrl || ""); if (!url) return null;
    const platform = platformOf(raw.platform, url); const videoKey = raw.videoKey || videoKeyOf(platform, url) || url; const sourceType = sourceOf(raw.sourceType || raw.source_type || "manual");
    return { id: raw.id || `${platform}:${videoKey}`, platform, sourceType, sources: uniq([...(Array.isArray(raw.sources) ? raw.sources : []), sourceType]), videoKey, title: clean(raw.title) || "未命名视频", channelName: clean(raw.channelName || raw.channel_name || raw.author) || "未知频道", channelKey: clean(raw.channelKey || raw.channel_key || raw.channelName || raw.channel_name || ""), thumbnailUrl: clean(raw.thumbnailUrl || raw.thumbnail_url || raw.thumbnail || ""), durationText: clean(raw.durationText || raw.duration_text || ""), publishedText: clean(raw.publishedText || raw.published_text || ""), viewCountText: clean(raw.viewCountText || raw.view_count_text || ""), url, embedUrl: clean(raw.embedUrl || raw.embed_url || embed(platform, videoKey)), capturedAt: raw.capturedAt || raw.captured_at || now(), updatedAt: raw.updatedAt || raw.updated_at || now() };
  }

  function seed() { return [normalizeCard({ platform: "youtube", sourceType: "subscription", videoKey: "dQw4w9WgXcQ", title: "示例：插件装好后，这里会变成你的真实订阅视频", channelName: "归流示例", thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", durationText: "3:33", publishedText: "示例", viewCountText: "本地演示", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }), normalizeCard({ platform: "bilibili", sourceType: "platform_recommendation", videoKey: "BV1xx411c7mD", title: "示例：从 B站首页/关注页采集的推荐会进入这个池子", channelName: "归流示例", durationText: "12:08", publishedText: "示例", viewCountText: "等待采集", url: "https://www.bilibili.com/video/BV1xx411c7mD" })].filter(Boolean); }
  function titleForTab() { return { all: "为你重排", subscription: "订阅更新", platform_recommendation: "平台推荐", later: "稍后看", hidden: "已隐藏" }[ui.tab] || "视频"; }
  function subtitleForTab() { return ui.tab === "all" ? "订阅和平台推荐大致 50/50 混合，再根据你的选择排序。" : ui.tab === "hidden" ? "这些视频不会再进入默认主页。" : "所有选择都会同步记录，逐步形成你的独立视频主页。"; }
  function countTab(tabName) { if (tabName === "all") return state.candidates.filter((c) => state.feedback[c.id]?.type !== "not_interested").length; if (tabName === "later") return countFeedback("later"); if (tabName === "hidden") return countFeedback("not_interested"); return state.candidates.filter((c) => (c.sourceType === tabName || c.sources.includes(tabName)) && state.feedback[c.id]?.type !== "not_interested").length; }
  function countFeedback(type) { return Object.values(state.feedback).filter((fb) => fb.type === type).length; }
  function key(card) { return `${card.platform}:${card.videoKey || card.url}`; }
  function addWeight(obj, name, amount) { if (!name) return; obj[name] = Number(obj[name] || 0) + amount; }
  function top(obj, n) { return Object.entries(obj || {}).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, n); }
  function terms(text) { return uniq((String(text || "").match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z][a-zA-Z0-9+#-]{2,}/g) || []).filter((x) => !["视频", "这个", "一个", "the", "and", "with", "from"].includes(x.toLowerCase()))).slice(0, 12); }
  function fresh(value) { const t = new Date(value).getTime(); if (!Number.isFinite(t)) return 0; return Math.max(0, 12 - Math.max(0, (Date.now() - t) / 86400000) * 0.6); }
  function platformOf(platform, url) { const p = String(platform || "").toLowerCase(); if (p.includes("youtube")) return "youtube"; if (p.includes("bilibili") || p.includes("b站")) return "bilibili"; try { const h = new URL(url).hostname; if (h.includes("youtu")) return "youtube"; if (h.includes("bilibili")) return "bilibili"; } catch {} return "unknown"; }
  function sourceOf(source) { const s = String(source || "").toLowerCase(); if (s.includes("subscription") || s.includes("订阅") || s.includes("关注")) return "subscription"; if (s.includes("recommend") || s.includes("推荐") || s.includes("首页")) return "platform_recommendation"; if (s.includes("channel")) return "channel"; return "manual"; }
  function videoKeyOf(platform, url) { if (platform === "youtube") return youtubeId(url); if (platform === "bilibili") return bvid(url); return ""; }
  function youtubeId(url) { try { const u = new URL(url); if (u.hostname.includes("youtu.be")) return u.pathname.split("/").filter(Boolean)[0] || ""; if (u.hostname.includes("youtube")) return u.searchParams.get("v") || u.pathname.split("/embed/")[1] || u.pathname.split("/shorts/")[1] || ""; } catch {} return ""; }
  function bvid(url) { return String(url).match(/BV[a-zA-Z0-9]+/)?.[0] || ""; }
  function embed(platform, keyValue) { if (platform === "youtube" && keyValue) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(keyValue)}?rel=0&modestbranding=1&playsinline=1`; if (platform === "bilibili" && keyValue) return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(keyValue)}&page=1&high_quality=1&autoplay=0`; return ""; }
  function normalizeUrl(value) { try { const raw = clean(value); if (!raw) return ""; const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`); u.hash = ""; return u.toString(); } catch { return ""; } }
  function exportData() { const blob = new Blob([JSON.stringify({ candidates: state.candidates, feedback: state.feedback, profile: state.profile, stats: state.stats }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `guiliu-video-backup-${today()}.json`; a.click(); URL.revokeObjectURL(url); }
  function importData(file) { if (!file) return; const r = new FileReader(); r.onload = () => { try { const data = JSON.parse(String(r.result || "{}")); if (Array.isArray(data.candidates)) mergeCards(data.candidates); state.feedback = { ...state.feedback, ...(data.feedback || {}) }; state.profile = { ...state.profile, ...(data.profile || {}) }; persist("导入完成"); } catch { toast("导入失败"); render(); } }; r.readAsText(file); }
  function clean(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
  function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
  function today(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function now() { return new Date().toISOString(); }
  function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
  function fmtTime(sec) { const s = Math.max(0, Math.round(Number(sec || 0))); const m = Math.floor(s / 60); if (m < 1) return `${s} 秒`; const h = Math.floor(m / 60), r = m % 60; return h ? `${h} 小时${r ? ` ${r} 分钟` : ""}` : `${m} 分钟`; }
  function randomHex(len) { const b = new Uint8Array(len); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }
  async function sha256(text) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); toast("已复制"); } catch { toast("复制失败，请手动选择"); } render(); }
  function esc(v) { return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
})();
