/* Bundle summary and diff helpers used by snapshots and maintenance UI. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageDataVersioning = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const categoryKeys = Object.freeze([
    "nav",
    "settings",
    "blog",
    "calendar",
    "ai",
    "chat",
    "music",
    "weather",
    "sync",
    "authCred",
    "schema",
    "savedAt",
  ]);

  function byteSize(value) {
    try {
      const raw = JSON.stringify(value ?? null);
      if (typeof Buffer !== "undefined" && Buffer.byteLength) return Buffer.byteLength(raw);
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(raw).length;
      return raw.length;
    } catch (_) {
      return String(value ?? "").length;
    }
  }

  function itemCount(key, value) {
    if (value == null) return 0;
    if (key === "nav") {
      const groups = Array.isArray(value.groups) ? value.groups : [];
      return groups.length + groups.reduce((sum, group) => sum + (Array.isArray(group.links) ? group.links.length : 0), 0);
    }
    if (key === "calendar") return (value.tasks || value.events || []).length;
    if (key === "blog") return (value.posts || []).length;
    if (key === "chat") return Array.isArray(value) ? value.length : 0;
    if (key === "music") return (value.tracks || []).length;
    if (key === "weather") return (value.cities || []).length;
    if (key === "ai") return (value.providers || []).length + (value.personas || []).length;
    if (Array.isArray(value)) return value.length;
    if (typeof value === "object") return Object.keys(value).length;
    return value ? 1 : 0;
  }

  function summarizeBundle(bundle) {
    const source = bundle && typeof bundle === "object" ? bundle : {};
    const keys = [...new Set([...categoryKeys, ...Object.keys(source)])];
    const categories = {};
    for (const key of keys) {
      const value = source[key];
      categories[key] = {
        key,
        exists: Object.prototype.hasOwnProperty.call(source, key),
        bytes: value == null ? 0 : byteSize(value),
        items: itemCount(key, value),
      };
    }
    return {
      schema: "sakura-bundle-summary@1",
      totalBytes: byteSize(source),
      categories,
    };
  }

  function diffBundleSummary(before, after) {
    const beforeCategories = (before && before.categories) || {};
    const afterCategories = (after && after.categories) || {};
    const keys = [...new Set([...Object.keys(beforeCategories), ...Object.keys(afterCategories)])];
    const categories = {};
    for (const key of keys) {
      const a = beforeCategories[key] || { bytes: 0, items: 0, exists: false };
      const b = afterCategories[key] || { bytes: 0, items: 0, exists: false };
      categories[key] = {
        key,
        before: a,
        after: b,
        changed: a.bytes !== b.bytes || a.items !== b.items || a.exists !== b.exists,
        delta: {
          bytes: (b.bytes || 0) - (a.bytes || 0),
          items: (b.items || 0) - (a.items || 0),
        },
      };
    }
    return {
      schema: "sakura-bundle-diff@1",
      totalDeltaBytes: (after?.totalBytes || 0) - (before?.totalBytes || 0),
      categories,
    };
  }

  return {
    categoryKeys,
    summarizeBundle,
    diffBundleSummary,
  };
});
