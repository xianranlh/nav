/* Smart local search helpers for links and related content. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageSmartSearch = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[\s_-]+/g, "");
  }

  function linkText(link, group) {
    const tags = Array.isArray(link && link.tags) ? link.tags.join(" ") : String(link && link.tags || "");
    return [
      link && link.name,
      link && link.url,
      link && link.desc,
      tags,
      group && group.name,
    ].filter(Boolean).join(" ");
  }

  function fuzzyScore(text, query) {
    const hay = normalizeText(text);
    const needle = normalizeText(query);
    if (!needle) return 0;
    if (!hay) return 0;
    if (hay === needle) return 120;
    if (hay.startsWith(needle)) return 90;
    const idx = hay.indexOf(needle);
    if (idx >= 0) return Math.max(40, 80 - idx);
    let pos = 0;
    let gaps = 0;
    for (const char of needle) {
      const next = hay.indexOf(char, pos);
      if (next < 0) return 0;
      gaps += Math.max(0, next - pos);
      pos = next + 1;
    }
    return Math.max(8, 35 - gaps);
  }

  function scoreLink(link, group, query) {
    if (!query) return 0;
    const fields = [
      { value: link && link.name, weight: 1.25 },
      { value: link && link.url, weight: 1 },
      { value: link && link.desc, weight: 0.9 },
      { value: Array.isArray(link && link.tags) ? link.tags.join(" ") : link && link.tags, weight: 1.15 },
      { value: group && group.name, weight: 0.75 },
    ];
    return Math.max(...fields.map((field) => Math.round(fuzzyScore(field.value, query) * field.weight)));
  }

  function rankLinks(groups, query) {
    const out = [];
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      (Array.isArray(group.links) ? group.links : []).forEach((link) => {
        const score = scoreLink(link, group, query);
        if (score > 0) out.push({ link, group, score, text: linkText(link, group) });
      });
    });
    out.sort((a, b) => b.score - a.score || String(a.link.name || "").localeCompare(String(b.link.name || "")));
    return out;
  }

  function matchesLink(link, group, query) {
    if (!String(query || "").trim()) return true;
    return scoreLink(link, group, query) > 0;
  }

  function searchAll({ groups, tasks, posts, settings } = {}, query) {
    const results = rankLinks(groups, query).map((item) => ({ type: "link", ...item }));
    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
      const score = fuzzyScore([task.title, task.desc, (task.tags || []).join(" ")].join(" "), query);
      if (score > 0) results.push({ type: "task", task, score });
    });
    (Array.isArray(posts) ? posts : []).forEach((post) => {
      const score = fuzzyScore([post.title, post.summary, post.content].join(" "), query);
      if (score > 0) results.push({ type: "post", post, score });
    });
    Object.entries(settings || {}).forEach(([key, value]) => {
      const score = fuzzyScore(`${key} ${value}`, query);
      if (score > 0) results.push({ type: "setting", key, value, score });
    });
    return results.sort((a, b) => b.score - a.score);
  }

  return {
    normalizeText,
    fuzzyScore,
    scoreLink,
    rankLinks,
    matchesLink,
    searchAll,
  };
});
