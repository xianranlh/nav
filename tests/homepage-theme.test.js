const test = require("node:test");
const assert = require("node:assert/strict");

const {
  VISUAL_THEMES,
  DEFAULT_VISUAL_THEME_ID,
  getVisualTheme,
  particleModeFromVisualTheme,
  shouldSyncAccent,
} = require("../js/homepage-theme.js");

test("registers the four maintained homepage visual themes", () => {
  assert.deepEqual(
    Object.keys(VISUAL_THEMES).slice(0, 4),
    ["sakura", "q-anime", "dark-minimal", "paper"],
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
  assert.equal(particleModeFromVisualTheme("starlight"), "starlight");
  assert.equal(particleModeFromVisualTheme("sycamore"), "sycamore");
  assert.equal(particleModeFromVisualTheme("unknown"), "sakura");
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

  assert.equal(nodes[".music-fab-icon"].textContent, "🎼");
  assert.equal(nodes[".music-logo"].textContent, "🎼");
  assert.equal(nodes[".calendar-icon"].textContent, "🗓️");
  assert.equal(nodes[".calendar-logo"].textContent, "🗓️");
  assert.equal(nodes[".ai-fab-icon"].textContent, "📜");
  assert.notEqual(nodes[".music-fab-icon"].textContent, nodes[".ai-fab-icon"].textContent);
});

test("keeps themed entry icons declared across themes", () => {
  Object.values(VISUAL_THEMES).forEach((theme) => {
    assert.ok(theme.calendarLogo, `${theme.id} calendar logo should be declared`);
    assert.notEqual(theme.musicLogo, theme.aiLogo, `${theme.id} music logo should differ from AI logo`);
    assert.notEqual(theme.musicLogo, theme.fab, `${theme.id} music logo should differ from AI FAB icon`);
  });
});
