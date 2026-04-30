const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("particle canvas is a full-page background effects layer", () => {
  const css = fs.readFileSync("styles.css", "utf8");
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
  const css = fs.readFileSync("styles.css", "utf8");
  const gridBlock = /\.cal-grid\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const narrowBlock = /@media \(max-width:\s*900px\)\s*\{(?<body>[\s\S]+?)\n\}/.exec(css)?.groups?.body || "";

  assert.match(gridBlock, /grid-template-rows:\s*repeat\(6,\s*minmax\(/);
  assert.match(gridBlock, /min-height:\s*calc\(6\s*\*\s*var\(--cal-cell-min-height\)/);
  assert.match(narrowBlock, /\.cal-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(narrowBlock, /\.cal-month-view\s*\{[^}]*min-height:\s*calc\(6\s*\*\s*var\(--cal-cell-min-height\)/);
});

test("calendar secondary views obey the hidden attribute", () => {
  const css = fs.readFileSync("styles.css", "utf8");

  assert.match(css, /\.cal-stats-view\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.cal-day-panel\[hidden\]\s*\{\s*display:\s*none/);
});

test("calendar header chip buttons center their labels", () => {
  const css = fs.readFileSync("styles.css", "utf8");
  const block = /\.cal-head-right\s*>\s*\.chip\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(block, /display:\s*inline-flex/);
  assert.match(block, /align-items:\s*center/);
  assert.match(block, /justify-content:\s*center/);
  assert.match(block, /line-height:\s*1/);
});

test("group navigation tabs obey the hidden attribute when no tabs exist", () => {
  const css = fs.readFileSync("styles.css", "utf8");

  assert.match(css, /\.group-tabs\[hidden\]\s*\{\s*display:\s*none/);
});

test("AI composer hides scrollbars until typed content exceeds its max height", () => {
  const css = fs.readFileSync("styles.css", "utf8");
  const block = /#ai-input\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(block, /min-width:\s*0/);
  assert.match(block, /overflow-y:\s*hidden/);
});

test("settings sections use plain flow instead of nested subcards", () => {
  const css = fs.readFileSync("styles.css", "utf8");
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
  const css = fs.readFileSync("styles.css", "utf8");
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
  const css = fs.readFileSync("styles.css", "utf8");
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
  const css = fs.readFileSync("styles.css", "utf8");
  const index = fs.readFileSync("index.html", "utf8");
  const app = fs.readFileSync("app.js", "utf8");
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
  const css = fs.readFileSync("styles.css", "utf8");

  assert.doesNotMatch(css, /\.music-sources-row\b/);
  assert.doesNotMatch(css, /\.music-search-dialog\b/);
  assert.doesNotMatch(css, /\.msd-/);
  assert.doesNotMatch(css, /\.music-source-list\b/);
  assert.doesNotMatch(css, /\.mt-source-badge\b/);
});
