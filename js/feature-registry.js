/* Declarative feature/module registry. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./render-utils.js"));
  } else {
    root.HomepageFeatureRegistry = factory(root.SakuraRender);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Render) {
  "use strict";

  const escapeHtml = Render.escapeHtml;

  const BUILTIN_MODULES = Object.freeze([
    { id: "ai", label: "AI 对话与图片图库", area: "assistant" },
    { id: "data", label: "数据快照与迁移", area: "storage" },
    { id: "navigation", label: "导航整理与链接健康", area: "homepage" },
    { id: "search", label: "智能搜索", area: "homepage" },
    { id: "calendar", label: "日历规划", area: "productivity" },
    { id: "themes", label: "主题编辑", area: "appearance" },
    { id: "plugins", label: "模块注册", area: "platform" },
    { id: "pwa", label: "离线与安装", area: "platform" },
  ]);

  function createFeatureRegistry({ disabled = [] } = {}) {
    const disabledSet = new Set(disabled);
    const modules = BUILTIN_MODULES.map((module) => ({ ...module, enabled: !disabledSet.has(module.id) }));
    return {
      list: () => modules.slice(),
      isEnabled: (id) => {
        const hit = modules.find((module) => module.id === id);
        return hit ? hit.enabled : !disabledSet.has(id);
      },
      setEnabled: (id, enabled) => {
        const hit = modules.find((module) => module.id === id);
        if (hit) hit.enabled = !!enabled;
      },
    };
  }

  function createPluginLifecycle() {
    const plugins = new Map();
    const callHook = async (plugin, hook, context) => {
      if (!plugin || typeof plugin[hook] !== "function") return { ok: true, skipped: true };
      await plugin[hook](context);
      return { ok: true, hook };
    };
    return {
      register(plugin) {
        if (!plugin || !plugin.id) throw new Error("Plugin requires an id");
        const record = {
          id: String(plugin.id),
          label: plugin.label || plugin.id,
          status: "registered",
          setup: plugin.setup,
          start: plugin.start,
          stop: plugin.stop,
          dispose: plugin.dispose,
        };
        plugins.set(record.id, record);
        return record;
      },
      list: () => [...plugins.values()].map((plugin) => ({ id: plugin.id, label: plugin.label, status: plugin.status })),
      async start(id, context) {
        const plugin = plugins.get(id);
        if (!plugin) throw new Error("Plugin not found: " + id);
        await callHook(plugin, "setup", context);
        await callHook(plugin, "start", context);
        plugin.status = "running";
        return plugin;
      },
      async stop(id, context) {
        const plugin = plugins.get(id);
        if (!plugin) throw new Error("Plugin not found: " + id);
        await callHook(plugin, "stop", context);
        plugin.status = "stopped";
        return plugin;
      },
      async dispose(id, context) {
        const plugin = plugins.get(id);
        if (!plugin) return false;
        await callHook(plugin, "dispose", context);
        plugins.delete(id);
        return true;
      },
    };
  }

  function renderModuleList(modules) {
    return `<div class="feature-module-list">
      ${(Array.isArray(modules) ? modules : []).map((module) => `
        <div class="feature-module-item" data-module-id="${escapeHtml(module.id)}">
          <span>${escapeHtml(module.label)}</span>
          <small>${escapeHtml(module.area)}</small>
          <b>${module.enabled === false ? "关闭" : "启用"}</b>
        </div>
      `).join("")}
    </div>`;
  }

  return {
    BUILTIN_MODULES,
    createFeatureRegistry,
    createPluginLifecycle,
    renderModuleList,
  };
});
