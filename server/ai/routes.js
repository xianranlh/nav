import path from 'node:path';
import { AIService } from './service.js';

export function registerAIRoutes(app, { auth, ...options }) {
  const service = new AIService(options);
  const route = fn => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { await fn(req, res, req.user.userId); }
    catch (e) { res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message || 'AI 服务错误' }); }
  };
  app.post('/api/ai/tasks', auth, route((req, res, user) => res.status(202).json(service.public(service.create(user, req.body)))));
  app.get('/api/ai/tasks', auth, route((req, res, user) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const type = ['image','video'].includes(req.query.type) ? req.query.type : '';
    res.json({ items: options.repo.list(user, limit, offset, type).map(t => service.public(t)), offset, limit });
  }));
  app.get('/api/ai/tasks/:id', auth, route((req, res, user) => res.json(service.public(service.get(req.params.id, user)))));
  app.post('/api/ai/tasks/:id/cancel', auth, route((req, res, user) => res.json(service.public(service.cancel(req.params.id, user)))));
  app.post('/api/ai/tasks/:id/retry', auth, route((req, res, user) => res.status(202).json(service.public(service.retry(req.params.id, user, req.body?.idempotencyKey)))));
  app.post('/api/ai/assets', auth, route(async (req, res, user) => {
    const asset = await service.saveAsset(user, req.body?.dataUrl);
    res.status(201).json({ id: asset.id, mime: asset.mime, url: '/api/ai/assets/' + asset.id + '/content' });
  }));
  app.get('/api/ai/assets/:id/content', auth, route((req, res, user) => {
    const asset = options.repo.asset(req.params.id, user);
    if (!asset) return res.status(404).json({ error: '素材不存在' });
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': asset.mime });
    if (req.query.download === '1') res.attachment(asset.filename);
    res.sendFile(path.join(service.directory, path.basename(asset.filename)));
  }));
  service.recover();
  return service;
}
