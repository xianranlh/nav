/* 樱 · 历史归档（图库 + 多会话）
 *
 * 复用 idb.js 的 openDB / makeStore 思路：自建一个 sakura-nav-archive 数据库，
 * 内含两个 store：
 *   - gallery     : 生图结果 / 用户上传图片
 *   - sessions    : 历史会话快照（每个 session 一条记录 = {meta, messages}）
 *
 * 暴露：window.Archive = { Gallery, Sessions, ready }
 *
 * 设计原则：
 *   - 所有 API 都是 async，调用方 await
 *   - 不阻塞 AIStore.saveMessages：图库新增和 session 同步都"尽力而为"，错误吞掉只打 console
 *   - 内存不持有完整数据，每次 list 都重新读 DB（数据量有限：图库百~千张、会话几十个）
 */
(function () {
  "use strict";

  const DB_NAME = "sakura-nav-archive";
  const DB_VERSION = 1;
  const STORES = ["gallery", "sessions"];

  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("当前浏览器不支持 IndexedDB"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) {
            // 用 keyPath: "id" 让记录自带 id，list 时 cursor 更方便
            db.createObjectStore(s, { keyPath: "id" });
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { try { db.close(); } catch (_) {} _dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function uid(prefix) {
    return (prefix || "x") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  async function _tx(store, mode, fn) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const objStore = tx.objectStore(store);
      let result;
      try { result = fn(objStore); } catch (e) { rej(e); return; }
      tx.oncomplete = () => res(result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  }

  async function _request(store, mode, makeReq) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const r = makeReq(tx.objectStore(store));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  // ==========================================================================
  // Gallery
  // ==========================================================================
  /** Gallery 记录形如：
   *  {
   *    id:    "img-{ts}-{rand}",
   *    source: "generated" | "uploaded",
   *    dataUrl: string (data:image/... 或 远程 url),
   *    prompt?: string,         // 生图：用户原始 prompt
   *    revisedPrompt?: string,  // 生图：模型改写后的 prompt
   *    model?: string,          // 生图：使用的模型
   *    size?:  string,          // 生图：1024x1024 等
   *    quality?: string,        // 生图：auto/standard/hd
   *    name?:  string,          // 上传：原始文件名
   *    mime?:  string,
   *    bytes?: number,
   *    favorite: boolean,
   *    ts: number,              // 入库时间戳 ms
   *  }
   */
  // ---------------- 服务端上传（图床）能力探测 + 实际上传 ----------------
  // 第一次 add 时探测 /api/gallery/list；返回 200/401 表示端点存在（401 是 auth 但可见）
  // 探测结果用 sessionStorage 缓存，避免每次新增都打 list 请求
  let _serverProbed = false;
  let _serverAvailable = false;
  async function _probeServer() {
    if (_serverProbed) return _serverAvailable;
    try {
      const cached = sessionStorage.getItem("sakura_gallery_server_ok");
      if (cached === "1") { _serverProbed = true; _serverAvailable = true; return true; }
      if (cached === "0") { _serverProbed = true; _serverAvailable = false; return false; }
    } catch (_) {}
    try {
      const r = await fetch("/api/gallery/list?limit=1", { credentials: "same-origin" });
      _serverAvailable = r.status === 200 || r.status === 401; // 401 = 有端点，只是要授权（公网读图仍可访问）
      try { sessionStorage.setItem("sakura_gallery_server_ok", _serverAvailable ? "1" : "0"); } catch (_) {}
    } catch (_) {
      _serverAvailable = false;
    }
    _serverProbed = true;
    return _serverAvailable;
  }

  async function _uploadToServer(rec) {
    if (!await _probeServer()) return null;
    try {
      const body = {
        dataUrl: rec.dataUrl,
        source: rec.source,
        prompt: rec.prompt,
        revisedPrompt: rec.revisedPrompt,
        model: rec.model,
        size: rec.size,
        quality: rec.quality,
        name: rec.name,
        mime: rec.mime,
        client_id: rec.id,
      };
      const r = await fetch("/api/gallery/upload", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        // 401 静默：用户没登录走公网；只在控制台打点
        if (r.status !== 401) console.debug("[Gallery] upload non-200:", r.status);
        return null;
      }
      const j = await r.json();
      return j; // { ok, id, url, ext }
    } catch (e) {
      console.debug("[Gallery] upload error:", e?.message || e);
      return null;
    }
  }

  const Gallery = {
    /** 暴露给外部以便手动触发服务端探测 / 上传单张 */
    _probeServer,

    async add(item) {
      try {
        const rec = {
          id: item.id || uid("img"),
          source: item.source || "generated",
          dataUrl: item.dataUrl || "",
          prompt: item.prompt || "",
          revisedPrompt: item.revisedPrompt || "",
          model: item.model || "",
          size: item.size || "",
          quality: item.quality || "",
          name: item.name || "",
          mime: item.mime || "",
          bytes: item.bytes || 0,
          favorite: !!item.favorite,
          ts: item.ts || Date.now(),
        };
        if (!rec.dataUrl) return null;
        await _request("gallery", "readwrite", (s) => s.put(rec));

        // 后台异步上传到服务端图床；返回 url 后回填到记录里（不阻塞调用方）
        (async () => {
          const result = await _uploadToServer(rec);
          if (result && result.url) {
            await Gallery.update(rec.id, {
              serverUrl: result.url,
              serverId: result.id,
              uploadedAt: Date.now(),
            });
            // 通知 UI 刷新（图库面板若打开会自己重渲染）
            try {
              window.dispatchEvent(new CustomEvent("sakura:gallery-uploaded", {
                detail: { id: rec.id, url: result.url, serverId: result.id },
              }));
            } catch (_) {}
          }
        })();

        return rec.id;
      } catch (e) {
        console.warn("[Gallery.add]", e);
        return null;
      }
    },

    /** 批量入库，跳过任何抛错的项；返回成功入库的 id 列表 */
    async addBatch(items) {
      const ids = [];
      for (const it of items || []) {
        const id = await Gallery.add(it);
        if (id) ids.push(id);
      }
      return ids;
    },

    /** 列出所有，按 ts 倒序；source: "generated" | "uploaded" | undefined（全部） */
    async list(opts = {}) {
      try {
        const all = await _request("gallery", "readonly", (s) => s.getAll());
        let arr = Array.isArray(all) ? all : [];
        if (opts.source) arr = arr.filter((x) => x.source === opts.source);
        if (opts.favoriteOnly) arr = arr.filter((x) => x.favorite);
        if (opts.query) {
          const q = String(opts.query).toLowerCase();
          arr = arr.filter((x) =>
            (x.prompt || "").toLowerCase().includes(q) ||
            (x.revisedPrompt || "").toLowerCase().includes(q) ||
            (x.name || "").toLowerCase().includes(q) ||
            (x.model || "").toLowerCase().includes(q));
        }
        arr.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        return arr;
      } catch (e) {
        console.warn("[Gallery.list]", e);
        return [];
      }
    },

    async get(id) {
      return _request("gallery", "readonly", (s) => s.get(id)).catch(() => null);
    },

    async remove(id) {
      return _request("gallery", "readwrite", (s) => s.delete(id)).catch(() => {});
    },

    async update(id, patch) {
      try {
        const cur = await Gallery.get(id);
        if (!cur) return null;
        const next = { ...cur, ...patch, id };
        await _request("gallery", "readwrite", (s) => s.put(next));
        return next;
      } catch (e) {
        console.warn("[Gallery.update]", e);
        return null;
      }
    },

    async toggleFavorite(id) {
      const cur = await Gallery.get(id);
      if (!cur) return false;
      return !!(await Gallery.update(id, { favorite: !cur.favorite }))?.favorite;
    },

    async clear() {
      return _request("gallery", "readwrite", (s) => s.clear()).catch(() => {});
    },

    async count() {
      try {
        return await _request("gallery", "readonly", (s) => s.count());
      } catch (_) { return 0; }
    },

    /** 用于占用统计：返回估算总字节数（dataUrl base64 长度 × 0.75）。 */
    async totalBytes() {
      try {
        const arr = await _request("gallery", "readonly", (s) => s.getAll());
        let bytes = 0;
        for (const x of arr || []) {
          if (x.bytes) bytes += x.bytes;
          else if (x.dataUrl && x.dataUrl.startsWith("data:")) {
            const i = x.dataUrl.indexOf(",");
            if (i > 0) bytes += Math.floor((x.dataUrl.length - i - 1) * 0.75);
          }
        }
        return bytes;
      } catch (_) { return 0; }
    },
  };

  // ==========================================================================
  // Sessions
  // ==========================================================================
  /** Session 记录形如：
   *  {
   *    id:    "ses-{ts}-{rand}",
   *    title: "默认会话" | 自动生成的首条用户消息摘要,
   *    createdAt: number,
   *    updatedAt: number,
   *    messageCount: number,
   *    model?: string,    // 最近一次使用的模型
   *    persona?: string,  // 最近一次的角色
   *    pinned: boolean,
   *    messages: [...],   // 完整消息数组（与 AIStore.messages 同构）
   *  }
   */
  const CURRENT_KEY = "sakura_nav_current_session_v1";

  const Sessions = {
    async create({ title, messages = [], model, persona } = {}) {
      const now = Date.now();
      const rec = {
        id: uid("ses"),
        title: title || "新会话 · " + new Date(now).toLocaleString().replace(/\//g, "-"),
        createdAt: now,
        updatedAt: now,
        messageCount: messages.length,
        model: model || "",
        persona: persona || "",
        pinned: false,
        messages: messages.slice(-200),
      };
      await _request("sessions", "readwrite", (s) => s.put(rec));
      return rec;
    },

    /** 列出所有会话元信息（不含 messages 大字段）。pinned 在前、updatedAt 倒序 */
    async list() {
      try {
        const all = await _request("sessions", "readonly", (s) => s.getAll());
        const arr = (all || []).map(({ messages, ...meta }) => ({
          ...meta,
          messageCount: meta.messageCount ?? (Array.isArray(messages) ? messages.length : 0),
        }));
        arr.sort((a, b) => {
          if (!!b.pinned - !!a.pinned !== 0) return (!!b.pinned) - (!!a.pinned);
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        return arr;
      } catch (e) {
        console.warn("[Sessions.list]", e);
        return [];
      }
    },

    async load(id) {
      return _request("sessions", "readonly", (s) => s.get(id)).catch(() => null);
    },

    /** 保存（包括 messages）。如果记录不存在，会自动新建。
     *  metaPatch 用于在保存时一并更新 title/model/persona 等元信息。 */
    async save(id, messages, metaPatch = {}) {
      try {
        const cur = await Sessions.load(id);
        const now = Date.now();
        const next = {
          id,
          title: metaPatch.title || cur?.title || "新会话",
          createdAt: cur?.createdAt || now,
          updatedAt: now,
          messageCount: messages.length,
          model: metaPatch.model ?? cur?.model ?? "",
          persona: metaPatch.persona ?? cur?.persona ?? "",
          pinned: metaPatch.pinned ?? cur?.pinned ?? false,
          messages: Array.isArray(messages) ? messages.slice(-200) : [],
        };
        await _request("sessions", "readwrite", (s) => s.put(next));
        return next;
      } catch (e) {
        console.warn("[Sessions.save]", e);
        return null;
      }
    },

    async rename(id, title) {
      const cur = await Sessions.load(id);
      if (!cur) return null;
      cur.title = String(title || "").slice(0, 80) || cur.title;
      cur.updatedAt = Date.now();
      await _request("sessions", "readwrite", (s) => s.put(cur));
      return cur;
    },

    async togglePinned(id) {
      const cur = await Sessions.load(id);
      if (!cur) return null;
      cur.pinned = !cur.pinned;
      cur.updatedAt = Date.now();
      await _request("sessions", "readwrite", (s) => s.put(cur));
      return cur;
    },

    async remove(id) {
      return _request("sessions", "readwrite", (s) => s.delete(id)).catch(() => {});
    },

    async clear() {
      return _request("sessions", "readwrite", (s) => s.clear()).catch(() => {});
    },

    currentId() {
      try { return localStorage.getItem(CURRENT_KEY) || ""; } catch (_) { return ""; }
    },

    setCurrentId(id) {
      try {
        if (id) localStorage.setItem(CURRENT_KEY, id);
        else localStorage.removeItem(CURRENT_KEY);
      } catch (_) {}
    },

    /** 从第一条用户消息推断会话标题（前 24 字符）。 */
    autoTitle(messages) {
      const first = (messages || []).find((m) => m.role === "user");
      const raw = first?.content;
      let txt = typeof raw === "string"
        ? raw
        : (Array.isArray(raw) ? (raw.find((b) => b.type === "text")?.text || "") : "");
      txt = String(txt || "").replace(/\s+/g, " ").trim();
      if (!txt) return "";
      return txt.length > 24 ? txt.slice(0, 24) + "…" : txt;
    },

    /** 全文搜索消息（跨所有会话）。 */
    async search(query) {
      try {
        const all = await _request("sessions", "readonly", (s) => s.getAll());
        const q = String(query || "").toLowerCase();
        if (!q) return [];
        const hits = [];
        for (const ses of all || []) {
          const matches = (ses.messages || []).filter((m) => {
            const txt = typeof m.content === "string"
              ? m.content
              : (Array.isArray(m.content) ? (m.content.find((b) => b.type === "text")?.text || "") : "");
            return String(txt || "").toLowerCase().includes(q);
          });
          if (matches.length) {
            hits.push({
              session: { id: ses.id, title: ses.title, updatedAt: ses.updatedAt },
              matches: matches.slice(0, 5),
              total: matches.length,
            });
          }
        }
        hits.sort((a, b) => (b.session.updatedAt || 0) - (a.session.updatedAt || 0));
        return hits;
      } catch (e) {
        console.warn("[Sessions.search]", e);
        return [];
      }
    },
  };

  // ==========================================================================
  // 启动期：迁移 localStorage 里现有的单会话到 Sessions store
  // ==========================================================================
  async function _bootstrap() {
    try {
      const list = await Sessions.list();
      if (list.length) return; // 已经有会话，不动
      // 没有任何会话：把当前 localStorage 里的对话（如果有）迁移成"默认会话"
      let messages = [];
      try {
        const raw = localStorage.getItem("sakura_nav_chat_v1");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) messages = parsed;
        }
      } catch (_) {}
      const title = Sessions.autoTitle(messages) || "默认会话";
      const rec = await Sessions.create({ title, messages });
      Sessions.setCurrentId(rec.id);
    } catch (e) {
      console.warn("[Archive bootstrap]", e);
    }
  }

  window.Archive = {
    Gallery,
    Sessions,
    ready: _bootstrap(),       // Promise；调用方可以 await
    _internals: { openDB, uid }, // 调试用
  };
})();
