const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadSettingsModule(themeApi) {
  const code = fs.readFileSync("js/settings-ui.js", "utf8");
  const sandbox = { window: { HomepageTheme: themeApi } };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.HomepageSettings;
}

test("settings UI resolves visual theme changes and synced accents", () => {
  const module = loadSettingsModule({
    getVisualTheme(id) {
      return id === "paper" ? { id: "paper", accent: "#b07c4f" } : null;
    },
    shouldSyncAccent(accent, currentThemeId) {
      return accent === "#ff8fab" && currentThemeId === "sakura";
    },
  });

  const next = module.resolveVisualThemeChange({
    id: "paper",
    currentThemeId: "sakura",
    currentAccent: "#ff8fab",
  });

  assert.equal(next.visualTheme, "paper");
  assert.equal(next.accent, "#b07c4f");
  assert.equal(next.accentChanged, true);
  assert.equal(
    module.resolveVisualThemeChange({
      id: "sakura",
      currentThemeId: "sakura",
      currentAccent: "#ff8fab",
    }),
    null,
  );
});
