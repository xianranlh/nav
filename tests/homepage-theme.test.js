const test = require("node:test");
const assert = require("node:assert/strict");

const {
  VISUAL_THEMES,
  DEFAULT_VISUAL_THEME_ID,
  getVisualTheme,
  getPrimaryVisualThemes,
  particleCountForViewport,
  particleModeFromVisualTheme,
  shouldSyncAccent,
} = require("../js/homepage-theme.js");

test("registers the maintained homepage visual themes", () => {
  assert.deepEqual(
    getPrimaryVisualThemes().map(theme => theme.id),
    ["sakura", "q-anime", "dark-minimal", "paper", "xuanbird", "liquid-glass"],
  );
  assert.equal(DEFAULT_VISUAL_THEME_ID, "sakura");
  assert.equal(getVisualTheme("q-anime").accent, "#c4a8e8");
  assert.equal(getVisualTheme("missing").id, "sakura");
});

test("maps visual themes to particle modes", () => {
  assert.equal(particleModeFromVisualTheme("sakura"), "sakura");
  assert.equal(particleModeFromVisualTheme("q-anime"), "candy-stars");
  assert.equal(particleModeFromVisualTheme("dark-minimal"), "none");
  assert.equal(particleModeFromVisualTheme("paper"), "sycamore");
  assert.equal(particleModeFromVisualTheme("xuanbird"), "black-feathers");
  assert.equal(particleModeFromVisualTheme("liquid-glass"), "none");
  assert.equal(particleModeFromVisualTheme("starlight"), "starlight");
  assert.equal(particleModeFromVisualTheme("sycamore"), "sycamore");
  assert.equal(particleModeFromVisualTheme("unknown"), "sakura");
});

test("explicit effects override a theme and zero density stays disabled on any viewport", () => {
  assert.equal(particleModeFromVisualTheme("paper", "black-feathers"), "black-feathers");
  assert.equal(particleModeFromVisualTheme("xuanbird", "none"), "none");
  assert.equal(particleModeFromVisualTheme("xuanbird", "auto"), "black-feathers");
  assert.equal(particleModeFromVisualTheme("xuanbird", "invalid"), "black-feathers");
  for (const mobile of [true, false]) {
    assert.equal(particleCountForViewport(0, () => ({ matches: mobile })), 0);
    assert.equal(particleCountForViewport(70, () => ({ matches: mobile })), mobile ? 35 : 70);
  }
});

test("only follows theme accent when the previous default is still in use", () => {
  assert.equal(shouldSyncAccent("#ff8fab", "sakura"), true);
  assert.equal(shouldSyncAccent("#123456", "sakura"), false);
  assert.equal(shouldSyncAccent(null, "sakura"), true);
});

test("applies the visual theme to homepage entry icons", () => {
  const nodes = {
    ".ai-fab-icon": { textContent: "" },
    ".login-logo": { textContent: "" },
    ".music-fab-icon": { textContent: "" },
    ".music-logo": { textContent: "" },
    ".calendar-icon": { textContent: "" },
    ".calendar-logo": { textContent: "" },
  };
  const aiLogos = [{ textContent: "" }, { textContent: "" }];
  const doc = {
    documentElement: { dataset: {} },
    querySelector(selector) {
      return nodes[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector === ".ai-logo, .ai-empty-logo") return aiLogos;
      if (selector === ".music-fab-icon, .music-logo") return [nodes[".music-fab-icon"], nodes[".music-logo"]];
      if (selector === ".calendar-icon, .calendar-logo") return [nodes[".calendar-icon"], nodes[".calendar-logo"]];
      return [];
    },
  };

  const { applyVisualThemeDom } = require("../js/homepage-theme.js");
  applyVisualThemeDom(doc, "paper");

  assert.equal(nodes[".music-fab-icon"].textContent, "music");
  assert.equal(nodes[".music-logo"].textContent, "music");
  assert.equal(nodes[".calendar-icon"].textContent, "calendar");
  assert.equal(nodes[".calendar-logo"].textContent, "calendar");
  assert.equal(nodes[".ai-fab-icon"].textContent, "star");
  assert.notEqual(nodes[".music-fab-icon"].textContent, nodes[".ai-fab-icon"].textContent);
});

test("keeps themed entry icons declared across themes", () => {
  Object.values(VISUAL_THEMES).forEach((theme) => {
    assert.ok(theme.calendarLogo, `${theme.id} calendar logo should be declared`);
    assert.notEqual(theme.musicLogo, theme.aiLogo, `${theme.id} music logo should differ from AI logo`);
    assert.notEqual(theme.musicLogo, theme.fab, `${theme.id} music logo should differ from AI FAB icon`);
  });
});
