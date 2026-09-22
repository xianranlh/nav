/* Shared image protocols. Browser and server inject transport and status hooks. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createAIImageAPI = factory;
})(globalThis, function (deps) {
  "use strict";
  const { buildFetchTarget, buildHttpError, sleepWithSignal, recordProbeOk, recordProbeError,
    recordCooldown, isCooldownError, cooldownSeconds, isRetryableGatewayError } = deps;
  const fetch = deps.fetch || globalThis.fetch;
  const window = deps.runtime || globalThis;
  const console = deps.console || globalThis.console;
  /** 从当前 provider 的模型列表里挑出"看起来像图片专用生成模型"的候选，给错误提示用。
   *  Gemini 系（gemini-*-image / -image-preview）现在也算进来了 —— nav 检测到这种模型会自动改走
   *  /v1beta/models/{model}:generateContent 的 Google 原生分支，不再被 /images/generations 那条路拒。 */
  function suggestImageModels() {
    try {
      const p = window.AI?.AIStore?.currentProvider?.();
      if (!p || !Array.isArray(p.models)) return [];
      return p.models.filter((m) =>
        /^imagen[\d._-]|^gpt-image-1\b|^dall.?e[-\d]|^sdxl(\b|-)|^flux(\b|-)|^midjourney|^nano-?banana|^gemini[-_].*image/i.test(m));
    } catch (_) { return []; }
  }

  /** 把生图常见错误翻译成可操作的中文提示。
   *  借鉴 ChatGpt-Image-Studio web/src/app/image/submit-utils.ts 的 formatImageErrorMessage。 */
  function formatImageErrorMessage(message) {
    const trimmed = String(message || "").trim();
    if (!trimmed) return "处理图片失败";
    const normalized = trimmed.toLowerCase();
    // ===== 模型不被上游接受用于生图 =====
    // 兼容 ai.centos.hk 这类中转的具体话术 + 通用 OpenAI/Anthropic/Google 风格的措辞
    const looksLikeUnsupportedModel =
      normalized.includes("not supported model for image generation") ||
      (normalized.includes("only") && normalized.includes("imagen") && normalized.includes("supported")) ||
      normalized.includes("model does not support image generation") ||
      normalized.includes("model not supported for images") ||
      (normalized.includes("invalid model") && normalized.includes("image"));
    if (looksLikeUnsupportedModel) {
      const candidates = suggestImageModels();
      const tail = candidates.length
        ? `\n你这家供应商列表里这些是真正的图片生成模型，可以切过去试：${candidates.slice(0, 5).map((m) => "「" + m + "」").join("、")}`
        : "\n你这家供应商当前的模型列表里没有真正的图片专用模型（注意：gemini-*-image-preview 和 gpt-image-2 这类名字看着像但实际很多中转不接受）。\n建议：① 进 AI 设置 → 编辑供应商 → ↻ 获取模型 重新拉一遍模型列表，看是否有 imagen-*、gpt-image-1、dall-e-*、flux-* 这类名字；② 如果都没有，这个中转可能就不开放图片生成接口，需要换一个支持的供应商（比如 OpenAI 直连用 dall-e-3）。";
      return "❌ 上游不接受当前模型用于图片生成。这家中转的 /images/generations 接口只认特定的图片专用模型（通常是 imagen-*、gpt-image-1、dall-e-* 之类）。" + tail;
    }
    if (normalized.includes("an error occurred while processing your request")) {
      const requestId = trimmed.match(/request id\s+([a-z0-9-]+)/i)?.[1];
      return [
        "提示词内容过多，或当前分辨率/质量组合过高。",
        "建议减少提示词内容，或降低分辨率、质量后重试。",
        requestId ? `请求 ID：${requestId}` : "",
      ].filter(Boolean).join("\n");
    }
    if (normalized.includes("no images generated") && normalized.includes("model may have refused")) {
      return "没有生成图片，模型可能检测到敏感内容拒绝了请求。建议调整提示词后重试。";
    }
    if (normalized.includes("timed out waiting for async image generation")) {
      return "图片生成等待超时。建议稍后重试，或降低分辨率/质量。";
    }
    if (normalized.includes("safety system") || normalized.includes("content policy")) {
      return "提示词触发了内容安全策略。请修改后重试。";
    }
    if (normalized.includes("billing") || normalized.includes("quota") || normalized.includes("insufficient")) {
      return "上游账号配额或余额不足。请联系供应商或换一个账号。";
    }
    if (normalized.includes("上游返回空响应")) {
      return [
        "❌ 上游返回了 200 OK 但 body 完全是空的。",
        "这通常意味着：",
        "  ① 中转把请求路由到了一个根本不会返回数据的后端（配置错误）；",
        "  ② 中转 / 反向代理在转发时把 body 截断或丢弃了；",
        "  ③ 你选择的模型在这家中转上没绑定真实后端，被静默 noop 了。",
        "建议联系你这家中转的站长，或换一家明确支持你目标模型的供应商。",
      ].join("\n");
    }
    if (normalized.includes("上游返回了 html")) {
      return [
        "❌ 上游返回了 HTML 页面而不是 JSON。",
        "通常是请求被前置反向代理（Cloudflare、Nginx 错误页、登录墙等）拦了，没真正落到 API。",
        "建议：① 检查 baseUrl 是否正确（应该是 .../v1 而不是网站首页）；② 确认 API Key 没过期；③ 试一下命令行 curl 同样的 URL 看能不能通。",
      ].join("\n");
    }
    return trimmed;
  }

  // ===================== SSE 工具 =====================
  /** 通用 Server-Sent Events 解析器。
   *  借鉴 Image-Studio（github.com/RoseKhlifa/Image-Studio）的设计思路：
   *  - Responses API 的 partial_image 事件单行 base64 可超 4MB，浏览器 ReadableStream
   *    天然支持任意大 chunk，不像 Go bufio 有 64KB 截断问题
   *  - event 边界是 \n\n；同一 event 的 data: 可以多行，要拼起来
   *  - 调用方传 onEvent({event, data, raw})，data 已是 string（未 JSON.parse）
   *  - signal 可中止整个流（AbortController.signal） */
  async function readSseStream(response, onEvent, signal) {
    if (!response.body) throw new Error("响应没有 body，无法流式读取");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    function emit(block) {
      let event = "message";
      const data = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) onEvent({ event, data: data.join("\n"), raw: block });
    }
    try {
      for (;;) {
        signal?.throwIfAborted();
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          emit(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
        }
        if (done) { if (buffer.trim()) emit(buffer); break; }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  // ===================== 生图（Responses API · SSE 保活） =====================
  /** 借鉴 Image-Studio 的 payload.go BuildPayload：
   *  把生图请求伪装成"工具调用"塞进 /v1/responses 流式接口，模型边推理边发心跳事件，
   *  Cloudflare 看到持续流量就不会按 524/504 切链路。
   *
   *  事件参考（来自 Image-Studio sse.go SummarizeSSELine）：
   *    response.created                          — 请求已创建
   *    response.in_progress                      — 模型处理中
   *    response.image_generation_call.in_progress / .generating — 图工具运行中
   *    response.image_generation_call.partial_image{ partial_image_b64, revised_prompt }
   *    response.output_item.done{ item:{type:"image_generation_call", result, revised_prompt} }
   *    response.completed
   *
   *  返回 [{ dataUrl, revisedPrompt, sourceEvent: "final"|"partial" }]
   *  抛错时若 err.partial 存在 → 调用方可以决定要不要兜底用这个半成品 */
  async function imageRequestResponses({
    provider, model, prompt, size, quality, n, signal, onPartial, textModel,
  }) {
    const t = buildFetchTarget(provider, "responses");
    const tool = {
      type: "image_generation",
      model,                                // 图模型，如 gpt-image-2 / gpt-image-1
      action: "generate",
      size: (size && size !== "auto") ? size : "1024x1024",
      quality: (quality && quality !== "auto") ? quality : "auto",
      output_format: "png",
      moderation: "low",
      partial_images: Math.max(0, Math.min(3, +n || 0)),   // 0 表示不要 partial；>0 表示让上游每 N 步推一次
    };
    // 重要：body.model 不再写死 "gpt-5.5"（Image-Studio 默认）—— 大多数中转没这个模型。
    // 默认用用户当前选的模型 → 单模型中转也能跑；高级用户可通过 textModel 显式分离 text/image。
    const driver = (textModel && textModel.trim()) || model;

    // 前置检查：driver 必须是聊天/推理模型；如果看起来是图像专用模型（gpt-image-* / dall-e-* / imagen-* / flux-* / sdxl-*），
    // 上游 100% 会返 400（因为不能用图模型驱动 Responses）。提前抛友好错误，省 600s 等待。
    if (/^(gpt-image-|dall.?e[-\d]|imagen[-\d]|flux[-\d_]|sdxl|stable-diffusion|midjourney|nano-?banana)/i.test(driver)) {
      const err = new Error(
        `Responses 模式需要文本驱动模型（gpt-4o / gpt-5 / claude-* 等），不能用图像专用模型 "${driver}"。\n` +
        `修法：在生图参数行的"文本驱动"字段填一个文本模型，或把 API 模式切回 Images。`
      );
      err.status = 0;
      err.localCheck = true;     // 标记是前端检查，重试 / 降级路径都跳过它
      err.skipFallback = false;  // 但允许走自动降级到 Images
      throw err;
    }
    const body = {
      model: driver,
      input: [{
        role: "user",
        content: [{ type: "input_text", text: String(prompt || "").slice(0, 4000) }],
      }],
      tools: [tool],
      tool_choice: { type: "image_generation" },
      reasoning: { effort: "xhigh" },
      store: false,
      stream: true,
    };

    const r = await fetch(t.url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        ...t.headers,
      },
      body: JSON.stringify(body),
    });

    // 非 2xx 直接抛，body 给重试判定器用
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error(
        "[ai][responses] 上游返回 %s\ndriver=%s  imageModel=%s  size=%s\n请求体: %o\n上游 body:\n%s",
        r.status, driver, model, tool.size,
        body, txt.slice(0, 4000)
      );
      throw buildHttpError(r.status, txt);
    }

    let finalB64 = "", finalPrompt = "", finalReceived = false;
    let partialB64 = "", partialPrompt = "";
    let lastErrorEvent = "";
    let heartbeats = 0;

    const onSseEvent = ({ event, data }) => {
      // OpenAI Responses API 真正的事件类型在 JSON payload 的 type 字段里
      let ev;
      try { ev = JSON.parse(data); } catch (_) { return; }
      const evType = ev.type || event || "";
      heartbeats++;

      if (evType === "response.image_generation_call.partial_image") {
        const b64 = ev.partial_image_b64 || "";
        const rev = ev.revised_prompt || "";
        if (b64) {
          partialB64 = b64;
          if (rev) partialPrompt = rev;
          try { onPartial?.({ b64, revisedPrompt: rev, heartbeats }); } catch (_) {}
        }
        return;
      }
      if (evType === "response.output_item.done") {
        const item = ev.item || {};
        if (item.type === "image_generation_call" && typeof item.result === "string" && item.result) {
          finalB64 = item.result;
          finalPrompt = item.revised_prompt || partialPrompt || "";
          finalReceived = true;
        }
        return;
      }
      // 上游错误事件
      if (ev.error || (ev.response && ev.response.error)) {
        const e = ev.error || ev.response.error;
        lastErrorEvent = JSON.stringify(e);
      }
    };

    try {
      await readSseStream(r, onSseEvent, signal);
    } catch (streamErr) {
      // 中途流断了：跟 Image-Studio 一样——如果已收齐 final，那就当成功
      if (finalReceived && finalB64) {
        return [{ dataUrl: "data:image/png;base64," + finalB64, revisedPrompt: finalPrompt, sourceEvent: "final" }];
      }
      // 否则把 partial 挂在异常上让调用方决定要不要兜底
      const wrapped = streamErr?.name === "AbortError" ? streamErr : new Error("Responses 流被中断：" + (streamErr?.message || streamErr));
      if (partialB64) {
        wrapped.partial = { dataUrl: "data:image/png;base64," + partialB64, revisedPrompt: partialPrompt };
      }
      if (lastErrorEvent) wrapped.upstreamError = lastErrorEvent;
      throw wrapped;
    }

    if (finalReceived && finalB64) {
      return [{ dataUrl: "data:image/png;base64," + finalB64, revisedPrompt: finalPrompt, sourceEvent: "final" }];
    }
    if (partialB64) {
      // 流正常结束但没收到 final，只有 partial —— 返回 partial 当兜底
      return [{ dataUrl: "data:image/png;base64," + partialB64, revisedPrompt: partialPrompt, sourceEvent: "partial" }];
    }
    const err = new Error("Responses 流结束但没解析到任何图片" + (lastErrorEvent ? "：" + lastErrorEvent : ""));
    err.upstreamError = lastErrorEvent;
    throw err;
  }

  // ===================== 生图（/v1/images/generations） =====================
  /** UI 下拉里能选的常见尺寸；除此之外用户还能切换到"自定义"。 */
  const IMAGE_SIZES = [
    { value: "auto",       label: "auto · 让模型自己定" },
    { value: "1024x1024",  label: "1024 × 1024 · 1:1" },
    { value: "1024x1536",  label: "1024 × 1536 · 2:3" },
    { value: "1536x1024",  label: "1536 × 1024 · 3:2" },
    { value: "1024x1792",  label: "1024 × 1792 · 9:16（DALL·E 3）" },
    { value: "1792x1024",  label: "1792 × 1024 · 16:9（DALL·E 3）" },
    { value: "2048x2048",  label: "2048 × 2048 · 1:1（2K 方）" },
    { value: "2160x3840",  label: "2160 × 3840 · 9:16（4K 竖）" },
    { value: "3840x2160",  label: "3840 × 2160 · 16:9（4K 横）" },
    { value: "custom",     label: "自定义尺寸…" },
  ];
  const IMAGE_QUALITIES = [
    { value: "auto",     label: "auto · 让模型自己定" },
    { value: "low",      label: "low · 省 Token（gpt-image-1）" },
    { value: "medium",   label: "medium · 平衡" },
    { value: "high",     label: "high · 最佳（最慢）" },
    { value: "standard", label: "standard · DALL·E 3" },
    { value: "hd",       label: "hd · DALL·E 3 高清" },
  ];

  /** 检测是不是 Google Gemini 系的图片生成模型（不走标准 OpenAI /images/generations，而是 Google 原生 /v1beta/models/{model}:generateContent）。
   *  匹配 gemini-*-image-* 和 gemini-*-image 这种命名约定。 */
  function isGeminiImageModel(model) {
    return /^gemini[-_]/i.test(String(model || "")) && /image/i.test(String(model || ""));
  }

  /** 从 OpenAI 兼容 baseUrl（"https://ai.centos.hk/v1"）推导出 Google 原生 baseUrl（"https://ai.centos.hk/v1beta"）。
   *  策略：去掉末尾的 /v1 / /v2 / /v1beta，再补上 /v1beta。 */
  function geminiNativeBase(provider) {
    let host = String(provider?.baseUrl || "").trim().replace(/\/+$/, "");
    host = host.replace(/\/v\d+(beta)?$/i, "");
    return host + "/v1beta";
  }

  /** 把 nav 的 size string（"1024x1024"）和 quality 翻译成 Google 原生 imageConfig 字段：aspectRatio + imageSize。 */
  function geminiImageConfigFromOpts(size, quality) {
    const cfg = {};
    if (size && size !== "auto" && /^\d+x\d+$/.test(size)) {
      const [w, h] = size.split("x").map(Number);
      // 用最大公约数化简成 W:H
      const gcd = (a, b) => b ? gcd(b, a % b) : a;
      const g = gcd(w, h) || 1;
      cfg.aspectRatio = `${w / g}:${h / g}`;
      // 4K / 2K / 1K：Google 用大写字符串
      const longSide = Math.max(w, h);
      if (longSide >= 3840) cfg.imageSize = "4K";
      else if (longSide >= 2048) cfg.imageSize = "2K";
      else if (longSide >= 1024) cfg.imageSize = "1K";
    }
    return Object.keys(cfg).length ? cfg : null;
  }

  /** Gemini 原生 generateContent：POST {base}/models/{model}:generateContent
   *  - body: { contents:[{parts:[{text:"..."}]}], generationConfig:{ responseModalities:["TEXT","IMAGE"], imageConfig:{...} } }
   *  - 鉴权：Authorization Bearer 优先，部分中转可能要 x-goog-api-key（这里两套都带上）
   *  - 通过本机 ai-proxy 走，沿用 X-Sakura-Target-Base / Auth 头，base 改成 v1beta */
  async function imageRequestGemini({ provider, model, prompt, size, quality, signal, images = [] }) {
    const sub = "models/" + encodeURIComponent(model) + ":generateContent";
    const nativeBase = geminiNativeBase(provider);
    // 沿用 buildFetchTarget 的反代决策（auto / 强制反代 / 强制直连）
    let useProxy;
    if (provider.useProxy === true) useProxy = true;
    else if (provider.useProxy === false) useProxy = false;
    else useProxy = !!(window.AI && window.AI.AIStore && window.AI.AIStore.proxyAvailable);
    const url = useProxy ? "/api/ai-proxy/" + sub : nativeBase + "/" + sub;
    const headers = { "Content-Type": "application/json" };
    if (useProxy) {
      headers["X-Sakura-Target-Base"] = nativeBase;
      headers["X-Sakura-Target-Auth"] = "Bearer " + (provider.apiKey || "");
    } else {
      headers["Authorization"] = "Bearer " + (provider.apiKey || "");
      headers["x-goog-api-key"] = provider.apiKey || "";
    }
    const generationConfig = {
      responseModalities: ["TEXT", "IMAGE"],
    };
    const imgCfg = geminiImageConfigFromOpts(size, quality);
    if (imgCfg) generationConfig.imageConfig = imgCfg;

    const body = {
      contents: [{ parts: [{ text: String(prompt || "").slice(0, 4000) }, ...images.map(data => {
        const m = /^data:([^;]+);base64,(.+)$/.exec(typeof data === "string" ? data : data.dataUrl);
        if (!m) throw new Error("参考图格式不正确");
        return { inlineData: { mimeType: m[1], data: m[2] } };
      })] }],
      generationConfig,
    };

    const r = await fetch(url, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify(body),
    });
    const txt = await r.text().catch(() => "");
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok) throw buildHttpError(r.status, txt);
    if (!txt.trim()) {
      const err = new Error(`Gemini 生图返回空响应（状态 ${r.status}，content-type=${ct || "缺失"}）`);
      err.status = r.status; err.raw = ""; err.bodyKind = "empty"; throw err;
    }
    let j;
    try { j = JSON.parse(txt); } catch (_) {
      const sample = txt.slice(0, 200);
      const err = new Error(`Gemini 响应不是合法 JSON（状态 ${r.status}）：${sample}`);
      err.status = r.status; err.raw = txt; throw err;
    }
    // Google 原生格式：candidates[].content.parts[].{text|inlineData{mimeType,data}}
    const candidates = j.candidates || [];
    const arr = [];
    let revisedPrompt = "";
    for (const cand of candidates) {
      const parts = cand?.content?.parts || [];
      for (const part of parts) {
        const inline = part.inlineData || part.inline_data;
        if (inline?.data) {
          const mime = inline.mimeType || inline.mime_type || "image/png";
          arr.push({ dataUrl: `data:${mime};base64,${inline.data}`, revisedPrompt: "" });
        } else if (typeof part.text === "string" && !revisedPrompt) {
          revisedPrompt = part.text.slice(0, 500);
        }
      }
    }
    // 把 revisedPrompt 套到第一张图上（更像 OpenAI 的语义）
    if (revisedPrompt && arr[0]) arr[0].revisedPrompt = revisedPrompt;
    if (!arr.length) {
      // 上游可能因为 promptFeedback / blockReason 拒绝
      const reason = j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason || "";
      const err = new Error(`Gemini 没有返回图片${reason ? "（" + reason + "）" : ""}。${revisedPrompt ? "模型只回了文字：" + revisedPrompt : "提示词可能被安全过滤拦截，调整一下再试。"}`);
      err.status = r.status; err.raw = txt; throw err;
    }
    return arr;
  }

  // ===================== DashScope（阿里云百炼 / 通义万相）原生生图（异步任务 + 轮询） =====================
  /** 从兼容模式 baseUrl 推导百炼原生根：去掉 /compatible-mode/v1 或末尾 /vN。
   *  例：https://dashscope.aliyuncs.com/compatible-mode/v1 → https://dashscope.aliyuncs.com */
  function dashscopeNativeBase(provider) {
    let host = String(provider?.baseUrl || "").trim().replace(/\/+$/, "");
    host = host.replace(/\/compatible-mode\/v\d+$/i, "").replace(/\/v\d+(beta)?$/i, "");
    return host || "https://dashscope.aliyuncs.com";
  }

  /** 是否走百炼原生图像接口：baseUrl 指向 dashscope/aliyuncs，或模型是 wanx / wan2 / qwen-image / flux 系。 */
  function isDashScopeProvider(provider, model) {
    const host = String(provider?.baseUrl || "").toLowerCase();
    if (/dashscope|aliyuncs\.com/.test(host)) return true;
    return /^(wanx|wan[0-9]|qwen-image|flux)/i.test(String(model || "").trim());
  }

  /** 构造百炼原生接口的 url+headers，复用与 buildFetchTarget 相同的反代决策。
   *  注意：百炼无 CORS 头，浏览器直连会被拦，强烈建议保持反代开启。 */
  function dashscopeTarget(provider, subPath) {
    const base = dashscopeNativeBase(provider) + "/api/v1";
    const sub = String(subPath || "").replace(/^\/+/, "");
    let useProxy;
    if (provider.useProxy === true) useProxy = true;
    else if (provider.useProxy === false) useProxy = false;
    else useProxy = !!(window.AI && window.AI.AIStore && window.AI.AIStore.proxyAvailable);
    if (useProxy) {
      return {
        url: "/api/ai-proxy/" + sub,
        headers: { "X-Sakura-Target-Base": base, "X-Sakura-Target-Auth": "Bearer " + (provider.apiKey || "") },
      };
    }
    return { url: base + "/" + sub, headers: { "Authorization": "Bearer " + (provider.apiKey || "") } };
  }

  /** 百炼原生文生图：异步提交 image-synthesis → 轮询 tasks/{id} 到 SUCCEEDED。返回 [{url}] 或 [{dataUrl}]。 */
  async function imageRequestDashScope({ provider, model, prompt, size, n, signal, upstreamId, onSubmitted }) {
    // 百炼尺寸用 "宽*高"（星号）；nav 的 "宽x高" 转一下，auto/自定义非法值则不传，让模型用默认。
    const dsSize = (size && size !== "auto" && /^\d+x\d+$/.test(size)) ? size.replace("x", "*") : undefined;
    const submit = dashscopeTarget(provider, "services/aigc/text2image/image-synthesis");
    const body = {
      model: model || "wanx2.1-t2i-turbo",
      input: { prompt: String(prompt || "").slice(0, 4000) },
      parameters: { n: Math.max(1, Math.min(4, +n || 1)), ...(dsSize ? { size: dsSize } : {}) },
    };
    let taskId = upstreamId;
    if (!taskId) {
    const submitRes = await fetch(submit.url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "X-DashScope-Async": "enable", ...submit.headers },
      body: JSON.stringify(body),
    });
    const submitTxt = await submitRes.text().catch(() => "");
    if (!submitRes.ok) {
      console.error("[ai][dashscope] 提交失败 %s\nmodel=%s  size=%s\n上游 body:\n%s", submitRes.status, model, dsSize || "(默认)", submitTxt.slice(0, 2000));
      throw buildHttpError(submitRes.status, submitTxt);
    }
    let submitJson;
    try { submitJson = JSON.parse(submitTxt); } catch (_) {
      const e = new Error("百炼提交响应不是合法 JSON：" + submitTxt.slice(0, 200));
      e.status = submitRes.status; e.raw = submitTxt; throw e;
    }
    taskId = submitJson?.output?.task_id;
    if (!taskId) {
      const msg = submitJson?.output?.message || submitJson?.message || submitJson?.code || "百炼未返回 task_id（模型名或参数可能不被接受）";
      const e = new Error(String(msg)); e.status = submitRes.status; e.raw = submitTxt; throw e;
    }
    await onSubmitted?.(taskId);
    }
    const deadline = Date.now() + 240_000; // 4 分钟上限
    for (;;) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await sleepWithSignal(2500, signal);
      if (Date.now() > deadline) throw new Error("百炼生图超时（4 分钟未完成）");
      const poll = dashscopeTarget(provider, "tasks/" + taskId);
      const pollRes = await fetch(poll.url, { signal, headers: { ...poll.headers } });
      const pollTxt = await pollRes.text().catch(() => "");
      if (!pollRes.ok) throw buildHttpError(pollRes.status, pollTxt);
      let pj;
      try { pj = JSON.parse(pollTxt); } catch (_) { continue; }
      const status = pj?.output?.task_status;
      if (status === "SUCCEEDED") {
        const results = pj?.output?.results || [];
        const arr = results
          .map((r) => (r && r.url) ? { url: r.url } : (r && r.b64_image ? { dataUrl: "data:image/png;base64," + r.b64_image } : null))
          .filter(Boolean);
        if (!arr.length) {
          const e = new Error("百炼任务成功但未返回图片（可能命中内容审核或参数不合法）");
          e.status = pollRes.status; e.raw = pollTxt; throw e;
        }
        return arr;
      }
      if (status === "FAILED" || status === "UNKNOWN") {
        const e = new Error("百炼生图失败：" + (pj?.output?.message || pj?.output?.code || status || "未知"));
        e.status = pollRes.status; e.raw = pollTxt; throw e;
      }
      // PENDING / RUNNING → 继续轮询
    }
  }

  async function imageRequest(opts) {
    const { provider, model, prompt, size, quality, n, signal, apiMode, onPartial, textModel } = opts;
    // 百炼（DashScope / 通义万相）原生分支：dashscope/aliyuncs 域名或 wanx/qwen-image 系模型，走异步 image-synthesis
    if (apiMode === "dashscope" || (!apiMode || apiMode === "auto") && isDashScopeProvider(provider, model)) {
      return await imageRequestDashScope({ ...opts, provider, model, prompt, size, n, signal });
    }
    // Responses API 模式：走 SSE 流式（borrows Image-Studio 的 CF 524 规避思路）
    // 仅在调用方显式声明 apiMode === "responses" 时启用，避免误伤普通中转
    if (apiMode === "responses") {
      return await imageRequestResponses({ provider, model, prompt, size, quality, n, signal, onPartial, textModel });
    }
    // Gemini 原生分支：检测到 gemini-*-image-* 走 /v1beta/models/{model}:generateContent
    if (apiMode === "gemini" || (!apiMode || apiMode === "auto") && isGeminiImageModel(model)) {
      const requested = Math.max(1, Math.min(8, +n || 1));
      // Google 原生 generateContent 一次只产一张（candidateCount 视模型而定，保守做法是循环调用）
      if (requested === 1) {
        return await imageRequestGemini({ ...opts, provider, model, prompt, size, quality, signal });
      }
      const all = [];
      for (let i = 0; i < requested; i++) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const one = await imageRequestGemini({ ...opts, provider, model, prompt, size, quality, signal });
        all.push(...one);
      }
      return all;
    }
    // OpenAI 兼容分支（gpt-image-* / dall-e-* / imagen-* / flux-* 等）
    const t = buildFetchTarget(provider, "images/generations");
    const body = {
      model,
      prompt: String(prompt || "").slice(0, 4000),
      n: Math.max(1, Math.min(10, +n || 1)),
    };
    if (size && size !== "auto") body.size = size;
    if (quality && quality !== "auto") body.quality = quality;
    // gpt-image-1 默认就是 b64_json 返回；DALL·E 默认 url。我们让服务端自己决定，但兜底用 b64
    body.response_format = "b64_json";
    const r = await fetch(t.url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...t.headers,
      },
      body: JSON.stringify(body),
    });
    const txt = await r.text().catch(() => "");
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok) {
      // 失败时把完整上游 body 打到 console.error，方便用户 F12 看清楚 400 / 401 / 429 的真实原因
      console.error(
        "[ai][images/generations] 上游返回 %s\nmodel=%s  size=%s  quality=%s\n请求体: %o\n上游 body 完整内容:\n%s",
        r.status, model, body.size || "(未设)", body.quality || "(未设)",
        body, txt.slice(0, 4000)
      );
      throw buildHttpError(r.status, txt);
    }
    // 上游返回了 200 OK 但 body 完全空白：基本上是中转配错或反代截断了响应。
    if (!txt.trim()) {
      const err = new Error(`上游返回空响应（状态 ${r.status}，content-type=${ct || "缺失"}）。可能是中转把请求路由到了一个不返回数据的后端，或者反向代理在转发时丢了 body。`);
      err.status = r.status; err.raw = ""; err.bodyKind = "empty"; throw err;
    }
    let j;
    try { j = JSON.parse(txt); } catch (_) {
      const looksHtml = /<html|<!doctype|<body/i.test(txt);
      const sample = txt.slice(0, 200);
      const err = looksHtml
        ? new Error(`上游返回了 HTML 而不是 JSON（状态 ${r.status}）。基本是被中转/防火墙的登录页或错误页拦了。片段：${sample}`)
        : new Error(`生图响应不是合法 JSON（状态 ${r.status}, content-type=${ct || "缺失"}）。片段：${sample}`);
      err.status = r.status; err.raw = txt; err.bodyKind = looksHtml ? "html" : "text"; throw err;
    }
    const arr = (j.data || j.images || []).map((d) => {
      if (!d) return null;
      if (d.b64_json) return { dataUrl: "data:image/png;base64," + d.b64_json, revisedPrompt: d.revised_prompt };
      if (d.url)      return { url: d.url, revisedPrompt: d.revised_prompt };
      // 一些中转直接返回 base64 裸串
      if (typeof d === "string" && /^[A-Za-z0-9+/=]+$/.test(d)) return { dataUrl: "data:image/png;base64," + d };
      return null;
    }).filter(Boolean);
    if (!arr.length) {
      const err = new Error("生图返回为空（也许中转把图片放进了非标准字段）");
      err.status = r.status; err.raw = txt; throw err;
    }
    return arr;
  }

  // ===================== 图生图 / 参考图编辑（/v1/images/edits） =====================
  /** dataURL -> Blob（图生图要把参考图当 multipart 文件上传）。 */
  function dataUrlToBlob(dataUrl) {
    const str = String(dataUrl || "");
    const comma = str.indexOf(",");
    const head = str.slice(0, comma);
    const body = str.slice(comma + 1);
    const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/png";
    const isB64 = /;base64/i.test(head);
    const raw = isB64 ? atob(body) : decodeURIComponent(body);
    const u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  /** 真正发一次 /images/edits 请求。images 是 [dataUrl] 或 [{dataUrl}]。
   *  注意：FormData 不能手动设 Content-Type，必须让浏览器带 multipart boundary。 */
  async function imageEditRequest(opts) {
    const { provider, model, prompt, size, quality, n, images, signal } = opts;
    const refs = (images || [])
      .map((img) => (typeof img === "string" ? img : img?.dataUrl))
      .filter(Boolean);
    if (!refs.length) throw new Error("图生图需要至少 1 张参考图");

    const t = buildFetchTarget(provider, "images/edits");
    const fd = new FormData();
    fd.set("model", model);
    fd.set("prompt", String(prompt || "").slice(0, 4000));
    fd.set("n", String(Math.max(1, Math.min(10, +n || 1))));
    if (size && size !== "auto") fd.set("size", size);
    if (quality && quality !== "auto") fd.set("quality", quality);
    fd.set("response_format", "b64_json");
    refs.forEach((dataUrl, i) => {
      const blob = dataUrlToBlob(dataUrl);
      const ext = ((blob.type.split("/")[1] || "png").replace("jpeg", "jpg")).replace("svg+xml", "svg");
      // 多张参考图：重复 append 同名 image 字段（与多数 OpenAI 兼容中转一致）
      fd.append("image", blob, `reference-${i + 1}.${ext}`);
    });

    const r = await fetch(t.url, { method: "POST", signal, headers: { ...t.headers }, body: fd });
    const txt = await r.text().catch(() => "");
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok) {
      console.error(
        "[ai][images/edits] 上游返回 %s\nmodel=%s  size=%s  quality=%s  参考图=%d 张\n上游 body 完整内容:\n%s",
        r.status, model, size || "(未设)", quality || "(未设)", refs.length, txt.slice(0, 4000)
      );
      throw buildHttpError(r.status, txt);
    }
    if (!txt.trim()) {
      const err = new Error(`上游返回空响应（状态 ${r.status}，content-type=${ct || "缺失"}）。`);
      err.status = r.status; err.raw = ""; err.bodyKind = "empty"; throw err;
    }
    let j;
    try { j = JSON.parse(txt); } catch (_) {
      const looksHtml = /<html|<!doctype|<body/i.test(txt);
      const sample = txt.slice(0, 200);
      const err = new Error(
        looksHtml
          ? `上游返回了 HTML 而不是 JSON（状态 ${r.status}）。基本是被中转/防火墙拦了。片段：${sample}`
          : `图生图响应不是合法 JSON（状态 ${r.status}, content-type=${ct || "缺失"}）。片段：${sample}`
      );
      err.status = r.status; err.raw = txt; err.bodyKind = looksHtml ? "html" : "text"; throw err;
    }
    const arr = (j.data || j.images || []).map((d) => {
      if (!d) return null;
      if (d.b64_json) return { dataUrl: "data:image/png;base64," + d.b64_json, revisedPrompt: d.revised_prompt };
      if (d.url)      return { url: d.url, revisedPrompt: d.revised_prompt };
      if (typeof d === "string" && /^[A-Za-z0-9+/=]+$/.test(d)) return { dataUrl: "data:image/png;base64," + d };
      return null;
    }).filter(Boolean);
    if (!arr.length) {
      const err = new Error("图生图返回为空（也许中转把图片放进了非标准字段）");
      err.status = r.status; err.raw = txt; throw err;
    }
    return arr;
  }

  return { isGeminiImageModel, formatImageErrorMessage, IMAGE_SIZES, IMAGE_QUALITIES, imageRequest, imageEditRequest };
});
