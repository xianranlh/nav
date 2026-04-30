/* Homepage theme registry and small DOM helpers.
 * Shared by app.js and node:test so visual theme rules stay centralized.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageTheme = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_VISUAL_THEME_ID = "sakura";

  const VISUAL_THEMES = Object.freeze({
    sakura: {
      id: "sakura",
      label: "樱 · 樱粉",
      accent: "#ff8fab",
      fab: "🌸",
      aiLogo: "🌸",
      musicLogo: "🎵",
      calendarLogo: "📅",
      particleMode: "sakura",
    },
    "q-anime": {
      id: "q-anime",
      label: "✨ Q 版二次元",
      accent: "#c4a8e8",
      fab: "✨",
      aiLogo: "✨",
      musicLogo: "🎧",
      calendarLogo: "🌟",
      particleMode: "candy-stars",
    },
    "dark-minimal": {
      id: "dark-minimal",
      label: "🌙 暗夜极简",
      accent: "#8da4c0",
      fab: "🌙",
      aiLogo: "🌙",
      musicLogo: "♫",
      calendarLogo: "◷",
      particleMode: "none",
    },
    paper: {
      id: "paper",
      label: "📜 复古纸质",
      accent: "#b07c4f",
      fab: "📜",
      aiLogo: "📜",
      musicLogo: "🎼",
      calendarLogo: "🗓️",
      particleMode: "sycamore",
    },
    starlight: {
      id: "starlight",
      label: "星光（旧）",
      accent: "#8b9fff",
      fab: "✨",
      aiLogo: "✨",
      musicLogo: "🎧",
      calendarLogo: "✨",
      particleMode: "starlight",
      legacy: true,
    },
    sycamore: {
      id: "sycamore",
      label: "梧桐叶（旧）",
      accent: "#c4a06e",
      fab: "🍂",
      aiLogo: "🍂",
      musicLogo: "🎶",
      calendarLogo: "🍁",
      particleMode: "sycamore",
      legacy: true,
    },
  });

  function getVisualTheme(id) {
    return VISUAL_THEMES[id] || VISUAL_THEMES[DEFAULT_VISUAL_THEME_ID];
  }

  function hasVisualTheme(id) {
    return Boolean(VISUAL_THEMES[id]);
  }

  function getPrimaryVisualThemes() {
    return ["sakura", "q-anime", "dark-minimal", "paper"].map(getVisualTheme);
  }

  function particleModeFromVisualTheme(id) {
    return getVisualTheme(id).particleMode || "sakura";
  }

  function shouldSyncAccent(currentAccent, previousThemeId) {
    if (!currentAccent) return true;
    return String(currentAccent).toLowerCase() === getVisualTheme(previousThemeId).accent.toLowerCase();
  }

  function applyVisualThemeDom(doc, themeId) {
    if (!doc || !doc.documentElement) return;
    const meta = getVisualTheme(themeId);
    doc.documentElement.dataset.visualTheme = meta.id;
    const fab = doc.querySelector(".ai-fab-icon");
    if (fab) fab.textContent = meta.fab;
    doc.querySelectorAll(".ai-logo, .ai-empty-logo").forEach((el) => {
      el.textContent = meta.aiLogo;
    });
    const loginLogo = doc.querySelector(".login-logo");
    if (loginLogo) loginLogo.textContent = meta.aiLogo;
    doc.querySelectorAll(".music-fab-icon, .music-logo").forEach((el) => {
      el.textContent = meta.musicLogo || meta.fab;
    });
    doc.querySelectorAll(".calendar-icon, .calendar-logo").forEach((el) => {
      el.textContent = meta.calendarLogo || "📅";
    });
  }

  function applyHeroModeDom(doc, mode) {
    if (!doc || !doc.documentElement) return;
    doc.documentElement.dataset.heroMode = mode || "compact";
  }

  function particleCountForViewport(baseCount, matchMediaFn) {
    const count = Number(baseCount) || 70;
    const isMobile = typeof matchMediaFn === "function" && matchMediaFn("(max-width: 768px)").matches;
    return isMobile ? Math.round(count / 2) : count;
  }

  return {
    DEFAULT_VISUAL_THEME_ID,
    VISUAL_THEMES,
    getPrimaryVisualThemes,
    getVisualTheme,
    hasVisualTheme,
    particleModeFromVisualTheme,
    shouldSyncAccent,
    applyVisualThemeDom,
    applyHeroModeDom,
    particleCountForViewport,
  };
});
