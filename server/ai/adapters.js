import createImageAPI from '../../js/ai-image-api.js';
import { setTimeout as delay } from 'node:timers/promises';
import { isSafeHttpUrl } from '../metadata.js';

export const baseURL = p => {
  const base = String(p.baseUrl || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return /\/v\d+(beta)?$/.test(base) ? base : base + '/v1';
};

// Validate every redirect. Never forward provider credentials to another origin.
export async function safeFetch(url, options = {}, maxBytes = 64 * 1024 * 1024) {
  const original = new URL(url);
  for (let i = 0; i < 5; i++) {
    if (!await isSafeHttpUrl(url)) throw new Error('请求地址不可用：仅支持公网 HTTP(S) 地址');
    const r = await fetch(url, { ...options, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.has('location')) {
      await r.body?.cancel();
      const next = new URL(r.headers.get('location'), url);
      if (next.origin !== original.origin && options.headers && Object.keys(options.headers).some(k => /authorization|api-key/i.test(k))) {
        throw new Error('供应商接口重定向到其他域名，请更新供应商地址');
      }
      url = next.href;
      continue;
    }
    if (+r.headers.get('content-length') > maxBytes) { await r.body?.cancel(); throw new Error('响应文件超过大小限制'); }
    let size = 0;
    const body = r.body?.pipeThrough(new TransformStream({ transform(chunk, ctrl) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error('响应文件超过大小限制');
      ctrl.enqueue(chunk);
    } }));
    return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
  }
  throw new Error('重定向次数过多');
}

function httpError(status, text) {
  let message = '上游请求失败';
  try { const j = JSON.parse(text); message = j.error?.message || j.message || message; } catch {}
  return Object.assign(new Error(`HTTP ${status}：${String(message).slice(0, 300)}`), { status });
}

export function createAdapters(transport = safeFetch) {
  const image = createImageAPI({
    fetch: transport, runtime: {}, console: { log() {}, warn() {}, error() {} },
    buildFetchTarget: (p, sub) => ({ url: baseURL(p) + '/' + sub, headers: { Authorization: 'Bearer ' + (p.apiKey || '') } }),
    buildHttpError: httpError,
    sleepWithSignal: (ms, signal) => delay(ms, undefined, { signal }),
    recordProbeOk() {}, recordProbeError() {}, recordCooldown() {},
    isCooldownError: () => false, cooldownSeconds: () => 0, isRetryableGatewayError: () => false,
  });
  async function json(p, sub, body, signal) {
    const r = await transport(baseURL(p) + sub, {
      method: body ? 'POST' : 'GET', signal,
      headers: { Authorization: 'Bearer ' + (p.apiKey || ''), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    if (!r.ok) throw httpError(r.status, text);
    try { return JSON.parse(text); } catch { throw new Error('上游未返回有效 JSON'); }
  }
  return {
    async image(task, provider, images, signal, hooks) {
      const opts = { ...task.params, provider: { ...provider, useProxy: false }, model: task.model,
        prompt: task.prompt, images, signal, upstreamId: task.upstreamId, ...hooks };
      if (images.length && opts.apiMode === 'dashscope') throw Object.assign(new Error('当前百炼适配器不支持图生图，请选择 Images 或 Gemini 协议'), { status: 400 });
      // Raw methods submit exactly once: no hidden retry or protocol fallback.
      return images.length && opts.apiMode !== 'gemini' ? image.imageEditRequest(opts) : image.imageRequest(opts);
    },
    async submitVideo(task, provider, images, signal) {
      const { duration, width, height } = task.params;
      const result = await json(provider, '/video/generations', {
        model: task.model, prompt: task.prompt, n: 1,
        ...(duration ? { duration } : {}), ...(width && height ? { width, height } : {}),
        ...(images[0] ? { image: images[0] } : {}),
      }, signal);
      const id = result.task_id || result.id || result.data?.task_id;
      if (!id) throw new Error('中转未返回视频任务 ID，提交结果未知');
      return String(id);
    },
    async pollVideo(task, provider, signal) {
      const raw = await json(provider, '/video/generations/' + encodeURIComponent(task.upstreamId), null, signal);
      const r = raw.data || raw;
      const status = String(r.status || '').toLowerCase();
      if (['failed', 'failure', 'cancelled', 'canceled', 'expired'].includes(status)) {
        throw Object.assign(new Error(r.error?.message || r.fail_reason || '视频生成失败'), { terminal: true });
      }
      if (['succeeded', 'success', 'completed'].includes(status)) {
        const url = r.url || r.result_url || r.video?.url;
        if (!url) throw Object.assign(new Error('视频任务完成但没有素材地址'), { terminal: true });
        return [{ url }];
      }
      return null;
    },
  };
}
