/* 樱 · AI 助手模块
 * 兼容 OpenAI Chat Completions 协议：
 *   POST  {baseUrl}/chat/completions   (流式 stream: true)
 *   GET   {baseUrl}/models              (列出模型)
 * 已在以下服务验证兼容：OpenAI / Azure(兼容模式) / DeepSeek / 硅基流动 / Kimi / 智谱 /
 *   通义千问 DashScope(兼容) / Ollama(http://localhost:11434/v1) / LM Studio / OneAPI 中转等
 *
 * 亮点：
 *   - 多供应商管理 + 模型自动拉取 + 一键切换
 *   - 流式输出（SSE）+ 取消
 *   - Vision 图片输入（自动 base64）
 *   - Persona（含签名、TG 等自定义内容）
 *   - JSON 指令块 → 应用到导航数据，用户确认后执行
 *   - Markdown 简易渲染 + 图片/视频链接内联预览
 */
(function () {
  "use strict";

  const AI_KEY = "sakura_nav_ai_v1";
  const CHAT_KEY = "sakura_nav_chat_v1";
  const StorageAdapter = window.SakuraStorageAdapter?.adapter;
  const AIImage = window.HomepageAIImage;
  const AIWebSearch = window.HomepageAIWebSearch;
  if (!StorageAdapter) throw new Error("Storage adapter is not loaded");
  if (!AIImage) throw new Error("AI image helper is not loaded");
  if (!AIWebSearch) throw new Error("AI web search helper is not loaded");

  // 内置人设预设
  const DEFAULT_PERSONAS = [
    {
      id: "nav",
      name: "🌸 导航管家",
      prompt:
        "你是\"樱\"——一位温柔、干净利落的个人导航页管家。\n" +
        "你的工作是帮助用户整理他们的网址收藏，分类清晰、命名简洁。\n" +
        "当你需要对导航数据执行操作时，请在回复中附带 JSON 指令块（见下方协议），用户可以选择接受或忽略。\n" +
        "语气亲切自然，回答简明，不啰嗦。",
    },
    {
      id: "tutor",
      name: "📚 技术导师",
      prompt:
        "你是一位耐心的技术导师，善于把复杂的概念讲得通俗易懂。\n" +
        "当讨论网站/工具时，请用 1-2 句总结它的用途并建议归类到哪个分组。",
    },
    {
      id: "free",
      name: "💬 自由聊天",
      prompt: "你是一位风趣温暖的朋友，随意聊聊。如果用户请求帮忙整理导航再切换到正式模式。",
    },
  ];

  // 导航指令协议：追加到 system prompt
  const NAV_ACTION_SPEC =
    "\n\n---\n【操作指令协议】\n" +
    "当需要修改导航页或日历数据时，请在回复中以 ```nav-action JSON 代码块``` 形式输出一个数组。支持的 op：\n" +
    "\n【导航】\n" +
    "- add_group: { op, name, color? }\n" +
    "- delete_group: { op, name }\n" +
    "- rename_group: { op, from, to }\n" +
    "- add_link: { op, group, name, url, icon?, desc? }\n" +
    "- delete_link: { op, url }  或  { op, group, name }\n" +
    "- move_link: { op, url, toGroup }\n" +
    "\n【日历】（日期支持 ISO 8601 如 2026-05-01T14:30:00 或 2026-05-01；repeat 支持 none/daily/weekly/monthly/yearly）\n" +
    "- add_task: { op, title, startAt (ISO), allDay?:bool, desc?, color?, repeat?:{type,interval?,weekDays?:[0-6],until?(ISO),count?}, remindBefore?:minutes }\n" +
    "- delete_task: { op, title }  或  { op, id }\n" +
    "- complete_task: { op, title, when?(ISO) }\n" +
    "- update_task: { op, title, patch:{...任一字段...} }\n" +
    "\n示例：\n```nav-action\n[\n  {\"op\":\"add_task\",\"title\":\"晨跑\",\"startAt\":\"2026-05-01T07:00\",\"repeat\":{\"type\":\"weekly\",\"weekDays\":[1,3,5]},\"color\":\"#a6e6c0\"}\n]\n```\n" +
    "只在用户明确要求修改时才输出指令块。一次对话可以多次输出；用户会看到并手动确认。";

  // ===================== 数据 =====================
  // AI 设置优先存服务端 SQLite（/api/ai-settings）；业务写入由 sakura-remote 禁止落到浏览器
  const AIStore = {
    data: {
      providers: [],        // [{ id, name, baseUrl, apiKey, defaultModel, models: [] }]
      currentProviderId: "",
      currentModel: "",
      personas: DEFAULT_PERSONAS.slice(),
      currentPersonaId: "nav",
      customSignature: "",  // 例：TG: @xxx / 邮箱：xxx
      autoApply: false,     // 收到指令块时自动执行（默认需确认）
      webSearchEnabled: false,
    },
    messages: [],           // [{ role, content, ts, attachments?: [{type,name,url/data}] }]
    serverMode: false,
    _pushTimer: null,

    // 从统一业务存储读取；再异步尝试从独立 AI 设置表覆盖
    async load() {
      try {
        const saved = StorageAdapter.readJson(AI_KEY);
        if (saved) Object.assign(this.data, saved);
      } catch (_) {}
      try {
        const savedMessages = StorageAdapter.readJson(CHAT_KEY);
        if (Array.isArray(savedMessages)) this.messages = savedMessages;
      } catch (_) {}
      if (!Array.isArray(this.data.personas) || !this.data.personas.length) {
        this.data.personas = DEFAULT_PERSONAS.slice();
      }
      await this._hydrateFromServer();
    },

    async _hydrateFromServer() {
      try {
        const r = await fetch("/api/ai-settings", { credentials: "same-origin" });
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("json")) return; // 纯静态部署
        const j = await r.json();
        if (!r.ok) return;
        this.serverMode = true;
        if (j && j.empty === true) {
          // 服务端为空：把当前（本地遗留）数据推上去做一次性迁移
          this._pushNow();
        } else if (j && typeof j === "object") {
          Object.assign(this.data, j);
          if (!Array.isArray(this.data.personas) || !this.data.personas.length) {
            this.data.personas = DEFAULT_PERSONAS.slice();
          }
        }
        // 进入独立服务端 AI 设置模式后，清掉通用业务存储中的冗余设置副本
        try { StorageAdapter.remove(AI_KEY); } catch (_) {}
      } catch (_) {}
    },

    save() {
      if (this.serverMode) {
        this._schedulePush();
      } else {
        try { StorageAdapter.writeJson(AI_KEY, this.data); } catch (_) {}
      }
    },

    _schedulePush() {
      clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => this._pushNow(), 500);
    },

    async _pushNow() {
      clearTimeout(this._pushTimer);
      this._pushTimer = null;
      try {
        await fetch("/api/ai-settings", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.data),
        });
      } catch (_) {}
    },

    saveMessages() { StorageAdapter.writeJson(CHAT_KEY, this.messages.slice(-200)); },

    currentProvider() { return this.data.providers.find((p) => p.id === this.data.currentProviderId); },
    currentPersona() {
      return this.data.personas.find((p) => p.id === this.data.currentPersonaId) ||
        this.data.personas[0] || DEFAULT_PERSONAS[0];
    },
  };

  // ===================== API =====================
  function normalizeBase(url) {
    if (!url) return "";
    url = url.trim().replace(/\/+$/, "");
    if (!/\/v\d+$/.test(url) && !/\/chat\/completions$/.test(url)) {
      // 自动补 /v1
      url = url + "/v1";
    }
    return url;
  }

  async function fetchModels(provider) {
    const base = normalizeBase(provider.baseUrl);
    const r = await fetch(base + "/models", {
      headers: { "Authorization": "Bearer " + (provider.apiKey || "") },
    });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text().catch(() => "")).slice(0, 200));
    const data = await r.json();
    const arr = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
    return arr;
  }

  function isImageGenerationModel(model) {
    return AIImage.isImageGenerationModel(model);
  }

  async function readJsonOrText(response) {
    const text = await response.text().catch(() => "");
    try {
      return { text, json: text ? JSON.parse(text) : null };
    } catch (_) {
      return { text, json: null };
    }
  }

  async function readSseResponse(response, onDelta) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return content;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content || j.choices?.[0]?.message?.content || "";
          if (delta) {
            content += delta;
            onDelta?.(delta, content);
          }
        } catch (_) {}
      }
    }
    return content;
  }

  async function chatViaServer({ provider, model, messages, signal, onDelta, temperature, webSearch = false }) {
    const r = await fetch("/api/ai/chat", {
      method: "POST",
      signal,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: provider.id,
        model,
        messages,
        temperature,
        webSearch,
      }),
    });
    if (!r.ok) {
      const { text, json } = await readJsonOrText(r);
      const msg = json?.error || (json ? JSON.stringify(json) : text);
      throw new Error("HTTP " + r.status + "：" + String(msg || "").slice(0, 300));
    }
    const contentType = (r.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const data = await r.json();
      const content = String(data.content || "");
      if (content) onDelta?.(content, content);
      return content;
    }
    return readSseResponse(r, onDelta);
  }

  async function generateImage({ provider, model, prompt, signal, size }) {
    const body = AIImage.buildImageGenerationBody({ model, prompt, size });
    if (!body.prompt) throw new Error("请先输入图片描述");
    return chatViaServer({
      provider,
      model,
      messages: [{ role: "user", content: body.prompt }],
      signal,
    });
  }

  async function chatWithWebSearch({ provider, model, messages, signal, onDelta }) {
    return chatViaServer({ provider, model, messages, signal, onDelta, webSearch: true });
  }

  /** 发送聊天（支持流式）*/
  async function chat({ provider, model, messages, signal, onDelta, temperature, webSearch = false }) {
    if (isImageGenerationModel(model)) {
      const prompt = AIImage.extractPromptFromMessages(messages);
      const content = await generateImage({ provider, model, prompt, signal });
      onDelta?.(content, content);
      return content;
    }
    if (webSearch) {
      return chatWithWebSearch({ provider, model, messages, signal, onDelta });
    }
    return chatViaServer({ provider, model, messages, signal, onDelta, temperature });
  }

  // ===================== 消息构造 =====================
  async function buildMessages(userText, attachments) {
    const persona = AIStore.currentPersona();
    let system = persona.prompt || "";
    if (AIStore.data.customSignature) system += "\n\n【用户的签名/资料】\n" + AIStore.data.customSignature;
    // 附带当前导航数据上下文 + 指令协议
    const navCtx = buildNavContext();
    system += "\n\n" + navCtx + NAV_ACTION_SPEC;

    const history = AIStore.messages
      .slice(-20)
      .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : (m.content?.text || "") }));

    // 当前用户消息
    let content;
    const imgs = (attachments || []).filter((a) => a.type === "image" && a.dataUrl);
    if (imgs.length) {
      content = [{ type: "text", text: userText || "（请分析图片）" }];
      for (const a of imgs) content.push({ type: "image_url", image_url: { url: a.dataUrl } });
    } else {
      content = userText || "";
      // 对于文本附件，把内容追加到消息
      const texts = (attachments || []).filter((a) => a.type === "text" && a.text);
      if (texts.length) {
        content += "\n\n【附件内容】\n";
        for (const a of texts) content += "\n--- " + a.name + " ---\n" + a.text + "\n";
      }
    }

    return [
      { role: "system", content: system },
      ...history,
      { role: "user", content },
    ];
  }

  function buildNavContext() {
    const groups = (window.Store?.state?.groups || []).map((g) => ({
      name: g.name,
      count: g.links.length,
      sample: g.links.slice(0, 5).map((l) => l.name),
    }));
    let ctx = "【当前导航数据摘要】\n" + JSON.stringify(groups, null, 2);
    // 今日日历（如果 Cal 已加载）
    try {
      if (window.CalUtils && window.Cal) {
        const today = window.CalUtils.today().map(({ task, ts }) => ({
          title: task.title,
          time: new Date(ts).toLocaleString("zh-CN"),
          done: task.repeat?.type === "none" ? task.done : (task.doneDates || []).includes(ts),
        }));
        const upcoming = window.CalUtils.upcoming(5).map(({ task, ts }) => ({
          title: task.title,
          at: new Date(ts).toLocaleString("zh-CN"),
        }));
        ctx += "\n\n【今日日程】\n" + JSON.stringify(today, null, 2);
        ctx += "\n\n【即将到来】\n" + JSON.stringify(upcoming, null, 2);
      }
    } catch (_) {}
    // 当前日期时间
    ctx += "\n\n【当前时间】\n" + new Date().toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long" });
    return ctx;
  }

  // ===================== 指令执行 =====================
  function parseActions(text) {
    const blocks = [];
    // 匹配 ```nav-action ... ```（语言标签可省略或变体）
    const re = /```(?:nav-action|nav|json)?\s*\n([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(text))) {
      const body = m[1].trim();
      if (!body.startsWith("[") && !body.startsWith("{")) continue;
      try {
        const j = JSON.parse(body);
        const arr = Array.isArray(j) ? j : [j];
        // 只保留看起来像我们指令的
        if (arr.every((x) => x && typeof x.op === "string")) blocks.push(...arr);
      } catch (_) {}
    }
    return blocks;
  }

  function applyActions(actions) {
    const Store = window.Store;
    if (!Store) return { ok: 0, fail: actions.length, notes: ["Store 未就绪"] };
    const notes = [];
    let ok = 0, fail = 0;
    const findGroup = (name) => Store.state.groups.find((g) => g.name === name);
    const findLinkByUrl = (url) => {
      for (const g of Store.state.groups) {
        const l = g.links.find((x) => x.url === url);
        if (l) return { g, l };
      }
      return null;
    };
    const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    for (const a of actions) {
      try {
        switch (a.op) {
          case "add_group": {
            if (findGroup(a.name)) { notes.push(`分组已存在：${a.name}`); fail++; break; }
            Store.state.groups.push({ id: uid(), name: a.name, color: a.color || "#ff8fab", links: [] });
            ok++; notes.push(`已添加分组：${a.name}`);
            break;
          }
          case "delete_group": {
            const idx = Store.state.groups.findIndex((g) => g.name === a.name);
            if (idx < 0) { notes.push(`分组不存在：${a.name}`); fail++; break; }
            Store.state.groups.splice(idx, 1);
            ok++; notes.push(`已删除分组：${a.name}`);
            break;
          }
          case "rename_group": {
            const g = findGroup(a.from);
            if (!g) { notes.push(`分组不存在：${a.from}`); fail++; break; }
            g.name = a.to;
            ok++; notes.push(`重命名：${a.from} → ${a.to}`);
            break;
          }
          case "add_link": {
            let g = findGroup(a.group);
            if (!g) {
              g = { id: uid(), name: a.group || "未分类", color: "#ff8fab", links: [] };
              Store.state.groups.push(g);
              notes.push(`自动创建分组：${g.name}`);
            }
            if (g.links.some((x) => x.url === a.url)) { notes.push(`已存在：${a.name || a.url}`); fail++; break; }
            g.links.push({ id: uid(), name: a.name || a.url, url: a.url, icon: a.icon || "", desc: a.desc || "" });
            ok++; notes.push(`已添加：${a.name || a.url} → ${g.name}`);
            break;
          }
          case "delete_link": {
            let hit = null;
            if (a.url) hit = findLinkByUrl(a.url);
            else if (a.group && a.name) {
              const g = findGroup(a.group);
              if (g) { const l = g.links.find((x) => x.name === a.name); if (l) hit = { g, l }; }
            }
            if (!hit) { notes.push(`未找到：${a.url || a.name}`); fail++; break; }
            hit.g.links = hit.g.links.filter((x) => x.id !== hit.l.id);
            ok++; notes.push(`已删除：${hit.l.name}`);
            break;
          }
          case "move_link": {
            const hit = findLinkByUrl(a.url);
            if (!hit) { notes.push(`未找到 URL：${a.url}`); fail++; break; }
            let dst = findGroup(a.toGroup);
            if (!dst) {
              dst = { id: uid(), name: a.toGroup, color: "#ff8fab", links: [] };
              Store.state.groups.push(dst);
            }
            hit.g.links = hit.g.links.filter((x) => x.id !== hit.l.id);
            dst.links.push(hit.l);
            ok++; notes.push(`已移动：${hit.l.name} → ${dst.name}`);
            break;
          }
          // ===================== 日历 ops =====================
          case "add_task": {
            if (!window.Cal) { notes.push("日历未就绪"); fail++; break; }
            const startAt = parseDateLike(a.startAt);
            if (!startAt) { notes.push(`无效时间：${a.startAt}`); fail++; break; }
            const t = window.Cal.create({
              title: a.title || "新任务",
              desc: a.desc || "",
              startAt,
              allDay: !!a.allDay,
              color: a.color || "#ff8fab",
              repeat: normalizeRepeat(a.repeat),
              remindBefore: +a.remindBefore || 0,
            });
            ok++; notes.push(`已添加任务：${t.title} @ ${new Date(startAt).toLocaleString("zh-CN")}`);
            break;
          }
          case "delete_task": {
            if (!window.Cal) { notes.push("日历未就绪"); fail++; break; }
            const tk = a.id ? window.Cal.get(a.id) : window.Cal.data.tasks.find((x) => x.title === a.title);
            if (!tk) { notes.push(`任务不存在：${a.title || a.id}`); fail++; break; }
            window.Cal.remove(tk.id);
            ok++; notes.push(`已删除任务：${tk.title}`);
            break;
          }
          case "complete_task": {
            if (!window.Cal || !window.CalUtils) { notes.push("日历未就绪"); fail++; break; }
            const tk = window.Cal.data.tasks.find((x) => x.title === a.title);
            if (!tk) { notes.push(`任务不存在：${a.title}`); fail++; break; }
            const ts = a.when ? parseDateLike(a.when) : (window.CalUtils.nextOccurrence(tk) ?? tk.startAt);
            window.CalUtils.markDone(tk, ts);
            ok++; notes.push(`已标记完成：${tk.title}`);
            break;
          }
          case "update_task": {
            if (!window.Cal) { notes.push("日历未就绪"); fail++; break; }
            const tk = window.Cal.data.tasks.find((x) => x.title === a.title);
            if (!tk) { notes.push(`任务不存在：${a.title}`); fail++; break; }
            const p = a.patch || {};
            const patch = {};
            if (p.title) patch.title = p.title;
            if (p.desc != null) patch.desc = p.desc;
            if (p.startAt) patch.startAt = parseDateLike(p.startAt);
            if (p.allDay != null) patch.allDay = !!p.allDay;
            if (p.color) patch.color = p.color;
            if (p.repeat) patch.repeat = normalizeRepeat(p.repeat);
            if (p.remindBefore != null) patch.remindBefore = +p.remindBefore;
            window.Cal.update(tk.id, patch);
            ok++; notes.push(`已更新：${tk.title}`);
            break;
          }
          default:
            notes.push(`未知指令：${a.op}`); fail++;
        }
      } catch (e) {
        fail++; notes.push(`执行失败：${a.op} - ${e.message}`);
      }
    }
    Store.save();
    if (window.render) window.render();
    if (window.UICalRefresh) try { window.UICalRefresh(); } catch (_) {}
    return { ok, fail, notes };
  }

  function parseDateLike(s) {
    if (!s) return null;
    if (typeof s === "number") return s;
    // 支持 "2026-05-01", "2026-05-01 14:30", "2026-05-01T14:30"
    const t = Date.parse(String(s).replace(" ", "T"));
    return isNaN(t) ? null : t;
  }
  function normalizeRepeat(r) {
    if (!r || typeof r === "string" && r === "none") return { type: "none", interval: 1 };
    if (typeof r === "string") {
      // 简写："weekly:MON,WED"
      const [type, rest] = r.split(":");
      const obj = { type, interval: 1 };
      if (type === "weekly" && rest) {
        const map = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 0 };
        obj.weekDays = rest.split(",").map((x) => map[x.trim().toUpperCase().slice(0, 3)] ?? map[x.trim().toUpperCase().slice(0, 2)]).filter((x) => x != null);
      }
      return obj;
    }
    const out = { type: r.type || "none", interval: +r.interval || 1 };
    if (r.weekDays) out.weekDays = r.weekDays;
    if (r.until) out.until = parseDateLike(r.until);
    if (r.count) out.count = +r.count;
    return out;
  }

  // ===================== Markdown 渲染 + 媒体检测 =====================
  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  function safeInlineImageUrl(url) {
    const value = String(url || "").trim();
    if (/^https?:\/\//i.test(value)) return esc(value);
    if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value)) return esc(value);
    return "";
  }

  function renderMarkdown(src) {
    if (!src) return "";
    let s = src;
    // 1. 提取代码块占位（稍后原样还原）
    const blocks = [];
    s = s.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const i = blocks.length;
      blocks.push({ lang: (lang || "").toLowerCase(), code });
      return `\u0000BLOCK${i}\u0000`;
    });

    // 2. 提取行内代码
    const inlines = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => {
      const i = inlines.length;
      inlines.push(c);
      return `\u0000INL${i}\u0000`;
    });

    // 3. 转义
    s = esc(s);

    // 4. 行内样式（在已转义文本上替换）
    s = s
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");

    // 5. 图片 ![alt](url) —— 放在链接之前
    s = s.replace(/!\[([^\]]*)\]\(((?:https?:|data:image\/)[^\s)]+)\)/g, (_, t, u) => {
      const safeUrl = safeInlineImageUrl(u);
      return safeUrl ? `<img class="ai-inline-img" alt="${t}" src="${safeUrl}" loading="lazy" />` : "";
    });
    // 6. 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\(((?:https?|mailto):[^\s)]+)\)/g, (_, t, u) =>
      `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    // 7. 自动识别裸 URL
    s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>()]+)/g, (_, pre, url) => {
      const clean = url.replace(/[.,;:!?]+$/, "");
      return pre + linkifyMedia(clean);
    });

    // 8. 标题
    s = s.replace(/(^|\n)######\s+([^\n]+)/g, "$1<h6>$2</h6>")
         .replace(/(^|\n)#####\s+([^\n]+)/g, "$1<h5>$2</h5>")
         .replace(/(^|\n)####\s+([^\n]+)/g, "$1<h4>$2</h4>")
         .replace(/(^|\n)###\s+([^\n]+)/g, "$1<h3>$2</h3>")
         .replace(/(^|\n)##\s+([^\n]+)/g, "$1<h2>$2</h2>")
         .replace(/(^|\n)#\s+([^\n]+)/g, "$1<h1>$2</h1>");

    // 9. 列表
    s = s.replace(/(^|\n)(?:- |\* )([^\n]+)/g, "$1<li>$2</li>");
    s = s.replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>");

    // 10. 段落
    s = s.split(/\n{2,}/).map((p) => {
      const t = p.trim();
      if (!t) return "";
      if (/^<(h\d|ul|ol|blockquote|pre|img|div)/i.test(t)) return p;
      if (/\u0000BLOCK\d+\u0000/.test(p)) return p;
      return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
    }).join("\n");

    // 11. 还原行内代码
    s = s.replace(/\u0000INL(\d+)\u0000/g, (_, i) => `<code>${esc(inlines[+i])}</code>`);

    // 12. 还原代码块
    s = s.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => {
      const b = blocks[+i];
      if (b.lang === "nav-action" || b.lang === "nav") {
        // 编码放到属性里，避免被 HTML 解析；渲染层解析后生成交互卡
        return `<div class="ai-action-placeholder" data-code="${esc(b.code)}"></div>`;
      }
      return `<pre><code class="lang-${esc(b.lang)}">${esc(b.code)}</code></pre>`;
    });

    return s;
  }

  function linkifyMedia(url) {
    const clean = url.replace(/[.,;:!?]+$/, "");
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(clean)) {
      return `<a href="${clean}" target="_blank" rel="noopener" class="ai-media-link"><img class="ai-inline-img" src="${clean}" loading="lazy" alt="" /></a>`;
    }
    if (/\.(mp4|webm|mov)(\?|$)/i.test(clean)) {
      return `<video class="ai-inline-video" src="${clean}" controls preload="metadata"></video>`;
    }
    if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(clean)) {
      return `<audio class="ai-inline-audio" src="${clean}" controls></audio>`;
    }
    return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>`;
  }

  // ===================== 文件 → 消息附件 =====================
  async function fileToAttachment(file) {
    const isImg = file.type.startsWith("image/");
    if (isImg) {
      const dataUrl = await readAsDataURL(file);
      return { type: "image", name: file.name, dataUrl, size: file.size };
    }
    // 文本/JSON/HTML/MD
    if (file.size > 200 * 1024) {
      return { type: "text", name: file.name, text: `（文件过大，已截断首 200KB）\n\n` + (await readAsText(file)).slice(0, 200_000), size: file.size };
    }
    return { type: "text", name: file.name, text: await readAsText(file), size: file.size };
  }
  const readAsDataURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  const readAsText = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });

  // ===================== 对外 API =====================
  window.AI = {
    AIStore,
    DEFAULT_PERSONAS,
    fetchModels,
    chat,
    generateImage,
    isImageGenerationModel,
    buildMessages,
    parseActions,
    applyActions,
    renderMarkdown,
    fileToAttachment,
    uid: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
  };
})();
