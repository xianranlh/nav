/* Custom visual theme draft helpers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./render-utils.js"));
  } else {
    root.HomepageThemeEditor = factory(root.SakuraRender);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Render) {
  "use strict";

  const escapeHtml = Render.escapeHtml;
  const safeCssColor = Render.safeCssColor;

  const PARTICLE_MODES = new Set(["sakura", "candy-stars", "starlight", "sycamore", "none"]);

  function createCustomThemeDraft(input = {}) {
    const accent = safeCssColor(input.accent, "#ff8fab");
    const particleMode = PARTICLE_MODES.has(input.particleMode) ? input.particleMode : "sakura";
    const label = String(input.label || "我的主题").trim().slice(0, 32) || "我的主题";
    return {
      id: "custom",
      label,
      accent,
      particleMode,
      cssVars: {
        "--accent": accent,
        "--accent-strong": accent,
      },
    };
  }

  function renderThemeSummary(theme) {
    const draft = createCustomThemeDraft(theme);
    return `<div class="theme-summary">
      <span class="theme-swatch" style="background:${escapeHtml(draft.accent)}"></span>
      <strong>${escapeHtml(draft.label)}</strong>
      <span>${escapeHtml(draft.particleMode)}</span>
    </div>`;
  }

  function applyCustomThemeSettings(settings, draftInput) {
    const draft = createCustomThemeDraft(draftInput);
    settings.customVisualTheme = draft;
    settings.visualTheme = "custom";
    settings.accent = draft.accent;
    settings.particleMode = draft.particleMode;
    return settings;
  }

  return {
    createCustomThemeDraft,
    renderThemeSummary,
    applyCustomThemeSettings,
  };
});
