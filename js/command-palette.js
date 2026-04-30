/* Keyboard command palette helpers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./render-utils.js"));
  } else {
    root.HomepageCommandPalette = factory(root.SakuraRender);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Render) {
  "use strict";

  const escapeHtml = Render.escapeHtml;

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function buildCommands(context = {}) {
    const groups = Array.isArray(context.groups) ? context.groups : [];
    const settings = context.settings || {};
    const commands = [
      { id: "focus-search", title: "聚焦搜索", group: "基础", keywords: ["search", "find", "搜索"] },
      { id: "add-link", title: "添加网址", group: "导航", keywords: ["link", "url", "新建"] },
      { id: "add-group", title: "新建分组", group: "导航", keywords: ["group", "folder", "分类"] },
      { id: "open-settings", title: "打开设置", group: "系统", keywords: ["settings", "配置"] },
      { id: "toggle-theme", title: "切换主题", group: "外观", keywords: ["theme", "dark", "light"] },
      { id: "open-calendar", title: "打开日历", group: "工具", keywords: ["calendar", "任务"] },
      { id: "open-ai", title: "打开 AI 对话", group: "工具", keywords: ["ai", "assistant"] },
      { id: "open-music", title: "打开音乐播放器", group: "工具", keywords: ["music", "audio"] },
      { id: "check-links", title: "检查链接健康", group: "维护", keywords: ["health", "link"] },
      { id: "storage-refresh", title: "刷新存储内容", group: "维护", keywords: ["storage", "backup", "SQLite"] },
    ];
    if (settings.showWeather !== false) {
      commands.push({ id: "refresh-weather", title: "刷新天气", group: "工具", keywords: ["weather", "城市"] });
    }
    for (const group of groups) {
      commands.push({
        id: `group:${group.id}`,
        title: `跳转到分组：${group.name}`,
        group: "分组",
        keywords: ["group", group.name],
        targetId: group.id,
      });
    }
    return commands;
  }

  function scoreCommand(command, query) {
    const q = normalizeText(query);
    if (!q) return 1;
    const haystack = [
      command.id,
      command.title,
      command.group,
      ...(command.keywords || []),
    ].map(normalizeText).join(" ");
    if (normalizeText(command.title).startsWith(q)) return 100;
    if ((command.keywords || []).map(normalizeText).includes(q)) return command.id.startsWith("group:") ? 95 : 85;
    if (haystack.includes(q)) return 50;
    const tokens = q.split(/\s+/).filter(Boolean);
    return tokens.every((token) => haystack.includes(token)) ? 25 : 0;
  }

  function filterCommands(commands, query) {
    return (Array.isArray(commands) ? commands : [])
      .map((command) => ({ command, score: scoreCommand(command, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title, "zh-CN"))
      .map((item) => item.command);
  }

  function renderCommandPalette(commands, query = "") {
    const rows = (Array.isArray(commands) ? commands : []).map((command, index) => `
      <button type="button" class="command-palette-item${index === 0 ? " active" : ""}" data-command-id="${escapeHtml(command.id)}">
        <span>${escapeHtml(command.title)}</span>
        <small>${escapeHtml(command.group || "")}</small>
      </button>
    `).join("");
    return `<div class="command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div class="command-palette-box">
        <input class="command-palette-input" value="${escapeHtml(query)}" placeholder="输入命令或分组..." aria-label="搜索命令" />
        <div class="command-palette-list" role="listbox">${rows || '<p class="hint">没有匹配命令</p>'}</div>
      </div>
    </div>`;
  }

  return {
    buildCommands,
    filterCommands,
    renderCommandPalette,
  };
});
