/* 闲然导航 · Obsidian 知识客户端
 * 只访问同源 /api/knowledge；正文不会写入浏览器业务存储。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.window === root) root.SakuraKnowledge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  class KnowledgeApiError extends Error {
    constructor(message, { code = "KNOWLEDGE_UNAVAILABLE", status = 0 } = {}) {
      super(message || "知识服务暂不可用");
      this.name = "KnowledgeApiError";
      this.code = code;
      this.status = status;
    }
  }

  async function parseResponse(response) {
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new KnowledgeApiError(body?.message || friendlyError(body?.error, response.status), {
        code: body?.error || "KNOWLEDGE_UNAVAILABLE",
        status: response.status,
      });
    }
    return body || {};
  }

  function friendlyError(code, status) {
    const messages = {
      OBS_DISABLED: "服务器尚未启用 Obsidian 知识库",
      VAULT_NOT_CONFIGURED: "当前账号还没有配置 Vault 目录",
      INDEX_BUILDING: "正在建立知识索引，请稍后再试",
      NOTE_NOT_FOUND: "这篇笔记已移动或不存在",
      UNSAFE_PATH: "已阻止不安全的笔记路径",
      ATTACHMENT_NOT_FOUND: "附件已移动或不存在",
      ATTACHMENT_CHANGED: "附件已变化，请重新索引",
      UNSAFE_ATTACHMENT: "已阻止不安全的附件内容",
      REINDEX_RATE_LIMITED: "刚刚已经请求过重建，请稍后再试",
      INVALID_QUERY: "请输入 2–120 个字符进行搜索",
    };
    if (messages[code]) return messages[code];
    if (status === 401) return "登录已过期，请重新登录";
    if (status === 403) return "当前账号无权执行此操作";
    return "知识服务暂时无法连接";
  }

  function createClient(fetchImpl = root.fetch?.bind(root)) {
    if (typeof fetchImpl !== "function") throw new KnowledgeApiError("浏览器不支持网络请求");
    const request = async (path, options = {}) => {
      try {
        return await parseResponse(await fetchImpl(`/api/knowledge${path}`, {
          credentials: "same-origin",
          ...options,
          headers: {
            ...(options.body ? { "content-type": "application/json" } : {}),
            ...(options.headers || {}),
          },
        }));
      } catch (error) {
        if (error instanceof KnowledgeApiError || error?.name === "AbortError") throw error;
        throw new KnowledgeApiError("无法连接知识服务", { code: "KNOWLEDGE_UNAVAILABLE" });
      }
    };
    return {
      status: () => request("/status"),
      recent: (limit = 6) => request(`/recent?limit=${Math.min(20, Math.max(1, Number(limit) || 6))}`),
      tags: (limit = 30) => request(`/tags?limit=${Math.min(100, Math.max(1, Number(limit) || 30))}`),
      config: () => request("/config"),
      search: (query, limit = 12, signal) => request(`/search?q=${encodeURIComponent(String(query || "").trim())}&limit=${Math.min(20, Math.max(1, Number(limit) || 12))}`, { signal }),
      note: (noteId, signal) => request(`/notes/${encodeURIComponent(noteId)}`, { signal }),
      opened: (noteId) => request("/opened", { method: "POST", body: JSON.stringify({ noteId }) }),
      reindex: () => request("/reindex", { method: "POST", body: "{}" }),
      updateConfig: (patch) => request("/config", { method: "PATCH", body: JSON.stringify(patch || {}) }),
    };
  }

  function formatRelativeTime(value, now = Date.now()) {
    const delta = Math.max(0, now - Number(value || 0));
    if (delta < 60_000) return "刚刚";
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
    if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`;
    const date = new Date(Number(value || 0));
    return Number.isNaN(date.valueOf()) ? "" : `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  return { KnowledgeApiError, createClient, friendlyError, formatRelativeTime };
});
