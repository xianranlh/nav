const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadStaticAssets() {
  const manifestPath = path.resolve("js/static-assets.js");

  assert.ok(fs.existsSync(manifestPath), "static asset manifest should exist");
  delete require.cache[manifestPath];
  return require(manifestPath);
}

test("version-busts the main app controller so dialog behavior updates reach the browser", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const sw = fs.readFileSync("sw.js", "utf8");
  const assets = loadStaticAssets();
  const appScriptVersion = /<script src="js\/app\.js\?v=([^"]+)"><\/script>/.exec(index)?.[1];

  assert.ok(assets.VERSION, "static asset manifest should declare the cache version");
  assert.ok(appScriptVersion, "app.js should include a cache-busting version query");
  assert.equal(appScriptVersion, assets.VERSION);
  assert.equal(assets.versionedAppScript, `js/app.js?v=${assets.VERSION}`);
  assert.ok(assets.coreFiles.includes(`./js/app.js?v=${assets.VERSION}`));
  assert.match(sw, /importScripts\("\.\/js\/static-assets\.js"\)/);
  assert.match(sw, /SakuraStaticAssets/);
  assert.doesNotMatch(sw, /const CORE_FILES\s*=\s*\[/);
});

test("front-end assets are grouped under css and js directories", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const sw = fs.readFileSync("sw.js", "utf8");
  const dockerfile = fs.readFileSync("Dockerfile", "utf8");
  const assets = loadStaticAssets();

  for (const href of [...assets.stylesheets, ...assets.themeStylesheets]) {
    assert.match(index, new RegExp(`<link rel="stylesheet" href="${href.replace(/[./?]/g, "\\$&")}" \\/>`));
    assert.ok(assets.coreFiles.includes(`./${href}`), `${href} should be precached`);
  }
  for (const src of assets.scripts) {
    assert.match(index, new RegExp(`<script src="${src.replace(/[./?]/g, "\\$&")}"><\\/script>`));
    assert.ok(assets.coreFiles.includes(`./${src}`), `${src} should be precached`);
  }
  assert.match(index, new RegExp(`<script src="${assets.versionedAppScript.replace(/[./?]/g, "\\$&")}"><\\/script>`));
  assert.doesNotMatch(index, /href="(?:settings|styles)\.css"/);
  assert.doesNotMatch(index, /href="themes\//);
  assert.doesNotMatch(index, /<script src="(?:app|settings-ui|homepage-theme|homepage-layout)\.js/);
  assert.match(sw, /const CORE_FILES = STATIC_ASSETS\.coreFiles/);

  assert.match(dockerfile, /COPY css\/\s+\/usr\/share\/nginx\/html\/css\//);
  assert.match(dockerfile, /COPY js\/\s+\/usr\/share\/nginx\/html\/js\//);
});

test("keeps the inline group button outside the select label in the link dialog", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const groupLabelBlock = /<label[^>]*>\s*所属分组[\s\S]*?<\/label>/.exec(index)?.[0] || "";

  assert.ok(groupLabelBlock, "link dialog should expose a label for the group select");
  assert.doesNotMatch(groupLabelBlock, /link-new-group-toggle/);
});

test("keeps the AI chat placeholder compact enough to avoid input scrollbars", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const inputMarkup = /<textarea id="ai-input"[^>]*><\/textarea>/.exec(index)?.[0] || "";
  const placeholder = /placeholder="([^"]+)"/.exec(inputMarkup)?.[1] || "";

  assert.ok(inputMarkup, "AI chat textarea should exist");
  assert.ok(placeholder, "AI chat textarea should have a placeholder");
  assert.ok(
    placeholder.length <= 14,
    "visible placeholder should stay short so it does not wrap in the compact composer",
  );
  assert.doesNotMatch(placeholder, /Enter|Shift|换行|发送/);
  assert.match(inputMarkup, /aria-label="[^"]*(Enter|发送)[^"]*"/);
});

test("Docker image includes current theme assets and excludes removed LX source bundles", () => {
  const dockerfile = fs.readFileSync("Dockerfile", "utf8");

  assert.match(dockerfile, /COPY css\/\s+\/usr\/share\/nginx\/html\/css\//);
  assert.match(dockerfile, /COPY js\/\s+\/usr\/share\/nginx\/html\/js\//);
  assert.doesNotMatch(dockerfile, /lx-sources/);
});

test("settings stylesheet is loaded and precached with core assets", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const assets = loadStaticAssets();

  assert.match(index, /<link rel="stylesheet" href="css\/settings\.css" \/>/);
  assert.ok(assets.stylesheets.includes("css/settings.css"));
  assert.ok(assets.coreFiles.includes("./css/settings.css"));
});

test("settings UI module loads before the main app and is precached", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const assets = loadStaticAssets();
  const backgroundIdx = index.indexOf('<script src="js/background-ui.js"></script>');
  const syncIdx = index.indexOf('<script src="js/sync-ui.js"></script>');
  const settingsIdx = index.indexOf('<script src="js/settings-ui.js"></script>');
  const appIdx = index.indexOf('<script src="js/app.js');

  assert.ok(backgroundIdx >= 0, "background-ui.js should be loaded");
  assert.ok(syncIdx >= 0, "sync-ui.js should be loaded");
  assert.ok(settingsIdx >= 0, "settings-ui.js should be loaded");
  assert.ok(appIdx > settingsIdx, "settings-ui.js should load before app.js");
  assert.ok(appIdx > backgroundIdx, "background-ui.js should load before app.js");
  assert.ok(appIdx > syncIdx, "sync-ui.js should load before app.js");
  assert.ok(assets.scripts.includes("js/background-ui.js"));
  assert.ok(assets.scripts.includes("js/sync-ui.js"));
  assert.ok(assets.scripts.includes("js/settings-ui.js"));
  assert.ok(assets.coreFiles.includes("./js/background-ui.js"));
  assert.ok(assets.coreFiles.includes("./js/sync-ui.js"));
  assert.ok(assets.coreFiles.includes("./js/settings-ui.js"));
});

test("service worker does not keep unused stale-while-revalidate helper", () => {
  const sw = fs.readFileSync("sw.js", "utf8");

  assert.doesNotMatch(sw, /function\s+staleWhileRevalidate/);
  assert.doesNotMatch(sw, /stale-while-revalidate/);
});
