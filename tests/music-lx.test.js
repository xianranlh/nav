const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modPromise = import(pathToFileURL(path.join(__dirname, "../server/music-lx.js")).href);

test("parses LX source script header comments", async () => {
  const { parseSourceHeader } = await modPromise;
  const meta = parseSourceHeader(`/**
 * @name 聚合API接口
 * @description v3 测试
 * @version 3.1
 * @author lerd
 */
const x = 1;
`);
  assert.equal(meta.name, "聚合API接口");
  assert.equal(meta.version, "3.1");
  assert.equal(meta.author, "lerd");
});

test("parses Kuwo single-quoted search payloads", async () => {
  const { parseRemoteJson, normalizeSearchBody } = await modPromise;
  const j = parseRemoteJson("{'TOTAL':'2','abslist':[{'MUSICRID':'MUSIC_99','SONGNAME':'晴天','ARTIST':'周杰伦','ALBUM':'叶惠美','DURATION':'269'}]}");
  assert.equal(j.abslist[0].SONGNAME, "晴天");
  const a = normalizeSearchBody(j, "kw");
  assert.equal(a.items[0].id, "99");
  assert.equal(a.items[0].name, "晴天");
});

test("fills HTTP API path templates", async () => {
  const { fillTemplate } = await modPromise;
  const url = fillTemplate("{base}/url/{source}/{id}/{quality}", {
    base: "https://api.example.com/",
    source: "kw",
    id: "123",
    quality: "320k",
  });
  assert.equal(url, "https://api.example.com/url/kw/123/320k");
});

