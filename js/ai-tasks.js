/* Authenticated task client; contains no provider protocol or UI state. */
(function () {
  'use strict';
  async function request(path, body) {
    const response = await fetch('/api/ai/' + path, {
      credentials: 'same-origin', ...(body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '任务服务暂不可用');
    return data;
  }
  const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
  window.AITasks = {
    request, readFile,
    list: (offset = 0, type = '') => request('tasks?limit=30&offset=' + offset + '&type=' + encodeURIComponent(type)),
    create: data => request('tasks', data),
    async generate(options, edit = false) {
      options.signal?.throwIfAborted();
      const referenceIds = [];
      for (const source of options.images || []) referenceIds.push((await this.upload(typeof source === 'string' ? source : source.dataUrl)).id);
      const provider = options.provider;
      let apiMode = options.apiMode || (/aliyuncs|dashscope/.test(provider.baseUrl) ? 'dashscope' : /^gemini.*image/.test(options.model) ? 'gemini' : 'images');
      if (edit && apiMode === 'responses') apiMode = 'images';
      options.signal?.throwIfAborted();
      const task = await this.create({ type: 'image', providerId: provider.id, model: options.model, prompt: options.prompt || '编辑这张图片',
        referenceIds, idempotencyKey: crypto.randomUUID(), params: { apiMode, size: options.size, quality: options.quality, n: options.n, textModel: options.textModel } });
      const cancel = () => this.cancel(task.id).catch(() => {});
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        for (;;) {
          if (options.signal?.aborted) { cancel(); throw new DOMException('Aborted', 'AbortError'); }
          const t = await request('tasks/' + task.id);
          if (t.preview) options.onPartial?.({ b64: t.preview.split(',')[1] });
          if (t.status === 'succeeded') return await Promise.all(t.results.map(async a => {
            const r = await fetch(a.url); if (!r.ok) throw new Error('素材读取失败');
            return { dataUrl: await readFile(await r.blob()), revisedPrompt: a.revisedPrompt, sourceEvent: a.partial ? 'partial' : 'final' };
          }));
          if (!['queued','submitting','running','saving'].includes(t.status)) throw new Error(t.error || '任务未完成，可在生图记录中查看');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } finally { options.signal?.removeEventListener('abort', cancel); }
    },
    cancel: id => request('tasks/' + encodeURIComponent(id) + '/cancel', {}),
    retry: (id, key) => request('tasks/' + encodeURIComponent(id) + '/retry', { idempotencyKey: key }),
    async upload(source) {
      let dataUrl = source;
      if (source instanceof Blob) dataUrl = await readFile(source);
      else if (!String(source).startsWith('data:')) {
        const url = new URL(source, location.href);
        if (url.origin !== location.origin) throw new Error('请先下载外部参考图，再上传');
        const r = await fetch(url.href, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('参考图读取失败');
        dataUrl = await readFile(await r.blob());
      }
      return request('assets', { dataUrl });
    },
    async blobURL(url) {
      const target = new URL(url, location.href);
      if (target.origin !== location.origin || !target.pathname.startsWith('/api/ai/assets/')) throw new Error('素材地址无效');
      const r = await fetch(target.href, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('素材读取失败');
      return URL.createObjectURL(await r.blob());
    },
  };
})();
