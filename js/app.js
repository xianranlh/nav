/* 个人导航主应用
 * - 数据模型：通过 sakura-remote 写入服务端 SQLite（代码仍复用 localStorage API 作为 shim 接口）
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
  const Theme = window.HomepageTheme;
  const Layout = window.HomepageLayout;
  if (!Theme || !Layout) throw new Error("Homepage modules are not loaded");

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

  function serverStorageRequired() {
    const remote = window.SakuraRemote;
    return !!(
      remote &&
      typeof remote.isRequired === "function" &&
      remote.isRequired()
    );
  }

  function serverStorageUnavailable() {
    const remote = window.SakuraRemote;
    return !!(
      serverStorageRequired() &&
      (!remote || typeof remote.isRemote !== "function" || !remote.isRemote())
    );
  }

  function showStorageUnavailable(reason) {
    const remote = window.SakuraRemote;
    const text = reason || (remote && remote.reason && remote.reason()) || "请使用 Node/Docker 服务端模式启动项目。";
    document.body.classList.add("pre-auth");
    if (!loginOverlay) return;
    loginOverlay.hidden = false;
    loginOverlay.innerHTML = `
      <section class="glass login-card storage-required-card" role="alert">
        <div class="login-logo">💾</div>
        <h2>服务端存储不可用</h2>
        <p class="login-sub">当前项目已切换为服务端存储模式，业务数据不会再写入浏览器。</p>
        <p class="login-msg">${escapeHtml(text)}</p>
        <button type="button" class="btn-primary login-btn" id="storage-recheck">重新检测</button>
      </section>`;
    $("#storage-recheck")?.addEventListener("click", () => location.reload());
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

  const VISUAL_THEMES = Theme.VISUAL_THEMES;

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
      bgShuffle: false,            // rotate 模式下随机顺序
      bgPresets: [],               // [{id, name, urls:[], interval, shuffle, createdAt}]
      bgRandomUrl: "",
      bgInterval: 60,              // 秒
      bgOverlay: 0,
      bgBlur: 0,
      // 上传背景：服务端模式存 storage:'server' + remoteUrl；旧 IndexedDB 数据仅用于迁移/兼容
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
      showStarred: true,
      heroMode: "compact",         // expanded | compact | hidden
      newTab: true,
      // 折叠分组
      collapsedGroups: {},
      /** 视觉氛围：由 homepage-theme.js 注册（影响渐变、粒子、AI 角标等） */
      visualTheme: "sakura",
      /** 站点标题：浏览器 tab + 登录页顶部都用这个；空字符串视为用默认。 */
      siteTitle: "",
    },

    load() {
      // 1. 加载数据
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          // 确保解析结果是对象且不是 null
          if (parsed && typeof parsed === "object") {
            this.state = parsed;
          }
        }
      } catch (e) {
        console.warn("load data failed", e);
      }

      // 2. 加载设置
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            Object.assign(this.settings, parsed);
          }
        }
      } catch (e) {
        console.warn("load settings failed", e);
      }

      // 3. 最终防御性修正
      if (!this.state || typeof this.state !== "object") {
        this.state = { groups: [] };
      }
      // 确保 groups 数组存在（兼容旧数据无 groups 字段）
      if (!this.state.groups || !Array.isArray(this.state.groups)) {
        this.state.groups = [];
      }

      // 4. 其它兼容性处理
      if (this.settings.bg && !this.settings.bgSingle) {
        this.settings.bgSingle = this.settings.bg;
        this.settings.bgMode = "single";
      }
      if (!this.settings.collapsedGroups) {
        this.settings.collapsedGroups = {};
      }
      if (!this.settings.visualTheme || !Theme.hasVisualTheme(this.settings.visualTheme)) {
        this.settings.visualTheme = Theme.DEFAULT_VISUAL_THEME_ID;
      }
    },

    save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); },
    /**
     * saveSettings 默认立即写；在密集 input 事件（滑块）里用 saveSettings(true)
     * 会用 200ms 防抖折叠写入，降低服务端同步压力。
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
    if (!Store.state.groups.length) {
      // 没分组时给一张引导卡，比纯空白友好得多
      const empty = document.createElement("section");
      empty.className = "glass groups-empty";
      empty.innerHTML = `
        <div class="ge-icon" aria-hidden="true">📚</div>
        <h2 class="ge-title">还没有任何网址分组</h2>
        <p class="ge-sub">先建一个分组开始整理你的导航，或者直接导入浏览器书签：</p>
        <div class="ge-actions">
          <button type="button" class="btn-primary" data-ge-act="add-link">+ 添加第一个网址</button>
          <button type="button" class="btn-secondary" data-ge-act="add-group">+ 新建空分组</button>
          <button type="button" class="btn-secondary" data-ge-act="import-bookmarks">⇧ 导入浏览器书签</button>
          <button type="button" class="btn-secondary" data-ge-act="import-json">⇧ 导入 JSON</button>
        </div>
        <p class="ge-tip">小 tips：按 <kbd>/</kbd> 聚焦搜索；按 <kbd>Ctrl</kbd>+<kbd>K</kbd> 快速添加；按 <kbd>E</kbd> 切换编辑模式</p>
      `;
      empty.addEventListener("click", (e) => {
        const b = e.target.closest("[data-ge-act]");
        if (!b) return;
        const act = b.dataset.geAct;
        const map = { "add-link": "btn-add", "add-group": "btn-add-group", "import-bookmarks": "btn-import", "import-json": "btn-import-json" };
        document.getElementById(map[act])?.click();
      });
      groupsContainer.appendChild(empty);
    } else {
      for (const g of Store.state.groups) groupsContainer.appendChild(renderGroup(g));
    }
    // 重新应用过滤
    try { Filter.apply(); } catch (_) {}
    renderGroupTabs();
    if (typeof UIStarred !== "undefined") UIStarred.refresh();
  }

  function renderGroupTabs() {
    const tabs = $("#group-tabs");
    if (!tabs) return;
    const groups = Store.state.groups || [];
    if (!Layout.shouldShowGroupTabs(groups)) {
      tabs.hidden = true;
      tabs.innerHTML = "";
      return;
    }
    tabs.hidden = false;
    tabs.innerHTML = "";
    for (const item of Layout.buildGroupTabItems(groups)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "group-tab";
      b.dataset.groupId = item.id;
      b.textContent = item.label;
      b.addEventListener("click", () => {
        const target = document.querySelector(`section.group[data-gid="${CSS.escape(item.id)}"]`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        $$(".group-tab", tabs).forEach((t) => t.classList.remove("is-active"));
        b.classList.add("is-active");
      });
      tabs.appendChild(b);
    }
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
          <button data-act="edit" title="编辑分组（含背景）">✏️</button>
          <button data-act="color" title="分组颜色">🎨</button>
          <button data-act="up" title="上移">↑</button>
          <button data-act="down" title="下移">↓</button>
          <button data-act="del" title="删除分组">✕</button>
        </div>
      </div>
      <div class="cards"></div>
    `;
    applyBgLayer(el, g.bg, "group-bg");

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
        // 清理服务端媒体
        if (window.SakuraMedia && SakuraMedia.removeByUrl) {
          if (g.bg && g.bg.url) SakuraMedia.removeByUrl(g.bg.url).catch(() => {});
          for (const l of g.links) {
            if (l.bg && l.bg.url) SakuraMedia.removeByUrl(l.bg.url).catch(() => {});
          }
        }
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
      } else if (act === "edit") {
        openGroupDialog(g);
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

    applyBgLayer(a, link.bg, "card-bg");

    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "删除";
    del.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (link.bg && link.bg.url && window.SakuraMedia && SakuraMedia.removeByUrl) {
        SakuraMedia.removeByUrl(link.bg.url).catch(() => {});
      }
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

  // ===================== 卡片/分组背景编辑器 =====================
  /** 绑定到 <details class="bg-editor"> 片段，返回 getValue/setValue/cleanup 接口。
   *  value 形如：{ url, kind:"image"|"video", opacity, blur, mask } */
  function bindBgEditor(root) {
    if (!root) return null;
    const preview = root.querySelector("[data-bg-preview]");
    const urlInp = root.querySelector("[data-bg-url]");
    const fileInp = root.querySelector("[data-bg-file]");
    const clearBtn = root.querySelector("[data-bg-clear]");
    const opacityInp = root.querySelector("[data-bg-opacity]");
    const blurInp = root.querySelector("[data-bg-blur]");
    const maskInp = root.querySelector("[data-bg-mask]");
    const opacityLbl = root.querySelector("[data-bg-opacity-val]");
    const blurLbl = root.querySelector("[data-bg-blur-val]");
    const maskLbl = root.querySelector("[data-bg-mask-val]");
    let uploadingCleanup = null;

    const detectKind = (u) => {
      if (!u) return null;
      if (/\.(mp4|webm|ogv|mov)(\?|#|$)/i.test(u)) return "video";
      if (u.startsWith("data:video/")) return "video";
      return "image";
    };

    function renderPreview() {
      const url = (urlInp.value || "").trim();
      const kind = detectKind(url);
      preview.style.setProperty("--bg-opacity", (+opacityInp.value) / 100);
      preview.style.setProperty("--bg-blur", (+blurInp.value) + "px");
      preview.style.setProperty("--bg-mask", (+maskInp.value) / 100);
      opacityLbl.textContent = opacityInp.value + "%";
      blurLbl.textContent = blurInp.value + "px";
      maskLbl.textContent = maskInp.value + "%";
      if (!url) { preview.innerHTML = '<span class="hint">未设置</span>'; return; }
      if (kind === "video") {
        preview.innerHTML = "";
        const v = document.createElement("video");
        v.src = url;
        v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
        preview.appendChild(v);
      } else {
        preview.innerHTML = "";
        const img = document.createElement("img");
        img.src = url;
        img.referrerPolicy = "no-referrer";
        preview.appendChild(img);
      }
    }

    urlInp.addEventListener("input", renderPreview);
    [opacityInp, blurInp, maskInp].forEach((el) => el.addEventListener("input", renderPreview));
    clearBtn.addEventListener("click", () => {
      urlInp.value = ""; opacityInp.value = 100; blurInp.value = 0; maskInp.value = 0; renderPreview();
    });
    fileInp.addEventListener("change", async () => {
      const f = fileInp.files && fileInp.files[0];
      fileInp.value = "";
      if (!f) return;
      const useServer = window.SakuraMedia && SakuraMedia.enabled && SakuraMedia.enabled() && SakuraMedia.uploadBg;
      if (useServer) {
        try {
          clearBtn.disabled = true;
          const up = await SakuraMedia.uploadBg(f);
          if (up && up.url) { urlInp.value = up.url; renderPreview(); toast("背景已上传到服务端"); }
        } catch (e) { toast("上传失败：" + (e.message || e), 3500); }
        finally { clearBtn.disabled = false; }
        return;
      }
      if (serverStorageRequired()) {
        toast("服务端背景上传不可用，未写入浏览器", 3500);
        return;
      }
      // 无服务端存储策略时的旧兼容路径：图片走 dataURL（限制大小），视频不允许
      if (f.type.startsWith("video/")) {
        toast("视频背景需启用服务端模式（Docker 部署）", 3500);
        return;
      }
      if (f.size > 2 * 1024 * 1024) {
        toast("图片 > 2MB 无法本地保存；请使用 URL 或启用服务端", 3800);
        return;
      }
      try {
        const reader = new FileReader();
        reader.onload = () => { urlInp.value = String(reader.result); renderPreview(); };
        reader.readAsDataURL(f);
      } catch (e) { toast("读取失败：" + (e.message || e)); }
    });

    return {
      setValue(v) {
        v = v || {};
        urlInp.value = v.url || "";
        opacityInp.value = v.opacity != null ? Math.round(v.opacity * 100) : 100;
        blurInp.value = v.blur != null ? v.blur : 0;
        maskInp.value = v.mask != null ? Math.round(v.mask * 100) : 0;
        renderPreview();
      },
      getValue() {
        const url = (urlInp.value || "").trim();
        if (!url) return null;
        return {
          url,
          kind: detectKind(url),
          opacity: (+opacityInp.value) / 100,
          blur: +blurInp.value,
          mask: (+maskInp.value) / 100,
        };
      },
      cleanup() { if (uploadingCleanup) try { uploadingCleanup(); } catch (_) {} },
    };
  }
  const linkBgEditor = bindBgEditor(document.querySelector(".bg-editor[data-target=link]"));
  const groupBgEditor = bindBgEditor(document.querySelector(".bg-editor[data-target=group]"));

  /** 把 bg 对象应用到一个 .card-bg / .group-bg 容器（创建或更新 <img>/<video>）。
   *  返回 wrapper 元素（无则返回 null） */
  function applyBgLayer(host, bg, containerClass) {
    // 移除旧层
    const old = host.querySelector(":scope > ." + containerClass);
    if (old) old.remove();
    host.classList.remove("has-bg");
    if (!bg || !bg.url) return null;
    const wrap = document.createElement("div");
    wrap.className = containerClass;
    const kind = bg.kind || (/\.(mp4|webm|ogv|mov)(\?|#|$)/i.test(bg.url) ? "video" : "image");
    if (kind === "video") {
      const v = document.createElement("video");
      v.src = bg.url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
      wrap.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = bg.url; img.referrerPolicy = "no-referrer"; img.alt = "";
      wrap.appendChild(img);
    }
    wrap.style.setProperty("--bg-opacity", bg.opacity != null ? bg.opacity : 1);
    wrap.style.setProperty("--bg-blur", (bg.blur || 0) + "px");
    wrap.style.setProperty("--bg-mask", bg.mask != null ? bg.mask : 0);
    host.prepend(wrap);
    host.classList.add("has-bg");
    return wrap;
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

  function renderLinkGroupOptions(selectedId) {
    const sel = $("#link-group-select");
    if (!sel) return;
    sel.innerHTML = Store.state.groups
      .map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
    sel.value = selectedId || Store.state.groups[0]?.id || "";
  }

  function setInlineGroupCreateVisible(visible) {
    const box = $("#link-inline-group");
    if (!box) return;
    box.hidden = !visible;
    if (visible) {
      $("#link-inline-group-name").value = "";
      $("#link-inline-group-color").value = "#f6a5c0";
      setTimeout(() => $("#link-inline-group-name")?.focus(), 30);
    }
  }

  function createInlineLinkGroup() {
    const nameInput = $("#link-inline-group-name");
    const colorInput = $("#link-inline-group-color");
    const name = nameInput?.value.trim();
    if (!name) {
      toast("请输入新分组名称");
      nameInput?.focus();
      return null;
    }
    const group = Layout.createGroupDraft({
      name,
      color: colorInput?.value || "#f6a5c0",
      idFactory: uid,
    });
    Store.state.groups.push(group);
    Store.save();
    render();
    renderLinkGroupOptions(group.id);
    setInlineGroupCreateVisible(false);
    toast(`已创建分组：${group.name}`);
    return group;
  }

  function openLinkDialog(link, groupId) {
    $("#link-title").textContent = link ? "编辑网址" : "添加网址";
    formLink.name.value = link ? link.name : "";
    formLink.url.value = link ? link.url : "";
    formLink.icon.value = link ? (link.icon || "") : "";
    formLink.desc.value = link ? (link.desc || "") : "";
    renderLinkGroupOptions(groupId || (link && Store.findLink(link.id)?.group.id) || Store.state.groups[0]?.id);
    setInlineGroupCreateVisible(!Store.state.groups.length);
    formLink.dataset.editId = link ? link.id : "";
    formLink.dataset.prevBgUrl = link && link.bg && link.bg.url ? link.bg.url : "";
    updateIconPreview(formLink.icon.value);
    if (linkBgEditor) linkBgEditor.setValue(link ? link.bg : null);

    // "更多设置"折叠区：编辑时若有非默认字段（图标 / 描述 / 背景）→ 展开；新建时收起
    const moreDetails = formLink.querySelector("details.link-more");
    if (moreDetails) {
      const hasMore = !!link && (
        (link.icon && link.icon.length) ||
        (link.desc && link.desc.length) ||
        (link.bg && link.bg.url)
      );
      moreDetails.open = !!hasMore;
      // 内嵌的 details（卡片背景媒体）：与外层"更多设置"同步展开/收起，省一次点击
      const bgDetails = moreDetails.querySelector("details.bg-editor");
      if (bgDetails) bgDetails.open = moreDetails.open;
    }

    dlgLink.showModal();
    setTimeout(() => formLink.url.focus(), 50);
  }

  // "更多设置" toggle 时同步展开 / 收起里面所有内嵌 details —— 一次点击就能看到全部
  document.addEventListener("toggle", (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains("link-more")) return;
    t.querySelectorAll(":scope > details").forEach((sub) => { sub.open = t.open; });
  }, true);

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
  $("#link-new-group-toggle")?.addEventListener("click", () => {
    const box = $("#link-inline-group");
    setInlineGroupCreateVisible(box?.hidden !== false);
  });
  $("#link-inline-group-save")?.addEventListener("click", () => {
    createInlineLinkGroup();
  });
  $("#link-inline-group-cancel")?.addEventListener("click", () => {
    setInlineGroupCreateVisible(false);
  });
  $("#link-inline-group-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      createInlineLinkGroup();
    }
  });

  formLink.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formLink));
    if (!data.url) return;
    if (!/^https?:\/\//i.test(data.url)) data.url = "https://" + data.url;

    const editId = formLink.dataset.editId;
    const dstGroup = Store.findGroup(data.groupId);
    if (!dstGroup) {
      toast("请先新建分组");
      setInlineGroupCreateVisible(true);
      return;
    }

    const bg = linkBgEditor ? linkBgEditor.getValue() : null;
    const prevBgUrl = formLink.dataset.prevBgUrl || "";
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
          bg: bg || null,
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
        bg: bg || null,
      });
    }
    // 旧 server URL 若与新 URL 不同，清服务端文件
    if (prevBgUrl && prevBgUrl !== (bg && bg.url) && window.SakuraMedia && SakuraMedia.removeByUrl) {
      SakuraMedia.removeByUrl(prevBgUrl).catch(() => {});
    }
    Store.save();
    render();
    dlgLink.close();
  });

  // ===================== 分组 弹窗 =====================
  const dlgGroup = $("#dialog-group");
  const formGroup = $("#form-group");

  function openGroupDialog(existing) {
    $("#group-title").textContent = existing ? "编辑分组" : "新建分组";
    formGroup.name.value = existing ? existing.name : "";
    formGroup.color.value = existing ? (existing.color || "#f6a5c0") : "#f6a5c0";
    formGroup.dataset.editId = existing ? existing.id : "";
    formGroup.dataset.prevBgUrl = existing && existing.bg && existing.bg.url ? existing.bg.url : "";
    if (groupBgEditor) groupBgEditor.setValue(existing ? existing.bg : null);
    dlgGroup.showModal();
    setTimeout(() => formGroup.name.focus(), 50);
  }

  formGroup.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formGroup));
    if (!data.name) return;
    const bg = groupBgEditor ? groupBgEditor.getValue() : null;
    const prevBgUrl = formGroup.dataset.prevBgUrl || "";
    const editId = formGroup.dataset.editId || "";
    if (editId) {
      const g = Store.findGroup(editId);
      if (g) {
        g.name = data.name;
        g.color = data.color || g.color || "#f6a5c0";
        g.bg = bg || null;
      }
    } else {
      Store.state.groups.push({
        id: uid(),
        name: data.name,
        color: data.color || "#f6a5c0",
        links: [],
        bg: bg || null,
      });
    }
    if (prevBgUrl && prevBgUrl !== (bg && bg.url) && window.SakuraMedia && SakuraMedia.removeByUrl) {
      SakuraMedia.removeByUrl(prevBgUrl).catch(() => {});
    }
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
      const merged = { name: "导入书签", links: [] };
      groups.forEach((g) => merged.links.push(...g.links));
      groups = [merged];
    }

    const prog = window.NavProgress ? NavProgress.open("导入书签") : null;
    prog?.step(0.05, "合并到现有分组…");

    const totalIncoming = groups.reduce((s, g) => s + g.links.length, 0);
    let mergedCount = 0;
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
        mergedCount++;
        if (mergedCount % 20 === 0) {
          prog?.step(0.05 + 0.25 * (mergedCount / Math.max(1, totalIncoming)), `合并中 ${mergedCount}/${totalIncoming}`);
        }
      }
    }

    Store.save();
    render();
    dlgImport.close();

    if (!auto) {
      prog?.step(1, `已导入 ${mergedCount} 个链接`);
      prog?.done("导入完成");
      toast(`已导入 ${mergedCount} 个链接`);
      return;
    }

    prog?.step(0.32, "开始抓取图标…");
    const allLinks = [];
    Store.state.groups.forEach((g) => g.links.forEach((l) => { if (!l.icon) allLinks.push(l); }));
    const CONCURRENCY = 6;
    let idx = 0, finished = 0;
    const total = allLinks.length;
    if (total === 0) {
      prog?.done(`已导入 ${mergedCount} 个链接（无需抓取图标）`);
      toast(`已导入 ${mergedCount} 个链接`);
      return;
    }
    const workers = Array(Math.min(CONCURRENCY, total)).fill(0).map(async () => {
      while (idx < allLinks.length) {
        const link = allLinks[idx++];
        const url = await BookmarkTools.getBestIcon(link.url);
        if (url) link.icon = url;
        finished++;
        if (finished % 5 === 0 || finished === total) {
          prog?.step(0.32 + 0.68 * (finished / total), `正在抓取图标 ${finished}/${total}`);
        }
        if (finished % 10 === 0 || finished === total) Store.save();
      }
    });
    await Promise.all(workers);
    Store.save();
    render();
    prog?.done(`已导入 ${mergedCount} 个链接，图标 ${finished}/${total} 完成`);
    toast(`图标获取完成 (${finished}/${total})`);
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
  /** 把 settings.siteTitle 应用到浏览器 tab title 和登录页大标题。
   *  空字符串视作"用默认"，恢复成 "樱 · 个人导航"。 */
  function applySiteTitle() {
    const t = (Store.settings.siteTitle || "").trim() || "樱 · 个人导航";
    try { document.title = t; } catch (_) {}
    const heading = document.querySelector("#login-overlay .login-card h2");
    if (heading) heading.textContent = t;
  }

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
    return Theme.particleModeFromVisualTheme(vid);
  }

  function applyVisualTheme() {
    Theme.applyVisualThemeDom(document, Store.settings.visualTheme);
  }

  function applyHeroMode() {
    Theme.applyHeroModeDom(document, Store.settings.heroMode);
  }

  function syncSakuraParticles() {
    if (!window.Sakura) return;
    const s = Store.settings;
    Sakura.set({
      particleMode: particleModeFromVisualTheme(s.visualTheme),
      count: Theme.particleCountForViewport(s.sakuraCount, window.matchMedia.bind(window)),
      speed: s.sakuraSpeed,
    });
  }

  window.addEventListener("resize", syncSakuraParticles);

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

    let authVerified = false;

    ["#auth-cur-user", "#auth-cur-pass", "#auth-new-user", "#auth-new-pass", "#auth-new-pass2"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    const authMsg = $("#auth-change-msg");
    if (authMsg) authMsg.textContent = "";

    // --- 回填 ---
    setV("#set-site-title", s.siteTitle || "");
    setV("#set-theme", s.theme);
    setV("#set-visual-theme", s.visualTheme || "sakura");
    setV("#set-accent", s.accent || "#ff8fab");
    setV("#set-fontsize", s.fontSize);
    setV("#set-radius", s.radius);
    setV("#set-density", s.density);
    setV("#set-hero-mode", s.heroMode || "compact");
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
    setC("#set-show-starred", s.showStarred);
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

    $("#form-settings-auth-verify")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("#auth-change-msg");
      if (msg) { msg.textContent = ""; msg.classList.remove("ok"); }
      const cu = $("#auth-cur-user")?.value;
      const cp = $("#auth-cur-pass")?.value;
      const r = await Auth.login(String(cu || "").trim(), String(cp || ""), true);
      if (!r.ok) {
        if (msg) { msg.textContent = r.reason || "保存失败"; msg.style.color = ""; }
        return;
      }
      authVerified = true;
      if (msg) { msg.textContent = "验证成功，请填写新用户名与新密码"; msg.classList.add("ok"); msg.style.color = ""; }
    });

    $("#form-settings-auth-update")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("#auth-change-msg");
      if (msg) { msg.textContent = ""; msg.classList.remove("ok"); }
      if (!authVerified) {
        if (msg) msg.textContent = "请先验证当前账号";
        return;
      }
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
    $("#set-site-title")?.addEventListener("input", (e) => {
      s.siteTitle = String(e.target.value || "").slice(0, 60);
      Store.saveSettings(true);
      applySiteTitle();
    });
    $("#set-theme").addEventListener("change", (e) => { s.theme = e.target.value; Store.saveSettings(); applyTheme(); });
    $("#set-visual-theme").addEventListener("change", (e) => {
      const id = e.target.value;
      if (!id || id === Store.settings.visualTheme) return;
      const meta = Theme.getVisualTheme(id);
      if (!meta) return;
      const previousVisualTheme = Store.settings.visualTheme;
      Store.settings.visualTheme = meta.id;
      if (Theme.shouldSyncAccent(Store.settings.accent, previousVisualTheme)) {
        Store.settings.accent = meta.accent;
        const accentInput = $("#set-accent");
        if (accentInput) accentInput.value = meta.accent;
      }
      Store.saveSettings();
      applyVisualTheme();
      applyHeroMode();
      applyStyle();
      syncSakuraParticles();
      document.dispatchEvent(new CustomEvent("theme:changed", { detail: { id: meta.id } }));
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
    $("#set-hero-mode").addEventListener("change", (e) => {
      s.heroMode = e.target.value;
      Store.saveSettings();
      applyHeroMode();
    });
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
    $("#set-show-starred").addEventListener("change", (e) => {
      s.showStarred = e.target.checked;
      Store.saveSettings();
      if (typeof UIStarred !== "undefined") UIStarred.refresh();
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
    $("#btn-storage-export-zip")?.addEventListener("click", () => {
      if (typeof StorageInspector !== "undefined" && StorageInspector.exportZip) StorageInspector.exportZip();
    });
    const importZipInput = $("#storage-import-zip-file");
    $("#btn-storage-import-zip")?.addEventListener("click", () => { importZipInput?.click(); });
    importZipInput?.addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      if (typeof StorageInspector !== "undefined" && StorageInspector.importZip) {
        await StorageInspector.importZip(f);
      }
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
      } else if (!serverStorageRequired()) {
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
    const srcHint = info.storage === "server" ? "服务端" : "本地（已禁用）";
    current.innerHTML = `
      ${thumbHtml}
      <div class="info">
        <div class="name"><span class="badge">${badge}</span>${escapeHtml(info.name || "")}</div>
        <div class="meta">${fmtSize(info.size)} · 点击可重新上传</div>
      </div>`;
    if (meta) meta.textContent = `${srcHint} · ${info.mime || ""}`;
  }

  // ===================== IndexedDB：浏览器遗留背景本体 =====================
  // 服务端模式不再写入 IndexedDB；这里只保留旧数据读取、迁移和兼容路径
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
          if (serverStorageRequired()) {
            toast("本地背景文件已禁用，请重新上传到服务端", 3000);
            this.clearLayers();
            this.clearVideo();
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
        const shuffle = !!s.bgShuffle;
        // shuffle 模式：起手也随机
        this.idx = shuffle ? Math.floor(Math.random() * list.length) : 0;
        this.swap(list[this.idx]);
        if (list.length > 1) this.schedule(() => this.nextInList(list, shuffle));
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

    nextInList(list, shuffle) {
      if (shuffle && list.length > 1) {
        // 避免连续两次同一张：在剩余 N-1 张里随机
        let next;
        do { next = Math.floor(Math.random() * list.length); }
        while (next === this.idx);
        this.idx = next;
      } else {
        this.idx = (this.idx + 1) % list.length;
      }
      this.swap(list[this.idx]);
      this.schedule(() => this.nextInList(list, shuffle));
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
          console.warn("服务端背景上传失败", e);
          if (serverStorageRequired()) {
            toast("服务端背景上传失败，未写入浏览器：" + (e?.message || e), 4000);
            return false;
          }
          toast("服务端上传失败：" + (e?.message || e), 4000);
        }
      } else if (serverStorageRequired()) {
        toast("服务端存储未就绪，背景文件未写入浏览器", 3500);
        return false;
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
  $("#btn-add-group").addEventListener("click", () => openGroupDialog(null));
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
    const run = window.NavProgress ? NavProgress.run : (_t, fn) => fn({ step() {}, indeterminate() {}, setLabel() {}, done() {}, fail() {} });
    run("导出备份 JSON", async (p) => {
      p.step(0.2, "收集数据…");
      if (window.SyncUtils && typeof SyncUtils.collect === "function") {
        const json = JSON.stringify(SyncUtils.collect(), null, 2);
        p.step(0.75, `生成文件 (${(json.length / 1024).toFixed(1)} KB)…`);
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `sakura-nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        p.done("已导出完整备份（与「本地备份 JSON」相同）");
        toast("已导出完整备份");
        return;
      }
      const payload = {
        exportedAt: new Date().toISOString(),
        groups: Store.state.groups,
        settings: Store.settings,
      };
      const json = JSON.stringify(payload, null, 2);
      p.step(0.75, `生成文件 (${(json.length / 1024).toFixed(1)} KB)…`);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sakura-nav-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      p.done("已导出 JSON（仅导航与设置，精简版）");
      toast("已导出 JSON");
    });
  }

  function exportBookmarksHtml() {
    const runFn = window.NavProgress ? NavProgress.run : (_t, fn) => fn({ step() {}, done() {} });
    runFn("导出浏览器书签 HTML", async (p) => {
      const ts = Math.floor(Date.now() / 1000);
      const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      const totalLinks = Store.state.groups.reduce((s, g) => s + (g.links?.length || 0), 0);
      p.step(0.1, `整理 ${Store.state.groups.length} 个分组 / ${totalLinks} 个链接…`);
      let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file by Sakura Nav. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="${ts}" LAST_MODIFIED="${ts}" PERSONAL_TOOLBAR_FOLDER="true">樱 · 个人导航</H3>
    <DL><p>
`;
      let seen = 0;
      for (const g of Store.state.groups) {
        html += `        <DT><H3 ADD_DATE="${ts}" LAST_MODIFIED="${ts}">${esc(g.name)}</H3>\n        <DL><p>\n`;
        for (const l of g.links) {
          const icon = l.icon ? ` ICON="${esc(l.icon)}"` : "";
          html += `            <DT><A HREF="${esc(l.url)}" ADD_DATE="${ts}"${icon}>${esc(l.name || l.url)}</A>\n`;
          seen++;
          if (seen % 100 === 0) p.step(0.1 + 0.8 * (seen / Math.max(1, totalLinks)), `编排中 ${seen}/${totalLinks}`);
        }
        html += `        </DL><p>\n`;
      }
      html += `    </DL><p>\n</DL><p>\n`;
      p.step(0.95, "下载文件…");
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sakura-bookmarks-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
      URL.revokeObjectURL(a.href);
      p.done(`已导出 ${totalLinks} 个链接`);
      toast("已导出浏览器书签 HTML");
    });
  }

  $("#btn-import-json").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      const p = window.NavProgress ? NavProgress.open("导入 JSON 备份") : null;
      try {
        p?.step(0.2, `读取 ${f.name} (${(f.size / 1024).toFixed(1)} KB)…`);
        const data = JSON.parse(await f.text());
        p?.step(0.55, "解析完成，准备应用…");
        if (data && typeof data.schema === "string" && data.schema.startsWith("sakura-nav@")) {
          if (!window.SyncUtils || typeof SyncUtils.apply !== "function") {
            throw new Error("同步模块未加载");
          }
          if (!confirm("将用备份覆盖本地全部数据并刷新页面（与设置 → 同步与备份 → 从备份还原相同），继续？")) {
            p?.close();
            return;
          }
          SyncUtils.apply(data, "replace");
          p?.done("已还原，正在刷新…");
          toast("已还原，正在刷新…");
          setTimeout(() => location.reload(), 600);
          return;
        }
        if (!Array.isArray(data.groups)) throw new Error("不是有效的备份（需含 schema 或为旧版 groups 数组）");
        if (!confirm("导入将覆盖当前导航数据，继续？")) { p?.close(); return; }
        Store.state.groups = data.groups;
        Store.save(); render();
        p?.done(`已导入 ${data.groups.length} 个分组`);
        toast("已导入 JSON（仅导航分组）");
      } catch (e) {
        p?.fail("导入失败：" + e.message);
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

  // 设置弹窗里某些区块使用独立 form（用于消除浏览器 DOM 警告）。
  // 其中账号 form 会在 bindSettings() 里接管 submit；这里只兜底其它 form 的 submit 默认行为。
  // 同步区块已拆分为多个单动作 form；无需全局兜底 submit。

  // ===================== 离线状态提示横幅 =====================
  (function bindOfflineBanner() {
    const banner = $("#offline-banner");
    if (!banner) return;
    let dismissed = false; // 用户主动关闭过这次会话不再弹
    function show() {
      if (dismissed) return;
      banner.hidden = false;
      document.body.classList.add("has-offline-banner");
      // 延迟一帧让 transform 动画生效
      requestAnimationFrame(() => banner.classList.add("is-visible"));
    }
    function hide() {
      banner.classList.remove("is-visible");
      document.body.classList.remove("has-offline-banner");
      // 等动画完
      setTimeout(() => { banner.hidden = true; }, 320);
    }
    function refresh() {
      if (navigator.onLine === false) show();
      else hide();
    }
    window.addEventListener("offline", show);
    window.addEventListener("online", () => {
      hide();
      // 网络恢复时让 sakura-remote 重新尝试一次（如果它处于待发送状态）
      if (window.SakuraRemote && typeof SakuraRemote.pushNow === "function" && SakuraRemote.isRemote && SakuraRemote.isRemote()) {
        SakuraRemote.pushNow().then(() => {
          if (window.toast) window.toast("网络已恢复，已立即同步本地改动");
        }).catch(() => {});
      }
    });
    $("#offline-banner-close")?.addEventListener("click", () => {
      dismissed = true;
      hide();
    });
    // 启动时检查一次
    refresh();
  })();

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
    } else if (!inInput && e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Shift+/ 在大多数键盘上 = "?"；这里只在非输入态下触发，不会抢用户输入
      e.preventDefault();
      openShortcutsDialog();
    } else if (e.key === "Escape") {
      hideCtxMenu();
    }
  });

  function openShortcutsDialog() {
    const dlg = $("#dialog-shortcuts");
    if (!dlg) return;
    if (typeof dlg.showModal === "function") {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
    }
  }
  // 暴露给底部 hint 点击使用
  $("#footer-hotkey-hint")?.addEventListener("click", openShortcutsDialog);
  $("#footer-hotkey-hint")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openShortcutsDialog();
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
    if (serverStorageUnavailable()) {
      showStorageUnavailable();
      return;
    }
    if (booted) return;
    booted = true;
    document.body.classList.remove("pre-auth");
    Store.load();
    await AI.AIStore.load();
    // 茶话会按钮 + 模型/角色下拉的禁用态需要在 council 数据加载完成后再刷一次
    try { window.__syncCouncilBtnState?.(); } catch (_) {}
    Cal.load();
    if (window.Sync) Sync.load();
    if (window.Weather) Weather.load();
    applyTheme();
    applyStyle();
    applySiteTitle();
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
      count: Theme.particleCountForViewport(Store.settings.sakuraCount, window.matchMedia.bind(window)),
      speed: Store.settings.sakuraSpeed,
      particleMode: particleModeFromVisualTheme(Store.settings.visualTheme),
    });
    applyVisualTheme();
    applyHeroMode();

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
    if (typeof UIStarred !== "undefined") UIStarred.init();

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

  // 将关键接口暴露给 AI 模块使用
  window.Store = Store;
  window.render = render;
  window.toast = toast;

  /** 依赖注入上下文：供拆分到 js/ui/*.ui.js 的 UI 工厂使用的共享闭包依赖。
   *  各 UI 工厂由本文件按原有顺序实例化（const UIXxx = window.XxxUIFactory(UIContext)）。 */
  const UIContext = {
    $, $$, toast, uid, escapeHtml,
    Store,
    render,
    Bg,
  };

  // ===================== AI 模块 UI（已拆分至 js/ui/ai.ui.js：聊天/茶话会/归档图库/AI设置） =====================
  window.AIUIFactory(UIContext);
  // ===================== ✅ 提醒事项 UI（已拆分至 js/ui/todo.ui.js） =====================
  const UITodo = window.TodoUIFactory(UIContext);

  // ===================== 日历 UI + 任务编辑器（已拆分至 js/ui/calendar.ui.js） =====================
  const UICal = window.CalendarUIFactory(UIContext);
  // ===================== 天气 UI（已拆分至 js/ui/weather.ui.js） =====================
  const UIWeather = window.WeatherUIFactory(UIContext);

  // ===================== 同步 UI（已拆分至 js/ui/sync.ui.js） =====================
  const UISync = window.SyncUIFactory(UIContext);

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

  // ===================== 星标置顶 UI =====================
  const UIStarred = (() => {
    const card = $("#starred-card");
    const grid = $("#starred-grid");

    function refresh() {
      if (!card || !grid) return;
      if (!Store.settings.showStarred) {
        card.hidden = true;
        return;
      }
      const list = Layout.collectStarredLinks(Store.state.groups, 20);
      if (!list.length) {
        card.hidden = true;
        return;
      }
      card.hidden = false;
      grid.innerHTML = list.map((l) => {
        const letter = (l.name || l.url || "?").trim().charAt(0).toUpperCase();
        const icon = l.icon
          ? `<img src="${escapeHtml(l.icon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : `<span class="recent-fb">${escapeHtml(letter)}</span>`;
        return `<a class="recent-item" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" data-id="${l.id}" title="${escapeHtml(l.name)} · ${escapeHtml(l.groupName || "")}">
          ${icon}
          <span class="recent-name">${escapeHtml(l.name || l.url)}</span>
        </a>`;
      }).join("");
    }

    function init() {
      refresh();
    }

    return { init, refresh };
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
    if (serverStorageUnavailable()) {
      applyTheme();
      applyStyle();
      applySiteTitle();
      Sakura.init({
        count: Theme.particleCountForViewport(Store.settings.sakuraCount, window.matchMedia.bind(window)),
        speed: Store.settings.sakuraSpeed,
        particleMode: particleModeFromVisualTheme(Store.settings.visualTheme),
      });
      applyVisualTheme();
      applyHeroMode();
      showStorageUnavailable();
      return;
    }
    // 即使未登录，也提前加载设置并渲染背景/主题/樱花，让登录页更统一
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(Store.settings, JSON.parse(raw));
    } catch (_) {}
    if (!Store.settings.visualTheme || !Theme.hasVisualTheme(Store.settings.visualTheme)) {
      Store.settings.visualTheme = Theme.DEFAULT_VISUAL_THEME_ID;
    }

    applyTheme();
    applyStyle();
    applySiteTitle();
    Bg.init();
    Sakura.init({
      count: Theme.particleCountForViewport(Store.settings.sakuraCount, window.matchMedia.bind(window)),
      speed: Store.settings.sakuraSpeed,
      particleMode: particleModeFromVisualTheme(Store.settings.visualTheme),
    });
    applyVisualTheme();
    applyHeroMode();

    if (await Auth.isAuthed()) {
      await bootApp();
    } else {
      showLogin();
    }
  })();
})();
