
// Listen for any link clicks on the page
document.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (!link) return;

  // Grab the URL it points to (from href or a custom attribute)
  const targetUrl = link.href;
  const linkText = link.textContent.trim();

  // If it's one of your tracked/test links (or you want to log all links)
  if (targetUrl && targetUrl !== window.location.href) {
    console.log('[Content Script] Captured link click:', targetUrl);

    // Send the data to your background script
    chrome.runtime.sendMessage({
      type: 'logCustomHistory',
      url: targetUrl,
      title: `Clicked: ${linkText}`,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString()
    });
  }
});

 
window.addEventListener('page-title2', (e) => {

console.log('[Content.js page-title2 Received]:', e.detail.url, e.detail.title);
  // Step 2: Relay to background.js using extension APIs
  chrome.runtime.sendMessage({
    type: "page-title2",
    url: e.detail.url,
    title: e.detail.title
  });
});

window.addEventListener('logCustomHistory', (e) => {
  // 1. Show an alert box with the captured data
    console.log('[Content.js Received]:', e.detail.url, e.detail.title);
  alert(`[Content Script Caught It!]\nURL: ${e.detail.url}\nTitle: ${e.detail.title}`);

  // 2. Forward to your background script
  chrome.runtime.sendMessage({
    type: 'logCustomHistory',
    url: e.detail.url,
    title: e.detail.title,
    date: e.detail.date,
    time: e.detail.time
  }).catch(() => {});
});











// --- SPA / History Change Logger for Content Script ---
function bindHistoryLogger() {
  const notifyUrlChange = () => {
    const currentUrl = location.href;
    const currentTitle = document.title || currentUrl;
    console.log('[Content.js bindHistoryLogger notifyUrlChange Received]:', currentUrl, currentTitle);
     //alert(`[Content Script  bindHistoryLogger notifyUrlChange !]\nURL: ${currentUrl}\nTitle: ${currentTitle}`);      ---- this msgbox will be disp'd  when you clickk the browser ' s prev/next page button. 
    // Send to background service worker to record in IndexedDB
    chrome.runtime.sendMessage({
      type: "page-title2",
      url: currentUrl,
      title: currentTitle
    }).catch(() => {});
  };

  // 1. Monkey-patch pushState & replaceState
  const origPush = history.pushState;
  history.pushState = function (...args) {
    origPush.apply(this, args);
    notifyUrlChange();
  };

  const origReplace = history.replaceState;
  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    notifyUrlChange();
  };

  // 2. Listen to back/forward and hash changes
  window.addEventListener("popstate", notifyUrlChange);
  window.addEventListener("hashchange", notifyUrlChange);
}

// Initialize on page load
bindHistoryLogger();


function videoIdFromLocation() {
  try {
    const u = new URL(location.href);
    const host = u.hostname.replace(/^www\./, "");
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const parts = u.pathname.split("/").filter(Boolean);
    if (host === "youtu.be") return parts[0] || "";
    if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") return parts[1] || "";
  } catch {}
  return "";
}

function postIdFromLocation() {
  try {
    const u = new URL(location.href);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "post") return parts[1] || "";
  } catch {}
  return "";
}

function walk(obj, depth, bag) {
  if (!obj || depth > 5 || typeof obj !== "object") return;
  try {
    if (typeof obj.commentId === "string") bag.commentId = bag.commentId || obj.commentId;
    if (typeof obj.comment_id === "string") bag.commentId = bag.comment_id || obj.comment_id;
    if (typeof obj.channelId === "string" && obj.channelId.startsWith("UC")) bag.channelId = bag.channelId || obj.channelId;
    if (typeof obj.browseId === "string" && obj.browseId.startsWith("UC")) bag.channelId = bag.channelId || obj.browseId;
    if (typeof obj.authorText === "string") bag.author = bag.author || obj.authorText;
    if (obj.authorText && typeof obj.authorText.simpleText === "string") bag.author = bag.author || obj.authorText.simpleText;
    if (typeof obj.publishedTime === "string") bag.publishedTime = bag.publishedTime || obj.publishedTime;
    if (typeof obj.publishedTimeText === "string") bag.publishedTime = bag.publishedTime || obj.publishedTimeText;
    if (obj.publishedTimeText && typeof obj.publishedTimeText.simpleText === "string") {
      bag.publishedTime = bag.publishedTime || obj.publishedTimeText.simpleText;
    }
  } catch {}
  const keys = ["__data", "data", "polymerController", "comment", "commentViewModel", "properties", "author", "authorEndpoint", "browseEndpoint"];
  for (const k of keys) {
    try { if (obj[k]) walk(obj[k], depth + 1, bag); } catch {}
  }
}

