/* Link dialog helpers kept outside the main app controller. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./render-utils.js"), require("./nav-insights.js"));
  } else {
    root.HomepageLinkUI = factory(root.SakuraRender, root.HomepageNavInsights);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Render, NavInsights) {
  "use strict";

  const escapeHtml = Render.escapeHtml;

  function normalizeUrl(value) {
    const url = String(value ?? "").trim();
    if (!url) return "";
    return /^https?:\/\//i.test(url) ? url : "https://" + url;
  }

  function buildGroupOptionsHtml(groups) {
    return (Array.isArray(groups) ? groups : []).map((group) => {
      const id = escapeHtml(group && group.id);
      const name = escapeHtml((group && group.name) || "未命名分组");
      return `<option value="${id}">${name}</option>`;
    }).join("");
  }

  function resolveSelectedGroupId(groups, selectedId) {
    if (selectedId) return selectedId;
    return (Array.isArray(groups) && groups[0] && groups[0].id) || "";
  }

  function createInlineGroupDraft({ name, color, idFactory }) {
    const makeId = typeof idFactory === "function" ? idFactory : () => "";
    return {
      id: makeId(),
      name: String(name || "").trim() || "未命名分组",
      color: color || "#f6a5c0",
      links: [],
    };
  }

  function linkPayloadFromFormData(data, fallbackName) {
    const url = normalizeUrl(data && data.url);
    return {
      name: (data && data.name) || fallbackName || url,
      url,
      icon: (data && data.icon) || "",
      desc: (data && data.desc) || "",
      tags: NavInsights && NavInsights.normalizeTags
        ? NavInsights.normalizeTags(data && data.tags)
        : String(data && data.tags || "").split(/[,，\s]+/).filter(Boolean),
    };
  }

  return {
    normalizeUrl,
    buildGroupOptionsHtml,
    resolveSelectedGroupId,
    createInlineGroupDraft,
    linkPayloadFromFormData,
  };
});
