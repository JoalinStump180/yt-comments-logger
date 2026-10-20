const $ = (id) => document.getElementById(id);
    let rows = [];
    let filter = "all";
    let selectedId = null;

    function pad(n) { return String(n).padStart(2, "0"); }
    function setNow() {
      const d = new Date();
      $("date").value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      $("time").value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    let includeComments = false;
    let dedupeCommentId = false;
    const firstRowByCommentId = new Map();
    const openVideos = new Set();
    const commentsByVideo = new Map();
    const recycledByVideo = new Map();
    const selectedComments = new Set();
    const selectedRows = new Set();
    
    
function videoIdFromStoredUrl(url) {
  const s = String(url || "");

  // watch?v=ID or &v=ID, id is 11 chars but accept the usual safe set
  const v = s.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (v) return v[1];

  // youtu.be/ID
  const short = s.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (short) return short[1];

  // /post/ID /shorts/ID /embed/ID /live/ID
  const path = s.match(/\/(?:post|shorts|embed|live)\/([A-Za-z0-9_-]{6,})/);
  if (path) return path[1];

  return "";
}
function videoIdFromStoredUrl2(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "post" || parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") {
      return parts[1] || "";
    }
    return "";
  } catch {
    return "";
  }
}

    async function withStore(mode, fn) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      });
    }

    function normUrl(u) {
      return String(u || "").trim().replace(/\/+$/, "").toLowerCase();
    }
    function normComment(c) {
      return String(c || "").trim().replace(/\s+/g, " ");
    }
    async function pairExists(url, comments) {
      const u = normUrl(url);
      const c = normComment(comments);
      const all = await getAll();
      return all.some((r) => normUrl(r.url) === u && normComment(r.comments) === c);
    }
    async function addRecord(record) {
      if (await pairExists(record.url, record.comments)) return false;
      await withStore("readwrite", (store) => store.add(record));
      return true;
    }
    async function deleteRecord(id) {
      return withStore("readwrite", (store) => store.delete(id));
    }
    async function getAll() {
      try {
        const db = await openDb();
        const fromIdb = await new Promise((resolve, reject) => {
          const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
        if (fromIdb.length) return fromIdb.sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
      } catch (_) {}
      try {
        const bag = await chrome.storage.local.get("recordsCache");
        if (Array.isArray(bag.recordsCache) && bag.recordsCache.length) {
          return bag.recordsCache.sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
        }
      } catch (_) {}
      try {
        const res = await chrome.runtime.sendMessage({ type: "get-records" });
        return Array.isArray(res?.rows) ? res.rows : [];
      } catch (_) {
        return [];
      }
    }

    const PAGE = 80;
    const SEEK_CHUNK = 800;
    let matched = [];
    let shown = 0;
    let seekToken = 0;

    function setSeek(pct, label) {
      $("seek").textContent = label || ("Seek " + pct + "%");
    }

    // Split the search box into tokens. "a big apple" stays one token; spaces split the rest.
    function parseQuery(q) {
      const s = String(q || "").trim();
      if (!s) return [];
      const tokens = [];
      const re = /"([^"]*)"|(\S+)/g;
      let m;
      while ((m = re.exec(s))) {
        const tok = (m[1] != null ? m[1] : m[2]).trim().toLowerCase();
        if (tok) tokens.push(tok);
      }
      return tokens;
    }
    // True only if every token appears in hay (AND).
    function hayHasAll(hay, tokens) {
      if (!tokens.length) return true;
      const h = String(hay || "").toLowerCase();
      return tokens.every((t) => h.includes(t));
    }
    // One searchable string for a visit row (date, time, title, url, id).
    function pageHay(r) {
      return [r.date, r.time, r.title, r.url, r.comments, String(r.id)].join(" ");
    }
    // One searchable string for one YouTube comment.
    function commentHay(c) {
      return [c.commentId, c.text, c.author, c.handle, c.channelId, c.publishedTime, String(c.localIndex)].join(" ");
    }
    function pageHits(r, q) {
      return hayHasAll(pageHay(r), parseQuery(q));
    }
    function commentHits(list, q) {
      const tokens = parseQuery(q);
      return (list || []).filter((c) => hayHasAll(commentHay(c), tokens));
    }
    function commentHitsAny(list, q) {
      const tokens = parseQuery(q);
      if (!tokens.length) return [];
      return (list || []).filter((c) => {
        const h = commentHay(c).toLowerCase();
        return tokens.some((t) => h.includes(t));
      });
    }
    function matchRow(r, q) {
      const url = (r.url || "").toLowerCase();
      if (filter === "yt" && !url.includes("youtube.com") && !url.includes("youtu.be")) return false;
      if (filter === "other" && (url.includes("youtube.com") || url.includes("youtu.be"))) return false;
      if (filter === "recycle") {
        const vid = videoIdFromStoredUrl(r.url);
        if (!(recycledByVideo.get(vid) || []).length) return false;
      }
      if (!q) return true;
      if (pageHits(r, q)) return true;
      if (!includeComments) return false;
      const vid = videoIdFromStoredUrl(r.url);
      const list = commentsByVideo.get(vid) || [];
      if (commentHits(list, q).length) return true;
      return hayHasAll(pageHay(r) + " " + list.map(commentHay).join(" "), parseQuery(q));
    }

    function activeComments(vid) {
      return filter === "recycle" ? (recycledByVideo.get(vid) || []) : (commentsByVideo.get(vid) || []);
    }
    function commentBlock(list) {
      if (!list.length) return `<div class="cmt">No comments logged for this video.</div>`;
      return list.map((c) =>
        `<div class="cmt ${selectedComments.has(c.recordKey) ? "sel" : ""}" data-key="${esc(c.recordKey)}"><span class="uid">#${esc(c.localIndex ?? "?")}  ${esc(c.handle || (c.author ? "@" + c.author : ""))}  ${esc(c.channelId || "")}  ${esc(c.publishedTime || "")}  ${esc(c.commentId)}</span>\n${esc(c.text || "")}</div>`
      ).join("");
    }

    function onlyFirstRow(list, rowId) {
      if (!dedupeCommentId) return list;
      return (list || []).filter((c) => firstRowByCommentId.get(c.commentId || c.recordKey) === rowId);
    }
    function rebuildFirstRowMap() {
      firstRowByCommentId.clear();
      if (!dedupeCommentId) return;
      for (const r of matched) {
        const list = activeComments(videoIdFromStoredUrl(r.url));
        for (const c of list) {
          const k = c.commentId || c.recordKey;
          if (k && !firstRowByCommentId.has(k)) firstRowByCommentId.set(k, r.id);
        }
      }
    }
    function rowHtml(r) {
      const vid = videoIdFromStoredUrl(r.url);
      const q = $("q").value.trim().toLowerCase();
      const all = onlyFirstRow(activeComments(vid), r.id);
      const fullHits = q && includeComments ? commentHits(all, q) : [];
      const partHits = q && includeComments ? commentHitsAny(all, q) : [];
      const hits = fullHits.length ? fullHits : partHits;
      const auto = includeComments && !!q && hits.length > 0;
      const show = vid && (openVideos.has(vid) || auto || filter === "recycle");
      const fold = vid
        ? `<button class="fold" data-vid="${esc(vid)}" type="button">${show ? "?" : "+"}</button><button class="selall" data-vid="${esc(vid)}" type="button" title="Select all/none comments">?</button>`
        : "";
      const detail = show
        ? `<tr class="cmt-row" data-vid="${esc(vid)}"><td colspan="5">${commentBlock(auto ? hits : all)}</td></tr>`
        : "";
      return `<tr data-id="${r.id}" class="${r.id===selectedId?"sel":""} ${selectedRows.has(r.id)?"row-sel":""}">
          <td>${esc(r.date)}</td>
          <td>${esc(r.time)}</td>
          <td title="${esc(r.title)}">${fold}${esc(r.title || "")}</td>
          <td title="${esc(r.url)}">${esc(r.url)}</td>
          <td>${r.id}</td>
        </tr>${detail}`;
    }

    function paintPreview() {
      const cur = rows.find((x) => x.id === selectedId);
      $("preview").textContent = cur
        ? `${cur.date} ${cur.time}\n${cur.title || ""}\n${cur.url}`
        : "Select a row to preview.";
    }

    function renderSlice(reset) {
      const tb = $("tbody");
      if (reset) {
        shown = 0;
        tb.innerHTML = "";
      }
      const next = matched.slice(shown, shown + PAGE);
      if (next.length) tb.insertAdjacentHTML("beforeend", next.map(rowHtml).join(""));
      shown += next.length;
      $("empty").hidden = matched.length > 0;
      $("status").textContent = shown + " of " + matched.length + " shown";
      paintPreview();
    }

    function seek(q) {
      matched = rows.filter((r) => matchRow(r, q));
      rebuildFirstRowMap();
      setSeek(100, "Seek 100% · " + matched.length);
      renderSlice(true);
    }

    function esc(s) {
      return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
    }

    async function loadCommentsIndex() {
      commentsByVideo.clear();
      recycledByVideo.clear();
      try {
        const db = await openDb();
        const all = await new Promise((resolve, reject) => {
          const req = db.transaction(COMMENT_STORE, "readonly").objectStore(COMMENT_STORE).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
        for (const c of all) {
          const bag = c.recycled ? recycledByVideo : commentsByVideo;
          const list = bag.get(c.videoId) || [];
          list.push(c);
          bag.set(c.videoId, list);
        }
        for (const list of [...commentsByVideo.values(), ...recycledByVideo.values()]) {
          list.sort((a, b) => (a.localIndex || a.createdAt || 0) - (b.localIndex || b.createdAt || 0));
          list.forEach((c, i) => { if (!c.localIndex) c.localIndex = i + 1; });
        }
      } catch (_) {}
      if (!commentsByVideo.size) {
        try {
          const bag = await chrome.storage.local.get("commentsCache");
          for (const c of bag.commentsCache || []) {
            const list = commentsByVideo.get(c.videoId) || [];
            list.push(c);
            commentsByVideo.set(c.videoId, list);
          }
        } catch (_) {}
      }
    }

    async function loadLazy() {
      rows = [];
      matched = [];
      shown = 0;
      $("tbody").innerHTML = "";
      setSeek(0, "Loading 0%");
      if (!location.protocol.startsWith("chrome") && !location.protocol.startsWith("edge") && !location.protocol.startsWith("extension")) {
        $("status").textContent = "Wrong page: open explorer from the extension popup, not a file:// path.";
      }
      try {
        await loadCommentsIndex();
        rows = await getAll();
        setSeek(100, "Loaded " + rows.length);
        seek($("q").value.trim().toLowerCase());
        $("status").textContent = rows.length
          ? (shown + " of " + matched.length + " shown · loaded " + rows.length)
          : "0 items. Popup has data? Reload extension, visit a page, then click Refresh.";
      } catch (err) {
        $("status").textContent = "Load error: " + err;
        $("empty").hidden = false;
        $("empty").textContent = String(err);
      }
    }

    async function refresh() {
      await loadLazy();
    }

    function visibleCommentKeys() {
      const keys = [];
      for (const tr of document.querySelectorAll("#tbody tr.cmt-row")) {
        tr.querySelectorAll(".cmt[data-key]").forEach((el) => keys.push(el.dataset.key));
      }
      return keys;
    }
    function findComment(key) {
      for (const bag of [commentsByVideo, recycledByVideo]) {
        for (const list of bag.values()) {
          const hit = list.find((c) => c.recordKey === key);
          if (hit) return hit;
        }
      }
      return null;
    }
    async function putComment(row) {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(COMMENT_STORE, "readwrite");
        tx.objectStore(COMMENT_STORE).put(row);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
    async function eraseComment(key) {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(COMMENT_STORE, "readwrite");
        tx.objectStore(COMMENT_STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
    function hideMenu() { $("menu").style.display = "none"; }
    function showMenu(x, y, items) {
      const menu = $("menu");
      menu.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}">${esc(it.label)}</button>`).join("");
      menu.style.left = x + "px";
      menu.style.top = y + "px";
      menu.style.display = "block";
      menu.onclick = async (ev) => {
        const btn = ev.target.closest("button");
        if (!btn) return;
        hideMenu();
        await items[Number(btn.dataset.i)].run();
      };
    }
    function selectRange() {
      const keys = visibleCommentKeys();
      const picked = keys.filter((k) => selectedComments.has(k));
      if (picked.length < 2) return;
      const a = keys.indexOf(picked[0]);
      const b = keys.indexOf(picked[picked.length - 1]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selectedComments.add(keys[i]);
      seek($("q").value.trim().toLowerCase());
    }
    async function recycleSelected() {
      for (const key of [...selectedComments]) {
        const c = findComment(key);
        if (!c || c.recycled) continue;
        c.recycled = true;
        await putComment(c);
      }
      selectedComments.clear();
      await refresh();
    }
    async function recoverSelected() {
      for (const key of [...selectedComments]) {
        const c = findComment(key);
        if (!c || !c.recycled) continue;
        c.recycled = false;
        await putComment(c);
      }
      selectedComments.clear();
      selectedRows.clear();
      await refresh();
    }
    async function purgeSelected() {
      if (!selectedComments.size) return;
      if (!confirm("Permanently delete " + selectedComments.size + " comment(s)?")) return;
      for (const key of [...selectedComments]) await eraseComment(key);
      selectedComments.clear();
      selectedRows.clear();
      await refresh();
    }

    $("tbody").addEventListener("click", (e) => {
      const selAll = e.target.closest(".selall");
      if (selAll) {
        const keys = activeComments(selAll.dataset.vid).map((c) => c.recordKey);
        const allOn = keys.length && keys.every((k) => selectedComments.has(k));
        keys.forEach((k) => allOn ? selectedComments.delete(k) : selectedComments.add(k));
        seek($("q").value.trim().toLowerCase());
        return;
      }
      const cmt = e.target.closest(".cmt[data-key]");
      if (cmt && e.ctrlKey) {
        const key = cmt.dataset.key;
        if (selectedComments.has(key)) selectedComments.delete(key);
        else selectedComments.add(key);
        cmt.classList.toggle("sel", selectedComments.has(key));
        return;
      }
      const fold = e.target.closest(".fold");
      if (fold) {
        const vid = fold.dataset.vid;
        if (openVideos.has(vid)) openVideos.delete(vid);
        else openVideos.add(vid);
        seek($("q").value.trim().toLowerCase());
        return;
      }
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      selectedId = Number(tr.dataset.id);
      if (filter === "recycle" && e.ctrlKey) {
        if (selectedRows.has(selectedId)) selectedRows.delete(selectedId);
        else selectedRows.add(selectedId);
      }
      document.querySelectorAll("#tbody tr").forEach((x) => x.classList.toggle("sel", Number(x.dataset.id) === selectedId));
      document.querySelectorAll("#tbody tr[data-id]").forEach((x) => x.classList.toggle("row-sel", selectedRows.has(Number(x.dataset.id))));
      paintPreview();
    });
    $("tbody").addEventListener("contextmenu", (e) => {
      const cmt = e.target.closest(".cmt[data-key]");
      const tr = e.target.closest("tr[data-id]");
      if (!cmt && !(filter === "recycle" && tr)) return;
      e.preventDefault();
      if (cmt && !selectedComments.has(cmt.dataset.key)) selectedComments.add(cmt.dataset.key);
      if (filter === "recycle") {
        showMenu(e.clientX, e.clientY, [
          { label: "Select range", run: async () => selectRange() },
          { label: "Recover", run: recoverSelected },
          { label: "Delete permanently", run: purgeSelected }
        ]);
      } else {
        showMenu(e.clientX, e.clientY, [
          { label: "Select range", run: async () => selectRange() },
          { label: "Delete selected (recycle)", run: recycleSelected }
        ]);
      }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest("#menu")) hideMenu(); });

    document.querySelector(".listwrap").addEventListener("scroll", (e) => {
      const el = e.target;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
        if (shown < matched.length) renderSlice(false);
      }
    });

    let searchTimer = null;
    $("q").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => seek($("q").value.trim().toLowerCase()), 80);
    });

    document.querySelector(".side").addEventListener("click", (e) => {
      const el = e.target.closest("[data-filter]");
      if (!el) return;
      document.querySelectorAll(".side [data-filter]").forEach((x) => x.classList.remove("on"));
      el.classList.add("on");
      filter = el.dataset.filter;
      seek($("q").value.trim().toLowerCase());
    });

    const includeBox = $("includeComments");
    const includeLabel = $("includeCommentsLabel");
    function paintInclude(on) {
      includeComments = !!on;
      includeBox.checked = includeComments;
      includeLabel.textContent = includeComments ? "on" : "off";
    }
    chrome.storage.local.get({ includeComments: false }).then((bag) => {
      paintInclude(bag.includeComments);
      seek($("q").value.trim().toLowerCase());
    });
    includeBox.addEventListener("change", () => {
      paintInclude(includeBox.checked);
      chrome.storage.local.set({ includeComments: includeComments });
      seek($("q").value.trim().toLowerCase());
    });

    const dedupeBox = $("dedupeCommentId");
    const dedupeLabel = $("dedupeCommentIdLabel");
    function paintDedupe(on) {
      dedupeCommentId = !!on;
      dedupeBox.checked = dedupeCommentId;
      dedupeLabel.textContent = dedupeCommentId ? "on" : "off";
    }
    chrome.storage.local.get({ dedupeCommentId: false }).then((bag) => {
      paintDedupe(bag.dedupeCommentId);
      seek($("q").value.trim().toLowerCase());
    });
    dedupeBox.addEventListener("change", () => {
      paintDedupe(dedupeBox.checked);
      chrome.storage.local.set({ dedupeCommentId: dedupeCommentId });
      seek($("q").value.trim().toLowerCase());
    });

    $("reloadBtn").onclick = () => refresh();
    $("newBtn").onclick = () => { setNow(); $("url").value=""; $("comments").value=""; $("dlg").classList.add("on"); };
    $("cancelBtn").onclick = () => $("dlg").classList.remove("on");
    $("saveBtn").onclick = async () => {
      if (!$("date").value || !$("time").value || !$("url").value.trim()) return;
      const added = await addRecord({
        date: $("date").value,
        time: $("time").value,
        url: $("url").value.trim(),
        title: "",
        comments: $("comments").value,
        createdAt: Date.now()
      });
      if (!added) {
        $("status").textContent = "Skipped: URL + comment already in DB";
        $("dlg").classList.remove("on");
        return;
      }
      $("dlg").classList.remove("on");
      await refresh();
    };

    $("delBtn").onclick = async () => {
      if (!selectedId) return;
      await deleteRecord(selectedId);
      selectedId = null;
      await refresh();
    };

    $("exportBtn").onclick = async () => {
      const blob = new Blob([JSON.stringify(await getAll(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "visit-comment-log.json";
      a.click();
      URL.revokeObjectURL(a.href);
    };
    $("importBtn").onclick = () => $("fileInput").click();
    $("fileInput").onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const data = JSON.parse(await file.text());
      for (const row of data) {
        const { id, ...rest } = row;
        await addRecord({
          date: rest.date || "",
          time: rest.time || "",
          url: rest.url || "",
          title: rest.title || "",
          comments: rest.comments || "",
          createdAt: rest.createdAt || Date.now()
        });
      }
      e.target.value = "";
      await refresh();
    };

    refresh();
