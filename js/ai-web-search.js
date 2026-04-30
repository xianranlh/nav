/* AI web search request helpers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageAIWebSearch = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SEARCH_SOURCES_INCLUDE = Object.freeze(["web_search_call.action.sources"]);

  function responsesEndpoint(baseUrl) {
    const base = String(baseUrl || "").replace(/\/+$/, "");
    if (/\/responses$/i.test(base)) return base;
    if (/\/v\d+$/i.test(base)) return `${base}/responses`;
    return `${base}/v1/responses`;
  }

  function isChatCompletionsSearchModel(model) {
    return /^(gpt-5-search-api|gpt-4o(?:-mini)?-search-preview)$/i.test(String(model || "").trim());
  }

  function textFromContent(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text") return part.text || "";
      if (part.type === "image_url") return "（包含一张图片附件）";
      return part.text || part.content || "";
    }).filter(Boolean).join("\n");
  }

  function buildResponsesSearchBody({ model, messages, searchContextSize = "medium" } = {}) {
    const instructions = [];
    const input = [];
    for (const message of Array.isArray(messages) ? messages : []) {
      const role = String(message && message.role || "user");
      const content = textFromContent(message && message.content).trim();
      if (!content) continue;
      if (role === "system" || role === "developer") {
        instructions.push(content);
      } else {
        input.push({
          role: role === "assistant" ? "assistant" : "user",
          content,
        });
      }
    }
    const body = {
      model: String(model || "").trim(),
      input,
      tools: [{ type: "web_search", search_context_size: searchContextSize }],
      tool_choice: "auto",
      include: SEARCH_SOURCES_INCLUDE.slice(),
    };
    if (instructions.length) body.instructions = instructions.join("\n\n");
    return body;
  }

  function buildChatCompletionsSearchBody({ model, messages, searchContextSize = "medium" } = {}) {
    return {
      model: String(model || "").trim(),
      messages: Array.isArray(messages) ? messages : [],
      stream: false,
      web_search_options: { search_context_size: searchContextSize },
    };
  }

  function isSafeHttpUrl(url) {
    return /^https?:\/\//i.test(String(url || "").trim());
  }

  function sourceKey(source) {
    return String(source && source.url || "").trim();
  }

  function pushSource(sources, seen, source) {
    const url = sourceKey(source);
    if (!isSafeHttpUrl(url) || seen.has(url)) return;
    seen.add(url);
    sources.push({
      url,
      title: String(source && (source.title || source.url) || url).trim(),
    });
  }

  function collectSources(value, sources, seen) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => collectSources(item, sources, seen));
      return;
    }
    if (value.type === "url_citation" || value.type === "citation") {
      pushSource(sources, seen, value);
    }
    if (value.url && (value.title || value.type || value.index != null)) {
      pushSource(sources, seen, value);
    }
    if (Array.isArray(value.sources)) {
      value.sources.forEach((source) => pushSource(sources, seen, source));
    }
    Object.values(value).forEach((item) => collectSources(item, sources, seen));
  }

  function collectTextParts(value, parts) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => collectTextParts(item, parts));
      return;
    }
    if ((value.type === "output_text" || value.type === "text") && typeof value.text === "string") {
      parts.push(value.text);
      return;
    }
    if (typeof value.content === "string" && value.role === "assistant") {
      parts.push(value.content);
      return;
    }
    Object.values(value).forEach((item) => collectTextParts(item, parts));
  }

  function extractResponsesText(payload) {
    if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
      return payload.output_text.trim();
    }
    const parts = [];
    collectTextParts(payload?.output || payload, parts);
    return parts.join("\n").trim();
  }

  function extractChatCompletionsText(payload) {
    return String(payload?.choices?.[0]?.message?.content || "").trim();
  }

  function markdownLabel(text) {
    return String(text || "来源").replace(/[[\]\\]/g, "\\$&").replace(/\s+/g, " ").trim() || "来源";
  }

  function renderSources(sources) {
    if (!sources.length) return "";
    return "\n\n**来源**\n" + sources
      .map((source, index) => `${index + 1}. [${markdownLabel(source.title)}](${source.url})`)
      .join("\n");
  }

  function renderResponsesMessage(payload) {
    const sources = [];
    collectSources(payload, sources, new Set());
    const text = extractResponsesText(payload) || "联网搜索已完成，但没有返回可展示内容。";
    return text + renderSources(sources);
  }

  function renderChatCompletionsMessage(payload) {
    const sources = [];
    collectSources(payload, sources, new Set());
    const text = extractChatCompletionsText(payload) || "联网搜索已完成，但没有返回可展示内容。";
    return text + renderSources(sources);
  }

  return {
    responsesEndpoint,
    isChatCompletionsSearchModel,
    buildResponsesSearchBody,
    buildChatCompletionsSearchBody,
    renderResponsesMessage,
    renderChatCompletionsMessage,
    extractResponsesText,
    extractChatCompletionsText,
  };
});