function idFromHref(el) {
  const a = el.querySelector?.('a[href*="lc="]') || el.closest?.("ytd-comment-thread-renderer")?.querySelector('a[href*="lc="]');
  const href = a?.getAttribute("href") || "";
  const m = href.match(/[?&]lc=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function commentIdFromEl(el) {
  const bag = {};
  walk(el, 0, bag);
  return bag.commentId || idFromHref(el) || el.getAttribute?.("comment-id") || "";
}

function metaFromEl(el) {
  const bag = {};
  walk(el, 0, bag);
  const authorA =
    el.querySelector("#author-text") ||
    el.querySelector("a#author-text") ||
    el.querySelector("#author-name a") ||
    el.querySelector("#name a") ||
    el.querySelector('a[href*="/channel/"]') ||
    el.querySelector('a[href*="/@"]');
  const href = authorA?.getAttribute("href") || "";
  const uc = href.match(/\/channel\/(UC[\w-]+)/);
  const handle = href.match(/\/@([\w.-]+)/);
  const timeNode =
    el.querySelector("#published-time-text") ||
    el.querySelector("yt-formatted-string.published-time-text") ||
    el.querySelector("#header-author #published-time-text");
  return {
    author: (bag.author || authorFromEl(el) || authorA?.innerText || "").trim(),
    handle: handle ? "@" + handle[1] : "",
    channelId: bag.channelId || (uc ? uc[1] : ""),
    publishedTime: bag.publishedTime || (timeNode?.innerText || "").trim()
  };
}

function textFromEl(el) {
  const node =
    el.querySelector("#content-text") ||
    el.querySelector("#content-text yt-attributed-string") ||
    el.querySelector("yt-attributed-string") ||
    el.querySelector("#comment-content") ||
    el.querySelector("#content");
  return (node?.innerText || "").trim();
}

function authorFromEl(el) {
  const node =
    el.querySelector("#author-text") ||
    el.querySelector("#author-name") ||
    el.querySelector("a#author-text") ||
    el.querySelector("#name");
  return (node?.innerText || "").trim();
}

function fallbackId(videoId, author, text) {
  const s = `${videoId}|${author}|${text}`.slice(0, 400);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return "local-" + (h >>> 0).toString(16);
}

function permalinkParts(el) {
  const a = el.querySelector?.('a[href*="lc="]')
    || el.closest?.("ytd-comment-thread-renderer")?.querySelector('a[href*="lc="]');
  const href = a?.getAttribute("href") || "";
  const vMatch = href.match(/[?&]v=([^&]+)/);
  const lcMatch = href.match(/[?&]lc=([^&]+)/);
  return {
    videoId: vMatch ? vMatch[1] : "",
    commentId: lcMatch ? decodeURIComponent(lcMatch[1]) : ""
  };
}

const DIAGNOSTICS_KEY = "vulDiagnosticItems";
const DIAGNOSTIC_LOGGING_KEY = "vulDiagnosticLoggingEnabled";
const diagnosticSeen = new Set();
async function logDiagnosticItem(item) {
  try {
    const bag = await chrome.storage.local.get({ [DIAGNOSTIC_LOGGING_KEY]: true, [DIAGNOSTICS_KEY]: [] });
    if (bag[DIAGNOSTIC_LOGGING_KEY] === false) return;
    const fingerprint = [item.reason, item.sourceUrl, item.author, item.text].join("|").slice(0, 2000);
    if (diagnosticSeen.has(fingerprint)) return;
    diagnosticSeen.add(fingerprint);
    const items = Array.isArray(bag[DIAGNOSTICS_KEY]) ? bag[DIAGNOSTICS_KEY] : [];
    const existing = items.findIndex(x => x.fingerprint === fingerprint);
    const entry = { ...item, fingerprint, id: fingerprint, createdAt: Date.now() };
    if (existing >= 0) items[existing] = { ...items[existing], ...entry };
    else items.unshift(entry);
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: items.slice(0, 1000) });
  } catch (_) {}
}

