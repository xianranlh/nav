/* Main app module boundary registry.
 * This file documents the coarse boundaries around js/app.js while features are
 * extracted into smaller helpers. It is intentionally declarative and testable.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./render-utils.js"));
  } else {
    root.HomepageAppModules = factory(root.SakuraRender);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Render) {
  "use strict";

  const escapeHtml = Render.escapeHtml;

  const MODULE_BOUNDARIES = Object.freeze([
    { id: "bootstrap", label: "启动与鉴权", owns: ["entry", "bootApp", "auth guard"], status: "active" },
    { id: "navigation", label: "导航分组与卡片", owns: ["renderGroup", "renderCard", "drag-sort"], status: "extracting" },
    { id: "settings", label: "设置表单与偏好", owns: ["bindSettings", "theme controls", "component toggles"], status: "extracting" },
    { id: "background", label: "背景与粒子", owns: ["Bg", "Sakura", "visual theme"], status: "modular" },
    { id: "calendar", label: "日历与任务", owns: ["UICal", "planner", "ics"], status: "modular" },
    { id: "ai", label: "AI 对话与指令", owns: ["UIAI", "gallery", "nav-action"], status: "modular" },
    { id: "storage", label: "存储、快照与媒体", owns: ["StorageInspector", "snapshots", "media cleanup"], status: "extracting" },
    { id: "sync", label: "同步与迁移", owns: ["UISync", "remote push/pull"], status: "modular" },
    { id: "weather", label: "天气与城市", owns: ["UIWeather", "WeatherUtils"], status: "extracting" },
  ]);

  function createAppModuleRegistry(boundaries = MODULE_BOUNDARIES) {
    const modules = boundaries.map((module, index) => ({
      order: index + 1,
      id: module.id,
      label: module.label,
      owns: Object.freeze([...(module.owns || [])]),
      status: module.status || "active",
    }));
    return {
      list: () => modules.map((module) => ({ ...module, owns: [...module.owns] })),
      get: (id) => modules.find((module) => module.id === id) || null,
      byStatus: (status) => modules.filter((module) => module.status === status),
    };
  }

  function renderModuleBoundarySummary(modules) {
    const rows = (Array.isArray(modules) ? modules : []).map((module) => `
      <li class="app-module-boundary" data-module-id="${escapeHtml(module.id)}">
        <strong>${escapeHtml(module.label || module.id)}</strong>
        <small>${escapeHtml(module.status || "active")}</small>
        <span>${escapeHtml((module.owns || []).join(" / "))}</span>
      </li>
    `).join("");
    return `<ol class="app-module-boundaries">${rows}</ol>`;
  }

  return {
    MODULE_BOUNDARIES,
    createAppModuleRegistry,
    renderModuleBoundarySummary,
  };
});
