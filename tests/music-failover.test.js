const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const modPromise = import(pathToFileURL(path.join(__dirname, '../server/music-lx.js')).href);

async function fixture(t, sources = [], builtins = {}) {
  const mod = await modPromise;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-music-failover-'));
  const userId = Math.floor(Math.random() * 1e9);
  const dir = path.join(root, 'music-sources', String(userId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '_builtins.json'), JSON.stringify({ 'builtin-gd': false, 'builtin-native': false, ...builtins }));
  for (const source of sources) fs.writeFileSync(path.join(dir, source.id + '.json'), JSON.stringify(source));
  const routes = new Map();
  const app = { get(url, ...handlers) { routes.set(url, handlers.at(-1)); }, post() {}, patch() {}, delete() {} };
  mod.registerMusicRoutes(app, { auth() {}, dataDir: root, isSafeHttpUrl: async () => true });
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }); });
  return {
    ...mod,
    async request(route, query) {
      let status = 200, body;
      const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
      await routes.get(route)({ user: { userId }, query }, res);
      return { status, body };
    },
  };
}
const source = (id, extra = {}) => ({ id, name: id, type: 'http-api', enabled: true, apiBase: 'https://example.com', urlPath: '{base}/' + id + '?quality={quality}', ...extra });
const reply = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('expired providers are skipped and playback resolves from an enabled backup', async t => {
  const f = await fixture(t, [source('expired1', { updateAlert: { log: '当前源脚本版本过低(v5)，请下载最新版本(v6)' } }), source('backup01')]);
  const calls = [];
  global.fetch = async url => { calls.push(String(url)); return reply({ url: 'https://cdn.example.com/song.mp3' }); };
  const r = await f.request('/api/music/url', { platform: 'kw', id: '101', nofallback: '1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.sourceId, 'backup01');
  assert.ok(calls.every(url => url.includes('backup01')));
  assert.equal(f.sourceExpiryReason({ log: '发现新版，可以选择更新' }), '');
});

test('a playback-rejected source is excluded from both cached and fresh resolution', async t => {
  const f = await fixture(t, [source('source01'), source('source02')]);
  global.fetch = async url => reply({ url: 'https://cdn.example.com/' + (String(url).includes('source01') ? 'one' : 'two') + '.mp3' });
  const query = { platform: 'kw', id: '202', nofallback: '1' };
  const first = await f.request('/api/music/url', query);
  const second = await f.request('/api/music/url', { ...query, excludeSourceId: first.body.sourceId });
  assert.equal(second.body.ok, true);
  assert.notEqual(second.body.sourceId, first.body.sourceId);
  const exhausted = await f.request('/api/music/url', { ...query, excludeSourceId: 'source01,source02' });
  assert.equal(exhausted.body.code, 'sources_unavailable');
});

test('disabled builtins are not silently retried by cross-platform fallback', async t => {
  const f = await fixture(t, [source('broken01')]);
  const calls = [];
  global.fetch = async url => { calls.push(String(url)); return reply({}); };
  const r = await f.request('/api/music/url', { platform: 'kw', id: '303', name: '测试歌曲', artists: '测试歌手' });
  assert.equal(r.status, 502);
  assert.ok(calls.length > 0);
  assert.ok(calls.every(url => url.startsWith('https://example.com/broken01')));
});

test('URL/local tracks can fetch existing platform lyrics by exact song and artist', async t => {
  const f = await fixture(t);
  global.fetch = async url => {
    if (String(url).includes('lrclib.net')) return reply([
      { trackName: '测试歌曲 Live', artistName: '测试歌手', syncedLyrics: '[00:01.00]不应选用的现场版' },
      { trackName: '测试歌曲', artistName: '测试歌手', syncedLyrics: '[00:01.00]平台歌词' },
    ]);
    return reply({});
  };
  const r = await f.request('/api/music/lyric', { name: '测试歌曲', artists: '测试歌手' });
  assert.equal(r.status, 200);
  assert.equal(r.body.lrc, '[00:01.00]平台歌词');
  assert.equal(f.isMatchingLyricTrack({ name: '测试歌曲', artists: '另一位歌手' }, { name: '测试歌曲', artists: '测试歌手' }), false);
});

test('translated subtitles and multiple artists fall back to a matching short-title result and lower bitrate', async t => {
  const f = await fixture(t, [], { 'builtin-gd': true });
  const searches = [], resolutions = [];
  const title = '唯有追赶风的方向';
  const artists = ['知更鸟', 'HOYO-MiX', 'Chevy'];
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/time')) return new Response(String(Date.now() / 1000));
    if (!String(url).includes('music-api.gdstudio.xyz/api.php')) return reply({});
    const params = new URLSearchParams(init.body);
    if (params.get('types') === 'search') {
      searches.push(params.get('name'));
      return reply(params.get('name') === title ? [
        { id: 'cover', name: title, artist: ['翻唱歌手'] },
        { id: 'instrumental', name: title + ' (和声伴奏)', artist: artists },
        { id: 'correct', name: title, artist: artists },
      ] : []);
    }
    if (params.get('types') === 'url') {
      resolutions.push([params.get('id'), params.get('br')]);
      return reply(params.get('br') === '128' ? { url: 'https://cdn.example.com/matching.mp3' } : {});
    }
    if (params.get('types') === 'lyric') return reply({ lyric: params.get('id') === 'correct' ? '[00:01.00]已有平台歌词' : '' });
    return reply({});
  };
  const query = { platform: 'kw', id: '639783504', quality: '320k', name: title + ' (Only By Chasing the Wind)', artists: artists.join('&') };
  const playback = await f.request('/api/music/url', query);
  assert.equal(playback.status, 200);
  assert.equal(playback.body.sourceId, 'builtin-gd');
  assert.equal(playback.body.fallbackFrom, 'kw');
  assert.equal(playback.body.quality, '128k');
  assert.deepEqual(searches, [query.name + ' ' + query.artists, title]);
  assert.deepEqual(resolutions, [['correct', '320'], ['correct', '128']]);
  const lyric = await f.request('/api/music/lyric', query);
  assert.equal(lyric.body.lrc, '[00:01.00]已有平台歌词');
});

test('cross-platform matching preserves live, instrumental and language variants', async t => {
  const f = await fixture(t);
  const meta = { name: '测试歌曲', artists: '测试歌手' };
  for (const name of ['测试歌曲 (Live)', '测试歌曲 (伴奏)', '测试歌曲 (英文版)', '测试歌曲 (Remix)']) {
    assert.equal(f.isLikelySameSong({ ...meta, name }, meta), false, name);
    assert.equal(f.isMatchingLyricTrack({ ...meta, name }, meta), false, name);
  }
  assert.equal(f.isMatchingLyricTrack({ ...meta, name: '测试歌曲 (Song Translation)' }, meta), true);
});
