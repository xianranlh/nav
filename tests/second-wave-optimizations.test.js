const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("second-wave helper modules expose focused pure contracts", async () => {
  const AppModules = require("../js/app-modules.js");
  const MediaCleanup = require("../js/media-cleanup.js");
  const AIActions = require("../js/ai-actions.js");
  const CommandPalette = require("../js/command-palette.js");
  const DataVersioning = require("../js/data-versioning.js");
  const LazyInit = require("../js/lazy-init.js");
  const A11y = require("../js/a11y.js");

  const registry = AppModules.createAppModuleRegistry();
  assert.deepEqual(
    registry.list().map((module) => module.id),
    ["bootstrap", "navigation", "settings", "background", "calendar", "ai", "storage", "sync", "weather"],
  );
  assert.match(AppModules.renderModuleBoundarySummary(registry.list()), /app-module-boundaries/);

  const bundle = {
    settings: { bgUpload: { remoteUrl: "/api/media/file/bg/home.png" } },
    nav: { groups: [{ bg: { url: "/api/media/file/bg/group.webp" }, links: [{ bg: { url: "/api/media/file/bg/card.jpg" } }] }] },
    music: { tracks: [{ url: "/api/media/file/music/song.mp3", lrcUrl: "/api/media/file/lrc/song.lrc" }] },
  };
  const refs = MediaCleanup.collectReferencedMedia(bundle);
  assert.equal(refs.has("bg/home.png"), true);
  assert.equal(refs.has("music/song.mp3"), true);
  const classified = MediaCleanup.classifyOrphanMedia({
    bg: [{ filename: "home.png" }, { filename: "stale.png" }],
    music: [{ filename: "song.mp3" }],
    lrc: [{ filename: "old.lrc" }],
  }, refs);
  assert.deepEqual(classified.orphans.map((item) => `${item.category}/${item.filename}`), ["bg/stale.png", "lrc/old.lrc"]);
  assert.deepEqual(MediaCleanup.buildDeletePayload(classified.orphans), {
    items: [
      { category: "bg", filename: "stale.png" },
      { category: "lrc", filename: "old.lrc" },
    ],
  });

  const navState = { groups: [{ id: "g1", name: "AI", links: [] }] };
  const actionPreview = AIActions.previewActions([{ op: "add_link", group: "AI", name: "OpenAI", url: "https://openai.com" }], navState);
  assert.equal(actionPreview.changes[0].type, "add");
  assert.match(AIActions.renderActionPreview(actionPreview), /ai-action-preview/);
  const snapshot = AIActions.snapshotState(navState);
  navState.groups[0].links.push({ name: "mutated" });
  AIActions.rollbackState(navState, snapshot);
  assert.equal(navState.groups[0].links.length, 0);

  const commands = CommandPalette.buildCommands({
    groups: navState.groups,
    settings: { showWeather: true },
  });
  assert.ok(commands.some((command) => command.id === "open-settings"));
  assert.ok(commands.some((command) => command.id === "add-link"));
  assert.equal(CommandPalette.filterCommands(commands, "AI")[0].id, "group:g1");
  assert.match(CommandPalette.renderCommandPalette(commands.slice(0, 2)), /command-palette/);

  const before = DataVersioning.summarizeBundle({ nav: { groups: [] }, calendar: { tasks: [] } });
  const after = DataVersioning.summarizeBundle({ nav: { groups: [{ links: [{}, {}] }] }, calendar: { tasks: [{}] } });
  const diff = DataVersioning.diffBundleSummary(before, after);
  assert.equal(diff.categories.nav.delta.items, 3);
  assert.ok(DataVersioning.categoryKeys.includes("settings"));

  const lazy = LazyInit.createLazyInitializer();
  let runs = 0;
  assert.equal(lazy.runOnce("calendar", () => ++runs), 1);
  assert.equal(lazy.runOnce("calendar", () => ++runs), 1);
  assert.equal(lazy.has("calendar"), true);

  const audit = A11y.buttonLabelAudit('<button id="bad"></button><button aria-label="保存"></button>');
  assert.equal(audit.missing.length, 1);
  assert.match(A11y.focusableSelector, /button/);
});

test("second-wave assets and app shell are wired before the main controller", () => {
  const assets = require("../js/static-assets.js");
  const index = fs.readFileSync("index.html", "utf8");
  const app = fs.readFileSync("js/app.js", "utf8");

  for (const src of [
    "js/app-modules.js",
    "js/media-cleanup.js",
    "js/ai-actions.js",
    "js/command-palette.js",
    "js/data-versioning.js",
    "js/lazy-init.js",
    "js/a11y.js",
  ]) {
    assert.ok(assets.scripts.includes(src), `${src} should be precached`);
    assert.ok(index.indexOf(`<script src="${src}"></script>`) >= 0, `${src} should load in index.html`);
    assert.ok(
      index.indexOf(`<script src="${src}"></script>`) < index.indexOf('<script src="js/app.js'),
      `${src} should load before app.js`,
    );
  }

  for (const globalName of [
    "HomepageAppModules",
    "HomepageMediaCleanup",
    "HomepageAIActions",
    "HomepageCommandPalette",
    "HomepageDataVersioning",
    "HomepageLazyInit",
    "HomepageA11y",
  ]) {
    assert.match(app, new RegExp(globalName), `${globalName} should be referenced by app.js`);
  }
});

test("server exposes media cleanup and snapshot category restore endpoints", () => {
  const server = fs.readFileSync("server/index.js", "utf8");
  const database = fs.readFileSync("server/database.js", "utf8");

  assert.match(server, /app\.get\("\/api\/media\/orphans"/);
  assert.match(server, /app\.post\("\/api\/media\/orphans\/delete"/);
  assert.match(server, /collectReferencedMedia/);
  assert.match(server, /app\.get\("\/api\/snapshots\/:id\/compare"/);
  assert.match(server, /app\.post\("\/api\/snapshots\/:id\/restore-category"/);
  assert.match(database, /compareDataSnapshot/);
  assert.match(database, /restoreDataSnapshotCategory/);
  assert.match(database, /summarizeDataBundle/);
});

test("browser smoke and documentation cover the expanded maintenance surface", () => {
  const smoke = fs.readFileSync("scripts/smoke-browser.js", "utf8");
  const backlog = fs.readFileSync("docs/OPTIMIZATION-BACKLOG.md", "utf8");

  assert.match(smoke, /\/api\/data/);
  assert.match(smoke, /btn-settings/);
  assert.match(smoke, /btn-theme/);
  assert.match(smoke, /music-fab/);
  assert.match(smoke, /ai-fab/);
  assert.match(smoke, /calendar-panel/);
  assert.match(smoke, /command-palette/);

  for (const doc of [
    "docs/ARCHITECTURE.md",
    "docs/STORAGE.md",
    "docs/DEPLOYMENT.md",
    "docs/FEATURES.md",
    "docs/TESTING.md",
  ]) {
    assert.ok(fs.existsSync(doc), `${doc} should exist`);
    assert.ok(fs.readFileSync(doc, "utf8").trim().length > 200, `${doc} should contain useful guidance`);
  }

  for (const item of [
    "继续拆分 `js/app.js`",
    "媒体清理增强",
    "浏览器端冒烟测试继续扩展",
    "设置弹窗可访问性",
    "性能优化",
    "文档精简",
    "AI 操作预览与回滚",
    "命令面板",
    "服务端数据版本ing",
    "插件生命周期接口",
  ]) {
    assert.match(backlog, new RegExp(`- \\[x\\] ${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});
