/* 樱 · 多端同步模块
 * 支持后端：
 *   - WebDAV（坚果云 / Nextcloud / 自建 dav / InfiniCloud 等）
 *   - GitHub Gist（Personal Access Token）
 *   - 本地文件导入导出（备份用）
 *
 * 同步数据：nav / settings / blog / calendar / ai.providers(不含 key 可选)
 * 数据：localStorage["sakura_nav_sync_v1"]
 */
(function () {
  "use strict";
  const KEY = "sakura_nav_sync_v1";

  const Sync = {
    data: {
      backend: "webdav",   // 'webdav' | 'gist' | 'off'
      webdav: { url: "", user: "", pass: "", path: "sakura-nav.json" },
      gist: { token: "", gistId: "", fileName: "sakura-nav.json" },
      includeAiKeys: false,
      auto: false,         // 自动上传（每次重要变更延迟 30s）
      lastPushed: 0,
      lastPulled: 0,
    },
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) this.data = Object.assign(this.data, JSON.parse(raw));
      } catch (_) {}
    },
    save() { localStorage.setItem(KEY, JSON.stringify(this.data)); },
  };

  // ===================== 打包 / 解包 =====================
  function collect() {
    const data = {
      schema: "sakura-nav@1",
      savedAt: Date.now(),
      nav: JSON.parse(localStorage.getItem("sakura_nav_v1") || "null"),
      settings: JSON.parse(localStorage.getItem("sakura_nav_settings_v1") || "null"),
      blog: JSON.parse(localStorage.getItem("sakura_nav_blog_v1") || "null"),
      calendar: JSON.parse(localStorage.getItem("sakura_nav_calendar_v1") || "null"),
      ai: JSON.parse(localStorage.getItem("sakura_nav_ai_v1") || "null"),
    };
    if (data.ai && !Sync.data.includeAiKeys) {
      data.ai.providers = (data.ai.providers || []).map((p) => ({ ...p, apiKey: "" }));
    }
    return data;
  }
  function apply(data, mode = "replace") {
    if (!data || data.schema !== "sakura-nav@1") throw new Error("数据格式不匹配");
    const set = (k, v) => { if (v) localStorage.setItem(k, JSON.stringify(v)); };
    if (mode === "replace") {
      set("sakura_nav_v1", data.nav);
      set("sakura_nav_settings_v1", data.settings);
      set("sakura_nav_blog_v1", data.blog);
      set("sakura_nav_calendar_v1", data.calendar);
      if (data.ai) {
        // 合并 API key：如果远程没 key 就保留本地 key
        if (!Sync.data.includeAiKeys) {
          const local = JSON.parse(localStorage.getItem("sakura_nav_ai_v1") || "null");
          if (local && local.providers && data.ai.providers) {
            data.ai.providers.forEach((p) => {
              const old = local.providers.find((x) => x.id === p.id);
              if (old && old.apiKey) p.apiKey = old.apiKey;
            });
          }
        }
        set("sakura_nav_ai_v1", data.ai);
      }
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
    const body = JSON.stringify(collect(), null, 2);
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

  // 本地备份 / 还原
  function exportBlob() {
    return new Blob([JSON.stringify(collect(), null, 2)], { type: "application/json" });
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
