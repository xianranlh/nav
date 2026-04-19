/* 个人导航主应用
 * - 数据模型：localStorage 持久化
 * - 功能：分组/卡片 CRUD、拖拽排序、搜索、书签导入、主题、设置
 */
(function () {
  "use strict";

  // ===================== 常量 & 工具 =====================
  const STORAGE_KEY = "sakura_nav_v1";
  const SETTINGS_KEY = "sakura_nav_settings_v1";

  const SEARCH_ENGINES = [
    { id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" },
    { id: "bing", name: "必应", url: "https://www.bing.com/search?q=%s" },
    { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
    { id: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
    { id: "zhihu", name: "知乎", url: "https://www.zhihu.com/search?type=content&q=%s" },
    { id: "github", name: "GitHub", url: "https://github.com/search?q=%s" },
    { id: "mdn", name: "MDN", url: "https://developer.mozilla.org/zh-CN/search?q=%s" },
  ];

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function toast(msg, ms = 2000) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => (t.hidden = true), 300);
    }, ms);
  }

  function safeHost(url) {
    try { return new URL(url).hostname; } catch (_) { return ""; }
  }

  function initialLetter(name, url) {
    const s = (name || safeHost(url) || "?").trim();
    if (!s) return "?";
    // 取首个字符（支持中英文）
    const ch = [...s][0];
    return ch.toUpperCase();
  }

  /** 视觉氛围预设（渐变由 CSS [data-visual-theme] 覆盖；主色用于切换主题时默认与「重置」） */
  const VISUAL_THEMES = {
    sakura: { id: "sakura", label: "樱 · 樱花", accent: "#ff8fab", fab: "🌸", aiLogo: "🌸" },
    starlight: { id: "starlight", label: "星光", accent: "#8b9fff", fab: "✨", aiLogo: "✨" },
    sycamore: { id: "sycamore", label: "梧桐叶", accent: "#c4a06e", fab: "🍂", aiLogo: "🍂" },
  };

  // ===================== 数据层 =====================
  const Store = {
    state: {
      groups: [], // [{id, name, color, links: [{id, name, url, icon, desc}]}]
    },
    settings: {
      theme: "auto",              // auto | light | dark
      engine: "bing",
      blur: 18,
      sakuraCount: 70,
      sakuraSpeed: 1.0,
      density: "normal",
      fontSize: "normal",         // small | normal | large
      radius: "normal",            // square | normal | rounded
      accent: "#ff8fab",
      glassAlpha: 0.35,
      glassSat: 1.4,
      // 背景
      bgMode: "gradient",         // gradient | single | rotate | bing | random
      bgSingle: "",
      bgList: [],
      bgRandomUrl: "",
      bgInterval: 60,              // 秒
      bgOverlay: 0,
      bgBlur: 0,
      // 本地上传背景：IndexedDB 存文件；服务端模式可存 storage:'server' + remoteUrl
      bgUpload: null,              // { kind, name, size, mime, storage?, remoteUrl? }
      // 组件
      showClock: true,
      showHitokoto: false,
      hitokotoCategory: "i",
      showFilter: true,
      showUpcoming: true,
      showWeather: true,
      weatherOnCal: true,
      showRecent: true,
      newTab: true,
      // 折叠分组
      collapsedGroups: {},
      /** 视觉氛围：sakura | starlight | sycamore（影响渐变、粒子、AI 角标等） */
      visualTheme: "sakura",
    },

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) this.state = JSON.parse(raw);
      } catch (e) { console.warn("load data failed", e); }
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) Object.assign(this.settings, JSON.parse(raw));
      } catch (e) { console.warn("load settings failed", e); }
      // 兼容旧字段：bg (单张) → bgSingle
      if (this.settings.bg && !this.settings.bgSingle) {
        this.settings.bgSingle = this.settings.bg;
        this.settings.bgMode = "single";
      }
      if (!this.settings.collapsedGroups) this.settings.collapsedGroups = {};
      if (!Array.isArray(this.state.groups)) this.state.groups = [];
      if (!this.settings.visualTheme || !VISUAL_THEMES[this.settings.visualTheme]) {
        this.settings.visualTheme = "sakura";
      }
    },

    save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); },
    /**
     * saveSettings 默认立即写；在密集 input 事件（滑块）里用 saveSettings(true)
     * 会用 rAF + 200ms 防抖折叠写入，降低 localStorage 压力。
     */
    _saveSettingsNow() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); },
    _saveTimer: null,
    saveSettings(throttled = false) {
      if (!throttled) { this._saveSettingsNow(); return; }
      if (this._saveTimer) return;
      this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        this._saveSettingsNow();
      }, 200);
    },

    findGroup(gid) { return this.state.groups.find((g) => g.id === gid); },
    findLink(lid) {
      for (const g of this.state.groups) {
        const l = g.links.find((x) => x.id === lid);
        if (l) return { group: g, link: l };
      }
      return null;
    },
  };

  /** 同一站点 favicon 请求合并；失败过的 URL 本页内不再反复请求 */
  const _faviconByPageUrl = new Map();
  const _faviconFailedPageUrl = new Set();
  /** 已成功解析的站点 -> 图标 URL（本会话内复用，减少重复探测） */
  const _faviconResolved = new Map();

  /**
   * 带合并与缓存的 favicon 解析（供卡片渲染与后台预取共用）
   */
  function getBestIconDeduped(pageUrl) {
    if (!pageUrl) return Promise.resolve(null);
    if (_faviconFailedPageUrl.has(pageUrl)) return Promise.resolve(null);
    const hit = _faviconResolved.get(pageUrl);
    if (hit) return Promise.resolve(hit);
    const BT = window.BookmarkTools;
    if (!BT || !BT.getBestIcon) return Promise.resolve(null);
    let p = _faviconByPageUrl.get(pageUrl);
    if (!p) {
      p = BT.getBestIcon(pageUrl).catch(() => null);
      _faviconByPageUrl.set(pageUrl, p);
      p.finally(() => {
        setTimeout(() => {
          if (_faviconByPageUrl.get(pageUrl) === p) _faviconByPageUrl.delete(pageUrl);
        }, 12000);
      });
    }
    return p.then((url) => {
      if (url) _faviconResolved.set(pageUrl, url);
      else _faviconFailedPageUrl.add(pageUrl);
      return url;
    });
  }

  /**
   * 首屏渲染后空闲时批量预取：按「站点」去重、并发拉取，写入 link.icon 并持久化，
   * 避免仅依赖卡片内异步链时出现「需交互后才出现图标」或刷新后丢失。
   */
  function schedulePrefetchLinkIcons() {
    const BT = window.BookmarkTools;
    if (!BT || !BT.normalizePageUrl) return;
    const run = async () => {
      const pageToLinks = new Map();
      for (const g of Store.state.groups) {
        for (const link of g.links) {
          if (link.icon) continue;
          const pu = BT.normalizePageUrl(link.url);
          if (!pu) continue;
          if (!pageToLinks.has(pu)) pageToLinks.set(pu, []);
          pageToLinks.get(pu).push(link);
        }
      }
      const entries = [...pageToLinks.entries()];
      if (!entries.length) return;
      let cursor = 0;
      const CONCURRENCY = 8;
      async function worker() {
        while (true) {
          const i = cursor++;
          if (i >= entries.length) break;
          const [pageUrl, links] = entries[i];
          const iconUrl = await getBestIconDeduped(pageUrl);
          if (!iconUrl) continue;
          for (const link of links) {
            if (link.icon) continue;
            link.icon = iconUrl;
            const card = document.querySelector(`.card[data-lid="${link.id}"]`);
            if (!card) continue;
            const slot = card.querySelector(".icon-slot");
            if (slot) renderIcon(slot, link);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker()));
      try { Store.save(); } catch (_) {}
    };
    // 立即调度：仅用 requestIdleCallback 时，部分环境要等用户交互后才空闲，图标会晚出现
    setTimeout(() => {
      run().catch((e) => console.warn("[icons] prefetch", e));
    }, 0);
  }

  // ===================== 渲染 =====================
  const groupsContainer = $("#groups-container");

  function render() {
    groupsContainer.innerHTML = "";
    for (const g of Store.state.groups) groupsContainer.appendChild(renderGroup(g));
    // 重新应用过滤
    try { Filter.apply(); } catch (_) {}
  }

  function renderGroup(g) {
    const el = document.createElement("section");
    el.className = "glass group" + (Store.settings.collapsedGroups?.[g.id] ? " collapsed" : "");
    el.dataset.gid = g.id;
    el.style.setProperty("--group-color", g.color || "#ff8fab");

    el.innerHTML = `
      <div class="group-head">
        <span class="group-handle" title="拖动以重排分组" aria-label="拖动以重排">⠿</span>
        <button class="group-toggle" data-act="toggle" title="折叠/展开">▾</button>
        <span class="group-dot"></span>
        <input class="group-name" value="${escapeHtml(g.name)}" />
        <span class="group-count">${g.links.length} 个</span>
        <div class="group-actions">
          <button data-act="color" title="分组颜色">🎨</button>
          <button data-act="up" title="上移">↑</button>
          <button data-act="down" title="下移">↓</button>
          <button data-act="del" title="删除分组">✕</button>
        </div>
      </div>
      <div class="cards"></div>
    `;

    const cards = $(".cards", el);
    const sortedLinks = [...g.links].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    for (const link of sortedLinks) cards.appendChild(renderCard(link, g));

    // "+" 添加
    const addBtn = document.createElement("button");
    addBtn.className = "card card-add";
    addBtn.title = "添加到此分组";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", () => openLinkDialog(null, g.id));
    cards.appendChild(addBtn);

    // 事件
    $(".group-name", el).addEventListener("change", (e) => {
      g.name = e.target.value.trim() || "未命名";
      Store.save();
    });

    // 折叠
    $(".group-toggle", el).addEventListener("click", (e) => {
      e.stopPropagation();
      el.classList.toggle("collapsed");
      Store.settings.collapsedGroups = Store.settings.collapsedGroups || {};
      Store.settings.collapsedGroups[g.id] = el.classList.contains("collapsed");
      Store.saveSettings();
    });

    // 整组拖拽：把组头变成"把手"
    const head = $(".group-head", el);
    head.setAttribute("draggable", "true");
    head.addEventListener("dragstart", onGroupDragStart);
    head.addEventListener("dragend", onGroupDragEnd);
    el.addEventListener("dragover", onGroupDragOver);
    el.addEventListener("dragleave", onGroupDragLeave);
    el.addEventListener("drop", onGroupDrop);

    $(".group-actions", el).addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "del") {
        if (!confirm(`删除分组 "${g.name}" 及其 ${g.links.length} 个链接？`)) return;
        Store.state.groups = Store.state.groups.filter((x) => x.id !== g.id);
        Store.save(); render();
      } else if (act === "up" || act === "down") {
        const idx = Store.state.groups.findIndex((x) => x.id === g.id);
        const t = act === "up" ? idx - 1 : idx + 1;
        if (t < 0 || t >= Store.state.groups.length) return;
        [Store.state.groups[idx], Store.state.groups[t]] = [Store.state.groups[t], Store.state.groups[idx]];
        Store.save(); render();
      } else if (act === "color") {
        pickColor(g.color || "#ff8fab").then((c) => {
          if (!c) return;
          g.color = c;
          Store.save(); render();
        });
      }
    });

    // 拖拽排序（卡片级）
    cards.addEventListener("dragover", onCardsDragOver);
    cards.addEventListener("drop", onCardsDrop);

    return el;
  }

  function renderCard(link, group) {
    const a = document.createElement("a");
    a.className = "card";
    a.href = link.url;
    a.target = Store.settings.newTab ? "_blank" : "_self";
    a.rel = "noopener noreferrer";
    a.dataset.lid = link.id;
    a.dataset.gid = group.id;
    a.title = (link.desc ? link.desc + "\n" : "") + link.url;
    a.draggable = true;

    const iconSlot = document.createElement("div");
    iconSlot.className = "icon-slot";
    a.appendChild(iconSlot);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = link.name || safeHost(link.url);
    a.appendChild(name);

    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "删除";
    del.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      group.links = group.links.filter((x) => x.id !== link.id);
      Store.save(); render();
    });
    a.appendChild(del);

    // 置顶星标按钮
    const pin = document.createElement("button");
    pin.className = "pin" + (link.pinned ? " pinned" : "");
    pin.type = "button";
    pin.textContent = link.pinned ? "★" : "☆";
    pin.title = link.pinned ? "取消置顶" : "置顶";
    pin.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      link.pinned = !link.pinned;
      Store.save(); render();
    });
    a.appendChild(pin);
    if (link.pinned) a.classList.add("pinned");

    // 点击打点
    a.addEventListener("click", () => {
      link.clickCount = (link.clickCount || 0) + 1;
      link.lastClickAt = Date.now();
      try { Store.save(); } catch (_) {}
      if (typeof UIRecent !== "undefined") UIRecent.refresh();
    });

    // 图标渲染
    renderIcon(iconSlot, link);

    // 编辑：双击
    a.addEventListener("dblclick", (e) => {
      e.preventDefault();
      openLinkDialog(link, group.id);
    });

    // 右键
    a.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, link, group);
    });

    // 拖拽
    a.addEventListener("dragstart", onCardDragStart);
    a.addEventListener("dragend", onCardDragEnd);

    return a;
  }

  function renderIcon(slot, link) {
    slot.innerHTML = "";
    const showFallback = () => {
      slot.innerHTML = "";
      const fb = document.createElement("div");
      fb.className = "fallback";
      fb.textContent = initialLetter(link.name, link.url);
      // 用 host 生成稳定色调
      const host = safeHost(link.url) || link.name || "?";
      const hash = [...host].reduce((s, c) => s + c.charCodeAt(0), 0);
      const hue = hash % 360;
      fb.style.background = `linear-gradient(135deg, hsl(${hue},70%,68%), hsl(${(hue + 40) % 360},70%,78%))`;
      slot.appendChild(fb);
    };

    const BT = window.BookmarkTools;
    const pageUrl = BT && BT.normalizePageUrl ? BT.normalizePageUrl(link.url) : null;

    function fetchAndPaintIcon() {
      if (!pageUrl || !BT || !BT.getBestIcon) {
        showFallback();
        return;
      }
      if (_faviconFailedPageUrl.has(pageUrl)) {
        showFallback();
        return;
      }
      showFallback();
      getBestIconDeduped(pageUrl).then((iconUrl) => {
        if (!iconUrl) {
          showFallback();
          return;
        }
        link.icon = iconUrl;
        try { Store.save(); } catch (_) {}
        slot.innerHTML = "";
        const img = new Image();
        img.referrerPolicy = "no-referrer";
        img.loading = "eager";
        img.decoding = "async";
        img.src = iconUrl;
        img.alt = "";
        img.onload = () => {
          if (img.naturalWidth > 0) {
            _faviconFailedPageUrl.delete(pageUrl);
            slot.appendChild(img);
          } else {
            delete link.icon;
            try { Store.save(); } catch (_) {}
            _faviconFailedPageUrl.add(pageUrl);
            showFallback();
          }
        };
        img.onerror = () => {
          delete link.icon;
          try { Store.save(); } catch (_) {}
          _faviconFailedPageUrl.add(pageUrl);
          showFallback();
        };
      });
    }

    if (link.icon) {
      showFallback();
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.loading = "eager";
      img.decoding = "async";
      img.src = link.icon;
      img.alt = "";
      img.onload = () => {
        if (img.naturalWidth > 0) {
          if (pageUrl) _faviconFailedPageUrl.delete(pageUrl);
          slot.innerHTML = "";
          slot.appendChild(img);
          return;
        }
        delete link.icon;
        try { Store.save(); } catch (_) {}
        slot.innerHTML = "";
        fetchAndPaintIcon();
      };
      img.onerror = () => {
        delete link.icon;
        try { Store.save(); } catch (_) {}
        slot.innerHTML = "";
        fetchAndPaintIcon();
      };
    } else {
      fetchAndPaintIcon();
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ===================== 拖拽排序 =====================
  let dragData = null; // { lid, gid }

  function onCardDragStart(e) {
    const a = e.currentTarget;
    dragData = { lid: a.dataset.lid, gid: a.dataset.gid };
    a.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragData.lid);
  }
  function onCardDragEnd(e) {
    e.currentTarget.classList.remove("dragging");
    $$(".drop-target").forEach((n) => n.classList.remove("drop-target"));
    dragData = null;
  }
  function onCardsDragOver(e) {
    if (!dragData) return;
    e.preventDefault();
    const target = e.target.closest(".card:not(.card-add)");
    $$(".drop-target").forEach((n) => n.classList.remove("drop-target"));
    if (target && target.dataset.lid !== dragData.lid) target.classList.add("drop-target");
  }
  function onCardsDrop(e) {
    if (!dragData) return;
    e.preventDefault();
    const targetCard = e.target.closest(".card:not(.card-add)");
    const targetGroupEl = e.currentTarget.closest(".group");
    const targetGid = targetGroupEl.dataset.gid;

    // 源与目标
    const src = Store.findLink(dragData.lid);
    if (!src) return;
    const srcGroup = src.group;
    const dstGroup = Store.findGroup(targetGid);
    if (!dstGroup) return;

    // 移除源
    srcGroup.links = srcGroup.links.filter((x) => x.id !== src.link.id);

    // 确定目标位置
    let insertIdx = dstGroup.links.length;
    if (targetCard) {
      const tlid = targetCard.dataset.lid;
      insertIdx = dstGroup.links.findIndex((x) => x.id === tlid);
      if (insertIdx < 0) insertIdx = dstGroup.links.length;
    }
    dstGroup.links.splice(insertIdx, 0, src.link);
    Store.save();
    render();
  }

  // ---- 整组拖拽 ----
  let dragGroupGid = null;

  function onGroupDragStart(e) {
    // 点击输入框/按钮发起的拖拽忽略，让它们正常交互
    if (e.target.closest("input") || e.target.closest("button")) {
      e.preventDefault();
      return;
    }
    const groupEl = e.currentTarget.closest(".group");
    dragGroupGid = groupEl.dataset.gid;
    groupEl.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/x-group", dragGroupGid); } catch (_) {}
  }
  function onGroupDragEnd(e) {
    const groupEl = e.currentTarget.closest(".group");
    groupEl?.classList.remove("dragging");
    $$(".group.drag-over").forEach((n) => n.classList.remove("drag-over"));
    dragGroupGid = null;
  }
  function onGroupDragOver(e) {
    if (!dragGroupGid || dragGroupGid === e.currentTarget.dataset.gid) return;
    // 如果正在拖的是卡片（dragData 存在），不处理组级拖拽
    if (dragData) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    e.currentTarget.classList.add("drag-over");
  }
  function onGroupDragLeave(e) {
    e.currentTarget.classList.remove("drag-over");
  }
  function onGroupDrop(e) {
    if (!dragGroupGid) return;
    if (dragData) return;
    const dstGid = e.currentTarget.dataset.gid;
    if (dstGid === dragGroupGid) return;
    e.preventDefault();
    e.stopPropagation();
    const groups = Store.state.groups;
    const from = groups.findIndex((x) => x.id === dragGroupGid);
    let to = groups.findIndex((x) => x.id === dstGid);
    if (from < 0 || to < 0) return;

    // 根据鼠标在目标元素中的上下半区决定插入位置
    const rect = e.currentTarget.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const [moved] = groups.splice(from, 1);
    // from 移除后 to 可能发生偏移
    to = groups.findIndex((x) => x.id === dstGid);
    groups.splice(before ? to : to + 1, 0, moved);
    Store.save();
    render();
  }

  // ===================== 链接 弹窗 =====================
  const dlgLink = $("#dialog-link");
  const formLink = $("#form-link");

  /** 把本地图片压缩为小 dataURL（默认 96×96 webp/png，适合作为图标） */
  async function compressImageToDataURL(file, max = 96, quality = 0.82) {
    const bitmap = await (typeof createImageBitmap === "function"
      ? createImageBitmap(file)
      : new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = URL.createObjectURL(file);
        }));
    const w = bitmap.width || bitmap.naturalWidth;
    const h = bitmap.height || bitmap.naturalHeight;
    const scale = Math.min(1, max / Math.max(w, h));
    const cvs = document.createElement("canvas");
    cvs.width = Math.max(1, Math.round(w * scale));
    cvs.height = Math.max(1, Math.round(h * scale));
    const ctx = cvs.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, cvs.width, cvs.height);
    // 优先 WebP，失败退回 PNG（保留透明）
    try {
      const webp = cvs.toDataURL("image/webp", quality);
      if (webp && webp.startsWith("data:image/webp")) return webp;
    } catch (_) {}
    return cvs.toDataURL("image/png");
  }

  function updateIconPreview(value) {
    const prev = $("#icon-picker-preview");
    if (!prev) return;
    if (value) {
      prev.innerHTML = `<img src="${escapeHtml(value)}" alt="图标预览" referrerpolicy="no-referrer" />`;
    } else {
      prev.innerHTML = `<span class="icon-picker-placeholder">未设置</span>`;
    }
  }

  function openLinkDialog(link, groupId) {
    $("#link-title").textContent = link ? "编辑网址" : "添加网址";
    const sel = $("#link-group-select");
    sel.innerHTML = Store.state.groups
      .map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
    formLink.name.value = link ? link.name : "";
    formLink.url.value = link ? link.url : "";
    formLink.icon.value = link ? (link.icon || "") : "";
    formLink.desc.value = link ? (link.desc || "") : "";
    sel.value = groupId || (link && Store.findLink(link.id)?.group.id) || Store.state.groups[0]?.id;
    formLink.dataset.editId = link ? link.id : "";
    updateIconPreview(formLink.icon.value);
    dlgLink.showModal();
    setTimeout(() => formLink.name.focus(), 50);
  }

  // 图标输入变化 → 实时预览
  $("#icon-url-input")?.addEventListener("input", (e) => {
    updateIconPreview(e.target.value.trim());
  });
  // 本地文件选择 → 压缩为 dataURL
  $("#icon-file-input")?.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const dataUrl = await compressImageToDataURL(f, 96, 0.85);
      formLink.icon.value = dataUrl;
      updateIconPreview(dataUrl);
      toast(`已载入图标（压缩后 ${Math.round(dataUrl.length / 1024)} KB）`);
    } catch (err) {
      console.warn(err);
      toast("图标处理失败：" + (err.message || err));
    } finally {
      e.target.value = "";
    }
  });
  $("#icon-clear-btn")?.addEventListener("click", () => {
    formLink.icon.value = "";
    updateIconPreview("");
  });

  formLink.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formLink));
    if (!data.url) return;
    if (!/^https?:\/\//i.test(data.url)) data.url = "https://" + data.url;

    const editId = formLink.dataset.editId;
    const dstGroup = Store.findGroup(data.groupId);
    if (!dstGroup) { dlgLink.close(); return; }

    if (editId) {
      const found = Store.findLink(editId);
      if (found) {
        // 从原组移除，加入新组（可能相同）
        found.group.links = found.group.links.filter((x) => x.id !== editId);
        Object.assign(found.link, {
          name: data.name || safeHost(data.url),
          url: data.url,
          icon: data.icon || "",
          desc: data.desc || "",
        });
        dstGroup.links.push(found.link);
      }
    } else {
      dstGroup.links.push({
        id: uid(),
        name: data.name || safeHost(data.url),
        url: data.url,
        icon: data.icon || "",
        desc: data.desc || "",
      });
    }
    Store.save();
    render();
    dlgLink.close();
  });

  // ===================== 分组 弹窗 =====================
  const dlgGroup = $("#dialog-group");
  const formGroup = $("#form-group");

  function openGroupDialog() {
    $("#group-title").textContent = "新建分组";
    formGroup.name.value = "";
    formGroup.color.value = "#f6a5c0";
    dlgGroup.showModal();
    setTimeout(() => formGroup.name.focus(), 50);
  }

  formGroup.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formGroup));
    if (!data.name) return;
    Store.state.groups.push({
      id: uid(),
      name: data.name,
      color: data.color || "#f6a5c0",
      links: [],
    });
    Store.save(); render();
    dlgGroup.close();
  });

  function pickColor(initial) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "color";
      input.value = initial || "#ff8fab";
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.appendChild(input);
      input.addEventListener("change", () => {
        resolve(input.value);
        input.remove();
      });
      input.addEventListener("blur", () => {
        setTimeout(() => { if (document.body.contains(input)) { resolve(null); input.remove(); } }, 200);
      });
      input.click();
    });
  }

  // ===================== 导入 弹窗 =====================
  const dlgImport = $("#dialog-import");
  const importFileInput = $("#import-file");
  const importPreview = $("#import-preview");
  const btnDoImport = $("#btn-do-import");
  let pendingImportGroups = null;

  importFileInput.addEventListener("change", async () => {
    const f = importFileInput.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      let groups;
      if (/\.json$/i.test(f.name) || text.trim().startsWith("{")) {
        const data = JSON.parse(text);
        if (Array.isArray(data.groups)) groups = data.groups;
        else throw new Error("JSON 格式不识别");
      } else {
        groups = BookmarkTools.parseBookmarksHTML(text);
      }
      if (!groups.length) throw new Error("未解析出任何链接");
      pendingImportGroups = groups;
      const total = groups.reduce((s, g) => s + g.links.length, 0);
      importPreview.classList.add("show");
      importPreview.innerHTML = `<b>解析成功</b>：${groups.length} 个分组，共 <b>${total}</b> 个链接<br>` +
        groups.slice(0, 8).map((g) => `· ${escapeHtml(g.name)} (${g.links.length})`).join("<br>") +
        (groups.length > 8 ? `<br>…还有 ${groups.length - 8} 个分组` : "");
      btnDoImport.disabled = false;
    } catch (e) {
      pendingImportGroups = null;
      importPreview.classList.add("show");
      importPreview.innerHTML = `<b style="color:#e04e75">解析失败：</b> ${escapeHtml(e.message)}`;
      btnDoImport.disabled = true;
    }
  });

  btnDoImport.addEventListener("click", async () => {
    if (!pendingImportGroups) return;
    const keep = $("#import-keep-folders").checked;
    const auto = $("#import-auto-icon").checked;
    const dedupe = $("#import-dedupe").checked;

    let groups = JSON.parse(JSON.stringify(pendingImportGroups));
    if (dedupe) groups = BookmarkTools.dedupe(groups);

    if (!keep) {
      // 全部合并为一个分组
      const merged = { name: "导入书签", links: [] };
      groups.forEach((g) => merged.links.push(...g.links));
      groups = [merged];
    }

    // 合并到现有
    for (const g of groups) {
      let existing = Store.state.groups.find((x) => x.name === g.name);
      if (!existing) {
        existing = { id: uid(), name: g.name, color: randomPink(), links: [] };
        Store.state.groups.push(existing);
      }
      for (const l of g.links) {
        if (dedupe && existing.links.some((x) => x.url === l.url)) continue;
        existing.links.push({
          id: uid(), name: l.name, url: l.url, icon: l.icon || "",
        });
      }
    }

    Store.save();
    render();
    dlgImport.close();
    toast(`已导入 ${groups.reduce((s, g) => s + g.links.length, 0)} 个链接`);

    if (auto) {
      // 异步并发（低并发）获取图标，避免打爆网络
      const allLinks = [];
      Store.state.groups.forEach((g) => g.links.forEach((l) => { if (!l.icon) allLinks.push(l); }));
      const CONCURRENCY = 6;
      let idx = 0, finished = 0;
      const total = allLinks.length;
      if (total === 0) return;
      toast(`正在为 ${total} 个链接获取图标…`, 2500);
      const workers = Array(Math.min(CONCURRENCY, total)).fill(0).map(async () => {
        while (idx < allLinks.length) {
          const link = allLinks[idx++];
          const url = await BookmarkTools.getBestIcon(link.url);
          if (url) link.icon = url;
          finished++;
          if (finished % 10 === 0 || finished === total) Store.save();
        }
      });
      Promise.all(workers).then(() => {
        Store.save();
        render();
        toast(`图标获取完成 (${finished}/${total})`);
      });
    }
  });

  function randomPink() {
    const colors = ["#ff8fab", "#ffc2d6", "#f6a5c0", "#c9e4ff", "#bfa6ff", "#ffd39a", "#a6e6c0"];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // ===================== 搜索 =====================
  const engineTabs = $("#engine-tabs");
  function renderEngines() {
    engineTabs.innerHTML = SEARCH_ENGINES
      .map((e) => `<button data-id="${e.id}" class="${e.id === Store.settings.engine ? "active" : ""}">${e.name}</button>`)
      .join("");
  }
  engineTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    Store.settings.engine = btn.dataset.id;
    Store.saveSettings();
    renderEngines();
  });

  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#search-input").value.trim();
    if (!q) return;
    const eng = SEARCH_ENGINES.find((x) => x.id === Store.settings.engine) || SEARCH_ENGINES[0];
    window.open(eng.url.replace("%s", encodeURIComponent(q)), Store.settings.newTab ? "_blank" : "_self");
  });

  // ===================== 一言 =====================
  const Hitokoto = {
    el: null,
    timer: null,

    async fetch() {
      const cat = Store.settings.hitokotoCategory || "i";
      const url = `https://v1.hitokoto.cn/?c=${encodeURIComponent(cat)}&encode=json`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) throw 0;
        return await r.json();
      } catch (_) {
        return null;
      } finally { clearTimeout(t); }
    },

    async refresh() {
      if (!this.el) this.el = $("#hitokoto");
      if (!this.el) return;
      const data = await this.fetch();
      if (!data) { this.el.hidden = true; return; }
      this.el.hidden = false;
      this.el.innerHTML = `${escapeHtml(data.hitokoto)}<span class="from">— ${escapeHtml(data.from || data.creator || "")}</span>`;
    },

    apply() {
      if (this.timer) clearInterval(this.timer);
      if (!this.el) this.el = $("#hitokoto");
      if (Store.settings.showHitokoto) {
        this.refresh();
        this.timer = setInterval(() => this.refresh(), 5 * 60 * 1000);
        // 点击刷新
        this.el.onclick = () => this.refresh();
        this.el.style.cursor = "pointer";
        this.el.title = "点击换一句";
      } else if (this.el) {
        this.el.hidden = true;
      }
    },
  };

  // ===================== 时钟 & 问候 =====================
  function updateClock() {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    $("#clock-time").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const weeks = ["日", "一", "二", "三", "四", "五", "六"];
    $("#clock-date").textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 星期${weeks[d.getDay()]}`;

    const h = d.getHours();
    let greet = "你好";
    if (h < 5) greet = "夜深了";
    else if (h < 9) greet = "早安";
    else if (h < 12) greet = "上午好";
    else if (h < 14) greet = "午安";
    else if (h < 18) greet = "下午好";
    else if (h < 22) greet = "晚上好";
    else greet = "夜深了";
    $("#greeting").textContent = greet + "，旅人";
  }
  setInterval(updateClock, 30_000);

  // ===================== 卡片过滤 =====================
  const Filter = {
    input: null,
    clearBtn: null,
    wrap: null,
    init() {
      this.input = $("#filter-input");
      this.clearBtn = $("#filter-clear");
      this.wrap = this.input?.parentElement;
      if (!this.input) return;
      this.input.addEventListener("input", () => this.apply());
      this.clearBtn.addEventListener("click", () => {
        this.input.value = "";
        this.apply();
        this.input.focus();
      });
    },
    apply() {
      if (!this.input) return;
      const q = this.input.value.trim().toLowerCase();
      this.clearBtn.hidden = q.length === 0;

      const cards = $$(".card:not(.card-add)");
      cards.forEach((c) => {
        if (!q) { c.classList.remove("filtered-out"); return; }
        const name = (c.querySelector(".name")?.textContent || "").toLowerCase();
        const url = (c.href || "").toLowerCase();
        const hit = name.includes(q) || url.includes(q);
        c.classList.toggle("filtered-out", !hit);
      });

      // 空分组隐藏
      $$(".group").forEach((g) => {
        const total = g.querySelectorAll(".card:not(.card-add)").length;
        const hidden = g.querySelectorAll(".card:not(.card-add).filtered-out").length;
        g.classList.toggle("group-empty-by-filter", q && total > 0 && hidden === total);
      });
    },
    setVisible(visible) {
      if (!this.wrap) return;
      this.wrap.style.display = visible ? "" : "none";
      if (!visible) { this.input.value = ""; this.apply(); }
    },
  };

  // ===================== 主题 & 样式 =====================
  function applyTheme() {
    const t = Store.settings.theme;
    if (t === "auto") {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    } else {
      document.documentElement.dataset.theme = t;
    }
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 143, 171];
  }

  function applyStyle() {
    const s = Store.settings;
    const root = document.documentElement;
    const [r, g, b] = hexToRgb(s.accent);
    // 主色
    root.style.setProperty("--accent", s.accent || "#ff8fab");
    root.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
    root.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.18)`);
    // 次色调：主色偏亮 15%
    const lighten = (v) => Math.min(255, Math.round(v + (255 - v) * 0.35));
    root.style.setProperty("--accent-2", `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`);
    // 玻璃
    root.style.setProperty("--glass-alpha", s.glassAlpha);
    root.style.setProperty("--glass-sat", s.glassSat);
    root.style.setProperty("--blur", s.blur + "px");
    // 背景遮罩
    root.style.setProperty("--bg-overlay", s.bgOverlay);
    root.style.setProperty("--bg-blur", s.bgBlur + "px");
    // 密度/字号/圆角
    root.dataset.density = s.density;
    root.dataset.fontsize = s.fontSize;
    root.dataset.radius = s.radius;
    // 主题色标签
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = s.accent || "#ff8fab";
  }

  function particleModeFromVisualTheme(vid) {
    if (vid === "starlight") return "starlight";
    if (vid === "sycamore") return "sycamore";
    return "sakura";
  }

  function applyVisualTheme() {
    const id = Store.settings.visualTheme || "sakura";
    const meta = VISUAL_THEMES[id] || VISUAL_THEMES.sakura;
    document.documentElement.dataset.visualTheme = id;
    const fab = $(".ai-fab-icon");
    if (fab) fab.textContent = meta.fab;
    $$(".ai-logo, .ai-empty-logo").forEach((el) => { el.textContent = meta.aiLogo; });
    const loginLogo = $(".login-logo");
    if (loginLogo) loginLogo.textContent = meta.aiLogo;
  }

  function syncSakuraParticles() {
    if (!window.Sakura) return;
    const s = Store.settings;
    Sakura.set({
      particleMode: particleModeFromVisualTheme(s.visualTheme),
      count: s.sakuraCount,
      speed: s.sakuraSpeed,
    });
  }

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  $("#btn-theme").addEventListener("click", () => {
    const order = ["auto", "light", "dark"];
    const idx = order.indexOf(Store.settings.theme);
    Store.settings.theme = order[(idx + 1) % order.length];
    Store.saveSettings();
    applyTheme();
    toast(`主题：${{ auto: "跟随系统", light: "亮色", dark: "暗色" }[Store.settings.theme]}`);
  });

  // ===================== 设置 =====================
  const dlgSettings = $("#dialog-settings");

  // 避免重复绑定事件
  let settingsBound = false;

  function bindSettings() {
    const s = Store.settings;
    const setV = (id, v) => { const el = $(id); if (el) el.value = v; };
    const setC = (id, v) => { const el = $(id); if (el) el.checked = !!v; };

    ["#auth-cur-user", "#auth-cur-pass", "#auth-new-user", "#auth-new-pass", "#auth-new-pass2"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    const authMsg = $("#auth-change-msg");
    if (authMsg) authMsg.textContent = "";

    // --- 回填 ---
    setV("#set-theme", s.theme);
    setV("#set-visual-theme", s.visualTheme || "sakura");
    setV("#set-accent", s.accent || "#ff8fab");
    setV("#set-fontsize", s.fontSize);
    setV("#set-radius", s.radius);
    setV("#set-density", s.density);
    setV("#set-blur", s.blur);
    setV("#set-glass-alpha", s.glassAlpha);
    setV("#set-glass-sat", s.glassSat);
    setV("#set-sakura-count", s.sakuraCount);
    setV("#set-sakura-speed", s.sakuraSpeed);
    setV("#set-bg-mode", s.bgMode);
    setV("#set-bg-single", s.bgSingle || "");
    setV("#set-bg-list", (s.bgList || []).join("\n"));
    setV("#set-bg-random", s.bgRandomUrl || "");
    setV("#set-bg-interval", s.bgInterval);
    setV("#set-bg-interval2", s.bgInterval);
    setV("#set-bg-overlay", s.bgOverlay);
    setV("#set-bg-blur", s.bgBlur);
    setV("#set-hitokoto-cat", s.hitokotoCategory);
    setC("#set-show-clock", s.showClock);
    setC("#set-show-hitokoto", s.showHitokoto);
    setC("#set-show-filter", s.showFilter);
    setC("#set-new-tab", s.newTab);
    setC("#set-show-recent", s.showRecent);
    setC("#set-show-upcoming", s.showUpcoming);
    setC("#set-cal-notify", Cal.data.settings.notify);
    // 天气
    setC("#set-show-weather", s.showWeather);
    setC("#set-weather-on-cal", s.weatherOnCal);
    if (window.Weather) {
      setC("#set-weather-auto", Weather.data.auto);
      renderCityChipList();
    }
    if (typeof UISync !== "undefined") UISync.fillForm();
    updateLabels();
    updateBgPanels();
    if (typeof StorageInspector !== "undefined" && StorageInspector.refresh) {
      StorageInspector.refresh();
    }

    if (settingsBound) return;
    settingsBound = true;

    $("#btn-auth-save")?.addEventListener("click", async () => {
      const msg = $("#auth-change-msg");
      if (msg) { msg.textContent = ""; msg.classList.remove("ok"); }
      const r = await Auth.changeCredentials(
        $("#auth-cur-user")?.value,
        $("#auth-cur-pass")?.value,
        $("#auth-new-user")?.value,
        $("#auth-new-pass")?.value,
        $("#auth-new-pass2")?.value,
      );
      if (!r.ok) {
        if (msg) { msg.textContent = r.reason || "保存失败"; msg.style.color = ""; }
        return;
      }
      try { dlgSettings.close(); } catch (_) {}
      toast("账号已更新，请重新登录…");
      location.reload();
    });

    // --- 外观 ---
    $("#set-theme").addEventListener("change", (e) => { s.theme = e.target.value; Store.saveSettings(); applyTheme(); });
    $("#set-visual-theme").addEventListener("change", (e) => {
      s.visualTheme = e.target.value || "sakura";
      const m = VISUAL_THEMES[s.visualTheme] || VISUAL_THEMES.sakura;
      s.accent = m.accent;
      const el = $("#set-accent");
      if (el) el.value = m.accent;
      Store.saveSettings();
      applyStyle();
      applyVisualTheme();
      syncSakuraParticles();
    });
    $("#set-accent").addEventListener("input", (e) => { s.accent = e.target.value; Store.saveSettings(); applyStyle(); });
    $("#set-accent-reset").addEventListener("click", () => {
      const m = VISUAL_THEMES[s.visualTheme] || VISUAL_THEMES.sakura;
      s.accent = m.accent;
      const el = $("#set-accent");
      if (el) el.value = s.accent;
      Store.saveSettings();
      applyStyle();
    });
    $("#set-fontsize").addEventListener("change", (e) => { s.fontSize = e.target.value; Store.saveSettings(); applyStyle(); });
    $("#set-radius").addEventListener("change", (e) => { s.radius = e.target.value; Store.saveSettings(); applyStyle(); });
    $("#set-density").addEventListener("change", (e) => { s.density = e.target.value; Store.saveSettings(); applyStyle(); });
    $("#set-blur").addEventListener("input", (e) => { s.blur = +e.target.value; Store.saveSettings(true); applyStyle(); updateLabels(); });
    $("#set-glass-alpha").addEventListener("input", (e) => { s.glassAlpha = +e.target.value; Store.saveSettings(true); applyStyle(); updateLabels(); });
    $("#set-glass-sat").addEventListener("input", (e) => { s.glassSat = +e.target.value; Store.saveSettings(true); applyStyle(); updateLabels(); });

    // --- 樱花 ---
    $("#set-sakura-count").addEventListener("input", (e) => {
      s.sakuraCount = +e.target.value;
      syncSakuraParticles();
      Store.saveSettings(true);
      updateLabels();
    });
    $("#set-sakura-speed").addEventListener("input", (e) => {
      s.sakuraSpeed = +e.target.value;
      syncSakuraParticles();
      Store.saveSettings(true);
      updateLabels();
    });

    // --- 背景 ---
    $("#set-bg-mode").addEventListener("change", (e) => {
      s.bgMode = e.target.value;
      updateBgPanels();
      Store.saveSettings();
      Bg.apply();
    });
    $("#set-bg-single").addEventListener("change", (e) => {
      s.bgSingle = e.target.value.trim();
      Store.saveSettings();
      if (s.bgMode === "single") Bg.apply();
    });
    $("#set-bg-list").addEventListener("change", (e) => {
      s.bgList = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean);
      Store.saveSettings();
      if (s.bgMode === "rotate") Bg.apply();
    });
    $("#set-bg-random").addEventListener("change", (e) => {
      s.bgRandomUrl = e.target.value.trim();
      Store.saveSettings();
      if (s.bgMode === "random") Bg.apply();
    });
    const bindInterval = (id) => $(id).addEventListener("input", (e) => {
      s.bgInterval = +e.target.value;
      Store.saveSettings(); updateLabels();
      Bg.apply();
    });
    bindInterval("#set-bg-interval");
    bindInterval("#set-bg-interval2");
    $("#set-bg-overlay").addEventListener("input", (e) => { s.bgOverlay = +e.target.value; Store.saveSettings(true); applyStyle(); updateLabels(); });
    $("#set-bg-blur").addEventListener("input", (e) => { s.bgBlur = +e.target.value; Store.saveSettings(true); applyStyle(); updateLabels(); });
    $("#btn-bg-next").addEventListener("click", () => Bg.next());
    $$(".presets .mini-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const url = b.dataset.preset;
        $("#set-bg-random").value = url;
        s.bgRandomUrl = url;
        Store.saveSettings();
        if (s.bgMode === "random") Bg.apply();
      });
    });

    // --- 本地上传背景 ---
    const uploadInput = $("#set-bg-upload-file");
    const uploadDrop = $("#bg-upload-drop");
    if (uploadInput && uploadDrop) {
      const handle = async (file) => {
        if (!file) return;
        const ok = await Bg.setUploadFile(file);
        if (ok) {
          setV("#set-bg-mode", Store.settings.bgMode);
          updateBgPanels();
          updateUploadPreview();
          toast("背景已更新 🌸");
        }
      };
      uploadInput.addEventListener("change", (e) => {
        const f = e.target.files && e.target.files[0];
        handle(f);
        e.target.value = ""; // 允许重复选同一文件
      });
      ["dragenter", "dragover"].forEach((ev) => {
        uploadDrop.addEventListener(ev, (e) => {
          e.preventDefault(); e.stopPropagation();
          uploadDrop.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach((ev) => {
        uploadDrop.addEventListener(ev, (e) => {
          e.preventDefault(); e.stopPropagation();
          uploadDrop.classList.remove("dragover");
        });
      });
      uploadDrop.addEventListener("drop", (e) => {
        const f = e.dataTransfer?.files && e.dataTransfer.files[0];
        handle(f);
      });
    }
    $("#btn-bg-upload-clear")?.addEventListener("click", async () => {
      await Bg.clearUpload();
      updateBgPanels();
      updateUploadPreview();
      setV("#set-bg-mode", Store.settings.bgMode);
      toast("已移除本地背景");
    });

    // --- 组件 ---
    $("#set-show-clock").addEventListener("change", (e) => {
      s.showClock = e.target.checked;
      $(".clock").style.display = s.showClock ? "" : "none";
      Store.saveSettings();
    });
    $("#set-show-hitokoto").addEventListener("change", (e) => {
      s.showHitokoto = e.target.checked;
      Store.saveSettings(); Hitokoto.apply();
    });
    $("#set-hitokoto-cat").addEventListener("change", (e) => {
      s.hitokotoCategory = e.target.value;
      Store.saveSettings(); Hitokoto.refresh();
    });
    $("#set-show-filter").addEventListener("change", (e) => {
      s.showFilter = e.target.checked;
      Store.saveSettings(); Filter.setVisible(s.showFilter);
    });
    $("#set-new-tab").addEventListener("change", (e) => {
      s.newTab = e.target.checked;
      Store.saveSettings();
      render();
    });
    $("#set-show-recent").addEventListener("change", (e) => {
      s.showRecent = e.target.checked;
      Store.saveSettings();
      if (typeof UIRecent !== "undefined") UIRecent.refresh();
    });
    $("#set-show-upcoming").addEventListener("change", (e) => {
      s.showUpcoming = e.target.checked;
      Store.saveSettings();
      UICal.renderUpcoming();
    });
    // --- 天气 ---
    $("#set-show-weather").addEventListener("change", (e) => {
      s.showWeather = e.target.checked;
      Store.saveSettings();
      if (typeof UIWeather !== "undefined") UIWeather.refresh();
    });
    $("#set-weather-on-cal").addEventListener("change", (e) => {
      s.weatherOnCal = e.target.checked;
      Store.saveSettings();
      if (window.UICalRefresh) UICalRefresh();
    });
    $("#set-weather-auto").addEventListener("change", (e) => {
      WeatherUtils.setAuto(e.target.checked);
      renderCityChipList();
      UIWeather.refresh();
    });
    $("#btn-weather-locate").addEventListener("click", async () => {
      try {
        const loc = await WeatherUtils.locateByGeolocation();
        Weather.data.auto = true;
        Weather.data.autoCity = { lat: loc.lat, lon: loc.lon, name: loc.name || "我的位置" };
        Weather.save();
        $("#set-weather-auto").checked = true;
        renderCityChipList();
        toast("已获取精确位置");
        UIWeather.refresh(true);
      } catch (e) { toast("定位失败：" + (e.message || e.code)); }
    });
    $("#btn-weather-refresh").addEventListener("click", async () => {
      try { await UIWeather.refresh(true); toast("已刷新"); }
      catch (err) { toast("刷新失败：" + err.message); }
    });

    // --- 城市搜索 ---
    const searchInput = $("#weather-city-search");
    const resultsBox = $("#weather-city-results");
    let searchTimer = null;
    let searchSeq = 0;
    let cachedResults = [];
    let activeSearchIdx = -1;

    const renderSearchResults = (items) => {
      cachedResults = items;
      activeSearchIdx = -1;
      if (!items.length) {
        resultsBox.innerHTML = `<div class="city-search-item empty">没有匹配到城市</div>`;
      } else {
        resultsBox.innerHTML = items.map((it, i) => {
          const region = [it.adm1, it.adm2].filter(Boolean).join(" · ");
          return `<div class="city-search-item" data-idx="${i}">
            <span class="cs-name">${escapeHtml(it.name)}</span>
            <span class="cs-sub">${escapeHtml(region)} · ${it.lat.toFixed(2)}, ${it.lon.toFixed(2)}</span>
          </div>`;
        }).join("");
      }
      resultsBox.hidden = false;
    };
    const addResultByIdx = (idx) => {
      const it = cachedResults[idx];
      if (!it) return;
      WeatherUtils.addCity(it);
      resultsBox.hidden = true;
      searchInput.value = "";
      renderCityChipList();
      toast(`已添加：${it.name}`);
      UIWeather.refresh(true);
    };

    searchInput?.addEventListener("input", () => {
      const q = searchInput.value.trim();
      if (searchTimer) clearTimeout(searchTimer);
      if (!q) { resultsBox.hidden = true; return; }
      const seq = ++searchSeq;
      searchTimer = setTimeout(async () => {
        try {
          // 优先 CN，失败或空再去全局
          let items = await WeatherUtils.searchCity(q, { countryCode: "CN" });
          if (!items.length) items = await WeatherUtils.searchCity(q, { countryCode: "" });
          if (seq !== searchSeq) return;
          renderSearchResults(items);
        } catch (e) {
          if (seq !== searchSeq) return;
          resultsBox.innerHTML = `<div class="city-search-item empty">搜索失败：${escapeHtml(e.message || "")}</div>`;
          resultsBox.hidden = false;
        }
      }, 250);
    });
    searchInput?.addEventListener("keydown", (e) => {
      if (resultsBox.hidden || !cachedResults.length) return;
      if (e.key === "ArrowDown") {
        activeSearchIdx = Math.min(activeSearchIdx + 1, cachedResults.length - 1); e.preventDefault();
      } else if (e.key === "ArrowUp") {
        activeSearchIdx = Math.max(activeSearchIdx - 1, 0); e.preventDefault();
      } else if (e.key === "Enter") {
        if (activeSearchIdx >= 0) { e.preventDefault(); addResultByIdx(activeSearchIdx); return; }
        if (cachedResults.length === 1) { e.preventDefault(); addResultByIdx(0); return; }
      } else if (e.key === "Escape") {
        resultsBox.hidden = true; return;
      } else { return; }
      $$("#weather-city-results .city-search-item").forEach((el, i) => el.classList.toggle("active", i === activeSearchIdx));
    });
    searchInput?.addEventListener("blur", () => { setTimeout(() => { resultsBox.hidden = true; }, 160); });
    searchInput?.addEventListener("focus", () => { if (cachedResults.length) resultsBox.hidden = false; });

    resultsBox?.addEventListener("mousedown", (e) => {
      const item = e.target.closest(".city-search-item");
      if (!item || !item.dataset.idx) return;
      e.preventDefault();
      addResultByIdx(+item.dataset.idx);
    });

    // 已添加城市 chip 列表
    $("#weather-city-list")?.addEventListener("click", (e) => {
      const chip = e.target.closest(".city-chip");
      if (!chip) return;
      const id = chip.dataset.cid;
      if (e.target.classList.contains("x")) {
        WeatherUtils.removeCity(id);
        renderCityChipList();
        UIWeather.refresh();
        return;
      }
      WeatherUtils.setActive(id);
      renderCityChipList();
      UIWeather.setViewing(id);
      if (window.UICalRefresh) try { UICalRefresh(); } catch (_) {}
      toast("已设为主城市");
    });
    $("#set-cal-notify").addEventListener("change", async (e) => {
      if (e.target.checked) {
        const r = await CalUtils.requestNotifyPermission();
        if (r !== "granted") {
          e.target.checked = false;
          toast("通知权限未授予");
          return;
        }
      }
      Cal.data.settings.notify = e.target.checked;
      Cal.save();
      CalUtils.scheduleReminders();
    });

    // --- 重置 ---
    $("#btn-reset-all").addEventListener("click", () => {
      if (!confirm("确定清空所有数据与设置？此操作不可撤销。")) return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SETTINGS_KEY);
      location.reload();
    });

    $("#btn-storage-refresh")?.addEventListener("click", () => {
      if (typeof StorageInspector !== "undefined" && StorageInspector.refresh) StorageInspector.refresh();
    });
  }

  function updateLabels() {
    const s = Store.settings;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("#set-blur-val", s.blur + "px");
    set("#set-glass-alpha-val", Math.round(s.glassAlpha * 100) + "%");
    set("#set-glass-sat-val", s.glassSat.toFixed(1));
    set("#set-sakura-count-val", s.sakuraCount);
    set("#set-sakura-speed-val", (+s.sakuraSpeed).toFixed(1));
    set("#set-bg-interval-val", s.bgInterval + "s");
    set("#set-bg-interval2-val", s.bgInterval + "s");
    set("#set-bg-overlay-val", Math.round(s.bgOverlay * 100) + "%");
    set("#set-bg-blur-val", s.bgBlur + "px");
  }

  function updateBgPanels() {
    const mode = Store.settings.bgMode;
    $$(".bg-panel").forEach((p) => p.classList.toggle("show", p.dataset.when === mode));
    updateUploadPreview();
  }

  /** 设置面板 · 已添加城市 chip 列表（★ = 主城市，× = 删除） */
  function renderCityChipList() {
    const box = $("#weather-city-list");
    if (!box || !window.WeatherUtils) return;
    const list = WeatherUtils.listCities();
    const activeId = Weather.data.activeId || "auto";
    if (!list.length) {
      box.innerHTML = `<span class="hint">还没有城市 · 在上面搜索框里添加，或打开"自动定位"</span>`;
      return;
    }
    box.innerHTML = list.map((c) => {
      const cls = "city-chip" + (c.id === activeId ? " active" : "");
      const label = c.id === "auto" ? (c.name || "自动定位") : c.name + (c.adm1 ? " · " + c.adm1 : "");
      const star = c.id === activeId ? `<span class="star">★</span>` : `<span class="star" style="opacity:.4">☆</span>`;
      return `<span class="${cls}" data-cid="${c.id}" title="${c.id === activeId ? '主城市' : '点击设为主城市'}">
        ${star}
        <span>${escapeHtml(label)}</span>
        <button type="button" class="x" title="删除">✕</button>
      </span>`;
    }).join("");
  }

  let _uploadPreviewUrl = null;
  async function updateUploadPreview() {
    const drop = $("#bg-upload-drop");
    const current = $("#bg-upload-current");
    const meta = $("#bg-upload-meta");
    if (!drop || !current) return;
    const info = Store.settings.bgUpload;
    // 清理旧预览 URL
    if (_uploadPreviewUrl) { try { URL.revokeObjectURL(_uploadPreviewUrl); } catch (_) {} _uploadPreviewUrl = null; }
    if (!info) {
      drop.classList.remove("has-file");
      current.innerHTML = "";
      if (meta) meta.textContent = "";
      return;
    }
    // 尝试拿 blob 做缩略图
    let thumbHtml = `<div class="thumb" style="background:linear-gradient(135deg, var(--accent-soft), rgba(255,255,255,.3))"></div>`;
    try {
      if (info.storage === "server" && info.remoteUrl) {
        const u = info.remoteUrl.startsWith("/") ? (location.origin + info.remoteUrl) : info.remoteUrl;
        if (info.kind === "video" || (info.mime || "").startsWith("video/")) {
          thumbHtml = `<div class="thumb"><video src=${JSON.stringify(u)} muted playsinline autoplay loop></video></div>`;
        } else {
          thumbHtml = `<div class="thumb" style="background-image:url(${JSON.stringify(u)})"></div>`;
        }
      } else {
        const blob = await BgIDB.get("bg-upload");
        if (blob) {
          const url = URL.createObjectURL(blob);
          _uploadPreviewUrl = url;
          if (info.kind === "video") {
            thumbHtml = `<div class="thumb"><video src="${url}" muted playsinline autoplay loop></video></div>`;
          } else {
            thumbHtml = `<div class="thumb" style="background-image:url(${JSON.stringify(url)})"></div>`;
          }
        }
      }
    } catch (_) {}
    drop.classList.add("has-file");
    const badge = info.kind === "video" ? "🎬 视频" : "🖼 图片";
    const srcHint = info.storage === "server" ? "服务端" : "本地";
    current.innerHTML = `
      ${thumbHtml}
      <div class="info">
        <div class="name"><span class="badge">${badge}</span>${escapeHtml(info.name || "")}</div>
        <div class="meta">${fmtSize(info.size)} · 点击可重新上传</div>
      </div>`;
    if (meta) meta.textContent = `${srcHint} · ${info.mime || ""}`;
  }

  // ===================== IndexedDB：大文件背景本体 =====================
  // localStorage 容量太小（~5MB），视频/高清图必须走 IndexedDB
  // 实际实现在 idb.js，这里只是本地别名，防止老调用路径出错
  const BgIDB = (window.NavIDB && window.NavIDB.bg) || {
    put: async () => { throw new Error("IndexedDB 不可用"); },
    get: async () => null,
    del: async () => {},
  };

  const VIDEO_EXT_RE = /\.(mp4|webm|mov|ogv|m4v)(\?|#|$)/i;
  const isVideoUrl = (u) => typeof u === "string" && VIDEO_EXT_RE.test(u);
  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    const k = 1024;
    if (bytes < k) return bytes + " B";
    if (bytes < k * k) return (bytes / k).toFixed(1) + " KB";
    return (bytes / k / k).toFixed(1) + " MB";
  }

  // ===================== 背景系统 =====================
  const Bg = {
    timer: null,
    idx: 0,
    layers: null,
    video: null,
    _currentBlobUrl: null,
    _applyToken: 0,

    init() {
      this.layers = [$("#bg-layer-a"), $("#bg-layer-b")];
      this.video = $("#bg-video");
      // 节流：页面不可见时暂停视频，回来再恢复
      document.addEventListener("visibilitychange", () => {
        if (!this.video) return;
        if (document.hidden) this.video.pause();
        else if (this.video.classList.contains("active")) this.video.play().catch(() => {});
      });
      this.apply();
    },

    stop() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    },

    async apply() {
      this.stop();
      const token = ++this._applyToken;
      const s = Store.settings;
      const body = document.body;
      if (s.bgMode === "gradient" || !s.bgMode) {
        body.classList.remove("has-bg");
        this.clearLayers();
        this.clearVideo();
        return;
      }
      body.classList.add("has-bg");

      if (s.bgMode === "upload") {
        const meta = s.bgUpload;
        if (!meta) { this.clearLayers(); this.clearVideo(); return; }
        try {
          if (meta.storage === "server" && meta.remoteUrl) {
            const raw = meta.remoteUrl.trim();
            const abs = raw.startsWith("/") ? (location.origin + raw) : raw;
            if (token !== this._applyToken) return;
            this._revokeBlobUrl();
            const isVid = meta.kind === "video" || (meta.mime || "").startsWith("video/") || isVideoUrl(raw);
            if (isVid) {
              this.clearLayers();
              this.showVideo(abs);
            } else {
              this.clearVideo();
              this.swap(abs);
            }
            return;
          }
          const blob = await BgIDB.get("bg-upload");
          if (token !== this._applyToken) return; // 已有新操作
          if (!blob) {
            toast("本地背景缺失，请重新上传", 2500);
            this.clearLayers(); this.clearVideo();
            return;
          }
          this._revokeBlobUrl();
          const url = URL.createObjectURL(blob);
          this._currentBlobUrl = url;
          if (meta.kind === "video" || (blob.type || "").startsWith("video/")) {
            this.clearLayers();
            this.showVideo(url);
          } else {
            this.clearVideo();
            this.swap(url);
          }
        } catch (e) {
          console.warn("读取本地背景失败", e);
          toast("读取本地背景失败", 2500);
        }
        return;
      }

      if (s.bgMode === "single") {
        if (!s.bgSingle) { this.clearLayers(); this.clearVideo(); return; }
        if (isVideoUrl(s.bgSingle)) {
          this.clearLayers();
          this.showVideo(s.bgSingle);
        } else {
          this.clearVideo();
          this.swap(s.bgSingle);
        }
        return;
      }
      this.clearVideo();
      if (s.bgMode === "rotate") {
        const list = (s.bgList || []).filter(Boolean);
        if (list.length === 0) return;
        this.idx = 0;
        this.swap(list[0]);
        if (list.length > 1) this.schedule(() => this.nextInList(list));
        return;
      }
      if (s.bgMode === "bing") {
        // 使用无需 CORS 的 302 重定向图片
        this.swap(bingUrl());
        // Bing 壁纸每日更新；这里每 6 小时刷新
        this.schedule(() => { this.swap(bingUrl()); }, 6 * 3600);
        return;
      }
      if (s.bgMode === "random") {
        const url = s.bgRandomUrl || "https://t.alcy.cc/ycy/";
        this.swap(cacheBust(url));
        this.schedule(() => { this.swap(cacheBust(url)); });
        return;
      }
    },

    nextInList(list) {
      this.idx = (this.idx + 1) % list.length;
      this.swap(list[this.idx]);
      this.schedule(() => this.nextInList(list));
    },

    schedule(fn, sec) {
      this.stop();
      const s = Math.max(5, sec || Store.settings.bgInterval || 60);
      this.timer = setTimeout(fn, s * 1000);
    },

    swap(url) {
      if (!this.layers || !url) return;
      const [a, b] = this.layers;
      const current = a.classList.contains("active") ? a : b;
      const next = current === a ? b : a;
      // 预加载，成功再切换
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        next.style.backgroundImage = `url(${JSON.stringify(url)})`;
        next.classList.add("active");
        current.classList.remove("active");
      };
      img.onerror = () => toast("背景加载失败：" + (safeHost(url) || "无法读取"), 2500);
      img.src = url;
    },

    showVideo(url) {
      if (!this.video) return;
      const v = this.video;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.classList.add("active");       // 先 display:block 再设 src，保证加载
      if (v.src !== url) v.src = url;
      const play = () => v.play().catch(() => {});
      if (v.readyState >= 2) play();
      else v.addEventListener("loadeddata", play, { once: true });
    },

    clearLayers() {
      if (!this.layers) return;
      this.layers.forEach((l) => {
        l.style.backgroundImage = "";
        l.classList.remove("active");
      });
    },

    clearVideo() {
      if (!this.video) return;
      const vs = (this.video.currentSrc || this.video.src || "").trim();
      this.video.classList.remove("active");
      try { this.video.pause(); } catch (_) {}
      this.video.removeAttribute("src");
      this.video.load();
      // 只撤销「视频元素正在使用的」blob:，勿调用 _revokeBlobUrl()——否则会误删即将用于图层的 upload 图片 blob
      if (vs && vs.startsWith("blob:")) {
        try { URL.revokeObjectURL(vs); } catch (_) {}
        if (this._currentBlobUrl && vs === this._currentBlobUrl) this._currentBlobUrl = null;
      }
    },

    _revokeBlobUrl() {
      if (this._currentBlobUrl) {
        try { URL.revokeObjectURL(this._currentBlobUrl); } catch (_) {}
        this._currentBlobUrl = null;
      }
    },

    next() {
      const s = Store.settings;
      if (s.bgMode === "rotate") this.nextInList((s.bgList || []).filter(Boolean));
      else if (s.bgMode === "bing") this.swap(bingUrl());
      else if (s.bgMode === "random") this.swap(cacheBust(s.bgRandomUrl || "https://t.alcy.cc/ycy/"));
    },

    // 用户上传新文件
    async setUploadFile(file) {
      if (!file) return;
      const MAX_MB = 60;
      if (file.size > MAX_MB * 1024 * 1024) {
        toast(`文件过大（${fmtSize(file.size)}），上限 ${MAX_MB}MB`, 3200);
        return false;
      }
      const kind = (file.type || "").startsWith("video/") ? "video" : "image";
      const s = Store.settings;

      if (window.SakuraMedia && SakuraMedia.enabled && SakuraMedia.uploadBg) {
        try {
          const up = await SakuraMedia.uploadBg(file);
          if (up && up.url) {
            try { await BgIDB.del("bg-upload"); } catch (_) {}
            s.bgUpload = {
              kind,
              name: file.name || (kind === "video" ? "video.mp4" : "image"),
              size: file.size,
              mime: file.type || "",
              storage: "server",
              remoteUrl: up.url,
            };
            s.bgMode = "upload";
            Store.saveSettings();
            this.apply();
            return true;
          }
        } catch (e) {
          console.warn("服务端背景上传失败，尝试本地", e);
          toast("服务端上传失败，已改存本浏览器：" + (e?.message || e), 4000);
        }
      }

      try {
        await BgIDB.put("bg-upload", file);
      } catch (e) {
        console.warn("保存到 IndexedDB 失败", e);
        toast("保存失败：" + (e?.message || e), 3000);
        return false;
      }
      s.bgUpload = {
        kind,
        name: file.name || (kind === "video" ? "video.mp4" : "image"),
        size: file.size,
        mime: file.type || "",
      };
      s.bgMode = "upload";
      Store.saveSettings();
      this.apply();
      return true;
    },

    async clearUpload() {
      const prev = Store.settings.bgUpload;
      if (prev && prev.storage === "server" && prev.remoteUrl && window.SakuraMedia && SakuraMedia.removeByUrl) {
        await SakuraMedia.removeByUrl(prev.remoteUrl);
      }
      try { await BgIDB.del("bg-upload"); } catch (_) {}
      const s = Store.settings;
      s.bgUpload = null;
      if (s.bgMode === "upload") s.bgMode = "gradient";
      Store.saveSettings();
      this.apply();
    },
  };

  function bingUrl() {
    // 多个备选：这些接口返回图片（302/直接图像）
    const picks = [
      "https://api.dujin.org/bing/1920.php",
      "https://bing.img.run/1920x1080.php",
    ];
    return cacheBust(picks[Math.floor(Math.random() * picks.length)]);
  }

  function cacheBust(url) {
    if (!url) return url;
    const sep = url.includes("?") ? "&" : "?";
    return url + sep + "_=" + Date.now();
  }

  function applyBg() { Bg.apply(); }

  // ===================== 右键菜单 =====================
  const ctxMenu = $("#ctx-menu");
  let ctxTarget = null;
  function showCtxMenu(x, y, link, group) {
    ctxTarget = { link, group };
    ctxMenu.style.left = Math.min(x, innerWidth - 180) + "px";
    ctxMenu.style.top = Math.min(y, innerHeight - 180) + "px";
    ctxMenu.hidden = false;
  }
  function hideCtxMenu() { ctxMenu.hidden = true; ctxTarget = null; }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("已复制网址"); }
    catch { toast("复制失败"); }
    finally { ta.remove(); }
  }
  document.addEventListener("click", hideCtxMenu);
  document.addEventListener("scroll", hideCtxMenu, true);
  ctxMenu.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !ctxTarget) return;
    const { link, group } = ctxTarget;
    const act = btn.dataset.act;
    if (act === "open") window.open(link.url, "_blank", "noopener");
    else if (act === "copy") {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link.url).then(
          () => toast("已复制网址"),
          () => fallbackCopy(link.url)
        );
      } else fallbackCopy(link.url);
    } else if (act === "edit") openLinkDialog(link, group.id);
    else if (act === "delete") {
      group.links = group.links.filter((x) => x.id !== link.id);
      Store.save(); render();
    }
    hideCtxMenu();
  });

  // ===================== 顶部按钮 =====================
  $("#btn-add").addEventListener("click", () => openLinkDialog(null));
  $("#btn-add-group").addEventListener("click", openGroupDialog);
  $("#btn-settings").addEventListener("click", () => { bindSettings(); dlgSettings.showModal(); });
  $("#btn-import").addEventListener("click", () => {
    pendingImportGroups = null;
    importFileInput.value = "";
    importPreview.classList.remove("show");
    importPreview.innerHTML = "";
    btnDoImport.disabled = true;
    dlgImport.showModal();
  });

  // chip 菜单展开/收起（导出）
  const exportMenu = document.querySelector(".chip-menu");
  const exportBtn = $("#btn-export");
  exportBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!exportMenu) return;
    if (!exportMenu.contains(e.target)) exportMenu.classList.remove("open");
  });
  exportMenu?.querySelector(".chip-menu-pop").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const kind = btn.dataset.export;
    if (kind === "json") exportJson();
    else if (kind === "html") exportBookmarksHtml();
    exportMenu.classList.remove("open");
  });

  function exportJson() {
    if (window.SyncUtils && typeof SyncUtils.collect === "function") {
      const blob = new Blob([JSON.stringify(SyncUtils.collect(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sakura-nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("已导出完整备份（与设置里「本地备份 JSON」相同）");
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      groups: Store.state.groups,
      settings: Store.settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sakura-nav-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已导出 JSON（仅导航与设置，精简版）");
  }

  function exportBookmarksHtml() {
    // Netscape Bookmark File Format
    const ts = Math.floor(Date.now() / 1000);
    const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file by Sakura Nav. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="${ts}" LAST_MODIFIED="${ts}" PERSONAL_TOOLBAR_FOLDER="true">樱 · 个人导航</H3>
    <DL><p>
`;
    for (const g of Store.state.groups) {
      html += `        <DT><H3 ADD_DATE="${ts}" LAST_MODIFIED="${ts}">${esc(g.name)}</H3>\n        <DL><p>\n`;
      for (const l of g.links) {
        const icon = l.icon ? ` ICON="${esc(l.icon)}"` : "";
        html += `            <DT><A HREF="${esc(l.url)}" ADD_DATE="${ts}"${icon}>${esc(l.name || l.url)}</A>\n`;
      }
      html += `        </DL><p>\n`;
    }
    html += `    </DL><p>
</DL><p>
`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sakura-bookmarks-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已导出浏览器书签 HTML");
  }

  $("#btn-import-json").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data && typeof data.schema === "string" && data.schema.startsWith("sakura-nav@")) {
          if (!window.SyncUtils || typeof SyncUtils.apply !== "function") {
            throw new Error("同步模块未加载");
          }
          if (!confirm("将用备份覆盖本地全部数据并刷新页面（与设置 → 同步与备份 → 从备份还原相同），继续？")) return;
          SyncUtils.apply(data, "replace");
          toast("已还原，正在刷新…");
          setTimeout(() => location.reload(), 600);
          return;
        }
        if (!Array.isArray(data.groups)) throw new Error("不是有效的备份（需含 schema 或为旧版 groups 数组）");
        if (!confirm("导入将覆盖当前导航数据，继续？")) return;
        Store.state.groups = data.groups;
        Store.save(); render();
        toast("已导入 JSON（仅导航分组）");
      } catch (e) {
        toast("导入失败：" + e.message, 3000);
      }
    };
    input.click();
  });

  // dialog 关闭按钮
  document.addEventListener("click", (e) => {
    if (e.target.matches("[data-close]")) {
      const d = e.target.closest("dialog");
      if (d) d.close();
    }
  });

  // ===================== 键盘快捷键 =====================
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;

    if (e.key === "/" && !inInput) {
      e.preventDefault();
      $("#search-input").focus();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openLinkDialog(null);
    } else if (!inInput && e.key.toLowerCase() === "e") {
      document.body.dataset.edit = document.body.dataset.edit === "1" ? "0" : "1";
      toast("编辑模式 " + (document.body.dataset.edit === "1" ? "已开启" : "已关闭"));
    } else if (e.key === "Escape") {
      hideCtxMenu();
    }
  });

  // ===================== 鉴权 =====================
  const loginOverlay = $("#login-overlay");
  const loginForm = $("#login-form");
  const loginUser = $("#login-user");
  const loginPass = $("#login-pass");
  const loginMsg = $("#login-msg");
  const loginRemember = $("#login-remember");

  function showLogin() {
    document.body.classList.add("pre-auth");
    loginOverlay.hidden = false;
    loginMsg.textContent = "";
    loginMsg.classList.remove("ok");
    setTimeout(() => loginUser.focus(), 100);
  }

  function hideLogin() {
    document.body.classList.remove("pre-auth");
    loginOverlay.hidden = true;
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector("button[type=submit]");
    btn.disabled = true;
    loginMsg.classList.remove("ok");
    loginMsg.textContent = "正在验证…";
    const r = await Auth.login(loginUser.value.trim(), loginPass.value, loginRemember.checked);
    btn.disabled = false;
    if (!r.ok) {
      loginMsg.textContent = r.reason || "登录失败";
      loginForm.classList.remove("shake");
      void loginForm.offsetWidth;
      loginForm.animate(
        [
          { transform: "translateX(-10px)" },
          { transform: "translateX(10px)" },
          { transform: "translateX(-6px)" },
          { transform: "translateX(6px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 320 }
      );
      loginPass.select();
      return;
    }
    loginMsg.classList.add("ok");
    loginMsg.textContent = "登录成功 🌸";
    loginPass.value = "";
    setTimeout(async () => {
      hideLogin();
      await bootApp();
    }, 250);
  });

  $("#btn-logout").addEventListener("click", () => {
    if (!confirm("确定退出登录？（本地数据不会被删除）")) return;
    Auth.logout();
    location.reload();
  });

  // 登录超时自动刷新：每 5 分钟检查一次
  setInterval(async () => {
    if (!(await Auth.isAuthed())) {
      toast("登录已过期，请重新登录");
      setTimeout(() => location.reload(), 1500);
    }
  }, 5 * 60 * 1000);

  // ===================== 初始化 =====================
  let booted = false;
  async function bootApp() {
    if (booted) return;
    booted = true;
    document.body.classList.remove("pre-auth");
    Store.load();
    AI.AIStore.load();
    Blog.load();
    Cal.load();
    if (window.Sync) Sync.load();
    if (window.Weather) Weather.load();
    applyTheme();
    applyStyle();
    Bg.init();

    renderEngines();
    updateClock();
    if (!Store.settings.showClock) $(".clock").style.display = "none";

    Filter.init();
    Filter.setVisible(Store.settings.showFilter);

    Hitokoto.apply();

    render();
    Filter.apply();
    schedulePrefetchLinkIcons();

    Sakura.init({
      count: Store.settings.sakuraCount,
      speed: Store.settings.sakuraSpeed,
      particleMode: particleModeFromVisualTheme(Store.settings.visualTheme),
    });
    applyVisualTheme();

    // 注册 service worker（仅 http/https 环境）
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }

    UICal.init();
    if (typeof UIWeather !== "undefined") UIWeather.init();
    if (typeof UISync !== "undefined") UISync.init();
    if (window.SakuraRemote && SakuraRemote.ready) {
      SakuraRemote.ready.then(() => {
        if (typeof UISync !== "undefined" && UISync.refreshRemotePanel) UISync.refreshRemotePanel();
      }).catch(() => {});
    }
    if (typeof UIVoice !== "undefined") UIVoice.init();
    if (typeof UISuggest !== "undefined") UISuggest.init();
    if (typeof UIRecent !== "undefined") UIRecent.init();
    if (typeof UIBlogExport !== "undefined") UIBlogExport.init();

    // 自动同步：劫持 save
    if (window.SyncUtils) {
      const wrap = (obj) => {
        if (!obj || obj.__syncWrapped) return;
        const orig = obj.save.bind(obj);
        obj.save = function () { orig(); SyncUtils.schedulePush(); };
        obj.__syncWrapped = true;
      };
      wrap(Store);
      wrap(Cal);
      wrap(Blog);
      wrap(AI.AIStore);
      // Store.saveSettings 也单独拦截
      if (Store.saveSettings && !Store.__ssWrapped) {
        const orig = Store.saveSettings.bind(Store);
        Store.saveSettings = function () { orig(); SyncUtils.schedulePush(); };
        Store.__ssWrapped = true;
      }
    }

    // 粘贴网址快速添加
    document.addEventListener("paste", (e) => {
      if (document.activeElement?.tagName === "INPUT") return;
      const text = (e.clipboardData || window.clipboardData).getData("text");
      if (/^https?:\/\//i.test(text)) {
        openLinkDialog(null);
        setTimeout(() => {
          formLink.url.value = text;
          formLink.name.focus();
        }, 100);
      }
    });
  }

  // 将关键接口暴露给 AI / Blog 模块使用
  window.Store = Store;
  window.render = render;
  window.toast = toast;

  // ===================== AI 模块接入 =====================
  const UIAI = (() => {
    const panel = $("#ai-panel");
    const fab = $("#ai-fab");
    const messagesEl = $("#ai-messages");
    const input = $("#ai-input");
    const sendBtn = $("#ai-send");
    const stopBtn = $("#ai-stop");
    const tipEl = $("#ai-tip");
    const attachInput = $("#ai-attach-input");
    const attachPreview = $("#ai-attach-preview");
    const modelSel = $("#ai-model-select");
    const personaSel = $("#ai-persona-select");

    let attachments = [];
    let abortCtrl = null;

    function open() { panel.hidden = false; fab.classList.remove("has-new"); setTimeout(() => input.focus(), 100); refreshPersonaOptions(); refreshModelOptions(); renderMessages(); }
    function close() { panel.hidden = true; }

    function refreshPersonaOptions() {
      personaSel.innerHTML = AI.AIStore.data.personas.map((p) =>
        `<option value="${p.id}" ${p.id === AI.AIStore.data.currentPersonaId ? "selected" : ""}>${escapeHtml(p.name)}</option>`
      ).join("");
    }

    function refreshModelOptions() {
      const p = AI.AIStore.currentProvider();
      if (!p) { modelSel.innerHTML = `<option value="">请先添加供应商</option>`; return; }
      const models = (p.models && p.models.length ? p.models : [p.defaultModel || "default"]).filter(Boolean);
      modelSel.innerHTML = models.map((m) =>
        `<option value="${escapeHtml(m)}" ${m === AI.AIStore.data.currentModel ? "selected" : ""}>${escapeHtml(m)}</option>`
      ).join("");
      if (!AI.AIStore.data.currentModel) AI.AIStore.data.currentModel = models[0];
    }

    personaSel.addEventListener("change", () => {
      AI.AIStore.data.currentPersonaId = personaSel.value;
      AI.AIStore.save();
    });
    modelSel.addEventListener("change", () => {
      AI.AIStore.data.currentModel = modelSel.value;
      AI.AIStore.save();
    });

    $("#ai-refresh-models").addEventListener("click", async () => {
      const p = AI.AIStore.currentProvider();
      if (!p) { toast("请先在 AI 设置中添加供应商"); return; }
      tipEl.textContent = "正在拉取模型列表…";
      try {
        const ms = await AI.fetchModels(p);
        p.models = ms;
        AI.AIStore.save();
        refreshModelOptions();
        tipEl.textContent = `已加载 ${ms.length} 个模型`;
        setTimeout(() => tipEl.textContent = "", 2500);
      } catch (e) {
        tipEl.classList.add("err");
        tipEl.textContent = "拉取失败：" + e.message.slice(0, 120);
        setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 4000);
      }
    });

    $("#ai-clear").addEventListener("click", () => {
      if (!confirm("清空当前会话？对话历史不可恢复。")) return;
      AI.AIStore.messages = [];
      AI.AIStore.saveMessages();
      renderMessages();
    });
    $("#ai-close").addEventListener("click", close);
    // Esc 关闭面板；若当前有 <dialog open>（含 AI 设置）则交给弹窗，不抢 Esc
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || panel.hidden) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      close();
    });
    $("#ai-open-settings").addEventListener("click", () => {
      const wasOpen = !panel.hidden;
      close();
      openAISettings();
      dlgAI.addEventListener("close", function reopen() {
        dlgAI.removeEventListener("close", reopen);
        if (wasOpen) open();
      });
    });
    fab.addEventListener("click", open);

    // 建议按钮
    messagesEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ai-suggest]");
      if (b) { input.value = b.dataset.aiSuggest; input.focus(); autoResize(); }
    });

    // 附件
    attachInput.addEventListener("change", async () => {
      for (const f of attachInput.files) {
        try { attachments.push(await AI.fileToAttachment(f)); }
        catch (err) { toast("读取失败：" + err.message); }
      }
      attachInput.value = "";
      renderAttachments();
    });

    function renderAttachments() {
      attachPreview.innerHTML = "";
      attachments.forEach((a, i) => {
        const el = document.createElement("span");
        el.className = "ai-attach-item";
        el.innerHTML = a.type === "image"
          ? `<img src="${a.dataUrl}"><span class="name">${escapeHtml(a.name)}</span><button class="x" data-i="${i}" type="button">×</button>`
          : `📄<span class="name">${escapeHtml(a.name)}</span><button class="x" data-i="${i}" type="button">×</button>`;
        attachPreview.appendChild(el);
      });
    }
    attachPreview.addEventListener("click", (e) => {
      const b = e.target.closest(".x");
      if (!b) return;
      attachments.splice(+b.dataset.i, 1);
      renderAttachments();
    });

    // 发送
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    input.addEventListener("input", autoResize);
    function autoResize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; }

    sendBtn.addEventListener("click", send);
    stopBtn.addEventListener("click", () => { abortCtrl?.abort(); });

    async function send() {
      const text = input.value.trim();
      if (!text && !attachments.length) return;
      const provider = AI.AIStore.currentProvider();
      if (!provider) {
        tipEl.classList.add("err");
        tipEl.textContent = "请先在 AI 设置中添加供应商";
        setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 3500);
        return;
      }
      const model = AI.AIStore.data.currentModel || provider.defaultModel;
      if (!model) { toast("请先选择模型"); return; }

      const userMsg = {
        role: "user",
        content: text,
        ts: Date.now(),
        attachments: attachments.map((a) => a.type === "image"
          ? { type: "image", name: a.name, dataUrl: a.dataUrl }
          : { type: "text", name: a.name, text: (a.text || "").slice(0, 500) + (a.text?.length > 500 ? "…" : "") }),
      };
      AI.AIStore.messages.push(userMsg);
      AI.AIStore.saveMessages();

      const asstMsg = { role: "assistant", content: "", ts: Date.now(), streaming: true };
      AI.AIStore.messages.push(asstMsg);
      renderMessages();

      const currentAttachments = attachments.slice();
      input.value = "";
      attachments = [];
      renderAttachments();
      autoResize();

      stopBtn.hidden = false;
      sendBtn.hidden = true;
      tipEl.textContent = "正在思考…";

      abortCtrl = new AbortController();

      try {
        const msgs = await AI.buildMessages(text, currentAttachments);
        await AI.chat({
          provider, model, messages: msgs, signal: abortCtrl.signal,
          onDelta: (_d, full) => {
            asstMsg.content = full;
            const bubble = messagesEl.querySelector(".ai-msg:last-child .ai-bubble");
            if (bubble) bubble.innerHTML = renderAssistantContent(full);
            scrollToBottom();
          },
        });
        asstMsg.streaming = false;
        // 解析指令块，生成操作卡
        const actions = AI.parseActions(asstMsg.content);
        if (actions.length) asstMsg.actions = actions;
        if (actions.length && AI.AIStore.data.autoApply) {
          const r = AI.applyActions(actions);
          asstMsg.applied = true;
          asstMsg.appliedResult = r;
          toast(`已自动执行 ${r.ok} 项指令`);
        }
        AI.AIStore.saveMessages();
        renderMessages();
        tipEl.textContent = "";
      } catch (err) {
        asstMsg.streaming = false;
        if (err.name === "AbortError") asstMsg.content += "\n\n_[已取消]_";
        else asstMsg.content = `**出错了：** ${err.message}`;
        AI.AIStore.saveMessages();
        renderMessages();
        tipEl.classList.add("err");
        tipEl.textContent = err.message?.slice(0, 160) || "网络错误";
        setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 5000);
      } finally {
        abortCtrl = null;
        stopBtn.hidden = true;
        sendBtn.hidden = false;
      }
    }

    function renderMessages() {
      const ms = AI.AIStore.messages;
      if (!ms.length) {
        messagesEl.innerHTML = messagesEl.querySelector(".ai-empty") ? messagesEl.innerHTML :
          `<div class="ai-empty">
            <div class="ai-empty-logo">🌸</div>
            <p>让 AI 帮你整理导航页。</p>
          </div>`;
        return;
      }
      messagesEl.innerHTML = "";
      ms.forEach((m, idx) => {
        const el = document.createElement("div");
        el.className = "ai-msg " + m.role;
        el.innerHTML = `
          <div class="ai-avatar">${m.role === "user" ? "我" : "🌸"}</div>
          <div class="ai-bubble"></div>
        `;
        const bubble = el.querySelector(".ai-bubble");
        if (m.role === "user") {
          bubble.innerHTML = renderUserContent(m);
        } else {
          bubble.innerHTML = renderAssistantContent(m.content, m);
          if (m.content && !m.streaming) {
            const tts = document.createElement("button");
            tts.className = "tts-btn";
            tts.type = "button";
            tts.title = "朗读 / 停止";
            tts.textContent = "🔊";
            tts.addEventListener("click", (e) => {
              e.stopPropagation();
              window.AITts.speak(m.content, tts);
            });
            bubble.appendChild(tts);
          }
        }
        messagesEl.appendChild(el);
      });
      scrollToBottom();
    }

    function renderUserContent(m) {
      let html = escapeHtml(m.content || "").replace(/\n/g, "<br>");
      if (m.attachments?.length) {
        html += `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">` +
          m.attachments.map((a) => a.type === "image"
            ? `<img class="ai-inline-img" src="${a.dataUrl}" style="max-height:120px" />`
            : `<span class="ai-attach-item">📄${escapeHtml(a.name)}</span>`
          ).join("") + `</div>`;
      }
      return html;
    }

    function renderAssistantContent(text, msg) {
      let html = AI.renderMarkdown(text || "");
      // 替换指令块占位符
      html = html.replace(/<div class="ai-action-placeholder" data-code="([^"]*)"><\/div>/g, (_, code) => {
        try {
          const raw = code.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) return "";
          return renderActionCard(arr, msg);
        } catch (_) { return ""; }
      });
      // 如果消息已 applied
      if (msg?.applied && msg.appliedResult) {
        html += `<div class="ai-action-card applied"><h5>✓ 已执行（${msg.appliedResult.ok} 成功 / ${msg.appliedResult.fail} 失败）</h5><ol>${msg.appliedResult.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ol></div>`;
      }
      return html;
    }

    function renderActionCard(arr, msg) {
      const items = arr.map((a) => {
        const cls = a.op.startsWith("add") ? "op-add" : a.op.startsWith("delete") ? "op-delete" : "op-rename";
        return `<li><span class="badge ${cls}">${a.op}</span>${escapeHtml(JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='op'))))}</li>`;
      }).join("");
      const id = "act-" + Math.random().toString(36).slice(2, 8);
      return `<div class="ai-action-card" data-actid="${id}"><h5>🛠 AI 请求执行以下操作</h5><ol>${items}</ol>
        <div class="ai-action-apply">
          <button class="btn-apply" data-apply="${id}">✅ 应用</button>
          <button class="btn-ignore" data-apply="${id}" data-ignore="1">忽略</button>
        </div></div>`;
    }

    // 指令卡应用/忽略
    messagesEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-apply]");
      if (!btn) return;
      const id = btn.dataset.apply;
      const card = messagesEl.querySelector(`.ai-action-card[data-actid="${id}"]`);
      if (!card) return;
      // 找对应消息
      const msgEl = btn.closest(".ai-msg");
      const idx = [...messagesEl.children].indexOf(msgEl);
      const msg = AI.AIStore.messages[idx];
      if (!msg || !msg.actions) return;
      if (btn.dataset.ignore) {
        card.classList.add("applied");
        card.querySelector("h5").textContent = "✕ 已忽略";
        msg.applied = true;
        msg.appliedResult = { ok: 0, fail: 0, notes: ["用户忽略"] };
      } else {
        const r = AI.applyActions(msg.actions);
        msg.applied = true;
        msg.appliedResult = r;
        card.classList.add("applied");
        toast(`已应用 ${r.ok} 项指令`);
      }
      AI.AIStore.saveMessages();
      renderMessages();
    });

    function scrollToBottom() {
      requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
    }

    // 灯箱预览
    messagesEl.addEventListener("click", (e) => {
      const img = e.target.closest(".ai-inline-img");
      if (!img) return;
      openLightbox(img.src);
    });

    function openLightbox(src) {
      let box = $(".ai-lightbox");
      if (!box) {
        box = document.createElement("div");
        box.className = "ai-lightbox";
        box.innerHTML = `<img>`;
        box.addEventListener("click", () => box.hidden = true);
        document.body.appendChild(box);
      }
      box.querySelector("img").src = src;
      box.hidden = false;
    }

    // 拖拽文件到输入框
    panel.addEventListener("dragover", (e) => { e.preventDefault(); });
    panel.addEventListener("drop", async (e) => {
      e.preventDefault();
      for (const f of e.dataTransfer.files) {
        try { attachments.push(await AI.fileToAttachment(f)); }
        catch (_) {}
      }
      renderAttachments();
    });

    return { open, close, refreshPersonaOptions, refreshModelOptions, renderMessages };
  })();

  // ===================== AI 设置 UI =====================
  const dlgAI = $("#dialog-ai");
  const dlgProvider = $("#dialog-provider");
  const dlgPersona = $("#dialog-persona");

  function openAISettings() {
    renderAIProviders();
    renderAIPersonas();
    $("#ai-signature").value = AI.AIStore.data.customSignature || "";
    $("#ai-auto-apply").checked = !!AI.AIStore.data.autoApply;
    dlgAI.showModal();
  }

  $("#ai-signature").addEventListener("change", (e) => {
    AI.AIStore.data.customSignature = e.target.value;
    AI.AIStore.save();
  });
  $("#ai-auto-apply").addEventListener("change", (e) => {
    AI.AIStore.data.autoApply = e.target.checked;
    AI.AIStore.save();
  });

  function renderAIProviders() {
    const list = $("#ai-providers-list");
    const curId = AI.AIStore.data.currentProviderId;
    list.innerHTML = AI.AIStore.data.providers.map((p) => `
      <div class="ai-provider-item ${p.id === curId ? "active" : ""}" data-id="${p.id}">
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="meta">${escapeHtml(p.baseUrl)}${p.models?.length ? ` · ${p.models.length} 模型` : ""}</span>
        <div class="actions">
          <button data-act="use">${p.id === curId ? "当前" : "选用"}</button>
          <button data-act="fetch">刷新模型</button>
          <button data-act="edit">编辑</button>
          <button data-act="del">删除</button>
        </div>
      </div>
    `).join("") || `<div class="hint">暂无供应商，点击下方"添加"。</div>`;
  }

  $("#ai-providers-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const item = btn.closest(".ai-provider-item");
    const id = item?.dataset.id;
    const p = AI.AIStore.data.providers.find((x) => x.id === id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === "use") {
      AI.AIStore.data.currentProviderId = id;
      AI.AIStore.data.currentModel = p.defaultModel || (p.models || [])[0] || "";
      AI.AIStore.save();
      renderAIProviders();
      UIAI.refreshModelOptions();
    } else if (act === "fetch") {
      btn.textContent = "…";
      try {
        const ms = await AI.fetchModels(p);
        p.models = ms;
        AI.AIStore.save();
        toast(`已加载 ${ms.length} 个模型`);
        renderAIProviders();
        UIAI.refreshModelOptions();
      } catch (err) {
        toast("拉取失败：" + err.message.slice(0, 80), 3500);
      }
      btn.textContent = "刷新模型";
    } else if (act === "edit") {
      openProviderDialog(p);
    } else if (act === "del") {
      if (!confirm(`删除供应商 "${p.name}"？`)) return;
      AI.AIStore.data.providers = AI.AIStore.data.providers.filter((x) => x.id !== id);
      if (AI.AIStore.data.currentProviderId === id) AI.AIStore.data.currentProviderId = (AI.AIStore.data.providers[0] || {}).id || "";
      AI.AIStore.save();
      renderAIProviders();
      UIAI.refreshModelOptions();
    }
  });

  $("#ai-add-provider").addEventListener("click", () => openProviderDialog(null));
  const presets = {
    openai:   { name: "OpenAI",   baseUrl: "https://api.openai.com/v1",           defaultModel: "gpt-4o-mini" },
    deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1",         defaultModel: "deepseek-chat" },
    kimi:     { name: "Kimi",     baseUrl: "https://api.moonshot.cn/v1",          defaultModel: "moonshot-v1-8k" },
    ollama:   { name: "Ollama 本地", baseUrl: "http://localhost:11434/v1",         defaultModel: "llama3" },
  };
  Object.keys(presets).forEach((k) => {
    $("#ai-add-preset-" + k).addEventListener("click", () => openProviderDialog(null, presets[k]));
  });

  function openProviderDialog(existing, preset) {
    const f = $("#form-provider");
    $("#provider-title").textContent = existing ? "编辑 AI 供应商" : "添加 AI 供应商";
    f.reset();
    if (existing) {
      f.name.value = existing.name;
      f.baseUrl.value = existing.baseUrl;
      f.apiKey.value = existing.apiKey || "";
      f.defaultModel.value = existing.defaultModel || "";
    } else if (preset) {
      f.name.value = preset.name;
      f.baseUrl.value = preset.baseUrl;
      f.defaultModel.value = preset.defaultModel;
    }
    f.dataset.editId = existing ? existing.id : "";
    dlgProvider.showModal();
  }

  $("#form-provider").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    const editId = f.dataset.editId;
    if (editId) {
      const p = AI.AIStore.data.providers.find((x) => x.id === editId);
      if (p) Object.assign(p, data);
    } else {
      const newP = Object.assign({ id: AI.uid(), models: [] }, data);
      AI.AIStore.data.providers.push(newP);
      if (!AI.AIStore.data.currentProviderId) AI.AIStore.data.currentProviderId = newP.id;
    }
    AI.AIStore.save();
    dlgProvider.close();
    renderAIProviders();
    UIAI.refreshModelOptions();
  });

  // ---- Personas ----
  function renderAIPersonas() {
    const list = $("#ai-personas-list");
    const curId = AI.AIStore.data.currentPersonaId;
    list.innerHTML = AI.AIStore.data.personas.map((p) => `
      <div class="ai-persona-item ${p.id === curId ? "active" : ""}" data-id="${p.id}">
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="meta">${escapeHtml((p.prompt || "").slice(0, 60))}${p.prompt?.length > 60 ? "..." : ""}</span>
        <div class="actions">
          <button data-act="use">${p.id === curId ? "当前" : "选用"}</button>
          <button data-act="edit">编辑</button>
          <button data-act="del">删除</button>
        </div>
      </div>
    `).join("");
  }

  $("#ai-personas-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.closest(".ai-persona-item").dataset.id;
    const p = AI.AIStore.data.personas.find((x) => x.id === id);
    const act = btn.dataset.act;
    if (act === "use") {
      AI.AIStore.data.currentPersonaId = id;
      AI.AIStore.save();
      renderAIPersonas();
      UIAI.refreshPersonaOptions();
    } else if (act === "edit") openPersonaDialog(p);
    else if (act === "del") {
      if (!confirm(`删除角色 "${p.name}"？`)) return;
      AI.AIStore.data.personas = AI.AIStore.data.personas.filter((x) => x.id !== id);
      if (AI.AIStore.data.currentPersonaId === id) AI.AIStore.data.currentPersonaId = (AI.AIStore.data.personas[0] || {}).id || "";
      AI.AIStore.save();
      renderAIPersonas();
      UIAI.refreshPersonaOptions();
    }
  });

  $("#ai-add-persona").addEventListener("click", () => openPersonaDialog(null));

  function openPersonaDialog(existing) {
    const f = $("#form-persona");
    $("#persona-title").textContent = existing ? "编辑角色" : "添加角色";
    f.reset();
    if (existing) { f.name.value = existing.name; f.prompt.value = existing.prompt; f.dataset.editId = existing.id; }
    else f.dataset.editId = "";
    dlgPersona.showModal();
  }

  $("#form-persona").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    const editId = f.dataset.editId;
    if (editId) {
      const p = AI.AIStore.data.personas.find((x) => x.id === editId);
      if (p) Object.assign(p, data);
    } else {
      AI.AIStore.data.personas.push({ id: AI.uid(), name: data.name, prompt: data.prompt });
    }
    AI.AIStore.save();
    dlgPersona.close();
    renderAIPersonas();
    UIAI.refreshPersonaOptions();
  });

  // ===================== 博客 =====================
  const UIBlog = (() => {
    const panel = $("#blog-panel");
    const listEl = $("#blog-list");
    const detailEl = $("#blog-detail");
    const tagsEl = $("#blog-tags");
    const searchEl = $("#blog-search");
    const newBtn = $("#blog-new-post");
    const adminBtn = $("#blog-admin-toggle");
    let activeTag = "";

    function open() { panel.hidden = false; detailEl.hidden = true; render(); }
    function close() { panel.hidden = true; }

    function render() {
      // 标签
      const tags = Blog.allTags();
      tagsEl.innerHTML = `<button class="blog-tag ${!activeTag ? "active" : ""}" data-tag="">全部</button>` +
        tags.map((t) => `<button class="blog-tag ${t === activeTag ? "active" : ""}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("");
      // 列表
      const posts = Blog.list({
        tag: activeTag || undefined,
        query: searchEl.value.trim() || undefined,
        includeDraft: Blog.data.adminMode,
      });
      if (!posts.length) {
        listEl.innerHTML = `<div class="hint" style="grid-column:1/-1;text-align:center;padding:40px">暂无文章${Blog.data.adminMode ? "，点击"+ "写文章"+ "开始" : ""}。</div>`;
      } else {
        listEl.innerHTML = posts.map((p) => `
          <article class="blog-card" data-id="${p.id}">
            ${p.cover ? `<div class="cover" style="background-image:url(${JSON.stringify(p.cover)})"></div>` : ""}
            ${!p.published ? `<span class="draft-badge">草稿</span>` : ""}
            <h3>${escapeHtml(p.title)}</h3>
            <p class="excerpt">${escapeHtml((p.content || "").replace(/^#\s+.*\n/, "").replace(/[#*\[\]`]/g, "").slice(0, 180))}</p>
            <div class="meta">
              <div class="tags">${(p.tags || []).slice(0, 3).map((t) => `<span>${escapeHtml(t)}</span>`).join("")}</div>
              <span>${new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
          </article>
        `).join("");
      }
      adminBtn.textContent = Blog.data.adminMode ? "退出管理" : "后台管理";
      newBtn.hidden = !Blog.data.adminMode;
    }

    tagsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tag]");
      if (!b) return;
      activeTag = b.dataset.tag;
      render();
    });
    searchEl.addEventListener("input", () => render());

    listEl.addEventListener("click", (e) => {
      const card = e.target.closest(".blog-card");
      if (!card) return;
      const id = card.dataset.id;
      if (Blog.data.adminMode) openPostDialog(Blog.get(id));
      else openDetail(id);
    });

    $("#blog-close").addEventListener("click", close);
    adminBtn.addEventListener("click", () => {
      Blog.data.adminMode = !Blog.data.adminMode;
      Blog.save();
      render();
    });
    newBtn.addEventListener("click", () => openPostDialog(null));

    function openDetail(id) {
      const p = Blog.get(id);
      if (!p) return;
      detailEl.hidden = false;
      listEl.style.display = "none";
      tagsEl.style.display = "none";
      detailEl.innerHTML = `
        <button class="back-btn">← 返回列表</button>
        ${p.cover ? `<img src="${escapeHtml(p.cover)}" style="width:100%;border-radius:14px;margin-bottom:20px" />` : ""}
        <h1 style="font-size:30px;margin:0 0 8px">${escapeHtml(p.title)}</h1>
        <div style="color:var(--text-faint);font-size:13px;margin-bottom:24px">
          ${new Date(p.createdAt).toLocaleString()}
          ${(p.tags || []).map((t) => `<span style="margin-left:8px;color:var(--accent)">#${escapeHtml(t)}</span>`).join("")}
        </div>
        ${AI.renderMarkdown(p.content || "")}
      `;
      detailEl.querySelector(".back-btn").addEventListener("click", () => {
        detailEl.hidden = true;
        listEl.style.display = "";
        tagsEl.style.display = "";
      });
    }

    return { open, close, render };
  })();

  const dlgPost = $("#dialog-post");
  let currentPostId = null;

  function openPostDialog(post) {
    const f = $("#form-post");
    $("#post-title-head").textContent = post ? "编辑文章" : "新建文章";
    f.reset();
    $("#post-preview").hidden = true;
    currentPostId = post ? post.id : null;
    if (post) {
      f.title.value = post.title;
      f.tags.value = (post.tags || []).join(", ");
      f.cover.value = post.cover || "";
      f.content.value = post.content || "";
      f.published.checked = !!post.published;
    }
    $("#post-delete-btn").hidden = !post;
    dlgPost.showModal();
  }

  $("#post-preview-btn").addEventListener("click", () => {
    const pv = $("#post-preview");
    if (pv.hidden) {
      pv.innerHTML = AI.renderMarkdown($("#form-post").content.value);
      pv.hidden = false;
    } else pv.hidden = true;
  });

  $("#post-delete-btn").addEventListener("click", () => {
    if (!currentPostId) return;
    if (!confirm("删除这篇文章？此操作不可撤销。")) return;
    Blog.remove(currentPostId);
    dlgPost.close();
    UIBlog.render();
  });

  $("#post-ai-assist").addEventListener("click", () => {
    const title = $("#form-post").title.value.trim() || "随便写点什么";
    UIAI.open();
    // 提前输入给 AI
    setTimeout(() => {
      const input = $("#ai-input");
      input.value = `帮我写一篇关于"${title}"的博客草稿（Markdown 格式），不超过 500 字，语气自然。`;
      input.focus();
    }, 200);
    dlgPost.close();
  });

  $("#form-post").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    const tags = (data.tags || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    const patch = {
      title: data.title, content: data.content, cover: data.cover,
      tags, published: !!data.published,
    };
    if (currentPostId) Blog.update(currentPostId, patch);
    else Blog.create(patch);
    dlgPost.close();
    UIBlog.render();
    toast("已保存");
  });

  $("#btn-blog").addEventListener("click", () => UIBlog.open());

  // ===================== 日历 UI =====================
  const UICal = (() => {
    const panel = $("#calendar-panel");
    const monthView = $("#cal-month-view");
    const listView = $("#cal-list-view");
    const gridEl = $("#cal-grid");
    const weekdaysEl = $("#cal-weekdays");
    const titleEl = $("#cal-title");
    const dayTitle = $("#cal-day-title");
    const dayList = $("#cal-day-list");
    const listEl = $("#cal-list");
    const badge = $("#cal-badge");
    const upcomingCard = $("#upcoming-card");
    const upcomingList = $("#upcoming-list");

    let viewDate = new Date();
    viewDate.setDate(1);
    let selectedDate = new Date();
    selectedDate.setHours(0, 0, 0, 0);
    let view = "month";
    let tickTimer = null;

    function init() {
      renderWeekdays();
      renderMonth();
      renderDay();
      renderUpcoming();
      updateBadge();
      startTicker();
      CalUtils.scheduleReminders();
      upcomingCard.hidden = !Store.settings.showUpcoming;
    }

    function open() {
      panel.hidden = false;
      renderMonth();
      renderDay();
    }
    function close() { panel.hidden = true; }

    function renderWeekdays() {
      const first = Cal.data.settings.firstDayOfWeek || 1;
      const names = [];
      for (let i = 0; i < 7; i++) names.push(CalUtils.WEEK_NAMES[(first + i) % 7]);
      weekdaysEl.innerHTML = names.map((n) => `<span>${n}</span>`).join("");
    }

    function renderMonth() {
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      titleEl.textContent = `${y} 年 ${m + 1} 月`;
      const cells = CalUtils.monthGrid(y, m, Cal.data.settings.firstDayOfWeek || 1);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const rangeStart = cells[0].date.getTime();
      const rangeEnd = cells[41].date.getTime() + 86400000;
      const allOcc = CalUtils.listInRange(rangeStart, rangeEnd);
      const byDay = new Map();
      for (const { task, ts } of allOcc) {
        const dStart = new Date(ts); dStart.setHours(0, 0, 0, 0);
        const key = dStart.getTime();
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push({ task, ts });
      }

      gridEl.innerHTML = cells.map((c) => {
        const dayKey = c.date.getTime();
        const items = byDay.get(dayKey) || [];
        const isToday = dayKey === today.getTime();
        const isSel = dayKey === selectedDate.getTime();
        const weekday = c.date.getDay();
        const cls = ["cal-cell"];
        if (!c.inMonth) cls.push("out");
        if (isToday) cls.push("today");
        if (isSel) cls.push("selected");
        const dayCls = weekday === 0 ? "sun" : weekday === 6 ? "sat" : "";
        const MAX = 3;
        const shown = items.slice(0, MAX).map((it) => {
          const done = CalUtils.isDoneOccurrence?.(it.task, it.ts) ||
            (it.task.repeat?.type === "none" ? it.task.done : (it.task.doneDates || []).includes(it.ts));
          return `<div class="day-task ${done ? "done" : ""}" style="--task-color:${escapeHtml(it.task.color || "#ff8fab")}" title="${escapeHtml(it.task.title)}">${escapeHtml(it.task.title)}</div>`;
        }).join("");
        const more = items.length > MAX ? `<div class="more">+${items.length - MAX} 更多</div>` : "";
        let wBadge = "";
        if (Store.settings.weatherOnCal && window.WeatherUtils) {
          const ds = `${c.date.getFullYear()}-${String(c.date.getMonth() + 1).padStart(2, "0")}-${String(c.date.getDate()).padStart(2, "0")}`;
          const f = WeatherUtils.forecastForDate(ds);
          if (f) {
            const [emoji] = WeatherUtils.wmo(f.code);
            wBadge = `<span class="cal-cell-weather" title="${escapeHtml(WeatherUtils.wmo(f.code)[1])} ${Math.round(f.min)}~${Math.round(f.max)}°">${emoji}</span>`;
          }
        }
        return `<div class="${cls.join(" ")}" data-ts="${dayKey}" style="position:relative">
          <span class="day-num ${dayCls}">${c.date.getDate()}</span>
          ${wBadge}
          <div class="day-tasks">${shown}${more}</div>
        </div>`;
      }).join("");
    }

    function renderDay() {
      const d = new Date(selectedDate);
      const isToday = d.toDateString() === new Date().toDateString();
      dayTitle.textContent = isToday ? `今天 · ${d.getMonth() + 1}/${d.getDate()}` : d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
      const from = d.getTime();
      const to = from + 86400000 - 1;
      const items = CalUtils.listInRange(from, to);
      dayList.innerHTML = items.map((it) => renderDayItem(it.task, it.ts)).join("");
    }

    function renderDayItem(task, ts) {
      const done = task.repeat?.type === "none" ? !!task.done : (task.doneDates || []).includes(ts);
      const diff = ts - Date.now();
      const cdCls = diff < 0 ? "overdue" : "";
      const repeatLabel = task.repeat && task.repeat.type !== "none" ? `<span class="task-repeat">🔁 ${escapeHtml(CalUtils.repeatLabel(task.repeat))}</span>` : "";
      // 天气提示
      let wTip = "";
      if (window.WeatherUtils && Store.settings.weatherOnCal !== false) {
        const d = new Date(ts);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const f = WeatherUtils.forecastForDate(ds);
        if (f) {
          const [emoji, desc] = WeatherUtils.wmo(f.code);
          const rain = (f.code >= 50 && f.code <= 99) || f.rainProb >= 60;
          const hot = f.max >= 32;
          const cold = f.min <= 0;
          let extra = "";
          let cls = "";
          if (rain) { extra = "记得带伞"; cls = "warn"; }
          else if (hot) { extra = "注意防晒"; cls = "hot"; }
          else if (cold) { extra = "注意保暖"; cls = "warn"; }
          wTip = `<span class="task-weather-tip ${cls}" title="${escapeHtml(desc)} ${Math.round(f.min)}~${Math.round(f.max)}°">${emoji} ${Math.round(f.max)}°${extra ? " · " + extra : ""}</span>`;
        }
      }
      return `<li class="cal-day-item ${done ? "done" : ""}" data-id="${task.id}" data-ts="${ts}" style="--task-color:${escapeHtml(task.color || "#ff8fab")}">
        <div class="task-title">${escapeHtml(task.title)}${wTip}</div>
        <div class="task-meta">
          <span>${escapeHtml(CalUtils.fmtDateTime(ts, task.allDay))}</span>
          ${repeatLabel}
          <span class="countdown ${cdCls}" data-cd="${ts}">${escapeHtml(CalUtils.fmtCountdown(diff))}</span>
        </div>
        ${task.desc ? `<div style="font-size:12px;color:var(--text-soft)">${escapeHtml(task.desc)}</div>` : ""}
        <div class="task-actions">
          <button data-act="${done ? "undo" : "done"}">${done ? "↶ 还原" : "✓ 完成"}</button>
          <button data-act="skip">⊘ 跳过本次</button>
          <button data-act="edit">✎ 编辑</button>
          <button data-act="del">🗑 删除</button>
        </div>
      </li>`;
    }

    function renderListView() {
      // 未来 3 个月按天分组
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const to = new Date(now); to.setMonth(to.getMonth() + 3);
      const items = CalUtils.listInRange(now.getTime(), to.getTime());
      if (!items.length) {
        listEl.innerHTML = `<div class="hint" style="text-align:center;padding:60px">没有即将到来的任务 🌸</div>`;
        return;
      }
      const groups = new Map();
      for (const it of items) {
        const d = new Date(it.ts); d.setHours(0, 0, 0, 0);
        const k = d.getTime();
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      listEl.innerHTML = [...groups].map(([k, arr]) => {
        const d = new Date(k);
        const today = d.toDateString() === new Date().toDateString();
        const label = today ? "今天" : d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
        return `<div class="cal-list-group"><h4>${label}</h4><ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px">
          ${arr.map((it) => renderDayItem(it.task, it.ts)).join("")}
        </ul></div>`;
      }).join("");
    }

    function renderUpcoming() {
      if (!Store.settings.showUpcoming) { upcomingCard.hidden = true; return; }
      const items = CalUtils.upcoming(5);
      if (!items.length) {
        upcomingList.innerHTML = `<div class="upcoming-empty">暂无安排，享受轻松的时光 🌸</div>`;
      } else {
        upcomingList.innerHTML = items.map(({ task, ts }) => {
          const diff = ts - Date.now();
          const cls = diff < 0 ? "overdue" : diff < 3600000 ? "soon" : "";
          return `<li class="upcoming-item ${cls}" data-id="${task.id}" data-ts="${ts}" style="border-left-color:${escapeHtml(task.color || "#ff8fab")}">
            <span class="u-title">${escapeHtml(task.title)}</span>
            <span class="u-count" data-cd="${ts}">${escapeHtml(CalUtils.fmtCountdown(diff))}</span>
          </li>`;
        }).join("");
      }
      upcomingCard.hidden = false;
    }

    function updateBadge() {
      const today = CalUtils.today();
      const undone = today.filter(({ task, ts }) => !(task.repeat?.type === "none" ? task.done : (task.doneDates || []).includes(ts)));
      if (undone.length) {
        badge.textContent = undone.length > 9 ? "9+" : String(undone.length);
        badge.hidden = false;
      } else badge.hidden = true;
    }

    // 实时倒计时 tick
    let lastMidnight = new Date().toDateString();
    function startTicker() {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => {
        const nodes = document.querySelectorAll("[data-cd]");
        const now = Date.now();
        let rerender = false;
        nodes.forEach((el) => {
          const ts = +el.dataset.cd;
          const diff = ts - now;
          el.textContent = CalUtils.fmtCountdown(diff);
          if (el.classList.contains("countdown")) {
            el.classList.toggle("overdue", diff < 0);
          }
          if (el.classList.contains("u-count")) {
            const item = el.closest(".upcoming-item");
            if (item) {
              item.classList.toggle("overdue", diff < 0);
              item.classList.toggle("soon", diff >= 0 && diff < 3600000);
            }
          }
          // 到时触发重新渲染（下次发生时间变了）
          if (diff < -60000 && diff > -120000) rerender = true;
        });
        // 日期切换，徽章、月视图、今日列表要刷新
        const today = new Date().toDateString();
        if (today !== lastMidnight) {
          lastMidnight = today;
          rerender = true;
        }
        if (rerender) refreshAll();
      }, 1000);
    }

    function refreshAll() {
      if (!panel.hidden) {
        if (view === "month") renderMonth();
        else renderListView();
        renderDay();
      }
      renderUpcoming();
      updateBadge();
      CalUtils.scheduleReminders();
    }

    // ------- 事件绑定 -------
    gridEl.addEventListener("click", (e) => {
      const cell = e.target.closest(".cal-cell");
      if (!cell) return;
      selectedDate = new Date(+cell.dataset.ts);
      selectedDate.setHours(0, 0, 0, 0);
      renderMonth();
      renderDay();
    });
    gridEl.addEventListener("dblclick", (e) => {
      const cell = e.target.closest(".cal-cell");
      if (!cell) return;
      selectedDate = new Date(+cell.dataset.ts);
      openTaskDialog(null, selectedDate);
    });

    function handleTaskClick(e) {
      const btn = e.target.closest("[data-act]");
      const item = e.target.closest("[data-id][data-ts]");
      if (!item) return;
      const task = Cal.get(item.dataset.id);
      const ts = +item.dataset.ts;
      if (!task) return;
      if (!btn) { openTaskDialog(task); return; }
      const act = btn.dataset.act;
      if (act === "done") { CalUtils.markDone(task, ts); toast("已完成 ✓"); refreshAll(); }
      else if (act === "undo") { CalUtils.undoDone(task, ts); refreshAll(); }
      else if (act === "skip") { CalUtils.skipOnce(task, ts); toast("已跳过本次"); refreshAll(); }
      else if (act === "edit") openTaskDialog(task);
      else if (act === "del") {
        if (confirm(`删除"${task.title}"？`)) { Cal.remove(task.id); refreshAll(); }
      }
      e.stopPropagation();
    }
    dayList.addEventListener("click", handleTaskClick);
    listEl.addEventListener("click", handleTaskClick);
    upcomingList.addEventListener("click", handleTaskClick);

    $("#cal-prev").addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); renderMonth(); });
    $("#cal-next").addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); renderMonth(); });
    $("#cal-today").addEventListener("click", () => {
      viewDate = new Date(); viewDate.setDate(1);
      selectedDate = new Date(); selectedDate.setHours(0, 0, 0, 0);
      renderMonth(); renderDay();
    });
    $("#cal-close").addEventListener("click", close);
    $("#cal-new-task").addEventListener("click", () => openTaskDialog(null, selectedDate));
    $("#cal-day-add").addEventListener("click", () => openTaskDialog(null, selectedDate));
    $("#upcoming-expand").addEventListener("click", open);

    const statsView = $("#cal-stats-view");
    $$(".cal-view-switch .chip").forEach((b) => {
      b.addEventListener("click", () => {
        view = b.dataset.view;
        $$(".cal-view-switch .chip").forEach((x) => x.classList.toggle("active", x === b));
        monthView.hidden = view !== "month";
        listView.hidden = view !== "list";
        statsView.hidden = view !== "stats";
        $("#cal-day-panel").hidden = view !== "month";
        if (view === "list") renderListView();
        else if (view === "stats") renderStatsView();
        else renderMonth();
      });
    });

    function renderStatsView() {
      const s = CalUtils.stats();
      $("#stat-week-ratio").textContent = Math.round(s.week.ratio * 100) + "%";
      $("#stat-week-detail").textContent = `${s.week.done} / ${s.week.total}`;
      $("#stat-month-ratio").textContent = Math.round(s.month.ratio * 100) + "%";
      $("#stat-month-detail").textContent = `${s.month.done} / ${s.month.total}`;
      $("#stat-streak").textContent = s.streak;
      $("#stat-total-tasks").textContent = s.totalTasks;
      $("#stat-total-done").textContent = s.totalCompleted;
      // 柱状图
      const svg = $("#stats-chart");
      const W = 600, H = 160, PAD = 18;
      const innerW = W - PAD * 2, innerH = H - PAD * 2;
      const n = s.days.length;
      const bw = innerW / n * 0.75;
      const gap = innerW / n * 0.25;
      const maxTotal = Math.max(1, ...s.days.map((d) => d.total));
      let g = "";
      s.days.forEach((d, i) => {
        const x = PAD + i * (bw + gap);
        const hTotal = (d.total / maxTotal) * innerH;
        const hDone = (d.done / maxTotal) * innerH;
        const yT = H - PAD - hTotal;
        const yD = H - PAD - hDone;
        g += `<rect class="bar-total" x="${x.toFixed(1)}" y="${yT.toFixed(1)}" width="${bw.toFixed(1)}" height="${hTotal.toFixed(1)}" rx="1.5" />`;
        g += `<rect class="bar-done" x="${x.toFixed(1)}" y="${yD.toFixed(1)}" width="${bw.toFixed(1)}" height="${hDone.toFixed(1)}" rx="1.5" />`;
        if (i % 5 === 0 || i === n - 1) {
          g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle">${d.date.getMonth() + 1}/${d.date.getDate()}</text>`;
        }
      });
      svg.innerHTML = g;
    }

    // iCal 导出/导入
    $("#cal-ics-export").addEventListener("click", () => {
      const ics = CalUtils.exportIcs();
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sakura-calendar-${new Date().toISOString().slice(0, 10)}.ics`;
      a.click();
      URL.revokeObjectURL(url);
      toast("已导出 .ics 文件");
    });
    $("#cal-ics-import").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const arr = CalUtils.importIcs(text);
        if (!arr.length) return toast("未找到可导入的事件");
        Cal.data.tasks.push(...arr);
        Cal.save();
        refreshAll();
        toast(`已导入 ${arr.length} 个事件`);
      } catch (err) {
        toast("导入失败：" + err.message);
      } finally {
        e.target.value = "";
      }
    });

    $("#btn-calendar").addEventListener("click", async () => {
      open();
      // 首次尝试申请通知权限
      if (Cal.data.settings.notify && "Notification" in window && Notification.permission === "default") {
        await CalUtils.requestNotifyPermission();
        CalUtils.scheduleReminders();
      }
    });

    window.UICalRefresh = refreshAll;
    return { init, open, close, refreshAll, renderUpcoming, updateBadge, renderStatsView };
  })();

  // ===================== 任务编辑器 =====================
  const dlgTask = $("#dialog-task");
  const formTask = $("#form-task");
  let editingTaskId = null;

  // 通过 elements 访问避免与 HTMLElement.title 等属性冲突
  const tEl = (name) => formTask.elements.namedItem(name);

  function openTaskDialog(task, dateHint) {
    formTask.reset();
    editingTaskId = task ? task.id : null;
    $("#task-title-head").textContent = task ? "编辑任务" : "新建任务";
    $("#task-delete-btn").hidden = !task;

    // 默认值
    const d = task ? new Date(task.startAt) : (dateHint ? new Date(dateHint) : new Date());
    if (!task && !dateHint) { d.setMinutes(d.getMinutes() + 30); d.setSeconds(0, 0); }

    tEl("title").value = task?.title || "";
    tEl("desc").value = task?.desc || "";
    tEl("date").value = toDateInput(d);
    tEl("time").value = toTimeInput(d);
    tEl("allDay").checked = !!task?.allDay;
    tEl("time").disabled = !!task?.allDay;

    const color = task?.color || "#ff8fab";
    const colorInput = formTask.querySelector(`input[name="color"][value="${color}"]`);
    if (colorInput) colorInput.checked = true;

    const r = task?.repeat || { type: "none", interval: 1 };
    tEl("repeatType").value = r.type || "none";
    tEl("interval").value = r.interval || 1;
    formTask.querySelectorAll('input[name="wd"]').forEach((c) => { c.checked = (r.weekDays || []).includes(+c.value); });
    tEl("until").value = r.until ? toDateInput(new Date(r.until)) : "";
    tEl("remindBefore").value = String(task?.remindBefore || 0);

    updateRepeatUI();
    dlgTask.showModal();
  }

  function updateRepeatUI() {
    const t = tEl("repeatType").value;
    const intWrap = formTask.querySelector(".repeat-interval");
    const wdWrap = formTask.querySelector(".weekdays-picker");
    const unitMap = { daily: "天", weekly: "周", monthly: "个月", yearly: "年" };
    intWrap.hidden = (t === "none");
    wdWrap.hidden = (t !== "weekly");
    formTask.querySelector(".repeat-until").hidden = (t === "none");
    if (unitMap[t]) $("#interval-unit").textContent = unitMap[t];
  }
  tEl("repeatType").addEventListener("change", updateRepeatUI);

  tEl("allDay").addEventListener("change", (e) => {
    tEl("time").disabled = e.target.checked;
  });

  $("#task-delete-btn").addEventListener("click", () => {
    if (!editingTaskId) return;
    if (!confirm("删除这个任务？所有历史记录都会消失。")) return;
    Cal.remove(editingTaskId);
    dlgTask.close();
    UICal.refreshAll();
  });

  formTask.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    const allDay = !!data.allDay;
    const dateStr = data.date;
    const timeStr = allDay ? "00:00" : (data.time || "09:00");
    const startAt = new Date(dateStr + "T" + timeStr).getTime();
    const wd = [...formTask.querySelectorAll('input[name="wd"]:checked')].map((x) => +x.value);
    const repeat = {
      type: data.repeatType || "none",
      interval: parseInt(data.interval || "1", 10) || 1,
    };
    if (repeat.type === "weekly" && wd.length) repeat.weekDays = wd;
    if (data.until) repeat.until = new Date(data.until + "T23:59:59").getTime();

    const patch = {
      title: data.title.trim() || "未命名",
      desc: data.desc || "",
      startAt,
      allDay,
      color: data.color || "#ff8fab",
      repeat,
      remindBefore: parseInt(data.remindBefore || "0", 10) || 0,
    };
    if (editingTaskId) {
      const old = Cal.get(editingTaskId);
      // 如果改了 startAt，清空例外/完成记录避免错位
      if (old && (old.startAt !== patch.startAt || JSON.stringify(old.repeat) !== JSON.stringify(patch.repeat))) {
        patch.exceptions = [];
        patch.doneDates = [];
        patch.done = false;
      }
      Cal.update(editingTaskId, patch);
    } else {
      Cal.create(patch);
    }
    dlgTask.close();
    UICal.refreshAll();
    toast("已保存");
  });

  function toDateInput(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function toTimeInput(d) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // ===================== 天气 UI（多城市） =====================
  const UIWeather = (() => {
    const card = $("#weather-card");
    let inited = false;
    let viewingId = null;      // 当前点开显示详情的城市 id（不等于 activeId）

    function getViewingId() {
      const cities = WeatherUtils.listCities();
      if (!cities.length) return null;
      if (viewingId && cities.some((c) => c.id === viewingId)) return viewingId;
      const activeId = Weather.data.activeId || "auto";
      if (cities.some((c) => c.id === activeId)) return activeId;
      return cities[0].id;
    }

    function tabTempHtml(cityId) {
      const cache = Weather.data.caches[cityId];
      if (!cache || !cache.current) return "";
      const c = cache.current;
      const [em] = WeatherUtils.wmo(c.weather_code);
      return `<span class="t-emoji">${em}</span><span class="t-temp">${Math.round(c.temperature_2m)}°</span>`;
    }

    function renderTabs() {
      const cities = WeatherUtils.listCities();
      const vid = getViewingId();
      const activeId = Weather.data.activeId || "auto";
      const container = $("#weather-cities");
      if (!cities.length) {
        container.innerHTML = `<span class="hint" style="padding:6px 10px">未配置城市 · 在设置里添加</span>`;
        return;
      }
      container.innerHTML = cities.map((c) => {
        const star = c.id === activeId ? "★" : "";
        const hasCache = !!Weather.data.caches[c.id];
        const cls = "w-city-tab"
          + (c.id === vid ? " active" : "")
          + (hasCache ? "" : " loading");
        const name = c.id === "auto" ? (c.name || "自动定位") : c.name;
        return `<button class="${cls}" data-cid="${c.id}" title="点击查看 · 双击设为主城市">
          ${star ? `<span class="star">★</span>` : ""}
          <span class="t-name">${escapeHtml(name)}</span>
          ${tabTempHtml(c.id)}
        </button>`;
      }).join("");
    }

    function renderDetail() {
      const vid = getViewingId();
      if (!vid) {
        $("#w-icon").textContent = "🌡";
        $("#w-temp").textContent = "--";
        $("#w-desc").textContent = "请先在设置里添加城市";
        $("#w-city").textContent = "";
        $("#w-active-name").textContent = "--";
        $("#w-daily").innerHTML = "";
        return;
      }
      const city = WeatherUtils.getCityById(vid);
      const cache = Weather.data.caches[vid];
      const cityName = city?.name || (vid === "auto" ? "自动定位" : "--");
      $("#w-active-name").textContent = cityName + (vid === (Weather.data.activeId || "auto") ? " · 主城市" : "");
      if (!cache || !cache.current) {
        $("#w-icon").textContent = "🌡";
        $("#w-temp").textContent = "--";
        $("#w-desc").textContent = "加载中…";
        $("#w-city").textContent = cityName;
        $("#w-daily").innerHTML = "";
        return;
      }
      const c = cache.current;
      const [emoji, desc] = WeatherUtils.wmo(c.weather_code);
      $("#w-icon").textContent = emoji;
      $("#w-temp").textContent = Math.round(c.temperature_2m);
      $("#w-desc").textContent = `${desc} · 体感 ${Math.round(c.apparent_temperature)}° · 湿度 ${c.relative_humidity_2m}%`;
      $("#w-city").textContent = cityName;
      const daily = cache.daily;
      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
      let html = "";
      if (daily && daily.time) {
        for (let i = 0; i < daily.time.length; i++) {
          const d = new Date(daily.time[i]);
          const [em] = WeatherUtils.wmo(daily.weather_code[i]);
          const dname = i === 0 ? "今" : dayNames[d.getDay()];
          const rain = daily.precipitation_probability_max[i];
          html += `<div class="weather-day">
            <div class="wd-date">${dname}${rain != null ? ` <span style="opacity:.6">${rain}%</span>` : ""}</div>
            <div class="wd-emoji">${em}</div>
            <div class="wd-temp">${Math.round(daily.temperature_2m_max[i])}/${Math.round(daily.temperature_2m_min[i])}°</div>
          </div>`;
        }
      }
      $("#w-daily").innerHTML = html;
    }

    function render() {
      renderTabs();
      renderDetail();
      if (Store.settings.weatherOnCal && window.UICalRefresh) {
        try { UICalRefresh(); } catch (_) {}
      }
    }

    async function refresh(force = false) {
      if (!Store.settings.showWeather) { card.hidden = true; return; }
      const cities = WeatherUtils.listCities();
      if (cities.length === 0) { card.hidden = true; return; }
      card.hidden = false;
      // 先渲染 tabs（可能为空缓存）
      render();
      // 并行拉取所有城市
      try {
        await WeatherUtils.fetchAll(force);
      } catch (_) {}
      render();
    }

    function init() {
      if (inited) return;
      inited = true;
      $("#w-refresh").addEventListener("click", () => refresh(true).then(() => toast("已刷新")).catch(() => {}));
      // 点击 tab 切换查看；双击设为主城市
      $("#weather-cities").addEventListener("click", (e) => {
        const tab = e.target.closest(".w-city-tab");
        if (!tab) return;
        viewingId = tab.dataset.cid;
        render();
      });
      $("#weather-cities").addEventListener("dblclick", (e) => {
        const tab = e.target.closest(".w-city-tab");
        if (!tab) return;
        WeatherUtils.setActive(tab.dataset.cid);
        viewingId = tab.dataset.cid;
        render();
        toast("已设为主城市");
        if (window.UICalRefresh) try { UICalRefresh(); } catch (_) {}
      });
      refresh();
    }

    return { init, refresh, render, setViewing(id) { viewingId = id; render(); } };
  })();

  // ===================== 同步 UI =====================
  const UISync = (() => {
    let inited = false;

    function setStatus(msg, type = "") {
      const el = $("#sync-status");
      if (!el) return;
      el.textContent = msg;
      el.className = "hint settings-sync-status " + (type || "").trim();
    }

    function fillForm() {
      $("#sync-backend").value = Sync.data.backend;
      $("#sync-webdav-url").value = Sync.data.webdav.url;
      $("#sync-webdav-user").value = Sync.data.webdav.user;
      $("#sync-webdav-pass").value = Sync.data.webdav.pass;
      $("#sync-webdav-path").value = Sync.data.webdav.path;
      $("#sync-gist-token").value = Sync.data.gist.token;
      $("#sync-gist-id").value = Sync.data.gist.gistId;
      $("#sync-gist-file").value = Sync.data.gist.fileName || "sakura-nav.json";
      $("#set-sync-auto").checked = !!Sync.data.auto;
      $("#set-sync-include-keys").checked = !!Sync.data.includeAiKeys;
      const incAuth = $("#set-sync-include-auth");
      if (incAuth) incAuth.checked = !!Sync.data.includeAuthCred;
      toggleBackend();
      const msg = [];
      if (Sync.data.lastPushed) msg.push("上次上传：" + new Date(Sync.data.lastPushed).toLocaleString("zh-CN"));
      if (Sync.data.lastPulled) msg.push("上次下载：" + new Date(Sync.data.lastPulled).toLocaleString("zh-CN"));
      setStatus(msg.join(" · "));
      refreshRemotePanel();
    }
    async function refreshRemotePanel() {
      const panel = $("#sync-local-server-panel");
      if (!panel) return;
      try {
        if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
      } catch (_) {}
      const show =
        window.SakuraRemote &&
        typeof SakuraRemote.isRemote === "function" &&
        SakuraRemote.isRemote();
      panel.hidden = !show;
    }
    function toggleBackend() {
      const b = $("#sync-backend").value;
      $("#sync-webdav-conf").hidden = b !== "webdav";
      $("#sync-gist-conf").hidden = b !== "gist";
    }
    function readForm() {
      Sync.data.backend = $("#sync-backend").value;
      Sync.data.webdav.url = $("#sync-webdav-url").value.trim();
      Sync.data.webdav.user = $("#sync-webdav-user").value.trim();
      Sync.data.webdav.pass = $("#sync-webdav-pass").value;
      Sync.data.webdav.path = $("#sync-webdav-path").value.trim() || "sakura-nav.json";
      Sync.data.gist.token = $("#sync-gist-token").value.trim();
      Sync.data.gist.gistId = $("#sync-gist-id").value.trim();
      Sync.data.gist.fileName = $("#sync-gist-file").value.trim() || "sakura-nav.json";
      Sync.data.auto = $("#set-sync-auto").checked;
      Sync.data.includeAiKeys = $("#set-sync-include-keys").checked;
      const incAuth = $("#set-sync-include-auth");
      if (incAuth) Sync.data.includeAuthCred = incAuth.checked;
      Sync.save();
    }

    function init() {
      if (inited) return;
      inited = true;
      fillForm();
      $("#sync-backend").addEventListener("change", () => { readForm(); toggleBackend(); });
      [
        "#sync-webdav-url", "#sync-webdav-user", "#sync-webdav-pass", "#sync-webdav-path",
        "#sync-gist-token", "#sync-gist-id", "#sync-gist-file",
        "#set-sync-auto", "#set-sync-include-keys", "#set-sync-include-auth",
      ].forEach((s) => $(s)?.addEventListener("change", readForm));

      $("#btn-sync-push").addEventListener("click", async () => {
        readForm();
        try {
          setStatus("正在上传到云端…");
          await SyncUtils.push();
          setStatus("云端上传成功 · " + new Date().toLocaleString("zh-CN"), "success");
          toast("☁ 已上传到云端");
        } catch (e) { setStatus("上传失败：" + e.message, "error"); toast("上传失败"); }
      });
      $("#btn-sync-pull").addEventListener("click", async () => {
        if (!confirm("从云端下载并覆盖本地数据？")) return;
        readForm();
        try {
          setStatus("正在从云端下载…");
          await SyncUtils.pull();
          setStatus("云端已同步到本地 · " + new Date().toLocaleString("zh-CN"), "success");
          toast("☁ 已同步，正在刷新…");
          setTimeout(() => location.reload(), 800);
        } catch (e) { setStatus("下载失败：" + e.message, "error"); }
      });
      $("#btn-sync-export").addEventListener("click", () => {
        const blob = SyncUtils.exportBlob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `sakura-nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
      $("#sync-import-file").addEventListener("change", async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!confirm("从文件还原会覆盖本地所有数据，继续？")) { e.target.value = ""; return; }
        try {
          await SyncUtils.importFromFile(f);
          toast("已还原，正在刷新...");
          setTimeout(() => location.reload(), 800);
        } catch (err) { toast("还原失败：" + err.message); }
        e.target.value = "";
      });

      $("#btn-sync-remote-push")?.addEventListener("click", async () => {
        try {
          setStatus("正在上传到服务器…");
          if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
          if (!SakuraRemote?.pushNow) throw new Error("服务端同步不可用");
          await SakuraRemote.pushNow();
          setStatus("已保存到服务器 · " + new Date().toLocaleString("zh-CN"), "success");
          toast("已同步到服务器");
        } catch (e) {
          setStatus(String(e.message || e), "error");
          toast("上传失败");
        }
      });
      $("#btn-sync-remote-pull")?.addEventListener("click", async () => {
        if (!confirm("从服务器拉取并覆盖当前页数据？未上传到服务器的本地修改将丢失。")) return;
        try {
          setStatus("正在从服务器拉取…");
          if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
          if (!SakuraRemote?.pullNow) throw new Error("服务端同步不可用");
          await SakuraRemote.pullNow();
          setStatus("已拉取并应用 · " + new Date().toLocaleString("zh-CN"), "success");
          toast("已同步，正在刷新…");
          setTimeout(() => location.reload(), 800);
        } catch (e) {
          setStatus(String(e.message || e), "error");
          toast("拉取失败");
        }
      });
    }
    return { init, fillForm, refreshRemotePanel };
  })();

  // ===================== 语音输入 UI =====================
  const UIVoice = (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    function supported() { return !!SR; }

    function bind(btn, targetEl, { append = false } = {}) {
      if (!btn || !targetEl) return;
      if (!supported()) {
        btn.disabled = true;
        btn.title = "浏览器不支持 Web Speech API（请用 Chrome / Edge）";
        btn.style.opacity = "0.4";
        return;
      }
      let rec = null;
      btn.addEventListener("click", () => {
        if (rec) { rec.stop(); return; }
        rec = new SR();
        rec.lang = "zh-CN";
        rec.interimResults = true;
        rec.continuous = false;
        btn.classList.add("recording");
        let finalText = "";
        rec.onresult = (ev) => {
          let interim = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalText += r[0].transcript;
            else interim += r[0].transcript;
          }
          const baseVal = (append && targetEl._baseVal != null) ? targetEl._baseVal : "";
          const v = (append ? baseVal + (baseVal && (finalText || interim) ? " " : "") : "") + finalText + interim;
          targetEl.value = v;
        };
        rec.onerror = () => { toast("语音识别错误"); };
        rec.onend = () => {
          btn.classList.remove("recording");
          rec = null;
          targetEl._baseVal = null;
        };
        if (append) targetEl._baseVal = targetEl.value;
        rec.start();
      });
    }

    function init() {
      bind($("#task-voice"), document.querySelector('#form-task [name="title"]'));
      bind($("#ai-voice"), $("#ai-input"), { append: true });
    }
    return { init, bind, supported };
  })();

  // ===================== 搜索联想 UI =====================
  const UISuggest = (() => {
    const input = $("#search-input");
    const box = $("#search-suggest");
    const form = $("#search-form");
    let items = [];
    let activeIdx = -1;
    let timer = null;
    let lastQ = "";

    function hide() { box.hidden = true; activeIdx = -1; }
    function show() { box.hidden = false; }

    function render() {
      if (!items.length) { hide(); return; }
      const local = items.filter((x) => x.type === "local");
      const remote = items.filter((x) => x.type === "remote");
      let html = "";
      if (local.length) {
        html += `<div class="sugg-group-title">本地书签</div>`;
        html += local.map((x, i) => `
          <div class="sugg-item" data-idx="${items.indexOf(x)}">
            <span class="sugg-icon">🔗</span>
            <span class="sugg-text">${escapeHtml(x.text)}</span>
            <span class="sugg-sub">${escapeHtml(x.sub || "")}</span>
          </div>`).join("");
      }
      if (remote.length) {
        html += `<div class="sugg-group-title">搜索建议</div>`;
        html += remote.map((x) => `
          <div class="sugg-item" data-idx="${items.indexOf(x)}">
            <span class="sugg-icon">🔎</span>
            <span class="sugg-text">${escapeHtml(x.text)}</span>
            <span class="sugg-sub">${escapeHtml(x.src || "")}</span>
          </div>`).join("");
      }
      box.innerHTML = html;
      show();
      $$(".sugg-item", box).forEach((el) => {
        el.addEventListener("mouseenter", () => {
          activeIdx = +el.dataset.idx;
          highlight();
        });
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pick(+el.dataset.idx);
        });
      });
      highlight();
    }

    function highlight() {
      $$(".sugg-item", box).forEach((el) => {
        el.classList.toggle("active", +el.dataset.idx === activeIdx);
      });
    }

    function pick(idx) {
      const it = items[idx];
      if (!it) return;
      if (it.type === "local" && it.url) {
        window.open(it.url, Store.settings.newTab ? "_blank" : "_self");
      } else {
        input.value = it.text;
        form.requestSubmit();
      }
      hide();
    }

    async function query(q) {
      if (!q.trim()) { items = []; hide(); return; }
      if (q === lastQ) return;
      lastQ = q;
      const eng = Store.settings.engine;
      try {
        const list = await Suggest.fetchAll(q, eng);
        if (q !== lastQ) return;
        items = list;
        render();
      } catch (_) {}
    }

    function init() {
      input.addEventListener("input", () => {
        const v = input.value.trim();
        clearTimeout(timer);
        timer = setTimeout(() => query(v), 180);
      });
      input.addEventListener("focus", () => {
        if (input.value.trim() && items.length) show();
      });
      document.addEventListener("click", (e) => {
        if (!form.contains(e.target)) hide();
      });
      input.addEventListener("keydown", (e) => {
        if (box.hidden) return;
        if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); highlight(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); highlight(); }
        else if (e.key === "Enter") {
          if (activeIdx >= 0) {
            e.preventDefault();
            pick(activeIdx);
          }
        } else if (e.key === "Escape") hide();
      });
    }

    return { init, hide };
  })();

  // ===================== 最近使用 UI =====================
  const UIRecent = (() => {
    const card = $("#recent-card");
    const grid = $("#recent-grid");
    let inited = false;

    function collect() {
      const all = [];
      (Store.state.groups || []).forEach((g) => {
        g.links.forEach((l) => {
          if (l.lastClickAt) all.push({ ...l, groupId: g.id, groupName: g.name });
        });
      });
      return all.sort((a, b) => b.lastClickAt - a.lastClickAt).slice(0, 10);
    }

    function refresh() {
      if (!Store.settings.showRecent) { card.hidden = true; return; }
      const list = collect();
      if (!list.length) { card.hidden = true; return; }
      card.hidden = false;
      grid.innerHTML = list.map((l) => {
        const letter = (l.name || l.url || "?").trim().charAt(0).toUpperCase();
        const icon = l.icon
          ? `<img src="${escapeHtml(l.icon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : `<span class="recent-fb">${escapeHtml(letter)}</span>`;
        return `<a class="recent-item" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" data-id="${l.id}" title="${escapeHtml(l.name)}">
          ${icon}
          <span class="recent-name">${escapeHtml(l.name || l.url)}</span>
        </a>`;
      }).join("");
      $$(".recent-item", grid).forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.dataset.id;
          const link = Store.state.groups.flatMap((g) => g.links).find((x) => x.id === id);
          if (link) {
            link.clickCount = (link.clickCount || 0) + 1;
            link.lastClickAt = Date.now();
            Store.save();
            setTimeout(refresh, 100);
          }
        });
      });
    }

    function init() {
      if (inited) return;
      inited = true;
      $("#recent-clear").addEventListener("click", () => {
        if (!confirm("清空所有最近使用记录？")) return;
        (Store.state.groups || []).forEach((g) => g.links.forEach((l) => {
          delete l.lastClickAt; delete l.clickCount;
        }));
        Store.save();
        refresh();
      });
      refresh();
    }

    return { init, refresh };
  })();

  // ===================== 博客导出 UI =====================
  const UIBlogExport = (() => {
    function init() {
      const rssBtn = $("#blog-export-rss");
      const staticBtn = $("#blog-export-static");
      if (rssBtn) rssBtn.addEventListener("click", () => {
        const xml = Exporter.buildRss({ title: "樱 · 博客", description: "个人博客订阅源" });
        const blob = new Blob([xml], { type: "application/rss+xml;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "sakura-blog.rss.xml";
        a.click();
        URL.revokeObjectURL(a.href);
        toast("已导出 RSS 订阅源");
      });
      if (staticBtn) staticBtn.addEventListener("click", () => {
        if (!window.Blog?.list?.().length) return toast("暂无文章可导出");
        try {
          const blob = Exporter.buildStaticSite();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `sakura-blog-${new Date().toISOString().slice(0, 10)}.zip`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast("已打包静态博客站点");
        } catch (e) {
          toast("导出失败：" + e.message);
        }
      });
    }
    return { init };
  })();

  // ===================== AI TTS =====================
  window.AITts = (() => {
    let currentUtter = null;
    function getVoice(text) {
      const voices = speechSynthesis.getVoices();
      const hasZh = /[\u4e00-\u9fa5]/.test(text);
      if (hasZh) return voices.find((v) => /zh/i.test(v.lang)) || voices[0];
      return voices.find((v) => /en/i.test(v.lang)) || voices[0];
    }
    function stripMd(s) {
      return String(s || "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]*`/g, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[#*_>~|\-]/g, "")
        .replace(/\s+/g, " ");
    }
    function stop() {
      try { speechSynthesis.cancel(); } catch (_) {}
      if (currentUtter?.__btn) currentUtter.__btn.classList.remove("playing");
      currentUtter = null;
    }
    function speak(text, btn) {
      if (!("speechSynthesis" in window)) { toast("浏览器不支持语音合成"); return; }
      if (currentUtter && currentUtter.__btn === btn) { stop(); return; }
      stop();
      const clean = stripMd(text);
      if (!clean.trim()) return;
      const u = new SpeechSynthesisUtterance(clean);
      const v = getVoice(clean);
      if (v) u.voice = v;
      u.rate = 1; u.pitch = 1;
      u.onend = () => { if (btn) btn.classList.remove("playing"); currentUtter = null; };
      u.onerror = u.onend;
      u.__btn = btn;
      if (btn) btn.classList.add("playing");
      currentUtter = u;
      speechSynthesis.speak(u);
    }
    // 预加载声音（Chrome 首次为空）
    if ("speechSynthesis" in window) {
      speechSynthesis.onvoiceschanged = () => { };
    }
    return { speak, stop };
  })();

  // 入口：先鉴权，通过才加载主应用
  (async function entry() {
    if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
    // 即使未登录，也提前加载设置并渲染背景/主题/樱花，让登录页更统一
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(Store.settings, JSON.parse(raw));
    } catch (_) {}
    if (!Store.settings.visualTheme || !VISUAL_THEMES[Store.settings.visualTheme]) {
      Store.settings.visualTheme = "sakura";
    }

    applyTheme();
    applyStyle();
    Bg.init();
    Sakura.init({
      count: Store.settings.sakuraCount,
      speed: Store.settings.sakuraSpeed,
      particleMode: particleModeFromVisualTheme(Store.settings.visualTheme),
    });
    applyVisualTheme();

    if (await Auth.isAuthed()) {
      await bootApp();
    } else {
      showLogin();
    }
  })();
})();