function collectVisible() {
  const pageVideoId = videoIdFromLocation();
  const pagePostId = postIdFromLocation();
  const currentPageId = pageVideoId || pagePostId;

  if (!currentPageId) return [];

  const nodes = document.querySelectorAll(
    "ytd-comment-view-model, ytd-comment-renderer, ytd-comment-thread-renderer"
  );
  const out = [];
  const seen = new Set();

  for (const el of nodes) {
    const unit = el.tagName === "YTD-COMMENT-THREAD-RENDERER"
      ? (el.querySelector("ytd-comment-view-model, ytd-comment-renderer") || el)
      : el;
    const text = textFromEl(unit) || textFromEl(el);
    if (!text) continue;

    const link = permalinkParts(unit);
    const link2 = link.videoId ? link : permalinkParts(el);
    const targetId = link2.videoId || currentPageId;

    const meta = Object.assign(metaFromEl(el), metaFromEl(unit));
    const author = meta.author || authorFromEl(unit) || authorFromEl(el);
    let commentId = link2.commentId || commentIdFromEl(unit) || commentIdFromEl(el);
    if (!commentId) {
      logDiagnosticItem({
        reason: "Missing usable comment ID in associated href/DOM metadata",
        author, text, sourceUrl: location.href,
        candidateHrefs: [...new Set([...unit.querySelectorAll("a[href]"), ...el.querySelectorAll("a[href]")].map(a => a.href).filter(Boolean))].slice(0, 12),
        parentId: targetId
      });
      continue;
    }
    if (!targetId) {
      logDiagnosticItem({ reason: "Missing parent post/video ID", author, text, sourceUrl: location.href, candidateHrefs: [] });
      continue;
    }

    if (seen.has(targetId + "|" + commentId)) continue;
    seen.add(targetId + "|" + commentId);

    out.push({
      videoId: targetId,
      commentId,
      author,
      handle: meta.handle || (author.startsWith("@") ? author : ""),
      channelId: meta.channelId || "",
      publishedTime: meta.publishedTime || "",
      text,
      sourceUrl: location.href,
      pageVideoId: currentPageId
    });
  }
  return out;
}

const DEFAULT_COMMENT_HASH_POLICY = [
  "youtube.com:",
  "  ytd-comment-view-model;#author-text:1,3-4;yt-attributed-string#content-text:1-2,5-6",
  "  ytd-backstage-post-renderer;#author-text:1;yt-formatted-string#content-text:1,3-4",
  "end",
  "othersite.com:",
  "  .comment;ti:\"User Said:\";ti:\"Chatgpt Said:\"",
  "end"
].join("\n");

const shownIds = new Set();
let overlay;
let overlayEnabled = true;
let overlayPolicyArea = null;
let overlayLogBox = null;
let overlayPre = null;
let overlayNewColor = null;
let overlayAlreadyColor = null;
let overlayKeyColor = null;
let overlayLoggingEnabled = true;
const OVERLAY_POLICY_KEY = "vulCommentHashPolicy";
const OVERLAY_LOGGING_KEY = "vulHashLoggingEnabled";

function persistOverlayColor(key, value) {
  try { chrome.storage.local.set({ [key]: value }); } catch (_) {}
}

function applyOverlayVisibility() {
  if (!overlayEnabled) {
    if (overlay && overlay.isConnected) overlay.style.display = "none";
    return;
  }
  const box = ensureOverlay();
  box.style.display = "flex";
}

function makeOverlayColor(label, storageKey, fallback) {
  const wrap = document.createElement("label");
  wrap.style.cssText = "display:flex;align-items:center;gap:4px;white-space:nowrap;";
  wrap.appendChild(document.createTextNode(label));
  const input = document.createElement("input");
  input.type = "color";
  input.value = fallback;
  input.style.cssText = "width:25px;height:20px;padding:0;border:0;background:transparent;cursor:pointer;";
  input.addEventListener("change", () => persistOverlayColor(storageKey, input.value));
  wrap.appendChild(input);
  return { wrap, input, storageKey };
}

