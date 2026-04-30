/* AI operation preview and rollback helpers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./render-utils.js"));
  } else {
    root.HomepageAIActions = factory(root.SakuraRender);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Render) {
  "use strict";

  const escapeHtml = Render.escapeHtml;

  function deepClone(value) {
    if (typeof structuredClone === "function") {
      try { return structuredClone(value); } catch (_) {}
    }
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function snapshotState(state) {
    return {
      schema: "sakura-ai-action-snapshot@1",
      capturedAt: Date.now(),
      state: deepClone(state),
    };
  }

  function mutateTo(target, source) {
    if (!target || typeof target !== "object") return source;
    if (Array.isArray(target)) {
      target.splice(0, target.length, ...(Array.isArray(source) ? source.map(deepClone) : []));
      return target;
    }
    for (const key of Object.keys(target)) {
      if (!source || !Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
    }
    for (const [key, value] of Object.entries(source || {})) {
      if (target[key] && typeof target[key] === "object" && value && typeof value === "object") {
        mutateTo(target[key], value);
      } else {
        target[key] = deepClone(value);
      }
    }
    return target;
  }

  function rollbackState(target, snapshot) {
    if (!snapshot || snapshot.schema !== "sakura-ai-action-snapshot@1") {
      throw new Error("无效的回滚快照");
    }
    return mutateTo(target, snapshot.state);
  }

  function previewOne(action, state) {
    const op = String(action && action.op || "");
    const groups = Array.isArray(state && state.groups) ? state.groups : [];
    const type = op.startsWith("add") ? "add" : op.startsWith("delete") ? "delete" : op.startsWith("move") ? "move" : "update";
    const target = action.group || action.toGroup || action.name || action.title || action.url || op;
    const group = action.group ? groups.find((item) => item.name === action.group) : null;
    const exists = !!group || !action.group;
    return {
      op,
      type,
      target: String(target || op),
      risk: type === "delete" ? "high" : exists ? "low" : "medium",
      detail: action,
    };
  }

  function previewActions(actions, state) {
    const list = Array.isArray(actions) ? actions : [];
    const changes = list.map((action) => previewOne(action, state));
    return {
      total: changes.length,
      changes,
      destructive: changes.filter((change) => change.type === "delete").length,
      summary: changes.map((change) => `${change.type}:${change.target}`),
    };
  }

  function renderActionPreview(preview) {
    const changes = Array.isArray(preview && preview.changes) ? preview.changes : [];
    const rows = changes.map((change) => `
      <li class="ai-action-preview-item ${escapeHtml(change.type)}">
        <span>${escapeHtml(change.op)}</span>
        <strong>${escapeHtml(change.target)}</strong>
        <small>${escapeHtml(change.risk)}</small>
      </li>
    `).join("");
    return `<div class="ai-action-preview">
      <div class="ai-action-preview-head">预览 ${changes.length} 项变更</div>
      <ol>${rows}</ol>
    </div>`;
  }

  return {
    snapshotState,
    rollbackState,
    previewActions,
    renderActionPreview,
  };
});
