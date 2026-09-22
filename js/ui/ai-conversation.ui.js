/* Conversation layout: existing chat, archive and generation modules own data. */
window.createAIConversationLayout = function ({ UIAI, UIArchive, toast }) {
  const panel = document.getElementById('ai-panel');
  const find = selector => panel.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => window.AstralIcons?.markup(name) || '';
  const chat = find('#ai-view-chat');
  const head = find('.ai-head-primary');
  const title = find('.ai-workspace-title');
  title.textContent = 'AI 工作区';

  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'ai-tool-btn ai-sidebar-toggle';
  toggle.setAttribute('aria-label', '切换会话侧栏'); toggle.setAttribute('aria-controls', 'ai-session-sidebar');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>';
  head.prepend(toggle);

  const context = document.createElement('div'); context.className = 'ai-chat-context';
  context.innerHTML = '<div class="ai-conversation-heading"><h2 id="ai-conversation-title">新对话</h2><span id="ai-conversation-status" role="status" aria-live="polite">随时开始</span></div><div class="ai-chat-selectors"></div>';
  for (const [id, label] of [['ai-persona-select', '角色'], ['ai-model-select', '模型']]) {
    const wrapper = document.createElement('label');
    wrapper.innerHTML = `<span>${label}</span>`;
    wrapper.append(find('#' + id)); context.lastElementChild.append(wrapper);
  }
  const more = find('.ai-chat-more');
  more.querySelector('summary').textContent = '对话工具';
  const settings = find('#ai-open-settings');
  head.insertBefore(settings, find('#ai-close'));
  head.insertBefore(find('.ai-expand'), find('#ai-close'));
  context.lastElementChild.append(more);
  more.addEventListener('click', e => { if (e.target.closest('button')) more.open = false; });
  document.addEventListener('click', e => { if (!more.contains(e.target)) more.open = false; });

  const main = document.createElement('div'); main.className = 'ai-conversation-main'; main.id = 'ai-conversation-main';
  main.append(context);
  [...chat.children].forEach(el => main.append(el));
  chat.append(main);
  const sidebar = document.createElement('nav'); sidebar.id = 'ai-session-sidebar'; sidebar.className = 'ai-session-sidebar';
  sidebar.setAttribute('aria-label', '历史对话');
  sidebar.innerHTML = `<div class="ai-sidebar-top"><span>我的对话</span><button type="button" class="ai-sidebar-close" aria-label="收起会话侧栏">×</button></div>
    <button type="button" class="ai-new-conversation">＋ 新建对话</button>
    <label class="ai-session-search"><span class="sr-only">搜索历史对话</span><input type="search" placeholder="搜索对话…" autocomplete="off" aria-label="搜索历史对话"></label>
    <div class="ai-sidebar-list" aria-label="会话列表"><p class="ai-sidebar-empty">正在读取对话…</p></div>
    <div class="ai-sidebar-footer"></div>`;
  chat.prepend(sidebar);
  sidebar.lastElementChild.append(find('#ai-sessions'), find('#ai-gallery'));
  const shade = document.createElement('button'); shade.type = 'button'; shade.className = 'ai-sidebar-shade';
  shade.setAttribute('aria-label', '收起会话侧栏'); shade.tabIndex = -1;
  chat.insertBefore(shade, main);

  const attach = find('.ai-attach-btn:not(.voice-btn)');
  attach.tabIndex = 0; attach.setAttribute('role', 'button');
  attach.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); find('#ai-attach-input').click(); } });
  const composer = find('.ai-input-row');
  const tools = document.createElement('div'); tools.className = 'ai-composer-tools';
  tools.append(attach, find('#ai-voice'));
  const hint = document.createElement('span'); hint.className = 'ai-composer-hint';
  hint.textContent = 'Enter 发送 · Shift+Enter 换行';
  tools.append(hint, find('#ai-stop'), find('#ai-send'));
  composer.append(tools);
  composer.prepend(find('#ai-attach-preview'));
  find('#ai-input').setAttribute('aria-describedby', 'ai-tip');

  const compact = matchMedia('(max-width: 760px)');
  let open = !compact.matches;
  let listVersion = 0;
  function setSidebar(value, focus = false) {
    open = value;
    panel.dataset.sidebarOpen = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    sidebar.inert = !open;
    main.inert = compact.matches && open;
    if (focus) (open ? sidebar.querySelector('input') : toggle).focus();
  }
  toggle.addEventListener('click', () => setSidebar(!open, true));
  shade.addEventListener('click', () => setSidebar(false, true));
  sidebar.querySelector('.ai-sidebar-close').addEventListener('click', () => setSidebar(false, true));
  compact.addEventListener('change', () => setSidebar(!compact.matches));
  // Handle Escape before the panel's close shortcut; keep keyboard focus in the mobile drawer.
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape' && more.open) { e.preventDefault(); e.stopPropagation(); more.open = false; more.querySelector('summary').focus(); return; }
    if (compact.matches && open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSidebar(false, true); }
    if (compact.matches && open && e.key === 'Tab') {
      const controls = [...sidebar.querySelectorAll('button:not(:disabled), input')];
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  setSidebar(open);

  const list = sidebar.querySelector('.ai-sidebar-list');
  const search = sidebar.querySelector('input');
  async function refreshSessions() {
    const version = ++listVersion;
    if (!window.Archive || !UIArchive) { list.innerHTML = '<p class="ai-sidebar-empty">会话存储暂不可用</p>'; return; }
    try {
      await Archive.ready;
      const all = await Archive.Sessions.list();
      if (version !== listVersion) return;
      const current = Archive.Sessions.currentId();
      find('#ai-conversation-title').textContent = all.find(s => s.id === current)?.title || '新对话';
      const query = search.value.trim().toLowerCase();
      const filtered = all.filter(s => !query || (s.title || '').toLowerCase().includes(query));
      const disabled = UIAI.isBusy() || panel.dataset.sessionBusy === 'true';
      let group = '';
      list.innerHTML = filtered.map(s => {
        const date = new Date(s.updatedAt || s.createdAt);
        const label = s.pinned ? '置顶' : date.toDateString() === new Date().toDateString() ? '今天' : '更早';
        const section = label !== group ? `<p class="ai-session-section">${label}</p>` : ''; group = label;
        return `${section}<button type="button" class="ai-session-link" data-session-id="${esc(s.id)}" ${disabled ? 'disabled' : ''} ${s.id === current ? 'aria-current="true"' : ''} title="${esc(s.title || '新对话')}"><span>${esc(s.title || '新对话')}</span><small>${s.messageCount || 0} 条消息 · ${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</small></button>`;
      }).join('') || `<p class="ai-sidebar-empty">${query ? '没有找到匹配的对话' : '还没有历史对话。\n发送第一条消息后会自动保存。'}</p>`;
    } catch (_) { if (version === listVersion) list.innerHTML = '<p class="ai-sidebar-empty">读取失败，请重新打开侧栏重试</p>'; }
  }
  async function changeSession(id) {
    if (!UIArchive) { toast('会话存储暂不可用'); return; }
    if (UIAI.isBusy() || panel.dataset.sessionBusy === 'true') return;
    const changed = await UIArchive.changeSession(id);
    if (changed) {
      if (compact.matches) setSidebar(false);
      find('#ai-input').focus();
      updateState();
      await refreshSessions();
    }
  }
  sidebar.querySelector('.ai-new-conversation').addEventListener('click', () => changeSession());
  list.addEventListener('click', e => { const b = e.target.closest('[data-session-id]'); if (b) changeSession(b.dataset.sessionId); });
  search.addEventListener('input', refreshSessions);
  document.addEventListener('ai:sessions-changed', refreshSessions);
  panel.addEventListener('ai:opened', () => { if (compact.matches) setSidebar(false); refreshSessions(); });
  panel.addEventListener('ai:mode', e => {
    if (e.detail.mode !== 'chat') setSidebar(false);
    toggle.hidden = e.detail.mode !== 'chat';
  });
  toggle.addEventListener('click', () => { if (open) refreshSessions(); });

  function updateState() {
    const busy = UIAI.isBusy();
    const locked = busy || panel.dataset.sessionBusy === 'true';
    sidebar.querySelector('.ai-new-conversation').disabled = locked;
    list.querySelectorAll('button').forEach(b => b.disabled = locked);
    find('#ai-clear').disabled = locked;
    const status = find('#ai-conversation-status');
    const text = busy ? '正在回复…' : AI.AIStore.messages.length ? '对话中' : '随时开始';
    if (status.textContent !== text) status.textContent = text;
  }
  panel.addEventListener('ai:state', updateState);
  // Make controls usable immediately, including a restored text draft.
  UIAI.syncComposer();
  refreshSessions();
};
