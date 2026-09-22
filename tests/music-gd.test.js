const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modPromise = import(pathToFileURL(path.join(__dirname, "../server/music-gd.js")).href);

test("GD signature matches TuneFree (name encoded once, last 8 hex upper)", async () => {
  const { buildGdRequestBody } = await modPromise;
  const body = buildGdRequestBody({
    types: "search", source: "qq", name: "林俊杰", count: 20, pages: 1,
  }, 1_783_745_000_000);
  const signature = crypto.createHash("md5")
    .update("178374500|music.gdstudio.org|20260616|%E6%9E%97%E4%BF%8A%E6%9D%B0")
    .digest("hex")
    .slice(-8)
    .toUpperCase();
  assert.equal(body.get("name"), "林俊杰");
  assert.equal(body.get("source"), "tencent");
  assert.equal(body.get("s"), signature);
  assert.equal(body.toString().includes("%25E6"), false);
});

test("GD bitrate and platform mapping follow TuneFree", async () => {
  const { gdBitrate, toGdApiSource, fromGdApiSource, gdCan, classifyGdFailure } = await modPromise;
  assert.equal(gdBitrate("128k"), "128");
  assert.equal(gdBitrate("320k"), "320");
  assert.equal(gdBitrate("flac"), "740");
  assert.equal(gdBitrate("flac24bit"), "999");
  assert.equal(toGdApiSource("wy"), "netease");
  assert.equal(toGdApiSource("tx"), "tencent");
  assert.equal(fromGdApiSource("netease"), "wy");
  assert.equal(gdCan("wy", "musicUrl"), true);
  assert.equal(gdCan("kw", "musicUrl"), false);
  assert.equal(gdCan("joox", "search"), true);
  assert.equal(classifyGdFailure(400, "Value of source is not supported."), "UNSUPPORTED_SOURCE");
  assert.equal(classifyGdFailure(429, "Too many requests"), "RATE_LIMIT");
});

test("GD search rows normalize into nav TrackHit", async () => {
  const { normalizeGdTrack, publicGdSource } = await modPromise;
  const hit = normalizeGdTrack("netease", {
    id: "123", name: "晴天", artist: ["周杰伦"], album: "叶惠美", url_id: "123", lyric_id: "123",
  });
  assert.equal(hit.platform, "wy");
  assert.equal(hit.id, "123");
  assert.equal(hit.artists, "周杰伦");
  const pub = publicGdSource(true);
  assert.equal(pub.builtin, true);
  assert.equal(pub.id, "builtin-gd");
  assert.ok(pub.platforms.wy.actions.includes("musicUrl"));
  assert.equal(pub.platforms.kw.qualitys.length, 0);
});
