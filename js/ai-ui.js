/* AI panel rendering helpers. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./render-utils.js"));
  } else {
    root.HomepageAIUI = factory(root.SakuraRender);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Render) {
  "use strict";

  const escapeHtml = Render.escapeHtml;
  const safeUrl = Render.safeUrlAttribute;

  function safeImageSrc(src, { allowAnyHttp = true } = {}) {
    const safe = safeUrl(src);
    if (!safe) return "";
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(safe)) return safe;
    if (!/^https?:\/\//i.test(safe)) return "";
    if (allowAnyHttp) return safe;
    return /\.(png|jpe?g|gif|webp|bmp|svg|avif)(?:[?#]|$)/i.test(safe) ? safe : "";
  }

  function downloadNameFromImage(src, alt = "ai-image") {
    const cleanAlt = String(alt || "ai-image")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "ai-image";
    if (/^data:image\/jpeg/i.test(src)) return `${cleanAlt}.jpg`;
    if (/^data:image\/webp/i.test(src)) return `${cleanAlt}.webp`;
    if (/^data:image\/gif/i.test(src)) return `${cleanAlt}.gif`;
    try {
      const pathname = new URL(src).pathname;
      const filename = pathname.split("/").pop() || "";
      const ext = (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.exec(filename) || [])[0];
      return `${cleanAlt}${ext || ".png"}`;
    } catch (_) {
      return `${cleanAlt}.png`;
    }
  }

  function renderPersonaOptions(personas, currentId) {
    return (Array.isArray(personas) ? personas : []).map((persona) => {
      const selected = persona.id === currentId ? "selected" : "";
      return `<option value="${escapeHtml(persona.id)}" ${selected}>${escapeHtml(persona.name)}</option>`;
    }).join("");
  }

  function modelChoices(provider) {
    if (!provider) return [];
    const models = provider.models && provider.models.length ? provider.models : [provider.defaultModel || "default"];
    return models.filter(Boolean);
  }

  function renderModelOptions(models, currentModel) {
    return (Array.isArray(models) ? models : []).map((model) => {
      const selected = model === currentModel ? "selected" : "";
      return `<option value="${escapeHtml(model)}" ${selected}>${escapeHtml(model)}</option>`;
    }).join("");
  }

  function renderEmptyState() {
    return `<div class="ai-empty">
      <div class="ai-empty-logo">🌸</div>
      <p>让 AI 帮你整理导航页。</p>
    </div>`;
  }

  function renderThinkingState(label = "正在思考") {
    const safeLabel = escapeHtml(label || "正在思考");
    return `<div class="ai-thinking" role="status" aria-live="polite">
      <span class="ai-thinking-orb" aria-hidden="true"></span>
      <span class="ai-thinking-text">${safeLabel}</span>
      <span class="ai-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    </div>`;
  }

  function renderAttachmentPreviewItem(attachment, index) {
    const name = escapeHtml(attachment && attachment.name);
    const dataUrl = escapeHtml(safeUrl(attachment && attachment.dataUrl));
    if (attachment && attachment.type === "image") {
      return `<img src="${dataUrl}"><span class="name">${name}</span><button class="x" data-i="${index}" type="button">×</button>`;
    }
    return `📄<span class="name">${name}</span><button class="x" data-i="${index}" type="button">×</button>`;
  }

  function renderUserContent(message) {
    let html = escapeHtml(message && message.content).replace(/\n/g, "<br>");
    const attachments = Array.isArray(message && message.attachments) ? message.attachments : [];
    if (attachments.length) {
      html += `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">`;
      html += attachments.map((attachment) => {
        if (attachment.type === "image") {
          return `<img class="ai-inline-img" src="${escapeHtml(safeUrl(attachment.dataUrl))}" style="max-height:120px" />`;
        }
        return `<span class="ai-attach-item">📄${escapeHtml(attachment.name)}</span>`;
      }).join("");
      html += `</div>`;
    }
    return html;
  }

  function renderImageCard({ src, alt = "AI 生成图片", id = "" }) {
    const safeSrc = safeImageSrc(src);
    if (!safeSrc) return "";
    const safeAlt = escapeHtml(alt || "AI 生成图片");
    const safeId = escapeHtml(id || "");
    return `<figure class="ai-image-card" ${safeId ? `data-ai-image-id="${safeId}"` : ""}>
      <button class="ai-image-preview" type="button" data-ai-image-preview title="预览图片">
        <img class="ai-inline-img" src="${escapeHtml(safeSrc)}" alt="${safeAlt}" loading="lazy" referrerpolicy="no-referrer" />
      </button>
      <figcaption>${safeAlt}</figcaption>
      <div class="ai-image-actions">
        <button type="button" data-ai-image-save>保存图片</button>
      </div>
    </figure>`;
  }

  function attrValue(attrs, name) {
    const re = new RegExp(`${name}=(["'])(.*?)\\1`, "i");
    return decodeHtmlAttribute((re.exec(attrs) || [])[2] || "");
  }

  function decodeHtmlAttribute(value) {
    return String(value || "").replace(/&(amp|lt|gt|quot|#39);/g, (match, entity) => ({
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      "#39": "'",
    }[entity] || match));
  }

  function enhanceAssistantMediaHtml(html) {
    return String(html || "").replace(/<img\b([^>]*\bclass=(["'])[^"']*\bai-inline-img\b[^"']*\2[^>]*)>/gi, (tag, attrs) => {
      const src = attrValue(attrs, "src");
      const alt = attrValue(attrs, "alt") || "AI 生成图片";
      const card = renderImageCard({ src, alt });
      return card || tag;
    });
  }

  function hasRenderedImageSrc(html, src) {
    const expected = safeImageSrc(src);
    if (!expected) return false;
    const re = /<img\b([^>]*)>/gi;
    let match;
    while ((match = re.exec(String(html || "")))) {
      if (attrValue(match[1], "src") === expected) return true;
    }
    return false;
  }

  function collectImagePayloads(value, out, seen) {
    if (!value || typeof value !== "object") return;
    if (typeof value.url === "string") {
      const src = safeImageSrc(value.url);
      if (src && !seen.has(src)) {
        seen.add(src);
        out.push({ src, alt: value.alt || value.revised_prompt || "AI 生成图片" });
      }
    }
    if (typeof value.b64_json === "string" && value.b64_json.trim()) {
      const src = `data:image/png;base64,${value.b64_json.trim()}`;
      if (!seen.has(src)) {
        seen.add(src);
        out.push({ src, alt: value.alt || value.revised_prompt || "AI 生成图片" });
      }
    }
    if (typeof value.image_url === "string") {
      const src = safeImageSrc(value.image_url);
      if (src && !seen.has(src)) {
        seen.add(src);
        out.push({ src, alt: value.alt || "AI 生成图片" });
      }
    } else if (value.image_url && typeof value.image_url.url === "string") {
      const src = safeImageSrc(value.image_url.url);
      if (src && !seen.has(src)) {
        seen.add(src);
        out.push({ src, alt: value.alt || "AI 生成图片" });
      }
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectImagePayloads(item, out, seen));
    } else {
      Object.values(value).forEach((item) => collectImagePayloads(item, out, seen));
    }
  }

  function parseMaybeJson(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed || !/^[{[]/.test(trimmed)) return null;
    try { return JSON.parse(trimmed); } catch (_) { return null; }
  }

  function extractGeneratedImages(text) {
    const out = [];
    const seen = new Set();
    const source = String(text || "");
    const candidates = [];
    const blockRe = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
    let match;
    while ((match = blockRe.exec(source))) candidates.push(match[1]);
    candidates.push(source);

    for (const candidate of candidates) {
      const parsed = parseMaybeJson(candidate);
      if (parsed) collectImagePayloads(parsed, out, seen);
    }

    const dataRe = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;
    while ((match = dataRe.exec(source))) {
      const src = safeImageSrc(match[0]);
      if (src && !seen.has(src)) {
        seen.add(src);
        out.push({ src, alt: "AI 生成图片" });
      }
    }
    return out;
  }

  function renderGeneratedImages(images) {
    const cards = (Array.isArray(images) ? images : [])
      .map((image, index) => renderImageCard({ ...image, id: `generated-${index}` }))
      .filter(Boolean)
      .join("");
    return cards ? `<div class="ai-generated-images">${cards}</div>` : "";
  }

  function renderActionCard(actions, id, previewHtml = "") {
    const items = (Array.isArray(actions) ? actions : []).map((action) => {
      const op = String(action && action.op || "");
      const cls = op.startsWith("add") ? "op-add" : op.startsWith("delete") ? "op-delete" : "op-rename";
      const detail = Object.fromEntries(Object.entries(action || {}).filter(([key]) => key !== "op"));
      return `<li><span class="badge ${cls}">${escapeHtml(op)}</span>${escapeHtml(JSON.stringify(detail))}</li>`;
    }).join("");
    return `<div class="ai-action-card" data-actid="${escapeHtml(id)}"><h5>🛠 AI 请求执行以下操作</h5><ol>${items}</ol>
      ${previewHtml || ""}
      <div class="ai-action-apply">
        <button class="btn-apply" data-apply="${escapeHtml(id)}">✅ 应用</button>
        <button class="btn-ignore" data-apply="${escapeHtml(id)}" data-ignore="1">忽略</button>
      </div></div>`;
  }

  function renderAppliedResult(result) {
    const notes = Array.isArray(result && result.notes) ? result.notes : [];
    const rollback = result?.rollbackSnapshot && !result?.rollbackUsed
      ? `<button type="button" class="btn-secondary" data-ai-action-rollback>撤销本次操作</button>`
      : result?.rollbackUsed
        ? `<small class="hint">已撤销本次操作</small>`
        : "";
    return `<div class="ai-action-card applied"><h5>✓ 已执行（${Number(result?.ok || 0)} 成功 / ${Number(result?.fail || 0)} 失败）</h5><ol>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ol>${rollback}</div>`;
  }

  return {
    renderPersonaOptions,
    modelChoices,
    renderModelOptions,
    renderEmptyState,
    renderThinkingState,
    renderAttachmentPreviewItem,
    renderUserContent,
    renderImageCard,
    enhanceAssistantMediaHtml,
    hasRenderedImageSrc,
    extractGeneratedImages,
    renderGeneratedImages,
    downloadNameFromImage,
    renderActionCard,
    renderAppliedResult,
  };
});
