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
    Blog.load();
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
    const imgModeBtn = $("#ai-image-mode");
    const imgCtrl = $("#ai-image-controls");
    const imgSizeSel = $("#ai-image-size");
    const imgQualitySel = $("#ai-image-quality");
    const imgNSel = $("#ai-image-n");
    const imgApiModeSel = $("#ai-image-api-mode");
    const imgCustomBox = imgCtrl?.querySelector(".ai-imgctl-custom");
    const imgCustomW = $("#ai-image-custom-w");
    const imgCustomH = $("#ai-image-custom-h");

    // 填充生图下拉
    if (imgSizeSel) {
      imgSizeSel.innerHTML = AI.IMAGE_SIZES.map((o) =>
        `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");
    }
    if (imgQualitySel) {
      imgQualitySel.innerHTML = AI.IMAGE_QUALITIES.map((o) =>
        `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");
    }

    function syncImageMode() {
      const on = !!AI.AIStore.data.imageMode;
      imgModeBtn?.setAttribute("aria-pressed", on ? "true" : "false");
      imgModeBtn?.classList.toggle("active", on);
      if (imgCtrl) imgCtrl.hidden = !on;
      if (input) input.placeholder = on ? "描述要画的图…（Enter 发送）" : "输入消息...";
      // 把当前持久化的值回填到下拉
      const o = AI.AIStore.data.imageOpts || {};
      if (imgSizeSel) imgSizeSel.value = o.size || "1024x1024";
      if (imgQualitySel) imgQualitySel.value = o.quality || "auto";
      if (imgNSel) imgNSel.value = String(o.n || 1);
      if (imgApiModeSel) imgApiModeSel.value = o.apiMode || "images";
      if (imgCustomW) imgCustomW.value = o.customW || 3840;
      if (imgCustomH) imgCustomH.value = o.customH || 2160;
      if (imgCustomBox) imgCustomBox.hidden = (imgSizeSel?.value !== "custom");
      syncImageWarnState();
    }
    /** 选了 4K（包括自定义里 W/H 触及 4K）就给 .ai-image-controls 加 data-warn="4k"，CSS 接管显示提示。 */
    function syncImageWarnState() {
      if (!imgCtrl) return;
      const o = AI.AIStore.data.imageOpts || {};
      let is4K = false;
      const sizeStr = (o.size === "custom")
        ? `${o.customW || 0}x${o.customH || 0}`
        : (o.size || "");
      const m = /^(\d+)x(\d+)$/.exec(sizeStr);
      if (m) {
        const longSide = Math.max(+m[1], +m[2]);
        if (longSide >= 2560) is4K = true; // 2K 以上就给提示
      }
      if (is4K) imgCtrl.setAttribute("data-warn", "4k");
      else imgCtrl.removeAttribute("data-warn");
    }
    syncImageMode();

    imgModeBtn?.addEventListener("click", () => {
      AI.AIStore.data.imageMode = !AI.AIStore.data.imageMode;
      AI.AIStore.save();
      syncImageMode();
    });
    imgSizeSel?.addEventListener("change", () => {
      AI.AIStore.data.imageOpts = { ...(AI.AIStore.data.imageOpts || {}), size: imgSizeSel.value };
      AI.AIStore.save();
      if (imgCustomBox) imgCustomBox.hidden = (imgSizeSel.value !== "custom");
      syncImageWarnState();
    });
    imgQualitySel?.addEventListener("change", () => {
      AI.AIStore.data.imageOpts = { ...(AI.AIStore.data.imageOpts || {}), quality: imgQualitySel.value };
      AI.AIStore.save();
    });
    imgNSel?.addEventListener("change", () => {
      AI.AIStore.data.imageOpts = { ...(AI.AIStore.data.imageOpts || {}), n: +imgNSel.value || 1 };
      AI.AIStore.save();
    });
    imgApiModeSel?.addEventListener("change", () => {
      AI.AIStore.data.imageOpts = { ...(AI.AIStore.data.imageOpts || {}), apiMode: imgApiModeSel.value };
      AI.AIStore.save();
    });
    imgCustomW?.addEventListener("change", () => {
      AI.AIStore.data.imageOpts = { ...(AI.AIStore.data.imageOpts || {}), customW: +imgCustomW.value || 3840 };
      AI.AIStore.save();
      syncImageWarnState();
    });
    imgCustomH?.addEventListener("change", () => {
      AI.AIStore.data.imageOpts = { ...(AI.AIStore.data.imageOpts || {}), customH: +imgCustomH.value || 2160 };
      AI.AIStore.save();
      syncImageWarnState();
    });

    let attachments = [];
    let abortCtrl = null;

    // ===== AI 面板可拖动 + 可调大小 + 几何持久化 =====
    const PANEL_GEOM_KEY = "sakura_nav_ai_panel_geom_v1";
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

    function loadPanelGeometry() {
      // 移动端用 CSS @media 接管布局（占满屏幕），不读保存的桌面端几何，避免错位
      if (window.matchMedia("(max-width: 480px)").matches) return;
      try {
        const raw = localStorage.getItem(PANEL_GEOM_KEY);
        if (!raw) return;
        const g = JSON.parse(raw);
        if (!g || typeof g !== "object") return;
        // 兜底：极端值不应用，避免存了一份"窗口外"的位置导致面板看不见
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = clamp(+g.width  || 420, 320, vw);
        const h = clamp(+g.height || vh - 32, 360, vh);
        const top  = clamp(+g.top  || 16, 0, vh - 80);
        const left = clamp(+g.left || (vw - w - 16), -w + 100, vw - 100);
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.top = top + "px";
        panel.style.left = left + "px";
        panel.style.width = w + "px";
        panel.style.height = h + "px";
      } catch (_) {}
    }

    function savePanelGeometry() {
      if (window.matchMedia("(max-width: 480px)").matches) return; // 移动端不存
      const r = panel.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) return; // 防止 hidden 状态污染
      try {
        localStorage.setItem(PANEL_GEOM_KEY, JSON.stringify({
          top: Math.round(r.top), left: Math.round(r.left),
          width: Math.round(r.width), height: Math.round(r.height),
        }));
      } catch (_) {}
    }

    function resetPanelGeometry() {
      try { localStorage.removeItem(PANEL_GEOM_KEY); } catch (_) {}
      // 还原 CSS 默认（top/right + width/height）
      panel.style.top = "";
      panel.style.left = "";
      panel.style.right = "";
      panel.style.bottom = "";
      panel.style.width = "";
      panel.style.height = "";
    }

    // 1) 标题栏拖动 → 改 top/left
    {
      const head = panel.querySelector(".ai-head");
      let dragging = false;
      let startMouseX = 0, startMouseY = 0;
      let startTop = 0, startLeft = 0;

      head.addEventListener("mousedown", (e) => {
        // 点在按钮 / select / input / label 等交互元素上时不触发拖动
        if (e.target.closest("button, select, input, textarea, label, .ai-tool-btn, .ai-model-status")) return;
        if (e.button !== 0) return;
        dragging = true;
        const r = panel.getBoundingClientRect();
        startTop = r.top;
        startLeft = r.left;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        // 切到 top/left 定位（如果之前是 right/bottom）
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.top = startTop + "px";
        panel.style.left = startLeft + "px";
        panel.style.width = r.width + "px";
        panel.style.height = r.height + "px";
        panel.classList.add("ai-dragging");
        e.preventDefault();
      });

      document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = panel.offsetWidth;
        const newTop = clamp(startTop + dy, 0, vh - 60);
        const newLeft = clamp(startLeft + dx, -w + 120, vw - 120); // 至少留 120px 在屏幕里以便拖回
        panel.style.top = newTop + "px";
        panel.style.left = newLeft + "px";
      });

      document.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove("ai-dragging");
        savePanelGeometry();
      });
    }

    // 2) 监听 resize:both 触发的尺寸变化，自动持久化
    {
      let saveTimer = null;
      const ro = new ResizeObserver(() => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          // 只在面板可见时保存，避免 hidden 状态下的尺寸（0×0）覆盖正常值
          if (!panel.hidden) savePanelGeometry();
        }, 250);
      });
      ro.observe(panel);
    }

    // 3) 标题栏右键菜单：复位
    panel.querySelector(".ai-head").addEventListener("contextmenu", (e) => {
      // 在按钮等元素上不拦截
      if (e.target.closest("button, select, input, textarea, .ai-tool-btn, .ai-model-status")) return;
      e.preventDefault();
      if (confirm("把 AI 面板复位到默认位置和大小？")) {
        resetPanelGeometry();
        toast?.("AI 面板已复位");
      }
    });

    function open() {
      // 打开前先把保存的几何应用上（之所以在 open 而不是 init 时做，是因为 hidden 状态下 ResizeObserver 拿到的尺寸是 0）
      loadPanelGeometry();
      panel.hidden = false;
      fab.classList.remove("has-new");
      autoResize();
      setTimeout(() => input.focus(), 100);
      refreshPersonaOptions();
      refreshModelOptions();
      renderMessages();
    }
    function close() { panel.hidden = true; }

    function refreshPersonaOptions() {
      personaSel.innerHTML = AI.AIStore.data.personas.map((p) =>
        `<option value="${p.id}" ${p.id === AI.AIStore.data.currentPersonaId ? "selected" : ""}>${escapeHtml(p.name)}</option>`
      ).join("");
    }

    /** 把 AI.getModelStatus 的结果渲染成下拉前缀文本（select 不能塞 HTML，只能用 unicode 符号）。 */
    function modelOptionPrefix(p, m) {
      const st = AI.getModelStatus(p, m);
      if (st.kind === "cold")    return "❄ ";
      if (st.kind === "error")   return "⚠ ";
      if (st.kind === "ok")      return "✓ ";
      return "· ";
    }

    function refreshModelOptions() {
      const p = AI.AIStore.currentProvider();
      if (!p) { modelSel.innerHTML = `<option value="">请先添加供应商</option>`; refreshModelStatus(); return; }
      const models = (p.models && p.models.length ? p.models : [p.defaultModel || "default"]).filter(Boolean);
      modelSel.innerHTML = models.map((m) =>
        `<option value="${escapeHtml(m)}" ${m === AI.AIStore.data.currentModel ? "selected" : ""}>${escapeHtml(modelOptionPrefix(p, m) + m)}</option>`
      ).join("");
      if (!AI.AIStore.data.currentModel) AI.AIStore.data.currentModel = models[0];
      refreshModelStatus();
    }

    /** 用户已经反馈 "模型可用性应该出现在下拉里"，因此头部的状态徽章已删。
     *  refreshModelStatus 现在改成"重画下拉前缀 + 把当前模型的状态写到 select 的 title 提示里"。
     *  其它代码原来调用 refreshModelStatus()，全部继续可用。 */
    function refreshModelStatus() {
      const sel = modelSel;
      if (!sel) return;
      const p = AI.AIStore.currentProvider();
      const cur = AI.AIStore.data.currentModel;
      // 1) 重画每个 option 的前缀（基于最新台账）
      Array.from(sel.options).forEach((opt) => {
        const m = opt.value;
        if (!m) return;
        opt.textContent = (p ? modelOptionPrefix(p, m) : "· ") + m;
      });
      // 2) 给整个 select 一个 tooltip：当前模型最近状态
      if (!p || !cur) {
        sel.title = "选择模型（每条选项前的 ✓/❄/⚠/· 表示最近一次状态）";
        return;
      }
      const st = AI.getModelStatus(p, cur);
      const head = "选择模型 — 当前 " + cur + "：";
      let detail = "未测：尚未对该模型发起过请求";
      if (st.kind === "ok") {
        const mins = Math.max(1, Math.round(st.ageMs / 60000));
        detail = `✓ 可用（最近一次成功约 ${mins} 分钟前）`;
      } else if (st.kind === "cold") {
        const remainMin = Math.ceil(st.remainingMs / 60000);
        detail = `❄ 冷却中（约 ${remainMin} 分钟后恢复）`;
      } else if (st.kind === "error") {
        detail = `⚠ 出错：${(st.msg || "").slice(0, 120)}`;
      } else {
        detail = "· 未测";
      }
      sel.title = head + "\n" + detail + "\n\n下拉里每条选项前的 ✓/❄/⚠/· 表示该模型最近一次状态";
    }

    personaSel.addEventListener("change", () => {
      AI.AIStore.data.currentPersonaId = personaSel.value;
      AI.AIStore.save();
    });
    modelSel.addEventListener("change", () => {
      AI.AIStore.data.currentModel = modelSel.value;
      AI.AIStore.save();
      refreshModelStatus();
    });
    // 每 30 秒刷一下下拉前缀，让冷却剩余分钟自然衰减
    setInterval(refreshModelStatus, 30 * 1000);

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

    // 🔍 主动探测：逐个发 1-token 请求，挑第一个能通的模型
    $("#ai-find-model").addEventListener("click", async () => {
      const p = AI.AIStore.currentProvider();
      if (!p) { toast("请先在 AI 设置中添加供应商"); return; }
      const list = (p.models || []).filter(Boolean);
      if (!list.length) { toast("先点 ↻ 拉取模型列表"); return; }
      const findBtn = $("#ai-find-model");
      findBtn.disabled = true;
      findBtn.classList.add("spinning");
      const findCtrl = new AbortController();
      const stopOnEsc = (e) => { if (e.key === "Escape") findCtrl.abort(); };
      document.addEventListener("keydown", stopOnEsc);
      try {
        const live = await AI.findAvailableModel({
          provider: p,
          signal: findCtrl.signal,
          prefer: AI.AIStore.data.currentModel,
          onProgress: ({ index, total, model: m, status }) => {
            tipEl.classList.remove("err");
            if (status === "probing") tipEl.textContent = `🔍 探测 ${index}/${total}：${m}`;
            else if (status === "cooldown") tipEl.textContent = `❄️ ${m} 冷却中，跳过…`;
            else if (status === "ok") tipEl.textContent = `✅ 已选用 ${m}`;
            else if (status === "error") tipEl.textContent = `⚠️ ${m} 不可用，继续…`;
          },
        });
        if (live) {
          AI.AIStore.data.currentModel = live;
          AI.AIStore.save();
          refreshModelOptions();
          tipEl.textContent = `✅ 已切到可用模型：${live}`;
          setTimeout(() => tipEl.textContent = "", 4000);
        } else {
          tipEl.classList.add("err");
          tipEl.textContent = "所有模型都不可用，建议换一家供应商或稍后再试";
          setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 6000);
        }
      } catch (e) {
        tipEl.classList.add("err");
        tipEl.textContent = e.name === "AbortError" ? "已取消探测" : ("探测失败：" + (e.message || "").slice(0, 120));
        setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 4000);
      } finally {
        findBtn.disabled = false;
        findBtn.classList.remove("spinning");
        document.removeEventListener("keydown", stopOnEsc);
        // 探测把整个模型列表都跑了一遍，台账更新很多，整个下拉的前缀都要重画
        try { refreshModelOptions(); } catch (_) {}
      }
    });

    $("#ai-clear").addEventListener("click", () => {
      if (!confirm("清空当前会话？对话历史不可恢复。")) return;
      AI.AIStore.messages = [];
      AI.AIStore.saveMessages();
      renderMessages();
    });

    // 导出当前对话为 Markdown
    $("#ai-export")?.addEventListener("click", () => {
      const msgs = (AI.AIStore && Array.isArray(AI.AIStore.messages)) ? AI.AIStore.messages : [];
      if (!msgs.length) { toast("当前对话为空，无可导出"); return; }
      try {
        const md = aiMessagesToMarkdown(msgs);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ts = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const fname = `ai-chat-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.md`;
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        toast("已导出 " + fname);
      } catch (e) {
        console.error("[ai-export]", e);
        toast("导出失败：" + (e?.message || e));
      }
    });

    function aiMessagesToMarkdown(messages) {
      const lines = [];
      const title = (window.Store?.data?.siteTitle || document.title || "AI 对话");
      lines.push(`# ${title} · AI 对话记录`);
      lines.push("");
      lines.push(`> 导出时间：${new Date().toLocaleString()}`);
      const cur = AI.AIStore?.data;
      if (cur?.currentProviderId) {
        const p = (cur.providers || []).find((x) => x.id === cur.currentProviderId);
        if (p) lines.push(`> 当前供应商：${p.name || p.id} · 模型：${cur.currentModel || p.defaultModel || "—"}`);
      }
      lines.push("");
      lines.push("---");
      lines.push("");
      for (const m of messages) {
        const roleLabel = m.role === "user" ? "🧑 用户" : (m.role === "assistant" ? "🤖 助手" : (m.role === "system" ? "⚙ 系统" : m.role));
        lines.push(`## ${roleLabel}`);
        lines.push("");
        // 生图卡片（结构化数据）
        if (Array.isArray(m.imageResults) && m.imageResults.length) {
          const meta = m.imageMeta || {};
          if (meta.prompt) {
            lines.push(`**提示词：** ${meta.prompt}`);
          }
          const pills = [];
          if (meta.model) pills.push(`模型 \`${meta.model}\``);
          if (meta.size) pills.push(`尺寸 ${meta.size}`);
          if (meta.quality) pills.push(`质量 ${meta.quality}`);
          if (meta.count) pills.push(`数量 ${meta.count}`);
          if (pills.length) lines.push(`*${pills.join(" · ")}*`);
          lines.push("");
          m.imageResults.forEach((r, i) => {
            if (r.status === "done" && r.url) {
              lines.push(`![image-${i+1}](${r.url})`);
            } else if (r.status === "error") {
              lines.push(`> ❌ 第 ${i+1} 张生成失败：${r.error || "未知错误"}`);
            } else {
              lines.push(`> ⏳ 第 ${i+1} 张生成中…`);
            }
          });
          lines.push("");
          continue;
        }
        // 普通消息：content 可能是字符串或 {text, images}
        let text = "";
        if (typeof m.content === "string") text = m.content;
        else if (m.content && typeof m.content === "object") text = m.content.text || "";
        text = text || "";
        if (text) {
          lines.push(text);
        } else {
          lines.push("*(无内容)*");
        }
        // 用户附件图片
        if (m.content && Array.isArray(m.content.images) && m.content.images.length) {
          lines.push("");
          for (const img of m.content.images) {
            if (typeof img === "string") lines.push(`![attachment](${img})`);
          }
        }
        lines.push("");
      }
      return lines.join("\n");
    }
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

    // ============= 🍵 茶话会模式：按钮 + 配置弹窗 =============
    const councilBtn = $("#ai-council");
    const dlgCouncil = $("#dialog-council");

    function syncCouncilBtnState() {
      const cfg = AI.AIStore.data.council || {};
      const on = !!cfg.enabled && (cfg.members || []).length > 0;
      councilBtn?.setAttribute("aria-pressed", on ? "true" : "false");
      councilBtn?.classList.toggle("is-active", on);
      if (on) {
        const modeText = cfg.mode === "broadcast" ? "广播" : cfg.mode === "debate" ? "辩论" : "圆桌";
        councilBtn.title = `茶话会已开启 · ${modeText} · ${cfg.members.length} 位成员（点击重新配置）`;
      } else {
        councilBtn.title = "茶话会模式：多代理并行/辩论/圆桌对话";
      }
      // 茶话会启用时，单代理的"模型"和"角色"下拉变得无意义（每个成员有自己的）；
      // 设为 disabled + 加 council-overridden 类，配合 CSS 显示一个简短提示
      const modelSelect = $("#ai-model-select");
      const personaSelect = $("#ai-persona-select");
      if (modelSelect) {
        modelSelect.disabled = on;
        modelSelect.classList.toggle("council-overridden", on);
        modelSelect.title = on
          ? `茶话会模式 · ${cfg.members.length} 位成员各自的模型生效（在 🍵 弹窗里改）`
          : "模型（每条选项前的 ✓/❄/⚠/· 表示最近一次状态）";
      }
      if (personaSelect) {
        personaSelect.disabled = on;
        personaSelect.classList.toggle("council-overridden", on);
        personaSelect.title = on
          ? `茶话会模式 · 每位成员有各自的角色（在 🍵 弹窗里改）`
          : "角色";
      }
      // 茶话会和生图互斥；启用茶话会时关掉生图模式
      if (on && AI.AIStore.data.imageMode) {
        AI.AIStore.data.imageMode = false;
        try { $("#ai-image-mode")?.setAttribute("aria-pressed", "false"); } catch (_) {}
        try { $("#ai-image-mode")?.classList.remove("is-active"); } catch (_) {}
        try { syncImageWarnState && syncImageWarnState(); } catch (_) {}
      }
    }

    function renderCouncilMembers() {
      const list = $("#council-members-list");
      const empty = $("#council-members-empty");
      const cfg = AI.AIStore.data.council;
      list.innerHTML = "";
      if (!cfg.members.length) {
        empty.hidden = false;
        renderCouncilModerator();
        return;
      }
      empty.hidden = true;
      cfg.members.forEach((m, idx) => {
        const provider = AI.AIStore.data.providers.find((p) => p.id === m.providerId);
        const personaList = AI.AIStore.data.personas;
        const providerList = AI.AIStore.data.providers;
        const modelList = provider?.models || [];

        const row = document.createElement("div");
        row.className = "council-member-row";
        row.style.setProperty("--member-color", m.color || "#ff6b8a");
        row.dataset.id = m.id;
        row.innerHTML = `
          <button type="button" class="council-member-color" data-act="color" title="点击换颜色">${escapeHtml(m.emoji || "🌸")}</button>
          <div class="council-member-fields">
            <input class="council-member-label" data-act="label" value="${escapeHtml(m.label || "")}" placeholder="代理名（如 严肃顾问 / 吐槽役）" />
            <div class="council-member-row2">
              <label class="council-mini-field">
                <span>角色</span>
                <select data-act="persona">
                  <option value="">（不指定，用对话默认 prompt）</option>
                  ${personaList.map((p) => `<option value="${p.id}" ${p.id === m.personaId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
                </select>
              </label>
              <label class="council-mini-field">
                <span>供应商</span>
                <select data-act="provider">
                  ${providerList.map((p) => `<option value="${p.id}" ${p.id === m.providerId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
                </select>
              </label>
              <label class="council-mini-field">
                <span>模型</span>
                <select data-act="model">
                  ${modelList.length === 0 ? `<option value="">（先到 AI 设置里拉取这个供应商的模型列表）</option>` : ""}
                  ${modelList.map((m2) => `<option value="${m2}" ${m2 === m.model ? "selected" : ""}>${escapeHtml(m2)}</option>`).join("")}
                </select>
              </label>
            </div>
          </div>
          <button type="button" class="council-member-del" data-act="del" title="移除">✕</button>
        `;
        list.appendChild(row);
      });
      renderCouncilModerator();
    }

    function renderCouncilModerator() {
      const sel = $("#council-moderator");
      if (!sel) return;
      const cfg = AI.AIStore.data.council;
      sel.innerHTML = `<option value="">并行综合（每个代理各自综合一次）</option>` +
        cfg.members.map((m) => `<option value="${m.id}" ${m.id === cfg.moderatorMemberId ? "selected" : ""}>${escapeHtml(m.emoji || "🌸")} ${escapeHtml(m.label)}</option>`).join("");
    }

    function applyCouncilModeUI() {
      const mode = AI.AIStore.data.council.mode;
      dlgCouncil.querySelectorAll(".council-tab").forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      dlgCouncil.querySelectorAll("[data-mode-only]").forEach((el) => {
        el.hidden = el.dataset.modeOnly !== mode;
      });
    }

    let councilSnapshot = null;
    function openCouncilDialog() {
      const cfg = AI.AIStore.data.council;
      // 深拷贝快照，取消时回滚
      councilSnapshot = JSON.parse(JSON.stringify(cfg));
      $("#council-enabled").checked = !!cfg.enabled;
      $("#council-rounds").value = cfg.rounds || 1;
      $("#council-order").value = cfg.speakerOrder || "configured";
      const concEl = $("#council-concurrency");
      if (concEl) concEl.value = Math.max(1, Math.min(16, +cfg.concurrency || 4));
      applyCouncilModeUI();
      renderCouncilMembers();
      if (typeof dlgCouncil.showModal === "function" && !dlgCouncil.open) dlgCouncil.showModal();
      else dlgCouncil.setAttribute("open", "");
    }
    // 弹窗关闭时若没走 submit（用户点了取消 / X / Esc），把 in-memory state 回滚
    dlgCouncil.addEventListener("close", () => {
      if (councilSnapshot && dlgCouncil.returnValue !== "saved") {
        AI.AIStore.data.council = councilSnapshot;
        // 不需要 save() —— in-memory 已经回滚到与 localStorage 一致
      }
      councilSnapshot = null;
    });

    councilBtn?.addEventListener("click", openCouncilDialog);

    // 模式切换
    dlgCouncil.addEventListener("click", (e) => {
      const tab = e.target.closest(".council-tab");
      if (tab) {
        AI.AIStore.data.council.mode = tab.dataset.mode;
        applyCouncilModeUI();
        return;
      }
      const memberBtn = e.target.closest(".council-member-row [data-act]");
      if (memberBtn) {
        const id = memberBtn.closest(".council-member-row").dataset.id;
        const cfg = AI.AIStore.data.council;
        const m = cfg.members.find((x) => x.id === id);
        if (!m) return;
        if (memberBtn.dataset.act === "del") {
          cfg.members = cfg.members.filter((x) => x.id !== id);
          renderCouncilMembers();
        } else if (memberBtn.dataset.act === "color") {
          // 循环换 emoji + 颜色
          const palette = [
            { emoji: "🌸", color: "#ff6b8a" },
            { emoji: "🌊", color: "#0ea5e9" },
            { emoji: "🌿", color: "#3aa66e" },
            { emoji: "🔥", color: "#ff9d4a" },
            { emoji: "💜", color: "#ad6dff" },
            { emoji: "⭐", color: "#f59e0b" },
            { emoji: "🌙", color: "#7c83fa" },
            { emoji: "🍒", color: "#ec4899" },
          ];
          const cur = palette.findIndex((x) => x.emoji === m.emoji);
          const nx = palette[(cur + 1) % palette.length];
          m.emoji = nx.emoji;
          m.color = nx.color;
          renderCouncilMembers();
        }
      }
    });

    // input/change 写回
    dlgCouncil.addEventListener("input", (e) => {
      const row = e.target.closest(".council-member-row");
      if (!row) return;
      const m = AI.AIStore.data.council.members.find((x) => x.id === row.dataset.id);
      if (!m) return;
      const act = e.target.dataset.act;
      if (act === "label") m.label = e.target.value;
    });
    dlgCouncil.addEventListener("change", (e) => {
      const row = e.target.closest(".council-member-row");
      if (row) {
        const m = AI.AIStore.data.council.members.find((x) => x.id === row.dataset.id);
        if (!m) return;
        const act = e.target.dataset.act;
        if (act === "persona") m.personaId = e.target.value;
        else if (act === "provider") {
          m.providerId = e.target.value;
          // 切供应商时把 model 重置成新供应商的 default
          const p = AI.AIStore.data.providers.find((x) => x.id === m.providerId);
          m.model = p?.defaultModel || (p?.models || [])[0] || "";
          renderCouncilMembers();
        } else if (act === "model") m.model = e.target.value;
        return;
      }
      // 模式选项
      if (e.target.id === "council-rounds") AI.AIStore.data.council.rounds = Math.max(1, Math.min(3, +e.target.value || 1));
      else if (e.target.id === "council-order") AI.AIStore.data.council.speakerOrder = e.target.value;
      else if (e.target.id === "council-moderator") AI.AIStore.data.council.moderatorMemberId = e.target.value;
      else if (e.target.id === "council-enabled") AI.AIStore.data.council.enabled = e.target.checked;
    });

    // + 添加成员
    $("#council-add-member")?.addEventListener("click", () => {
      const cfg = AI.AIStore.data.council;
      if (!AI.AIStore.data.providers.length) { toast("请先到 AI 设置里添加供应商"); return; }
      cfg.members.push(AI.makeCouncilMember());
      renderCouncilMembers();
    });

    // ⚡ 深度研究：借鉴 grok-4.20-multi-agent-xhigh，一键建 16 个差异化角色成员
    $("#council-deep-research")?.addEventListener("click", () => {
      const cfg = AI.AIStore.data.council;
      const providers = AI.AIStore.data.providers || [];
      if (!providers.length) { toast("请先到 AI 设置里添加供应商"); return; }

      // 16 个差异化角色（emoji + label + 系统提示偏置），覆盖常见思维角度
      const ROLES = [
        { emoji: "🔬", label: "实证派",   bias: "你只看数据、引用与可验证事实，不接受空泛论断。" },
        { emoji: "🎯", label: "聚焦者",   bias: "你只回答用户真正问的那一点，拒绝展开离题内容。" },
        { emoji: "🛡️", label: "怀疑者",   bias: "你逐条挑战默认假设，追问\"为什么不会反过来\"。" },
        { emoji: "🚀", label: "乐观派",   bias: "你优先发掘机会和上行空间，但不忽略关键风险。" },
        { emoji: "⚠️", label: "风险官",   bias: "你列出所有可能失败的方式，按严重度排序。" },
        { emoji: "🧮", label: "量化师",   bias: "尽可能给出数字、比例、量级，避免\"一些/很多\"。" },
        { emoji: "🌍", label: "宏观视角", bias: "你从趋势、行业、长周期角度看问题，不陷入细节。" },
        { emoji: "🔍", label: "细节控",   bias: "你专门挑别人会忽略的边角和实现细节。" },
        { emoji: "🧑‍🎨", label: "创意者",  bias: "你给出 3 个非常规、跳出框架的方案。" },
        { emoji: "⚖️", label: "权衡师",   bias: "你列出每个方案的取舍 (trade-off) 矩阵。" },
        { emoji: "📚", label: "历史学者", bias: "你引用类似的历史先例或行业案例支撑判断。" },
        { emoji: "🛠️", label: "实施派",   bias: "你只关心\"明天就能开始执行\"的具体步骤。" },
        { emoji: "💰", label: "成本控",   bias: "你估算金钱 / 时间 / 注意力成本，优先低成本方案。" },
        { emoji: "🧭", label: "战略官",   bias: "你从长期目标反推当前应该做的事。" },
        { emoji: "🤝", label: "利益相关", bias: "你列出每一方的诉求与潜在冲突。" },
        { emoji: "🪞", label: "反思者",   bias: "你复盘别人答案的盲点，给出更平衡的最终结论。" },
      ];

      // 配色：跟原 makeCouncilMember 一致的调色板，循环使用
      const PALETTE = ["#ff6b8a", "#7c83fa", "#3aa66e", "#ff9d4a", "#ad6dff", "#ec4899", "#0ea5e9", "#f59e0b"];

      // 模型选取：每个 provider 用 rankModels 取最优；多 provider 时轮询
      const providerPicks = providers.map((p) => {
        const all = (p.models || []).filter(Boolean);
        const ranked = all.length ? AI.rankModels(p, all).ordered : [];
        return {
          provider: p,
          // 给每个 provider 最多准备 4 个候选模型，循环用
          models: ranked.slice(0, 4).length ? ranked.slice(0, 4) : [p.defaultModel].filter(Boolean),
        };
      }).filter((x) => x.models.length);

      if (!providerPicks.length) {
        toast("没有可用模型，请先到 AI 设置里加载模型列表");
        return;
      }

      // 建 16 个成员
      cfg.members = [];
      for (let i = 0; i < ROLES.length; i++) {
        const role = ROLES[i];
        const pick = providerPicks[i % providerPicks.length];
        const model = pick.models[Math.floor(i / providerPicks.length) % pick.models.length];
        cfg.members.push({
          id: "deep-" + i + "-" + Math.random().toString(36).slice(2, 6),
          label: role.label,
          emoji: role.emoji,
          color: PALETTE[i % PALETTE.length],
          personaId: "",      // 用空 persona，下面 systemPromptOverride 接管
          providerId: pick.provider.id,
          model,
          systemPromptOverride: `你扮演"${role.label}"角色。${role.bias}\n回答控制在 200 字以内，紧扣用户原始问题，不重复别人会说的部分。`,
        });
      }

      // 自动开启 + 广播模式 + 并发 4
      cfg.enabled  = true;
      cfg.mode     = "broadcast";
      cfg.concurrency = Math.min(4, ROLES.length);

      // 同步 UI 状态
      $("#council-enabled") && ($("#council-enabled").checked = true);
      $("#council-concurrency") && ($("#council-concurrency").value = cfg.concurrency);
      $$(".council-tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.mode === "broadcast" ? "true" : "false"));
      $$(".council-mode-row").forEach((r) => {
        const only = r.dataset.modeOnly;
        r.hidden = only && only !== "broadcast";
      });
      renderCouncilMembers();
      toast(`已生成 16 个差异化角色成员（并发 ${cfg.concurrency}）`);
    });

    // 并发上限输入
    $("#council-concurrency")?.addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(16, +e.target.value || 4));
      AI.AIStore.data.council.concurrency = v;
      e.target.value = v;
    });

    // 保存（form submit）
    $("#form-council").addEventListener("submit", (e) => {
      e.preventDefault();
      const cfg = AI.AIStore.data.council;
      if (cfg.enabled && !cfg.members.length) {
        toast("茶话会模式至少需要一位成员");
        return;
      }
      // 校验每位成员有 provider + model
      for (const m of cfg.members) {
        if (!m.providerId || !m.model) {
          toast(`成员"${m.label || "未命名"}"还没选供应商或模型`);
          return;
        }
      }
      AI.AIStore.save();
      syncCouncilBtnState();
      // 标记 returnValue=saved，让 close 监听器知道这次是保存而不是取消，不要回滚
      dlgCouncil.close("saved");
      toast(cfg.enabled ? `已开启茶话会 · ${cfg.members.length} 位成员` : "已保存（未启用）");
    });

    // 启动时初始化按钮状态；同时暴露给外部，让 bootApp 在 load() 完成后能再 sync 一次
    syncCouncilBtnState();
    window.__syncCouncilBtnState = syncCouncilBtnState;

    // 建议按钮
    messagesEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ai-suggest]");
      if (b) { input.value = b.dataset.aiSuggest; input.focus(); autoResize(); }
    });

    // 附件
    attachInput.addEventListener("change", async () => {
      for (const f of attachInput.files) {
        try {
          const att = await AI.fileToAttachment(f);
          attachments.push(att);
          // 图片附件自动入图库
          if (att?.type === "image" && att.dataUrl && window.Archive?.Gallery) {
            window.Archive.Gallery.add({
              source: "uploaded",
              dataUrl: att.dataUrl,
              name: att.name || "",
              mime: f.type || "image/png",
              bytes: f.size || 0,
            }).catch(() => {});
          }
        }
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
    function autoResize() {
      input.style.height = "auto";
      const nextHeight = Math.min(input.scrollHeight, 140);
      input.style.height = nextHeight + "px";
      input.style.overflowY = input.scrollHeight > 140 ? "auto" : "hidden";
    }

    sendBtn.addEventListener("click", send);
    stopBtn.addEventListener("click", () => { abortCtrl?.abort(); });

    /** 茶话会模式总入口：根据 cfg.mode 分发到 broadcast / debate / roundtable。
     *  调用前 userMsg 已经入栈。返回后所有成员的 assistant 消息都已经写好。 */
    async function sendCouncil(userText, currentAttachments, cfg) {
      const members = (cfg.members || []).slice();
      if (!members.length) throw new Error("茶话会没有配置任何成员");

      // 在每个 send 开头先写一条"轮次分隔"消息，让历史记录里看得出这是同一次提问
      const startMarker = {
        role: "system",
        councilDivider: true,
        content: cfg.mode === "broadcast" ? "🍵 广播" : cfg.mode === "debate" ? "🍵 辩论 · 第 1 轮" : "🍵 圆桌",
        ts: Date.now(),
        councilHidden: true, // 不送给模型
      };
      AI.AIStore.messages.push(startMarker);
      renderMessages();

      if (cfg.mode === "broadcast") {
        await runCouncilBroadcast(members, userText, currentAttachments);
        return;
      }
      if (cfg.mode === "debate") {
        await runCouncilDebate(members, userText, currentAttachments, cfg);
        return;
      }
      if (cfg.mode === "roundtable") {
        await runCouncilRoundtable(members, userText, currentAttachments, cfg);
        return;
      }
    }

    /** 广播：所有成员并行发请求，每个有自己的 streaming bubble，互不见对方。
     *  借鉴 grok2api 多 agent 协同的三个思路：
     *  - 并发上限信号量（默认 4，可通过 council.concurrency 调）：避免 16 成员同时炸
     *  - 进度卡片：顶部 N/T 完成 · X 失败 · 平均耗时
     *  - 单成员失败自动用 rankModels 选下一个备选模型重试一次（429/5xx 触发） */
    async function runCouncilBroadcast(members, userText, currentAttachments) {
      const cfg = AI.AIStore.data.council || {};
      const concurrency = Math.max(1, Math.min(16, +cfg.concurrency || 4));

      // 进度卡片（一条独立的 system 消息，类型 councilProgress）
      const progress = {
        role: "system",
        councilProgress: true,
        total: members.length,
        done: 0,
        failed: 0,
        retried: 0,
        startTs: Date.now(),
        latencies: [],
        ts: Date.now(),
        councilHidden: true, // 不送给模型
      };
      AI.AIStore.messages.push(progress);

      // 占位 assistant 消息（保持 UI 顺序稳定）
      const slots = members.map((m) => {
        const msg = {
          role: "assistant",
          content: "",
          ts: Date.now(),
          streaming: true,
          councilMember: { id: m.id, label: m.label, color: m.color, emoji: m.emoji },
          councilTurn: { mode: "broadcast", round: 1 },
        };
        AI.AIStore.messages.push(msg);
        return { member: m, msg };
      });
      AI.AIStore.saveMessages();
      renderMessages();

      const sem = AI.semaphore(concurrency);

      // 失败是否可自动重试：429/5xx/Network 类（避开 401/403 等鉴权失败 + 用户取消）
      const isRetriable = (err) => {
        if (!err || err.name === "AbortError") return false;
        const code = err.status || err.code || 0;
        if (code === 429) return true;
        if (code >= 500 && code < 600) return true;
        // 没有 status 字段的网络层错误也认为可重试
        if (!code && /(network|timeout|fetch|ECONN|ENOTFOUND)/i.test(err.message || "")) return true;
        return false;
      };

      await Promise.all(slots.map(({ member, msg }) => sem.run(async () => {
        if (abortCtrl?.signal.aborted) {
          msg.streaming = false;
          msg.content = "_[已取消]_";
          updateCouncilBubble(msg);
          progress.failed++;
          updateCouncilProgressBubble(progress);
          return;
        }

        const provider = AI.AIStore.data.providers.find((p) => p.id === member.providerId);
        if (!provider) {
          msg.streaming = false;
          msg.content = `_供应商 ${member.providerId} 已不存在_`;
          msg.error = true;
          updateCouncilBubble(msg);
          progress.failed++;
          updateCouncilProgressBubble(progress);
          return;
        }

        const t0 = Date.now();
        const tried = new Set();
        let currentModel = member.model;
        let lastErr = null;

        // 最多 2 轮：原模型 + 一次自动备选
        for (let attempt = 0; attempt < 2; attempt++) {
          tried.add(currentModel);
          // 重试时给气泡挂一个 "↻ 换模型重试" 元数据，方便 UI 标记
          if (attempt > 0) {
            msg.routedFrom = member.model;
            msg.routedTo = currentModel;
            progress.retried++;
            updateCouncilProgressBubble(progress);
          }
          try {
            const msgs = await AI.buildMessagesForMember(member, userText, currentAttachments);
            await AI.chat({
              provider, model: currentModel, messages: msgs,
              signal: abortCtrl.signal,
              retry: { maxAttempts: 2, delayMs: 1200 },
              onDelta: (_d, full) => {
                msg.content = full;
                updateCouncilBubble(msg);
                scrollToBottom();
              },
            });
            lastErr = null;
            break; // 成功，退出 attempt 循环
          } catch (err) {
            lastErr = err;
            // 用户主动取消：直接退出
            if (err?.name === "AbortError") break;
            // 不可重试 / 已经是第二次尝试：直接失败
            if (attempt === 1 || !isRetriable(err)) break;
            // 选下一个备选模型
            const next = AI.pickNextModelFor(provider, currentModel, tried);
            if (!next) break;
            currentModel = next;
            msg.content = ""; // 清掉前一次的半成品内容，重新流
          }
        }

        // 收尾：更新气泡 + 进度
        if (lastErr) {
          if (lastErr.name === "AbortError") {
            msg.content += "\n\n_[已取消]_";
          } else {
            msg.content = formatAIError(lastErr);
            msg.error = true;
          }
          progress.failed++;
        } else {
          progress.done++;
          progress.latencies.push(Date.now() - t0);
        }
        msg.streaming = false;
        AI.AIStore.saveMessages();
        updateCouncilBubble(msg);
        updateCouncilProgressBubble(progress);
      })));

      // 全部结束：标记进度卡完成
      progress.finishedTs = Date.now();
      AI.AIStore.saveMessages();
      updateCouncilProgressBubble(progress);
    }

    /** 把进度卡渲染成一行紧凑的横向胶囊。 */
    function renderCouncilProgress(p) {
      const pct = p.total ? Math.round((p.done + p.failed) / p.total * 100) : 0;
      const avgMs = p.latencies && p.latencies.length
        ? Math.round(p.latencies.reduce((a, b) => a + b, 0) / p.latencies.length)
        : 0;
      const elapsed = Math.round(((p.finishedTs || Date.now()) - p.startTs) / 1000);
      const running = !p.finishedTs;
      return `<div class="ai-council-progress ${running ? "running" : "done"}">
        <span class="acp-ico">${running ? "🍵" : (p.failed ? "⚠️" : "✅")}</span>
        <div class="acp-bar"><div class="acp-bar-fill" style="width:${pct}%"></div></div>
        <span class="acp-stat"><b>${p.done}</b>/${p.total}</span>
        ${p.failed ? `<span class="acp-stat err">${p.failed} 失败</span>` : ""}
        ${p.retried ? `<span class="acp-stat warn">${p.retried} 换模型</span>` : ""}
        ${avgMs ? `<span class="acp-stat">平均 ${(avgMs / 1000).toFixed(1)}s</span>` : ""}
        <span class="acp-stat muted">总 ${elapsed}s</span>
      </div>`;
    }

    function updateCouncilProgressBubble(progress) {
      const idx = AI.AIStore.messages.indexOf(progress);
      if (idx < 0) return;
      const wrap = messagesEl.querySelectorAll(".ai-msg")[idx];
      if (!wrap) return;
      wrap.innerHTML = renderCouncilProgress(progress);
    }

    /** 辩论：第 1 轮广播 → 第 2 轮把所有 R1 答案喂给主持人/全体 综合反驳。 */
    async function runCouncilDebate(members, userText, currentAttachments, cfg) {
      // R1
      await runCouncilBroadcast(members, userText, currentAttachments);
      if (abortCtrl?.signal.aborted) return;

      // 综合摘要：把 R1 的所有 bubble 内容拼成"各代理初步回答"块
      const r1Summary = members.map((m) => {
        const msg = [...AI.AIStore.messages].reverse().find((x) => x.councilMember?.id === m.id && x.councilTurn?.round === 1);
        const txt = (msg?.content || "_(无回答)_").slice(0, 1200);
        return `### ${m.emoji || ""} ${m.label}\n${txt}`;
      }).join("\n\n");

      const debatePrompt =
        "【辩论第 2 轮 · 综合反驳】以下是这一轮所有代理的第一轮初步回答。\n" +
        "请你阅读后给出综合判断：\n" +
        "1) 找出共识；\n" +
        "2) 指出彼此分歧 / 错误 / 遗漏；\n" +
        "3) 给出你最终的判断，必要时直接反驳前面某位代理的具体观点。\n" +
        "答案要紧扣用户原始问题。\n\n" +
        "原始问题：\n" + userText + "\n\n" +
        "其他代理的初步回答：\n" + r1Summary;

      // 决定 R2 的"综合者"：moderatorMemberId 指定一个，否则全员各自综合一次
      const moderators = cfg.moderatorMemberId
        ? members.filter((m) => m.id === cfg.moderatorMemberId)
        : members;
      if (!moderators.length) return;

      // R2 分隔
      AI.AIStore.messages.push({ role: "system", councilDivider: true, content: "🍵 辩论 · 第 2 轮（综合反驳）", ts: Date.now(), councilHidden: true });
      renderMessages();

      const r2Slots = moderators.map((m) => {
        const msg = {
          role: "assistant", content: "", ts: Date.now(), streaming: true,
          councilMember: { id: m.id, label: m.label, color: m.color, emoji: m.emoji },
          councilTurn: { mode: "debate", round: 2 },
        };
        AI.AIStore.messages.push(msg);
        return { member: m, msg };
      });
      AI.AIStore.saveMessages();
      renderMessages();

      await Promise.all(r2Slots.map(async ({ member, msg }) => {
        const provider = AI.AIStore.data.providers.find((p) => p.id === member.providerId);
        try {
          const msgs = await AI.buildMessagesForMember(member, userText, currentAttachments, { extraSystem: debatePrompt });
          await AI.chat({
            provider, model: member.model, messages: msgs,
            signal: abortCtrl.signal,
            retry: { maxAttempts: 2, delayMs: 1200 },
            onDelta: (_d, full) => { msg.content = full; updateCouncilBubble(msg); scrollToBottom(); },
          });
        } catch (err) {
          if (err?.name === "AbortError") msg.content += "\n\n_[已取消]_";
          else { msg.content = formatAIError(err); msg.error = true; }
        } finally {
          msg.streaming = false;
          AI.AIStore.saveMessages();
          updateCouncilBubble(msg);
        }
      }));
    }

    /** 圆桌：每个成员轮流发言，能看见前面所有人的发言（同一轮 + 上一轮）。
     *  通过把 history 里的 [代理名]: 内容 当作 assistant 历史送回。 */
    async function runCouncilRoundtable(members, userText, currentAttachments, cfg) {
      const rounds = Math.max(1, Math.min(3, cfg.rounds || 1));
      let order = members.slice();
      for (let r = 1; r <= rounds; r++) {
        if (cfg.speakerOrder === "random") {
          // 简易 Fisher-Yates
          for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
          }
        }
        if (r > 1) {
          AI.AIStore.messages.push({ role: "system", councilDivider: true, content: `🍵 圆桌 · 第 ${r} 轮`, ts: Date.now(), councilHidden: true });
          renderMessages();
        }
        for (const member of order) {
          if (abortCtrl?.signal.aborted) return;
          const provider = AI.AIStore.data.providers.find((p) => p.id === member.providerId);
          const msg = {
            role: "assistant", content: "", ts: Date.now(), streaming: true,
            councilMember: { id: member.id, label: member.label, color: member.color, emoji: member.emoji },
            councilTurn: { mode: "roundtable", round: r },
          };
          AI.AIStore.messages.push(msg);
          AI.AIStore.saveMessages();
          renderMessages();

          try {
            // buildMessagesForMember 已经把历史中的茶话会消息扁平化成 [代理名]: 内容 → 当前成员能看到前面的发言
            const extraUser = r === 1 && order[0]?.id === member.id ? "" : "请你简洁地回应（或反驳 / 补充）前面已经发言的代理；如果是第一个发言就直接给观点。";
            const msgs = await AI.buildMessagesForMember(member, userText, currentAttachments, { extraUser });
            await AI.chat({
              provider, model: member.model, messages: msgs,
              signal: abortCtrl.signal,
              retry: { maxAttempts: 2, delayMs: 1200 },
              onDelta: (_d, full) => { msg.content = full; updateCouncilBubble(msg); scrollToBottom(); },
            });
          } catch (err) {
            if (err?.name === "AbortError") { msg.content += "\n\n_[已取消]_"; msg.streaming = false; AI.AIStore.saveMessages(); updateCouncilBubble(msg); return; }
            else { msg.content = formatAIError(err); msg.error = true; }
          } finally {
            msg.streaming = false;
            AI.AIStore.saveMessages();
            updateCouncilBubble(msg);
          }
        }
      }
    }

    /** 局部更新某条茶话会 bubble 的 DOM，避免整列表 rerender 抢焦点 */
    function updateCouncilBubble(msg) {
      // 找到这条消息在 AIStore.messages 中的索引
      const idx = AI.AIStore.messages.indexOf(msg);
      if (idx < 0) return;
      const el = messagesEl.querySelectorAll(".ai-msg")[idx];
      if (!el) return;
      const bubble = el.querySelector(".ai-bubble");
      if (!bubble) return;
      bubble.innerHTML = renderCouncilBubble(msg);
    }

    function renderCouncilBubble(msg) {
      const m = msg.councilMember || {};
      const turn = msg.councilTurn || {};
      const meta = turn.mode === "debate" && turn.round === 2 ? "综合 · 第 2 轮"
        : turn.mode === "roundtable" ? `圆桌 · 第 ${turn.round} 轮`
        : "";
      const tag = `<div class="ai-council-tag" style="--member-color:${m.color || "#ff6b8a"}">
        <span>${escapeHtml(m.emoji || "🌸")}</span>
        <span>${escapeHtml(m.label || "代理")}</span>
        ${meta ? `<span class="acl-meta">· ${meta}</span>` : ""}
      </div>`;
      return tag + renderAssistantContent(msg.content || "", msg);
    }

    async function send() {
      const text = input.value.trim();
      if (!text && !attachments.length) return;
      const councilCfg = AI.AIStore.data.council;
      const councilOn = !!councilCfg?.enabled && (councilCfg.members || []).length > 0;
      // 茶话会模式不需要 currentProvider/currentModel；每个成员有自己的
      let provider = null;
      let model = "";
      if (!councilOn) {
        provider = AI.AIStore.currentProvider();
        if (!provider) {
          tipEl.classList.add("err");
          tipEl.textContent = "请先在 AI 设置中添加供应商";
          setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 3500);
          return;
        }
        model = AI.AIStore.data.currentModel || provider.defaultModel;
        if (!model) { toast("请先选择模型"); return; }
      } else {
        // 茶话会模式预校验：每个成员都得有 provider+model，且 provider 还存在
        const stale = (councilCfg.members || []).filter((m) => {
          const p = AI.AIStore.data.providers.find((pp) => pp.id === m.providerId);
          return !p || !m.model;
        });
        if (stale.length) {
          tipEl.classList.add("err");
          tipEl.textContent = `茶话会有 ${stale.length} 位成员的供应商或模型已失效，请在配置里重新选`;
          setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 4500);
          return;
        }
      }
      const imageMode = !!AI.AIStore.data.imageMode && !councilOn; // 茶话会和生图互斥

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

      const currentAttachments = attachments.slice();
      input.value = "";
      attachments = [];
      renderAttachments();
      autoResize();
      stopBtn.hidden = false;
      sendBtn.hidden = true;
      panel.classList.add("is-sending");
      abortCtrl = new AbortController();

      // ========== 🍵 茶话会分支 ==========
      if (councilOn) {
        try {
          await sendCouncil(text, currentAttachments, councilCfg);
        } catch (err) {
          if (err?.name !== "AbortError") {
            tipEl.classList.add("err");
            tipEl.textContent = (err.message || "茶话会出错").replace(/\s+/g, " ").slice(0, 160);
            setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 6000);
          }
        } finally {
          abortCtrl = null;
          stopBtn.hidden = true;
          sendBtn.hidden = false;
          panel.classList.remove("is-sending");
          try { refreshModelStatus(); } catch (_) {}
          try { syncCouncilBtnState(); } catch (_) {}
        }
        return;
      }

      const asstMsg = { role: "assistant", content: "", ts: Date.now(), streaming: true };
      AI.AIStore.messages.push(asstMsg);
      renderMessages();

      // 思考状态已经移到气泡里的动画指示器；tipEl 只在生图时仍给一句文字
      tipEl.textContent = imageMode ? "正在生成图片…" : "";

      // ========== 🎨 生图分支 ==========
      if (imageMode) {
        // 借鉴 ChatGpt-Image-Studio 的 turn 模型：把元数据 + 生图占位写到 assistant 消息上，渲染时走结构化卡片而不是 markdown 拼字符串
        const opts = AI.AIStore.data.imageOpts || {};
        let size = opts.size || "1024x1024";
        if (size === "custom") {
          const w = Math.max(64, +opts.customW || 3840);
          const h = Math.max(64, +opts.customH || 2160);
          size = `${w}x${h}`;
        }
        const requestedCount = Math.max(1, +opts.n || 1);
        asstMsg.imageMeta = {
          size,
          quality: opts.quality || "auto",
          n: requestedCount,
          model,
          prompt: text || "",
          startedAt: Date.now(),
        };
        // 占位 results：每张都是 loading
        asstMsg.imageResults = Array.from({ length: requestedCount }, (_, i) => ({
          id: "img-" + Date.now() + "-" + i,
          status: "loading",
        }));
        // imageGenStatus 由 renderAssistantContent 用来显示"已等待 XXs"，发送中持续递增
        asstMsg.imageGenStatus = { phase: "running", elapsedSec: 0 };
        renderMessages();
        const tickTimer = setInterval(() => {
          if (!asstMsg.imageGenStatus || asstMsg.imageGenStatus.phase !== "running") return;
          asstMsg.imageGenStatus.elapsedSec = Math.floor((Date.now() - asstMsg.imageMeta.startedAt) / 1000);
          // 只重渲染当前最后一条助手 bubble，避免整列表重建
          const bubble = messagesEl.querySelector(".ai-msg:last-child .ai-bubble");
          if (bubble) bubble.innerHTML = renderAssistantContent(asstMsg.content, asstMsg);
        }, 1000);

        try {
          const apiMode = opts.apiMode || "images";
          // Responses 模式：希望上游每 ~25% 推一次 partial_image，便于实时显示进度
          const partialN = apiMode === "responses" ? 2 : 0;
          const arr = await AI.generateImage({
            provider, model,
            prompt: text || "请生成一张创意图片",
            size,
            quality: opts.quality || "auto",
            n: requestedCount,
            apiMode,
            signal: abortCtrl.signal,
            retry: {
              // Responses 用默认 3 次 + 15s 退避（Image-Studio 风格），Images 维持原 2 次
              maxAttempts: apiMode === "responses" ? 3 : 2,
              delayMs: apiMode === "responses" ? 15_000 : 1500,
              onRetry: (n, total, err, stage) => {
                if (stage === "fallback-images") {
                  // Responses 全失败，正在改用 Images 模式
                  tipEl.textContent = `⤵ Responses 模式失败 (HTTP ${err?.status || "?"})，自动改用 Images 模式…`;
                  return;
                }
                const reason = err?.status ? ` (HTTP ${err.status})` : "";
                tipEl.textContent = `生图重试 ${n}/${total - 1}${reason} · 15s 后再试…`;
              },
            },
            // Responses 模式收到 partial_image 时立刻把半成品塞进第一张卡片
            onPartial: ({ b64, revisedPrompt, heartbeats }) => {
              if (!b64 || !asstMsg.imageResults?.length) return;
              const slot = asstMsg.imageResults[0];
              slot.status = "partial";
              slot.dataUrl = "data:image/png;base64," + b64;
              slot.revisedPrompt = revisedPrompt || slot.revisedPrompt || "";
              if (!asstMsg.imageGenStatus) asstMsg.imageGenStatus = {};
              asstMsg.imageGenStatus.heartbeats = heartbeats;
              asstMsg.imageGenStatus.hasPartial = true;
              const bubble = messagesEl.querySelector(".ai-msg:last-child .ai-bubble");
              if (bubble) bubble.innerHTML = renderAssistantContent(asstMsg.content, asstMsg);
            },
          });
          // 把返回结果 merge 到占位 results 上；多了的填，少了的标错（借鉴 mergeResultImages）
          const merged = arr.map((it, i) => ({
            id: asstMsg.imageResults[i]?.id || "img-" + Date.now() + "-" + i,
            // Responses API 返回 sourceEvent，标记是否为 partial 兜底
            status: it.degraded || it.sourceEvent === "partial" ? "partial" : "success",
            dataUrl: it.dataUrl,
            url: it.url,
            revisedPrompt: it.revisedPrompt || "",
            degraded: !!(it.degraded || it.sourceEvent === "partial"),
          }));
          while (merged.length < requestedCount) {
            merged.push({
              id: "img-err-" + merged.length,
              status: "error",
              error: "接口返回的图片数量不足",
            });
          }
          asstMsg.imageResults = merged;
          asstMsg.imageGenStatus = { phase: "done", elapsedSec: Math.floor((Date.now() - asstMsg.imageMeta.startedAt) / 1000) };
          asstMsg.streaming = false;
          // content 留空，渲染走 imageResults 卡片；存一个简短 markdown 描述用于历史导出/复制
          asstMsg.content = `**🎨 生图** · \`${model}\` · ${size} · ${opts.quality || "auto"} · 张数 ${arr.length}`;
          AI.AIStore.saveMessages();
          renderMessages();
          tipEl.textContent = "";
          // 入图库（生图成功 → Gallery.addBatch）
          if (window.Archive && window.Archive.Gallery) {
            window.Archive.Gallery.addBatch(
              merged
                .filter((r) => r.status === "success" && (r.dataUrl || r.url))
                .map((r) => ({
                  source: "generated",
                  dataUrl: r.dataUrl || r.url,
                  prompt: text || "",
                  revisedPrompt: r.revisedPrompt || "",
                  model, size, quality: opts.quality || "auto",
                }))
            ).catch(() => {});
          }
        } catch (err) {
          asstMsg.streaming = false;
          asstMsg.imageGenStatus = { phase: "done", elapsedSec: Math.floor((Date.now() - asstMsg.imageMeta.startedAt) / 1000) };
          if (err.name === "AbortError") {
            // 取消：所有占位变成 cancelled
            asstMsg.imageResults = (asstMsg.imageResults || []).map((r) => r.status === "loading"
              ? { ...r, status: "cancelled" }
              : r);
            asstMsg.content = `**🎨 生图** · \`${model}\` · 已取消`;
          } else {
            // 失败：所有占位变成 error，每张都带友好翻译。content 只存一个简短摘要，
            // 不存完整 formatAIError 文本，避免历史里塞重复内容；详细错误在 imageResults[i].error 里。
            const friendly = AI.formatImageErrorMessage(err.message || "生图失败");
            asstMsg.imageResults = (asstMsg.imageResults || []).map((r) => r.status === "loading"
              ? { ...r, status: "error", error: friendly }
              : r);
            asstMsg.imageError = friendly;
            asstMsg.error = true;
            asstMsg.content = `**🎨 生图失败** · \`${model}\` · ${friendly.split("\n")[0]}`;
          }
          AI.AIStore.saveMessages();
          renderMessages();
          tipEl.classList.add("err");
          tipEl.textContent = (err.message || "生图失败").replace(/\s+/g, " ").slice(0, 160);
          setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 6000);
        } finally {
          clearInterval(tickTimer);
          abortCtrl = null;
          stopBtn.hidden = true;
          sendBtn.hidden = false;
          panel.classList.remove("is-sending");
          try { refreshModelStatus(); } catch (_) {}
        }
        return;
      }

      // 构建候选模型链：用户选的优先，剩下按 provider.models 顺序补齐；
      // 本地台账里仍在冷却中的模型先排到末尾（保留作为兜底）；同时考虑 upstream 维度的冷却。
      const allModels = (provider.models || []).filter(Boolean);
      const dedupe = new Set();
      const orderedAll = [model, ...allModels].filter((m) => {
        if (!m || dedupe.has(m)) return false;
        dedupe.add(m); return true;
      });
      const ranked = AI.rankModels(provider, orderedAll);
      let chain = ranked.fresh.length ? [...ranked.fresh, ...ranked.cold] : ranked.ordered;

      // 智能模式：当前选的模型已经在台账里冷却 → 发送前先用 1-token 探针找一个真正活的
      if (AI.AIStore.data.smartMode && ranked.cold.includes(model)) {
        try {
          tipEl.textContent = "智能模式：探测可用模型…";
          const live = await AI.findAvailableModel({
            provider,
            signal: abortCtrl.signal,
            prefer: model,
            onProgress: ({ index, total, model: m, status }) => {
              tipEl.textContent =
                status === "probing" ? `智能模式：探测 ${index}/${total} «${m}»…` :
                status === "cooldown" ? `«${m}» 冷却中，跳过…` :
                status === "ok" ? `已选用 «${m}»` :
                tipEl.textContent;
            },
          });
          if (live) chain = [live, ...chain.filter((m) => m !== live)];
        } catch (_) { /* 探测失败也走原 chain */ }
      }

      let usedModel = chain[0];
      let succeeded = false;
      let lastErr = null;
      let attemptIdx = 0;

      try {
        const msgs = await AI.buildMessages(text, currentAttachments);
        let prevModel = null;
        const visited = new Set();
        while (chain.length) {
          const tryModel = chain.shift();
          if (!tryModel || visited.has(tryModel)) continue;
          visited.add(tryModel);
          // 已知该 UI 模型映射到的 upstream 仍在冷却 → 直接跳过，避免做无意义的尝试
          const myUp = AI.upstreamMap[provider.id + "::" + tryModel];
          if (myUp && (AI.cooldownLedger[myUp] || 0) > Date.now()) continue;
          attemptIdx++;
          if (attemptIdx > 1) {
            tipEl.textContent = `「${prevModel}」冷却中，正在切到「${tryModel}」重试…`;
            asstMsg.content = ""; // 抹掉上次失败时填的错误正文
            renderMessages();
          }
          try {
            await AI.chat({
              provider, model: tryModel, messages: msgs, signal: abortCtrl.signal,
              retry: {
                maxAttempts: 2,
                delayMs: 1200,
                onRetry: (n, total) => {
                  tipEl.textContent = `「${tryModel}」凭据冷却，重试 ${n}/${total - 1}…`;
                },
              },
              onDelta: (_d, full) => {
                asstMsg.content = full;
                const bubble = messagesEl.querySelector(".ai-msg:last-child .ai-bubble");
                if (bubble) bubble.innerHTML = renderAssistantContent(full);
                scrollToBottom();
              },
            });
            usedModel = tryModel;
            succeeded = true;
            break;
          } catch (err) {
            lastErr = err;
            prevModel = tryModel;
            if (err.name === "AbortError") break;
            const cool = AI.isCooldownError(err);
            const gw = AI.isGatewayError(err);
            if (!cool && !gw) break; // 既不是冷却也不是网关错误 → 真错，立刻报
            if (cool) {
              // UI 模型 + upstream 都登记到台账；下一轮 while 自动会跳过同一 upstream 的别名
              AI.recordCooldown(provider, tryModel, err);
            }
            // 网关错误（504/502 等）不写台账，因为它跟凭据无关；切下一个模型再试
          }
        }

        if (succeeded) {
          asstMsg.streaming = false;
          if (usedModel !== model) {
            asstMsg.routedFrom = model;
            asstMsg.routedTo = usedModel;
          }
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
        } else {
          throw lastErr || new Error("未知错误");
        }
      } catch (err) {
        asstMsg.streaming = false;
        if (err.name === "AbortError") asstMsg.content += "\n\n_[已取消]_";
        else { asstMsg.content = formatAIError(err); asstMsg.error = true; }
        AI.AIStore.saveMessages();
        renderMessages();
        tipEl.classList.add("err");
        tipEl.textContent = (err.message || "网络错误").replace(/\s+/g, " ").slice(0, 160);
        setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 6000);
      } finally {
        abortCtrl = null;
        stopBtn.hidden = true;
        sendBtn.hidden = false;
        panel.classList.remove("is-sending");
        // 一次 send 完成（成功 / 失败 / 取消都算），刷一下模型状态徽章 — chat()/generateImage() 内部已经记好台账了
        try { refreshModelStatus(); } catch (_) {}
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
        // 茶话会轮次分隔线（system + councilDivider）
        if (m.councilDivider) {
          const div = document.createElement("div");
          div.className = "ai-council-round-divider";
          div.innerHTML = `<span>${escapeHtml(m.content || "")}</span>`;
          // 用空 div 占位以保持 idx 与 messages 对齐（updateCouncilBubble 用 querySelectorAll(.ai-msg)[idx] 查不能错位）
          const wrap = document.createElement("div");
          wrap.className = "ai-msg ai-msg-divider";
          wrap.appendChild(div);
          messagesEl.appendChild(wrap);
          return;
        }
        // 茶话会进度卡（system + councilProgress）
        if (m.councilProgress) {
          const wrap = document.createElement("div");
          wrap.className = "ai-msg ai-msg-progress";
          wrap.innerHTML = renderCouncilProgress(m);
          messagesEl.appendChild(wrap);
          return;
        }
        const isCouncil = !!m.councilMember;
        const el = document.createElement("div");
        el.className = "ai-msg " + m.role + (isCouncil ? " is-council" : "");
        if (isCouncil) el.style.setProperty("--member-color", m.councilMember.color || "#ff6b8a");
        el.innerHTML = `
          <div class="ai-avatar">${m.role === "user" ? "我" : (isCouncil ? escapeHtml(m.councilMember.emoji || "🌸") : "🌸")}</div>
          <div class="ai-bubble"></div>
        `;
        const bubble = el.querySelector(".ai-bubble");
        if (m.role === "user") {
          bubble.innerHTML = renderUserContent(m);
        } else if (isCouncil) {
          bubble.innerHTML = renderCouncilBubble(m);
          if (m.content && !m.streaming) {
            const tts = document.createElement("button");
            tts.className = "tts-btn";
            tts.type = "button";
            tts.title = `朗读 ${m.councilMember.label || ""} 的这条回复`;
            tts.innerHTML = '<span class="ai-tool-ico">🔊</span><span class="ai-tool-txt">朗读</span>';
            tts.addEventListener("click", (e) => {
              e.stopPropagation();
              window.AITts.speak(m.content, tts);
            });
            bubble.appendChild(tts);
          }
        } else {
          bubble.innerHTML = renderAssistantContent(m.content, m);
          if (m.content && !m.streaming) {
            const tts = document.createElement("button");
            tts.className = "tts-btn";
            tts.type = "button";
            tts.title = "朗读 / 停止朗读这条回复";
            tts.innerHTML = '<span class="ai-tool-ico">🔊</span><span class="ai-tool-txt">朗读</span>';
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
        html += `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">` +
          m.attachments.map((a) => a.type === "image"
            ? `<figure class="ai-img-figure" style="margin:0">
                 <img class="ai-inline-img" src="${a.dataUrl}" alt="${escapeHtml(a.name||"")}" style="max-height:140px" />
                 <div class="ai-img-tools">
                   <button type="button" class="ai-img-btn" data-img-act="open" title="新窗口打开">↗</button>
                   <button type="button" class="ai-img-btn" data-img-act="download" title="下载">⬇</button>
                 </div>
               </figure>`
            : `<span class="ai-attach-item">📄${escapeHtml(a.name)}</span>`
          ).join("") + `</div>`;
      }
      return html;
    }

    /** 借鉴 ChatGpt-Image-Studio web/src/app/image/components/conversation-turns.tsx 的卡片设计：
     *  顶部一排胶囊（model/size/quality/张数/已用时间）；中间图片网格（1 列单图、2 列多图）；
     *  每张图下面一排圆形按钮（下载 / 复制提示词 / 重生）；
     *  loading 状态显示带 spinner 的占位框 + "已等待 XXs"；error 状态用玫瑰色块 + 重试按钮。 */
    function renderImageGenCard(msg) {
      const meta = msg.imageMeta || {};
      const results = msg.imageResults || [];
      const status = msg.imageGenStatus || {};
      const isRunning = !!msg.streaming;
      const successCount = results.filter((r) => r.status === "success").length;
      const errorCount = results.filter((r) => r.status === "error").length;
      const cancelledCount = results.filter((r) => r.status === "cancelled").length;
      const elapsed = status.elapsedSec || 0;

      // 胶囊行
      const pills = [];
      if (meta.model)   pills.push(`<span class="ai-img-pill">${escapeHtml(meta.model)}</span>`);
      if (meta.size)    pills.push(`<span class="ai-img-pill">${escapeHtml(meta.size.toUpperCase())}</span>`);
      if (meta.quality && meta.quality !== "auto") pills.push(`<span class="ai-img-pill">Quality ${escapeHtml(meta.quality)}</span>`);
      if (results.length > 1) pills.push(`<span class="ai-img-pill">${results.length} 张</span>`);
      if (isRunning) {
        pills.push(`<span class="ai-img-pill running">⏱ 已等待 ${elapsed}s</span>`);
      } else if (elapsed > 0) {
        pills.push(`<span class="ai-img-pill">耗时 ${elapsed}s</span>`);
      }
      if (errorCount && !isRunning) pills.push(`<span class="ai-img-pill err">${errorCount} 张失败</span>`);
      if (cancelledCount) pills.push(`<span class="ai-img-pill muted">${cancelledCount} 张取消</span>`);

      // 图片网格
      const gridCls = results.length === 1 ? "ai-img-grid one" : "ai-img-grid many";
      const cards = results.map((r, i) => {
        const safeIdx = String(i + 1).padStart(2, "0");
        const dlName = `sakura-image-${Date.now()}-${safeIdx}.png`;
        if (r.status === "success") {
          const u = r.dataUrl || r.url;
          // 改写提示词改为可折叠 details，默认收起，节省纵向空间
          const cap = r.revisedPrompt
            ? `<details class="ai-img-revised"><summary>模型理解的提示词</summary><div class="ai-img-revised-body">${escapeHtml(r.revisedPrompt)}</div></details>`
            : "";
          // 操作改为图标按钮 + 悬浮 tooltip，横向收紧
          return `<figure class="ai-img-card success">
              <img class="ai-img-thumb" src="${u}" alt="生图结果 #${i + 1}" title="点击查看大图" />
              ${cap}
              <div class="ai-img-actions">
                <a class="ai-img-act" href="${u}" download="${dlName}" title="下载到本地" aria-label="下载">⬇</a>
                <button type="button" class="ai-img-act" data-img-act="seed-prompt" title="把这条提示词复制回输入框" aria-label="复制提示词">✎</button>
                <button type="button" class="ai-img-act" data-img-act="retry-image" title="用同样的提示词再生成一次" aria-label="再生成">↻</button>
              </div>
            </figure>`;
        }
        if (r.status === "error") {
          return `<figure class="ai-img-card error">
              <div class="ai-img-err-text">${escapeHtml(r.error || "处理失败")}</div>
              <div class="ai-img-actions">
                <button type="button" class="ai-img-act" data-img-act="retry-image" title="重新发送同样的请求" aria-label="重新生成">↻ 重试</button>
              </div>
            </figure>`;
        }
        if (r.status === "cancelled") {
          return `<figure class="ai-img-card cancelled"><div class="ai-img-cancel-text">已取消</div></figure>`;
        }
        // partial：Responses 模式收到 partial_image 时的中间状态，或最终降级用 partial 兜底
        if (r.status === "partial") {
          const u = r.dataUrl || r.url;
          const cap = r.revisedPrompt
            ? `<details class="ai-img-revised"><summary>模型理解的提示词（草稿）</summary><div class="ai-img-revised-body">${escapeHtml(r.revisedPrompt)}</div></details>`
            : "";
          const label = r.degraded
            ? `<span class="ai-img-partial-tag" title="多次重试后仍未拿到 final，用最后一次 partial_image 兜底">⚠ 半成品兜底</span>`
            : `<span class="ai-img-partial-tag" title="还在生成，这是 partial_image 预览">⏳ 生成中…</span>`;
          return `<figure class="ai-img-card partial">
              <img class="ai-img-thumb" src="${u}" alt="生图中间预览 #${i + 1}" />
              ${label}
              ${cap}
              <div class="ai-img-actions">
                <a class="ai-img-act" href="${u}" download="${dlName}" title="保存这张半成品" aria-label="下载">⬇</a>
                <button type="button" class="ai-img-act" data-img-act="retry-image" title="用同样的提示词再生成一次" aria-label="再生成">↻</button>
              </div>
            </figure>`;
        }
        // loading 占位
        return `<figure class="ai-img-card loading">
            <div class="ai-img-spinner-wrap">
              <div class="ai-img-spinner" aria-hidden="true"></div>
              <p class="ai-img-spinner-title">正在生成图片…</p>
              <p class="ai-img-spinner-sub">已等待 ${elapsed}s · 图片处理通常需要十几秒到几分钟</p>
            </div>
          </figure>`;
      }).join("");

      // 顶部 prompt 摘要：跟下面每张图的错误信息可能完全一样，所以全失败时不重复显示同一句错误，
      // 只给一句简短状态，详细错误已经在每张图的卡片里。
      let summary = "";
      if (isRunning) {
        summary = `<div class="ai-img-summary running">🎨 正在生成 ${results.length} 张图片…</div>`;
      } else if (errorCount === results.length && results.length > 0) {
        summary = `<div class="ai-img-summary err">❌ 生成失败 · 详情见下方</div>`;
      } else if (errorCount > 0 && successCount > 0) {
        summary = `<div class="ai-img-summary partial">⚠️ ${successCount} 张成功 / ${errorCount} 张失败</div>`;
      } else if (successCount > 0) {
        summary = `<div class="ai-img-summary ok">✅ 生成完成 · ${successCount} 张</div>`;
      } else if (cancelledCount === results.length) {
        summary = `<div class="ai-img-summary muted">已取消</div>`;
      }

      return `<div class="ai-img-card-wrap">
        <div class="ai-img-pills">${pills.join("")}</div>
        ${summary}
        <div class="${gridCls}">${cards}</div>
      </div>`;
    }

    function renderAssistantContent(text, msg) {
      // 生图卡片优先：如果消息带 imageResults 字段（不论成功/失败/加载中），用结构化卡片渲染
      if (msg?.imageResults && msg.imageResults.length) {
        return renderImageGenCard(msg);
      }
      // 流式中且尚无任何文本内容时，在气泡里显示动画"思考中"指示器
      const thinking = !!msg?.streaming && !String(text || "").trim();
      let html = thinking
        ? `<div class="ai-thinking" aria-label="正在思考"><span></span><span></span><span></span></div>`
        : AI.renderMarkdown(text || "");
      // fallback 命中时在最前面挂一条提示
      if (msg?.routedTo && msg.routedFrom && msg.routedTo !== msg.routedFrom) {
        html = `<div class="ai-route-note">🔁 <code>${escapeHtml(msg.routedFrom)}</code> 当前不可用，已自动切到 <b>${escapeHtml(msg.routedTo)}</b> 完成回答</div>` + html;
      }
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
      // 错误消息：附加“立即重试 / 清除冷却台账”按钮
      if (msg?.error) {
        html += `<div class="ai-error-actions">
          <button type="button" class="btn-retry-ai" data-retry-send="1">🔁 立即重试</button>
          <button type="button" class="btn-clear-cooldown" data-clear-cooldown="1" title="清空本地记录的冷却中模型">🧹 清空冷却记录</button>
        </div>`;
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

    /** 从最后一条 user 消息重新发送：抹掉 user 之后的所有助手消息，
     *  把内容/附件回填到输入框，再走一次 send()。 */
    function retryFromLastError() {
      const ms = AI.AIStore.messages;
      let i = ms.length - 1;
      while (i >= 0 && ms[i].role !== "user") i--;
      if (i < 0) { toast?.("没有可重试的消息"); return; }
      const u = ms[i];
      ms.length = i; // 删除 user + 之后所有
      AI.AIStore.saveMessages();
      input.value = u.content || "";
      attachments = (u.attachments || []).map((a) => a.type === "image"
        ? { type: "image", name: a.name, dataUrl: a.dataUrl }
        : { type: "text", name: a.name, text: a.text || "" });
      renderAttachments();
      autoResize();
      renderMessages();
      send();
    }

    /** 把上游错误（含 429 限额 / 模型冷却 JSON / 5xx 网关 HTML）渲染成友好 Markdown。 */
    function formatAIError(err) {
      const msg = err.message || "网络错误";
      const upstream = err.upstream || tryParseEmbeddedJson(msg);
      const e = upstream?.error || upstream || {};
      const lower = (e.message || "").toLowerCase();
      const isCooldown = e.code === "model_cooldown" || /cool(ing)?[ _-]?down/.test(lower);
      const isLimit = err.status === 429 || e.type === "usage_limit_reached" || /usage[_ ]?limit|rate[_ ]?limit/.test(lower);
      const isGateway = AI.isGatewayError(err);

      // 估算剩余秒数（兼容 resets_in_seconds / reset_seconds / resets_at / reset_time）
      let secs = +e.resets_in_seconds || +e.reset_seconds || 0;
      if (!secs && e.resets_at) secs = Math.max(0, +e.resets_at - Math.floor(Date.now()/1000));
      if (!secs && typeof e.reset_time === "string") {
        const h = +(e.reset_time.match(/(\d+)\s*h/i)?.[1] || 0);
        const m = +(e.reset_time.match(/(\d+)\s*m(?!s)/i)?.[1] || 0);
        const s = +(e.reset_time.match(/(\d+)\s*s/i)?.[1] || 0);
        secs = h * 3600 + m * 60 + s;
      }
      const when = secs ? humanDur(secs) : "稍后";
      const resetAt = e.resets_at ? new Date(+e.resets_at * 1000).toLocaleString("zh-CN")
                     : (secs ? new Date(Date.now() + secs * 1000).toLocaleString("zh-CN") : "");

      const requested = AI.AIStore.data.currentModel || "(未知)";

      if (isCooldown) {
        const realModel = e.model ? `\`${e.model}\`` : "未知";
        const realProv = e.provider ? `\`${e.provider}\`` : "未知";
        const provider = AI.AIStore.currentProvider();
        const ledger = AI.cooldownLedger || {};
        const allTried = (provider?.models || []).filter((m) => ledger[provider.id + "::" + m]).map((m) => `\`${m}\``);
        const triedLine = allTried.length
          ? `- 本会话已尝试并标记冷却的模型：${allTried.join("、")}`
          : "";
        return [
          `**⚠️ 上游中转所有可用凭据都在冷却**`,
          ``,
          `- 你选择的模型：\`${requested}\``,
          `- 中转实际路由到：${realModel}（provider：${realProv}）`,
          `- 该后端的所有凭据正在冷却，约 **${when}** 后恢复${resetAt ? `（${resetAt}）` : ""}`,
          triedLine,
          ``,
          `客户端已经做了：① 同模型 1~2 次快速重试；② 沿下拉里的其它模型自动 fallback。下面这种情况都没成功，说明 CPAMC 这个号池整体确实在冷却。可以：`,
          `  1. 点 "立即重试" — 等几秒再试，刚释放的 Key 经常能命中；`,
          `  2. 在 "AI 设置" 加一个备用供应商，发不出去时一键切换；`,
          `  3. 联系 CPAMC 站长检查号池/限流配置；`,
          `  4. 等冷却结束自动恢复。`,
        ].filter(Boolean).join("\n");
      }
      if (isLimit) {
        const plan = e.plan_type ? `（${e.plan_type} 套餐）` : "";
        return [
          `**⚠️ 上游 AI 配额已用完${plan}**`,
          ``,
          `- 重置倒计时：约 **${when}**${resetAt ? `（${resetAt}）` : ""}`,
          `- 你可以：`,
          `  1. 等待自动恢复；`,
          `  2. 在 "AI 设置" 中切换到其它 **供应商 / 模型** 继续对话；`,
          `  3. 如果用的是图片生成模型，可以临时换一个不计入这个套餐的服务。`,
        ].join("\n");
      }
      if (isGateway) {
        const isTimeout = err.status === 504;
        const head = isTimeout
          ? `**⏱️ 上游网关超时（HTTP 504）**`
          : `**🚧 上游网关暂时不可达（HTTP ${err.status}）**`;
        return [
          head,
          ``,
          `- 你选择的模型：\`${requested}\``,
          `- 客户端已经做了：① 同模型 1~2 次重试；② 沿下拉里其它模型 fallback。还是失败说明中转/上游确实抽风。`,
          ``,
          isTimeout
            ? `**为什么常发生在画图请求**：图片生成动辄 30~60 秒，超过中转网关（Cloudflare/Nginx 默认 30~60s）的等待上限就会被强制 504 切断 —— 这跟模型有没有产出无关。`
            : `这通常是中转把流量打到的某台后端节点临时挂了或在重启。`,
          ``,
          `建议：`,
          `  1. 直接点 "🔁 立即重试"；`,
          `  2. 把提示词缩短一些（图片生成请求越短越不容易超时）；`,
          `  3. 在头部 🔍 主动找一个非画图、能正常出文字的模型；`,
          `  4. 在 "AI 设置" 中加一个直连图片生成 API 的供应商（避开中转）。`,
        ].join("\n");
      }
      return `**出错了：** ${msg}`;
    }
    function tryParseEmbeddedJson(text) {
      const i = String(text || "").indexOf("{");
      if (i < 0) return null;
      try { return JSON.parse(text.slice(i)); } catch (_) { return null; }
    }
    function humanDur(secs) {
      secs = Math.max(0, Math.floor(secs));
      if (secs < 60) return secs + " 秒";
      const m = Math.floor(secs / 60);
      if (m < 60) return m + " 分钟";
      const h = Math.floor(m / 60), rm = m % 60;
      if (h < 24) return rm ? `${h} 小时 ${rm} 分钟` : `${h} 小时`;
      const d = Math.floor(h / 24), rh = h % 24;
      return rh ? `${d} 天 ${rh} 小时` : `${d} 天`;
    }

    // 灯箱预览 / 图片悬浮按钮（下载、新窗口） / 错误气泡按钮
    messagesEl.addEventListener("click", (e) => {
      // 0a) 错误气泡：立即重试
      if (e.target.closest("[data-retry-send]")) {
        e.preventDefault();
        e.stopPropagation();
        retryFromLastError();
        return;
      }
      // 0b) 错误气泡：清空本地冷却台账
      if (e.target.closest("[data-clear-cooldown]")) {
        e.preventDefault();
        e.stopPropagation();
        const k = AI.cooldownLedger || {};
        for (const key of Object.keys(k)) delete k[key];
        toast?.("已清空本地冷却记录，下次发送将重新尝试所有模型");
        return;
      }
      // 1) 图片悬浮按钮：下载 / 新窗口 / 复制提示词回填 / 重新生成
      const btn = e.target.closest("[data-img-act]");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const act = btn.dataset.imgAct;
        // 找所属消息：根据 DOM 顺序定位 messages 索引
        const msgEl = btn.closest(".ai-msg");
        const idx = msgEl ? [...messagesEl.children].indexOf(msgEl) : -1;
        const msg = idx >= 0 ? AI.AIStore.messages[idx] : null;

        if (act === "seed-prompt") {
          // 把这条 assistant 消息对应的 user prompt 回填到输入框
          const promptText = msg?.imageMeta?.prompt
            || (idx > 0 ? AI.AIStore.messages[idx - 1]?.content : "")
            || "";
          input.value = promptText;
          autoResize();
          input.focus();
          toast?.("已复制提示词到输入框");
          return;
        }
        if (act === "retry-image") {
          // 直接重发：把对应 user 消息的 prompt 当作新一轮提交
          retryFromLastError();
          return;
        }
        // 新卡片：open 用 data-url；老结构：从 .ai-img-figure 的 img 取 src
        let imgSrc = btn.dataset.url;
        let imgAlt = "";
        if (!imgSrc) {
          const fig = btn.closest(".ai-img-figure, .ai-img-card");
          const img = fig?.querySelector("img");
          if (img) { imgSrc = img.src; imgAlt = img.alt; }
        }
        if (!imgSrc) return;
        if (act === "open") {
          window.open(imgSrc, "_blank", "noopener");
        } else if (act === "download") {
          downloadImage(imgSrc, imgAlt);
        }
        return;
      }
      // 1.5) 卡片图片本身 → 灯箱（点 .ai-img-thumb）
      const thumb = e.target.closest(".ai-img-thumb");
      if (thumb) {
        // 借用现有 .ai-inline-img 的灯箱逻辑：先把 src 转给灯箱代码处理
        // 简单做法：当成 ai-inline-img 同等对待，下面的灯箱逻辑会接住
      }
      // 2) 点击图片 → 灯箱（兼容老 .ai-inline-img 和新 .ai-img-thumb）
      const img = e.target.closest(".ai-inline-img, .ai-img-thumb");
      if (!img) return;
      // 老结构里 <a class="ai-media-link"> 包着 <img>，避免新标签页打断预览
      const wrap = e.target.closest(".ai-media-link");
      if (wrap) e.preventDefault();
      openLightbox(img.src, img.alt);
    });

    let _lbBox = null;
    function openLightbox(src, alt) {
      if (!_lbBox) {
        _lbBox = document.createElement("div");
        _lbBox.className = "ai-lightbox";
        _lbBox.innerHTML = `
          <div class="ai-lightbox-toolbar">
            <button class="ai-lb-btn" data-lb-act="open" type="button" title="新窗口打开">↗</button>
            <button class="ai-lb-btn" data-lb-act="download" type="button" title="下载">⬇</button>
            <button class="ai-lb-btn" data-lb-act="close" type="button" title="关闭 (Esc)">✕</button>
          </div>
          <img alt="">`;
        _lbBox.addEventListener("click", (e) => {
          const b = e.target.closest("[data-lb-act]");
          const img = _lbBox.querySelector("img");
          if (!b) {
            // 点击空白区域关闭，但点击图片本身不关闭
            if (e.target.tagName !== "IMG") _lbBox.hidden = true;
            return;
          }
          e.stopPropagation();
          if (b.dataset.lbAct === "close") _lbBox.hidden = true;
          else if (b.dataset.lbAct === "open") window.open(img.src, "_blank", "noopener");
          else if (b.dataset.lbAct === "download") downloadImage(img.src, img.alt);
        });
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && _lbBox && !_lbBox.hidden) _lbBox.hidden = true;
        });
        document.body.appendChild(_lbBox);
      }
      const img = _lbBox.querySelector("img");
      img.src = src;
      img.alt = alt || "";
      _lbBox.hidden = false;
    }

    /** 把任意图片（http(s) / data: / blob:）保存到本地。
     *  优先用 fetch + Blob，失败就退化到 <a download> + 新窗口提示。 */
    async function downloadImage(src, hint) {
      if (!src) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const baseName = (hint || "sakura-ai-image").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "image";
      // data: 直接转 Blob
      if (src.startsWith("data:")) {
        try {
          const m = /^data:([^;,]+)(?:;base64)?,/i.exec(src) || [];
          const mime = m[1] || "image/png";
          const ext = (mime.split("/")[1] || "png").split("+")[0];
          const blob = await (await fetch(src)).blob();
          triggerSave(blob, `${baseName}-${stamp}.${ext}`);
          return;
        } catch (_) { /* 失败则继续走通用路径 */ }
      }
      try {
        const res = await fetch(src, { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || guessExt(src)).split(";")[0] || "png";
        triggerSave(blob, `${baseName}-${stamp}.${ext}`);
        toast?.("已开始下载");
      } catch (_) {
        // CORS 失败：退化为新窗口（用户右键另存为）
        const a = document.createElement("a");
        a.href = src;
        a.target = "_blank";
        a.rel = "noopener";
        a.download = `${baseName}-${stamp}.${guessExt(src)}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast?.("当前图片不支持直接下载，已新窗口打开，请右键另存为");
      }
    }
    function guessExt(url) {
      const m = /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#]|$)/i.exec(url || "");
      return m ? m[1].toLowerCase() : "png";
    }
    function triggerSave(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }

    // 拖拽文件到输入框
    panel.addEventListener("dragover", (e) => { e.preventDefault(); });
    panel.addEventListener("drop", async (e) => {
      e.preventDefault();
      for (const f of e.dataTransfer.files) {
        try {
          const att = await AI.fileToAttachment(f);
          attachments.push(att);
          if (att?.type === "image" && att.dataUrl && window.Archive?.Gallery) {
            window.Archive.Gallery.add({
              source: "uploaded",
              dataUrl: att.dataUrl,
              name: att.name || "",
              mime: f.type || "image/png",
              bytes: f.size || 0,
            }).catch(() => {});
          }
        }
        catch (_) {}
      }
      renderAttachments();
    });

    return { open, close, refreshPersonaOptions, refreshModelOptions, refreshModelStatus, renderMessages };
  })();

  // ===================== 历史归档 UI（多会话 + 图库）=====================
  const UIArchive = (() => {
    const dlgSessions = $("#dialog-sessions");
    const dlgGallery  = $("#dialog-gallery");
    let _saveTimer = null;

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
    async function flushCurrentSession() {
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
        if (cur && (!cur.title || /^新会话/.test(cur.title))) {
          const auto = Sessions.autoTitle(AI.AIStore.messages);
          if (auto) metaPatch.title = auto;
        }
        await Sessions.save(id, AI.AIStore.messages, metaPatch);
      } catch (e) {
        // 静默：localStorage 仍然是兜底
        console.debug("[Archive] flush session:", e);
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

    // ---------- 会话弹窗 ----------
    function openSessions() {
      if (!dlgSessions) {
        console.warn("[UIArchive] #dialog-sessions 不存在 — 检查 index.html 是否包含会话弹窗元素");
        toast("会话弹窗模板缺失，请刷新页面或重新部署");
        return;
      }
      try {
        renderSessionsList();
        if (typeof dlgSessions.showModal === "function" && !dlgSessions.open) dlgSessions.showModal();
        else dlgSessions.setAttribute("open", "");
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
      // 新建：把当前消息保留为旧会话快照，开一个空会话
      await flushCurrentSession();
      const rec = await Sessions.create({ title: "新会话", messages: [] });
      Sessions.setCurrentId(rec.id);
      AI.AIStore.messages = [];
      AI.AIStore.saveMessages();
      UIAI.renderMessages();
      toast("已开启新会话");
      renderSessionsList($("#sessions-search").value || "");
    });
    dlgSessions?.addEventListener("click", async (e) => {
      const row = e.target.closest(".session-row");
      const btn = e.target.closest("[data-act]");
      if (!row || !btn) return;
      const id = row.dataset.id;
      const act = btn.dataset.act;
      if (act === "switch") {
        await flushCurrentSession();
        const rec = await Sessions.load(id);
        if (!rec) return;
        Sessions.setCurrentId(id);
        AI.AIStore.messages = Array.isArray(rec.messages) ? rec.messages : [];
        // 直接重写 localStorage，避免下一次 saveMessages 把旧的写回
        try { localStorage.setItem("sakura_nav_chat_v1", JSON.stringify(AI.AIStore.messages.slice(-200))); } catch (_) {}
        UIAI.renderMessages();
        dlgSessions.close();
        toast(`已切到「${rec.title || "会话"}」`);
      }
      if (act === "rename") {
        const cur = await Sessions.load(id);
        const name = prompt("会话标题：", cur?.title || "");
        if (name !== null) {
          await Sessions.rename(id, name);
          renderSessionsList($("#sessions-search").value || "");
        }
      }
      if (act === "remove") {
        const cur = await Sessions.load(id);
        if (!confirm(`删除会话「${cur?.title || "未命名"}」？此操作不可撤销。`)) return;
        await Sessions.remove(id);
        if (Sessions.currentId() === id) {
          Sessions.setCurrentId("");
          AI.AIStore.messages = [];
          try { localStorage.removeItem("sakura_nav_chat_v1"); } catch (_) {}
          UIAI.renderMessages();
        }
        renderSessionsList($("#sessions-search").value || "");
      }
      if (act === "pin") {
        await Sessions.togglePinned(id);
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
        refreshPresetSelect();
        renderGallery();
        renderSelThumbStrip();
        if (typeof dlgGallery.showModal === "function" && !dlgGallery.open) dlgGallery.showModal();
        else dlgGallery.setAttribute("open", "");
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
      dlgGallery.close();
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
      dlgGallery.close();
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

    return { openSessions, openGallery, flushCurrentSession };
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
    const sm = $("#ai-smart-mode"); if (sm) sm.checked = !!AI.AIStore.data.smartMode;
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
  $("#ai-smart-mode")?.addEventListener("change", (e) => {
    AI.AIStore.data.smartMode = e.target.checked;
    AI.AIStore.save();
    toast(e.target.checked
      ? "已开启智能模式：发送前会自动绕开冷却模型"
      : "已关闭智能模式");
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

  function populateProviderModelsDatalist(models) {
    const dl = $("#provider-models-dl");
    if (!dl) return;
    dl.innerHTML = (models || []).map((m) => `<option value="${escapeHtml(m)}"></option>`).join("");
  }

  function openProviderDialog(existing, preset) {
    const f = $("#form-provider");
    $("#provider-title").textContent = existing ? "🔌 编辑 AI 供应商" : "🔌 添加 AI 供应商";
    f.reset();
    const msg = $("#provider-fetch-msg");
    if (msg) { msg.textContent = ""; msg.classList.remove("err", "ok"); }
    if (existing) {
      f.name.value = existing.name;
      f.baseUrl.value = existing.baseUrl;
      f.apiKey.value = existing.apiKey || "";
      // 反代默认开启；只在 useProxy === false（用户显式禁用）时勾选"禁用本机反代"复选框
      if (f.disableProxy) f.disableProxy.checked = existing.useProxy === false;
      f.defaultModel.value = existing.defaultModel || "";
      populateProviderModelsDatalist(existing.models || []);
      f.dataset.fetchedModels = JSON.stringify(existing.models || []);
    } else if (preset) {
      f.name.value = preset.name;
      f.baseUrl.value = preset.baseUrl;
      f.defaultModel.value = preset.defaultModel;
      populateProviderModelsDatalist([]);
      f.dataset.fetchedModels = "[]";
    } else {
      populateProviderModelsDatalist([]);
      f.dataset.fetchedModels = "[]";
    }
    f.dataset.editId = existing ? existing.id : "";
    dlgProvider.showModal();
  }

  $("#provider-fetch-models")?.addEventListener("click", async () => {
    const f = $("#form-provider");
    const btn = $("#provider-fetch-models");
    const msg = $("#provider-fetch-msg");
    const baseUrl = (f.baseUrl.value || "").trim();
    const apiKey = (f.apiKey.value || "").trim();
    // disableProxy 勾选 → useProxy=false 强制直连；否则 undefined 走自动判定
    const disableProxy = !!(f.disableProxy && f.disableProxy.checked);
    const useProxy = disableProxy ? false : undefined;
    if (!baseUrl) {
      if (msg) { msg.textContent = "请先填写 Base URL"; msg.classList.add("err"); }
      return;
    }
    if (msg) { msg.textContent = "正在拉取模型列表…"; msg.classList.remove("err", "ok"); }
    btn.disabled = true;
    try {
      const models = await AI.fetchModels({ baseUrl, apiKey, useProxy });
      populateProviderModelsDatalist(models);
      f.dataset.fetchedModels = JSON.stringify(models);
      if (!f.defaultModel.value && models[0]) f.defaultModel.value = models[0];
      if (msg) { msg.textContent = `已加载 ${models.length} 个模型，点击输入框可下拉选择`; msg.classList.remove("err"); msg.classList.add("ok"); }
    } catch (e) {
      if (msg) { msg.textContent = "拉取失败：" + String(e.message || e).slice(0, 200); msg.classList.add("err"); }
    } finally {
      btn.disabled = false;
    }
  });

  $("#form-provider").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    delete data.disableProxy; // 这是 UI 字段，不直接落库
    // 反代决策：勾上"禁用本机反代"= useProxy=false；不勾就把字段干掉走自动判定（buildFetchTarget 会按 proxyAvailable 决定）
    if (f.disableProxy && f.disableProxy.checked) {
      data.useProxy = false;
    } else {
      delete data.useProxy;
    }
    let fetched = [];
    try { fetched = JSON.parse(f.dataset.fetchedModels || "[]"); } catch (_) {}
    const editId = f.dataset.editId;
    if (editId) {
      const p = AI.AIStore.data.providers.find((x) => x.id === editId);
      if (p) {
        const oldDefault = p.defaultModel;
        Object.assign(p, data);
        // Object.assign 不删字段：useProxy 不在 data 里时也要把旧的 false 清掉，让自动判定接管
        if (!("useProxy" in data)) delete p.useProxy;
        if (fetched.length) p.models = fetched;
        // 如果改的是当前正在用的供应商，且默认模型变了，把对话页正在用的当前模型也跟过去；
        // 否则用户在设置里改完默认模型后，对话页头部仍显示旧模型，迷惑性极强。
        if (p.id === AI.AIStore.data.currentProviderId
            && p.defaultModel
            && p.defaultModel !== oldDefault) {
          AI.AIStore.data.currentModel = p.defaultModel;
        }
        // 进一步兜底：当前模型不在新模型列表里就强制切到默认模型（或第一个）
        const models = p.models || [];
        if (p.id === AI.AIStore.data.currentProviderId
            && AI.AIStore.data.currentModel
            && models.length
            && !models.includes(AI.AIStore.data.currentModel)) {
          AI.AIStore.data.currentModel = p.defaultModel || models[0];
        }
      }
    } else {
      const newP = Object.assign({ id: AI.uid(), models: fetched }, data);
      AI.AIStore.data.providers.push(newP);
      if (!AI.AIStore.data.currentProviderId) {
        AI.AIStore.data.currentProviderId = newP.id;
        AI.AIStore.data.currentModel = newP.defaultModel || (newP.models || [])[0] || "";
      }
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
    $("#persona-title").textContent = existing ? "🎭 编辑角色" : "🎭 添加角色";
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

  // ===================== ✅ 提醒事项 UI (Mac Reminders 风格 v1.20.0) =====================
  const UITodo = (() => {
    const dlg = $("#dialog-todo");
    const dlgEditList = $("#dialog-rem-list");
    const smartGrid = $("#rem-smart-grid");
    const listNav = $("#rem-list-nav");
    const itemsEl = $("#rem-items");
    const emptyEl = $("#rem-empty");
    const mainEmoji = dlg.querySelector(".rem-main-emoji");
    const mainName = dlg.querySelector(".rem-main-name");
    const editListBtn = $("#rem-edit-list");
    const addInput = $("#rem-add-input");
    const searchInput = $("#rem-search");
    const badgeEl = $("#todo-badge");
    const detailDlg = $("#dialog-rem-detail");
    const detailBody = $("#rem-detail-body");

    const LIST_COLORS = ["#ff6b8a", "#ff9f0a", "#ffd60a", "#30d158", "#0a84ff", "#7c83fa", "#bf5af2", "#8e8e93"];
    let editingListId = null; // 当前编辑列表的 id（null = 新建）
    let openDetailId = null;

    function open() {
      if (!window.Todo) return;
      if (!Todo.__loaded) { Todo.load(); Todo.__loaded = true; }
      render();
      if (!dlg.open && typeof dlg.showModal === "function") dlg.showModal();
      setTimeout(() => addInput?.focus(), 80);
    }

    function syncBadge() {
      if (!window.Todo || !badgeEl) return;
      const n = Todo.counts()["smart-today"] || 0;
      if (n > 0) { badgeEl.hidden = false; badgeEl.textContent = n > 99 ? "99+" : String(n); }
      else { badgeEl.hidden = true; }
    }

    function activeList() {
      const id = Todo.data.activeListId;
      if (id?.startsWith("smart-")) return Todo.SMART[id.slice(6)];
      if (id?.startsWith("tag:")) {
        const t = id.slice(4);
        return { name: "#" + t.replace(/^#/, ""), emoji: "🏷", color: "#7c83fa" };
      }
      return Todo.data.lists.find((l) => l.id === id) || Todo.SMART.today;
    }

    function render() {
      renderSidebar();
      renderMain();
      syncBadge();
    }

    function renderSidebar() {
      const cs = Todo.counts();
      const aid = Todo.data.activeListId;
      smartGrid.innerHTML = Object.entries(Todo.SMART).map(([key, s]) => {
        const id = `smart-${key}`;
        const active = aid === id;
        return `<button type="button" class="rem-smart-tile ${active ? "is-active" : ""}" data-list-id="${id}" style="--tile-color:${s.color}">
          <span class="rem-smart-icon">${s.emoji}</span>
          <span class="rem-smart-count">${cs[id] || 0}</span>
          <span class="rem-smart-name">${escapeHtml(s.name)}</span>
        </button>`;
      }).join("");

      listNav.innerHTML = Todo.data.lists.map((l) => {
        const active = aid === l.id;
        const n = cs[l.id] || 0;
        const prog = Todo.listProgress(l.id);
        // 进度环：14×14 SVG，描边 2px，stroke-dasharray 控制完成弧
        const C = 2 * Math.PI * 5; // 半径 5
        const dash = `${(prog.pct * C).toFixed(1)} ${C}`;
        const ring = prog.total > 0 ? `<svg class="rem-list-ring" width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="2"></circle>
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-dasharray="${dash}" transform="rotate(-90 7 7)"></circle>
        </svg>` : "";
        return `<li>
          <button type="button" class="rem-list-row ${active ? "is-active" : ""}" data-list-id="${l.id}" style="--row-color:${l.color}" title="${prog.total > 0 ? `已完成 ${prog.done}/${prog.total}（${Math.round(prog.pct * 100)}%）` : "暂无内容"}">
            <span class="rem-list-dot"></span>
            <span class="rem-list-emoji">${escapeHtml(l.emoji || "🗒")}</span>
            <span class="rem-list-name">${escapeHtml(l.name)}</span>
            ${ring}
            ${n > 0 ? `<span class="rem-list-count">${n}</span>` : ""}
          </button>
        </li>`;
      }).join("");

      // 标签区
      const tagSec = $("#rem-tag-section");
      const tagNav = $("#rem-tag-nav");
      const tags = Todo.tagCounts();
      if (tags.length) {
        tagSec.hidden = false;
        tagNav.innerHTML = tags.map(([t, n]) => {
          const tagId = "tag:" + t;
          const active = aid === tagId;
          return `<li>
            <button type="button" class="rem-tag-row ${active ? "is-active" : ""}" data-list-id="${escapeAttr(tagId)}">
              <span class="rem-tag-hash">#</span>
              <span class="rem-tag-name">${escapeHtml(t.replace(/^#/, ""))}</span>
              <span class="rem-list-count">${n}</span>
            </button>
          </li>`;
        }).join("");
      } else {
        tagSec.hidden = true;
        tagNav.innerHTML = "";
      }
    }

    function renderMain() {
      const a = activeList();
      mainEmoji.textContent = a.emoji || "🗒";
      mainEmoji.style.color = a.color || "";
      mainName.textContent = a.name;
      // 智能列表 / 标签视图不显示编辑列表按钮；添加输入框对"已完成"也禁用
      const aid = String(Todo.data.activeListId);
      const isSmart = aid.startsWith("smart-");
      const isTag = aid.startsWith("tag:");
      editListBtn.hidden = isSmart || isTag;
      addInput.disabled = (aid === "smart-completed");
      addInput.placeholder = addInput.disabled
        ? "已完成列表不能直接添加"
        : (isTag ? `添加到 ${activeList().name}（带 ${aid.slice(4)} 标签）...` : "添加提醒事项...");

      const items = Todo.activeItems();
      emptyEl.hidden = items.length > 0;
      itemsEl.innerHTML = items.map((it) => renderItem(it)).join("");
    }

    function renderItem(it) {
      const overdue = !it.done && it.dueDate && it.dueDate < Todo.todayStr();
      const due = it.dueDate ? formatDue(it) : "";
      const subs = Todo.childrenOf(it.id);
      const subHtml = subs.length ? `<ul class="rem-sub">${subs.map((s) =>
        `<li class="rem-sub-item ${s.done ? "is-done" : ""}" data-id="${s.id}">
          <button type="button" class="rem-radio" data-act="toggle" data-priority="${s.priority || 0}"></button>
          <span class="rem-sub-text">${escapeHtml(s.text)}</span>
          <button type="button" class="rem-x" data-act="del">×</button>
        </li>`
      ).join("")}</ul>` : "";
      const tags = it.tags?.length ? `<span class="rem-tags">${it.tags.map((t) => `<span class="rem-tag">${escapeHtml(t)}</span>`).join("")}</span>` : "";
      const list = Todo.data.lists.find((l) => l.id === it.listId);
      const isSmart = String(Todo.data.activeListId).startsWith("smart-");
      const listLabel = isSmart && list ? `<span class="rem-from-list" style="color:${list.color}">${escapeHtml(list.emoji || "🗒")} ${escapeHtml(list.name)}</span>` : "";
      return `<div class="rem-item ${it.done ? "is-done" : ""} ${it.flagged ? "is-flagged" : ""} ${overdue ? "is-overdue" : ""}" data-id="${it.id}">
        <button type="button" class="rem-radio" data-act="toggle" data-priority="${it.priority || 0}" title="点击完成"></button>
        <div class="rem-item-main">
          <div class="rem-item-row1">
            <span class="rem-item-text" data-act="edit" contenteditable="false" spellcheck="false">${escapeHtml(it.text)}</span>
            ${it.flagged ? '<span class="rem-flag" title="已标记">🚩</span>' : ""}
            ${listLabel}
          </div>
          ${it.notes ? `<div class="rem-item-notes">${escapeHtml(it.notes)}</div>` : ""}
          <div class="rem-item-meta">
            ${due ? `<span class="rem-due ${overdue ? "is-overdue" : ""}">📅 ${due}</span>` : ""}
            ${it.url ? `<a class="rem-url" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">🔗 链接</a>` : ""}
            ${it.syncToCal ? `<span class="rem-cal-tag" title="已同步到日历">📅 同步</span>` : ""}
            ${tags}
          </div>
          ${subHtml}
        </div>
        <button type="button" class="rem-info" data-act="detail" title="详情">ⓘ</button>
      </div>`;
    }

    function formatDue(it) {
      const d = it.dueDate;
      if (!d) return "";
      const today = Todo.todayStr();
      let label = d;
      if (d === today) label = "今天";
      else {
        const dd = new Date(d + "T00:00:00");
        const todayDate = new Date(today + "T00:00:00");
        const diff = Math.round((dd - todayDate) / 86400000);
        if (diff === 1) label = "明天";
        else if (diff === -1) label = "昨天";
        else if (diff > 1 && diff <= 6) label = `${diff} 天后`;
        else if (diff < -1 && diff >= -6) label = `${-diff} 天前`;
      }
      return it.dueTime ? `${label} ${it.dueTime}` : label;
    }

    function openDetail(id) {
      const it = Todo.data.items.find((x) => x.id === id);
      if (!it) return;
      openDetailId = id;
      detailBody.innerHTML = `
        <section class="rem-d-card">
          <label class="rem-d-field">
            <span>标题</span>
            <input type="text" id="rem-d-text" value="${escapeAttr(it.text)}" maxlength="200" placeholder="提醒标题..." />
          </label>
          <label class="rem-d-field">
            <span>备注</span>
            <textarea id="rem-d-notes" rows="3" placeholder="备注 / 位置 / 想法...">${escapeHtml(it.notes || "")}</textarea>
          </label>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">⏰ 时间</h4>
          <div class="rem-d-row">
            <label class="rem-d-field">
              <span>截止日期</span>
              <input type="date" id="rem-d-date" value="${escapeAttr(it.dueDate || "")}" />
            </label>
            <label class="rem-d-field">
              <span>具体时间</span>
              <input type="time" id="rem-d-time" value="${escapeAttr(it.dueTime || "")}" />
            </label>
          </div>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">⚡ 优先级</h4>
          <div class="rem-d-priority">
            ${[0, 1, 2, 3].map((p) => `<button type="button" class="rem-p p-${p} ${p === (it.priority || 0) ? "is-on" : ""}" data-p="${p}">${["无", "低", "中", "高"][p]}</button>`).join("")}
          </div>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">🚩 标记 · 📅 同步</h4>
          <div class="rem-d-toggles">
            <label class="rem-d-toggle">
              <input type="checkbox" id="rem-d-flag" ${it.flagged ? "checked" : ""} />
              <span>🚩 标记为重要</span>
            </label>
            <label class="rem-d-toggle">
              <input type="checkbox" id="rem-d-sync" ${it.syncToCal ? "checked" : ""} />
              <span>📅 同步到日历</span>
            </label>
          </div>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">🔗 链接与标签</h4>
          <label class="rem-d-field">
            <span>URL</span>
            <input type="url" id="rem-d-url" value="${escapeAttr(it.url || "")}" placeholder="https://..." />
          </label>
          <label class="rem-d-field">
            <span>标签（空格分隔）</span>
            <input type="text" id="rem-d-tags" value="${escapeAttr((it.tags || []).join(" "))}" placeholder="#购物 #紧急" />
          </label>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">📂 所属列表</h4>
          <label class="rem-d-field">
            <select id="rem-d-listid">
              ${Todo.data.lists.map((l) => `<option value="${l.id}" ${l.id === it.listId ? "selected" : ""}>${escapeHtml(l.emoji || "🗒")}  ${escapeHtml(l.name)}</option>`).join("")}
            </select>
          </label>
        </section>
      `;
      // priority button click（事件委托）
      detailBody.querySelectorAll(".rem-p").forEach((b) => b.addEventListener("click", () => {
        const p = +b.dataset.p;
        detailBody.querySelectorAll(".rem-p").forEach((x) => x.classList.toggle("is-on", +x.dataset.p === p));
        Todo.update(openDetailId, { priority: p });
        renderMain();
        renderSidebar();
      }));
      if (typeof detailDlg.showModal === "function" && !detailDlg.open) detailDlg.showModal();
    }
    // detailBody 上的 change/input：一次性绑定（事件委托），openDetailId 守门
    detailBody.addEventListener("change", () => { if (openDetailId) saveDetailFromDOM(); });
    detailBody.addEventListener("input", () => { if (openDetailId) saveDetailFromDOM(); });

    function closeDetail() {
      if (detailDlg.open) detailDlg.close();
      openDetailId = null;
    }
    // 关闭时清理状态
    detailDlg.addEventListener("close", () => { openDetailId = null; });

    function saveDetailFromDOM() {
      if (!openDetailId) return;
      const patch = {
        text: $("#rem-d-text")?.value.trim() || "新提醒",
        notes: $("#rem-d-notes")?.value || "",
        dueDate: $("#rem-d-date")?.value || "",
        dueTime: $("#rem-d-time")?.value || "",
        flagged: $("#rem-d-flag")?.checked || false,
        syncToCal: $("#rem-d-sync")?.checked || false,
        url: $("#rem-d-url")?.value.trim() || "",
        listId: $("#rem-d-listid")?.value || undefined,
        tags: ($("#rem-d-tags")?.value || "").split(/\s+/).map((t) => t.trim()).filter(Boolean),
      };
      Todo.update(openDetailId, patch);
      // text + due 等会影响列表渲染，render 一下；但不要 re-render detail body（会重置光标）
      renderMain();
      renderSidebar();
    }

    function escapeAttr(s) { return String(s || "").replace(/"/g, "&quot;").replace(/&/g, "&amp;"); }

    // -------- 列表编辑弹窗 --------
    function openListEditor(listId) {
      editingListId = listId || null;
      const form = $("#form-rem-list");
      const target = listId ? Todo.data.lists.find((l) => l.id === listId) : null;
      $("#rem-list-edit-title").innerHTML = listId ? "✎ 编辑列表" : "🗒 新建列表";
      form.name.value = target?.name || "";
      form.emoji.value = target?.emoji || "🗒";
      form.color.value = target?.color || LIST_COLORS[0];
      $("#rem-list-delete").hidden = !listId;
      // 颜色 swatch
      const colorBox = $("#rem-list-colors");
      colorBox.innerHTML = LIST_COLORS.map((c) =>
        `<button type="button" class="rem-color-swatch ${c === form.color.value ? "is-on" : ""}" data-c="${c}" style="background:${c}"></button>`
      ).join("");
      colorBox.querySelectorAll(".rem-color-swatch").forEach((b) => b.addEventListener("click", () => {
        form.color.value = b.dataset.c;
        colorBox.querySelectorAll(".rem-color-swatch").forEach((x) => x.classList.toggle("is-on", x.dataset.c === b.dataset.c));
      }));
      if (typeof dlgEditList.showModal === "function" && !dlgEditList.open) dlgEditList.showModal();
    }

    $("#form-rem-list").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const name = form.name.value.trim();
      const emoji = form.emoji.value.trim() || "🗒";
      const color = form.color.value || LIST_COLORS[0];
      if (!name) { toast("请填列表名"); return; }
      if (editingListId) {
        Todo.updateList(editingListId, { name, emoji, color });
      } else {
        const l = Todo.addList({ name, emoji, color });
        Todo.setActiveList(l.id);
      }
      dlgEditList.close();
      render();
    });

    $("#rem-list-delete").addEventListener("click", () => {
      if (!editingListId) return;
      const l = Todo.data.lists.find((x) => x.id === editingListId);
      const n = Todo.data.items.filter((x) => x.listId === editingListId).length;
      const msg = n > 0 ? `删除「${l?.name}」会同时删除其中 ${n} 项提醒，确定？` : `删除列表「${l?.name}」？`;
      if (!confirm(msg)) return;
      Todo.removeList(editingListId);
      dlgEditList.close();
      render();
    });

    // -------- 事件绑定 --------
    $("#btn-todo").addEventListener("click", open);

    // 侧边栏点击：切列表
    dlg.addEventListener("click", (e) => {
      const tile = e.target.closest("[data-list-id]");
      if (tile) {
        Todo.setActiveList(tile.dataset.listId);
        Todo.data.activeFilter = ""; // 切列表时清搜索
        searchInput.value = "";
        closeDetail();
        render();
      }
    });

    // 新建列表
    $("#rem-add-list").addEventListener("click", () => openListEditor(null));

    // 📋 从模板创建列表
    const dlgTpl = $("#dialog-rem-tpl");
    $("#rem-tpl").addEventListener("click", () => {
      const grid = $("#rem-tpl-grid");
      grid.innerHTML = Todo.TEMPLATES.map((t) => `
        <button type="button" class="rem-tpl-card" data-tpl="${escapeAttr(t.id)}" style="--tpl-color:${t.color}">
          <span class="rem-tpl-emoji">${escapeHtml(t.emoji)}</span>
          <span class="rem-tpl-name">${escapeHtml(t.name)}</span>
          <span class="rem-tpl-cnt">${t.items.length} 条预设</span>
        </button>
      `).join("");
      grid.querySelectorAll(".rem-tpl-card").forEach((b) => b.addEventListener("click", () => {
        const list = Todo.createFromTemplate(b.dataset.tpl);
        dlgTpl.close();
        render();
        if (list) toast(`已从模板创建「${list.name}」`);
      }));
      if (typeof dlgTpl.showModal === "function" && !dlgTpl.open) dlgTpl.showModal();
    });

    // ✨ AI 一句话生成列表
    const dlgAiGen = $("#dialog-rem-ai");
    const aiPrompt = $("#rem-ai-prompt");
    const aiStatus = $("#rem-ai-status");
    $("#rem-ai-gen").addEventListener("click", () => {
      if (!window.AI || !AI.AIStore?.currentProvider?.()) {
        toast("请先到 AI 设置里配好供应商再用 ✨ AI 生成");
        return;
      }
      aiPrompt.value = "";
      aiStatus.hidden = true;
      if (typeof dlgAiGen.showModal === "function" && !dlgAiGen.open) dlgAiGen.showModal();
      setTimeout(() => aiPrompt.focus(), 50);
    });
    // 示例 chip 点击填入 prompt
    dlgAiGen.addEventListener("click", (e) => {
      const chip = e.target.closest(".rem-ai-chip");
      if (chip) aiPrompt.value = chip.dataset.prompt;
    });
    $("#form-rem-ai").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = aiPrompt.value.trim();
      if (!text) { toast("先描述一下要做什么"); return; }
      const provider = AI.AIStore.currentProvider();
      const model = AI.AIStore.data.currentModel || provider.defaultModel;
      if (!model) { toast("当前供应商没有选模型"); return; }
      const goBtn = $("#rem-ai-go");
      goBtn.disabled = true;
      aiStatus.hidden = false;
      aiStatus.textContent = "AI 思考中…";

      const sys = `你是任务规划助手。根据用户描述输出一个 JSON 对象，结构严格如下：
{
  "name": "列表名（5-10 字）",
  "emoji": "1 个 emoji 表示主题",
  "color": "颜色十六进制，从 [#ff6b8a, #ff9f0a, #ffd60a, #30d158, #0a84ff, #7c83fa, #bf5af2] 选一个",
  "items": [{"text": "条目内容（10-30 字）", "priority": 0|1|2|3}]
}
priority: 0=无 1=低 2=中 3=高。items 6-12 条。只输出 JSON 对象本身，不要 markdown 围栏，不要前后任何说明文字。`;

      try {
        let full = "";
        await AI.chat({
          provider, model,
          messages: [
            { role: "system", content: sys },
            { role: "user",   content: text },
          ],
          retry: { maxAttempts: 2, delayMs: 1200 },
          onDelta: (_d, f) => { full = f; aiStatus.textContent = "AI 生成中… " + Math.min(full.length, 800) + " 字"; },
        });
        // 容错：抠出 { ... } 部分
        const m = full.match(/\{[\s\S]*\}/);
        if (!m) throw new Error("AI 返回不是 JSON 格式");
        const parsed = JSON.parse(m[0]);
        if (!parsed.name || !Array.isArray(parsed.items)) throw new Error("解析 JSON 失败");
        const list = Todo.addList({
          name: parsed.name,
          emoji: parsed.emoji || "✨",
          color: parsed.color || "#7c83fa",
        });
        Todo.addManyItems(list.id, parsed.items);
        Todo.setActiveList(list.id);
        dlgAiGen.close();
        render();
        toast(`✨ AI 已生成「${list.name}」· ${parsed.items.length} 条`);
      } catch (err) {
        aiStatus.textContent = "❌ " + (err.message || "生成失败");
      } finally {
        goBtn.disabled = false;
      }
    });
    // 编辑当前列表
    editListBtn.addEventListener("click", () => {
      if (!String(Todo.data.activeListId).startsWith("smart-")) openListEditor(Todo.data.activeListId);
    });

    // 搜索
    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        Todo.data.activeFilter = searchInput.value;
        renderMain();
      }, 120);
    });

    // 新建提醒：Enter 提交
    addInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const text = addInput.value.trim();
      if (!text) return;
      const aid = Todo.data.activeListId;
      let initial = {};
      if (aid === "smart-today") initial.dueDate = Todo.todayStr();
      else if (aid === "smart-flagged") initial.flagged = true;
      else if (aid && !aid.startsWith("smart-")) initial.listId = aid;
      Todo.addItem(Object.assign({ text }, initial));
      // smart-flagged 添加的提醒会带 flagged，但不在 today 列表里出现
      addInput.value = "";
      render();
    });

    // 项目区：勾选 / 详情 / 编辑文本
    itemsEl.addEventListener("click", (e) => {
      const root = e.target.closest(".rem-item, .rem-sub-item");
      if (!root) return;
      const id = root.dataset.id;
      const act = e.target.dataset.act || e.target.closest("[data-act]")?.dataset.act;
      if (act === "toggle") {
        Todo.toggleDone(id);
        render();
        if (openDetailId === id) {
          // detail 中的可见状态也要同步
        }
      } else if (act === "del") {
        Todo.remove(id);
        if (openDetailId === id) closeDetail();
        render();
      } else if (act === "detail") {
        if (openDetailId === id) closeDetail();
        else openDetail(id);
      } else if (act === "edit") {
        const span = e.target.closest(".rem-item-text");
        if (!span) return;
        span.contentEditable = "true";
        span.focus();
        document.getSelection()?.selectAllChildren(span);
        span.addEventListener("blur", () => {
          span.contentEditable = "false";
          Todo.update(id, { text: span.textContent.trim() || "新提醒" });
          render();
        }, { once: true });
        span.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); span.blur(); }
          if (ev.key === "Escape") { ev.preventDefault(); span.textContent = Todo.data.items.find((x) => x.id === id)?.text || ""; span.blur(); }
        });
      }
    });

    // 详情：删除按钮（在 dialog footer 里）
    $("#rem-d-del").addEventListener("click", () => {
      if (!openDetailId) return;
      if (!confirm("删除这条提醒？")) return;
      Todo.remove(openDetailId);
      closeDetail();
      render();
    });

    // 清除已完成
    $("#rem-clear-done").addEventListener("click", () => {
      const doneIds = Todo.data.items.filter((x) => x.done).map((x) => x.id);
      if (!doneIds.length) { toast("没有已完成的提醒"); return; }
      if (!confirm(`清除 ${doneIds.length} 条已完成的提醒？`)) return;
      doneIds.forEach((id) => Todo.remove(id));
      render();
    });

    // 启动时刷新 badge（即使 dialog 没打开）
    if (window.Todo) { Todo.load(); Todo.__loaded = true; syncBadge(); }

    return { open, syncBadge, render };
  })();

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
      // 异步预拉当前年和前后年的节假日（本年硬编码兜底）
      if (window.CalFestivals?.ensureYear) {
        CalFestivals.ensureYear(y);
        CalFestivals.ensureYear(y + 1);
      }
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

        // 节日：取优先级最高的一个显示在 cell 里；存在法定节假日时给整 cell 加 has-holiday 类
        const festivals = window.CalFestivals ? CalFestivals.getFestivalsForDate(c.date) : [];
        const topFest = festivals[0];
        if (topFest && topFest.kind === "cn-holiday") cls.push("has-holiday");
        const festBadge = topFest
          ? `<span class="cal-cell-fest kind-${topFest.kind}" title="${escapeHtml(festivals.map((f) => f.emoji + " " + f.name).join(" · "))}">${topFest.emoji} ${escapeHtml(topFest.name.replace(" · 放假", ""))}</span>`
          : "";

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
          ${festBadge}
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

      // 当天节日横条（在任务列表上方）
      let festBanner = "";
      const fests = window.CalFestivals ? CalFestivals.getFestivalsForDate(d) : [];
      if (fests.length) {
        festBanner = `<div class="cal-day-fests">` + fests.map((f) =>
          `<span class="cal-day-fest kind-${f.kind}" title="${escapeHtml(f.name)}">${f.emoji} ${escapeHtml(f.name)}</span>`
        ).join("") + `</div>`;
      }

      dayList.innerHTML = festBanner + items.map((it) => renderDayItem(it.task, it.ts)).join("");
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

    // 节假日 API 拉到了 → 自动重渲染月视图，让新数据立刻生效
    window.addEventListener("cal-holidays-updated", () => {
      if (!panel.hidden && monthView && !monthView.hidden) renderMonth();
    });

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

    function setV(id, v) { const el = $(id); if (el) el.value = v ?? ""; }
    function setC(id, v) { const el = $(id); if (el) el.checked = !!v; }
    function getV(id) { const el = $(id); return el ? el.value : ""; }
    function getC(id) { const el = $(id); return el ? !!el.checked : false; }

    function fillForm() {
      setV("#sync-backend", Sync.data.backend);
      setV("#sync-webdav-url", Sync.data.webdav.url);
      setV("#sync-webdav-user", Sync.data.webdav.user);
      setV("#sync-webdav-pass", Sync.data.webdav.pass);
      setV("#sync-webdav-path", Sync.data.webdav.path);
      setV("#sync-gist-token", Sync.data.gist.token);
      setV("#sync-gist-id", Sync.data.gist.gistId);
      setV("#sync-gist-file", Sync.data.gist.fileName || "sakura-nav.json");
      setC("#set-sync-auto", Sync.data.auto);
      setC("#set-sync-include-keys", Sync.data.includeAiKeys);
      setC("#set-sync-include-auth", Sync.data.includeAuthCred);
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
      const b = getV("#sync-backend");
      const w = $("#sync-webdav-conf");
      const g = $("#sync-gist-conf");
      if (w) w.hidden = b !== "webdav";
      if (g) g.hidden = b !== "gist";
    }
    function readFormWebdav() {
      Sync.data.backend = getV("#sync-backend");
      Sync.data.webdav.url = getV("#sync-webdav-url").trim();
      Sync.data.webdav.user = getV("#sync-webdav-user").trim();
      Sync.data.webdav.pass = getV("#sync-webdav-pass");
      Sync.data.webdav.path = getV("#sync-webdav-path").trim() || "sakura-nav.json";
      Sync.save();
    }
    function readFormGist() {
      Sync.data.backend = getV("#sync-backend");
      Sync.data.gist.token = getV("#sync-gist-token").trim();
      Sync.data.gist.gistId = getV("#sync-gist-id").trim();
      Sync.data.gist.fileName = getV("#sync-gist-file").trim() || "sakura-nav.json";
      Sync.save();
    }
    function readFormOptions() {
      Sync.data.auto = getC("#set-sync-auto");
      Sync.data.includeAiKeys = getC("#set-sync-include-keys");
      Sync.data.includeAuthCred = getC("#set-sync-include-auth");
      Sync.save();
    }

    function init() {
      if (inited) return;
      inited = true;
      fillForm();
      $("#sync-backend")?.addEventListener("change", toggleBackend);

      $("#form-sync-webdav")?.addEventListener("submit", (e) => {
        e.preventDefault();
        readFormWebdav();
        setStatus("已保存 WebDAV 配置", "success");
        toggleBackend();
      });
      $("#form-sync-gist")?.addEventListener("submit", (e) => {
        e.preventDefault();
        readFormGist();
        setStatus("已保存 Gist 配置", "success");
        toggleBackend();
      });
      $("#form-sync-options")?.addEventListener("submit", (e) => {
        e.preventDefault();
        readFormOptions();
        setStatus("已保存备份选项", "success");
      });

      $("#form-sync-push")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        // 推送前确保配置已写入（按当前选择的后端）
        if (getV("#sync-backend") === "webdav") readFormWebdav();
        else if (getV("#sync-backend") === "gist") readFormGist();
        readFormOptions();
        const p = window.NavProgress ? NavProgress.open("上传到云端（" + Sync.data.backend + "）") : null;
        p?.indeterminate(true);
        p?.setLabel("正在上传到云端…");
        try {
          setStatus("正在上传到云端…");
          await SyncUtils.push();
          setStatus("云端上传成功 · " + new Date().toLocaleString("zh-CN"), "success");
          p?.done("☁ 已上传到云端");
          toast("☁ 已上传到云端");
        } catch (e) {
          setStatus("上传失败：" + e.message, "error");
          p?.fail("上传失败：" + e.message);
          toast("上传失败");
        }
      });
      $("#form-sync-pull")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!confirm("从云端下载并覆盖本地数据？")) return;
        if (getV("#sync-backend") === "webdav") readFormWebdav();
        else if (getV("#sync-backend") === "gist") readFormGist();
        readFormOptions();
        const p = window.NavProgress ? NavProgress.open("从云端拉取（" + Sync.data.backend + "）") : null;
        p?.indeterminate(true);
        p?.setLabel("正在从云端下载…");
        try {
          setStatus("正在从云端下载…");
          await SyncUtils.pull();
          setStatus("云端已同步到本地 · " + new Date().toLocaleString("zh-CN"), "success");
          p?.done("☁ 已同步，正在刷新…");
          toast("☁ 已同步，正在刷新…");
          setTimeout(() => location.reload(), 800);
        } catch (e) {
          setStatus("下载失败：" + e.message, "error");
          p?.fail("下载失败：" + e.message);
        }
      });
      $("#form-sync-export")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const run = window.NavProgress ? NavProgress.run : (_t, fn) => fn({ step() {}, done() {} });
        run("导出本地备份 JSON", async (p) => {
          p.step(0.25, "收集数据…");
          const blob = SyncUtils.exportBlob();
          p.step(0.8, `下载文件 (${(blob.size / 1024).toFixed(1)} KB)…`);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `sakura-nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          p.done("已生成备份文件");
        });
      });

      $("#btn-sync-remote-push")?.addEventListener("click", async () => {
        const p = window.NavProgress ? NavProgress.open("上传到服务器") : null;
        p?.indeterminate(true);
        p?.setLabel("正在上传到服务器…");
        try {
          setStatus("正在上传到服务器…");
          if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
          if (!SakuraRemote?.pushNow) throw new Error("服务端同步不可用");
          await SakuraRemote.pushNow();
          setStatus("已保存到服务器 · " + new Date().toLocaleString("zh-CN"), "success");
          p?.done("已同步到服务器");
          toast("已同步到服务器");
        } catch (e) {
          setStatus(String(e.message || e), "error");
          p?.fail(String(e.message || e));
          toast("上传失败");
        }
      });
      $("#btn-sync-remote-pull")?.addEventListener("click", async () => {
        if (!confirm("从服务器拉取并覆盖当前页数据？未上传到服务器的本地修改将丢失。")) return;
        const p = window.NavProgress ? NavProgress.open("从服务器拉取") : null;
        p?.indeterminate(true);
        p?.setLabel("正在从服务器拉取…");
        try {
          setStatus("正在从服务器拉取…");
          if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
          if (!SakuraRemote?.pullNow) throw new Error("服务端同步不可用");
          await SakuraRemote.pullNow();
          setStatus("已拉取并应用 · " + new Date().toLocaleString("zh-CN"), "success");
          p?.done("已同步，正在刷新…");
          toast("已同步，正在刷新…");
          setTimeout(() => location.reload(), 800);
        } catch (e) {
          setStatus(String(e.message || e), "error");
          p?.fail(String(e.message || e));
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
        const run = window.NavProgress ? NavProgress.run : (_t, fn) => fn({ step() {}, done() {}, fail() {} });
        run("导出静态博客站点 (ZIP)", async (p) => {
          const posts = Blog.list();
          p.step(0.25, `编排 ${posts.length} 篇文章…`);
          const blob = Exporter.buildStaticSite();
          p.step(0.85, `生成 ZIP (${(blob.size / 1024).toFixed(1)} KB)…`);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `sakura-blog-${new Date().toISOString().slice(0, 10)}.zip`;
          a.click();
          URL.revokeObjectURL(a.href);
          p.done(`已打包 ${posts.length} 篇文章`);
          toast("已打包静态博客站点");
        });
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