function ensureOverlay() {
  if (overlay && overlay.isConnected) return overlay;
  overlay = document.getElementById("vul-debug-overlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "vul-debug-overlay";
  overlay.style.cssText = [
    "position:fixed", "right:12px", "bottom:12px", "width:560px", "max-width:calc(100vw - 24px)",
    "max-height:80vh", "z-index:2147483647", "display:flex", "flex-direction:column", "gap:6px",
    "overflow:hidden", "pointer-events:auto", "background:rgba(12,16,24,.78)", "color:#f2f2f2",
    "font:12px/1.4 Consolas,Segoe UI,sans-serif", "padding:8px 10px", "border:1px solid rgba(255,255,255,.28)",
    "border-radius:8px", "box-shadow:0 2px 12px rgba(0,0,0,.25)", "backdrop-filter:blur(2px)"
  ].join(";");

  const bar = document.createElement("div");
  bar.textContent = "Comment hash / realtime logger  (drag here)";
  bar.style.cssText = "cursor:move;font-weight:700;user-select:none;padding:2px 0;";
  overlay.appendChild(bar);

  const policyLabel = document.createElement("div");
  policyLabel.textContent = "Ruleset (shared with Visit URL Logger Config…)";
  policyLabel.style.cssText = "font-weight:600;";
  overlay.appendChild(policyLabel);

  overlayPolicyArea = document.createElement("textarea");
  overlayPolicyArea.value = DEFAULT_COMMENT_HASH_POLICY;
  overlayPolicyArea.setAttribute("aria-label", "Shared comment extraction ruleset");
  overlayPolicyArea.style.cssText = "width:100%;height:112px;min-height:70px;box-sizing:border-box;resize:vertical;background:#111;color:#fff;border:1px solid #666;border-radius:4px;padding:5px 6px;font:inherit;white-space:pre;";
  const savePolicy = () => {
    const policy = overlayPolicyArea.value.trim() || DEFAULT_COMMENT_HASH_POLICY;
    chrome.storage.local.set({ [OVERLAY_POLICY_KEY]: policy }).catch(() => {});
  };
  overlayPolicyArea.addEventListener("change", savePolicy);
  overlayPolicyArea.addEventListener("blur", savePolicy);
  overlay.appendChild(overlayPolicyArea);

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;";
  const newColor = makeOverlayColor("NEW", "vulHashNewColor", "#00ff00");
  const alreadyColor = makeOverlayColor("ALREADY", "vulHashAlreadyColor", "#ff0000");
  const keyColor = makeOverlayColor("UID", "vulHashKeyColor", "#ffffff");
  overlayNewColor = newColor.input;
  overlayAlreadyColor = alreadyColor.input;
  overlayKeyColor = keyColor.input;
  controls.append(newColor.wrap, alreadyColor.wrap, keyColor.wrap);

  const logWrap = document.createElement("label");
  logWrap.style.cssText = "display:flex;align-items:center;gap:5px;margin-left:auto;white-space:nowrap;";
  overlayLogBox = document.createElement("input");
  overlayLogBox.type = "checkbox";
  overlayLogBox.checked = true;
  overlayLogBox.addEventListener("change", () => {
    overlayLoggingEnabled = overlayLogBox.checked;
    chrome.storage.local.set({ [OVERLAY_LOGGING_KEY]: overlayLoggingEnabled }).catch(() => {});
  });
  logWrap.append(overlayLogBox, document.createTextNode("Log extracted items"));
  controls.appendChild(logWrap);
  overlay.appendChild(controls);

  overlayPre = document.createElement("div");
  overlayPre.style.cssText = "margin-top:2px;overflow:auto;min-height:90px;max-height:34vh;white-space:pre-wrap;word-break:break-word;border-top:1px solid rgba(255,255,255,.2);padding-top:5px;";
  overlay.appendChild(overlayPre);

  let drag = false, dx = 0, dy = 0;
  bar.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    drag = true;
    const rect = overlay.getBoundingClientRect();
    dx = e.clientX - rect.left; dy = e.clientY - rect.top;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    overlay.style.left = Math.max(0, e.clientX - dx) + "px";
    overlay.style.top = Math.max(0, e.clientY - dy) + "px";
    overlay.style.right = "auto"; overlay.style.bottom = "auto";
  });
  window.addEventListener("mouseup", () => { drag = false; });

  chrome.storage.local.get({
    [OVERLAY_POLICY_KEY]: DEFAULT_COMMENT_HASH_POLICY,
    [OVERLAY_LOGGING_KEY]: true,
    vulHashNewColor: "#00ff00", vulHashAlreadyColor: "#ff0000", vulHashKeyColor: "#ffffff"
  }).then((bag) => {
    if (overlayPolicyArea && document.activeElement !== overlayPolicyArea) overlayPolicyArea.value = bag[OVERLAY_POLICY_KEY] || DEFAULT_COMMENT_HASH_POLICY;
    overlayLoggingEnabled = bag[OVERLAY_LOGGING_KEY] !== false;
    if (overlayLogBox) overlayLogBox.checked = overlayLoggingEnabled;
    if (overlayNewColor) overlayNewColor.value = bag.vulHashNewColor;
    if (overlayAlreadyColor) overlayAlreadyColor.value = bag.vulHashAlreadyColor;
    if (overlayKeyColor) overlayKeyColor.value = bag.vulHashKeyColor;
  }).catch(() => {});

  (document.documentElement || document.body).appendChild(overlay);
  if (!overlayEnabled) overlay.style.display = "none";
  return overlay;
}

