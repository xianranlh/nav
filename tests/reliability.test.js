const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('service worker bypasses private API, query credentials and range requests', () => {
  const handlers = {};
  const context = {
    URL, Response, location: new URL('https://nav.example/sw.js'),
    self: { addEventListener: (name, fn) => { handlers[name] = fn; } },
  };
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), context);
  for (const [path, headers] of [
    ['/api/knowledge/attachments/a_test', {}], ['/api/data', {}],
    ['/private.png?token=secret', {}], ['/image.png', { range: 'bytes=0-9' }],
  ]) {
    let handled = false;
    handlers.fetch({ request: new Request('https://nav.example' + path, { headers }), respondWith() { handled = true; } });
    assert.equal(handled, false, path);
  }
});

test('metadata blocks private addresses and validates redirects before fetching', async () => {
  const { isSafeHttpUrl, fetchSafeMetadata } = await import('../server/metadata.js');
  for (const url of ['http://127.2.3.4/', 'http://0.1.2.3/', 'http://[::ffff:7f00:1]/', 'http://[::]/', 'http://100.64.0.1/', 'http://user:pass@8.8.8.8/']) {
    assert.equal(await isSafeHttpUrl(url), false, url);
  }
  const calls = [];
  await assert.rejects(fetchSafeMetadata('https://public.example', {}, {
    validate: async (url) => !url.includes('127.0.0.1'),
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    },
  }), /unsafe url/);
  assert.equal(calls.length, 1);
});
