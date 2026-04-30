const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("AI gallery helpers collect generated images with source prompts", () => {
  const Gallery = require("../js/ai-gallery.js");
  const messages = [
    { role: "user", content: "画一张樱花导航背景", ts: 1 },
    { role: "assistant", content: '```json\n{"data":[{"url":"https://img.example/sakura.png","revised_prompt":"soft sakura"}]}\n```', ts: 2 },
    { role: "user", content: "再来一张暗色版", ts: 3 },
    { role: "assistant", content: "![暗色](data:image/png;base64,abc123)", ts: 4 },
  ];

  const items = Gallery.collectGalleryImages(messages);

  assert.equal(items.length, 2);
  assert.equal(items[0].prompt, "画一张樱花导航背景");
  assert.equal(items[0].alt, "soft sakura");
  assert.equal(items[1].prompt, "再来一张暗色版");
  assert.match(Gallery.renderGallery(items), /data-ai-gallery-regenerate/);
  assert.match(Gallery.buildRegeneratePrompt(items[0]), /参考这张图/);
});

test("smart search ranks links across name, url, desc, tags, and group", () => {
  const Search = require("../js/smart-search.js");
  const groups = [
    { name: "AI 工具", links: [{ id: "chatgpt", name: "ChatGPT", url: "https://chat.openai.com", desc: "写作和编程助手", tags: ["智能体"] }] },
    { name: "阅读", links: [{ id: "book", name: "书架", url: "https://books.example", desc: "电子书", tags: [] }] },
  ];

  const ranked = Search.rankLinks(groups, "智能体");

  assert.equal(ranked[0].link.id, "chatgpt");
  assert.ok(ranked[0].score > 0);
  assert.equal(Search.matchesLink(groups[0].links[0], groups[0], "openai"), true);
});

test("navigation insights normalize tags and summarize link health", () => {
  const Nav = require("../js/nav-insights.js");
  const link = { name: "Docs", url: "https://docs.example", tags: " docs, api  导航 " };

  assert.deepEqual(Nav.normalizeTags(link.tags), ["docs", "api", "导航"]);
  Nav.applyLinkHealth(link, { url: link.url, ok: false, status: 404, checkedAt: 1000 });
  assert.equal(Nav.healthClass(link), "dead");
  assert.match(Nav.healthLabel(link), /404/);
  assert.deepEqual(
    Nav.buildLinkCheckPayload([{ links: [link] }], 1),
    { urls: ["https://docs.example"] },
  );
});

test("calendar planner creates week ranges and linked task summaries", () => {
  const Planner = require("../js/calendar-planner.js");
  const range = Planner.weekRange(new Date("2026-04-30T12:00:00"), 1);
  const items = [
    { task: { id: "t1", title: "读文档", desc: "https://docs.example" }, ts: new Date("2026-04-30T09:00:00").getTime() },
  ];

  assert.equal(range.days.length, 7);
  assert.equal(range.days[0].getDay(), 1);
  assert.equal(Planner.groupOccurrencesByDay(items, range.days).get(Planner.dayKey(range.days[3])).length, 1);
  assert.deepEqual(Planner.taskLinks(items[0].task), ["https://docs.example"]);
});

test("theme editor validates custom theme drafts", () => {
  const ThemeEditor = require("../js/theme-editor.js");
  const draft = ThemeEditor.createCustomThemeDraft({
    label: "<My Theme>",
    accent: "#12abef",
    particleMode: "starlight",
  });

  assert.equal(draft.id, "custom");
  assert.equal(draft.accent, "#12abef");
  assert.equal(draft.cssVars["--accent"], "#12abef");
  assert.doesNotMatch(ThemeEditor.renderThemeSummary(draft), /<My Theme>/);
});

test("feature registry keeps extension modules declarative", () => {
  const Registry = require("../js/feature-registry.js");
  const modules = Registry.createFeatureRegistry().list();

  assert.deepEqual(
    modules.map((module) => module.id),
    ["ai", "data", "navigation", "search", "calendar", "themes", "plugins", "pwa"],
  );
  assert.equal(Registry.createFeatureRegistry({ disabled: ["music"] }).isEnabled("music"), false);
  assert.match(Registry.renderModuleList(modules), /feature-module-list/);
});

test("service worker provides an offline document fallback for PWA launches", () => {
  const sw = fs.readFileSync("sw.js", "utf8");
  const assets = require("../js/static-assets.js");

  assert.ok(assets.scripts.includes("js/ai-gallery.js"));
  assert.ok(assets.scripts.includes("js/smart-search.js"));
  assert.ok(assets.scripts.includes("js/nav-insights.js"));
  assert.ok(assets.scripts.includes("js/calendar-planner.js"));
  assert.ok(assets.scripts.includes("js/theme-editor.js"));
  assert.ok(assets.scripts.includes("js/feature-registry.js"));
  assert.match(sw, /isNavigationRequest/);
  assert.match(sw, /offlineFallback/);
});

test("server exposes durable snapshot and link check endpoints", () => {
  const server = fs.readFileSync("server/index.js", "utf8");
  const database = fs.readFileSync("server/database.js", "utf8");

  assert.match(database, /CREATE TABLE IF NOT EXISTS data_snapshots/);
  assert.match(database, /createDataSnapshot/);
  assert.match(database, /restoreDataSnapshot/);
  assert.match(server, /app\.get\("\/api\/snapshots"/);
  assert.match(server, /app\.post\("\/api\/snapshots"/);
  assert.match(server, /app\.post\("\/api\/snapshots\/:id\/restore"/);
  assert.match(server, /app\.post\("\/api\/link-check"/);
  assert.match(server, /checkOneLink/);
});

test("expanded features are wired into the visible app shell", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const app = fs.readFileSync("js/app.js", "utf8");
  const aiCss = fs.readFileSync("css/ai.css", "utf8");
  const calendarCss = fs.readFileSync("css/calendar.css", "utf8");
  const cardsCss = fs.readFileSync("css/cards.css", "utf8");
  const settingsCss = fs.readFileSync("css/settings.css", "utf8");

  assert.match(index, /id="ai-open-gallery"/);
  assert.match(index, /id="ai-gallery-panel"/);
  assert.match(index, /id="btn-link-check"/);
  assert.match(index, /id="snapshot-list"/);
  assert.match(index, /data-view="week"/);
  assert.match(index, /id="custom-theme-label"/);
  assert.match(index, /id="feature-modules-list"/);
  assert.match(index, /name="tags"/);

  assert.match(app, /renderAIGallery/);
  assert.match(app, /runLinkHealthCheck/);
  assert.match(app, /refreshSnapshots/);
  assert.match(app, /renderWeekView/);
  assert.match(app, /applyCustomThemeSettings/);
  assert.match(app, /HomepageSmartSearch/);
  assert.match(app, /HomepageNavInsights/);
  assert.match(app, /HomepageFeatureRegistry/);

  assert.match(aiCss, /\.ai-gallery-panel/);
  assert.match(calendarCss, /\.cal-week-view/);
  assert.match(cardsCss, /\.health-badge/);
  assert.match(settingsCss, /\.feature-module-list/);
});
