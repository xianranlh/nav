/* AI image generation endpoint helpers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageAIImage = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function isImageGenerationModel(model) {
    const value = String(model || "").trim().toLowerCase();
    return /^(gpt-image|dall-e)(?:-|$)/.test(value);
  }

  function imageGenerationEndpoint(baseUrl) {
    const base = String(baseUrl || "").replace(/\/+$/, "");
    return `${base}/images/generations`;
  }

  function buildImageGenerationBody({ model, prompt, n = 1, size = "1024x1024" } = {}) {
    return {
      model: String(model || "").trim(),
      prompt: String(prompt || "").trim(),
      n: Math.max(1, Math.min(4, Number(n) || 1)),
      size: String(size || "1024x1024"),
    };
  }

  function extractPromptFromMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const message = list[i];
      if (!message || message.role !== "user") continue;
      const content = message.content;
      if (typeof content === "string") return content.trim();
      if (Array.isArray(content)) {
        const text = content
          .filter((part) => part && part.type === "text")
          .map((part) => part.text || "")
          .join("\n")
          .trim();
        if (text) return text;
      }
    }
    return "";
  }

  function renderImageGenerationMessage(payload, prompt) {
    const body = payload && typeof payload === "object" ? payload : {};
    const compact = {
      data: Array.isArray(body.data) ? body.data.map((item) => ({
        url: item.url,
        b64_json: item.b64_json,
        revised_prompt: item.revised_prompt,
        alt: item.alt || item.revised_prompt || prompt || "AI 生成图片",
      })) : [],
      created: body.created,
    };
    return `已生成图片：${prompt || ""}\n\n\`\`\`json\n${JSON.stringify(compact, null, 2)}\n\`\`\``;
  }

  return {
    isImageGenerationModel,
    imageGenerationEndpoint,
    buildImageGenerationBody,
    extractPromptFromMessages,
    renderImageGenerationMessage,
  };
});