function rollLine(kind, uid, author, text, sourceUrl, itemType, logged = true) {
  if (!overlayEnabled) return;
  const box = ensureOverlay();
  box.style.display = "flex";
  const line = document.createElement("div");
  line.style.cssText = "margin:0 0 7px;padding:4px 5px;border-bottom:1px solid rgba(255,255,255,.12);";
  const status = document.createElement("span");
  status.textContent = kind;
  status.style.cssText = "font-weight:700;color:" + (kind === "ALREADY" ? (overlayAlreadyColor?.value || "#ff0000") : (overlayNewColor?.value || "#00ff00")) + ";";
  line.appendChild(status);
  const label = document.createElement("span");
  label.style.cssText = "font-weight:700;margin-left:5px;";
  label.textContent = itemType === "uploader-post" ? "[uploader post] " : "";
  line.appendChild(label);
  const who = document.createElement("span");
  who.textContent = (author || "unknown") + "  ";
  line.appendChild(who);
  const key = document.createElement("div");
  key.style.cssText = "color:" + (overlayKeyColor?.value || "#fff") + ";font-size:11px;opacity:.9;";
  key.textContent = uid + (logged ? "" : " (not logged)");
  line.appendChild(key);
  const body = document.createElement("div");
  body.textContent = String(text || "").replace(/\s+/g, " ").slice(0, 500);
  body.style.marginTop = "2px";
  line.appendChild(body);
  if (sourceUrl) {
    const source = document.createElement("div");
    source.textContent = sourceUrl;
    source.style.cssText = "font-size:10px;opacity:.7;overflow-wrap:anywhere;margin-top:2px;";
    line.appendChild(source);
  }
  overlayPre?.insertBefore(line, overlayPre.firstChild);
  while (overlayPre && overlayPre.childElementCount > 80) overlayPre.removeChild(overlayPre.lastChild);
}

chrome.storage.local.get({ showCommentsOverlay: true }).then((bag) => {
  overlayEnabled = bag.showCommentsOverlay !== false;
  applyOverlayVisibility();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.showCommentsOverlay) {
    overlayEnabled = changes.showCommentsOverlay.newValue !== false;
    applyOverlayVisibility();
  }
  if (changes[OVERLAY_POLICY_KEY] && overlayPolicyArea && document.activeElement !== overlayPolicyArea) {
    overlayPolicyArea.value = String(changes[OVERLAY_POLICY_KEY].newValue || DEFAULT_COMMENT_HASH_POLICY);
  }
  if (changes[OVERLAY_LOGGING_KEY]) {
    overlayLoggingEnabled = changes[OVERLAY_LOGGING_KEY].newValue !== false;
    if (overlayLogBox) overlayLogBox.checked = overlayLoggingEnabled;
  }
  if (changes.vulHashNewColor && overlayNewColor) overlayNewColor.value = changes.vulHashNewColor.newValue || "#00ff00";
  if (changes.vulHashAlreadyColor && overlayAlreadyColor) overlayAlreadyColor.value = changes.vulHashAlreadyColor.newValue || "#ff0000";
  if (changes.vulHashKeyColor && overlayKeyColor) overlayKeyColor.value = changes.vulHashKeyColor.newValue || "#ffffff";
});

