/* AI generated image gallery helpers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./render-utils.js"), require("./ai-ui.js"));
  } else {
    root.HomepageAIGallery = factory(root.SakuraRender, root.HomepageAIUI);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Render, AIUI) {
  "use strict";

  const escapeHtml = Render.escapeHtml;
  const safeUrl = Render.safeUrlAttribute;

  function safeImageSrc(src) {
    const value = safeUrl(src);
    if (!value) return "";
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return value;
    return /^https?:\/\//i.test(value) ? value : "";
  }

  function markdownImages(text) {
    const out = [];
    const seen = new Set();
    const re = /!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/)[^\s)]+)\)/gi;
    let match;
    while ((match = re.exec(String(text || "")))) {
      const src = safeImageSrc(match[2]);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push({ src, alt: match[1] || "AI 生成图片" });
    }
    return out;
  }

  function collectGalleryImages(messages) {
    const out = [];
    const seen = new Set();
    let lastPrompt = "";
    (Array.isArray(messages) ? messages : []).forEach((message, messageIndex) => {
      if (!message || message.role === "user") {
        lastPrompt = String(message && message.content || "").trim();
        return;
      }
      if (message.role !== "assistant") return;
      const images = [
        ...markdownImages(message.content),
        ...AIUI.extractGeneratedImages(message.content),
      ];
      images.forEach((image, imageIndex) => {
        const src = safeImageSrc(image.src);
        if (!src || seen.has(src)) return;
        seen.add(src);
        out.push({
          id: `ai-img-${messageIndex}-${imageIndex}`,
          src,
          alt: image.alt || "AI 生成图片",
          prompt: lastPrompt,
          messageIndex,
          ts: message.ts || 0,
        });
      });
    });
    return out;
  }

  function buildRegeneratePrompt(image) {
    const prompt = String(image && image.prompt || "").trim();
    const alt = String(image && image.alt || "这张图片").trim();
    return `请参考这张图「${alt}」重新生成一个优化版本。${prompt ? `原始需求：${prompt}` : "保持主题一致，但提升构图、清晰度和细节。"}`;
  }

  function renderGallery(images) {
    const items = Array.isArray(images) ? images : [];
    if (!items.length) {
      return `<div class="ai-gallery-empty">暂无 AI 图片</div>`;
    }
    return `<div class="ai-gallery-grid">
      ${items.map((item) => {
        const src = safeImageSrc(item.src);
        if (!src) return "";
        return `<article class="ai-gallery-card" data-ai-gallery-id="${escapeHtml(item.id)}">
          <button type="button" class="ai-gallery-preview" data-ai-gallery-preview title="预览图片">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(item.alt || "AI 生成图片")}" loading="lazy" referrerpolicy="no-referrer" />
          </button>
          <div class="ai-gallery-meta">
            <strong>${escapeHtml(item.alt || "AI 生成图片")}</strong>
            <span>${escapeHtml(item.prompt || "无关联提示词")}</span>
          </div>
          <div class="ai-gallery-actions">
            <button type="button" data-ai-gallery-save>保存</button>
            <button type="button" data-ai-gallery-copy-prompt>复制提示词</button>
            <button type="button" data-ai-gallery-regenerate>再生成</button>
          </div>
        </article>`;
      }).join("")}
    </div>`;
  }

  return {
    collectGalleryImages,
    buildRegeneratePrompt,
    renderGallery,
  };
});
