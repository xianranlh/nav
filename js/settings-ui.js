/* 设置面板可复用逻辑。
 * 这个文件只放无 DOM 副作用的小函数，方便继续把 app.js 里的设置逻辑迁移出来。
 */
(function () {
  "use strict";

  function resolveVisualThemeChange({ id, currentThemeId, currentAccent, themeApi } = {}) {
    const Theme = themeApi || window.HomepageTheme;
    if (!id || id === currentThemeId || !Theme || typeof Theme.getVisualTheme !== "function") {
      return null;
    }
    const meta = Theme.getVisualTheme(id);
    if (!meta) return null;

    const shouldSync =
      typeof Theme.shouldSyncAccent === "function" &&
      Theme.shouldSyncAccent(currentAccent, currentThemeId);
    const accent = shouldSync ? meta.accent : currentAccent;

    return {
      visualTheme: meta.id,
      accent,
      accentChanged: accent !== currentAccent,
    };
  }

  window.HomepageSettings = {
    resolveVisualThemeChange,
  };
})();
