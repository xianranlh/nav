/* Media cleanup helpers shared by the settings UI and server-side tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageMediaCleanup = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CATEGORIES = Object.freeze(["bg", "music", "lrc"]);
  const mediaUrlRe = /\/api\/media\/file\/(bg|music|lrc)\/([^"'`\s<>)?#]+)/gi;

  function normalizeMediaRef(category, filename) {
    const cat = String(category || "").trim();
    if (!CATEGORIES.includes(cat)) return "";
    const cleanName = String(filename || "").split(/[?#]/)[0];
    if (!cleanName) return "";
    try {
      return `${cat}/${decodeURIComponent(cleanName)}`;
    } catch (_) {
      return `${cat}/${cleanName}`;
    }
  }

  function collectReferencedMedia(value) {
    const refs = new Set();
    const seen = new WeakSet();
    const visit = (item) => {
      if (item == null) return;
      if (typeof item === "string") {
        let match;
        while ((match = mediaUrlRe.exec(item))) {
          const ref = normalizeMediaRef(match[1], match[2]);
          if (ref) refs.add(ref);
        }
        mediaUrlRe.lastIndex = 0;
        return;
      }
      if (typeof item !== "object") return;
      if (seen.has(item)) return;
      seen.add(item);
      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }
      Object.values(item).forEach(visit);
    };
    visit(value);
    return refs;
  }

  function flattenInventory(inventory) {
    const out = [];
    for (const category of CATEGORIES) {
      const files = Array.isArray(inventory && inventory[category]) ? inventory[category] : [];
      for (const file of files) {
        const filename = typeof file === "string" ? file : file && file.filename;
        if (!filename) continue;
        out.push({
          category,
          filename: String(filename),
          bytes: Number(file && file.bytes) || 0,
          url: file && file.url ? String(file.url) : `/api/media/file/${category}/${encodeURIComponent(filename)}`,
          mtime: Number(file && file.mtime) || 0,
          ref: `${category}/${String(filename)}`,
        });
      }
    }
    return out;
  }

  function classifyOrphanMedia(inventory, refs) {
    const referenced = refs instanceof Set ? refs : new Set(refs || []);
    const files = flattenInventory(inventory);
    const orphans = files.filter((file) => !referenced.has(file.ref));
    return {
      referenced,
      files,
      orphans,
      totalBytes: orphans.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0),
    };
  }

  function buildDeletePayload(orphanItems) {
    const items = (Array.isArray(orphanItems) ? orphanItems : [])
      .filter((item) => item && CATEGORIES.includes(item.category) && item.filename)
      .map((item) => ({ category: item.category, filename: String(item.filename) }));
    return { items };
  }

  function renderOrphanMediaSummary(result) {
    const orphans = Array.isArray(result && result.orphans) ? result.orphans : [];
    if (!orphans.length) return `<p class="hint media-cleanup-empty">没有发现孤儿媒体文件。</p>`;
    const rows = orphans.map((item) => `
      <li data-media-orphan="${escapeAttr(item.category)}/${escapeAttr(item.filename)}">
        <code>${escapeHtml(item.category)}/${escapeHtml(item.filename)}</code>
        <span>${formatBytes(item.bytes)}</span>
      </li>
    `).join("");
    return `<div class="media-cleanup-summary">
      <div class="media-cleanup-head">
        <strong>孤儿媒体 ${orphans.length} 个</strong>
        <span>${formatBytes(result.totalBytes)}</span>
      </div>
      <ul>${rows}</ul>
    </div>`;
  }

  function formatBytes(n) {
    const value = Number(n) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  return {
    CATEGORIES,
    collectReferencedMedia,
    classifyOrphanMedia,
    buildDeletePayload,
    renderOrphanMediaSummary,
  };
});
