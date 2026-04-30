/* Navigation enrichment helpers: tags, metadata, and link health. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageNavInsights = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeTags(value) {
    const raw = Array.isArray(value) ? value : String(value || "").split(/[,，\s]+/);
    const seen = new Set();
    return raw
      .map((tag) => String(tag || "").trim())
      .filter(Boolean)
      .filter((tag) => {
        const key = tag.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);
  }

  function applyLinkHealth(link, result) {
    if (!link || !result) return link;
    link.health = {
      ok: !!result.ok,
      status: result.status || 0,
      checkedAt: result.checkedAt || Date.now(),
      error: result.error || "",
    };
    return link;
  }

  function healthClass(link) {
    if (!link || !link.health) return "unknown";
    if (link.health.ok) return "ok";
    if (link.health.status >= 400 || link.health.error) return "dead";
    return "warn";
  }

  function healthLabel(link) {
    if (!link || !link.health) return "未检查";
    if (link.health.ok) return link.health.status ? `可访问 · HTTP ${link.health.status}` : "可访问";
    if (link.health.status) return `异常 · HTTP ${link.health.status}`;
    return link.health.error ? `异常 · ${link.health.error}` : "异常";
  }

  function buildLinkCheckPayload(groups, limit = 50) {
    const urls = [];
    const seen = new Set();
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      (Array.isArray(group.links) ? group.links : []).forEach((link) => {
        const url = String(link && link.url || "").trim();
        if (!/^https?:\/\//i.test(url)) return;
        if (seen.has(url)) return;
        seen.add(url);
        if (urls.length < limit) urls.push(url);
      });
    });
    return { urls };
  }

  function mergeMetadata(link, meta) {
    if (!link || !meta) return link;
    if (!link.name && meta.title) link.name = meta.title;
    if (!link.desc && meta.description) link.desc = meta.description;
    if (!link.icon && meta.icon) link.icon = meta.icon;
    if (meta.tags) link.tags = normalizeTags([...(link.tags || []), ...normalizeTags(meta.tags)]);
    return link;
  }

  return {
    normalizeTags,
    applyLinkHealth,
    healthClass,
    healthLabel,
    buildLinkCheckPayload,
    mergeMetadata,
  };
});
