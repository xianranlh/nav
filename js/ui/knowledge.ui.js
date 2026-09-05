/* 首页 · 星穹知识舱（Obsidian 只读 MVP） */
(function () {
  "use strict";
  if (!window.SakuraKnowledge) return;

  const api = window.SakuraKnowledge.createClient();
  const byId = (id) => document.getElementById(id);
  const trigger = byId("btn-knowledge");
  const dialog = byId("dialog-knowledge");
  if (!trigger || !dialog) return;

  const refs = {
    searchForm: byId("knowledge-search-form"),
    searchInput: byId("knowledge-search-input"),
    statusPill: byId("knowledge-status-pill"),
    recentList: byId("knowledge-recent-list"),
    recentCount: byId("knowledge-recent-count"),
    pinnedList: byId("knowledge-pinned-list"),
    pinnedCount: byId("knowledge-pinned-count"),
    tags: byId("knowledge-tags"),
    title: byId("knowledge-view-title"),
    meta: byId("knowledge-index-meta"),
    state: byId("knowledge-state"),
    results: byId("knowledge-results"),
    reader: byId("knowledge-reader"),
    readerTitle: byId("knowledge-reader-title"),
    readerPath: byId("knowledge-reader-path"),
    readerTags: byId("knowledge-reader-tags"),
    readerSummary: byId("knowledge-reader-summary"),
    readerContent: byId("knowledge-reader-content"),
    readerRelations: byId("knowledge-reader-relations"),
    readerLinks: byId("knowledge-reader-links"),
    readerBacklinks: byId("knowledge-reader-backlinks"),
    readerAssets: byId("knowledge-reader-assets"),
    readerPin: byId("knowledge-reader-pin"),
    back: byId("knowledge-back"),
    reindex: byId("knowledge-reindex"),
  };

  const store = {
    status: null,
    config: { pinnedNoteIds: [], lastQuery: "" },
    recent: [],
    pinned: [],
    tags: [],
    results: [],
    activeNote: null,
    lastMode: "overview",
    lastListTitle: "知识概览",
  };
  let debounceTimer = 0;
  let pollTimer = 0;
  let requestSerial = 0;
  let requestController = null;

  function emit(name, detail) {
    try { window.SakuraPetEvents?.emit?.(name, detail || {}); } catch (_) {}
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function replaceTextState(kind, title, message, action) {
    refs.state.dataset.kind = kind;
    const orbit = node("span", "knowledge-orbit");
    orbit.setAttribute("aria-hidden", "true");
    const heading = node("h4", "", title);
    const copy = node("p", "", message);
    const children = [orbit, heading, copy];
    if (action) {
      const button = node("button", "btn-primary", action.label);
      button.type = "button";
      button.addEventListener("click", action.run);
      children.push(button);
    }
    refs.state.replaceChildren(...children);
    refs.state.hidden = false;
    refs.results.hidden = true;
    refs.reader.hidden = true;
    refs.back.hidden = true;
  }

  function setStatus(status) {
    store.status = status;
    refs.statusPill.className = "knowledge-status-pill";
    if (!status?.enabled) {
      refs.statusPill.textContent = "未启用";
      refs.statusPill.classList.add("is-muted");
    } else if (!status.configured) {
      refs.statusPill.textContent = "未配置";
      refs.statusPill.classList.add("is-warn");
    } else if (status.indexing) {
      refs.statusPill.textContent = "索引中";
      refs.statusPill.classList.add("is-busy");
    } else if (status.errorCode) {
      refs.statusPill.textContent = "需检查";
      refs.statusPill.classList.add("is-error");
    } else {
      refs.statusPill.textContent = "已连接";
      refs.statusPill.classList.add("is-ready");
    }
    refs.meta.textContent = status?.configured
      ? `${Number(status.noteCount || 0)} 篇笔记${status.indexing ? " · 正在整理索引" : " · 索引已就绪"}`
      : "等待读取索引状态";
    refs.reindex.disabled = !status?.configured || !!status?.indexing;
  }

  function showStatusState(status) {
    if (!status.enabled) {
      replaceTextState("disabled", "Obsidian 接入未启用", "请在服务器环境变量中启用 OBSIDIAN_ENABLED，并只读挂载 Vault。", {
        label: "查看部署说明",
        run: () => window.open("https://github.com/xianranlh/nav#obsidian-%E7%9F%A5%E8%AF%86%E5%BA%93", "_blank", "noopener"),
      });
      return true;
    }
    if (!status.configured) {
      replaceTextState("unconfigured", "当前账号还没有 Vault", "服务器未找到此账号对应的 user-<id> 目录；不会回显服务器真实路径。" );
      return true;
    }
    if (status.indexing && Number(status.noteCount || 0) === 0) {
      replaceTextState("indexing", "正在建立知识索引", "首次扫描在后台进行，导航其他功能可以继续使用。" );
      scheduleStatusPoll();
      return true;
    }
    if (status.errorCode && !status.indexing) {
      replaceTextState("error", "知识索引需要检查", window.SakuraKnowledge.friendlyError(status.errorCode), {
        label: "重新索引",
        run: reindex,
      });
      return true;
    }
    if (!status.indexing && Number(status.noteCount || 0) === 0) {
      replaceTextState("empty", "Vault 中还没有 Markdown", "添加 .md 笔记后点击“重新索引”，它们就会出现在这里。" );
      return true;
    }
    return false;
  }

  function scheduleStatusPoll() {
    clearTimeout(pollTimer);
    if (!dialog.open) return;
    pollTimer = setTimeout(async () => {
      try {
        const wasIndexing = !!store.status?.indexing;
        const status = await api.status();
        setStatus(status);
        if (status.indexing) scheduleStatusPoll();
        else {
          if (wasIndexing) emit("nav:knowledge:index-done", {});
          await loadHome();
        }
      } catch (_) {}
    }, 1500);
  }

  function compactEmpty(text) {
    const empty = node("p", "knowledge-compact-empty", text);
    return empty;
  }

  function renderCompactList(container, items, emptyText, { recent = false } = {}) {
    container.replaceChildren();
    if (!items.length) {
      container.append(compactEmpty(emptyText));
      return;
    }
    for (const item of items) {
      const button = node("button", "knowledge-compact-item");
      button.type = "button";
      button.disabled = item.available === false;
      const text = node("span", "knowledge-compact-title", item.title || "不可用的笔记");
      const meta = node("small", "", item.available === false
        ? "已移动或删除"
        : recent ? window.SakuraKnowledge.formatRelativeTime(item.openedAt) : "已固定");
      button.append(text, meta);
      button.addEventListener("click", () => openNote(item.noteId));
      container.append(button);
    }
  }

  function renderSidebars() {
    refs.recentCount.textContent = store.recent.length ? String(store.recent.length) : "";
    refs.pinnedCount.textContent = store.pinned.length ? String(store.pinned.length) : "";
    renderCompactList(refs.recentList, store.recent, "打开过的笔记会留在这里", { recent: true });
    renderCompactList(refs.pinnedList, store.pinned, "可在搜索结果中固定笔记");
    refs.tags.replaceChildren();
    if (!store.tags.length) {
      refs.tags.append(compactEmpty("暂无标签"));
      return;
    }
    for (const item of store.tags) {
      const button = node("button", "knowledge-tag", `#${item.tag}`);
      button.type = "button";
      button.title = `${item.count} 篇笔记`;
      button.append(node("small", "", item.count));
      button.addEventListener("click", () => {
        refs.searchInput.value = item.tag;
        runSearch(item.tag);
      });
      refs.tags.append(button);
    }
  }

  function resultCard(item, { overview = false } = {}) {
    const card = node("article", "knowledge-result-card");
    const main = node("button", "knowledge-result-main");
    main.type = "button";
    main.append(
      node("strong", "", item.title || "未命名笔记"),
      node("p", "", item.excerpt || "这篇笔记暂时没有摘要。")
    );
    const footer = node("div", "knowledge-result-footer");
    const tags = node("span", "knowledge-result-tags", (item.tags || []).slice(0, 3).map((tag) => `#${tag}`).join("  "));
    const time = node("small", "", window.SakuraKnowledge.formatRelativeTime(item.updatedAt));
    footer.append(tags, time);
    main.append(footer);
    main.addEventListener("click", () => openNote(item.noteId));
    const pin = node("button", "knowledge-card-pin", isPinned(item.noteId) ? "已固定" : "固定");
    pin.type = "button";
    pin.setAttribute("aria-label", `${isPinned(item.noteId) ? "取消固定" : "固定"}${item.title || "笔记"}`);
    pin.setAttribute("aria-pressed", String(isPinned(item.noteId)));
    pin.addEventListener("click", () => togglePin(item.noteId));
    card.append(main, pin);
    if (overview) card.classList.add("is-overview");
    return card;
  }

  function renderResults(items, title) {
    store.lastMode = "results";
    store.lastListTitle = title;
    store.results = items;
    refs.title.textContent = title;
    refs.state.hidden = true;
    refs.reader.hidden = true;
    refs.back.hidden = true;
    refs.results.hidden = false;
    refs.results.replaceChildren();
    if (!items.length) {
      replaceTextState("no-results", "没有找到相关笔记", "换一个更短的词，或尝试输入 Frontmatter 标签。" );
      return;
    }
    refs.results.append(...items.map((item) => resultCard(item)));
  }

  function renderOverview() {
    store.lastMode = "overview";
    store.lastListTitle = "知识概览";
    refs.title.textContent = "知识概览";
    refs.state.hidden = true;
    refs.reader.hidden = true;
    refs.back.hidden = true;
    refs.results.hidden = false;
    refs.results.replaceChildren();
    const items = [...store.recent.filter((item) => item.available !== false)];
    for (const item of store.pinned) {
      if (item.available !== false && !items.some((current) => current.noteId === item.noteId)) items.push(item);
    }
    if (!items.length) {
      const intro = node("div", "knowledge-intro");
      intro.append(
        node("span", "knowledge-orbit", ""),
        node("h4", "", "你的星穹知识中枢已经连接"),
        node("p", "", "在左上方搜索标题、正文或标签。打开后的笔记会同步到所有设备。")
      );
      refs.results.append(intro);
      return;
    }
    refs.results.append(...items.slice(0, 8).map((item) => resultCard(item, { overview: true })));
  }

  function isPinned(noteId) {
    return (store.config.pinnedNoteIds || []).includes(noteId);
  }

  async function togglePin(noteId) {
    const current = store.config.pinnedNoteIds || [];
    const next = current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId];
    try {
      const result = await api.updateConfig({ pinnedNoteIds: next });
      store.config = result.config;
      store.pinned = (result.pinned || []).filter((item) => item.available !== false);
      renderSidebars();
      if (store.activeNote?.noteId === noteId) updateReaderPin();
      else if (store.lastMode === "results") renderResults(store.results, refs.title.textContent);
      else renderOverview();
    } catch (error) {
      showTransientError(error);
    }
  }

  function updateReaderPin() {
    const pinned = !!store.activeNote && isPinned(store.activeNote.noteId);
    refs.readerPin.textContent = pinned ? "已固定" : "固定";
    refs.readerPin.setAttribute("aria-pressed", String(pinned));
  }

  function assetUrl(assetId) {
    return `/api/knowledge/attachments/${encodeURIComponent(String(assetId || ""))}`;
  }

  function renderInlineParts(parts) {
    const fragment = document.createDocumentFragment();
    for (const part of Array.isArray(parts) ? parts : []) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "note" && part.noteId) {
        const button = node("button", "knowledge-inline-note", part.text || "关联笔记");
        button.type = "button";
        button.addEventListener("click", () => openNote(part.noteId, { heading: part.heading || "" }));
        fragment.append(button);
      } else if (part.type === "external" && /^https?:\/\//i.test(part.href || "")) {
        const link = node("a", "knowledge-external-link", part.text || "外部链接");
        link.href = part.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        fragment.append(link);
      } else if (part.type === "asset" && part.assetId) {
        if (/^image\/(?:png|jpeg|webp|gif|svg\+xml)$/.test(part.mimeType || "")) {
          const image = node("img", "knowledge-inline-image");
          image.src = assetUrl(part.assetId);
          image.alt = part.alt || part.name || "笔记图片";
          image.loading = "lazy";
          image.decoding = "async";
          fragment.append(image);
        } else {
          const link = node("a", "knowledge-inline-asset", `附件：${part.name || "打开"}`);
          link.href = assetUrl(part.assetId);
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          fragment.append(link);
        }
      } else if (["code", "strong", "em"].includes(part.type)) {
        const tag = part.type === "code" ? "code" : part.type;
        fragment.append(node(tag, "", part.text || ""));
      } else {
        fragment.append(document.createTextNode(String(part.text || "")));
      }
    }
    return fragment;
  }

  function renderSafeDocument(documentModel) {
    const children = [];
    for (const block of documentModel?.version === 1 && Array.isArray(documentModel.blocks) ? documentModel.blocks : []) {
      let element;
      if (block.type === "heading") {
        element = node(`h${Math.min(6, Math.max(3, Number(block.level || 1) + 2))}`, "knowledge-doc-heading");
        element.append(renderInlineParts(block.parts));
      } else if (block.type === "paragraph") {
        element = node("p", "knowledge-doc-paragraph");
        element.append(renderInlineParts(block.parts));
      } else if (block.type === "blockquote") {
        element = node("blockquote", "knowledge-doc-quote");
        element.append(renderInlineParts(block.parts));
      } else if (block.type === "code") {
        element = node("pre", "knowledge-doc-code");
        const code = node("code", "", block.text || "");
        if (block.language) code.dataset.language = String(block.language).slice(0, 40);
        element.append(code);
      } else if (block.type === "divider") {
        element = node("hr", "knowledge-doc-divider");
      } else if (block.type === "list") {
        element = node(block.ordered ? "ol" : "ul", "knowledge-doc-list");
        for (const item of Array.isArray(block.items) ? block.items : []) {
          const li = node("li");
          if (item.checked !== null && item.checked !== undefined) {
            li.append(node("span", "knowledge-task-state", item.checked ? "✓" : "○"));
          }
          li.append(renderInlineParts(item.parts));
          element.append(li);
        }
      }
      if (element) children.push(element);
    }
    if (!children.length) children.push(node("p", "knowledge-doc-empty", "这篇笔记没有正文。"));
    refs.readerContent.replaceChildren(...children);
  }

  function relationButton(item, { backlink = false } = {}) {
    const button = node("button", "knowledge-relation-item", item.title || (backlink ? "来源笔记" : "未解析的链接"));
    button.type = "button";
    button.disabled = !item.noteId;
    if (!item.noteId) button.title = "目标笔记尚未找到";
    else button.addEventListener("click", () => openNote(item.noteId));
    return button;
  }

  function renderReaderRelations(note) {
    const links = Array.isArray(note.links) ? note.links : [];
    const backlinks = Array.isArray(note.backlinks) ? note.backlinks : [];
    const assets = Array.isArray(note.assets) ? note.assets : [];
    refs.readerLinks.replaceChildren(...(links.length
      ? links.map((item) => relationButton(item))
      : [compactEmpty("没有关联笔记")]));
    refs.readerBacklinks.replaceChildren(...(backlinks.length
      ? backlinks.map((item) => relationButton(item, { backlink: true }))
      : [compactEmpty("暂无反向链接")]));
    refs.readerAssets.replaceChildren(...(assets.length ? assets.map((asset) => {
      const link = node("a", "knowledge-relation-item", `${asset.name || "附件"} · ${formatBytes(asset.sizeBytes)}`);
      link.href = assetUrl(asset.assetId);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      return link;
    }) : [compactEmpty("没有附件")]));
    refs.readerRelations.hidden = false;
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  async function openNote(noteId, { heading = "" } = {}) {
    requestController?.abort();
    const serial = ++requestSerial;
    requestController = new AbortController();
    replaceTextState("loading", "正在打开笔记", "从安全索引中读取 Markdown…" );
    emit("nav:knowledge:open", { noteId });
    try {
      await api.opened(noteId);
      const note = await api.note(noteId, requestController.signal);
      if (serial !== requestSerial) return;
      store.activeNote = note;
      refs.title.textContent = "笔记阅读";
      refs.readerTitle.textContent = note.title || "未命名笔记";
      refs.readerPath.textContent = `Obsidian 笔记 · ${window.SakuraKnowledge.formatRelativeTime(note.updatedAt)}`;
      renderSafeDocument(note.document);
      renderReaderRelations(note);
      refs.readerTags.replaceChildren(...(note.tags || []).map((tag) => node("span", "knowledge-reader-tag", `#${tag}`)));
      const summary = String(note.frontmatter?.description || "").trim();
      refs.readerSummary.textContent = summary;
      refs.readerSummary.hidden = !summary;
      updateReaderPin();
      refs.state.hidden = true;
      refs.results.hidden = true;
      refs.reader.hidden = false;
      refs.back.hidden = false;
      refs.reader.scrollTop = 0;
      if (heading) {
        requestAnimationFrame(() => {
          const target = [...refs.readerContent.querySelectorAll(".knowledge-doc-heading")]
            .find((element) => element.textContent.trim().toLocaleLowerCase() === heading.trim().toLocaleLowerCase());
          target?.scrollIntoView({ block: "start" });
        });
      }
      loadCollections().catch(() => {});
    } catch (error) {
      if (error?.name === "AbortError") return;
      emit("nav:knowledge:error", { code: error?.code || "KNOWLEDGE_UNAVAILABLE" });
      replaceTextState("error", "无法打开这篇笔记", error?.message || "笔记可能已移动，请重新索引后再试。", {
        label: "返回知识概览",
        run: renderOverview,
      });
    }
  }

  function showTransientError(error) {
    const message = error?.message || "操作没有完成，请稍后再试";
    if (window.toast) window.toast(message, 3600);
    else refs.meta.textContent = message;
  }

  async function runSearch(rawQuery) {
    const query = String(rawQuery ?? refs.searchInput.value).trim();
    clearTimeout(debounceTimer);
    if (query.length < 2) {
      requestController?.abort();
      renderOverview();
      return;
    }
    requestController?.abort();
    const serial = ++requestSerial;
    requestController = new AbortController();
    replaceTextState("searching", "正在搜索星穹知识", `查找“${query.slice(0, 30)}”相关笔记…`);
    emit("nav:knowledge:search", { queryLength: query.length });
    try {
      const response = await api.search(query, 12, requestController.signal);
      if (serial !== requestSerial) return;
      renderResults(response.items || [], `“${query.slice(0, 28)}”的搜索结果`);
      api.updateConfig({ lastQuery: query }).catch(() => {});
    } catch (error) {
      if (error?.name === "AbortError") return;
      emit("nav:knowledge:error", { code: error?.code || "KNOWLEDGE_UNAVAILABLE" });
      replaceTextState("error", "搜索暂时不可用", error?.message || "知识服务暂时无法连接。", {
        label: "重试",
        run: () => runSearch(query),
      });
    }
  }

  async function loadCollections() {
    const [recentResponse, tagResponse, configResponse] = await Promise.all([
      api.recent(20), api.tags(30), api.config(),
    ]);
    store.recent = recentResponse.items || [];
    store.tags = tagResponse.items || [];
    store.config = configResponse.config || store.config;
    store.pinned = (configResponse.pinned || []).filter((item) => item.available !== false);
    renderSidebars();
  }

  async function loadHome() {
    clearTimeout(pollTimer);
    replaceTextState("loading", "正在连接知识服务", "读取 Vault 状态与最近笔记…" );
    try {
      const status = await api.status();
      setStatus(status);
      if (showStatusState(status)) return;
      await loadCollections();
      renderOverview();
      if (status.indexing) scheduleStatusPoll();
    } catch (error) {
      setStatus({ enabled: true, configured: false, errorCode: error?.code });
      emit("nav:knowledge:error", { code: error?.code || "KNOWLEDGE_UNAVAILABLE" });
      replaceTextState("error", "知识服务暂时不可用", error?.message || "请检查服务端后再重试。", {
        label: "重新连接",
        run: loadHome,
      });
    }
  }

  async function reindex() {
    refs.reindex.disabled = true;
    emit("nav:knowledge:index-start", {});
    try {
      await api.reindex();
      const status = { ...(store.status || {}), indexing: true, configured: true };
      setStatus(status);
      replaceTextState("indexing", "正在重新整理索引", "任务已交给服务器后台处理，完成后会自动刷新。" );
      scheduleStatusPoll();
    } catch (error) {
      refs.reindex.disabled = false;
      emit("nav:knowledge:error", { code: error?.code || "KNOWLEDGE_UNAVAILABLE" });
      showTransientError(error);
    }
  }

  async function openKnowledge() {
    if (window.Dlg) window.Dlg.open(dialog);
    else dialog.showModal();
    if (window.SakuraRemote?.ready) {
      try { await window.SakuraRemote.ready; } catch (_) {}
    }
    await loadHome();
    requestAnimationFrame(() => refs.searchInput.focus({ preventScroll: true }));
  }

  trigger.addEventListener("click", openKnowledge);

  refs.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch();
  });
  refs.searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = refs.searchInput.value.trim();
    if (query.length < 2) {
      if (!query) renderOverview();
      return;
    }
    debounceTimer = setTimeout(() => runSearch(query), 250);
  });
  refs.back.addEventListener("click", () => {
    if (store.lastMode === "results" && store.results.length) renderResults(store.results, store.lastListTitle);
    else renderOverview();
  });
  refs.readerPin.addEventListener("click", () => {
    if (store.activeNote) togglePin(store.activeNote.noteId);
  });
  refs.reindex.addEventListener("click", reindex);
  dialog.addEventListener("dialog:closed", () => {
    clearTimeout(debounceTimer);
    clearTimeout(pollTimer);
    requestController?.abort();
    window.SakuraPetEvents?.bus?.clear?.("knowledge");
    trigger.focus({ preventScroll: true });
  });

  window.SakuraKnowledgeUI = {
    open: openKnowledge,
    reload: loadHome,
    async openRecent() {
      if (!dialog.open) await openKnowledge();
      try {
        const response = await api.recent(1);
        const latest = response.items?.find((item) => item.available !== false);
        if (latest) await openNote(latest.noteId);
        else showTransientError(new Error("还没有最近打开的知识笔记"));
      } catch (error) { showTransientError(error); }
    },
  };
})();