let flushTimer = null;
function scheduleFlush(delay = 200) {
  const waitMs = typeof delay === "number" ? delay : 200;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    const bag = await chrome.storage.local.get({
      commentsLogging: false,
      showCommentsOverlay: true
    });
    overlayEnabled = bag.showCommentsOverlay !== false;
    applyOverlayVisibility();
    if (!bag.commentsLogging && !overlayEnabled) return;
    const batch = collectVisible();
    if (!batch.length) return;
    const pageContext = videoIdFromLocation() || postIdFromLocation();
    const fresh = batch.filter((c) => !shownIds.has(c.videoId + "|" + c.commentId));
    if (overlayEnabled) {
      for (const c of fresh) {
        if (c.videoId === pageContext) shownIds.add(c.videoId + "|" + c.commentId);
      }
    }
    if (!bag.commentsLogging) return;
    chrome.runtime.sendMessage({ type: "yt-comments", batch }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.off) return;
      if (!overlayEnabled) {
        for (const c of fresh) shownIds.add(c.videoId + "|" + c.commentId);
      }
    });
  }, waitMs);
}

 //const obs = new MutationObserver(scheduleFlush);
// obs.observe(document.body, { childList: true, subtree: true });
 
 
 
 
function arm() {
  obs.disconnect();
  obs.observe(document.body, { childList: true, subtree: true });
  scheduleFlush(100);
}

if (0) document.addEventListener("yt-navigate-start", () => {
  obs.disconnect();
  clearTimeout(flushTimer);
});

if (0) document.addEventListener("yt-navigate-finish", () => {
  arm();
  setTimeout(() => scheduleFlush(100), 500);
  setTimeout(() => scheduleFlush(100), 1500);
});

if (0) window.addEventListener("scroll", () => scheduleFlush(300), { passive: true });
if (0) window.addEventListener("load", arm);
//setInterval(scheduleFlush, 500);
setInterval(scheduleFlush, 500);

