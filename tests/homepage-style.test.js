const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

function loadStaticAssets() {
  const manifestPath = require.resolve("../js/static-assets.js");

  delete require.cache[manifestPath];
  return require(manifestPath);
}

function readCss() {
  const assets = loadStaticAssets();

  return [...assets.stylesheets, ...assets.themeStylesheets]
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

test("particle canvas is a full-page background effects layer", () => {
  const css = readCss();
  const block = /#sakura-canvas\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const appBlock = /\.app\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(block, /position:\s*fixed/);
  assert.match(block, /inset:\s*0/);
  assert.match(block, /pointer-events:\s*none/);
  assert.match(block, /z-index:\s*0/);
  assert.doesNotMatch(block, /z-index:\s*[1-9]\d*/);
  assert.match(appBlock, /position:\s*relative/);
  assert.match(appBlock, /z-index:\s*1/);
});

test("calendar month grid keeps readable rows when the viewport is narrow", () => {
  const css = readCss();
  const gridBlock = /\.cal-grid\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(gridBlock, /grid-template-rows:\s*repeat\(6,\s*minmax\(/);
  assert.match(gridBlock, /min-height:\s*calc\(6\s*\*\s*var\(--cal-cell-min-height\)/);
  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.cal-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.cal-month-view\s*\{[^}]*min-height:\s*calc\(6\s*\*\s*var\(--cal-cell-min-height\)/);
});

test("calendar secondary views obey the hidden attribute", () => {
  const css = readCss();

  assert.match(css, /\.cal-stats-view\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.cal-day-panel\[hidden\]\s*\{\s*display:\s*none/);
});

test("calendar header chip buttons center their labels", () => {
  const css = readCss();
  const block = /\.cal-head-right\s*>\s*\.chip\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(block, /display:\s*inline-flex/);
  assert.match(block, /align-items:\s*center/);
  assert.match(block, /justify-content:\s*center/);
  assert.match(block, /line-height:\s*1/);
});

test("group navigation tabs obey the hidden attribute when no tabs exist", () => {
  const css = readCss();

  assert.match(css, /\.group-tabs\[hidden\]\s*\{\s*display:\s*none/);
});

test("AI composer hides scrollbars until typed content exceeds its max height", () => {
  const css = readCss();
  const block = /#ai-input\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(block, /min-width:\s*0/);
  assert.match(block, /overflow-y:\s*hidden/);
});

test("AI-specific styles are split out of the global stylesheet", () => {
  const globalCss = fs.readFileSync("css/styles.css", "utf8");

  assert.ok(fs.existsSync("css/ai.css"), "ai.css should own AI panel styling");
  const aiCss = fs.readFileSync("css/ai.css", "utf8");
  assert.match(aiCss, /\.ai-fab\s*\{/);
  assert.match(aiCss, /\.ai-panel\s*\{/);
  assert.match(aiCss, /#ai-input\s*\{/);
  assert.match(aiCss, /\.ai-dialog\s*\{/);
  assert.doesNotMatch(globalCss, /\.ai-panel\s*\{/);
  assert.doesNotMatch(globalCss, /\.ai-fab\s*\{/);
  assert.doesNotMatch(globalCss, /#ai-input\s*\{/);
});

test("calendar-specific styles are split out of the global stylesheet", () => {
  const globalCss = fs.readFileSync("css/styles.css", "utf8");

  assert.ok(fs.existsSync("css/calendar.css"), "calendar.css should own calendar panel styling");
  const calendarCss = fs.readFileSync("css/calendar.css", "utf8");
  assert.match(calendarCss, /\.calendar-panel\s*\{/);
  assert.match(calendarCss, /\.cal-grid\s*\{/);
  assert.match(calendarCss, /\.task-dialog\s*\{/);
  assert.match(calendarCss, /\.upcoming-card\s*\{/);
  assert.match(calendarCss, /\.task-weather-tip\s*\{/);
  assert.doesNotMatch(globalCss, /\.calendar-panel\s*\{/);
  assert.doesNotMatch(globalCss, /\.cal-grid\s*\{/);
  assert.doesNotMatch(globalCss, /\.task-dialog\s*\{/);
  assert.doesNotMatch(globalCss, /\.upcoming-card\s*\{/);
});

test("music-specific styles are split out of the global stylesheet", () => {
  const globalCss = fs.readFileSync("css/styles.css", "utf8");

  assert.ok(fs.existsSync("css/music.css"), "music.css should own music player styling");
  const musicCss = fs.readFileSync("css/music.css", "utf8");
  assert.match(musicCss, /\.music-fab\s*\{/);
  assert.match(musicCss, /\.music-panel\s*\{/);
  assert.match(musicCss, /\.music-stage\s*\{/);
  assert.match(musicCss, /\.music-track\s*\{/);
  assert.match(musicCss, /\.lyric-line\s*\{/);
  assert.doesNotMatch(globalCss, /\.music-fab\s*\{/);
  assert.doesNotMatch(globalCss, /\.music-panel\s*\{/);
  assert.doesNotMatch(globalCss, /\.music-stage\s*\{/);
  assert.doesNotMatch(globalCss, /\.music-track\s*\{/);
});

test("weather-specific styles are split out of the global stylesheet", () => {
  const globalCss = fs.readFileSync("css/styles.css", "utf8");

  assert.ok(fs.existsSync("css/weather.css"), "weather.css should own weather card styling");
  const weatherCss = fs.readFileSync("css/weather.css", "utf8");
  assert.match(weatherCss, /\.weather-card\s*\{/);
  assert.match(weatherCss, /\.weather-cities\s*\{/);
  assert.match(weatherCss, /\.weather-daily\s*\{/);
  assert.match(weatherCss, /\.city-search-wrap\s*\{/);
  assert.match(weatherCss, /\.city-chip\s*\{/);
  assert.doesNotMatch(globalCss, /\.weather-card\s*\{/);
  assert.doesNotMatch(globalCss, /\.weather-cities\s*\{/);
  assert.doesNotMatch(globalCss, /\.weather-daily\s*\{/);
  assert.doesNotMatch(globalCss, /\.city-search-wrap\s*\{/);
  assert.doesNotMatch(globalCss, /\.city-chip\s*\{/);
});

test("card and group styles are split out of the global stylesheet", () => {
  const globalCss = fs.readFileSync("css/styles.css", "utf8");

  assert.ok(fs.existsSync("css/cards.css"), "cards.css should own homepage card and group styling");
  const cardsCss = fs.readFileSync("css/cards.css", "utf8");
  assert.match(cardsCss, /\.groups\s*\{/);
  assert.match(cardsCss, /\.group-head\s*\{/);
  assert.match(cardsCss, /\.cards\s*\{/);
  assert.match(cardsCss, /\.card\s*\{/);
  assert.match(cardsCss, /\.card-add\s*\{/);
  assert.match(cardsCss, /\.group-tabs\s*\{/);
  assert.match(cardsCss, /\.card \.pin\s*\{/);
  assert.doesNotMatch(globalCss, /\.groups\s*\{/);
  assert.doesNotMatch(globalCss, /\.group-head\s*\{/);
  assert.doesNotMatch(globalCss, /\.cards\s*\{/);
  assert.doesNotMatch(globalCss, /\.card\s*\{/);
  assert.doesNotMatch(globalCss, /\.card-add\s*\{/);
  assert.doesNotMatch(globalCss, /\.group-tabs\s*\{/);
  assert.doesNotMatch(globalCss, /\.card \.pin\s*\{/);
});

test("settings sections use plain flow instead of nested subcards", () => {
  const css = readCss();
  const index = fs.readFileSync("index.html", "utf8");
  const rowBlock = /\.settings-dialog label\.row-block\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const sectionTitle = /\.settings-section-title\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(rowBlock, /flex-direction:\s*column/);
  assert.match(rowBlock, /align-items:\s*stretch/);
  assert.match(sectionTitle, /margin:\s*14px 0 12px/);
  assert.doesNotMatch(css, /\.settings-stack\b/);
  assert.doesNotMatch(css, /\.settings-subcard\b/);
  assert.doesNotMatch(css, /settings-subcard/);
  assert.doesNotMatch(css, /settings-subhint/);
  assert.doesNotMatch(index, /settings-stack/);
  assert.doesNotMatch(index, /settings-subcard/);
  assert.doesNotMatch(index, /settings-subhint/);
});

test("backup options do not override the shared row and form styling", () => {
  const css = readCss();
  const index = fs.readFileSync("index.html", "utf8");
  const rowBlock = /\.glass-dialog\s+\.row-tight\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(rowBlock, /margin:\s*0/);
  assert.match(rowBlock, /align-items:\s*center/);
  assert.match(css, /\.glass-dialog\s*>\s*form,\s*\n\.glass-dialog\s*>\s*\.dialog-form/);
  assert.match(css, /\.settings-dialog\s*>\s*\.dialog-form\s*\{/);
  assert.doesNotMatch(css, /\.glass-dialog\s+form\s*,/);
  assert.doesNotMatch(css, /\.settings-dialog\s+form\s*,/);
  assert.doesNotMatch(css, /\.sync-config-panel\s*\{/);
  assert.doesNotMatch(css, /\.sync-options-panel\s*\{/);
  assert.doesNotMatch(css, /\.sync-options-panel\s+\.settings-toggle-col/);
  assert.doesNotMatch(css, /\.sync-options-panel\s+\.row-tight/);
  assert.doesNotMatch(css, /\[data-theme="dark"\]\s+\.sync-options-panel/);
  assert.doesNotMatch(css, /\.settings-btn-grid\b/);
  assert.doesNotMatch(index, /sync-backend-fields/);
  assert.doesNotMatch(index, /sync-config-panel/);
  assert.doesNotMatch(index, /sync-options-panel/);
  assert.doesNotMatch(index, /settings-btn-row--spaced/);
  assert.doesNotMatch(index, /settings-btn-grid/);
});

test("settings panel surfaces use theme-driven backgrounds", () => {
  const css = readCss();
  const secBlock = /^\.sec\s*\{(?<body>[^}]+)\}/m.exec(css)?.groups?.body || "";
  const secHoverBlock = /^\.sec:hover\s*\{(?<body>[^}]+)\}/m.exec(css)?.groups?.body || "";
  const secOpenBlock = /^\.sec\[open\]\s*\{(?<body>[^}]+)\}/m.exec(css)?.groups?.body || "";
  const inputBlock = /\.glass-dialog input\[type="text"\],[\s\S]+?\.glass-dialog input\[type="range"\]\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const inputHoverBlock = /\.glass-dialog input:hover,[\s\S]+?\.glass-dialog select:hover\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const inputFocusBlock = /\.glass-dialog input:focus,[\s\S]+?\.glass-dialog select:focus\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(secBlock, /background:\s*var\(--card-bg\)/);
  assert.match(secHoverBlock, /background:\s*var\(--card-hover\)/);
  assert.match(secOpenBlock, /background:\s*var\(--card-hover\)/);
  assert.match(inputBlock, /background:\s*var\(--card-bg\)/);
  assert.match(inputHoverBlock, /background:\s*var\(--card-hover\)/);
  assert.match(inputFocusBlock, /background:\s*var\(--glass-bg\)/);
  assert.doesNotMatch(inputFocusBlock, /background:\s*#fff/);
});

test("visual theme setting uses a select instead of preview cards", () => {
  const css = readCss();
  const index = fs.readFileSync("index.html", "utf8");
  const app = fs.readFileSync("js/app.js", "utf8");
  const selectMarkup = /<select id="set-visual-theme">(?<body>[\s\S]+?)<\/select>/.exec(index)?.groups?.body || "";

  assert.match(selectMarkup, /value="sakura"/);
  assert.match(selectMarkup, /value="q-anime"/);
  assert.match(selectMarkup, /value="dark-minimal"/);
  assert.match(selectMarkup, /value="paper"/);
  assert.doesNotMatch(index, /theme-picker|theme-card|theme-thumb|theme-name|row-stack|row-label/);
  assert.doesNotMatch(css, /\.theme-picker|\.theme-card|\.theme-thumb|\.theme-name|\.row-stack|\.row-label/);
  assert.doesNotMatch(app, /theme-picker|theme-card|themeId|hiddenInput/);
  assert.match(app, /#set-visual-theme/);
});

test("stylesheet no longer carries removed music source search UI selectors", () => {
  const css = readCss();

  assert.doesNotMatch(css, /\.music-sources-row\b/);
  assert.doesNotMatch(css, /\.music-search-dialog\b/);
  assert.doesNotMatch(css, /\.msd-/);
  assert.doesNotMatch(css, /\.music-source-list\b/);
  assert.doesNotMatch(css, /\.mt-source-badge\b/);
});

test("settings-specific styles are split out of the global stylesheet", () => {
  const globalCss = fs.readFileSync("css/styles.css", "utf8");

  assert.ok(fs.existsSync("css/settings.css"), "settings.css should own settings panel styling");
  const settingsCss = fs.readFileSync("css/settings.css", "utf8");
  assert.match(settingsCss, /\.settings-dialog\s+label\.row/);
  assert.match(settingsCss, /\.settings-section-title\s*\{/);
  assert.match(settingsCss, /\.settings-toggle-col\s*\{/);
  assert.doesNotMatch(globalCss, /\.settings-section-title\s*\{/);
  assert.doesNotMatch(globalCss, /\.settings-toggle-col\s*\{/);
});