test("normalizes mixed search payloads into TrackHit", async () => {
  const { normalizeSearchBody, normalizeUrlBody, normalizeLyricBody } = await modPromise;
  const a = normalizeSearchBody({
    abslist: [{ MUSICRID: "MUSIC_99", SONGNAME: "晴天", ARTIST: "周杰伦", ALBUM: "叶惠美", DURATION: 269 }],
  }, "kw");
  assert.equal(a.items[0].id, "99");
  assert.equal(a.items[0].name, "晴天");
  assert.equal(a.items[0].platform, "kw");

  const b = normalizeSearchBody({
    result: { songs: [{ id: 1, name: "七里香", artists: [{ name: "周杰伦" }], album: { name: "七里香" }, duration: 180000 }] },
  }, "wy");
  assert.equal(b.items[0].artists, "周杰伦");

  assert.equal(normalizeUrlBody({ code: 200, data: { url: "https://cdn.example/a.mp3" } }), "https://cdn.example/a.mp3");
  assert.equal(normalizeUrlBody("https://cdn.example/b.mp3"), "https://cdn.example/b.mp3");
  assert.match(normalizeLyricBody({ data: { lyric: "[00:01.00]hi" } }), /\[00:01/);
});

test("normalizes NetEase / Kuwo / lrclib lyric payloads", async () => {
  const { normalizeLyricBody, kuwoListToLrc } = await modPromise;

  const wy = normalizeLyricBody({ lrc: { lyric: "[00:09.36]晴天" }, tlyric: { lyric: "[00:09.36]Sunny" } });
  assert.match(wy, /\[00:09\.36\]晴天/);

  const kw = kuwoListToLrc([
    { time: 9.36, lineLyric: "晴天" },
    { time: 12, lineLyric: "//" },
    { time: 15.5, lineLyric: "故事的小黄花" },
  ]);
  assert.match(kw, /\[00:09\.36\]晴天/);
  assert.match(kw, /\[00:15\.50\]故事的小黄花/);
  assert.doesNotMatch(kw, /\/\//);

  const fromKwApi = normalizeLyricBody({ data: { lrclist: [{ time: 1, lineLyric: "hi" }] } });
  assert.match(fromKwApi, /\[00:01\.00\]hi/);

  const lib = normalizeLyricBody({ syncedLyrics: "[00:02.00]synced", plainLyrics: "plain" });
  assert.match(lib, /\[00:02\.00\]synced/);
});

test("parses AIMP / M3U / PLS playlists and keeps remote vs local", async () => {
  const { parsePlaylist } = await modPromise;

  const aimp = parsePlaylist(`#-----SUMMARY-----#
Name=夜车
#-----CONTENT-----#
-%
File1=https://ex.com/a.mp3
Title1=晴天
Artist1=周杰伦
Album1=叶惠美
File2=C:\\Music\\local.flac
Title2=本地歌
`, "fav.aimppl4");
  assert.equal(aimp.name, "夜车");
  assert.equal(aimp.tracks.length, 2);
  assert.equal(aimp.tracks[0].url, "https://ex.com/a.mp3");
  assert.equal(aimp.tracks[0].name, "晴天");
  assert.equal(aimp.tracks[1].url, "");
  assert.match(aimp.tracks[1].localPath, /local\.flac/);

  const m3u = parsePlaylist(`#EXTM3U
#PLAYLIST:通勤
#EXTINF:180,Artist - Song
https://ex.com/b.mp3
#EXTINF:90,Only Local
D:\\Music\\c.mp3
`, "list.m3u");
  assert.equal(m3u.name, "通勤");
  assert.equal(m3u.tracks[0].url, "https://ex.com/b.mp3");
  assert.equal(m3u.tracks[1].localPath.includes("c.mp3"), true);

  const pls = parsePlaylist(`[playlist]
File1=https://ex.com/d.mp3
Title1=Hello
NumberOfEntries=1
`, "x.pls");
  assert.equal(pls.tracks[0].name, "Hello");
});

test("LX runtime boots a minimal official-style source script", async () => {
  const { probeLxScript } = await modPromise;
  const script = `
    const { EVENT_NAMES, on, send } = globalThis.lx;
    send(EVENT_NAMES.inited, {
      sources: { kw: { name: "酷我", type: "music", actions: ["musicUrl"], qualitys: ["128k", "320k"] } }
    });
    on(EVENT_NAMES.request, ({ action }) => {
      if (action === "musicUrl") return "https://cdn.example/song.mp3";
    });
  `;
  const { inited, runtime } = await probeLxScript(script, async () => true);
  assert.equal(inited.sources.kw.name, "酷我");
  const url = await runtime.requestAction({
    source: "kw",
    action: "musicUrl",
    info: { type: "320k", musicInfo: { songmid: "1", name: "x" } },
  });
  assert.equal(url, "https://cdn.example/song.mp3");
  runtime.dispose();
});

test("Dockerfile copies music runtime and still excludes bundled lx-sources", () => {
  const dockerfile = fs.readFileSync("deploy/Dockerfile", "utf8");
  assert.match(dockerfile, /music-lx\.js/);
  assert.doesNotMatch(dockerfile, /lx-sources/);
});

test("LX request callback matches official (err, resp, body) and returns cancel", async () => {
  const { probeLxScript } = await modPromise;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ url: "https://cdn.example/song.mp3" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  try {
    const script = `
      const { EVENT_NAMES, on, send, request } = globalThis.lx;
      send(EVENT_NAMES.inited, {
        sources: { kw: { name: "酷我", type: "music", actions: ["musicUrl"], qualitys: ["128k"] } }
      });
      on(EVENT_NAMES.request, () => new Promise((resolve, reject) => {
        const cancel = request("https://example.com/u", { method: "GET" }, (err, resp, body) => {
          if (err) return reject(err);
          if (typeof cancel !== "function") return reject(new Error("request should return cancel fn"));
          if (body === undefined) return reject(new Error("missing body arg"));
          resolve((body && body.url) || (resp && resp.body && resp.body.url));
        });
      }));
    `;
    const { runtime } = await probeLxScript(script, async () => true);
    const url = await runtime.requestAction({
      source: "kw",
      action: "musicUrl",
      info: { type: "128k", musicInfo: { songmid: "1", name: "x" } },
    });
    assert.equal(url, "https://cdn.example/song.mp3");
    runtime.dispose();
  } finally {
    globalThis.fetch = orig;
  }
});

test("LX runtime lets scripts bind console.log", async () => {
  const { probeLxScript } = await modPromise;
  const script = `
    const { EVENT_NAMES, on, send } = globalThis.lx;
    send(EVENT_NAMES.inited, {
      sources: { kw: { name: "酷我", type: "music", actions: ["musicUrl"], qualitys: ["128k"] } }
    });
    on(EVENT_NAMES.request, () => {
      const log = console.log.bind(console);
      log("ok");
      return "https://cdn.example/ok.mp3";
    });
  `;
  const { runtime } = await probeLxScript(script, async () => true);
  const url = await runtime.requestAction({
    source: "kw",
    action: "musicUrl",
    info: { type: "128k", musicInfo: { songmid: "1" } },
  });
  assert.equal(url, "https://cdn.example/ok.mp3");
  runtime.dispose();
});

test("LX runtime binds context functions the way obfuscated sources do", async () => {
  const { probeLxScript } = await modPromise;
  const script = `
    const { EVENT_NAMES, on, send } = globalThis.lx;
    const bindCall = Object.call.bind(Function.prototype.bind);
    send(EVENT_NAMES.inited, {
      sources: { kw: { name: "酷我", type: "music", actions: ["musicUrl"], qualitys: ["128k"] } }
    });
    on(EVENT_NAMES.request, () => {
      const fn = bindCall(function () { return this.url; }, { url: "https://cdn.example/ok.mp3" });
      return fn();
    });
  `;
  const { runtime } = await probeLxScript(script, async () => true);
  const url = await runtime.requestAction({
    source: "kw",
    action: "musicUrl",
    info: { type: "128k", musicInfo: { songmid: "1", name: "x" } },
  });
  assert.equal(url, "https://cdn.example/ok.mp3");
  runtime.dispose();
});

test("LX utils expose zlib inflate/deflate", async () => {
  const { probeLxScript } = await modPromise;
  const script = `
    const { EVENT_NAMES, on, send, utils } = globalThis.lx;
    send(EVENT_NAMES.inited, {
      sources: { kw: { name: "酷我", type: "music", actions: ["musicUrl"], qualitys: ["128k"] } }
    });
    on(EVENT_NAMES.request, async () => {
      if (typeof utils.zlib.deflate !== "function") throw new Error("no zlib");
      const z = await utils.zlib.deflate(utils.buffer.from("hi"));
      const raw = await utils.zlib.inflate(z);
      if (utils.buffer.bufToString(raw, "utf8") !== "hi") throw new Error("zlib roundtrip");
      return "https://cdn.example/ok.mp3";
    });
  `;
  const { runtime } = await probeLxScript(script, async () => true);
  const url = await runtime.requestAction({
    source: "kw",
    action: "musicUrl",
    info: { type: "128k", musicInfo: { songmid: "1" } },
  });
  assert.equal(url, "https://cdn.example/ok.mp3");
  runtime.dispose();
});