// --- comment-hash-tag extraction: URL-derived UID, not text hash ---
(() => {
  "use strict";
  const POLICY_KEY = "vulCommentHashPolicy";
  const DIAG_KEY = "vulDiagnosticItems";
  const DIAG_ON_KEY = "vulDiagnosticLoggingEnabled";
  const DEFAULT_POLICY = [
    "youtube.com:",
    "  ytd-comment-view-model;#author-text:1,3-4;yt-attributed-string#content-text:1-2,5-6",
    "  ytd-backstage-post-renderer;#author-text:1;yt-formatted-string#content-text:1,3-4",
    "end",
    "othersite.com:",
    "  .comment;ti:\"User Said:\";ti:\"Chatgpt Said:\"",
    "end"
  ].join("\n");
  let policyText = DEFAULT_POLICY;
  let diagnosticEnabled = true;
  const sent = new Set();
  const diagnosed = new Set();
  let diagnosticWriteQueue = Promise.resolve();

  function siteName() { return location.hostname.replace(/^www\./, ""); }
  function parseSlots(spec) {
    const slots = new Set();
    for (const part of String(spec || "").split(",")) {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      for (let n = Math.min(a,b); n <= Math.max(a,b); n++) slots.add(n);
    }
    return slots;
  }
  function parseField(raw) {
    const v = String(raw || "").trim();
    const ti = v.match(/^ti:\s*["']([\s\S]*?)["']$/i);
    if (ti) return { kind: "ti", text: ti[1], slots: new Set([1]) };
    const m = v.match(/^(.*):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/);
    if (m) return { kind: "sel", sel: m[1].trim(), slots: parseSlots(m[2]) };
    return { kind: "sel", sel: v, slots: new Set([1]) };
  }
  function parsePolicies(text) {
    const blocks = []; let cur = null;
    for (const raw of String(text || "").split(/\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/^end$/i.test(line)) { if (cur) blocks.push(cur); cur = null; continue; }
      if (line.endsWith(":") && !line.includes(";")) {
        cur = { host: line.slice(0,-1).trim().replace(/^www\./,""), lines: [] }; continue;
      }
      if (!cur) continue;
      const parts = line.split(";").map(x => x.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      cur.lines.push({ scope: parts[0], start: parseField(parts[1]), collect: parseField(parts[2]) });
    }
    if (cur) blocks.push(cur);
    return blocks;
  }
  function matches(el, field) {
    if (!el || !field) return false;
    if (field.kind === "ti") {
      let n = el;
      while (n && n.nodeType === 1) {
        const blob = (n.innerText || "") + "\n" + [...(n.attributes || [])].map(a => a.name + "=" + a.value).join("\n");
        if (blob.includes(field.text)) return true;
        n = n.parentElement;
      }
      return false;
    }
    try { return el.matches(field.sel); } catch { return false; }
  }
  function allIn(scope, field) {
    if (field.kind === "ti") {
      const out = [], walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
      let n = walker.currentNode;
      while (n) { if (matches(n, field)) out.push(n); n = walker.nextNode(); }
      return out;
    }
    try { return [...scope.querySelectorAll(field.sel)]; } catch { return []; }
  }
  function pickSlots(list, slots) {
    return list.map((el, i) => ({el, slot:i+1})).filter(x => slots.has(x.slot));
  }
  function pageParentId(raw) {
    try {
      const u = new URL(raw, location.href), host = u.hostname.replace(/^www\./, "");
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const parts = u.pathname.split("/").filter(Boolean);
      if (host === "youtu.be") return parts[0] || "";
      if (["post","shorts","embed","live"].includes(parts[0])) return parts[1] || "";
    } catch {}
    return "";
  }
  function uidFromAssociatedHref(textEl, scope, itemType) {
    // Unified URL/UID routine: comments need lc=; uploader posts need only a reliable post ID.
    const anchors = [...new Set([...(scope.querySelectorAll?.("a[href]") || [])])];
    const parsed = [];
    for (const a of anchors) {
      const raw = a.getAttribute("href") || "";
      if (!raw) continue;
      try {
        const url = new URL(raw, location.href);
        parsed.push({ anchor: a, url, href: url.href, parentId: pageParentId(url.href), lc: url.searchParams.get("lc") || "" });
      } catch {}
    }

    if (itemType === "uploader-post") {
      // Prefer an actual /post/<id> link inside this post scope; otherwise use the page's own post URL.
      const postLink = parsed.find(x => {
        const u = x.url;
        return /(^|\/)post\/[^/]+/.test(u.pathname) && x.parentId;
      });
      const parentId = postLink?.parentId || postIdFromLocation();
      if (parentId) return { parentId, commentId: "__post__", itemType, href: postLink?.href || location.href };
      return null;
    }

    // For comments, take lc only from a link physically associated with this matched item.
    for (const candidate of parsed) {
      if (!candidate.lc) continue;
      const parentId = candidate.parentId || pageParentId(location.href);
      if (parentId) return { parentId, commentId: candidate.lc, itemType: "comment", href: candidate.href };
    }
    return null;
  }
  function authorFrom(el) {
    const a = el.matches?.('a[href*="/@"]') ? el : el.querySelector?.('a[href*="/@"], #author-text, a#author-text, #author-name a');
    const href = a?.getAttribute("href") || "";
    const m = href.match(/\/@([\w.-]+)/);
    return m ? "@" + m[1] : ((a?.innerText || el.innerText || "").trim().split("\n")[0] || "unknown");
  }
  function addDiagnostic(item) {
    if (!diagnosticEnabled) return;
    const key = [item.reason, item.sourceUrl, item.text, ...(item.candidateHrefs || [])].join("|");
    if (diagnosed.has(key)) return;
    diagnosed.add(key);
    diagnosticWriteQueue = diagnosticWriteQueue.then(async () => {
      const bag = await chrome.storage.local.get({ [DIAG_KEY]: [] });
      const list = Array.isArray(bag[DIAG_KEY]) ? bag[DIAG_KEY] : [];
      list.unshift({ ...item, createdAt: Date.now() });
      await chrome.storage.local.set({ [DIAG_KEY]: list.slice(0, 500) });
    }).catch(() => {});
  }
  function collectByPolicy() {
    const host = siteName(), groups = new Map(), diagnosedItems = new Set();
    for (const block of parsePolicies(policyText)) {
      if (!(host === block.host || host.endsWith("." + block.host))) continue;
      for (const rule of block.lines) {
        let scopes = [];
        try { scopes = [...document.querySelectorAll(rule.scope)]; } catch { continue; }
        const itemType = /ytd-backstage-post-renderer/i.test(rule.scope) ? "uploader-post" : "comment";
        for (const scope of scopes) {
          const starts = pickSlots(allIn(scope, rule.start), rule.start.slots);
          const texts = pickSlots(allIn(scope, rule.collect), rule.collect.slots);
          for (const st of starts) {
            const author = authorFrom(st.el);
            for (const hit of texts) {
              const text = String(hit.el.innerText || "").trim();
              if (!text) continue;
              const uid = uidFromAssociatedHref(hit.el, scope, itemType);
              if (!uid) {
                const diagnosticKey = rule.scope + "|" + st.slot + "|" + hit.slot + "|" + text;
                if (diagnosedItems.has(diagnosticKey)) continue;
                diagnosedItems.add(diagnosticKey);
                const hrefs = [...scope.querySelectorAll('a[href]')].map(a => a.href).filter(Boolean).slice(0, 20);
                addDiagnostic({ reason: itemType === "uploader-post" ? "Could not resolve uploader post ID (need a /post/<id> URL or a current /post/<id> page)" : "Could not resolve comment UID (need an associated lc= link and parent ID)", itemType, author, text, sourceUrl: location.href, scopeSelector: rule.scope, startSelector: rule.start.sel || ("ti:" + rule.start.text), textSelector: rule.collect.sel || ("ti:" + rule.collect.text), candidateHrefs: hrefs });
                continue;
              }
              const key = uid.parentId + "|" + uid.commentId;
              let row = groups.get(key);
              if (!row) {
                row = { videoId: uid.parentId, commentId: uid.commentId, itemType: uid.itemType, author, handle: author.startsWith("@") ? author : "", channelId: "", publishedTime: "", sourceUrl: uid.href || location.href, pageVideoId: pageParentId(location.href), uid: key, textParts: [] };
                groups.set(key, row);
              }
              if (!row.textParts.includes(text)) row.textParts.push(text);
            }
          }
        }
      }
    }
    return [...groups.values()].map(row => ({ ...row, text: row.textParts.join("\n"), textParts: undefined })).filter(row => !sent.has(row.uid));
  }
  let timer = null;
  async function tick() {
    if (!/^www\.youtube\.com$|^youtube\.com$|^m\.youtube\.com$|^music\.youtube\.com$/.test(location.hostname)) return;
    const batch = collectByPolicy().filter(row => !sent.has(row.uid));
    if (!batch.length) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "yt-hash-texts", batch });
      if (!response || response.ok !== true) throw new Error(response?.error || "Background did not confirm extraction storage status");
      const statuses = Array.isArray(response.statuses) ? response.statuses : [];
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const result = statuses[i] || { status: "new-unlogged", logged: false };
        sent.add(row.uid);
        const kind = result.status === "already" ? "ALREADY" : "NEW";
        rollLine(kind, row.uid, row.author, row.text, row.sourceUrl, row.itemType, result.logged !== false);
      }
    } catch (err) {
      for (const row of batch) addDiagnostic({ reason: "Could not send extracted item to background: " + String(err), itemType: row.itemType, author: row.author, text: row.text, sourceUrl: row.sourceUrl, candidateHrefs: [] });
    }
  }
  chrome.storage.local.get({ [POLICY_KEY]: DEFAULT_POLICY, [DIAG_ON_KEY]: true }).then(bag => {
    policyText = typeof bag[POLICY_KEY] === "string" ? bag[POLICY_KEY] : DEFAULT_POLICY;
    diagnosticEnabled = bag[DIAG_ON_KEY] !== false;
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[POLICY_KEY]) policyText = String(changes[POLICY_KEY].newValue || DEFAULT_POLICY);
    if (changes[DIAG_ON_KEY]) diagnosticEnabled = changes[DIAG_ON_KEY].newValue !== false;
  });
  timer = setInterval(() => tick().catch(err => addDiagnostic({ reason: "Extraction error: " + String(err), text: "", sourceUrl: location.href, candidateHrefs: [] })), 1000);
})();
