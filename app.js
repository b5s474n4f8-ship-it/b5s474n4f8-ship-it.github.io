(() => {
  "use strict";

  const STORAGE_KEY = "guiliu_state_v1";
  const SESSION_KEY = "guiliu_session_v1";
  const CONFIG = window.GUILIU_CONFIG || {};
  const DEFAULT_THRESHOLDS = {
    continuous: 20 * 60,
    dailyReview: 45 * 60,
    dailyStop: 75 * 60,
  };
  const SIGNAL_WORDS = [
    "AI",
    "人工智能",
    "编程",
    "设计",
    "产品",
    "写作",
    "阅读",
    "创作",
    "心理",
    "哲学",
    "身体",
    "运动",
    "睡眠",
    "健康",
    "电影",
    "音乐",
    "艺术",
    "审美",
    "社会",
    "历史",
    "科学",
    "技术",
    "商业",
    "财务",
    "学习",
    "语言",
    "研究",
    "纪录片",
    "访谈",
    "教程",
    "效率",
    "生活",
    "自我认识",
    "长期主义",
    "表达",
    "旅行",
    "食物",
    "小红书",
    "微博",
    "豆瓣",
    "YouTube",
    "B站",
  ];
  const PLATFORM_LABELS = {
    youtube: "YouTube",
    bilibili: "B站",
    xiaohongshu: "小红书",
    weibo: "微博",
    douban: "豆瓣",
    webpage: "网页",
  };
  const CONTENT_LABELS = {
    video: "视频",
    note: "笔记",
    post: "帖子",
    article: "文章",
    webpage: "网页",
  };

  const app = document.getElementById("app");
  let state = loadState();
  let session = loadSession();
  let ui = {
    view: "recommend",
    selectedItemId: "",
    modal: null,
    toast: "",
    syncStatus: "",
    busy: "",
  };
  let runtime = {
    lastInteractionAt: Date.now(),
    lastTickAt: Date.now(),
    continuousSeconds: 0,
    saveTicks: 0,
    syncTimer: 0,
    toastTimer: 0,
    syncing: false,
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    registerServiceWorker();
    bindEvents();
    handleAuthHash();
    handleShareParams();
    render();
    startTimer();
    queueSync();
  }

  function bindEvents() {
    app.addEventListener("click", onClick);
    app.addEventListener("submit", onSubmit);
    app.addEventListener("change", onChange);

    ["pointerdown", "keydown", "touchstart", "scroll"].forEach((eventName) => {
      window.addEventListener(eventName, markInteraction, { passive: true });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        runtime.continuousSeconds = 0;
        saveState();
      } else {
        runtime.lastInteractionAt = Date.now();
        runtime.lastTickAt = Date.now();
      }
    });

    window.addEventListener("pagehide", () => saveState());
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!target) return;
    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-id") || "";

    if (action === "nav") {
      ui.view = target.getAttribute("data-view") || "recommend";
      render();
      return;
    }

    if (action === "select") {
      ui.selectedItemId = id;
      render();
      return;
    }

    if (action === "close-player") {
      ui.selectedItemId = "";
      render();
      return;
    }

    if (action === "rate") {
      const value = target.getAttribute("data-value") || "later";
      rateItem(id, value);
      return;
    }

    if (action === "delete") {
      deleteItem(id);
      return;
    }

    if (action === "sync-now") {
      syncNow("manual");
      return;
    }

    if (action === "ai-analyze") {
      runAiAnalysis();
      return;
    }

    if (action === "export") {
      exportData();
      return;
    }

    if (action === "import") {
      const input = document.querySelector("[data-import-file]");
      if (input) input.click();
      return;
    }

    if (action === "rest") {
      state.settings.pauseUntil = Date.now() + 5 * 60 * 1000;
      runtime.continuousSeconds = 0;
      ui.modal = null;
      persist("已暂停 5 分钟");
      return;
    }

    if (action === "reflect") {
      if (ui.modal) ui.modal.reflecting = true;
      render();
      return;
    }

    if (action === "continue") {
      state.settings.snoozeUntil = Date.now() + 10 * 60 * 1000;
      runtime.continuousSeconds = 0;
      ui.modal = null;
      persist("已延后 10 分钟");
      return;
    }

    if (action === "dismiss-toast") {
      setToast("");
    }
  }

  function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const formName = form.getAttribute("data-form");
    if (!formName) return;
    event.preventDefault();
    const data = new FormData(form);

    if (formName === "capture") {
      const url = String(data.get("url") || "").trim();
      const title = String(data.get("title") || "").trim();
      const summary = String(data.get("summary") || "").trim();
      const type = String(data.get("type") || "").trim();
      addItem(url, { title, summary, type });
      return;
    }

    if (formName === "sync-settings") {
      state.settings.supabaseUrl = String(data.get("supabaseUrl") || "").trim();
      state.settings.supabaseAnonKey = String(data.get("supabaseAnonKey") || "").trim();
      state.settings.aiAccessCode = String(data.get("aiAccessCode") || "").trim();
      persist("同步设置已保存");
      return;
    }

    if (formName === "magic-link") {
      const email = String(data.get("email") || "").trim();
      sendMagicLink(email);
      return;
    }

    if (formName === "reflection") {
      const text = String(data.get("reflection") || "").trim();
      if (text) {
        const day = todayKey();
        const record = getDayRecord(day);
        record.reflections.unshift({ id: makeId("reflection"), text, createdAt: nowIso() });
        runtime.continuousSeconds = 0;
        state.settings.snoozeUntil = Date.now() + 10 * 60 * 1000;
      }
      ui.modal = null;
      persist(text ? "复盘已保存" : "已关闭提醒");
    }
  }

  function onChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.hasAttribute("data-import-file")) {
      importData(input.files && input.files[0]);
    }
  }

  function markInteraction() {
    runtime.lastInteractionAt = Date.now();
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  function handleShareParams() {
    const params = new URLSearchParams(window.location.search);
    const sharedTitle = params.get("title") || "";
    const sharedText = params.get("text") || "";
    const sharedUrl = params.get("url") || extractUrl(sharedText) || extractUrl(sharedTitle);
    if (!sharedUrl) return;
    addItem(sharedUrl, {
      title: cleanupSharedText(sharedTitle),
      summary: cleanupSharedText(sharedText.replace(sharedUrl, "")),
    });
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function handleAuthHash() {
    const hash = window.location.hash ? new URLSearchParams(window.location.hash.slice(1)) : null;
    if (!hash) return;
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const expiresAt = Number(hash.get("expires_at") || 0);
    const error = hash.get("error_description") || hash.get("error");

    if (error) {
      setToast(`登录没有完成：${error}`);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      return;
    }

    if (accessToken && refreshToken) {
      session = {
        accessToken,
        refreshToken,
        expiresAt,
        user: null,
        savedAt: nowIso(),
      };
      saveSession();
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setToast("登录已完成，正在同步");
      await syncNow("login");
    }
  }

  function loadState() {
    const base = defaultState();
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return base;
      return normalizeState(parsed, base);
    } catch {
      return base;
    }
  }

  function defaultState() {
    return {
      version: 1,
      deviceId: makeId("device"),
      updatedAt: nowIso(),
      items: [],
      stats: {},
      profile: {
        summary: "",
        positive: {},
        negative: {},
        aiSignals: [],
        notes: [],
        updatedAt: "",
      },
      settings: {
        supabaseUrl: CONFIG.supabaseUrl || "",
        supabaseAnonKey: CONFIG.supabaseAnonKey || "",
        aiAccessCode: CONFIG.aiAccessCode || "",
        pauseUntil: 0,
        snoozeUntil: 0,
        thresholds: { ...DEFAULT_THRESHOLDS },
      },
    };
  }

  function normalizeState(parsed, base) {
    const next = { ...base };
    next.version = 1;
    next.deviceId = parsed.deviceId || base.deviceId;
    next.updatedAt = parsed.updatedAt || base.updatedAt;
    next.items = Array.isArray(parsed.items) ? parsed.items.map(normalizeItem).filter(Boolean) : [];
    next.stats = parsed.stats && typeof parsed.stats === "object" ? parsed.stats : {};
    next.profile = {
      ...base.profile,
      ...(parsed.profile && typeof parsed.profile === "object" ? parsed.profile : {}),
      positive: parsed.profile?.positive && typeof parsed.profile.positive === "object" ? parsed.profile.positive : {},
      negative: parsed.profile?.negative && typeof parsed.profile.negative === "object" ? parsed.profile.negative : {},
      notes: Array.isArray(parsed.profile?.notes) ? parsed.profile.notes : [],
      aiSignals: Array.isArray(parsed.profile?.aiSignals) ? parsed.profile.aiSignals : [],
    };
    next.settings = {
      ...base.settings,
      ...(parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {}),
      supabaseUrl: parsed.settings?.supabaseUrl || CONFIG.supabaseUrl || "",
      supabaseAnonKey: parsed.settings?.supabaseAnonKey || CONFIG.supabaseAnonKey || "",
      aiAccessCode: parsed.settings?.aiAccessCode || CONFIG.aiAccessCode || "",
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        ...(parsed.settings?.thresholds && typeof parsed.settings.thresholds === "object" ? parsed.settings.thresholds : {}),
      },
    };
    migrateStats(next);
    return next;
  }

  function normalizeItem(item) {
    if (!item || typeof item !== "object" || !item.url) return null;
    return {
      id: item.id || makeId("item"),
      url: item.url,
      normalizedUrl: item.normalizedUrl || normalizeUrl(item.url),
      platform: item.platform || "webpage",
      contentType: item.contentType || "webpage",
      title: item.title || "",
      author: item.author || "",
      description: item.description || "",
      summary: item.summary || "",
      transcript: item.transcript || "",
      thumbnail: item.thumbnail || "",
      embedUrl: item.embedUrl || "",
      rating: item.rating || "",
      evaluation: item.evaluation || "",
      signals: Array.isArray(item.signals) ? item.signals : [],
      aiReason: item.aiReason || "",
      aiWatchOut: item.aiWatchOut || "",
      createdAt: item.createdAt || nowIso(),
      updatedAt: item.updatedAt || nowIso(),
    };
  }

  function migrateStats(target) {
    Object.keys(target.stats).forEach((day) => {
      const record = target.stats[day] || {};
      if (!record.devices) {
        record.devices = {
          [target.deviceId]: {
            totalSeconds: Number(record.totalSeconds || 0),
            recommendSeconds: Number(record.recommendSeconds || 0),
            playerSeconds: Number(record.playerSeconds || 0),
          },
        };
      }
      record.reminders = record.reminders || {};
      record.reflections = Array.isArray(record.reflections) ? record.reflections : [];
      target.stats[day] = record;
    });
  }

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveSession() {
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function saveState(options = {}) {
    state.updatedAt = nowIso();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (options.sync !== false) queueSync();
  }

  function persist(message) {
    saveState();
    setToast(message);
    render();
  }

  function setToast(message) {
    ui.toast = message || "";
    window.clearTimeout(runtime.toastTimer);
    if (message) {
      runtime.toastTimer = window.setTimeout(() => {
        ui.toast = "";
        render();
      }, 3200);
    }
  }

  function addItem(rawUrl, info = {}) {
    const url = normalizeUrl(rawUrl);
    if (!url) {
      setToast("链接不完整");
      render();
      return;
    }
    const meta = inferMeta(url, info);
    const existing = state.items.find((item) => item.normalizedUrl === meta.normalizedUrl || item.url === meta.url);
    if (existing) {
      existing.title = info.title || existing.title || meta.title;
      existing.summary = info.summary || existing.summary;
      existing.contentType = info.type || existing.contentType || meta.contentType;
      existing.updatedAt = nowIso();
      ui.view = "inbox";
      persist("这条内容已在归流中");
      return;
    }
    state.items.unshift(meta);
    ui.view = "inbox";
    persist("已收进归流");
  }

  function inferMeta(url, info = {}) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    const host = parsed ? parsed.hostname.replace(/^www\./, "") : "";
    const path = parsed ? parsed.pathname : "";
    const title = info.title || host || "未命名内容";
    const summary = info.summary || "";
    let platform = "webpage";
    let contentType = info.type || "webpage";
    let embedUrl = "";
    let thumbnail = "";

    const youtubeId = parseYoutubeId(url);
    const bilibiliId = parseBilibiliId(url);

    if (youtubeId) {
      platform = "youtube";
      contentType = "video";
      embedUrl = `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1&playsinline=1`;
      thumbnail = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
    } else if (bilibiliId) {
      platform = "bilibili";
      contentType = "video";
      embedUrl = `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bilibiliId)}&page=1&high_quality=1&autoplay=0`;
    } else if (host.includes("xiaohongshu") || host.includes("xhslink")) {
      platform = "xiaohongshu";
      contentType = info.type || "note";
    } else if (host.includes("weibo")) {
      platform = "weibo";
      contentType = info.type || "post";
    } else if (host.includes("douban")) {
      platform = "douban";
      contentType = info.type || "article";
    } else if (info.type) {
      contentType = info.type;
    }

    const itemText = [title, summary, PLATFORM_LABELS[platform], CONTENT_LABELS[contentType]].join(" ");
    return {
      id: makeId("item"),
      url,
      normalizedUrl: normalizeUrl(url),
      platform,
      contentType,
      title,
      author: "",
      description: "",
      summary,
      transcript: "",
      thumbnail,
      embedUrl,
      rating: "",
      evaluation: "",
      signals: extractSignals(itemText),
      aiReason: "",
      aiWatchOut: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  function rateItem(id, value) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    const noteInput = document.querySelector(`[data-note-for="${cssEscape(id)}"]`);
    const note = noteInput ? String(noteInput.value || "").trim() : item.evaluation || "";
    item.rating = value;
    item.evaluation = note;
    item.updatedAt = nowIso();
    updateProfile(item, value, note);
    persist(value === "interested" ? "已记录感兴趣" : value === "not_interested" ? "已记录不感兴趣" : "已放入稍后");
  }

  function deleteItem(id) {
    state.items = state.items.filter((entry) => entry.id !== id);
    if (ui.selectedItemId === id) ui.selectedItemId = "";
    persist("已移除");
  }

  function updateProfile(item, rating, note) {
    const signals = extractSignals([item.title, item.summary, item.description, note].join(" "));
    const bucket = rating === "not_interested" ? state.profile.negative : state.profile.positive;
    if (rating === "interested" || rating === "not_interested") {
      signals.forEach((signal) => {
        bucket[signal] = Number(bucket[signal] || 0) + 1;
      });
      state.profile.notes.unshift({
        id: makeId("note"),
        itemId: item.id,
        title: item.title,
        rating,
        text: note,
        signals,
        createdAt: nowIso(),
      });
      state.profile.notes = state.profile.notes.slice(0, 80);
      state.profile.summary = buildLocalSummary();
      state.profile.updatedAt = nowIso();
    }
  }

  function buildLocalSummary() {
    const positive = topSignals(state.profile.positive, 4);
    const negative = topSignals(state.profile.negative, 3);
    if (!positive.length && !negative.length) return "";
    const likeText = positive.length ? `偏向 ${positive.join("、")}` : "偏好还在形成";
    const avoidText = negative.length ? `，同时会避开 ${negative.join("、")}` : "";
    return `${likeText}${avoidText}`;
  }

  function rankItems() {
    const positive = new Set(topSignals(state.profile.positive, 8));
    const negative = new Set(topSignals(state.profile.negative, 8));
    return state.items
      .map((item) => {
        let score = recencyScore(item.createdAt);
        if (item.rating === "interested") score += 4;
        if (item.rating === "later") score += 2;
        if (item.rating === "not_interested") score -= 100;
        item.signals.forEach((signal) => {
          if (positive.has(signal)) score += 2;
          if (negative.has(signal)) score -= 3;
        });
        if (item.contentType === "video") score += 0.6;
        if (item.aiReason) score += 0.5;
        return { item, score };
      })
      .filter((entry) => entry.score > -20)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }

  function recencyScore(dateText) {
    const created = new Date(dateText).getTime();
    if (!Number.isFinite(created)) return 0;
    const ageDays = Math.max(0, (Date.now() - created) / 86400000);
    return Math.max(0, 2.2 - ageDays * 0.18);
  }

  function recommendationReason(item) {
    if (item.aiReason) return item.aiReason;
    const positive = topSignals(state.profile.positive, 8);
    const hit = item.signals.find((signal) => positive.includes(signal));
    if (hit) return `命中你最近感兴趣的「${hit}」。`;
    if (item.rating === "interested") return "你曾把它标记为感兴趣，适合作为稳定内容源。";
    if (item.rating === "later") return "你曾放入稍后，适合在没有明确目标时接回。";
    return "还没有足够评价，先用它校准你的 taste。";
  }

  function watchOutReason(item) {
    if (item.aiWatchOut) return item.aiWatchOut;
    const negative = topSignals(state.profile.negative, 8);
    const hit = item.signals.find((signal) => negative.includes(signal));
    if (hit) return `它也接近你不感兴趣的「${hit}」，建议看完后重新评价。`;
    if (item.platform === "xiaohongshu" || item.platform === "weibo") return "外部平台吸引力较强，建议只看这一条。";
    return "信息质量和观看时长尚未确认。";
  }

  function render() {
    const totals = dayTotals(todayKey());
    const recommendations = rankItems().slice(0, 8);
    const inbox = state.items.filter((item) => !item.rating).slice(0, 10);
    const selected = state.items.find((item) => item.id === ui.selectedItemId) || recommendations[0] || null;

    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand">
            <img class="brand-mark" src="./icon.svg" alt="" />
            <div>
              <h1 class="wordmark">归流</h1>
              <div class="tagline">把信息流收回到自己的判断里</div>
            </div>
          </div>
          <div class="today-meter" aria-live="polite">
            <span class="meter-dot"></span>
            <div>
              <div class="meter-label">今日</div>
              <div class="meter-value" data-live-total>${formatDuration(totals.totalSeconds)}</div>
            </div>
          </div>
        </header>

        <main class="dashboard">
          <section class="panel ${panelActive("recommend")}" data-panel="recommend">
            <div class="section-head">
              <h2>今日推荐</h2>
              <span class="section-meta">${recommendations.length} 条</span>
            </div>
            <div class="stack">
              ${selected ? renderPlayer(selected) : ""}
              ${recommendations.length ? recommendations.map(renderCard).join("") : renderEmpty("先收进一条内容", "从手机分享或粘贴链接开始。")}
            </div>
          </section>

          <section class="panel ${panelActive("inbox")}" data-panel="inbox">
            <div class="section-head">
              <h2>待评价</h2>
              <span class="section-meta">${inbox.length} 条</span>
            </div>
            <div class="stack">
              ${renderCaptureBox()}
              ${inbox.length ? inbox.map(renderCard).join("") : renderEmpty("收件箱已清空", "新的分享会出现在这里。")}
            </div>
          </section>

          <section class="panel ${panelActive("profile")}" data-panel="profile">
            <div class="section-head">
              <h2>Taste 画像</h2>
              <span class="section-meta">${state.items.length} 条内容</span>
            </div>
            <div class="stack">
              ${renderTastePanel(totals)}
              ${renderSyncPanel()}
            </div>
          </section>
        </main>

        <nav class="bottom-nav" aria-label="主导航">
          ${renderNavButton("recommend", "推荐")}
          ${renderNavButton("inbox", "评价")}
          ${renderNavButton("profile", "画像")}
        </nav>
      </div>
      ${renderReminder()}
      ${ui.toast ? `<div class="toast">${escapeHtml(ui.toast)}</div>` : ""}
    `;
    renderLiveStats();
  }

  function renderNavButton(view, label) {
    return `<button class="btn ${ui.view === view ? "is-active" : ""}" type="button" data-action="nav" data-view="${view}">${label}</button>`;
  }

  function panelActive(view) {
    return ui.view === view ? "is-active" : "";
  }

  function renderCaptureBox() {
    return `
      <form class="capture-box" data-form="capture">
        <input class="field" name="url" type="url" inputmode="url" placeholder="粘贴链接" autocomplete="off" required />
        <div class="form-grid two">
          <input class="field" name="title" type="text" placeholder="标题" autocomplete="off" />
          <select class="select-field" name="type" aria-label="内容类型">
            <option value="">自动</option>
            <option value="video">视频</option>
            <option value="article">文章</option>
            <option value="note">笔记</option>
            <option value="post">帖子</option>
          </select>
        </div>
        <textarea class="textarea-field" name="summary" placeholder="一句摘要"></textarea>
        <div class="button-row">
          <button class="btn primary" type="submit">收进归流</button>
          <button class="btn" type="button" data-action="import">导入</button>
          <button class="btn" type="button" data-action="export">导出</button>
          <input class="sr-only" data-import-file type="file" accept="application/json" />
        </div>
      </form>
    `;
  }

  function renderCard(item) {
    const statusClass = item.rating === "interested" ? "is-liked" : item.rating === "not_interested" ? "is-avoided" : "";
    return `
      <article class="content-card ${statusClass}">
        <div class="thumb">
          ${item.thumbnail ? `<img src="${escapeAttr(item.thumbnail)}" alt="" loading="lazy" />` : renderThumbFallback()}
          <span class="platform-pill">${escapeHtml(PLATFORM_LABELS[item.platform] || "网页")} · ${escapeHtml(CONTENT_LABELS[item.contentType] || "内容")}</span>
        </div>
        <div class="card-main">
          <h3 class="card-title">${escapeHtml(item.title || "未命名内容")}</h3>
          <div class="card-sub">
            <span>${escapeHtml(formatDate(item.createdAt))}</span>
            ${item.rating ? `<span>${escapeHtml(ratingLabel(item.rating))}</span>` : ""}
          </div>
          ${item.summary ? `<p class="card-text">${escapeHtml(item.summary)}</p>` : ""}
          <p class="card-text"><strong>推荐：</strong>${escapeHtml(recommendationReason(item))}</p>
          <p class="card-text"><strong>留意：</strong>${escapeHtml(watchOutReason(item))}</p>
          ${renderSignals(item.signals)}
          <textarea class="note-input" data-note-for="${escapeAttr(item.id)}" placeholder="一句原因">${escapeHtml(item.evaluation || "")}</textarea>
          <div class="button-row">
            ${item.embedUrl ? `<button class="btn primary" type="button" data-action="select" data-id="${escapeAttr(item.id)}">观看</button>` : `<a class="btn primary" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">打开</a>`}
            <button class="btn soft" type="button" data-action="rate" data-id="${escapeAttr(item.id)}" data-value="interested">感兴趣</button>
            <button class="btn" type="button" data-action="rate" data-id="${escapeAttr(item.id)}" data-value="later">稍后看</button>
            <button class="btn warn" type="button" data-action="rate" data-id="${escapeAttr(item.id)}" data-value="not_interested">不感兴趣</button>
            <button class="btn ghost icon-btn" type="button" data-action="delete" data-id="${escapeAttr(item.id)}" aria-label="移除">×</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderPlayer(item) {
    return `
      <section class="player" aria-label="播放器">
        ${
          item.embedUrl
            ? `<iframe class="player-frame" src="${escapeAttr(item.embedUrl)}" title="${escapeAttr(item.title || "内容播放")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`
            : `<div class="player-shell"><a class="btn primary" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">打开原链接</a></div>`
        }
        <div class="player-body">
          <div class="section-head">
            <h2>${escapeHtml(item.title || "未命名内容")}</h2>
            <button class="btn" type="button" data-action="close-player">收起</button>
          </div>
          <div class="button-row">
            <a class="btn" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">原链接</a>
            <button class="btn soft" type="button" data-action="rate" data-id="${escapeAttr(item.id)}" data-value="interested">感兴趣</button>
            <button class="btn warn" type="button" data-action="rate" data-id="${escapeAttr(item.id)}" data-value="not_interested">不感兴趣</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderTastePanel(totals) {
    const positive = topSignals(state.profile.positive, 8);
    const negative = topSignals(state.profile.negative, 6);
    const summary = state.profile.summary || "评价几条内容后，这里会沉淀你的偏好。";
    return `
      <section class="taste-block">
        <p class="taste-summary">${escapeHtml(summary)}</p>
        <div class="stats-grid">
          <div class="stat">
            <div class="stat-label">总时长</div>
            <div class="stat-value" data-live-total>${formatDuration(totals.totalSeconds)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">推荐页</div>
            <div class="stat-value" data-live-recommend>${formatDuration(totals.recommendSeconds)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">播放页</div>
            <div class="stat-value" data-live-player>${formatDuration(totals.playerSeconds)}</div>
          </div>
        </div>
        <div class="signal-row">
          ${positive.length ? positive.map((signal) => `<span class="signal good">${escapeHtml(signal)}</span>`).join("") : `<span class="signal">偏好生成中</span>`}
        </div>
        <div class="signal-row">
          ${negative.length ? negative.map((signal) => `<span class="signal warn">${escapeHtml(signal)}</span>`).join("") : `<span class="signal">反感边界生成中</span>`}
        </div>
        <div class="button-row">
          <button class="btn primary" type="button" data-action="ai-analyze">${ui.busy === "ai" ? "整理中" : "AI 整理"}</button>
        </div>
      </section>
    `;
  }

  function renderSyncPanel() {
    const config = syncConfig();
    const signedIn = Boolean(session?.accessToken);
    const statusText = signedIn ? session?.user?.email || "已登录" : config.ready ? "未登录" : "本地模式";
    return `
      <section class="sync-box">
        <div class="sync-status">
          <span class="status-dot ${signedIn ? "on" : ""}"></span>
          <span>${escapeHtml(ui.syncStatus || statusText)}</span>
        </div>
        <form class="form-grid" data-form="sync-settings">
          <input class="field" name="supabaseUrl" type="url" placeholder="Supabase URL" value="${escapeAttr(state.settings.supabaseUrl)}" />
          <input class="field" name="supabaseAnonKey" type="password" placeholder="Supabase anon key" value="${escapeAttr(state.settings.supabaseAnonKey)}" />
          <input class="field" name="aiAccessCode" type="password" placeholder="AI access code" value="${escapeAttr(state.settings.aiAccessCode)}" />
          <div class="button-row">
            <button class="btn" type="submit">保存设置</button>
            <button class="btn" type="button" data-action="sync-now">${runtime.syncing ? "同步中" : "立即同步"}</button>
          </div>
        </form>
        <form class="form-grid two" data-form="magic-link">
          <input class="field" name="email" type="email" placeholder="邮箱登录" autocomplete="email" />
          <button class="btn primary" type="submit">发送链接</button>
        </form>
      </section>
    `;
  }

  function renderSignals(signals) {
    if (!signals.length) return "";
    return `<div class="signal-row">${signals.slice(0, 5).map((signal) => `<span class="signal">${escapeHtml(signal)}</span>`).join("")}</div>`;
  }

  function renderThumbFallback() {
    return `
      <div class="thumb-fallback" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <path d="M10 22c12 0 18 6 24 16" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
          <path d="M10 38h24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
          <path d="M34 26h13a7 7 0 0 1 7 7v10a7 7 0 0 1-7 7H34z" fill="currentColor" opacity=".22"/>
        </svg>
      </div>
    `;
  }

  function renderEmpty(title, text) {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`;
  }

  function renderReminder() {
    if (!ui.modal) return "";
    const copy = reminderCopy(ui.modal.type);
    return `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reminder-title">
        <section class="reminder-card">
          <h2 id="reminder-title">${escapeHtml(copy.title)}</h2>
          <p>${escapeHtml(copy.body)}</p>
          ${
            ui.modal.reflecting
              ? `<form class="form-grid" data-form="reflection">
                  <textarea class="textarea-field" name="reflection" placeholder="一句复盘"></textarea>
                  <div class="button-row">
                    <button class="btn primary" type="submit">保存</button>
                    <button class="btn" type="button" data-action="continue">继续 10 分钟</button>
                  </div>
                </form>`
              : `<div class="button-row">
                  <button class="btn primary" type="button" data-action="rest">休息一下</button>
                  <button class="btn" type="button" data-action="reflect">写一句复盘</button>
                  <button class="btn" type="button" data-action="continue">继续 10 分钟</button>
                </div>`
          }
        </section>
      </div>
    `;
  }

  function reminderCopy(type) {
    if (type === "dailyStop") {
      return { title: "今天已经够了", body: "这一轮可以收束，留下余味比继续刷更有价值。" };
    }
    if (type === "dailyReview") {
      return { title: "做一次小复盘", body: "今天在归流里的时间已经不少，可以写一句判断：这段观看对你有益吗？" };
    }
    return { title: "暂停一下", body: "连续观看已经到 20 分钟。站起来、喝水，或者用一句话确认下一条是否值得看。" };
  }

  function startTimer() {
    window.setInterval(tick, 1000);
  }

  function tick() {
    const now = Date.now();
    const delta = Math.min(5, Math.floor((now - runtime.lastTickAt) / 1000));
    runtime.lastTickAt = now;
    if (delta <= 0) return;

    if (!shouldCount(now)) {
      runtime.continuousSeconds = 0;
      return;
    }

    const record = getDayRecord(todayKey());
    const device = getDeviceStats(record);
    device.totalSeconds += delta;
    if (ui.view === "recommend") device.recommendSeconds += delta;
    if (ui.selectedItemId) device.playerSeconds += delta;
    runtime.continuousSeconds += delta;
    runtime.saveTicks += delta;

    if (runtime.saveTicks >= 10) {
      runtime.saveTicks = 0;
      saveState();
      renderLiveStats();
    } else {
      renderLiveStats();
    }
    checkReminders(record);
  }

  function shouldCount(now) {
    if (document.hidden) return false;
    if (now < Number(state.settings.pauseUntil || 0)) return false;
    return now - runtime.lastInteractionAt <= 2 * 60 * 1000;
  }

  function checkReminders(record) {
    if (ui.modal) return;
    const now = Date.now();
    if (now < Number(state.settings.snoozeUntil || 0)) return;
    const thresholds = state.settings.thresholds || DEFAULT_THRESHOLDS;
    const totals = dayTotals(todayKey());

    if (totals.totalSeconds >= thresholds.dailyStop && !record.reminders.dailyStop) {
      record.reminders.dailyStop = true;
      ui.modal = { type: "dailyStop", reflecting: false };
      saveState();
      render();
      return;
    }

    if (totals.totalSeconds >= thresholds.dailyReview && !record.reminders.dailyReview) {
      record.reminders.dailyReview = true;
      ui.modal = { type: "dailyReview", reflecting: false };
      saveState();
      render();
      return;
    }

    if (runtime.continuousSeconds >= thresholds.continuous) {
      ui.modal = { type: "continuous", reflecting: false };
      render();
    }
  }

  function renderLiveStats() {
    const totals = dayTotals(todayKey());
    document.querySelectorAll("[data-live-total]").forEach((node) => {
      node.textContent = formatDuration(totals.totalSeconds);
    });
    document.querySelectorAll("[data-live-recommend]").forEach((node) => {
      node.textContent = formatDuration(totals.recommendSeconds);
    });
    document.querySelectorAll("[data-live-player]").forEach((node) => {
      node.textContent = formatDuration(totals.playerSeconds);
    });
  }

  function getDayRecord(day) {
    if (!state.stats[day]) {
      state.stats[day] = { devices: {}, reminders: {}, reflections: [] };
    }
    const record = state.stats[day];
    record.devices = record.devices || {};
    record.reminders = record.reminders || {};
    record.reflections = Array.isArray(record.reflections) ? record.reflections : [];
    getDeviceStats(record);
    return record;
  }

  function getDeviceStats(record) {
    if (!record.devices[state.deviceId]) {
      record.devices[state.deviceId] = { totalSeconds: 0, recommendSeconds: 0, playerSeconds: 0 };
    }
    return record.devices[state.deviceId];
  }

  function dayTotals(day) {
    const record = getDayRecord(day);
    return Object.values(record.devices || {}).reduce(
      (totals, device) => {
        totals.totalSeconds += Number(device.totalSeconds || 0);
        totals.recommendSeconds += Number(device.recommendSeconds || 0);
        totals.playerSeconds += Number(device.playerSeconds || 0);
        return totals;
      },
      { totalSeconds: 0, recommendSeconds: 0, playerSeconds: 0 },
    );
  }

  async function runAiAnalysis() {
    if (ui.busy) return;
    if (!state.items.length) {
      setToast("先收进几条内容");
      render();
      return;
    }
    ui.busy = "ai";
    setToast("正在整理 Taste");
    render();
    try {
      const response = await fetch("./.netlify/functions/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Access-Code": state.settings.aiAccessCode || CONFIG.aiAccessCode || "",
        },
        body: JSON.stringify({
          items: state.items.slice(0, 80).map((item) => ({
            id: item.id,
            url: item.url,
            platform: item.platform,
            contentType: item.contentType,
            title: item.title,
            summary: item.summary,
            transcript: item.transcript,
            rating: item.rating,
            evaluation: item.evaluation,
            signals: item.signals,
          })),
          profile: state.profile,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI 整理失败");
      applyAiAnalysis(data);
      persist("Taste 已更新");
    } catch (error) {
      localAnalyze();
      persist(error.message ? `已用本地整理：${error.message}` : "已用本地整理");
    } finally {
      ui.busy = "";
      render();
    }
  }

  function applyAiAnalysis(data) {
    if (data.profileSummary) state.profile.summary = data.profileSummary;
    if (Array.isArray(data.positiveSignals)) {
      data.positiveSignals.forEach((signal) => {
        if (signal && signal.name) state.profile.positive[signal.name] = Math.max(Number(state.profile.positive[signal.name] || 0), Number(signal.weight || 1));
      });
    }
    if (Array.isArray(data.negativeSignals)) {
      data.negativeSignals.forEach((signal) => {
        if (signal && signal.name) state.profile.negative[signal.name] = Math.max(Number(state.profile.negative[signal.name] || 0), Number(signal.weight || 1));
      });
    }
    if (Array.isArray(data.recommendations)) {
      data.recommendations.forEach((entry) => {
        const item = state.items.find((candidate) => candidate.id === entry.id);
        if (!item) return;
        item.aiReason = entry.reason || item.aiReason;
        item.aiWatchOut = entry.watchOut || item.aiWatchOut;
        item.updatedAt = nowIso();
      });
    }
    state.profile.aiSignals = Array.isArray(data.aiSignals) ? data.aiSignals : state.profile.aiSignals;
    state.profile.updatedAt = nowIso();
  }

  function localAnalyze() {
    state.items.forEach((item) => {
      item.signals = unique([...item.signals, ...extractSignals([item.title, item.summary, item.evaluation].join(" "))]);
    });
    state.profile.summary = buildLocalSummary();
    state.profile.updatedAt = nowIso();
  }

  function syncConfig() {
    const supabaseUrl = (state.settings.supabaseUrl || CONFIG.supabaseUrl || "").replace(/\/$/, "");
    const supabaseAnonKey = state.settings.supabaseAnonKey || CONFIG.supabaseAnonKey || "";
    return { supabaseUrl, supabaseAnonKey, ready: Boolean(supabaseUrl && supabaseAnonKey) };
  }

  function queueSync() {
    const config = syncConfig();
    if (!config.ready || !session?.accessToken) return;
    window.clearTimeout(runtime.syncTimer);
    runtime.syncTimer = window.setTimeout(() => syncNow("auto"), 1800);
  }

  async function sendMagicLink(email) {
    const config = syncConfig();
    if (!email) {
      setToast("请输入邮箱");
      render();
      return;
    }
    if (!config.ready) {
      setToast("先保存 Supabase 设置");
      render();
      return;
    }
    try {
      const response = await fetch(`${config.supabaseUrl}/auth/v1/otp`, {
        method: "POST",
        headers: {
          apikey: config.supabaseAnonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          create_user: true,
          options: { email_redirect_to: window.location.href.split("#")[0] },
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setToast("登录链接已发送");
      render();
    } catch {
      setToast("登录链接发送失败");
      render();
    }
  }

  async function syncNow(mode = "manual") {
    const config = syncConfig();
    if (!config.ready) {
      ui.syncStatus = "本地模式";
      if (mode === "manual") setToast("先配置 Supabase");
      render();
      return;
    }
    if (!session?.accessToken) {
      ui.syncStatus = "未登录";
      if (mode === "manual") setToast("请先邮箱登录");
      render();
      return;
    }
    if (runtime.syncing) return;
    runtime.syncing = true;
    ui.syncStatus = "同步中";
    render();

    try {
      await ensureSession(config);
      await fetchUser(config);
      const remote = await pullRemoteState(config);
      if (remote) mergeRemote(remote);
      await pushRemoteState(config);
      ui.syncStatus = "已同步";
      saveState({ sync: false });
    } catch {
      ui.syncStatus = "同步失败";
    } finally {
      runtime.syncing = false;
      render();
    }
  }

  async function ensureSession(config) {
    if (!session?.refreshToken) throw new Error("No session");
    const expiresAtMs = Number(session.expiresAt || 0) * 1000;
    if (expiresAtMs && Date.now() < expiresAtMs - 60000) return session;
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || "Refresh failed");
    session.accessToken = data.access_token;
    session.refreshToken = data.refresh_token || session.refreshToken;
    session.expiresAt = data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
    session.savedAt = nowIso();
    saveSession();
    return session;
  }

  async function fetchUser(config) {
    if (session?.user?.id) return session.user;
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || "User failed");
    session.user = { id: data.id, email: data.email };
    saveSession();
    return session.user;
  }

  async function pullRemoteState(config) {
    const user = await fetchUser(config);
    const response = await fetch(`${config.supabaseUrl}/rest/v1/guiliu_states?user_id=eq.${encodeURIComponent(user.id)}&select=state,updated_at`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error("Pull failed");
    return data?.[0]?.state || null;
  }

  async function pushRemoteState(config) {
    const user = await fetchUser(config);
    const response = await fetch(`${config.supabaseUrl}/rest/v1/guiliu_states`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: user.id,
        state: syncPayload(),
        updated_at: nowIso(),
      }),
    });
    if (!response.ok) throw new Error("Push failed");
  }

  function syncPayload() {
    return {
      version: state.version,
      updatedAt: state.updatedAt,
      items: state.items,
      stats: state.stats,
      profile: state.profile,
    };
  }

  function mergeRemote(remote) {
    if (!remote || typeof remote !== "object") return;
    const localByKey = new Map(state.items.map((item) => [item.normalizedUrl || item.url || item.id, item]));
    (Array.isArray(remote.items) ? remote.items : []).map(normalizeItem).filter(Boolean).forEach((remoteItem) => {
      const key = remoteItem.normalizedUrl || remoteItem.url || remoteItem.id;
      const local = localByKey.get(key);
      if (!local) {
        state.items.push(remoteItem);
        return;
      }
      if (new Date(remoteItem.updatedAt).getTime() > new Date(local.updatedAt).getTime()) {
        Object.assign(local, remoteItem);
      }
    });

    if (remote.stats && typeof remote.stats === "object") {
      Object.entries(remote.stats).forEach(([day, remoteRecord]) => {
        const localRecord = getDayRecord(day);
        const remoteDevices = remoteRecord?.devices || {};
        Object.entries(remoteDevices).forEach(([deviceId, remoteStats]) => {
          const localDevice = localRecord.devices[deviceId] || { totalSeconds: 0, recommendSeconds: 0, playerSeconds: 0 };
          localRecord.devices[deviceId] = {
            totalSeconds: Math.max(Number(localDevice.totalSeconds || 0), Number(remoteStats.totalSeconds || 0)),
            recommendSeconds: Math.max(Number(localDevice.recommendSeconds || 0), Number(remoteStats.recommendSeconds || 0)),
            playerSeconds: Math.max(Number(localDevice.playerSeconds || 0), Number(remoteStats.playerSeconds || 0)),
          };
        });
        localRecord.reminders = { ...(remoteRecord.reminders || {}), ...(localRecord.reminders || {}) };
        localRecord.reflections = mergeById(localRecord.reflections || [], remoteRecord.reflections || []);
      });
    }

    if (remote.profile && typeof remote.profile === "object") {
      state.profile.summary = state.profile.summary || remote.profile.summary || "";
      state.profile.positive = mergeCounts(state.profile.positive, remote.profile.positive);
      state.profile.negative = mergeCounts(state.profile.negative, remote.profile.negative);
      state.profile.notes = mergeById(state.profile.notes || [], remote.profile.notes || []).slice(0, 120);
      state.profile.aiSignals = unique([...(state.profile.aiSignals || []), ...(remote.profile.aiSignals || [])]);
    }
  }

  function mergeCounts(a = {}, b = {}) {
    const out = { ...a };
    Object.entries(b || {}).forEach(([key, value]) => {
      out[key] = Math.max(Number(out[key] || 0), Number(value || 0));
    });
    return out;
  }

  function mergeById(a = [], b = []) {
    const map = new Map();
    [...a, ...b].forEach((entry) => {
      if (!entry) return;
      const id = entry.id || `${entry.createdAt || ""}-${entry.text || entry.title || ""}`;
      map.set(id, { ...entry, id });
    });
    return [...map.values()].sort((x, y) => new Date(y.createdAt || 0) - new Date(x.createdAt || 0));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(syncPayload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `guiliu-backup-${todayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result || "{}"));
        mergeRemote(imported);
        persist("导入完成");
      } catch {
        setToast("导入失败");
        render();
      }
    };
    reader.readAsText(file);
  }

  function parseYoutubeId(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] || "";
      if (parsed.hostname.includes("youtube.com")) {
        if (parsed.pathname.startsWith("/embed/")) return parsed.pathname.split("/")[2] || "";
        return parsed.searchParams.get("v") || "";
      }
    } catch {
      return "";
    }
    return "";
  }

  function parseBilibiliId(url) {
    const match = url.match(/BV[a-zA-Z0-9]+/);
    return match ? match[0] : "";
  }

  function extractSignals(text) {
    const source = String(text || "");
    const upper = source.toUpperCase();
    const matched = SIGNAL_WORDS.filter((word) => {
      if (word === "AI") return upper.includes("AI");
      return source.includes(word);
    });
    return unique(matched).slice(0, 8);
  }

  function topSignals(counts = {}, limit = 5) {
    return Object.entries(counts || {})
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, limit)
      .map(([key]) => key);
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function normalizeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function extractUrl(text) {
    const match = String(text || "").match(/https?:\/\/[^\s]+/);
    return match ? match[0] : "";
  }

  function cleanupSharedText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function ratingLabel(value) {
    if (value === "interested") return "感兴趣";
    if (value === "not_interested") return "不感兴趣";
    if (value === "later") return "稍后看";
    return "";
  }

  function todayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Math.round(Number(seconds || 0)));
    const minutes = Math.floor(value / 60);
    if (minutes < 1) return `${value} 秒`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return `${minutes} 分钟`;
    return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  }

  function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
