const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modPromise = import(pathToFileURL(path.join(__dirname, "../server/music-native.js")).href);

test("Kuwo encrypt matches TuneFree golden vector", async () => {
  const { kuwoEncrypt } = await modPromise;
  const params = "type=convert_url&br=128kmp3&format=mp3&sig=0&rid=2423984&network=wifi&response=url&prod=kwplayer_ar_10.3.3.0";
  const q = kuwoEncrypt(params).toString("base64");
  assert.equal(
    q,
    "18NsawlyRyRtNBB3YsCCYL6ViZJYU1V9YBbTxJJUSf9p8lacnpS0hlBvB+O3STOLkOQ9yIuZWZQZe7UvfQE6Zwn6AeQojd5MyPZr2iJoyOzi94OXIkC0yc+NwbIR+ERWTYsVc58LtjS25laWOGjchw==",
  );
});

test("QQ vkey filename and URL assembly", async () => {
  const { buildQqFilename, parseQqVkey } = await modPromise;
  assert.equal(buildQqFilename("MID", "128k"), "M500MIDMID.mp3");
  assert.equal(buildQqFilename("MID", "320k"), "M800MIDMID.mp3");
  assert.equal(buildQqFilename("MID", "flac"), "F000MIDMID.flac");
  assert.equal(parseQqVkey({
    queryvkey: { data: { sip: ["https://cdn.example.com/base/"], midurlinfo: [{ purl: "track/song.mp3?vkey=abc" }] } },
  }), "https://cdn.example.com/base/track/song.mp3?vkey=abc");
  assert.equal(parseQqVkey({
    queryvkey: { data: { sip: ["https://unused.example.com/"], midurlinfo: [{ purl: "https://audio.example.com/song.flac?token=1" }] } },
  }), "https://audio.example.com/song.flac?token=1");
  assert.throws(() => parseQqVkey({ queryvkey: { data: { midurlinfo: [{ purl: "" }] } } }), /VIP/);
});

test("Netease / Kuwo URL parsers reject VIP and keep query tokens", async () => {
  const { parseNeteaseUrl, parseKuwoUrl, encryptNeteaseParams } = await modPromise;
  assert.equal(
    parseNeteaseUrl({ data: [{ url: "https://m701.music.126.net/song.mp3?vuutv=abc" }] }),
    "https://m701.music.126.net/song.mp3?vuutv=abc",
  );
  assert.throws(() => parseNeteaseUrl({ data: [{ url: "" }] }), /VIP/);
  assert.throws(() => parseNeteaseUrl({ data: [{ url: "file:///etc/passwd" }] }), /VIP|protected/);
  assert.equal(
    parseKuwoUrl("format=mp3\r\nurl=http://audio.kwcdn.kuwo.cn/song.mp3?token=abc&expire=123\r\n"),
    "http://audio.kwcdn.kuwo.cn/song.mp3?token=abc&expire=123",
  );
  assert.throws(() => parseKuwoUrl("format=mp3\nbitrate=1\n"), /VIP/);
  const hex = encryptNeteaseParams("186016", "320k");
  assert.match(hex, /^[0-9A-F]+$/);
  assert.equal(hex.length % 32, 0);
});
