/* Floating companion: direct drag, click response, compact context menu. */
(() => {
  'use strict';
  if (!window.SakuraPet || !window.PetCompanion) return;
  const { Config, PetActor, Status, STATUS_META, LINES, pick } = window.SakuraPet;
  const Geometry = window.PetCompanion;
  let cfg, instance;
  const icon = name => window.AstralIcons?.markup(name) || '';
  const quick = {
    todo: ['待办', 'tasks', '#btn-todo'], calendar: ['日历', 'calendar', '#btn-calendar'],
    ai: ['AI 助手', 'star', '#ai-fab'], knowledge: ['知识库', 'library'],
    'recent-note': ['继续阅读', 'previous'], settings: ['导航设置', 'settings', '#btn-settings'],
  };
  function mount() {
    const lifetime = new AbortController();
    const listen = (target, event, fn, opts = {}) => target.addEventListener(event, fn, { ...opts, signal: lifetime.signal });
    let state = { open: false, collapsed: false, blocked: false, resting: false };
    let drag = null, messageTimer = 0, suppressClick = false;
    const dock = document.createElement('section');
    dock.id = 'pet-dock'; dock.setAttribute('aria-label', '桌宠伙伴');
    dock.innerHTML = `<button type="button" class="companion-trigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="pet-companion-panel">
      <span class="companion-avatar" aria-hidden="true"></span><span class="companion-copy"><strong></strong><span class="companion-status"></span></span><span class="companion-chevron" aria-hidden="true">⌃</span></button>
      <button type="button" class="companion-drag" aria-label="桌宠菜单" aria-haspopup="dialog" aria-expanded="false" title="桌宠菜单">⋯</button>`;
    const panel = document.createElement('section');
    panel.id = 'pet-companion-panel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '伙伴互动');
    panel.innerHTML = `<header><div><span class="companion-eyebrow">桌宠伙伴</span><h2></h2></div><button type="button" data-do="close" class="companion-icon" aria-label="关闭伙伴互动">${icon('close')}</button></header>
      <p class="companion-message" role="status">我在这里，随时陪你。</p>
      <div class="companion-interactions"><button type="button" data-do="greet">${icon('pet')}<span>打个招呼</span></button><button type="button" data-do="rest" aria-pressed="false">${icon('theme')}<span>休息一下</span></button></div>
      <div class="companion-tools"><h3>常用工具</h3><div class="companion-tool-grid"></div></div>
      <footer><button type="button" data-do="quiet" aria-pressed="false">安静陪伴</button><a href="pet.html">桌宠设置</a><button type="button" data-do="collapse">收起</button></footer>`;
    const restore = document.createElement('button');
    restore.id = 'pet-companion-restore'; restore.type = 'button'; restore.hidden = true;
    restore.innerHTML = icon('star-badge'); restore.setAttribute('aria-label', '展开桌宠'); restore.title = '展开桌宠';
    document.body.append(dock, panel, restore);
    const trigger = dock.querySelector('.companion-trigger');
    const handle = trigger;
    const menuButton = dock.querySelector('.companion-drag');
    trigger.removeAttribute('aria-haspopup');
    trigger.removeAttribute('aria-expanded');
    trigger.removeAttribute('aria-controls');
    menuButton.setAttribute('aria-controls', 'pet-companion-panel');
    const bubble = document.createElement('div'); bubble.className = 'companion-speech'; bubble.hidden = true; bubble.setAttribute('role', 'status'); dock.append(bubble);
    const avatar = dock.querySelector('.companion-avatar');
    const message = panel.querySelector('.companion-message');
    const actor = new PetActor({ container: avatar, fxLayer: avatar, scale: 1, groundBottom: 2,
      autonomous: false, chatty: false, stationary: true, statusDriven: true, activityMode: 'guard', custom: Config.imageUrl(cfg) || null });
    actor.el.tabIndex = -1; actor.el.setAttribute('aria-hidden', 'true');
    // The visible trigger owns all pointer/keyboard activation, not the sprite.
    actor.el.style.pointerEvents = 'none';
    function viewportBounds() { return Geometry.bounds(innerWidth, innerHeight, dock.offsetWidth || 210, dock.offsetHeight || 68); }
    function place(x, bottom) {
      const b = viewportBounds();
      const p = Geometry.position(Geometry.anchor(x, bottom, b), b);
      dock.style.left = p.x + 'px'; dock.style.bottom = p.bottom + 'px';
      placePanel();
    }
    function layout() {
      dock.dataset.size = cfg.homeScale || 'md';
      actor.setScale(({sm:1.5,md:1.75,lg:2})[cfg.homeScale] || 1.75);
      const p = Geometry.position(cfg.anchor, viewportBounds()); place(p.x, p.bottom);
    }
    function placePanel() {
      if (!state.open || state.blocked) return;
      const r = dock.getBoundingClientRect();
      panel.style.left = Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, r.right - panel.offsetWidth)) + 'px';
      panel.style.top = Math.max(8, Math.min(innerHeight - panel.offsetHeight - 8, r.top - panel.offsetHeight - 10)) + 'px';
    }
    function syncActivity() { actor.setPaused(document.hidden || state.resting || state.collapsed || state.blocked || !!drag); }
    function render() {
      dock.hidden = state.collapsed || state.blocked;
      panel.hidden = !state.open || state.collapsed || state.blocked;
      restore.hidden = !state.collapsed || state.blocked;
      if (state.collapsed || state.blocked || state.open) bubble.hidden = true;
      menuButton.setAttribute('aria-expanded', String(!panel.hidden));
      panel.querySelector('[data-do="rest"]').setAttribute('aria-pressed', String(state.resting));
      panel.querySelector('[data-do="rest"] span').textContent = state.resting ? '唤醒伙伴' : '休息一下';
      refreshStatus(); syncActivity(); placePanel();
    }
    function dispatch(type, value) { state = Geometry.reduce(state, { type, value }); render(); }
    function close(focus = false) { dispatch('close'); if (focus && !dock.hidden) trigger.focus({ preventScroll: true }); }
    function say(text) {
      message.textContent = text; panel.dataset.feedback = "true"; placePanel();
      bubble.classList.remove('is-below'); bubble.style.marginLeft = '0px';
      bubble.textContent = text; bubble.hidden = state.collapsed || state.blocked || state.open;
      requestAnimationFrame(() => {
        if (!bubble.isConnected || bubble.hidden) return;
        const r = bubble.getBoundingClientRect();
        const shift = r.left < 8 ? 8-r.left : r.right > innerWidth-8 ? innerWidth-8-r.right : 0;
        bubble.style.marginLeft = shift + 'px';
        bubble.classList.toggle('is-below', r.top < 8);
      });
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => { bubble.hidden = true; panel.dataset.feedback = "false"; message.textContent = state.resting ? '休息中，任务状态仍会更新。' : '我在这里，随时陪你。'; }, 4500);
    }
    function refreshStatus() {
      const { status, detail } = Status.get();
      const label = STATUS_META[status]?.label || '待命';
      const text = cfg.showStatusBadge === false ? '点击与我互动' : status !== 'idle' ? detail || label : state.resting ? '安静休息中' : '在这里陪你';
      dock.querySelector('.companion-status').textContent = text;
      dock.querySelector('.companion-status').title = text;
      dock.dataset.status = status;
      trigger.setAttribute('aria-label', `${cfg.name}，${text}。单击互动，拖动移动，方向键微调`);
    }
    const unsubscribe = Status.on(() => {
      refreshStatus();
      if (cfg.speechFrequency !== 'quiet' && !state.collapsed && !state.resting && !state.blocked) {
        const status = Status.get().status;
        if (['done', 'error'].includes(status) || cfg.speechFrequency === 'lively' && ['thinking', 'working', 'syncing'].includes(status)) say(pick(LINES[status]));
      }
    });
    function refresh() {
      dock.querySelector('strong').textContent = cfg.name;
      panel.querySelector('h2').textContent = cfg.name;
      const img = Config.imageUrl(cfg) || null; if (img !== actor.custom) actor.setCustom(img);
      const quiet = cfg.speechFrequency === 'quiet';
      const q = panel.querySelector('[data-do="quiet"]'); q.setAttribute('aria-pressed', String(quiet)); q.textContent = quiet ? '恢复对白' : '安静陪伴';
      const grid = panel.querySelector('.companion-tool-grid'); grid.replaceChildren();
      for (const action of cfg.quickActions || []) {
        if (!quick[action]) continue;
        const [label, symbol, selector] = quick[action];
        const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action;
        button.innerHTML = icon(symbol); button.append(document.createTextNode(label));
        button.addEventListener('click', () => {
          close(true);
          if (action === 'knowledge' && window.SakuraKnowledgeUI?.open) return window.SakuraKnowledgeUI.open();
          if (action === 'recent-note' && window.SakuraKnowledgeUI?.openRecent) return window.SakuraKnowledgeUI.openRecent();
          const target = selector && document.querySelector(selector);
          if (target) target.click(); else { dispatch('toggle'); say(`${label}暂不可用，请稍后再试。`); }
        }); grid.append(button);
      }
      if (!grid.children.length) { const p = document.createElement('p'); p.textContent = '在桌宠设置中添加常用工具。'; grid.append(p); }
      layout(); render();
    }
    function openMenu() { if (!state.open) dispatch('toggle'); if (state.open) panel.querySelector('[data-do="greet"]').focus({ preventScroll: true }); }
    listen(menuButton, 'click', () => state.open ? close(true) : openMenu());
    listen(trigger, 'click', () => { if (suppressClick) { suppressClick = false; return; } if (state.resting) dispatch('rest'); actor.emote('wave', 1.6); say(pick(LINES.pat)); });
    listen(trigger, 'contextmenu', e => { e.preventDefault(); openMenu(); });
    listen(trigger, 'keydown', e => { if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); openMenu(); } });
    listen(restore, 'click', () => { dispatch('restore'); layout(); trigger.focus(); });
    listen(panel, 'click', e => {
      const action = e.target.closest('[data-do]')?.dataset.do;
      if (action === 'close') close(true);
      if (action === 'greet') { if (state.resting) dispatch('rest'); actor.emote('wave', 1.6); say(pick(LINES.pat)); }
      if (action === 'rest') { dispatch('rest'); say(state.resting ? '我先休息，任务状态仍会更新。' : '我回来啦，今天也一起加油。'); }
      if (action === 'quiet') { cfg.speechFrequency = cfg.speechFrequency === 'quiet' ? 'normal' : 'quiet'; Config.save(cfg); say(cfg.speechFrequency === 'quiet' ? '已关闭自动对白，随时可以主动找我。' : '已恢复自动对白。'); }
      if (action === 'collapse') { dispatch('collapse'); restore.focus(); }
    });
    function savePosition() {
      cfg.anchor = Geometry.anchor(parseFloat(dock.style.left), parseFloat(dock.style.bottom), viewportBounds()); Config.save(cfg);
    }
    listen(handle, 'pointerdown', e => {
      if (!e.isPrimary || e.button !== 0) return;
      suppressClick = false; close(); bubble.hidden = true; const r = dock.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, bottom: innerHeight - r.bottom, moved: false };
      handle.setPointerCapture(e.pointerId); handle.focus({ preventScroll: true }); dock.classList.add('is-dragging'); syncActivity();
    });
    listen(handle, 'pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.moved = true; suppressClick = true; place(drag.left + e.clientX - drag.x, drag.bottom - (e.clientY - drag.y));
    });
    function finishDrag(e = {}) {
      if (!drag || e.pointerId !== undefined && drag.id !== e.pointerId) return;
      const moved = drag.moved; drag = null; dock.classList.remove('is-dragging'); if (moved) savePosition(); syncActivity();
    }
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(event => listen(handle, event, finishDrag));
    listen(handle, 'keydown', e => {
      const delta = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, 12], ArrowDown: [0, -12] }[e.key];
      if (!delta) return; e.preventDefault();
      place(parseFloat(dock.style.left) + delta[0], parseFloat(dock.style.bottom) + delta[1]); savePosition();
    });
    listen(document, 'pointerdown', e => { if (state.open && !panel.contains(e.target) && !dock.contains(e.target)) close(); });
    listen(document, 'keydown', e => {
      if (!state.open) return;
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      if (e.key === 'Tab') {
        const controls = [...panel.querySelectorAll('button, a')]; const i = controls.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0 || !e.shiftKey && i === controls.length - 1) { e.preventDefault(); controls[e.shiftKey ? controls.length - 1 : 0].focus(); }
      }
    });
    function overlay() { dispatch('block', !!document.querySelector('dialog[open], #ai-panel:not([hidden]), #music-panel:not([hidden]), #calendar-panel:not([hidden])')); }
    const observer = new MutationObserver(overlay);
    document.querySelectorAll('dialog, #ai-panel, #music-panel, #calendar-panel').forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['open', 'hidden'] }));
    listen(document, 'visibilitychange', syncActivity);
    listen(window, 'resize', () => { finishDrag(); layout(); });
    listen(window, 'blur', () => { finishDrag(); close(); });
    refresh(); overlay();
    return { refresh, destroy() { lifetime.abort(); observer.disconnect(); unsubscribe(); clearTimeout(messageTimer); actor.destroy(); dock.remove(); panel.remove(); restore.remove(); } };
  }
  function reconcile() { cfg = Config.load(); if (!cfg.homeWidget) { instance?.destroy(); instance = null; } else if (instance) instance.refresh(); else instance = mount(); }
  async function start() {
    if (window.SakuraRemote?.ready) { try { await window.SakuraRemote.ready; } catch (_) {} }
    try { await Config.ensureMigrated(Config.load()); } catch (e) { console.warn('[pet] 形象迁移稍后重试', e?.message); }
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    reconcile(); addEventListener('sakura-pet-config', reconcile); addEventListener('pageshow', reconcile);
    addEventListener('storage', e => { if ([window.SakuraPet.SAVE_KEY, window.SakuraPet.V2_KEY].includes(e.key)) reconcile(); });
    try { const channel = new BroadcastChannel(`sakura-pet-config:${window.Auth?.currentUser?.()?.id || "local"}`); channel.addEventListener('message', e => {
      if (e.data?.schemaVersion !== 3) return;
      window.SakuraRemote?.acceptPetConfig(window.SakuraPetConfig.normalizeV3(e.data)); reconcile();
    }); addEventListener('pagehide', e => { if (!e.persisted) channel.close(); }); } catch (_) {}
    addEventListener('offline', () => window.SakuraPetEvents.emit('nav:network:offline'));
    addEventListener('online', () => window.SakuraPetEvents.emit('nav:network:online'));
    if (!navigator.onLine) window.SakuraPetEvents.emit('nav:network:offline');
  }
  start();
})();
