/* Shared rendering and value-safety helpers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SakuraRender = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function safeUrlAttribute(value) {
    const url = String(value ?? "").trim();
    if (!url) return "";
    if (/^(https?:|mailto:|tel:|blob:)/i.test(url)) return url;
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) return url;
    if (/^(\/(?!\/)|\.\/|\.\.\/)/.test(url)) return url;
    return "";
  }

  function safeCssColor(value, fallback = "#ff8fab") {
    const color = String(value ?? "").trim();
    if (!color) return fallback;
    if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
    if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*(?:0|1|0?\.\d+|[\d.]+%))?\s*\)$/i.test(color)) return color;
    if (/^hsla?\(\s*[\d.]+(?:deg|rad|turn)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*(?:0|1|0?\.\d+|[\d.]+%))?\s*\)$/i.test(color)) return color;
    if (/^[a-z]+$/i.test(color)) return color;
    return fallback;
  }

  return {
    escapeHtml,
    safeUrlAttribute,
    safeCssColor,
  };
});
