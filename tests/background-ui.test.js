const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_RANDOM_BG,
  MAX_UPLOAD_MB,
  buildBingUrl,
  cacheBust,
  formatFileSize,
  isVideoUrl,
  parseUrlList,
  uploadKindFromFile,
} = require("../js/background-ui.js");

test("background UI helpers normalize URL lists", () => {
  assert.deepEqual(
    parseUrlList(" https://a.example/a.jpg \n\n https://b.example/b.webp \r\n "),
    ["https://a.example/a.jpg", "https://b.example/b.webp"],
  );
  assert.deepEqual(parseUrlList(["  a  ", "", "b"]), ["a", "b"]);
  assert.deepEqual(parseUrlList(null), []);
});

test("background UI helpers detect video URLs without query/hash confusion", () => {
  assert.equal(isVideoUrl("https://cdn.example/bg.mp4"), true);
  assert.equal(isVideoUrl("https://cdn.example/bg.webm?token=1"), true);
  assert.equal(isVideoUrl("https://cdn.example/bg.mov#poster"), true);
  assert.equal(isVideoUrl("https://cdn.example/bg.jpg?format=mp4"), false);
  assert.equal(isVideoUrl(""), false);
});

test("background UI helpers format file sizes", () => {
  assert.equal(formatFileSize(undefined), "");
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatFileSize(2.5 * 1024 * 1024), "2.5 MB");
});

test("background UI helpers create cache-busted URLs", () => {
  assert.equal(cacheBust("", () => 123), "");
  assert.equal(cacheBust("https://img.example/a.jpg", () => 123), "https://img.example/a.jpg?_=123");
  assert.equal(cacheBust("https://img.example/a.jpg?x=1", () => 123), "https://img.example/a.jpg?x=1&_=123");
});

test("background UI helpers pick Bing wallpaper endpoints predictably", () => {
  assert.match(buildBingUrl(() => 0, () => 456), /^https:\/\/api\.dujin\.org\/bing\/1920\.php\?_=456$/);
  assert.match(buildBingUrl(() => 0.99, () => 456), /^https:\/\/bing\.img\.run\/1920x1080\.php\?_=456$/);
});

test("background UI helpers classify upload files", () => {
  assert.equal(DEFAULT_RANDOM_BG, "https://t.alcy.cc/ycy/");
  assert.equal(MAX_UPLOAD_MB, 60);
  assert.equal(uploadKindFromFile({ type: "video/mp4", name: "clip.bin" }), "video");
  assert.equal(uploadKindFromFile({ type: "", name: "clip.webm" }), "video");
  assert.equal(uploadKindFromFile({ type: "image/png", name: "cover.mp4.png" }), "image");
});
