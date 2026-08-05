const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("particle canvas is a full-page background effects layer", () => {
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");
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
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");
  const gridBlock = /\.cal-grid\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const narrowBlock = /@media \(max-width:\s*900px\)\s*\{(?<body>[\s\S]+?)\n\}/.exec(css)?.groups?.body || "";

  assert.match(gridBlock, /grid-template-rows:\s*repeat\(6,\s*minmax\(/);
  assert.match(gridBlock, /min-height:\s*calc\(6\s*\*\s*var\(--cal-cell-min-height\)/);
  assert.match(narrowBlock, /\.cal-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(narrowBlock, /\.cal-month-view\s*\{[^}]*min-height:\s*calc\(6\s*\*\s*var\(--cal-cell-min-height\)/);
});

test("calendar secondary views obey the hidden attribute", () => {
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");

  assert.match(css, /\.cal-stats-view\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.cal-day-panel\[hidden\]\s*\{\s*display:\s*none/);
});

test("calendar header chip buttons center their labels", () => {
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");
  const block = /\.cal-head-right\s*>\s*\.chip\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(block, /display:\s*inline-flex/);
  assert.match(block, /align-items:\s*center/);
  assert.match(block, /justify-content:\s*center/);
  assert.match(block, /line-height:\s*1/);
});

test("group navigation tabs obey the hidden attribute when no tabs exist", () => {
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");

  assert.match(css, /\.group-tabs\[hidden\]\s*\{\s*display:\s*none/);
});

test("AI composer hides scrollbars until typed content exceeds its max height", () => {
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");
  const block = /#ai-input\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(block, /min-width:\s*0/);
  assert.match(block, /overflow-y:\s*hidden/);
});

test("settings sections use plain flow instead of nested subcards", () => {
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");
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
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");
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
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");
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
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");
  const index = fs.readFileSync("index.html", "utf8");
  const app = fs.readFileSync("js/app.js", "utf8");
  const selectMarkup = /<select id="set-visual-theme"[^>]*>(?<body>[\s\S]+?)<\/select>/.exec(index)?.groups?.body || "";

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
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8") + fs.readFileSync("styles/ai-chat.css", "utf8");

  assert.doesNotMatch(css, /\.music-sources-row\b/);
  assert.doesNotMatch(css, /\.music-search-dialog\b/);
  assert.doesNotMatch(css, /\.msd-/);
  assert.doesNotMatch(css, /\.music-source-list\b/);
  assert.doesNotMatch(css, /\.mt-source-badge\b/);
});

test("login surface keeps hidden-state safety and focusable primary CTA", () => {
  const css = fs.readFileSync("styles.css", "utf8") + fs.readFileSync("styles/dialogs.css", "utf8");
  const index = fs.readFileSync("index.html", "utf8");
  const overlayHidden = /\.login-overlay\[hidden\]\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const loginBtnFocus = /\.login-btn:focus-visible\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(index, /id="login-overlay"/);
  assert.match(index, /id="login-form"/);
  assert.match(overlayHidden, /display:\s*none/);
  assert.match(loginBtnFocus, /outline:\s*2px\s+solid\s+var\(--accent\)/);
  assert.match(css, /\.login-card\s*\{[^}]*border:\s*1px\s+solid\s+rgba\(var\(--accent-rgb\)/);
});

test("toolbar and search keep product hierarchy with accent focus rings", () => {
  const css = fs.readFileSync("styles.css", "utf8");
  const topbarFocus = /\.topbar-btn:focus-visible\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const chipFocus = /\.chip:focus-visible,\s*\n\.icon-btn:focus-visible/.exec(css);

  assert.match(topbarFocus, /outline:\s*2px\s+solid\s+var\(--accent\)/);
  assert.ok(chipFocus, "shared focus-visible list should cover chips and icon buttons");
  assert.match(css, /\.search-box\s*\{[^}]*border:\s*1px\s+solid\s+rgba\(var\(--accent-rgb\)/);
  assert.match(css, /\.topbar-btn\s*\{[^}]*border-radius:\s*999px/);
});

test("dialogs primary actions and AI/music panels obey hidden + focus safety", () => {
  const css =
    fs.readFileSync("styles.css", "utf8") +
    fs.readFileSync("styles/dialogs.css", "utf8") +
    fs.readFileSync("styles/ai-chat.css", "utf8");

  assert.match(css, /\.btn-primary:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent\)/);
  assert.match(css, /\.btn-secondary:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent\)/);
  assert.match(css, /\.ai-panel\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.music-panel\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.ai-tool-btn:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent\)/);
  assert.match(css, /\.music-fab:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent\)/);
});

test("four visual themes keep accent tokens and product-specific control radii", () => {
  const sakura = fs.readFileSync("themes/sakura.css", "utf8");
  const q = fs.readFileSync("themes/q-anime.css", "utf8");
  const dark = fs.readFileSync("themes/dark-minimal.css", "utf8");
  const paper = fs.readFileSync("themes/paper.css", "utf8");

  assert.match(sakura, /data-visual-theme="sakura"/);
  assert.match(q, /--accent:\s*#c4a8e8/);
  assert.match(dark, /--accent:\s*#8da4c0/);
  assert.match(paper, /--accent:\s*#b07c4f/);
  assert.match(q, /\.topbar-btn/);
  assert.match(dark, /\.gv-btn\.is-active/);
  assert.match(paper, /\.search-form/);
});

test("pet page stylesheet exposes focus-visible for primary controls", () => {
  const css = fs.readFileSync("styles/pet.css", "utf8");
  assert.match(css, /\.back-link:focus-visible/);
  assert.match(css, /\.icon-chip:focus-visible/);
  assert.match(css, /outline:\s*2px\s+solid\s+var\(--pk/);
});


test("homepage shell uses responsive app gap tokens and toolbar grid", () => {
  const css = fs.readFileSync("styles.css", "utf8");
  const appBlock = /\.app\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const toolbarBlock = /\.toolbar\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const topRowBlock = /\.top-row\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";
  const calBodyBlock = /\.cal-body\s*\{(?<body>[^}]+)\}/.exec(css)?.groups?.body || "";

  assert.match(appBlock, /--app-gap:/);
  assert.match(appBlock, /gap:\s*var\(--app-gap\)/);
  assert.match(toolbarBlock, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(topRowBlock, /grid-template-columns:\s*repeat\(auto-fit/);
  assert.match(calBodyBlock, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.filter-wrap\s*\{[^}]*flex:\s*1\s+1\s+180px/);
});


test("AI and music panels use shared SVG icon class and polished shells", () => {
  const css =
    fs.readFileSync("styles.css", "utf8") +
    fs.readFileSync("styles/ai-chat.css", "utf8");
  const index = fs.readFileSync("index.html", "utf8");
  const music = fs.readFileSync("js/music.js", "utf8");

  assert.match(css, /\.ui-ico\s*\{/);
  assert.match(css, /\.ui-ico\s+svg\s*\{/);
  assert.match(css, /\.ai-fab\s*\{[^}]*border-radius:\s*18px/);
  assert.match(css, /\.music-fab\s*\{[^}]*border-radius:\s*18px/);
  assert.match(css, /\.music-btn\.primary\s*\{[^}]*border-radius:\s*16px/);
  assert.match(index, /id="ai-fab"[\s\S]*?class="[^"]*ui-ico/);
  assert.match(index, /id="music-fab"[\s\S]*?class="[^"]*ui-ico/);
  assert.match(index, /id="ai-send"[\s\S]*?ui-ico/);
  assert.match(index, /id="music-play"[\s\S]*?ui-ico/);
  assert.match(music, /ICO_PLAY/);
  assert.match(music, /ICO_PAUSE/);
  assert.match(music, /innerHTML\s*=\s*playing \? ICO_PAUSE : ICO_PLAY/);
  assert.match(css, /\.ai-input-row\s*\{[^}]*border-radius:\s*16px/);
  assert.match(css, /\.music-panel\s*\{[^}]*border:\s*1px\s+solid\s+rgba\(var\(--accent-rgb\)/);
});


test("Web Interface Guidelines: skip link, focus safety, reduced motion, no transition:all", () => {
  const css =
    fs.readFileSync("styles.css", "utf8") +
    fs.readFileSync("styles/ai-chat.css", "utf8") +
    fs.readFileSync("styles/dialogs.css", "utf8");
  const index = fs.readFileSync("index.html", "utf8");

  assert.match(index, /class="skip-link"[^>]*href="#main-content"/);
  assert.match(index, /id="main-content"/);
  assert.match(index, /id="login-msg"[^>]*aria-live="polite"/);
  assert.match(index, /placeholder="搜索书签或网页…"/);
  assert.match(index, /placeholder="过滤已添加网址…"/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /-webkit-tap-highlight-color/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /100dvh/);
  assert.match(css, /\.skip-link\s*\{/);
  assert.doesNotMatch(css, /transition:\s*all\b/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /:focus-visible/);
  // viewport must not disable zoom
  assert.doesNotMatch(index, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
});


test("aria-modal dialogs and toast live region (guidelines pass 2)", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const dialog = fs.readFileSync("js/dialog.js", "utf8");
  const app = fs.readFileSync("js/app.js", "utf8");
  assert.match(index, /aria-modal="true"/);
  assert.match(index, /id="toast"[^>]*aria-live="polite"/);
  assert.match(index, /id="ctx-menu"[^>]*role="menu"/);
  assert.match(index, /id="ai-panel"[^>]*aria-label="AI 助手"/);
  assert.match(index, /id="music-panel"[^>]*aria-label="音乐播放器"/);
  assert.match(dialog, /aria-modal/);
  assert.match(dialog, /focusable/);
  assert.match(app, /setAttribute\("aria-label", "删除此网址"\)/);
  assert.match(app, /aria-pressed/);
});


test("form controls declare autocomplete and placeholders use ellipsis", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const inputs = index.match(/<input\b[^>]*>/g) || [];
  const need = inputs.filter((i) =>
    !/type="(hidden|file|checkbox|radio|range|color)"/.test(i)
  );
  const missing = need.filter((i) => !/autocomplete=/.test(i));
  assert.equal(missing.length, 0, "text-like inputs need autocomplete: " + missing.slice(0, 3).join(" | "));
  assert.doesNotMatch(index, /placeholder="[^"]*\.\.\./);
  assert.match(index, /placeholder="[^"]*…/);
});

test("PanelRouter deep-link helpers exist for main panels", () => {
  const app = fs.readFileSync("js/app.js", "utf8");
  const music = fs.readFileSync("js/music.js", "utf8");
  assert.match(app, /const PanelRouter/);
  assert.match(app, /#panel=/);
  assert.match(app, /window\.PanelRouter/);
  assert.match(app, /window\.UIAI/);
  assert.match(app, /window\.UICal/);
  assert.match(music, /PanelRouter\?\.set\("music"\)/);
  assert.match(music, /PanelRouter\?\.clearIf\("music"\)/);
});


test("unsaved-changes guard and inputmode (guidelines pass 4)", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const dialog = fs.readFileSync("js/dialog.js", "utf8");
  assert.match(index, /data-guard-unsaved/);
  assert.match(index, /inputmode="url"/);
  assert.match(index, /inputmode="search"/);
  assert.doesNotMatch(index, /<input\b[^>]*\s\/\s+autocomplete=/);
  assert.match(dialog, /beforeunload/);
  assert.match(dialog, /confirmDiscard|有未保存的更改/);
  assert.match(dialog, /submitCloseGuard|data-guard-unsaved|GUARD/);
  assert.match(dialog, /serializeForm/);
});


test("AI panel two-row head layout is structured and not a single wrapping toolbar", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const css = fs.readFileSync("styles/ai-chat.css", "utf8");
  assert.match(index, /class="ai-head-primary"/);
  assert.match(index, /class="ai-head-toolbar"/);
  assert.match(index, /id="ai-persona-select"/);
  assert.match(index, /id="ai-model-select"/);
  assert.match(index, /id="ai-close"/);
  // close lives in primary row, tools in toolbar
  const primary = /ai-head-primary[\s\S]*?ai-head-toolbar/.exec(index);
  assert.ok(primary, "primary row should precede toolbar");
  assert.match(primary[0], /ai-close/);
  assert.match(css, /\.ai-head-primary\s*\{[^}]*grid-template-columns/);
  assert.match(css, /\.ai-head-toolbar\s*\{/);
  assert.match(css, /\.ai-input-row\s*\{[^}]*grid-template-columns:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto/);
});
