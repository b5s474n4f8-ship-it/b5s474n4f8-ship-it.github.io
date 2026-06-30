(() => {
  if (window.__guiliuCollectorLoaded) return;
  window.__guiliuCollectorLoaded = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "GUILIU_COLLECT") return;
    try {
      sendResponse({ cards: collectCards() });
    } catch (error) {
      sendResponse({ cards: [], error: String(error.message || error) });
    }
    return true;
  });

  function collectCards() {
    const platform = detectPlatform();
    const sourceType = detectSourceType(platform);
    const cards = platform === "youtube" ? collectYouTube(sourceType) : collectBilibili(sourceType);
    const map = new Map();
    cards.forEach((card) => {
      if (!card.url || !card.title) return;
      const key = `${card.platform}:${card.videoKey || card.url}`;
      if (!map.has(key)) map.set(key, card);
    });
    return [...map.values()].slice(0, 80);
  }

  function collectYouTube(sourceType) {
    const selectors = [
      "ytd-rich-item-renderer",
      "ytd-video-renderer",
      "ytd-grid-video-renderer",
      "ytd-compact-video-renderer",
      "ytd-reel-item-renderer",
    ];
    return selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((node) => youtubeCard(node, sourceType))).filter(Boolean);
  }

  function youtubeCard(node, sourceType) {
    const link = node.querySelector("a#video-title-link, a#video-title, h3 a[href*='watch'], a[href*='/shorts/']");
    const href = absolute(link?.getAttribute("href") || "");
    if (!href || !/(watch\?v=|\/shorts\/)/.test(href)) return null;
    const title = clean(link?.textContent || link?.getAttribute("title") || node.querySelector("#video-title")?.textContent);
    const channel = clean(node.querySelector("ytd-channel-name a, #channel-name a, .ytd-channel-name a")?.textContent || node.querySelector("#channel-name")?.textContent);
    const img = node.querySelector("img");
    const thumb = imageUrl(img);
    const duration = clean(node.querySelector("ytd-thumbnail-overlay-time-status-renderer span, .ytd-thumbnail-overlay-time-status-renderer span")?.textContent);
    const meta = [...node.querySelectorAll("#metadata-line span")].map((el) => clean(el.textContent)).filter(Boolean);
    return normalize({
      platform: "youtube",
      sourceType,
      title,
      channelName: channel || "YouTube",
      thumbnailUrl: thumb,
      durationText: duration,
      viewCountText: meta[0] || "",
      publishedText: meta[1] || "",
      url: href,
    });
  }

  function collectBilibili(sourceType) {
    const anchors = [...document.querySelectorAll("a[href*='/video/BV'], a[href*='bilibili.com/video/BV']")];
    return anchors.map((a) => bilibiliCard(a, sourceType)).filter(Boolean);
  }

  function bilibiliCard(anchor, sourceType) {
    const root = anchor.closest(".bili-video-card, .bili-video-card__wrap, .video-card, .feed-card, .small-item, .video-page-card-small, li, article, div") || anchor;
    const href = absolute(anchor.getAttribute("href") || "");
    const title = clean(anchor.getAttribute("title") || anchor.textContent || root.querySelector("[title]")?.getAttribute("title") || root.querySelector(".bili-video-card__info--tit, .title")?.textContent);
    if (!href || !title || !/BV[a-zA-Z0-9]+/.test(href)) return null;
    const img = root.querySelector("img");
    const channel = clean(root.querySelector(".bili-video-card__info--author, .up-name, .name, .author, [class*='author']")?.textContent);
    const duration = clean(root.querySelector(".bili-video-card__stats__duration, .duration, [class*='duration']")?.textContent);
    const stats = clean(root.querySelector(".bili-video-card__stats, .video-stat, [class*='stats']")?.textContent);
    return normalize({
      platform: "bilibili",
      sourceType,
      title,
      channelName: channel || "B站",
      thumbnailUrl: imageUrl(img),
      durationText: duration,
      viewCountText: stats,
      publishedText: "",
      url: href,
    });
  }

  function normalize(card) {
    const videoKey = card.platform === "youtube" ? youtubeId(card.url) : bvid(card.url);
    return {
      platform: card.platform,
      sourceType: card.sourceType,
      videoKey,
      title: clean(card.title),
      channelName: clean(card.channelName),
      channelKey: clean(card.channelName),
      thumbnailUrl: card.thumbnailUrl || "",
      durationText: clean(card.durationText),
      publishedText: clean(card.publishedText),
      viewCountText: clean(card.viewCountText),
      url: card.url,
      embedUrl: embedUrl(card.platform, videoKey),
      capturedAt: new Date().toISOString(),
    };
  }

  function detectPlatform() {
    return location.hostname.includes("bilibili") || location.hostname.includes("b23.tv") ? "bilibili" : "youtube";
  }

  function detectSourceType(platform) {
    const text = `${location.pathname} ${document.title}`.toLowerCase();
    if (platform === "youtube") {
      if (text.includes("feed/subscriptions")) return "subscription";
      if (/^\/$/.test(location.pathname)) return "platform_recommendation";
      if (/^\/(channel|c|user)\//.test(location.pathname) || location.pathname.startsWith("/@")) return "channel";
      return "platform_recommendation";
    }
    if (text.includes("dynamic") || text.includes("关注") || text.includes("following")) return "subscription";
    if (text.includes("space.bilibili") || text.includes("/channel/")) return "channel";
    return "platform_recommendation";
  }

  function absolute(href) {
    try { return new URL(href, location.href).toString(); } catch { return ""; }
  }

  function imageUrl(img) {
    if (!img) return "";
    const raw = img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "";
    if (!raw) return "";
    if (raw.startsWith("//")) return `https:${raw}`;
    return absolute(raw);
  }

  function youtubeId(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] || "";
      if (parsed.pathname.includes("/shorts/")) return parsed.pathname.split("/shorts/")[1]?.split("/")[0] || "";
      return parsed.searchParams.get("v") || "";
    } catch { return ""; }
  }

  function bvid(url) {
    return String(url || "").match(/BV[a-zA-Z0-9]+/)?.[0] || "";
  }

  function embedUrl(platform, videoKey) {
    if (platform === "youtube" && videoKey) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoKey)}?rel=0&modestbranding=1&playsinline=1`;
    if (platform === "bilibili" && videoKey) return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(videoKey)}&page=1&high_quality=1&autoplay=0`;
    return "";
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
})();
