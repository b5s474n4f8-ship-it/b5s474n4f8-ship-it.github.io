const fields = ["supabaseUrl", "supabaseAnonKey", "ingestToken"];
const statusEl = document.getElementById("status");

init();

document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("collect").addEventListener("click", collectCurrentPage);

async function init() {
  const saved = await chrome.storage.local.get(fields);
  fields.forEach((name) => {
    document.getElementById(name).value = saved[name] || "";
  });
}

async function saveSettings() {
  const data = readSettings();
  await chrome.storage.local.set(data);
  setStatus("已保存。打开 YouTube/B站页面后点击采集。");
}

async function collectCurrentPage() {
  const settings = readSettings();
  if (!settings.supabaseUrl || !settings.supabaseAnonKey || !settings.ingestToken) {
    setStatus("先填写 Supabase URL、key 和归流采集码。");
    return;
  }
  await chrome.storage.local.set(settings);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return setStatus("没有找到当前标签页。");
  if (!/^https:\/\/([^/]+\.)?(youtube\.com|youtu\.be|bilibili\.com|b23\.tv)/.test(tab.url || "")) {
    setStatus("请先打开 YouTube 或 B站页面。");
    return;
  }

  setStatus("正在读取当前页面...");
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "GUILIU_COLLECT" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    response = await chrome.tabs.sendMessage(tab.id, { type: "GUILIU_COLLECT" });
  }

  const cards = response?.cards || [];
  if (!cards.length) return setStatus("当前页面没有识别到视频卡片。先滚动一下，再试一次。");
  setStatus(`识别到 ${cards.length} 条，正在写入归流...`);

  try {
    const endpoint = `${settings.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/guiliu_ingest_cards`;
    const result = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: settings.supabaseAnonKey,
        Authorization: `Bearer ${settings.supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: settings.ingestToken, cards }),
    });
    const text = await result.text();
    if (!result.ok) throw new Error(text);
    setStatus(`完成：${cards.length} 条视频已送到归流。`);
  } catch (error) {
    setStatus(`写入失败：${String(error.message || error).slice(0, 120)}`);
  }
}

function readSettings() {
  return Object.fromEntries(fields.map((name) => [name, document.getElementById(name).value.trim()]));
}

function setStatus(text) {
  statusEl.textContent = text;
}
