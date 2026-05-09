/* Homepage layout helpers.
 * Keep data shaping out of the large app controller so rendering stays simple.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageLayout = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function collectStarredLinks(groups, limit = 20) {
    const list = [];
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      const links = Array.isArray(group && group.links) ? group.links : [];
      links.forEach((link) => {
        if (!link || !link.pinned) return;
        list.push({
          ...link,
          groupId: group.id,
          groupName: group.name,
        });
      });
    });
    return list.slice(0, Math.max(0, limit));
  }

  function shouldShowGroupTabs(groups, minGroups = 4) {
    return Array.isArray(groups) && groups.length >= minGroups;
  }

  function buildGroupTabItems(groups) {
    return (Array.isArray(groups) ? groups : []).map((group) => ({
      id: group.id,
      label: group.name || "未命名分组",
    }));
  }

  function createGroupDraft({ name, color, idFactory }) {
    const makeId = typeof idFactory === "function" ? idFactory : () => "";
    return {
      id: makeId(),
      name: String(name || "").trim() || "未命名分组",
      color: color || "#f6a5c0",
      links: [],
    };
  }

  return {
    collectStarredLinks,
    shouldShowGroupTabs,
    buildGroupTabItems,
    createGroupDraft,
  };
});
