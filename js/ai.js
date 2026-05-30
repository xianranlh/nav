/* 樱 · AI 助手模块  (build: v1.19.0 · 2026-05-09 · 🍵 茶话会模式 · 多代理对话)
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

  // —— 启动标记：刷新后在 DevTools Console 应该能看到这一行；看不到说明浏览器还在跑旧版本 ai.js
  try { console.log("%c[sakura-nav][ai.js] build v1.19.0 · 2026-05-09 · 🍵 茶话会模式（广播 / 辩论 / 圆桌 三模式 multi-agent）", "color:#d6336c;font-weight:bold"); } catch (_) {}

  const AI_KEY = "sakura_nav_ai_v1";
  const CHAT_KEY = "sakura_nav_chat_v1";

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
      smartMode: false,     // 智能模式：发送前若 currentModel 在冷却台账里就先 probe 找可用模型
      imageMode: false,     // 🎨 生图模式：把发送改路由到 /v1/images/generations
      imageOpts: {          // 生图参数（持久化）
        size: "1024x1024",
        quality: "auto",
        n: 1,
        customW: 3840,
        customH: 2160,
      },
      /** 🍵 茶话会模式（多代理并行/辩论/圆桌对话，类似 Grok Heavy 的 multi-agent council）
       *  - mode: "broadcast" 并行独立回答 / "debate" 两轮辩论综合 / "roundtable" 轮流接龙
       *  - members: 每个成员是 (persona × provider × model) 的组合，自带 label/emoji/color
       *  - moderatorMemberId: 仅 debate 模式：第二轮综合者，空 = 并行综合（所有成员各自综合一次）
       *  - rounds / speakerOrder: 仅 roundtable 模式
       *  默认 enabled=false，老用户升级也无感。 */
      council: {
        enabled: false,
        mode: "broadcast",
        members: [],
        moderatorMemberId: "",
        rounds: 1,
        speakerOrder: "configured",
        concurrency: 4,         // 广播模式下同时在飞的成员数（grok2api semaphore 思路）
      },
    },
    messages: [],           // [{ role, content, ts, attachments?: [{type,name,url/data}] }]
    serverMode: false,
    /** 本机是否有 /api/ai-proxy 端点：能就默认走反代绕开 CORS；能不能要 probe 一下。 */
    proxyAvailable: false,
    _pushTimer: null,
    _proxyProbeStarted: false,

    // 从 sakura-remote 的 localStorage shim 同步读取；再异步尝试从独立 AI 设置表覆盖
    async load() {
      try {
        const raw = localStorage.getItem(AI_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") Object.assign(this.data, parsed);
        }
      } catch (_) {}
      try {
        const raw = localStorage.getItem(CHAT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          // bundle 把空聊天序列化成 null 存到 localStorage 后，这里 raw="null" 会让 messages 被顶成 null。兜底成数组。
          if (Array.isArray(parsed)) this.messages = parsed;
        }
      } catch (_) {}
      // 终极兜底：messages 永远是数组
      if (!Array.isArray(this.messages)) this.messages = [];
      if (!Array.isArray(this.data.personas) || !this.data.personas.length) {
        this.data.personas = DEFAULT_PERSONAS.slice();
      }
      // 老存档兜底：补齐 council 默认结构
      if (!this.data.council || typeof this.data.council !== "object") {
        this.data.council = { enabled: false, mode: "broadcast", members: [], moderatorMemberId: "", rounds: 1, speakerOrder: "configured", concurrency: 4 };
      }
      if (!Array.isArray(this.data.council.members)) this.data.council.members = [];
      if (!["broadcast", "debate", "roundtable"].includes(this.data.council.mode)) this.data.council.mode = "broadcast";
      // 并行：服务端 hydrate 和反代 probe 一起走，整体阻塞的时间是两个里更长的那个
      await Promise.all([this._hydrateFromServer(), this._probeProxy()]);
    },

    /** 探测本机是否有 /api/ai-proxy 端点。
     *  端点对无 target 头的 GET 请求统一回 200 + JSON `{ok:true, kind:"sakura-nav-ai-proxy"}`，
     *  纯静态部署会回 404 或被 SPA 兜底成 200 HTML（content-type 不含 json）。 */
    async _probeProxy() {
      if (this._proxyProbeStarted) return;
      this._proxyProbeStarted = true;
      try {
        const r = await fetch("/api/ai-proxy/__probe", { method: "GET" });
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (r.ok && ct.includes("json")) {
          const j = await r.json().catch(() => null);
          if (j && j.kind === "sakura-nav-ai-proxy") {
            this.proxyAvailable = true;
            try { console.log("%c[sakura-nav][ai] proxy available · 默认走 /api/ai-proxy/*", "color:#3aa657"); } catch (_) {}
          }
        }
      } catch (_) {
        // 静默失败：保持 proxyAvailable=false
      }
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
        // 进入服务端模式后，清掉浏览器 localStorage 的冗余副本
        try { localStorage.removeItem(AI_KEY); } catch (_) {}
      } catch (_) {}
    },

    save() {
      if (this.serverMode) {
        this._schedulePush();
      } else {
        try { localStorage.setItem(AI_KEY, JSON.stringify(this.data)); } catch (_) {}
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

    saveMessages() {
      if (!Array.isArray(this.messages)) this.messages = [];
      localStorage.setItem(CHAT_KEY, JSON.stringify(this.messages.slice(-200)));
    },

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

  /** 给定 provider 和子路径（如 "chat/completions"），返回最终请求的 url + headers。
   *  反代决策：
   *   - provider.useProxy === true  → 强制走 /api/ai-proxy/*
   *   - provider.useProxy === false → 强制直连 baseUrl
   *   - 其它（undefined / null）    → 当本机 /api/ai-proxy 探测可用时默认走反代，不可用就直连
   *  反代会绕开第三方 baseUrl 的 CORS 限制，所以默认开启对绝大多数中转更友好。 */
  function buildFetchTarget(provider, subPath) {
    const base = normalizeBase(provider.baseUrl);
    const sub = String(subPath || "").replace(/^\/+/, "");
    let useProxy;
    if (provider.useProxy === true) useProxy = true;
    else if (provider.useProxy === false) useProxy = false;
    else useProxy = !!(window.AI && window.AI.AIStore && window.AI.AIStore.proxyAvailable);
    if (useProxy) {
      return {
        url: "/api/ai-proxy/" + sub,
        headers: {
          "X-Sakura-Target-Base": base,
          "X-Sakura-Target-Auth": "Bearer " + (provider.apiKey || ""),
        },
      };
    }
    return {
      url: base + "/" + sub,
      headers: {
        "Authorization": "Bearer " + (provider.apiKey || ""),
      },
    };
  }

  async function fetchModels(provider) {
    const t = buildFetchTarget(provider, "models");
    const r = await fetch(t.url, { headers: t.headers });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw buildHttpError(r.status, txt);
    }
    const data = await r.json();
    const arr = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
    return arr;
  }

  /** 判断错误是否值得 (a) 同模型重试、(b) 切到其它模型继续。 */
  function isCooldownError(err) {
    const ue = err?.upstream?.error || err?.upstream || {};
    if (err?.status !== 429) return false;
    return ue.code === "model_cooldown" ||
      /cool(ing)?[\s_-]?down|all credentials|rate[\s_]?limit|too many/i.test(ue.message || err?.message || "");
  }

  /** 从上游错误体里抠出"还要冷却多少秒"。 */
  function cooldownSeconds(err) {
    const ue = err?.upstream?.error || err?.upstream || {};
    let secs = +ue.reset_seconds || +ue.resets_in_seconds || 0;
    if (!secs && ue.resets_at) secs = Math.max(0, +ue.resets_at - Math.floor(Date.now() / 1000));
    if (!secs && typeof ue.reset_time === "string") {
      const h = +(ue.reset_time.match(/(\d+)\s*h/i)?.[1] || 0);
      const m = +(ue.reset_time.match(/(\d+)\s*m(?!s)/i)?.[1] || 0);
      const s = +(ue.reset_time.match(/(\d+)\s*s/i)?.[1] || 0);
      secs = h * 3600 + m * 60 + s;
    }
    return secs;
  }

  /** 把一次 cooldown 错误登记到台账（同时记录 UI 模型 + upstream 真实模型）。
   *  返回这次冷却的剩余秒数，便于调用方做 UI 提示。 */
  function recordCooldown(provider, uiModel, err) {
    const ledger = window.AI.cooldownLedger;
    const upstreamMap = window.AI.upstreamMap;
    const ue = err?.upstream?.error || err?.upstream || {};
    const secs = cooldownSeconds(err);
    const expire = secs > 0 ? Date.now() + secs * 1000 : Date.now() + 60 * 1000; // 兜底 1 分钟
    if (uiModel) ledger[provider.id + "::" + uiModel] = expire;
    if (ue.provider && ue.model) {
      const upKey = "upstream::" + ue.provider + "::" + ue.model;
      ledger[upKey] = Math.max(ledger[upKey] || 0, expire);
      if (uiModel) upstreamMap[provider.id + "::" + uiModel] = upKey;
    }
    return secs;
  }

  /** 把"探测/对话/生图最近一次的结果"写到状态台账，UI 用来挂可用性徽章。
   *  kind: "ok"   = 最近一次请求成功
   *        "error"= 最近一次请求失败但不是 cooldown 类（拒绝、参数不兼容、5xx 等）
   *  cooldown 类不进这里，cooldownLedger 自己有更精确的过期时间。 */
  function recordProbeOk(provider, uiModel) {
    if (!provider?.id || !uiModel) return;
    const status = window.AI.probeStatus;
    status[provider.id + "::" + uiModel] = { kind: "ok", ts: Date.now() };
  }
  function recordProbeError(provider, uiModel, err) {
    if (!provider?.id || !uiModel) return;
    const status = window.AI.probeStatus;
    status[provider.id + "::" + uiModel] = {
      kind: "error",
      ts: Date.now(),
      msg: String(err?.message || err || "").slice(0, 200),
    };
  }

  /** 解析模型当前应该展示什么状态。优先级 cooldown > error(<5min) > ok(<30min) > unknown。 */
  function getModelStatus(provider, uiModel) {
    if (!provider || !uiModel) return { kind: "unknown" };
    const ledger = window.AI.cooldownLedger;
    const upstreamMap = window.AI.upstreamMap;
    const status = window.AI.probeStatus;
    const now = Date.now();
    // 1) cooldown 优先
    const expire = ledger[provider.id + "::" + uiModel] || 0;
    let coldExpire = expire;
    const upKey = upstreamMap[provider.id + "::" + uiModel];
    if (upKey) coldExpire = Math.max(coldExpire, ledger[upKey] || 0);
    if (coldExpire > now) {
      return { kind: "cold", remainingMs: coldExpire - now };
    }
    // 2) probeStatus
    const rec = status[provider.id + "::" + uiModel];
    if (rec) {
      const ageMs = now - rec.ts;
      if (rec.kind === "error" && ageMs < 5 * 60 * 1000) return { kind: "error", msg: rec.msg, ageMs };
      if (rec.kind === "ok"    && ageMs < 30 * 60 * 1000) return { kind: "ok", ageMs };
    }
    return { kind: "unknown" };
  }

  /** 定期清理过期的 cooldown 台账与 probeStatus。
   *  cooldownLedger：value < now 的键立刻删；
   *  probeStatus：成功记录 30 min 后过期，失败记录 5 min 后过期，与 getModelStatus 保持一致；
   *  upstreamMap：如果 ui key 已不在台账（既没冷却也没探测记录），相应映射也清。
   *  返回 {ledger, status, upstream} 三个清理计数，便于调试。 */
  function pruneStaleStatus() {
    const ledger = window.AI?.cooldownLedger;
    const status = window.AI?.probeStatus;
    const upstreamMap = window.AI?.upstreamMap;
    if (!ledger || !status || !upstreamMap) return { ledger: 0, status: 0, upstream: 0 };
    const now = Date.now();
    let lc = 0, sc = 0, uc = 0;
    for (const k of Object.keys(ledger)) {
      if ((ledger[k] || 0) <= now) { delete ledger[k]; lc++; }
    }
    for (const k of Object.keys(status)) {
      const rec = status[k];
      if (!rec || typeof rec.ts !== "number") { delete status[k]; sc++; continue; }
      const age = now - rec.ts;
      const ttl = rec.kind === "error" ? 5 * 60 * 1000 : 30 * 60 * 1000;
      if (age >= ttl) { delete status[k]; sc++; }
    }
    for (const k of Object.keys(upstreamMap)) {
      const up = upstreamMap[k];
      const stillCold = up && (ledger[up] || 0) > now;
      const stillKnown = !!status[k];
      if (!stillCold && !stillKnown) { delete upstreamMap[k]; uc++; }
    }
    if (lc + sc + uc > 0) {
      try { console.debug("[ai.js] pruned stale status: ledger=" + lc + " status=" + sc + " upstream=" + uc); } catch (_) {}
    }
    return { ledger: lc, status: sc, upstream: uc };
  }

  // 每 5 分钟自动清理一次；页面回到前台也立刻跑一次（避免长时间挂后台一回来全是过期键）
  setInterval(pruneStaleStatus, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pruneStaleStatus();
  });

  /** 给定一组 UI 模型，剔除已知冷却的，未冷却在前、冷却的兜底排后。 */
  function rankModels(provider, models) {
    const ledger = window.AI.cooldownLedger;
    const upstreamMap = window.AI.upstreamMap;
    const now = Date.now();
    const isCold = (m) => {
      if ((ledger[provider.id + "::" + m] || 0) > now) return true;
      const up = upstreamMap[provider.id + "::" + m];
      if (up && (ledger[up] || 0) > now) return true;
      return false;
    };
    const fresh = [], cold = [];
    for (const m of models) (isCold(m) ? cold : fresh).push(m);
    return { fresh, cold, ordered: [...fresh, ...cold] };
  }

  /** 对单个模型发一个 1-token 的最小请求；200 返回 true，否则抛 buildHttpError。 */
  async function probeModel(provider, model, signal) {
    const t = buildFetchTarget(provider, "chat/completions");
    const r = await fetch(t.url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...t.headers,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        max_tokens: 1,
        temperature: 0,
      }),
    });
    const txt = await r.text().catch(() => "");
    if (!r.ok) throw buildHttpError(r.status, txt);
    return true;
  }

  /** 顺序探测 provider.models，返回第一个可用的；
   *  onProgress({index,total,model,status:'probing'|'ok'|'cooldown'|'error',err?}) 用于 UI。 */
  async function findAvailableModel({ provider, signal, onProgress, prefer }) {
    let models = (provider.models || []).filter(Boolean);
    if (!models.length) throw new Error("没有候选模型，请先在设置里加载模型列表");
    if (prefer && models.includes(prefer)) {
      models = [prefer, ...models.filter((m) => m !== prefer)];
    }
    const { ordered } = rankModels(provider, models);
    let i = 0;
    for (const m of ordered) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      i++;
      onProgress?.({ index: i, total: ordered.length, model: m, status: "probing" });
      try {
        await probeModel(provider, m, signal);
        recordProbeOk(provider, m);
        onProgress?.({ index: i, total: ordered.length, model: m, status: "ok" });
        return m;
      } catch (err) {
        if (err.name === "AbortError") throw err;
        if (isCooldownError(err)) {
          recordCooldown(provider, m, err);
          onProgress?.({ index: i, total: ordered.length, model: m, status: "cooldown", err });
          continue;
        }
        recordProbeError(provider, m, err);
        onProgress?.({ index: i, total: ordered.length, model: m, status: "error", err });
        // 非冷却错误不记冷却台账，但记到 probeStatus 让徽章显示"⚠ 出错"
      }
    }
    return null;
  }

  /** 发送聊天（支持流式 + 可选自动重试）
   *  retry: { maxAttempts?: 1~3, delayMs?: 1200, onRetry?(n,total,lastErr) }
   */
  async function chat(opts) {
    const { retry } = opts || {};
    const attempts = Math.max(1, Math.min(5, +(retry?.maxAttempts) || 1));
    const baseDelay = +(retry?.delayMs) || 1200;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) {
        try { retry?.onRetry?.(i, attempts, lastErr); } catch (_) {}
        await sleepWithSignal(baseDelay * i, opts.signal);
        if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      }
      try {
        const result = await chatRequest(opts);
        recordProbeOk(opts.provider, opts.model);
        return result;
      } catch (err) {
        lastErr = err;
        if (err?.name === "AbortError") throw err;
        const cool = isCooldownError(err);
        const gw = isRetryableGatewayError(err);
        if (cool) {
          recordCooldown(opts.provider, opts.model, err);
        } else {
          recordProbeError(opts.provider, opts.model, err);
        }
        if (!cool && !gw) throw err;
        if (cool) {
          // 仅在剩余冷却时间「比我们要等的还短」时继续重试，避免毫无意义的等待
          const need = cooldownSeconds(err);
          if (need > 0 && need * 1000 > baseDelay * attempts) throw err;
        }
        // 524 / 504 已经在 isRetryableGatewayError 里被排除：那种慢失败再重试一遍就是双倍痛苦
      }
    }
    throw lastErr;
  }

  function sleepWithSignal(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (!signal) return;
      const onAbort = () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function chatRequest({ provider, model, messages, signal, onDelta, temperature }) {
    const t = buildFetchTarget(provider, "chat/completions");
    const body = {
      model,
      messages,
      stream: true,
      temperature: temperature ?? 0.7,
    };
    const r = await fetch(t.url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...t.headers,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw buildHttpError(r.status, txt);
    }

    const reader = r.body.getReader();
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
        if (payload === "[DONE]") { return content; }
        try {
          const j = JSON.parse(payload);
          const choice = j.choices?.[0] || {};
          const src = choice.delta || choice.message || {};
          const chunk = extractChunk(src);
          if (chunk) {
            content += chunk;
            onDelta?.(chunk, content);
          }
        } catch (_) {}
      }
    }
    return content;
  }

  /** 从一条 delta/message 中提取“可拼接到正文里的字符串”，
   *  覆盖 OpenAI / Anthropic / Gemini 兼容层等常见图片返回形态。 */
  function extractChunk(src) {
    if (!src) return "";
    let out = "";
    const c = src.content;
    if (typeof c === "string") {
      out += c;
    } else if (Array.isArray(c)) {
      for (const part of c) {
        if (!part) continue;
        if (typeof part === "string") { out += part; continue; }
        if (part.type === "text" && part.text) { out += part.text; continue; }
        if (part.type === "image_url") {
          const u = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
          if (u) out += "\n\n![image](" + u + ")\n\n";
          continue;
        }
        if (part.type === "image" && part.source) {
          const mime = part.source.media_type || "image/png";
          if (part.source.data) out += "\n\n![image](data:" + mime + ";base64," + part.source.data + ")\n\n";
          else if (part.source.url) out += "\n\n![image](" + part.source.url + ")\n\n";
          continue;
        }
        if (part.type === "output_image" || part.type === "image_generation") {
          const b64 = part.image_base64 || part.b64_json || part.data;
          if (b64) out += "\n\n![image](data:image/png;base64," + b64 + ")\n\n";
          else if (part.url) out += "\n\n![image](" + part.url + ")\n\n";
          continue;
        }
      }
    }
    // 部分服务把图片放到独立字段
    const imgs = src.images || src.image || [];
    const arr = Array.isArray(imgs) ? imgs : [imgs];
    for (const img of arr) {
      if (!img) continue;
      const u = (typeof img === "string") ? img :
        (img.image_url?.url || img.url || img.src ||
          (img.b64_json ? "data:image/png;base64," + img.b64_json : "") ||
          (img.data && img.media_type ? "data:" + img.media_type + ";base64," + img.data : ""));
      if (!u) continue;
      out += /^data:|^https?:/.test(u) ? "\n\n![image](" + u + ")\n\n"
                                       : "\n\n![image](data:image/png;base64," + u + ")\n\n";
    }
    if (typeof src.reasoning === "string" && !out) out += src.reasoning;
    return out;
  }

  /** 5xx 网关类错误（502/503/504/520~524 等）— 通常是上游临时不可达 / 超时。 */
  function isGatewayError(err) {
    const s = +err?.status;
    if (!(s >= 500 && s < 600)) return false;
    // 501 是 Not Implemented，不属于"重试一下可能就好了"，排除
    if (s === 501) return false;
    return true;
  }

  /** 网关错误里"值得重试"的子集。
   *  - 524 / 504：等满 100s 才返回，再重试一次又是 100s，对用户体验是双倍痛苦，跳过。
   *  - 502 / 503 / 520-523：通常几秒内就 fail（origin 拒连/重启中），重试有意义。 */
  function isRetryableGatewayError(err) {
    const s = +err?.status;
    if (s === 524 || s === 504) return false;
    return isGatewayError(err);
  }

  /** 从 HTML 错误页里抠出一行人话；抠不到就返回空。 */
  function summarizeHtml(html) {
    if (!html) return "";
    const tt = html.match(/<title>([^<]+)<\/title>/i)?.[1]
            || html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]
            || html.match(/<h2[^>]*>([^<]+)<\/h2>/i)?.[1]
            || "";
    return tt.replace(/\s+/g, " ").trim();
  }

  /** 把上游错误体翻译成更友好的 Error。 */
  function buildHttpError(status, text) {
    let friendly = "HTTP " + status;
    let parsed = null;
    const t = String(text || "").trim();
    const looksHtml = /^\s*(<!doctype|<html|<\?xml)/i.test(t) || /<\/(html|body)>/i.test(t);
    if (!looksHtml) {
      // 兼容 “上游 AI 返回错误：{...json...}” 这种被中转包了一层的字符串
      const jsonStart = t.indexOf("{");
      if (jsonStart >= 0) {
        try { parsed = JSON.parse(t.slice(jsonStart)); } catch (_) {}
      }
      if (!parsed) { try { parsed = JSON.parse(t); } catch (_) {} }
    }
    const e = parsed?.error || parsed || {};
    const msg = e.message || e.error_msg || "";
    const isLimit = e.type === "usage_limit_reached" || /usage[_ ]?limit|rate[_ ]?limit|too many/i.test(msg) || status === 429;
    const isCooldown = e.code === "model_cooldown" || /cool(ing)?[ _-]?down/i.test(msg);
    let secs = +e.resets_in_seconds || +e.reset_seconds || 0;
    if (!secs && e.resets_at) secs = Math.max(0, +e.resets_at - Math.floor(Date.now() / 1000));
    if (!secs && typeof e.reset_time === "string") {
      // 形如 "50m46s" / "1h2m3s"
      const mm = e.reset_time.match(/(\d+)\s*h/i);
      const ss = e.reset_time.match(/(\d+)\s*m(?!s)/i);
      const ts = e.reset_time.match(/(\d+)\s*s/i);
      secs = (+(mm?.[1] || 0)) * 3600 + (+(ss?.[1] || 0)) * 60 + (+(ts?.[1] || 0));
    }
    const when = secs ? humanDuration(secs) : "稍后";
    if (isCooldown) {
      const m = e.model ? `「${e.model}」` : "";
      const p = e.provider ? `（provider: ${e.provider}）` : "";
      friendly = `上游中转的实际模型 ${m}${p} 全部凭据正在冷却，${when}后恢复。可改选其它模型再试。`;
    } else if (isLimit) {
      const plan = e.plan_type ? `（${e.plan_type} 套餐）` : "";
      friendly = `上游 AI 配额已用完${plan}，${when}后自动恢复。可在 AI 设置中切换其它供应商或模型继续。`;
    } else if (status === 504) {
      const tt = summarizeHtml(t);
      friendly = `上游网关超时（HTTP 504${tt ? "：" + tt : ""}）。图片/长文生成耗时较长时常见，重试或换模型一般就能恢复。`;
    } else if (status === 502 || status === 503 || (status >= 520 && status <= 524)) {
      const tt = summarizeHtml(t);
      friendly = `上游网关暂时不可达（HTTP ${status}${tt ? "：" + tt : ""}）。稍后重试或切换其它模型。`;
    } else if (looksHtml) {
      const tt = summarizeHtml(t);
      friendly = `HTTP ${status}${tt ? "：" + tt : "（上游返回了 HTML 错误页）"}`;
    } else if (msg) {
      friendly = `HTTP ${status}：${msg}`;
    } else if (t) {
      friendly = `HTTP ${status}：${t.slice(0, 240)}`;
    }
    const err = new Error(friendly);
    err.status = status;
    err.upstream = parsed;
    err.raw = text;
    err.bodyKind = looksHtml ? "html" : (parsed ? "json" : "text");
    return err;
  }

  function humanDuration(secs) {
    secs = Math.max(0, Math.floor(secs));
    if (secs < 60) return secs + " 秒";
    const m = Math.floor(secs / 60);
    if (m < 60) return m + " 分钟";
    const h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) return rm ? `${h} 小时 ${rm} 分钟` : `${h} 小时`;
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `${d} 天 ${rh} 小时` : `${d} 天`;
  }

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
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // 按 \n\n 切分 event。注意单条 event 的 data 可能跨多行，
        // 最后一段（未以 \n\n 收尾）留在 buf 里等下一轮。
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!block.trim()) continue;
          let evtName = "message";
          const dataLines = [];
          for (const line of block.split(/\r?\n/)) {
            if (!line) continue;
            if (line.startsWith(":")) continue;             // 注释 / 心跳
            const colon = line.indexOf(":");
            if (colon < 0) continue;
            const field = line.slice(0, colon).trim();
            const val   = line.slice(colon + 1).replace(/^ /, "");
            if (field === "event") evtName = val.trim();
            else if (field === "data") dataLines.push(val);
            // id / retry 字段忽略
          }
          const data = dataLines.join("\n");
          try {
            onEvent({ event: evtName, data, raw: block });
          } catch (cbErr) {
            // 回调异常不打断流，但记一下
            logger.debug?.("SSE onEvent threw:", cbErr);
          }
        }
      }
      // flush 剩余
      const tail = decoder.decode();
      if (tail) buf += tail;
      if (buf.trim()) {
        try { onEvent({ event: "message", data: buf, raw: buf }); } catch (_) {}
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
  }

  // ===================== 重试判定（借鉴 Image-Studio retry.go） =====================
  /** 上游 body 文本是否值得自动重试 —— 端口自 Image-Studio 的 IsRetryable：
   *  - 文本里含已知 CF / 网关错误标记
   *  - JSON 里 status ∈ {502, 503, 504, 524}，或 retryable: true
   *  - error.type ∈ {api_error, server_error}，或 error.message 含 "temporarily unavailable" */
  const _RETRY_MARKERS = [
    "error code 524", "524: a timeout occurred",
    "error code 504", "gateway time-out",
    "service temporarily unavailable", "origin_gateway_timeout",
  ];
  function isImageStudioRetryable(text) {
    if (!text) return false;
    const t = String(text);
    const lower = t.toLowerCase();
    for (const m of _RETRY_MARKERS) if (lower.includes(m)) return true;
    let j;
    try { j = JSON.parse(t.trim()); } catch (_) { return false; }
    if (j?.retryable === true) return true;
    const s = +j?.status;
    if (s === 502 || s === 503 || s === 504 || s === 524) return true;
    if (j?.error) {
      const msg = String(j.error.message || "").toLowerCase();
      const typ = String(j.error.type || "").toLowerCase();
      if (msg.includes("temporarily unavailable")) return true;
      if (typ === "api_error" || typ === "server_error") return true;
    }
    return false;
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

  /** 生图。返回 [{url|dataUrl, revisedPrompt?}]，错误走 buildHttpError。
   *  opts: { provider, model, prompt, size?, quality?, n?, signal, retry? }
   *  size 可以是 "1024x1024"/"3840x2160"/"auto"，也可以传 "WIDTHxHEIGHT" 任意自定义。 */
  async function generateImage(opts) {
    const { retry } = opts || {};
    // Responses 模式默认 3 次 + 15s 退避（借鉴 Image-Studio MaxAttempts=3, RetryBackoffSeconds=15）
    const isResponses = opts.apiMode === "responses";
    const defaultAttempts = isResponses ? 3 : 1;
    const defaultDelay    = isResponses ? 15_000 : 1500;
    const attempts  = Math.max(1, Math.min(5, +(retry?.maxAttempts) || defaultAttempts));
    const baseDelay = +(retry?.delayMs) || defaultDelay;

    let lastErr;
    let lastPartial = null;    // 跨重试保留最近的 partial_image，作为最终兜底

    for (let i = 0; i < attempts; i++) {
      if (i > 0) {
        try { retry?.onRetry?.(i, attempts, lastErr); } catch (_) {}
        // 退避：Responses 模式用固定退避（CF 抖动一般 5-15s 就过去了），其它用线性
        const delay = isResponses ? baseDelay : baseDelay * i;
        await sleepWithSignal(delay, opts.signal);
        if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      }
      try {
        const result = await imageRequest(opts);
        recordProbeOk(opts.provider, opts.model);
        return result;
      } catch (err) {
        lastErr = err;
        if (err?.name === "AbortError") throw err;

        // 收一下这次的 partial（如果有），下一轮成功就抛掉它，全失败就用它兜底
        if (err.partial) lastPartial = err.partial;

        // 确定性错误（model_not_found / 鉴权 / 配额 / 政策）—— 重试也是同样结果，立即跳出去让 fallback 接手
        if (_isDeterministicError(err)) {
          recordProbeError(opts.provider, opts.model, err);
          break;
        }

        const cool = isCooldownError(err);
        const gw = isRetryableGatewayError(err);
        // Image-Studio 风格的 body 重试判定（更宽松）：只在 Responses 模式启用
        const bodyRetryable = isResponses && isImageStudioRetryable(
          err.raw || err.upstreamError || err.message || ""
        );

        if (cool) recordCooldown(opts.provider, opts.model, err);
        else recordProbeError(opts.provider, opts.model, err);

        // Responses 模式下，524/504 也允许重试（这是 SSE 保活的目标场景）
        const retriable = cool || gw || bodyRetryable || (isResponses && (err.status === 524 || err.status === 504));
        if (!retriable) throw err;

        if (cool) {
          const need = cooldownSeconds(err);
          if (need > 0 && need * 1000 > baseDelay * attempts) throw err;
        }
      }
    }

    // 所有重试都失败：如果中途收过 partial_image，用它兜底（标记为 partial 来源）
    if (lastPartial?.dataUrl) {
      return [{
        dataUrl: lastPartial.dataUrl,
        revisedPrompt: lastPartial.revisedPrompt || "",
        sourceEvent: "partial",
        degraded: true,
      }];
    }

    // ★ 新增：Responses 模式全军覆没 + 错误像是"端点不存在 / 不支持" → 自动回退到 Images API 再试一次
    if (isResponses && _shouldFallbackToImages(lastErr)) {
      try {
        try { retry?.onRetry?.(attempts + 1, attempts + 1, lastErr, "fallback-images"); } catch (_) {}
        const fallback = await imageRequest({ ...opts, apiMode: "images" });
        // 给结果挂个标，让 UI 提示用户走了降级路径
        if (Array.isArray(fallback)) {
          fallback.forEach((r) => { if (r) r.fallbackFromResponses = true; });
        }
        return fallback;
      } catch (fbErr) {
        // 回退也失败：保留原始 Responses 错误（信息更准），把回退错误塞 cause 链
        lastErr.fallbackError = fbErr;
      }
    }
    throw lastErr;
  }

  /** Responses 模式失败时，判断要不要回退到 Images API。
   *  原则：错误像是"这个端点根本没实现"或"模型在 Responses 路由下不可用"时回退；
   *  普通的 429/限速/鉴权问题不回退（这些在 Images 路径下也会同样失败）。 */
  function _shouldFallbackToImages(err) {
    if (!err) return false;
    const s = +err.status || 0;
    if (s === 404 || s === 405 || s === 501) return true;
    if (s === 503 || s === 502 || s === 504) return true;
    const txt = String(err.raw || err.upstreamError || err.message || "").toLowerCase();
    if (!txt) return false;
    if (txt.includes("not implemented") || txt.includes("not found") || txt.includes("not supported")) return true;
    if (txt.includes("unknown route") || txt.includes("no such route")) return true;
    if (txt.includes("does not support") || txt.includes("model_not_found")) return true;
    // 中文中转常用提示：分组 X 下模型 Y 无可用渠道
    if (txt.includes("无可用渠道") || txt.includes("无可用通道") || txt.includes("没有可用")) return true;
    return false;
  }

  /** 不该重试的"确定性错误"——重试 N 次结果一样，浪费时间也浪费 token。
   *  - model_not_found：模型不存在/无权限，重试没用
   *  - invalid_request_error 含 size/parameter：参数错，重试没用
   *  - 401/403 鉴权：重试没用
   *  返回 true 表示直接跳出重试循环（让外层 fallback / 报错处理） */
  function _isDeterministicError(err) {
    if (!err) return false;
    const s = +err.status || 0;
    if (s === 401 || s === 403) return true;
    const txt = String(err.raw || err.upstreamError || err.message || "").toLowerCase();
    if (txt.includes("model_not_found")) return true;
    if (txt.includes("无可用渠道") || txt.includes("无可用通道")) return true;
    if (txt.includes("insufficient_quota") || txt.includes("billing_hard_limit")) return true;
    if (txt.includes("content_policy_violation") || txt.includes("moderation_blocked")) return true;
    if (txt.includes("invalid_api_key") || txt.includes("incorrect_api_key")) return true;
    return false;
  }

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
  async function imageRequestGemini({ provider, model, prompt, size, quality, signal }) {
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
      contents: [{ parts: [{ text: String(prompt || "").slice(0, 4000) }] }],
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
  async function imageRequestDashScope({ provider, model, prompt, size, n, signal }) {
    // 百炼尺寸用 "宽*高"（星号）；nav 的 "宽x高" 转一下，auto/自定义非法值则不传，让模型用默认。
    const dsSize = (size && size !== "auto" && /^\d+x\d+$/.test(size)) ? size.replace("x", "*") : undefined;
    const submit = dashscopeTarget(provider, "services/aigc/text2image/image-synthesis");
    const body = {
      model: model || "wanx2.1-t2i-turbo",
      input: { prompt: String(prompt || "").slice(0, 4000) },
      parameters: { n: Math.max(1, Math.min(4, +n || 1)), ...(dsSize ? { size: dsSize } : {}) },
    };
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
    const taskId = submitJson?.output?.task_id;
    if (!taskId) {
      const msg = submitJson?.output?.message || submitJson?.message || submitJson?.code || "百炼未返回 task_id（模型名或参数可能不被接受）";
      const e = new Error(String(msg)); e.status = submitRes.status; e.raw = submitTxt; throw e;
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
    if (isDashScopeProvider(provider, model)) {
      return await imageRequestDashScope({ provider, model, prompt, size, n, signal });
    }
    // Responses API 模式：走 SSE 流式（borrows Image-Studio 的 CF 524 规避思路）
    // 仅在调用方显式声明 apiMode === "responses" 时启用，避免误伤普通中转
    if (apiMode === "responses") {
      return await imageRequestResponses({ provider, model, prompt, size, quality, n, signal, onPartial, textModel });
    }
    // Gemini 原生分支：检测到 gemini-*-image-* 走 /v1beta/models/{model}:generateContent
    if (isGeminiImageModel(model)) {
      const requested = Math.max(1, Math.min(8, +n || 1));
      // Google 原生 generateContent 一次只产一张（candidateCount 视模型而定，保守做法是循环调用）
      if (requested === 1) {
        return await imageRequestGemini({ provider, model, prompt, size, quality, signal });
      }
      const all = [];
      for (let i = 0; i < requested; i++) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const one = await imageRequestGemini({ provider, model, prompt, size, quality, signal });
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

  /** 图生图（参考图编辑）。复用 generateImage 的重试/冷却/探测台账逻辑。
   *  opts: { provider, model, prompt, images:[dataUrl|{dataUrl}], size?, quality?, n?, signal, retry? } */
  async function generateImageEdit(opts) {
    const { retry } = opts || {};
    if (isDashScopeProvider(opts?.provider, opts?.model)) {
      throw new Error("百炼（DashScope）图生图需要公网图片 URL 输入，nav 当前用的是本地参考图（base64），暂未适配；图生图请改用 OpenAI 兼容的图片中转（如 gpt-image-1）。");
    }
    const attempts = Math.max(1, Math.min(5, +(retry?.maxAttempts) || 2));
    const baseDelay = +(retry?.delayMs) || 1500;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) {
        try { retry?.onRetry?.(i, attempts, lastErr); } catch (_) {}
        await sleepWithSignal(baseDelay * i, opts.signal);
        if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      }
      try {
        const result = await imageEditRequest(opts);
        recordProbeOk(opts.provider, opts.model);
        return result;
      } catch (err) {
        lastErr = err;
        if (err?.name === "AbortError") throw err;
        if (_isDeterministicError(err)) { recordProbeError(opts.provider, opts.model, err); break; }
        const cool = isCooldownError(err);
        const gw = isRetryableGatewayError(err);
        if (cool) recordCooldown(opts.provider, opts.model, err);
        else recordProbeError(opts.provider, opts.model, err);
        if (!(cool || gw)) throw err;
      }
    }
    throw lastErr;
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
      // 茶话会消息（多代理回答）扁平化成 [代理名]: 内容；普通消息保留 role
      .filter((m) => !m.councilHidden)
      .map((m) => {
        if (m.councilMember) {
          return {
            role: m.role,
            content: `[${m.councilMember.label}]: ${typeof m.content === "string" ? m.content : (m.content?.text || "")}`,
          };
        }
        return { role: m.role, content: typeof m.content === "string" ? m.content : (m.content?.text || "") };
      });

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

  /** 茶话会模式：为某个成员构造 messages；
   *  - 用成员自己的 persona 而不是 AIStore.currentPersona
   *  - 系统提示尾部加 "你的代理名：xxx"，让模型知道自己的身份
   *  - extraSystem：可选的额外指令（辩论第二轮的"综合反驳"prompt 就走这里） */
  async function buildMessagesForMember(member, userText, attachments, opts = {}) {
    const personaList = AIStore.data.personas || [];
    const persona = personaList.find((p) => p.id === member.personaId)
      || personaList[0]
      || DEFAULT_PERSONAS[0];
    let system = persona.prompt || "";
    if (AIStore.data.customSignature) system += "\n\n【用户的签名/资料】\n" + AIStore.data.customSignature;
    const navCtx = buildNavContext();
    system += "\n\n" + navCtx + NAV_ACTION_SPEC;
    system += `\n\n【茶话会身份】你是"${member.label}"。回答时不需要在开头自报名字（前端会自动加标签）。`;
    // 深度研究预设里成员自带 systemPromptOverride（角色偏置），覆盖默认 persona system 段后半部分
    if (member.systemPromptOverride) system += "\n\n【角色定位】" + member.systemPromptOverride;
    if (opts.extraSystem) system += "\n\n" + opts.extraSystem;

    const history = AIStore.messages
      .slice(-20)
      .filter((m) => !m.councilHidden)
      .map((m) => {
        if (m.councilMember) {
          return { role: m.role, content: `[${m.councilMember.label}]: ${typeof m.content === "string" ? m.content : (m.content?.text || "")}` };
        }
        return { role: m.role, content: typeof m.content === "string" ? m.content : (m.content?.text || "") };
      });

    let content;
    const imgs = (attachments || []).filter((a) => a.type === "image" && a.dataUrl);
    if (imgs.length) {
      content = [{ type: "text", text: userText || "（请分析图片）" }];
      for (const a of imgs) content.push({ type: "image_url", image_url: { url: a.dataUrl } });
    } else {
      content = userText || "";
      const texts = (attachments || []).filter((a) => a.type === "text" && a.text);
      if (texts.length) {
        content += "\n\n【附件内容】\n";
        for (const a of texts) content += "\n--- " + a.name + " ---\n" + a.text + "\n";
      }
    }
    if (opts.extraUser) content = (typeof content === "string" ? content : (content[0]?.text || "")) + "\n\n" + opts.extraUser;

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

    // 5. 图片 ![alt](url) —— 放在链接之前；同时支持 data:image/ 的 base64 直链
    s = s.replace(/!\[([^\]]*)\]\(((?:https?:|data:image\/)[^\s)]+)\)/g, (_, t, u) =>
      imageHTML(u, t));
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

  // 常见 AI 图片生成 / 图床域名（无扩展名也按图片处理）
  const IMG_HOST_RE = /(oaidalleapiprodscus\.blob\.core\.windows\.net|files\.oaiusercontent\.com|cdn\.openai\.com|image\.pollinations\.ai|images\.unsplash\.com|cdn\.discordapp\.com\/attachments|replicate\.delivery|cdn\.midjourney\.com|imagedelivery\.net|gateway\.ai\.cloudflare\.com\/.+\/image|api\.siliconflow\.cn\/.+\/image)/i;

  function linkifyMedia(url) {
    const clean = url.replace(/[.,;:!?]+$/, "");
    if (/^data:image\//i.test(clean)) return imageHTML(clean, "");
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$|#)/i.test(clean) || IMG_HOST_RE.test(clean)) {
      return imageHTML(clean, "");
    }
    if (/\.(mp4|webm|mov)(\?|$)/i.test(clean)) {
      return `<video class="ai-inline-video" src="${clean}" controls preload="metadata"></video>`;
    }
    if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(clean)) {
      return `<audio class="ai-inline-audio" src="${clean}" controls></audio>`;
    }
    return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>`;
  }

  /** 渲染单张可预览/下载的内联图。点击图片 → 灯箱；右上角悬浮按钮可直接下载。 */
  function imageHTML(src, alt) {
    const a = alt || "";
    return (
      `<figure class="ai-img-figure">` +
        `<img class="ai-inline-img" src="${src}" alt="${a}" loading="lazy" referrerpolicy="no-referrer" />` +
        `<div class="ai-img-tools">` +
          `<button type="button" class="ai-img-btn" data-img-act="open" title="新窗口打开">↗</button>` +
          `<button type="button" class="ai-img-btn" data-img-act="download" title="下载">⬇</button>` +
        `</div>` +
      `</figure>`
    );
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
    generateImageEdit,
    isGeminiImageModel,
    formatImageErrorMessage,
    IMAGE_SIZES,
    IMAGE_QUALITIES,
    buildMessages,
    buildMessagesForMember,
    parseActions,
    applyActions,
    renderMarkdown,
    fileToAttachment,
    isCooldownError,
    isGatewayError,
    cooldownSeconds,
    recordCooldown,
    recordProbeOk,
    recordProbeError,
    getModelStatus,
    pruneStaleStatus,
    rankModels,
    /** 创建一个茶话会成员模板。providerId / model 默认沿用当前；persona 默认 nav。 */
    makeCouncilMember(opts = {}) {
      const provider = opts.providerId
        ? AIStore.data.providers.find((p) => p.id === opts.providerId)
        : AIStore.currentProvider();
      const persona = opts.personaId
        ? AIStore.data.personas.find((p) => p.id === opts.personaId)
        : (AIStore.data.personas[0] || DEFAULT_PERSONAS[0]);
      const palette = ["#ff6b8a", "#7c83fa", "#3aa66e", "#ff9d4a", "#ad6dff", "#ec4899", "#0ea5e9", "#f59e0b"];
      const used = (AIStore.data.council?.members || []).map((m) => m.color);
      const color = opts.color || palette.find((c) => !used.includes(c)) || palette[Math.floor(Math.random() * palette.length)];
      // persona name 形如 "🌸 导航管家"：第一段是 emoji，其余是文字；对没有空格的兜底为整名
      const personaName = persona?.name || "代理";
      const firstSpace = personaName.indexOf(" ");
      const emojiPart = firstSpace > 0 ? personaName.slice(0, firstSpace) : "🌸";
      const namePart = firstSpace > 0 ? personaName.slice(firstSpace + 1) : personaName;
      return {
        id: opts.id || ("mem-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)),
        label: opts.label || (namePart + (used.length + 1)),
        emoji: opts.emoji || emojiPart,
        color,
        personaId: persona?.id || "",
        providerId: provider?.id || "",
        model: opts.model || provider?.defaultModel || "",
      };
    },
    probeModel,
    findAvailableModel,
    /** key = `${providerId}::${uiModel}` 或 `upstream::${provider}::${model}`，value = 冷却到期 Date.now() ms */
    cooldownLedger: Object.create(null),
    /** key = `${providerId}::${uiModel}`, value = `upstream::${provider}::${model}` */
    upstreamMap: Object.create(null),
    /** key = `${providerId}::${uiModel}`, value = { kind:"ok"|"error", ts:ms, msg? } */
    probeStatus: Object.create(null),
    uid: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    /** 简易 async 信号量。借鉴 grok2api 里 `_get_upload_sem()` 的"懒加载 + 配置驱动"思路。
     *  用法：const sem = AI.semaphore(4); await sem.run(() => doWork());
     *  - 同一时刻最多 n 个 fn 在执行，超出的排队等待
     *  - fn 抛错也会释放许可；调用方自己包 try/catch
     */
    semaphore(n) {
      const cap = Math.max(1, n | 0);
      let inFlight = 0;
      const waiters = [];
      const acquire = () => new Promise((resolve) => {
        if (inFlight < cap) { inFlight++; resolve(); }
        else waiters.push(resolve);
      });
      const release = () => {
        const next = waiters.shift();
        if (next) next();          // 让下一位拿到许可，inFlight 不变
        else inFlight--;
      };
      return {
        get inFlight() { return inFlight; },
        get pending() { return waiters.length; },
        async run(fn) {
          await acquire();
          try { return await fn(); }
          finally { release(); }
        },
      };
    },
    /** 给定 provider + 当前模型 + 已试过的模型集合，挑下一个"最不可能坏"的备选。
     *  借鉴 grok2api executor 的 fallback 思路：失败后用 rankModels 顺序取下一个未试过的。
     *  返回 null 表示没有更多备选可用。 */
    pickNextModelFor(provider, currentModel, triedSet) {
      const all = (provider?.models || []).filter(Boolean);
      if (!all.length) return null;
      const { ordered } = rankModels(provider, all);
      for (const m of ordered) {
        if (m && m !== currentModel && !triedSet.has(m)) return m;
      }
      return null;
    },
  };
})();
