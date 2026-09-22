import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createAdapters, safeFetch } from './adapters.js';

export const activeStates = new Set(['queued', 'submitting', 'running', 'saving']);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const MIME = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'], ['image/avif', 'avif'], ['video/mp4', 'mp4'], ['video/webm', 'webm']]);

export class AIService {
  constructor({ repo, getSettings, dataDir, adapters = createAdapters(), transport = safeFetch, pollMs = 3000, timeoutMs = 30 * 60_000, publishImage = () => {} }) {
    Object.assign(this, { repo, getSettings, adapters, transport, pollMs, timeoutMs, publishImage });
    this.directory = path.join(dataDir, 'media', 'ai');
    this.running = new Map();
    this.queue = new Map();
    this.closed = false;
  }
  provider(userId, id) {
    const p = this.getSettings(userId)?.providers?.find(p => p.id === id);
    if (!p) throw fail('供应商不存在，请重新选择');
    if (!/^https?:\/\//.test(p.baseUrl)) throw fail('供应商地址须为 HTTP(S) URL');
    return p;
  }
  public(task) {
    const { userId, idempotencyKey, pendingResults, ...rest } = task;
    return rest;
  }
  get(id, userId) {
    const task = this.repo.get(id, userId);
    if (!task) throw fail('任务不存在', 404);
    return task;
  }
  create(userId, input) {
    if (!input || typeof input !== 'object') throw fail('任务参数无效');
    const { type, providerId, model, prompt, idempotencyKey, referenceIds = [] } = input;
    if (!['image', 'video'].includes(type)) throw fail('任务类型无效');
    if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 120) throw fail('缺少有效幂等键');
    const old = this.repo.byKey(idempotencyKey, userId);
    if (old) return old;
    this.provider(userId, providerId);
    if (typeof model !== 'string' || !model.trim() || model.length > 200) throw fail('请选择模型');
    if (type === 'video' && model !== 'grok-imagine-video') throw fail('首期仅支持 grok-imagine-video');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw fail('提示词须为 1–4000 字');
    if (!Array.isArray(referenceIds) || referenceIds.length > (type === 'video' ? 1 : 8)) throw fail('参考图数量超限');
    for (const id of referenceIds) {
      const asset = this.repo.asset(id, userId);
      if (!asset || !asset.mime.startsWith('image/')) throw fail('参考图不存在');
    }
    const p = input.params || {};
    const protocol = p.apiMode || (type === 'video' ? 'newapi' : 'images');
    if (!(type === 'video' ? ['newapi'] : ['images', 'responses', 'gemini', 'dashscope']).includes(protocol)) throw fail('不支持的接口协议');
    if (referenceIds.length && ['responses', 'dashscope'].includes(protocol)) throw fail('此协议暂不支持参考图，请使用 Images 或 Gemini');
    const params = { apiMode: protocol };
    if (type === 'image') {
      params.n = Number(p.n ?? 1);
      if (!Number.isInteger(params.n) || params.n < 1 || params.n > 8) throw fail('生成数量须为 1–8');
      params.size = String(p.size || '1024x1024');
      if (params.size !== 'auto' && !/^\d{2,4}x\d{2,4}$/.test(params.size)) throw fail('尺寸格式应为宽x高');
      if (params.size !== 'auto' && params.size.split('x').some(n => +n < 64 || +n > 4096)) throw fail('尺寸范围为 64–4096');
      params.quality = String(p.quality || 'auto');
      if (!['auto','low','medium','high','standard','hd'].includes(params.quality)) throw fail('质量参数无效');
      params.textModel = String(p.textModel || '').slice(0, 200);
    } else {
      for (const key of ['duration', 'width', 'height']) {
        if (p[key] !== undefined && p[key] !== '') {
          params[key] = Number(p[key]);
          if (!Number.isFinite(params[key]) || params[key] <= 0 || params[key] > (key === 'duration' ? 30 : 4096)) throw fail('视频参数超出范围');
        }
      }
      if (!!params.width !== !!params.height) throw fail('视频宽高需同时填写');
    }
    const task = this.repo.save({ id: randomUUID(), userId, type, providerId, model: model.trim(), prompt: prompt.trim(), params,
      referenceIds, idempotencyKey, status: 'queued', createdAt: Date.now(), results: [], error: null });
    this.kick(task);
    return task;
  }
  kick(task) {
    if (this.closed || this.running.has(task.id) || this.queue.has(task.id)) return;
    this.queue.set(task.id, task);
    queueMicrotask(() => this.pump());
  }
  pump() {
    if (this.closed) return;
    while (this.running.size < 2 && this.queue.size) {
    const [id, task] = this.queue.entries().next().value;
    this.queue.delete(id);
    if (this.repo.get(id, task.userId)?.status === 'cancelled') continue;
    const controller = new AbortController();
    this.running.set(task.id, controller);
    this.execute(task, controller).catch(() => {}).finally(() => { this.running.delete(task.id); this.pump(); });
    }
  }
  update(task, patch) {
    const saved = this.repo.get(task.id, task.userId);
    if (this.closed || !saved || saved.status === 'cancelled') return false;
    Object.assign(task, patch);
    this.repo.save(task);
    return true;
  }
  async execute(task, controller) {
    const timer = setTimeout(() => controller.abort(new Error('任务等待超时')), this.timeoutMs);
    try {
      if (this.repo.get(task.id, task.userId)?.status === 'cancelled') return;
      const provider = this.provider(task.userId, task.providerId);
      let results = task.pendingResults;
      if (!results) {
        const images = await Promise.all(task.referenceIds.map(id => this.dataURL(id, task.userId)));
        if (!this.update(task, { status: task.upstreamId ? 'running' : 'submitting', error: null })) return;
        if (task.type === 'video') {
          if (!task.upstreamId) {
            const upstreamId = await this.adapters.submitVideo(task, provider, images, controller.signal);
            if (!this.update(task, { upstreamId, status: 'running' })) return;
          }
          let failures = 0;
          while (!results) {
            controller.signal.throwIfAborted();
            try {
              results = await this.adapters.pollVideo(task, provider, controller.signal);
              failures = 0;
              if (!this.update(task, { error: null })) return;
            } catch (e) {
              if (e.terminal || e.status === 401 || e.status === 403 || e.status === 404) throw e;
              failures++;
              this.update(task, { error: '查询暂时失败，正在重试' });
            }
            if (!results) await delay(Math.min(this.pollMs * 2 ** Math.min(failures, 4), 30_000), undefined, { signal: controller.signal });
          }
        } else {
          this.update(task, { status: 'running' });
          results = await this.adapters.image(task, provider, images, controller.signal, {
            onSubmitted: upstreamId => this.update(task, { upstreamId }),
            onPartial: ({ b64 }) => { if (b64 && b64.length < 12 * 1024 * 1024) this.update(task, { preview: 'data:image/png;base64,' + b64 }); },
          });
        }
        if (!Array.isArray(results) || !results.length) throw new Error('上游未返回素材');
        if (!this.update(task, { pendingResults: results, status: 'saving' })) return;
      }
      for (let index = task.results.length; index < results.length; index++) {
        controller.signal.throwIfAborted();
        const source = results[index];
        const asset = await this.saveAsset(task.userId, source.dataUrl || source.url, task.type, controller.signal);
        if (this.closed || this.repo.get(task.id, task.userId)?.status === 'cancelled') return;
        if (task.type === 'image') await this.publishImage(asset, task);
        task.results.push({ id: asset.id, url: '/api/ai/assets/' + asset.id + '/content', mime: asset.mime, revisedPrompt: source.revisedPrompt || '', partial: !!(source.degraded || source.sourceEvent === 'partial') });
        this.update(task, { status: 'saving' });
      }
      this.update(task, { status: 'succeeded', pendingResults: null, preview: null, error: null, finishedAt: Date.now() });
    } catch (e) {
      if (this.closed) return;
      let message = String(e.message || '生成失败');
      const key = this.getSettings(task.userId)?.providers?.find(p => p.id === task.providerId)?.apiKey;
      if (key) message = message.split(key).join('[已隐藏]');
      const status = task.pendingResults ? 'save_failed' : e.terminal || (e.status >= 400 && e.status < 500) ? 'failed' : 'unknown';
      this.update(task, { status, error: message.slice(0, 400) });
    } finally { clearTimeout(timer); }
  }
  cancel(id, userId) {
    const task = this.get(id, userId);
    if (!activeStates.has(task.status)) return task;
    task.status = 'cancelled';
    task.error = task.upstreamId || this.running.has(id) ? '已停止本地执行或跟踪；上游可能仍继续生成' : '已取消排队';
    this.repo.save(task);
    this.queue.delete(id);
    this.running.get(id)?.abort();
    return task;
  }
  retry(id, userId, key) {
    const task = this.get(id, userId);
    if (activeStates.has(task.status) || this.running.has(id)) throw fail('任务仍在执行', 409);
    if (task.status === 'save_failed') {
      task.status = 'saving'; task.error = null; this.repo.save(task); this.kick(task); return task;
    }
    if (task.upstreamId && task.status !== 'succeeded' && task.status !== 'failed') {
      task.status = 'running'; task.error = null; this.repo.save(task); this.kick(task); return task;
    }
    const next = this.create(userId, { ...task, idempotencyKey: key });
    next.parentId = task.id; this.repo.save(next); return next;
  }
  recover() {
    for (const task of this.repo.active()) {
      if (task.status === 'queued' || task.upstreamId || task.pendingResults) this.kick(task);
      else this.repo.save({ ...task, status: 'unknown', error: '服务重启，无法确定上游结果；不会自动重复提交' });
    }
  }
  close() { this.closed = true; this.queue.clear(); for (const c of this.running.values()) c.abort(); }
  async dataURL(id, userId) {
    const a = this.repo.asset(id, userId);
    if (!a) throw fail('素材不存在', 404);
    return `data:${a.mime};base64,${(await fs.readFile(path.join(this.directory, a.filename))).toString('base64')}`;
  }
  async saveAsset(userId, source, type = 'image', signal) {
    const limit = (type === 'image' ? 20 : 200) * 1024 * 1024;
    let bytes, mime;
    if (typeof source !== 'string') throw fail('素材地址无效');
    if (source.startsWith('data:')) {
      const match = /^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(source);
      if (!match || match[2].length > limit * 1.4) throw fail('素材格式无效或超过大小限制');
      mime = match[1]; bytes = Buffer.from(match[2], 'base64');
    } else {
      const r = await this.transport(source, { signal: signal || AbortSignal.timeout(120_000) }, limit);
      if (!r.ok) throw fail('素材下载失败：HTTP ' + r.status, 502);
      mime = (r.headers.get('content-type') || '').split(';')[0];
      bytes = Buffer.from(await r.arrayBuffer());
    }
    if (!bytes.length || bytes.length > limit || !MIME.has(mime) || !mime.startsWith(type + '/')) throw fail('素材类型或大小不符合要求');
    const id = randomUUID();
    const filename = id + '.' + MIME.get(mime);
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(path.join(this.directory, filename), bytes);
    return this.repo.saveAsset({ id, userId, filename, mime, bytes: bytes.length, createdAt: Date.now() });
  }
}
