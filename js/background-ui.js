/* Background settings helpers.
 * Keep pure background-setting transformations outside app.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BackgroundUI = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_RANDOM_BG = "https://t.alcy.cc/ycy/";
  const MAX_UPLOAD_MB = 60;
  const VIDEO_EXT_RE = /\.(mp4|webm|mov|ogv|m4v)(\?|#|$)/i;
  const BING_ENDPOINTS = [
    "https://api.dujin.org/bing/1920.php",
    "https://bing.img.run/1920x1080.php",
  ];

  function parseUrlList(value) {
    const items = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
    return items.map((item) => String(item || "").trim()).filter(Boolean);
  }

  function isVideoUrl(url) {
    return typeof url === "string" && VIDEO_EXT_RE.test(url);
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    const k = 1024;
    if (bytes < k) return bytes + " B";
    if (bytes < k * k) return (bytes / k).toFixed(1) + " KB";
    return (bytes / k / k).toFixed(1) + " MB";
  }

  function cacheBust(url, now = Date.now) {
    if (!url) return url;
    const sep = url.includes("?") ? "&" : "?";
    return url + sep + "_=" + now();
  }

  function buildBingUrl(random = Math.random, now = Date.now) {
    const idx = Math.min(BING_ENDPOINTS.length - 1, Math.floor(random() * BING_ENDPOINTS.length));
    return cacheBust(BING_ENDPOINTS[idx], now);
  }

  function uploadKindFromFile(file) {
    if (!file) return "image";
    if (String(file.type || "").startsWith("video/")) return "video";
    return isVideoUrl(file.name || "") ? "video" : "image";
  }

  return {
    DEFAULT_RANDOM_BG,
    MAX_UPLOAD_MB,
    buildBingUrl,
    cacheBust,
    formatFileSize,
    isVideoUrl,
    parseUrlList,
    uploadKindFromFile,
  };
});
