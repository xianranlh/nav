/* Sessions and gallery retain their existing archive contracts. */
window.createAIArchiveUI = function (ctx) {
    const { $, $$, toast, uid, escapeHtml, Store, render, Bg, UIAI } = ctx;

    const dlgSessions = $("#dialog-sessions");
    const dlgGallery  = $("#dialog-gallery");
    let _saveTimer = null;
    let sessionTransition = false;
    let flushQueue = Promise.resolve();
    function sessionsChanged() { document.dispatchEvent(new Event("ai:sessions-changed")); }

    // Archive 缺失（IDB 不可用 / archive.js 加载失败）时给个温和的兜底：
    // 按钮仍可点，但 toast 提示原因，便于用户排查；不再 return null 让按钮变哑巴。
    if (!window.Archive) {
      console.warn("[UIArchive] window.Archive 未就绪，可能 archive.js 没加载或 IndexedDB 不可用");
      const warn = () => toast("图库 / 会话功能未启用：浏览器禁用了 IndexedDB 或脚本加载失败", 4000);
      $("#ai-sessions")?.addEventListener("click", warn);
      $("#ai-gallery") ?.addEventListener("click", warn);
      return null;
    }
    const { Gallery, Sessions } = window.Archive;

    // 给 currentId/AIStore.messages 关联：saveMessages 之后异步把当前会话写入 DB
    function patchSaveMessages() {
      const origin = AI.AIStore.saveMessages.bind(AI.AIStore);
      AI.AIStore.saveMessages = function () {
        origin();
        scheduleSessionFlush();
      };
    }
    function scheduleSessionFlush() {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(flushCurrentSession, 350);
    }
    function flushCurrentSession() {
      clearTimeout(_saveTimer);
      flushQueue = flushQueue.then(persistCurrentSession);
      return flushQueue;
    }
    async function persistCurrentSession() {
      try {
        await Archive.ready;
        let id = Sessions.currentId();
        if (!id) {
          // 还没绑定当前会话：建一个
          const rec = await Sessions.create({
            title: Sessions.autoTitle(AI.AIStore.messages) || "新会话",
            messages: AI.AIStore.messages,
            model: AI.AIStore.data.currentModel || "",
            persona: (AI.AIStore.currentPersona && AI.AIStore.currentPersona()?.id) || "",
          });
          Sessions.setCurrentId(rec.id);
          return;
        }
        // 已有当前会话：找标题（首次有用户消息后自动改名）
        const cur = await Sessions.load(id);
        const metaPatch = {
          model: AI.AIStore.data.currentModel || cur?.model || "",
          persona: (AI.AIStore.currentPersona && AI.AIStore.currentPersona()?.id) || cur?.persona || "",
        };
        if (cur && (!cur.title || /^新会话/.test(cur.title) || (cur.title === "默认会话" && !cur.messageCount))) {
          const auto = Sessions.autoTitle(AI.AIStore.messages);
          if (auto) metaPatch.title = auto;
        }
        await Sessions.save(id, AI.AIStore.messages, metaPatch);
      } catch (e) {
        // 静默：localStorage 仍然是兜底
        console.debug("[Archive] flush session:", e);
      } finally {
        sessionsChanged();
      }
    }

    // 启动：等 archive bootstrap 完，从当前会话拉消息
    async function init() {
      try {
        await Archive.ready;
        patchSaveMessages();
        const id = Sessions.currentId();
        if (id) {
          const rec = await Sessions.load(id);
          if (rec && Array.isArray(rec.messages) && rec.messages.length) {
            // 仅当 IDB 里有更多消息时才覆盖（避免反向回放）
            const lsCount = (AI.AIStore.messages || []).length;
            if (rec.messages.length >= lsCount) {
              AI.AIStore.messages = rec.messages;
              UIAI.renderMessages();
            }
          }
        }
      } catch (e) {
        console.warn("[UIArchive.init]", e);
      }
    }
    init();

    async function changeSession(id) {
      if (sessionTransition || UIAI.isBusy()) { toast("请先停止生成，再切换或新建对话"); return false; }
      sessionTransition = true;
      const panel = $("#ai-panel");
      panel.dataset.sessionBusy = "true";
      UIAI.syncComposer();
      try {
        UIAI.saveDraft();
        await flushCurrentSession();
        UIAI.saveDraft();
        const rec = id ? await Sessions.load(id) : await Sessions.create({ title: "新会话", messages: [] });
        if (!rec) { toast("未找到这段对话，请刷新会话列表"); return false; }
        Sessions.setCurrentId(rec.id);
        AI.AIStore.messages = Array.isArray(rec.messages) ? rec.messages : [];
        AI.AIStore.saveMessages();
        UIAI.restoreDraft();
        UIAI.scrollToBottom(true);
        UIAI.renderMessages();
        sessionsChanged();
        return true;
      } catch (e) {
        toast("切换会话失败：" + (e?.message || e));
        return false;
      } finally {
        sessionTransition = false;
        delete panel.dataset.sessionBusy;
        UIAI.syncComposer();
      }
    }

    // ---------- 会话弹窗 ----------
    function openSessions() {
      if (!dlgSessions) {
        console.warn("[UIArchive] #dialog-sessions 不存在 — 检查 index.html 是否包含会话弹窗元素");
        toast("会话弹窗模板缺失，请刷新页面或重新部署");
        return;
      }
      try {
        renderSessionsList();
        Dlg.open(dlgSessions);
      } catch (e) {
        console.error("[UIArchive.openSessions]", e);
        toast("打开会话弹窗出错：" + (e?.message || e), 4000);
      }
    }
    async function renderSessionsList(filterText = "") {
      const list = $("#sessions-list");
      const empty = $("#sessions-empty");
      const all = await Sessions.list();
      const q = filterText.trim().toLowerCase();
      const filtered = q
        ? all.filter((s) => (s.title || "").toLowerCase().includes(q))
        : all;
      const curId = Sessions.currentId();
      if (!filtered.length) {
        list.innerHTML = "";
        empty.hidden = false;
        empty.textContent = q ? `没有匹配 "${filterText}" 的会话` : "还没有历史会话。点 + 新建一个开始。";
        return;
      }
      empty.hidden = true;
      list.innerHTML = filtered.map((s) => {
        const isCur = s.id === curId;
        const date = new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleString();
        return `<div class="session-row ${isCur ? "is-current" : ""}" data-id="${s.id}">
          <button type="button" class="session-pin" data-act="pin" title="${s.pinned ? "取消置顶" : "置顶"}">${s.pinned ? "📌" : "📍"}</button>
          <div class="session-info">
            <div class="session-title">${escapeHtml(s.title || "新会话")}</div>
            <div class="session-meta">${s.messageCount || 0} 条 · ${escapeHtml(date)}${s.model ? " · " + escapeHtml(s.model) : ""}</div>
          </div>
          <div class="session-acts">
            ${isCur ? `<span class="session-cur-badge">当前</span>` : `<button type="button" class="mini-btn" data-act="switch">切换</button>`}
            <button type="button" class="mini-btn" data-act="rename" title="重命名">✎</button>
            <button type="button" class="mini-btn danger" data-act="remove" title="删除">🗑</button>
          </div>
        </div>`;
      }).join("");
    }

    $("#ai-sessions")?.addEventListener("click", openSessions);
    $("#sessions-search")?.addEventListener("input", (e) => renderSessionsList(e.target.value));
    $("#sessions-new")?.addEventListener("click", async () => {
      if (!await changeSession()) return;
      renderSessionsList($("#sessions-search").value || "");
    });
    dlgSessions?.addEventListener("click", async (e) => {
      const row = e.target.closest(".session-row");
      const btn = e.target.closest("[data-act]");
      if (!row || !btn) return;
      const id = row.dataset.id;
      const act = btn.dataset.act;
      if (act === "switch") {
        if (!await changeSession(id)) return;
        Dlg.close(dlgSessions);
      }
      if (act === "rename") {
        const cur = await Sessions.load(id);
        const name = prompt("会话标题：", cur?.title || "");
        if (name !== null) {
          await Sessions.rename(id, name);
          sessionsChanged();
          renderSessionsList($("#sessions-search").value || "");
        }
      }
      if (act === "remove") {
        if (UIAI.isBusy() || sessionTransition) { toast("请先停止生成，再删除会话"); return; }
        const cur = await Sessions.load(id);
        if (!confirm(`删除会话「${cur?.title || "未命名"}」？此操作不可撤销。`)) return;
        await flushCurrentSession();
        await Sessions.remove(id);
        if (Sessions.currentId() === id) {
          Sessions.setCurrentId("");
          AI.AIStore.messages = [];
          try { localStorage.removeItem("sakura_nav_chat_v1"); } catch (_) {}
          UIAI.restoreDraft();
          UIAI.renderMessages();
        }
        renderSessionsList($("#sessions-search").value || "");
        sessionsChanged();
      }
      if (act === "pin") {
        await Sessions.togglePinned(id);
        sessionsChanged();
        renderSessionsList($("#sessions-search").value || "");
      }
    });

    // ---------- 图库弹窗 ----------
    let galleryFilter = "all";
    let gallerySelectMode = false;          // 选择模式开关
    /** 选中的图片 id —— 有序数组（决定背景轮播的播放顺序）。
     *  之前是 Set，为了支持拖拽改顺序改成 Array，对外行为保持"集合"语义。 */
    const gallerySelected = [];
    const galSel = {
      has(id) { return gallerySelected.includes(id); },
      add(id) { if (!this.has(id)) gallerySelected.push(id); },
      delete(id) {
        const i = gallerySelected.indexOf(id);
        if (i >= 0) gallerySelected.splice(i, 1);
      },
      toggle(id) { this.has(id) ? this.delete(id) : this.add(id); },
      clear() { gallerySelected.length = 0; },
      get size() { return gallerySelected.length; },
      values() { return gallerySelected.slice(); },
      move(fromIdx, toIdx) {
        if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0
            || fromIdx >= gallerySelected.length || toIdx >= gallerySelected.length) return;
        const [it] = gallerySelected.splice(fromIdx, 1);
        gallerySelected.splice(toIdx, 0, it);
      },
    };
    let galleryCurrentItems = [];           // 当前视图渲染出的 items（供"全选当前视图"用）

    function openGallery() {
      if (!dlgGallery) {
        console.warn("[UIArchive] #dialog-gallery 不存在 — 检查 index.html 是否包含图库弹窗元素");
        toast("图库弹窗模板缺失，请刷新页面或重新部署");
        return;
      }
      try {
        const intEl = $("#gallery-bg-interval");
        if (intEl) intEl.value = Math.max(5, Math.min(3600, +Store.settings.bgInterval || 60));
        const shEl  = $("#gallery-bg-shuffle");
        if (shEl) shEl.checked = !!Store.settings.bgShuffle;
        initGalleryGen();
        refreshGenProviders();
        showGalleryTab("library");
        refreshPresetSelect();
        renderGallery();
        renderSelThumbStrip();
        Dlg.open(dlgGallery);
      } catch (e) {
        console.error("[UIArchive.openGallery]", e);
        toast("打开图库出错：" + (e?.message || e), 4000);
      }
    }

    function setGallerySelectMode(on) {
      gallerySelectMode = !!on;
      const selbar = $("#gallery-selbar");
      const toggleBtn = $("#gallery-select-toggle");
      if (selbar) selbar.hidden = !gallerySelectMode;
      if (toggleBtn) {
        toggleBtn.textContent = gallerySelectMode ? "✕ 退出选择" : "☑ 选择";
        toggleBtn.classList.toggle("primary", gallerySelectMode);
      }
      if (!gallerySelectMode) galSel.clear();
      updateGallerySelCount();
      renderGallery();
    }

    function updateGallerySelCount() {
      const el = $("#gallery-sel-count");
      if (el) el.textContent = galSel.size;
      const useBtn = $("#gallery-use-bg");
      if (useBtn) useBtn.disabled = galSel.size === 0;
      // 顺序条同步刷新
      renderSelThumbStrip();
    }

    async function renderGallery() {
      const grid = $("#gallery-grid");
      const empty = $("#gallery-empty");
      const stat  = $("#gallery-stat");
      const q     = $("#gallery-search")?.value || "";
      const opts  = { query: q };
      if (galleryFilter === "generated") opts.source = "generated";
      if (galleryFilter === "uploaded")  opts.source = "uploaded";
      if (galleryFilter === "favorite")  opts.favoriteOnly = true;
      const items = await Gallery.list(opts);
      galleryCurrentItems = items;
      // 进入选择模式时给整个 grid 加一个 class，CSS 接管显示 checkbox
      grid?.classList.toggle("is-selecting", gallerySelectMode);

      // 顶部统计
      try {
        const total = await Gallery.count();
        const bytes = await Gallery.totalBytes();
        const mb = (bytes / 1024 / 1024).toFixed(1);
        stat.textContent = `共 ${total} 张 · 约 ${mb} MB`;
      } catch (_) {}

      if (!items.length) {
        grid.innerHTML = "";
        empty.hidden = false;
        empty.textContent = q
          ? `没有匹配 "${q}" 的图`
          : "这里还没有图。生图或上传图片附件后会自动入库。";
        return;
      }
      empty.hidden = true;
      grid.innerHTML = items.map((it) => {
        const cap = (it.prompt || it.name || it.revisedPrompt || "").trim();
        const tip = cap || (it.source === "uploaded" ? "上传图片" : "生成图片");
        const dateStr = new Date(it.ts || Date.now()).toLocaleString();
        const tag = it.source === "uploaded" ? "上传" : "生图";
        const hasUrl = !!it.serverUrl;
        const urlBadge = hasUrl
          ? `<span class="gallery-url-badge" title="已同步到服务端 · 点 🔗 复制公开 URL">🔗 URL</span>`
          : `<span class="gallery-url-badge pending" title="正在同步到服务端…">⤴ 同步中</span>`;
        const isSel = galSel.has(it.id);
        const selOverlay = gallerySelectMode
          ? `<span class="gallery-check ${isSel ? "on" : ""}" data-act="sel" aria-label="选择">${isSel ? "✓" : ""}</span>`
          : "";
        return `<figure class="gallery-card ${it.favorite ? "is-fav" : ""} ${isSel ? "is-selected" : ""}" data-id="${it.id}">
          ${selOverlay}
          <img src="${it.dataUrl}" alt="${escapeAttr(tip)}" loading="lazy" />
          <figcaption class="gallery-cap">
            <span class="gallery-tag ${it.source}">${tag}</span>
            <span class="gallery-cap-text" title="${escapeAttr(tip)}">${escapeHtml(cap.slice(0, 32) || dateStr)}</span>
            ${urlBadge}
          </figcaption>
          <div class="gallery-acts">
            <button type="button" class="mini-btn" data-act="reference">用作参考图</button>
            <button type="button" class="mini-btn" data-act="edit" title="打开图像编辑器（裁剪/旋转/翻转/画笔）">✏️</button>
            <button type="button" class="mini-btn" data-act="set-bg" title="设为当前背景（单张）">📌</button>
            ${hasUrl ? `<button type="button" class="mini-btn" data-act="copy-url" title="复制公开 URL">🔗</button>` : ""}
            <button type="button" class="mini-btn" data-act="fav" title="${it.favorite ? "取消收藏" : "收藏"}">${it.favorite ? "★" : "☆"}</button>
            <a class="mini-btn" href="${it.dataUrl}" download="${it.name || ("sakura-image-" + (it.id || "")) + ".png"}" title="下载">⬇</a>
            <button type="button" class="mini-btn" data-act="copy" title="复制 prompt">✎</button>
            <button type="button" class="mini-btn danger" data-act="remove" title="删除">🗑</button>
          </div>
        </figure>`;
      }).join("");
    }

    /** 把选中的图片应用为背景轮播：serverUrl 优先（小且 CDN 友好），dataUrl 兜底。 */
    async function applySelectedAsBackground() {
      if (!galSel.size) { toast("先勾选至少一张图"); return; }
      const intervalEl = $("#gallery-bg-interval");
      const intervalSec = Math.max(5, Math.min(3600, parseInt(intervalEl?.value, 10) || 60));
      const shuffle = !!$("#gallery-bg-shuffle")?.checked;

      // 按 selected 顺序解析 URL（拖拽过的顺序）；优先 serverUrl
      const ids = galSel.values();
      const urls = [];
      let dataUrlCount = 0;
      for (const id of ids) {
        const rec = await Gallery.get(id);
        if (!rec) continue;
        if (rec.serverUrl) urls.push(rec.serverUrl);
        else if (rec.dataUrl) { urls.push(rec.dataUrl); dataUrlCount++; }
      }
      if (!urls.length) { toast("选中的图都没有可用 URL"); return; }

      if (dataUrlCount >= 3) {
        const ok = confirm(
          `其中有 ${dataUrlCount} 张还未同步到服务端，将以 base64 形式存进设置里。\n` +
          `这可能让 nav 的设置体积膨胀几 MB。\n\n` +
          `继续？（建议等所有图都显示 🔗 URL 后再做）`
        );
        if (!ok) return;
      }

      Store.settings.bgShuffle = shuffle;
      Store.settings.bgMode = "rotate";
      Store.settings.bgList = urls;
      Store.settings.bgInterval = intervalSec;
      try { Store.save(); } catch (_) {}
      Bg.apply();

      // 同步设置面板里的 bgMode UI（如果当前打开）
      try {
        const radio = document.querySelector('input[name="bg-mode"][value="rotate"]');
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
      } catch (_) {}

      toast(`✨ 已应用 ${urls.length} 张为背景轮播 · 每 ${intervalSec}s 一张 ${shuffle ? "(随机)" : ""}`);
      Dlg.close(dlgGallery);
      setGallerySelectMode(false);
    }

    // ---------- 拖拽排序：缩略图条 ----------
    /** 渲染顶部缩略图条；按 galSel 当前顺序展示，可拖动改顺序 */
    async function renderSelThumbStrip() {
      const wrap = $("#gallery-sel-thumbs");
      const strip = $("#gallery-sel-thumb-strip");
      if (!wrap || !strip) return;
      if (!galSel.size) {
        wrap.hidden = true;
        strip.innerHTML = "";
        return;
      }
      wrap.hidden = false;
      const ids = galSel.values();
      const records = [];
      for (const id of ids) {
        const rec = await Gallery.get(id);
        if (rec) records.push(rec);
      }
      strip.innerHTML = records.map((r, i) => `
        <div class="gallery-sel-thumb" draggable="true" data-id="${r.id}" data-idx="${i}" title="拖拽以改顺序">
          <span class="gallery-sel-thumb-idx">${i + 1}</span>
          <img src="${r.dataUrl}" alt="" />
          <button type="button" class="gallery-sel-thumb-x" data-act="thumb-remove" title="从选中里移除">×</button>
        </div>
      `).join("");
    }

    // 拖拽事件 —— 用纯 HTML5 drag API，dragover 期间标记 placeholder 位置
    let _dragFromIdx = -1;
    $("#gallery-sel-thumb-strip")?.addEventListener("dragstart", (e) => {
      const thumb = e.target.closest(".gallery-sel-thumb");
      if (!thumb) return;
      _dragFromIdx = +thumb.dataset.idx;
      thumb.classList.add("dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", thumb.dataset.id); } catch (_) {}
    });
    $("#gallery-sel-thumb-strip")?.addEventListener("dragend", (e) => {
      const thumb = e.target.closest(".gallery-sel-thumb");
      if (thumb) thumb.classList.remove("dragging");
      $$(".gallery-sel-thumb", $("#gallery-sel-thumb-strip")).forEach((t) => t.classList.remove("drop-before", "drop-after"));
      _dragFromIdx = -1;
    });
    $("#gallery-sel-thumb-strip")?.addEventListener("dragover", (e) => {
      e.preventDefault();
      const thumb = e.target.closest(".gallery-sel-thumb");
      if (!thumb || _dragFromIdx < 0) return;
      $$(".gallery-sel-thumb", $("#gallery-sel-thumb-strip")).forEach((t) => t.classList.remove("drop-before", "drop-after"));
      const r = thumb.getBoundingClientRect();
      const before = (e.clientX - r.left) < (r.width / 2);
      thumb.classList.add(before ? "drop-before" : "drop-after");
    });
    $("#gallery-sel-thumb-strip")?.addEventListener("drop", (e) => {
      e.preventDefault();
      const thumb = e.target.closest(".gallery-sel-thumb");
      if (!thumb || _dragFromIdx < 0) return;
      const toIdx0 = +thumb.dataset.idx;
      const r = thumb.getBoundingClientRect();
      const before = (e.clientX - r.left) < (r.width / 2);
      // 计算最终插入位置；删掉源后插入目标位置
      let toIdx = before ? toIdx0 : toIdx0 + 1;
      if (toIdx > _dragFromIdx) toIdx--; // 删源后原右侧索引整体左移 1
      galSel.move(_dragFromIdx, toIdx);
      _dragFromIdx = -1;
      renderSelThumbStrip();
      renderGallery(); // 让 grid 卡片角标也更新（虽然 grid 不显示顺序，但更稳）
    });

    // 缩略图上的 × 按钮：单张移除
    $("#gallery-sel-thumb-strip")?.addEventListener("click", (e) => {
      const x = e.target.closest("[data-act='thumb-remove']");
      if (!x) return;
      const id = x.closest(".gallery-sel-thumb")?.dataset.id;
      if (!id) return;
      galSel.delete(id);
      updateGallerySelCount();
      renderGallery();
    });

    // 上传完成事件：图库面板若已打开就重渲染（让"同步中"变成"🔗 URL"）
    window.addEventListener("sakura:gallery-uploaded", () => {
      if (dlgGallery && dlgGallery.open) renderGallery();
    });
    function escapeAttr(s) { return String(s || "").replace(/"/g, "&quot;"); }

    // ---------- 图集预设：增删改查 + 下拉同步 ----------
    function refreshPresetSelect() {
      const sel = $("#gallery-preset-select");
      if (!sel) return;
      const list = Store.settings.bgPresets || [];
      const cur = sel.value;
      sel.innerHTML = `<option value="">— 选择预设 —</option>` +
        list.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)} (${(p.urls || []).length})</option>`).join("");
      if (cur && list.find((p) => p.id === cur)) sel.value = cur;
    }

    async function loadPreset(id) {
      const list = Store.settings.bgPresets || [];
      const p = list.find((x) => x.id === id);
      if (!p) { toast("预设不存在"); return; }
      // 直接应用为当前背景，并把 urls 反向写回 selected（按 URL 反查 IDB 不可行 —— 用一个临时方案：清空 selected，但 urls 直接生效）
      Store.settings.bgMode = "rotate";
      Store.settings.bgList = (p.urls || []).slice();
      Store.settings.bgInterval = Math.max(5, Math.min(3600, +p.interval || 60));
      Store.settings.bgShuffle = !!p.shuffle;
      try { Store.save(); } catch (_) {}
      Bg.apply();
      // UI 同步
      try {
        const radio = document.querySelector('input[name="bg-mode"][value="rotate"]');
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
      } catch (_) {}
      const intEl = $("#gallery-bg-interval"); if (intEl) intEl.value = Store.settings.bgInterval;
      const shEl  = $("#gallery-bg-shuffle"); if (shEl) shEl.checked = Store.settings.bgShuffle;
      toast(`✨ 已加载预设「${p.name}」· ${(p.urls || []).length} 张 · 每 ${Store.settings.bgInterval}s${Store.settings.bgShuffle ? " · 随机" : ""}`);
      Dlg.close(dlgGallery);
      setGallerySelectMode(false);
    }

    async function savePresetFromSelection() {
      if (!galSel.size) { toast("先勾选至少一张图"); return; }
      const name = prompt("给这个预设起个名字：", `图集 ${(Store.settings.bgPresets || []).length + 1}`);
      if (!name) return;
      // 解析 urls（同 applySelectedAsBackground 的逻辑，但不真的应用）
      const ids = galSel.values();
      const urls = [];
      for (const id of ids) {
        const rec = await Gallery.get(id);
        if (!rec) continue;
        urls.push(rec.serverUrl || rec.dataUrl);
      }
      const filtered = urls.filter(Boolean);
      if (!filtered.length) { toast("选中的图都没有可用 URL"); return; }
      const shuffle = !!$("#gallery-bg-shuffle")?.checked;
      const interval = Math.max(5, Math.min(3600, parseInt($("#gallery-bg-interval")?.value, 10) || 60));
      const preset = {
        id: "bgp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
        name: String(name).slice(0, 40),
        urls: filtered,
        shuffle,
        interval,
        createdAt: Date.now(),
      };
      Store.settings.bgPresets = [...(Store.settings.bgPresets || []), preset];
      try { Store.save(); } catch (_) {}
      refreshPresetSelect();
      // 选中刚保存的
      const sel = $("#gallery-preset-select");
      if (sel) sel.value = preset.id;
      toast(`✨ 已保存预设「${preset.name}」`);
    }

    function deleteSelectedPreset() {
      const sel = $("#gallery-preset-select");
      const id = sel?.value;
      if (!id) { toast("先在下拉里选一个预设"); return; }
      const list = Store.settings.bgPresets || [];
      const p = list.find((x) => x.id === id);
      if (!p) return;
      if (!confirm(`删除预设「${p.name}」？此操作不可撤销。`)) return;
      Store.settings.bgPresets = list.filter((x) => x.id !== id);
      try { Store.save(); } catch (_) {}
      refreshPresetSelect();
      toast("预设已删除");
    }

    $("#ai-gallery")?.addEventListener("click", openGallery);
    $("#gallery-search")?.addEventListener("input", () => renderGallery());

    // 选择模式相关 ----------
    $("#gallery-select-toggle")?.addEventListener("click", () => {
      setGallerySelectMode(!gallerySelectMode);
    });
    $("#gallery-sel-all")?.addEventListener("click", () => {
      galleryCurrentItems.forEach((it) => galSel.add(it.id));
      updateGallerySelCount();
      renderGallery();
    });
    $("#gallery-sel-none")?.addEventListener("click", () => {
      galSel.clear();
      updateGallerySelCount();
      renderGallery();
    });
    $("#gallery-use-bg")?.addEventListener("click", applySelectedAsBackground);

    // 预设相关 ----------
    $("#gallery-preset-save")?.addEventListener("click", savePresetFromSelection);
    $("#gallery-preset-load")?.addEventListener("click", () => {
      const id = $("#gallery-preset-select")?.value;
      if (!id) { toast("先在下拉里选一个预设"); return; }
      loadPreset(id);
    });
    $("#gallery-preset-delete")?.addEventListener("click", deleteSelectedPreset);
    // 直接 change 下拉也算"加载"：双击体验更好但保留 [加载] 按钮兜底
    $("#gallery-preset-select")?.addEventListener("dblclick", () => {
      const id = $("#gallery-preset-select")?.value;
      if (id) loadPreset(id);
    });
    $$(".gallery-filter").forEach((b) => {
      b.addEventListener("click", () => {
        $$(".gallery-filter").forEach((x) => {
          x.classList.toggle("is-active", x === b);
          x.setAttribute("aria-selected", x === b ? "true" : "false");
        });
        galleryFilter = b.dataset.filter;
        renderGallery();
      });
    });
    $("#gallery-clear")?.addEventListener("click", async () => {
      const c = await Gallery.count();
      if (!c) { toast("图库已经是空的"); return; }
      if (!confirm(`确定清空整个图库（${c} 张）？此操作不可撤销。`)) return;
      await Gallery.clear();
      renderGallery();
      toast("图库已清空");
    });
    $("#gallery-grid")?.addEventListener("click", async (e) => {
      const card = e.target.closest(".gallery-card");
      if (!card) return;
      const id = card.dataset.id;
      const act = e.target.closest("[data-act]")?.dataset.act;

      // 选择模式：点 checkbox 或图片本体都切换选中态；点 .gallery-acts 里的按钮还是正常走
      if (gallerySelectMode && (act === "sel" || (!act && !e.target.closest(".gallery-acts")))) {
        galSel.toggle(id);
        updateGallerySelCount();
        const isSel = galSel.has(id);
        card.classList.toggle("is-selected", isSel);
        const chk = card.querySelector(".gallery-check");
        if (chk) { chk.classList.toggle("on", isSel); chk.textContent = isSel ? "✓" : ""; }
        return;
      }

      if (!act) {
        // 点击图片本体 → 灯箱（用现有 lightbox 机制）
        const rec = await Gallery.get(id);
        if (rec?.dataUrl) {
          window.open(rec.dataUrl, "_blank", "noopener");
        }
        return;
      }
      if (act === "reference") {
        const rec = await Gallery.get(id);
        if (rec) { Dlg.close(dlgGallery); await window.AIWorkspace?.reference(rec.dataUrl, "image"); }
        return;
      }
      if (act === "fav") {
        await Gallery.toggleFavorite(id);
        renderGallery();
      }
      if (act === "copy") {
        const rec = await Gallery.get(id);
        const txt = rec?.prompt || rec?.revisedPrompt || "";
        if (!txt) { toast("这张图没有可复制的 prompt"); return; }
        try { await navigator.clipboard.writeText(txt); toast("已复制 prompt"); }
        catch (_) { toast("复制失败"); }
      }
      if (act === "copy-url") {
        const rec = await Gallery.get(id);
        if (!rec?.serverUrl) { toast("还没同步到服务端"); return; }
        // serverUrl 是 /api/gallery/image/xxx.png，拼成完整 URL
        const absUrl = new URL(rec.serverUrl, location.origin).href;
        try { await navigator.clipboard.writeText(absUrl); toast("已复制公开 URL"); }
        catch (_) { toast("复制失败"); }
      }
      if (act === "set-bg") {
        // 单张设为背景：优先 serverUrl（小），否则 dataUrl
        const rec = await Gallery.get(id);
        if (!rec) return;
        const url = rec.serverUrl || rec.dataUrl;
        if (!url) { toast("这张图没有可用 URL"); return; }
        Store.settings.bgMode = "single";
        Store.settings.bgSingle = url;
        try { Store.save(); } catch (_) {}
        Bg.apply();
        try {
          const radio = document.querySelector('input[name="bg-mode"][value="single"]');
          if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
        } catch (_) {}
        toast("✨ 已设为当前背景");
      }
      if (act === "edit") {
        const rec = await Gallery.get(id);
        if (!rec) return;
        if (!window.ImageEditor) { toast("图像编辑器模块未加载"); return; }
        try {
          await window.ImageEditor.open(rec, async ({ dataUrl, prompt, model }) => {
            // 编辑结果作为新条目入图库（不覆盖原图）
            const newId = await Gallery.add({
              source: "uploaded",
              dataUrl,
              prompt: (prompt || rec.prompt || "") + " (edited)",
              name: (rec.name || "image") + "-edited.png",
              mime: "image/png",
              model: model || rec.model || "",
            });
            renderGallery();
            toast(newId ? "✏️ 编辑结果已存为图库新条目" : "保存失败");
          });
        } catch (e) {
          toast("打开编辑器失败：" + (e?.message || e), 4000);
        }
      }
      if (act === "remove") {
        if (!confirm("删除这张图？(本地 + 服务端都会删)")) return;
        const rec = await Gallery.get(id);
        await Gallery.remove(id);
        // 后台异步删服务端文件
        if (rec?.serverId) {
          const ext = (rec.mime || "image/png").split("/")[1] || "png";
          fetch(`/api/gallery/image/${rec.serverId}.${ext}`, {
            method: "DELETE",
            credentials: "same-origin",
          }).catch(() => {});
        }
        renderGallery();
      }
    });

    function initGalleryGen() {}
    function refreshGenProviders() {}
    function showGalleryTab(name) {
      if (name === "generate") { Dlg.close(dlgGallery); window.AIWorkspace?.open("image"); return; }
      $$(".gallery-tab").forEach(t => { t.classList.toggle("is-active", t.dataset.gtab === name); t.setAttribute("aria-selected", String(t.dataset.gtab === name)); });
      $$(".gallery-tabpanel").forEach(p => { p.hidden = p.dataset.gpanel !== name; });
    }
    $$(".gallery-tab").forEach(t => t.addEventListener("click", () => showGalleryTab(t.dataset.gtab)));

    return { openSessions, openGallery, flushCurrentSession, changeSession };
};
