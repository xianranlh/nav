/* 樱 · 多端同步模块
 * 支持后端：
 *   - WebDAV（坚果云 / Nextcloud / 自建 dav / InfiniCloud 等）
 *   - GitHub Gist（Personal Access Token）
 *   - 本地文件导入导出（备份用）
 *
 * 打包数据（sakura-nav@2）：导航、设置、博客、日历、AI、聊天、天气、音乐元数据、同步配置；
 * 可选：登录凭据哈希（仅本地 JSON 备份，勿上传不可信云端）
 * 说明：浏览器遗留 IndexedDB 不在此 JSON；同源部署时背景/音乐走服务端 media。
 * 数据：经 sakura-remote 写入服务端 SQLite
 */
(function () {
  "use strict";
  const KEY = "sakura_nav_sync_v1";
  const StorageAdapter = window.SakuraStorageAdapter?.adapter;
  if (!StorageAdapter) throw new Error("Storage adapter is not loaded");

  const STORAGE_KEYS = Object.freeze({
    nav: "sakura_nav_v1",
    settings: "sakura_nav_settings_v1",
    blog: "sakura_nav_blog_v1",
    calendar: "sakura_nav_calendar_v1",
    ai: "sakura_nav_ai_v1",
    chat: "sakura_nav_chat_v1",
    weather: "sakura_nav_weather_v1",
    music: "sakura_nav_music_v1",
    sync: KEY,
    authCred: "sakura_nav_auth_cred_v1",
  });

  const readStored = (key) => StorageAdapter.readJson(key);
  const writeStored = (key, value) => StorageAdapter.writeJson(key, value);

  const Sync = {
    data: {
      backend: "webdav",   // 'webdav' | 'gist' | 'off'
      webdav: { url: "", user: "", pass: "", path: "sakura-nav.json" },
      gist: { token: "", gistId: "", fileName: "sakura-nav.json" },
      includeAiKeys: false,
      /** 仅影响本地「备份 JSON」是否附带 sakura_nav_auth_cred_v1（云端上传/拉取不含） */
      includeAuthCred: false,
      auto: false,         // 自动上传（每次重要变更延迟 30s）
      lastPushed: 0,
      lastPulled: 0,
    },
    load() {
      try {
        const saved = readStored(KEY);
        if (saved) this.data = Object.assign(this.data, saved);
      } catch (_) {}
    },
    save() { writeStored(KEY, this.data); },
  };

  // ===================== 打包 / 解包 =====================
  function collect(forCloud) {
    // 本地 / 服务端 bundle 默认保留 AI 密钥（可信边界）；仅在上传到 WebDAV / Gist 等云端时按 includeAiKeys 开关决定
    const stripAiKeys = forCloud === true && !Sync.data.includeAiKeys;
    const data = {
      schema: "sakura-nav@2",
      savedAt: Date.now(),
      nav: readStored(STORAGE_KEYS.nav),
      settings: readStored(STORAGE_KEYS.settings),
      blog: readStored(STORAGE_KEYS.blog),
      calendar: readStored(STORAGE_KEYS.calendar),
      ai: readStored(STORAGE_KEYS.ai),
      chat: readStored(STORAGE_KEYS.chat),
      weather: readStored(STORAGE_KEYS.weather),
      music: readStored(STORAGE_KEYS.music),
      sync: readStored(STORAGE_KEYS.sync),
    };
    if (data.ai && stripAiKeys) {
      data.ai = JSON.parse(JSON.stringify(data.ai));
      data.ai.providers = (data.ai.providers || []).map((p) => ({ ...p, apiKey: "" }));
    }
    // 本地/服务端 bundle 默认带 authCred（让账号哈希跨设备一致）；仅在 WebDAV/Gist 等云端上传时按开关决定
    if (forCloud !== true) {
      data.authCred = readStored(STORAGE_KEYS.authCred);
    } else if (Sync.data.includeAuthCred) {
      data.authCred = readStored(STORAGE_KEYS.authCred);
    }
    return data;
  }

  /** 应用 bundle 里的 AI 配置时：若 bundle 的某个 provider 没带 key（典型是从云端拉下来的被剥离数据），
   *  用本地已有的同 id key 补回，避免"覆盖后本机反而没 key"。服务端 bundle 默认含 key，不需要补。 */
  function mergeAiFromLocal(ai) {
    if (!ai) return ai;
    const merged = JSON.parse(JSON.stringify(ai));
    const local = readStored(STORAGE_KEYS.ai);
    if (local && local.providers && merged.providers) {
      merged.providers.forEach((p) => {
        if (p.apiKey) return;
        const old = local.providers.find((x) => x.id === p.id);
        if (old && old.apiKey) p.apiKey = old.apiKey;
      });
    }
    return merged;
  }

  function apply(data, mode = "replace") {
    if (!data || typeof data.schema !== "string" || !data.schema.startsWith("sakura-nav@")) {
      throw new Error("数据格式不匹配");
    }
    if (mode !== "replace") throw new Error("仅支持 replace");
    const isV1 = data.schema === "sakura-nav@1";

    if (isV1) {
      const set = (k, v) => { if (v) writeStored(k, v); };
      set(STORAGE_KEYS.nav, data.nav);
      set(STORAGE_KEYS.settings, data.settings);
      set(STORAGE_KEYS.blog, data.blog);
      set(STORAGE_KEYS.calendar, data.calendar);
      if (data.ai) set(STORAGE_KEYS.ai, mergeAiFromLocal(data.ai));
      return;
    }

    const set = (k, v) => {
      if (v === undefined) return;
      writeStored(k, v);
    };
    if ("nav" in data) set(STORAGE_KEYS.nav, data.nav);
    if ("settings" in data) set(STORAGE_KEYS.settings, data.settings);
    if ("blog" in data) set(STORAGE_KEYS.blog, data.blog);
    if ("calendar" in data) set(STORAGE_KEYS.calendar, data.calendar);
    if (data.ai) set(STORAGE_KEYS.ai, mergeAiFromLocal(data.ai));
    if ("chat" in data) set(STORAGE_KEYS.chat, data.chat);
    if ("weather" in data) set(STORAGE_KEYS.weather, data.weather);
    if ("music" in data) set(STORAGE_KEYS.music, data.music);
    if ("sync" in data) set(STORAGE_KEYS.sync, data.sync);
    if ("authCred" in data && data.authCred != null) {
      writeStored(STORAGE_KEYS.authCred, data.authCred);
    } else if ("authCred" in data && data.authCred === null) {
      StorageAdapter.remove(STORAGE_KEYS.authCred);
    }
  }

  // ===================== WebDAV =====================
  async function davPut(cfg, body) {
    const { url, user, pass, path } = cfg;
    if (!url) throw new Error("WebDAV URL 未配置");
    const full = url.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
    const r = await fetch(full, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(user ? { "Authorization": "Basic " + btoa(user + ":" + pass) } : {}),
      },
      body,
    });
    if (!r.ok) throw new Error("WebDAV PUT 失败：HTTP " + r.status);
  }
  async function davGet(cfg) {
    const { url, user, pass, path } = cfg;
    if (!url) throw new Error("WebDAV URL 未配置");
    const full = url.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
    const r = await fetch(full, {
      headers: {
        ...(user ? { "Authorization": "Basic " + btoa(user + ":" + pass) } : {}),
      },
    });
    if (!r.ok) throw new Error("WebDAV GET 失败：HTTP " + r.status);
    return r.text();
  }

  // ===================== GitHub Gist =====================
  async function gistPush(cfg, body) {
    if (!cfg.token) throw new Error("Gist Token 未配置");
    const files = { [cfg.fileName || "sakura-nav.json"]: { content: body } };
    const headers = {
      "Authorization": "Bearer " + cfg.token,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
    };
    if (cfg.gistId) {
      const r = await fetch("https://api.github.com/gists/" + cfg.gistId, {
        method: "PATCH", headers, body: JSON.stringify({ files }),
      });
      if (!r.ok) throw new Error("Gist 更新失败：HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    } else {
      const r = await fetch("https://api.github.com/gists", {
        method: "POST", headers,
        body: JSON.stringify({ description: "Sakura Nav backup", public: false, files }),
      });
      if (!r.ok) throw new Error("Gist 创建失败：HTTP " + r.status);
      const j = await r.json();
      cfg.gistId = j.id;
      Sync.save();
    }
  }
  async function gistPull(cfg) {
    if (!cfg.token || !cfg.gistId) throw new Error("Gist Token 或 ID 未配置");
    const r = await fetch("https://api.github.com/gists/" + cfg.gistId, {
      headers: { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json" },
    });
    if (!r.ok) throw new Error("Gist 拉取失败：HTTP " + r.status);
    const j = await r.json();
    const file = j.files[cfg.fileName || "sakura-nav.json"] || Object.values(j.files)[0];
    if (!file) throw new Error("Gist 里没有文件");
    return file.content;
  }

  // ===================== 对外 =====================
  async function push() {
    const body = JSON.stringify(collect(true), null, 2);
    if (Sync.data.backend === "webdav") await davPut(Sync.data.webdav, body);
    else if (Sync.data.backend === "gist") await gistPush(Sync.data.gist, body);
    else throw new Error("未选择同步后端");
    Sync.data.lastPushed = Date.now();
    Sync.save();
  }
  async function pull({ mode = "replace" } = {}) {
    let body;
    if (Sync.data.backend === "webdav") body = await davGet(Sync.data.webdav);
    else if (Sync.data.backend === "gist") body = await gistPull(Sync.data.gist);
    else throw new Error("未选择同步后端");
    const data = JSON.parse(body);
    apply(data, mode);
    Sync.data.lastPulled = Date.now();
    Sync.save();
    return data;
  }

  // 自动同步（防抖）
  let autoTimer = null;
  function schedulePush() {
    if (!Sync.data.auto || Sync.data.backend === "off") return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { push().catch(() => {}); }, 30 * 1000);
  }

  // 本地备份 / 还原（含完整 localStorage 业务数据；不含 IndexedDB 大文件）
  function exportBlob() {
    return new Blob([JSON.stringify(collect(false), null, 2)], { type: "application/json" });
  }
  async function importFromFile(file, mode = "replace") {
    const text = await file.text();
    const data = JSON.parse(text);
    apply(data, mode);
    return data;
  }

  window.Sync = Sync;
  window.SyncUtils = { push, pull, schedulePush, exportBlob, importFromFile, collect, apply };
})();
