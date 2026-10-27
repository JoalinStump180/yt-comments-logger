// ==UserScript==
// @name         Hash tab tester
// @namespace    hash-tab-tester
// @version      0.3
// @match        *://*/*
// @grant        none
// ==/UserScript==
(() => {
  "use strict";
  const DB_NAME = "hashTabTester";
  const STORE = "hashTexts";
  const POLICY_KEY = "hashTabPolicy";
  const DEFAULT_POLICY = [
    "youtube.com:",
    "  ytd-comment-view-model;#author-text:1,3-4;yt-attributed-string#content-text:1-2,5-6",
    "  ytd-backstage-post-renderer;#author-text:1;yt-formatted-string#content-text:1,3-4",
    "end",
    "othersite.com:",
    "  .comment;ti:\"User Said:\";ti:\"Chatgpt Said:\"",
    "end"
  ].join("\n");

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "hashKey" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function getRow(db, key) {
    return new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  function putRow(db, row) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  function cheapHash(text) {
    let h = 5381;
    const str = String(text || "");
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  }
  function siteName() {
    return location.hostname.replace(/^www\./, "");
  }
  function parseSlots(spec) {
    const slots = new Set();
    for (const part of String(spec || "").split(",")) {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) slots.add(n);
    }
    return slots;
  }
  function parseField(raw) {
    const s = String(raw || "").trim();
    const ti = s.match(/^ti:\s*["']([\s\S]*?)["']$/i);
    if (ti) return { kind: "ti", text: ti[1], slots: new Set([1]) };
    const m = s.match(/^(.*):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/);
    if (m) return { kind: "sel", sel: m[1].trim(), slots: parseSlots(m[2]) };
    return { kind: "sel", sel: s, slots: new Set([1]) };
  }
  function parsePolicies(text) {
    const blocks = [];
    let cur = null;
    for (const raw of String(text || "").split(/\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/^end$/i.test(line)) { if (cur) blocks.push(cur); cur = null; continue; }
      if (line.endsWith(":") && !line.includes(";")) {
        cur = { host: line.slice(0, -1).trim().replace(/^www\./, ""), lines: [] };
        continue;
      }
      if (!cur) continue;
      const parts = line.split(";").map((x) => x.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      cur.lines.push({ scope: parts[0], start: parseField(parts[1]), collect: parseField(parts[2]) });
    }
    if (cur) blocks.push(cur);
    return blocks;
  }
  function policiesForHere(text) {
    const host = siteName();
    return parsePolicies(text).filter((b) => host === b.host || host.endsWith("." + b.host));
  }
  function nodeBlob(el) {
    if (!el) return "";
    const attrs = [];
    for (const a of el.attributes || []) attrs.push(a.name + "=" + a.value);
    return (el.innerText || "") + "\n" + attrs.join("\n");
  }
  function matches(el, field) {
    if (!el || !field) return false;
    if (field.kind === "ti") return nodeBlob(el).includes(field.text);
    try { return el.matches(field.sel); } catch { return false; }
  }
  function allIn(scope, field) {
    if (field.kind === "ti") {
      const out = [];
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
      let n = walker.currentNode;
      while (n) {
        if (matches(n, field)) out.push(n);
        n = walker.nextNode();
      }
      return out;
    }
    try { return [...scope.querySelectorAll(field.sel)]; } catch { return []; }
  }
  function pickSlots(list, slots, seen) {
    const fresh = list.filter((el) => !seen.has(el));
    const picked = [];
    fresh.forEach((el, i) => {
      const slot = i + 1;
      if (!slots.has(slot)) return;
      seen.add(el);
      picked.push({ el, slot });
    });
    return picked;
  }
  function collect(policyText) {
    const site = siteName();
    const out = [];
    const seenKey = new Set();
    function push(author, slot, text) {
      const hashKey = site + "|" + author + "|" + slot + "|" + cheapHash(text);
      if (seenKey.has(hashKey)) return;
      seenKey.add(hashKey);
      out.push({ hashKey, site, author, slot, text, sourceUrl: location.href });
    }
    for (const block of policiesForHere(policyText)) {
      for (const rule of block.lines) {
        const seen = new Set();
        let scopes = [];
        try { scopes = document.querySelectorAll(rule.scope); } catch { continue; }
        for (const A of scopes) {
          if (rule.start.kind === "ti" && rule.collect.kind === "ti") {
            const starts = pickSlots(allIn(A, rule.start), rule.start.slots, seen);
            for (const st of starts) {
              push("ti", st.slot, (st.el.innerText || "").trim());
              const walker = document.createTreeWalker(A, NodeFilter.SHOW_ELEMENT);
              walker.currentNode = st.el;
              let n = walker.nextNode();
              while (n) {
                if (!seen.has(n) && matches(n, rule.collect)) {
                  seen.add(n);
                  push("ti", st.slot, (n.innerText || "").trim());
                  break;
                }
                n = walker.nextNode();
              }
            }
            continue;
          }
          const starts = pickSlots(allIn(A, rule.start), rule.start.slots, seen);
          for (const st of starts) {
            const href = st.el.getAttribute("href") || "";
            const handle = href.match(/\/@([\w.-]+)/);
            const author = handle ? "@" + handle[1] : ((st.el.innerText || "").trim().split("\n")[0] || "item");
            const hits = pickSlots(allIn(A, rule.collect), rule.collect.slots, seen);
            hits.forEach((hit) => push(author, hit.slot, (hit.el.innerText || "").trim()));
          }
        }
      }
    }
    return out;
  }

  const box = document.createElement("div");
  box.style.cssText = "position:fixed;top:72px;right:12px;z-index:2147483646;width:560px;max-height:80vh;overflow:auto;background:rgba(12,16,24,.72);color:#f2f2f2;font:12px/1.45 Consolas,monospace;padding:8px 10px;border:1px solid rgba(255,255,255,.25);border-radius:8px;";
  const bar = document.createElement("div");
  bar.textContent = "hash policy (drag)";
  bar.style.cssText = "cursor:move;margin-bottom:6px;font-weight:700;";
  const area = document.createElement("textarea");
  area.value = localStorage.getItem(POLICY_KEY) || DEFAULT_POLICY;
  area.style.cssText = "width:100%;height:140px;box-sizing:border-box;background:#111;color:#fff;border:1px solid #666;padding:4px 6px;font:inherit;";
  area.addEventListener("change", () => localStorage.setItem(POLICY_KEY, area.value));
  const colors = document.createElement("div");
  colors.style.cssText = "display:flex;gap:10px;align-items:center;margin:6px 0;";
  function colorPick(key, label, fallback) {
    const wrap = document.createElement("label");
    wrap.style.cssText = "display:flex;align-items:center;gap:4px;";
    wrap.appendChild(document.createTextNode(label));
    const input = document.createElement("input");
    input.type = "color";
    input.value = localStorage.getItem(key) || fallback;
    input.addEventListener("change", () => localStorage.setItem(key, input.value));
    wrap.appendChild(input);
    return input;
  }
  const newColor = colorPick("hashTabNewColor", "NEW", "#00ff00");
  const alreadyColor = colorPick("hashTabAlreadyColor", "ALREADY", "#ff0000");
  const keyColor = colorPick("hashTabKeyColor", "key", "#ffffff");
  colors.appendChild(newColor.parentElement);
  colors.appendChild(alreadyColor.parentElement);
  colors.appendChild(keyColor.parentElement);
  const pre = document.createElement("pre");
  pre.style.cssText = "margin:6px 0 0;white-space:pre-wrap;min-height:160px;";
  const logWrap = document.createElement("label");
  logWrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:0 0 6px;";
  const logBox = document.createElement("input");
  logBox.type = "checkbox";
  logBox.checked = localStorage.getItem("hashTabLog") !== "0";
  logBox.addEventListener("change", () => localStorage.setItem("hashTabLog", logBox.checked ? "1" : "0"));
  logWrap.appendChild(logBox);
  logWrap.appendChild(document.createTextNode("log to IndexedDB"));
  box.appendChild(bar);
  box.appendChild(area);
  box.appendChild(colors);
  box.appendChild(logWrap);
  box.appendChild(pre);
  document.documentElement.appendChild(box);
  let drag = false, dx = 0, dy = 0;
  bar.addEventListener("mousedown", (e) => { drag = true; dx = e.clientX - box.offsetLeft; dy = e.clientY - box.offsetTop; });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    box.style.left = (e.clientX - dx) + "px";
    box.style.top = (e.clientY - dy) + "px";
    box.style.right = "auto";
  });
  window.addEventListener("mouseup", () => { drag = false; });

  const shown = new Set();
  function logLine(kind, key, rest) {
    const line = document.createElement("div");
    const word = document.createElement("span");
    word.textContent = kind;
    word.style.color = kind === "NEW" ? newColor.value : alreadyColor.value;
    word.style.fontWeight = "700";
    const keySpan = document.createElement("span");
    keySpan.textContent = " " + key + " ";
    keySpan.style.color = keyColor.value;
    line.appendChild(word);
    line.appendChild(keySpan);
    line.appendChild(document.createTextNode(rest));
    pre.insertBefore(line, pre.firstChild);
    while (pre.childElementCount > 80) pre.removeChild(pre.lastChild);
  }

  async function tick() {
    const batch = collect(area.value);
    if (!batch.length) return;
    const db = await openDb();
    for (const row of batch) {
      if (shown.has(row.hashKey)) continue;
      shown.add(row.hashKey);
      const existing = await getRow(db, row.hashKey);
      const two = row.text.split(/\n/).slice(0, 2).join(" / ");
      if (existing) logLine("ALREADY", row.hashKey, new Date(existing.createdAt).toLocaleString() + " " + two);
      else if (logBox.checked) {
        await putRow(db, { ...row, createdAt: Date.now() });
        logLine("NEW", row.hashKey, two);
      } else {
        logLine("NEW", row.hashKey, "(not logged) " + two);
      }
    }
  }
  setInterval(() => { tick().catch((err) => logLine("ALREADY", "error", String(err))); }, 1000);
  logLine("NEW", siteName(), "hash tab tester ready");
})();
