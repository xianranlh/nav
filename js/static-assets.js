/* Shared static asset manifest for the page, service worker, and tests. */
(function (root) {
  const VERSION = "v1.20.0";

  const stylesheets = Object.freeze([
    "css/styles.css",
    "css/settings.css",
    "css/ai.css",
    "css/calendar.css",
    "css/music.css",
    "css/weather.css",
    "css/cards.css",
  ]);

  const themeStylesheets = Object.freeze([
    "css/themes/sakura.css",
    "css/themes/q-anime.css",
    "css/themes/dark-minimal.css",
    "css/themes/paper.css",
  ]);

  const scripts = Object.freeze([
    "js/static-assets.js",
    "js/render-utils.js",
    "js/homepage-theme.js",
    "js/theme-editor.js",
    "js/homepage-layout.js",
    "js/link-ui.js",
    "js/nav-insights.js",
    "js/smart-search.js",
    "js/ai-ui.js",
    "js/ai-gallery.js",
    "js/calendar-ui.js",
    "js/calendar-planner.js",
    "js/background-ui.js",
    "js/storage-adapter.js",
    "js/sakura.js",
    "js/progress.js",
    "js/bookmarks.js",
    "js/auth.js",
    "js/ai-image.js",
    "js/ai-web-search.js",
    "js/ai.js",
    "js/blog.js",
    "js/calendar.js",
    "js/sync.js",
    "js/sync-ui.js",
    "js/sakura-remote.js",
    "js/sakura-media.js",
    "js/weather.js",
    "js/suggest.js",
    "js/exporter.js",
    "js/idb.js",
    "js/music.js",
    "js/storage-inspector.js",
    "js/settings-ui.js",
    "js/feature-registry.js",
    "js/app-modules.js",
    "js/media-cleanup.js",
    "js/ai-actions.js",
    "js/command-palette.js",
    "js/data-versioning.js",
    "js/lazy-init.js",
    "js/a11y.js",
  ]);

  const appScript = "js/app.js";
  const versionedAppScript = `${appScript}?v=${VERSION}`;
  const toCorePath = (file) => (file.startsWith("./") ? file : `./${file}`);

  const coreFiles = Object.freeze([
    "./",
    "./index.html",
    ...stylesheets.map(toCorePath),
    ...themeStylesheets.map(toCorePath),
    ...scripts.map(toCorePath),
    toCorePath(versionedAppScript),
    "./manifest.json",
  ]);

  const manifest = Object.freeze({
    VERSION,
    stylesheets,
    themeStylesheets,
    scripts,
    appScript,
    versionedAppScript,
    coreFiles,
  });

  root.SakuraStaticAssets = manifest;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = manifest;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
