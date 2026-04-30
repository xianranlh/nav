const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  APP_STATE_KEY,
  SETTINGS_KEY,
  createStorageAdapter,
} = require("../js/storage-adapter.js");

function createMemoryStorage() {
  const data = new Map();

  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    has(key) {
      return data.has(key);
    },
  };
}

test("storage adapter centralizes app state and settings keys", () => {
  assert.equal(APP_STATE_KEY, "sakura_nav_v1");
  assert.equal(SETTINGS_KEY, "sakura_nav_settings_v1");

  const storage = createMemoryStorage();
  const adapter = createStorageAdapter(storage);
  const state = { groups: [{ id: "dev", name: "开发", links: [] }] };
  const settings = { theme: "dark", visualTheme: "paper" };

  adapter.writeAppState(state);
  adapter.writeSettings(settings);
  adapter.writeJson("sakura_nav_blog_v1", { posts: [{ id: "p1" }], adminMode: false });

  assert.deepEqual(adapter.readAppState(), state);
  assert.deepEqual(adapter.readSettings(), settings);
  assert.deepEqual(adapter.readJson("sakura_nav_blog_v1"), { posts: [{ id: "p1" }], adminMode: false });

  adapter.clearBusinessData();
  assert.equal(storage.has(APP_STATE_KEY), false);
  assert.equal(storage.has(SETTINGS_KEY), false);
});

test("blog module uses storage adapter for persisted posts", () => {
  const blog = fs.readFileSync("js/blog.js", "utf8");

  assert.match(blog, /SakuraStorageAdapter/);
  assert.doesNotMatch(blog, /localStorage\.(getItem|setItem|removeItem)\(/);
});

test("weather module uses storage adapter for persisted city data", () => {
  const weather = fs.readFileSync("js/weather.js", "utf8");

  assert.match(weather, /SakuraStorageAdapter/);
  assert.doesNotMatch(weather, /localStorage\.(getItem|setItem|removeItem)\(/);
});

test("calendar module uses storage adapter for persisted tasks", () => {
  const calendar = fs.readFileSync("js/calendar.js", "utf8");

  assert.match(calendar, /SakuraStorageAdapter/);
  assert.doesNotMatch(calendar, /localStorage\.(getItem|setItem|removeItem)\(/);
});

test("AI module uses storage adapter for settings and chat history", () => {
  const ai = fs.readFileSync("js/ai.js", "utf8");

  assert.match(ai, /SakuraStorageAdapter/);
  assert.doesNotMatch(ai, /localStorage\.(getItem|setItem|removeItem)\(/);
});

test("music module uses storage adapter for playlist metadata", () => {
  const music = fs.readFileSync("js/music.js", "utf8");

  assert.match(music, /SakuraStorageAdapter/);
  assert.doesNotMatch(music, /localStorage\.(getItem|setItem|removeItem)\(/);
});

test("sync module uses storage adapter for bundles and sync settings", () => {
  const sync = fs.readFileSync("js/sync.js", "utf8");

  assert.match(sync, /SakuraStorageAdapter/);
  assert.doesNotMatch(sync, /localStorage\.(getItem|setItem|removeItem)\(/);
});

test("app controller uses storage adapter instead of direct business localStorage calls", () => {
  const app = fs.readFileSync("js/app.js", "utf8");
  const index = fs.readFileSync("index.html", "utf8");
  const staticAssets = fs.readFileSync("js/static-assets.js", "utf8");
  const storageScriptIdx = index.indexOf('<script src="js/storage-adapter.js"></script>');
  const appScriptIdx = index.indexOf('<script src="js/app.js');

  assert.match(app, /SakuraStorageAdapter/);
  assert.doesNotMatch(app, /localStorage\.(getItem|setItem|removeItem)\(/);
  assert.ok(storageScriptIdx >= 0, "storage adapter should be loaded on the page");
  assert.ok(appScriptIdx > storageScriptIdx, "storage adapter should load before app.js");
  assert.match(staticAssets, /"js\/storage-adapter\.js"/);
});
