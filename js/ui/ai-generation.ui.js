/* AI workspace coordinator and independent image/video task views. */
(function () {
  'use strict';
  window.AIGenerationFactory = function ({ UIAI, UIArchive, toast }) {
    const panel = document.getElementById('ai-panel');
    const api = window.AITasks;
    const store = AI.AIStore;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const active = new Set(['queued', 'submitting', 'running', 'saving']);
    const labels = { queued: '排队中', submitting: '提交中', running: '生成中', saving: '保存素材中', succeeded: '已完成', failed: '生成失败', unknown: '结果未知', cancelled: '已停止', save_failed: '素材保存失败' };
    const states = {};
    const blobs = new Map();
    const retryKeys = new Map();
    const preview = document.createElement('dialog'); preview.className = 'ai-media-preview glass-dialog';
    preview.setAttribute('aria-label', '图片预览');
    preview.innerHTML = '<button type="button" aria-label="关闭图片预览">关闭</button><img alt="生成图片大图">';
    document.body.append(preview);
    preview.querySelector('button').addEventListener('click', () => preview.close());
    preview.addEventListener('click', e => { if (e.target === preview) preview.close(); });
    let mode = 'chat', tasks = [], loading = false, disposed = false;
    const nav = document.createElement('div');
    nav.className = 'ai-mode-tabs'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'AI 工作模式');
    nav.innerHTML = ['chat', 'image', 'video'].map((m, i) => `<button type="button" id="ai-tab-${m}" role="tab" data-ai-mode="${m}" aria-controls="ai-view-${m}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${['对话', '生图', '生视频'][i]}</button>`).join('') + '<button type="button" class="ai-expand" aria-label="扩大面板" aria-pressed="false">⤢</button>';
    panel.querySelector('.ai-head').after(nav);
    const title = document.createElement('span'); title.className = 'ai-workspace-title'; title.textContent = 'AI 创作';
    panel.querySelector('.ai-logo').after(title);
    const chat = document.createElement('section'); chat.id = 'ai-view-chat'; chat.className = 'ai-chat-view';
    chat.setAttribute('role', 'tabpanel'); chat.setAttribute('aria-labelledby', 'ai-tab-chat');
    // Keep all chat nodes and their event listeners intact.
    const chatNodes = [...panel.children].filter(el => el !== nav && !el.matches('.ai-head'));
    nav.after(chat); chatNodes.forEach(el => chat.append(el));
    const more = document.createElement('details'); more.className = 'ai-chat-more';
    const toolbar = panel.querySelector('.ai-head-toolbar');
    more.innerHTML = '<summary>更多工具</summary>'; toolbar.before(more); more.append(toolbar);
    const history = document.createElement('section'); history.className = 'ai-task-history';
    history.innerHTML = '<div class="ai-task-heading"><h3>生成记录</h3><button type="button" data-refresh>刷新</button></div><p class="ai-task-notice" role="status" aria-live="polite"></p><div class="ai-task-list"></div><button type="button" data-load-more hidden>加载更多</button>';
    const notice = history.querySelector('.ai-task-notice');
    const list = history.querySelector('.ai-task-list');
    for (const type of ['image', 'video']) {
      const view = document.createElement('section');
      view.id = 'ai-view-' + type; view.className = 'ai-generation-view'; view.hidden = true;
      view.setAttribute('role', 'tabpanel'); view.setAttribute('aria-labelledby', 'ai-tab-' + type);
      view.innerHTML = `
        <div class="ai-generation-intro"><h2>${type === 'image' ? '把想法变成画面' : '让画面动起来'}</h2><p>${type === 'image' ? '描述画面，或添加参考图进行修改。' : '描述动作与镜头，或添加一张起始参考图。'}</p></div>
        <label class="ai-prompt-label" for="${type}-prompt">${type === 'image' ? '画面描述' : '视频描述'}</label>
        <textarea id="${type}-prompt" name="prompt" rows="3" maxlength="4000" placeholder="${type === 'image' ? '主体、环境、光线与风格…' : '主体如何运动，镜头如何变化…'}"></textarea>
        <div class="ai-reference-strip"></div>
        <div class="ai-generation-tools"><label class="mini-btn ai-ref-upload">添加参考图<input aria-label="上传${type === 'image' ? '图片' : '视频'}参考图" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" ${type === 'image' ? 'multiple' : ''}></label><span data-reference-count>未添加参考图</span></div>
        <div class="ai-generation-models"><label>供应商<select name="providerId"></select></label><label>模型<input name="model" list="${type}-models" autocomplete="off"><datalist id="${type}-models"></datalist></label></div>
        <details class="ai-generation-params"><summary>生成参数</summary><div class="ai-param-grid">
          <label>接口协议<select name="apiMode">${type === 'image' ? '<option value="images">Images</option><option value="responses">Responses</option><option value="gemini">Gemini 原生</option><option value="dashscope">百炼原生</option>' : '<option value="newapi">New API 视频</option>'}</select></label>
          ${type === 'image' ? '<label>尺寸<input name="size" placeholder="1024x1024 或 auto"></label><label>质量<select name="quality"><option>auto</option><option>low</option><option>medium</option><option>high</option><option>standard</option><option>hd</option></select></label><label>张数<input name="n" type="number" min="1" max="8"></label><label data-driver>文本驱动模型<input name="textModel" placeholder="Responses 使用的文本模型"></label>' : '<label>时长（秒）<input name="duration" type="number" min="1" max="30" placeholder="使用模型默认值"></label><label>宽度<input name="width" type="number" min="64" max="4096" placeholder="模型默认"></label><label>高度<input name="height" type="number" min="64" max="4096" placeholder="模型默认"></label>'}
        </div><p>参数须符合供应商支持范围；留空的视频参数使用上游默认值。</p></details>
        <div class="ai-generate-actions"><button type="button" class="btn-primary" data-generate>生成${type === 'image' ? '图片' : '视频'}</button><span role="status" data-submit-status></span></div>`;
      panel.append(view);
      states[type] = { view, refs: [], pending: null, dirty: false, restored: false };
      view.addEventListener('input', () => { states[type].dirty = true; states[type].pending = null; persist(type); });
      view.addEventListener('change', e => {
        if (e.target.name === 'providerId') models(type, true);
        if (e.target.name === 'apiMode') driver(type);
        persist(type);
      });
      view.querySelector('[type=file]').addEventListener('change', async e => {
        const files = [...e.target.files]; e.target.value = ''; await addReferences(type, files);
      });
      view.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
      view.addEventListener('drop', e => { if (e.dataTransfer?.files.length) { e.preventDefault(); e.stopPropagation(); addReferences(type, [...e.dataTransfer.files]); } });
      view.querySelector('[data-generate]').addEventListener('click', () => submit(type));
      view.querySelector('textarea').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(type); } });
      view.querySelector('.ai-reference-strip').addEventListener('click', e => {
        const b = e.target.closest('[data-remove]'); if (!b) return;
        states[type].refs.splice(+b.dataset.remove, 1); states[type].pending = null; renderRefs(type); persist(type);
      });
    }
    function field(type, name) { return states[type].view.querySelector(`[name="${name}"]`); }
    function defaults(type) {
      const old = store.data.imageOpts || {};
      const providers = store.data.providers || [];
      return type === 'image' ? { providerId: old.genProviderId || store.data.currentProviderId, model: old.genModel || '', prompt: '', refs: [],
        apiMode: /aliyuncs|dashscope/.test(providers.find(p => p.id === (old.genProviderId || store.data.currentProviderId))?.baseUrl || '') ? 'dashscope' : old.apiMode === 'responses' ? 'responses' : /^gemini.*image/.test(old.genModel || '') ? 'gemini' : 'images', size: old.size === 'custom' ? `${old.customW || 1024}x${old.customH || 1024}` : old.size || '1024x1024', quality: old.quality || 'auto', n: old.n || 1, textModel: old.textModel || '' }
        : { providerId: providers.find(p => p.models?.includes('grok-imagine-video'))?.id || '', model: 'grok-imagine-video', apiMode: 'newapi', prompt: '', refs: [] };
    }
    function restore(type) {
      const state = states[type]; if (state.restored) return;
      const saved = { ...defaults(type), ...store.data.workspace?.[type] };
      providers(type, saved.providerId);
      for (const el of state.view.querySelectorAll('[name]')) if (saved[el.name] !== undefined) el.value = saved[el.name];
      state.refs = saved.refs || []; state.restored = true; models(type, false); renderRefs(type); driver(type);
    }
    function providers(type, selected = field(type, 'providerId').value) {
      field(type, 'providerId').innerHTML = '<option value="">选择供应商</option>' + (store.data.providers || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
      field(type, 'providerId').value = selected || '';
    }
    function models(type, reset) {
      const p = store.data.providers.find(p => p.id === field(type, 'providerId').value);
      const candidates = (p?.models || []).filter(m => type === 'video' ? m === 'grok-imagine-video' : /image|dall|flux|wan|imagen|banana/i.test(m));
      states[type].view.querySelector('datalist').innerHTML = candidates.map(m => `<option value="${esc(m)}"></option>`).join('');
      if (reset || !field(type, 'model').value) field(type, 'model').value = candidates[0] || '';
      if (reset && type === 'image') {
        field(type, 'apiMode').value = /aliyuncs|dashscope/.test(p?.baseUrl || '') ? 'dashscope' : /^gemini/.test(field(type, 'model').value) ? 'gemini' : 'images';
        driver(type);
      }
    }
    function driver(type) { const el = states[type].view.querySelector('[data-driver]'); if (el) el.hidden = field(type, 'apiMode').value !== 'responses'; }
    function persist(type) {
      const state = states[type]; if (!state.restored) return;
      const saved = Object.fromEntries([...state.view.querySelectorAll('[name]')].map(el => [el.name, el.value]));
      saved.refs = state.refs;
      store.data.workspace = { ...store.data.workspace, [type]: saved }; store.save();
    }
    async function addReferences(type, sources) {
      restore(type);
      const state = states[type], status = state.view.querySelector('[data-submit-status]');
      if (state.uploading) return;
      state.uploading = true;
      try {
        if (state.refs.length + sources.length > (type === 'image' ? 8 : 1)) throw new Error(type === 'image' ? '最多添加 8 张参考图' : '图生视频只支持一张参考图，请先移除原图');
        status.textContent = '正在保存参考图…';
        for (const source of sources) state.refs.push(await api.upload(source));
        state.pending = null; persist(type); renderRefs(type); status.textContent = '';
      } catch (e) { status.textContent = e.message; persist(type); renderRefs(type); }
      finally { state.uploading = false; }
    }
    async function hydrateMedia(root) {
      for (const el of root.querySelectorAll('[data-asset-url]')) {
        const url = el.dataset.assetUrl;
        if (el.dataset.loadedAsset === url) continue;
        try {
          if (!blobs.has(url)) blobs.set(url, api.blobURL(url).catch(e => { blobs.delete(url); throw e; }));
          const blob = await blobs.get(url);
          if (el.isConnected) { if (el.tagName === 'A') el.href = blob; else el.src = blob; el.dataset.loadedAsset = url; }
        } catch { if (el.isConnected) { el.setAttribute('aria-label', '素材读取失败，请刷新重试'); el.classList.add('is-unavailable'); } }
      }
    }
    function renderRefs(type) {
      const state = states[type];
      state.view.querySelector('.ai-reference-strip').innerHTML = state.refs.map((a, i) => `<figure><img data-asset-url="${esc(a.url)}" alt="参考图 ${i + 1}"><button type="button" data-remove="${i}" aria-label="移除参考图 ${i + 1}">×</button></figure>`).join('');
      state.view.querySelector('[data-reference-count]').textContent = state.refs.length ? `${state.refs.length} 张参考图 · ${type === 'image' ? '图生图' : '图生视频'}` : '未添加参考图';
      hydrateMedia(state.view);
    }
    async function submit(type) {
      const state = states[type], button = state.view.querySelector('[data-generate]'), status = state.view.querySelector('[data-submit-status]');
      if (button.disabled || state.uploading) return;
      persist(type);
      const saved = store.data.workspace[type];
      if (!saved.prompt.trim() || !saved.providerId || !saved.model.trim()) { status.textContent = '请填写提示词并选择供应商和模型'; return; }
      button.disabled = true;
      status.textContent = '正在提交…';
      try {
        // Flush provider settings before a task refers to a newly added provider.
        const r = await fetch('/api/ai-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(store.data) });
        if (!r.ok) throw new Error('设置保存失败，请稍后重试');
        state.pending ||= crypto.randomUUID();
        const task = await api.create({ type, providerId: saved.providerId, model: saved.model, prompt: saved.prompt,
          params: saved, referenceIds: state.refs.map(a => a.id), idempotencyKey: state.pending });
        state.pending = null; status.textContent = '已提交，可以切换模式或关闭面板';
        tasks = [task, ...tasks.filter(t => t.id !== task.id)]; renderTasks();
      } catch (e) { status.textContent = e.message; }
      finally { button.disabled = false; }
    }
    function renderTasks() {
      if (mode === 'chat') return;
      const visible = tasks.filter(t => t.type === mode);
      const markup = visible.length ? visible.map(t => `<article class="ai-task" data-task-id="${esc(t.id)}">
        <div class="ai-task-meta"><strong>${esc(labels[t.status] || t.status)}</strong><time>${esc(new Date(t.createdAt).toLocaleString())}</time></div>
        <p class="ai-task-prompt">${esc(t.prompt)}</p><small>${esc(t.model)}</small>
        ${t.error ? `<p class="ai-task-error" role="status">${esc(t.error)}</p>` : ''}
        ${t.preview ? `<img class="ai-task-preview" src="${esc(t.preview)}" alt="生成中的预览">` : ''}
        <div class="ai-task-media">${(t.results || []).map(a => `<figure>${a.mime.startsWith('video/') ? `<video controls playsinline preload="metadata" data-asset-url="${esc(a.url)}"></video>` : `<img role="button" tabindex="0" aria-label="查看生成图片大图" data-asset-url="${esc(a.url)}" alt="${esc(t.prompt)}">`}
          <figcaption>${a.partial ? '<span>中间预览，非最终成品</span>' : ''}<a data-asset-url="${esc(a.url)}" download="${esc(a.id)}.${a.mime.split('/')[1]}">下载</a>${a.mime.startsWith('image/') ? `<button type="button" data-ref-id="${esc(a.id)}" data-target="image">再编辑</button><button type="button" data-ref-id="${esc(a.id)}" data-target="video">生成视频</button><button type="button" data-edit-id="${esc(a.id)}">裁剪与编辑</button>` : ''}</figcaption></figure>`).join('')}</div>
        <div class="ai-task-actions">${active.has(t.status) ? `<button type="button" data-task-action="cancel">${t.status === 'queued' ? '取消排队' : '停止执行／跟踪'}</button>` : ''}
        ${['failed', 'unknown', 'cancelled', 'save_failed'].includes(t.status) ? `<button type="button" data-task-action="retry">${t.status === 'save_failed' ? '重试保存' : t.upstreamId && t.status !== 'failed' ? '恢复查询' : '重新生成'}</button>` : ''}
        <button type="button" data-task-action="reuse">复用提示词</button></div></article>`).join('') : '<p class="ai-task-empty">生成结果会保存在这里，刷新后仍可查看。</p>';
      if (!visible.length) list.innerHTML = markup;
      else {
        const staging = document.createElement('div'); staging.innerHTML = markup;
        const keep = new Set(visible.map(t => t.id));
        for (const child of [...list.children]) if (!keep.has(child.dataset.taskId)) child.remove();
        visible.forEach((task, index) => {
          const fingerprint = JSON.stringify({ ...task, updatedAt: 0 });
          let node = [...list.children].find(el => el.dataset.taskId === task.id);
          if (!node || node._taskFingerprint !== fingerprint) {
            const replacement = staging.children[index];
            // Clone so staging indexes remain stable while reconciling.
            const fresh = replacement.cloneNode(true); fresh._taskFingerprint = fingerprint;
            if (node) node.replaceWith(fresh);
            node = fresh;
          }
          if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
        });
      }
      hydrateMedia(list);
    }
    async function refresh(append = false) {
      if (loading || mode === 'chat' || panel.hidden || disposed) return;
      loading = true;
      const requestedMode = mode;
      const state = states[requestedMode];
      try {
        const page = await api.list(append ? state.offset || 0 : 0, requestedMode);
        const prior = JSON.stringify(tasks);
        if (append) tasks.push(...page.items.filter(t => !tasks.some(x => x.id === t.id)));
        else tasks = [...page.items, ...tasks.filter(t => !page.items.some(x => x.id === t.id))];
        const firstPageOnly = !state.offset || state.offset <= 30;
        state.offset = append ? (state.offset || 0) + page.items.length : Math.max(state.offset || 0, page.items.length);
        if (append || firstPageOnly) state.hasMore = page.items.length === 30;
        if (mode === requestedMode) history.querySelector('[data-load-more]').hidden = !state.hasMore;
        notice.textContent = '';
        // Do not replace a playing video on every polling tick.
        if (prior !== JSON.stringify(tasks) || !list.children.length) renderTasks();
      } catch (e) { notice.textContent = e.message + '；稍后自动重试'; }
      finally { loading = false; }
    }
    async function taskAction(event) {
      const article = event.target.closest('[data-task-id]'); if (!article) return;
      const task = tasks.find(t => t.id === article.dataset.taskId); if (!task) return;
      const b = event.target.closest('button'); if (!b || b.disabled) return;
      b.disabled = true;
      try {
        if (b.dataset.refId) {
          const asset = task.results.find(a => a.id === b.dataset.refId);
          const type = b.dataset.target; open(type); states[type].refs = [asset]; states[type].pending = null; persist(type); renderRefs(type); return;
        }
        if (b.dataset.editId) {
          const a = task.results.find(a => a.id === b.dataset.editId);
          const r = await fetch(a.url); if (!r.ok) throw new Error('素材读取失败');
          await ImageEditor.open({ dataUrl: await api.readFile(await r.blob()), prompt: task.prompt, model: task.model }, async result => {
            await Archive.Gallery.add({ source: 'uploaded', ...result }); toast('编辑结果已存入图库');
          }); return;
        }
        const action = b.dataset.taskAction;
        if (action === 'reuse') { field(mode, 'prompt').value = task.prompt; states[mode].pending = null; persist(mode); field(mode, 'prompt').focus(); return; }
        if (action === 'retry' && task.status === 'unknown' && !task.upstreamId && !confirm('上次提交可能已经被上游受理。重新生成可能产生另一笔用量，仍要继续吗？')) return;
        if (!retryKeys.has(task.id)) retryKeys.set(task.id, crypto.randomUUID());
        const updated = action === 'cancel' ? await api.cancel(task.id) : await api.retry(task.id, retryKeys.get(task.id));
        retryKeys.delete(task.id);
        tasks = [updated, ...tasks.filter(t => t.id !== updated.id)]; renderTasks();
      } catch (e) { notice.textContent = e.message; }
      finally { if (b.isConnected) b.disabled = false; }
    }
    function switchMode(next) {
      mode = next;
      panel.dataset.aiMode = next;
      panel.dispatchEvent(new CustomEvent('ai:mode', { detail: { mode: next } }));
      for (const b of nav.querySelectorAll('[role=tab]')) { const selected = b.dataset.aiMode === next; b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1; }
      chat.hidden = next !== 'chat';
      for (const [type, state] of Object.entries(states)) state.view.hidden = type !== next;
      if (next !== 'chat') { restore(next); providers(next); models(next, false); states[next].view.append(history); history.querySelector('[data-load-more]').hidden = !states[next].hasMore; renderTasks(); refresh(); }
      setTimeout(() => { if (!nav.contains(document.activeElement)) (next === 'chat' ? document.getElementById('ai-input') : field(next, 'prompt')).focus(); }, 120);
    }
    function open(next = 'chat') { UIAI.open(); switchMode(next); }
    nav.addEventListener('click', e => { const b = e.target.closest('[data-ai-mode]'); if (b) switchMode(b.dataset.aiMode); });
    nav.addEventListener('keydown', e => {
      const tabs = [...nav.querySelectorAll('[role=tab]')], i = tabs.indexOf(document.activeElement);
      if (i < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      e.preventDefault(); const n = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (i + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
      switchMode(tabs[n].dataset.aiMode); tabs[n].focus();
    });
    nav.querySelector('.ai-expand').addEventListener('click', e => { const expanded = panel.classList.toggle('is-expanded'); e.currentTarget.setAttribute('aria-pressed', String(expanded)); e.currentTarget.setAttribute('aria-label', expanded ? '还原面板' : '扩大面板'); });
    history.querySelector('[data-refresh]').addEventListener('click', () => { renderTasks(); refresh(); });
    history.querySelector('[data-load-more]').addEventListener('click', () => refresh(true));
    list.addEventListener('click', taskAction);
    list.addEventListener('click', e => {
      if (e.target.matches('img[role=button]') && e.target.src.startsWith('blob:')) {
        preview.querySelector('img').src = e.target.src; preview.showModal(); preview.querySelector('button').focus();
      }
    });
    list.addEventListener('keydown', e => { if (e.target.matches('img[role=button]') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); e.target.click(); } });
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 4000);
    window.addEventListener('pagehide', () => { disposed = true; clearInterval(timer); for (const promise of blobs.values()) promise.then(URL.revokeObjectURL).catch(() => {}); });
    const chatInput = document.getElementById('ai-input');
    chatInput.value = store.data.workspace?.chat?.prompt || '';
    chatInput.addEventListener('input', () => UIAI.saveDraft());
    return { open, async reference(source, type = 'image') { open(type); await addReferences(type, [source]); } };
  };
})();
