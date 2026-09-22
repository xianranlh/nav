const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const input = (key = 'one', type = 'image') => ({ type, providerId: 'p', model: type === 'image' ? 'gpt-image-2' : 'grok-imagine-video', prompt: '海边日落', idempotencyKey: key, params: {} });
async function setup(t, overrides = {}) {
  const db = await import('../server/database.js');
  const { AIService } = await import('../server/ai/service.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-ai-test-'));
  db.openDatabase(directory);
  const settings = { providers: [{ id: 'p', baseUrl: 'https://example.com', apiKey: 'secret-key' }] };
  const service = new AIService({ repo: db.aiRepository, dataDir: directory, getSettings: () => settings,
    adapters: { image: async () => [{ dataUrl: PNG }], submitVideo: async () => 'remote-id', pollVideo: async () => [{ url: 'https://cdn.example/video.mp4' }] },
    pollMs: 2, timeoutMs: 1000, ...overrides });
  t.after(async () => { service.close(); await new Promise(r => setTimeout(r, 10)); db.closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { service, repo: db.aiRepository, directory, db };
}
async function waitFor(fn) {
  for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail('state transition timed out');
}

test('task receipt is idempotent; assets and task access are isolated by user', async t => {
  let calls = 0;
  const { service, repo } = await setup(t, { adapters: { image: async () => { calls++; return [{ dataUrl: PNG }]; } } });
  const task = service.create(1, input());
  assert.equal(service.create(1, input()).id, task.id);
  await waitFor(() => repo.get(task.id, 1).status === 'succeeded');
  assert.equal(calls, 1);
  const saved = repo.get(task.id, 1);
  assert.equal(saved.results.length, 1);
  assert.equal(repo.asset(saved.results[0].id, 2), null);
  assert.throws(() => service.get(task.id, 2), { status: 404 });
  assert.equal('pendingResults' in service.public(saved), false);
  assert.equal(JSON.stringify(saved).includes('secret-key'), false);
  assert.equal(await service.dataURL(saved.results[0].id, 1), PNG);
});

test('cancel before dispatch never calls upstream; cancel race cannot turn into success', async t => {
  let calls = 0, release;
  const { service, repo } = await setup(t, { adapters: { image: async () => { calls++; return new Promise(resolve => { release = resolve; }); } } });
  const queued = service.create(1, input('queued'));
  service.cancel(queued.id, 1);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(calls, 0);
  const task = service.create(1, input());
  await waitFor(() => release);
  service.cancel(task.id, 1); release([{ dataUrl: PNG }]);
  await waitFor(() => !service.running.size);
  assert.equal(repo.get(task.id, 1).status, 'cancelled');
  assert.equal(repo.get(task.id, 1).results.length, 0);
});

test('network failure is unknown and never automatically resubmitted; errors redact keys', async t => {
  let calls = 0;
  const { service, repo } = await setup(t, { adapters: { image: async () => { calls++; throw new Error('connection lost secret-key'); } } });
  const task = service.create(1, input());
  await waitFor(() => repo.get(task.id, 1).status === 'unknown');
  service.recover();
  assert.equal(calls, 1);
  assert.ok(!repo.get(task.id, 1).error.includes('secret-key'));
});

test('saved async video receipts resume polling without submitting again', async t => {
  let submissions = 0, polls = 0;
  const { service, repo } = await setup(t, { adapters: {
    submitVideo: async () => { submissions++; return 'unexpected'; },
    pollVideo: async () => { if (++polls < 2) throw new Error('temporary outage'); return [{ dataUrl: 'data:video/mp4;base64,AAAAHGZ0eXBpc29tAAAAAGlzb21pc28y' }]; },
  } });
  const persisted = { ...input('persist', 'video'), id: 'persisted', userId: 1, referenceIds: [], status: 'running', upstreamId: 'receipt', createdAt: Date.now(), results: [] };
  repo.save(persisted); service.recover();
  await waitFor(() => repo.get('persisted', 1).status === 'succeeded');
  assert.equal(submissions, 0); assert.equal(polls, 2);
  assert.equal(repo.get('persisted', 1).results[0].mime, 'video/mp4');
});

test('restart marks synchronous in-flight work unknown, resumes queued work', async t => {
  const { service, repo } = await setup(t);
  for (const status of ['running', 'submitting', 'queued']) repo.save({ ...input(status), id: status, userId: 1, referenceIds: [], status, createdAt: Date.now(), results: [] });
  service.recover();
  assert.equal(repo.get('running', 1).status, 'unknown');
  assert.equal(repo.get('submitting', 1).status, 'unknown');
  await waitFor(() => repo.get('queued', 1).status === 'succeeded');
});

test('saving retry downloads existing output without a new generation', async t => {
  let generations = 0, downloads = 0;
  const { service, repo } = await setup(t, {
    adapters: { image: async () => { generations++; return [{ url: 'https://cdn.example/image.png' }]; } },
    transport: async () => { if (++downloads === 1) throw new Error('download interrupted'); return new Response(Buffer.from(PNG.split(',')[1], 'base64'), { headers: { 'content-type': 'image/png' } }); },
  });
  const task = service.create(1, input());
  await waitFor(() => repo.get(task.id, 1).status === 'save_failed' && !service.running.size);
  const retried = service.retry(task.id, 1, 'retry');
  assert.equal(retried.id, task.id);
  await waitFor(() => repo.get(task.id, 1).status === 'succeeded');
  assert.equal(generations, 1); assert.equal(downloads, 2);
});

test('invalid protocols, cross-user references, excessive counts and unsupported video models fail before submission', async t => {
  const { service } = await setup(t);
  const asset = await service.saveAsset(2, PNG);
  assert.throws(() => service.create(1, { ...input(), referenceIds: [asset.id] }), /参考图不存在/);
  assert.throws(() => service.create(1, { ...input(), params: { n: 100 } }), /生成数量/);
  assert.throws(() => service.create(1, { ...input(), params: { apiMode: 'unknown' } }), /接口协议/);
  assert.throws(() => service.create(1, { ...input('video', 'video'), model: 'veo' }), /首期仅支持/);
  await assert.rejects(service.saveAsset(1, 'data:text/html;base64,PHNjcmlwdD4='), /素材类型/);
});

test('New API adapter uses video protocol fields and preserves reference input', async () => {
  const { createAdapters } = await import('../server/ai/adapters.js');
  const requests = [];
  const adapters = createAdapters(async (url, options) => {
    requests.push({ url, options });
    return Response.json(options.method === 'POST' ? { task_id: 'v1' } : { status: 'succeeded', url: 'https://example.com/video.mp4' });
  });
  const provider = { baseUrl: 'https://example.com/v1', apiKey: 'key' };
  const task = { model: 'grok-imagine-video', prompt: 'waves', params: { duration: 6, width: 1280, height: 720 }, upstreamId: 'v1' };
  assert.equal(await adapters.submitVideo(task, provider, [PNG]), 'v1');
  assert.equal(JSON.parse(requests[0].options.body).image, PNG);
  assert.equal(requests[0].url, 'https://example.com/v1/video/generations');
  assert.equal((await adapters.pollVideo(task, provider))[0].url, 'https://example.com/video.mp4');
  assert.equal(requests[1].url, 'https://example.com/v1/video/generations/v1');
});

test('image adapters keep Images, multipart edits, Gemini and Responses isolated', async () => {
  const { createAdapters } = await import('../server/ai/adapters.js');
  const requests = [], b64 = PNG.split(',')[1];
  const adapters = createAdapters(async (url, options) => {
    requests.push({ url, options });
    if (url.includes(':generateContent')) return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64 } }] } }] });
    if (url.endsWith('/responses')) return new Response('event: response.output_item.done\ndata: ' + JSON.stringify({ type: 'response.output_item.done', item: { type: 'image_generation_call', result: b64 } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    return Response.json({ data: [{ b64_json: b64 }] });
  });
  const provider = { baseUrl: 'https://example.com/v1', apiKey: 'key' };
  const task = { model: 'gpt-image-2', prompt: 'waves', params: { apiMode: 'images' } };
  assert.equal((await adapters.image(task, provider, [], undefined, {}))[0].dataUrl, PNG);
  await adapters.image(task, provider, [PNG], undefined, {});
  assert.ok(requests[1].options.body instanceof FormData);
  assert.equal(requests[1].options.body.getAll('image').length, 1);
  await adapters.image({ ...task, model: 'gemini-image', params: { apiMode: 'gemini' } }, provider, [PNG], undefined, {});
  const gemini = JSON.parse(requests[2].options.body);
  assert.equal(gemini.contents[0].parts[1].inlineData.data, b64);
  assert.equal((await adapters.image({ ...task, params: { apiMode: 'responses', textModel: 'text-driver' } }, provider, [], undefined, {}))[0].dataUrl, PNG);
  assert.equal(requests.length, 4);
});
