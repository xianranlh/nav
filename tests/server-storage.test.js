const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("requires the same-origin data API instead of falling back to browser storage", () => {
  const remote = fs.readFileSync("js/sakura-remote.js", "utf8");

  assert.match(remote, /const STORAGE_REQUIRED = true;/);
  assert.match(remote, /isRequired:\s*\(\)\s*=>\s*STORAGE_REQUIRED/);
  assert.doesNotMatch(remote, /回退为浏览器本地存储|回落到浏览器本地存储/);
});

test("purges legacy browser business keys after server storage is active", () => {
  const remote = fs.readFileSync("js/sakura-remote.js", "utf8");

  assert.match(remote, /function purgeLegacyBusinessStorage/);
  assert.match(remote, /realRemoveItem\.call\(window\.localStorage/);
  assert.match(remote, /if \(!interceptKey\(k\)\) continue;/);
  assert.match(remote, /_getBrowserLocalItem:\s*\(key\)\s*=>\s*realGetItem\.call\(window\.localStorage, key\)/);
  assert.match(remote, /_removeBrowserLocalItem:\s*\(key\)\s*=>\s*realRemoveItem\.call\(window\.localStorage, key\)/);
});

test("blocks app boot when required server storage is unavailable", () => {
  const app = fs.readFileSync("js/app.js", "utf8");

  assert.match(app, /function serverStorageUnavailable/);
  assert.match(app, /function showStorageUnavailable/);
  assert.match(app, /服务端存储不可用/);
});

test("does not store uploaded media in IndexedDB when server storage is required", () => {
  const app = fs.readFileSync("js/app.js", "utf8");
  const music = fs.readFileSync("js/music.js", "utf8");

  assert.match(app, /serverStorageRequired\(\)/);
  assert.match(app, /服务端背景上传失败，未写入浏览器/);
  assert.doesNotMatch(app, /已改存本浏览器|尝试本地/);

  assert.match(music, /serverStorageRequired\(\)/);
  assert.match(music, /服务端音乐上传失败，未写入浏览器/);
  assert.doesNotMatch(music, /改存本地/);
});
