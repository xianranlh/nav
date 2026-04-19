/* 樱 · 服务端数据模式
 * - 同源 GET /api/data 返回 JSON 时：业务数据不写浏览器 localStorage，仅内存 + 防抖 PUT
 * - 登录 token / 凭据仍用真实 localStorage（见 EXCLUDE_KEYS）
 * - Docker：nginx 向上游注入 Authorization Bearer，浏览器不带密钥
 */
(function () {
  "use strict";

  const EXCLUDE_KEYS = new Set([
    "sakura_nav_token_v1",
    "sakura_nav_auth_cred_v1",
  ]);

  function interceptKey(k) {
    return typeof k === "string" && k.startsWith("sakura_") && !EXCLUDE_KEYS.has(k);
  }

  const mem = new Map();
  let hooked = false;
  let pushTimer = null;
  let remoteActive = false;

  function schedulePush() {
    if (!remoteActive || !window.SyncUtils || typeof SyncUtils.collect !== "function") return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const body = JSON.stringify(SyncUtils.collect(false));
      fetch("/api/data", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body,
      }).catch((e) => console.warn("[sakura-remote] PUT failed", e));
    }, 1000);
  }

  function hookStorage() {
    if (hooked) return;
    hooked = true;
    const LS = Storage.prototype;
    const origSet = LS.setItem;
    const origGet = LS.getItem;
    const origRemove = LS.removeItem;

    LS.setItem = function (key, value) {
      if (this === window.localStorage && interceptKey(key)) {
        mem.set(key, String(value));
        schedulePush();
        return;
      }
      return origSet.apply(this, arguments);
    };
    LS.getItem = function (key) {
      if (this === window.localStorage && interceptKey(key)) {
        return mem.has(key) ? mem.get(key) : null;
      }
      return origGet.apply(this, arguments);
    };
    LS.removeItem = function (key) {
      if (this === window.localStorage && interceptKey(key)) {
        mem.delete(key);
        schedulePush();
        return;
      }
      return origRemove.apply(this, arguments);
    };
  }

  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });

  async function runInit() {
    let r;
    try {
      r = await fetch("/api/data", { credentials: "same-origin" });
    } catch (_) {
      return;
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("json")) return;

    const text = await r.text();
    let j;
    try {
      j = JSON.parse(text);
    } catch (_) {
      return;
    }

    if (r.status === 503 || r.status === 401) return;
    if (r.status === 404 && j.empty === true) {
      hookStorage();
      remoteActive = true;
      return;
    }
    if (r.status === 200 && j && typeof j.schema === "string" && j.schema.indexOf("sakura-nav@") === 0) {
      hookStorage();
      remoteActive = true;
      if (window.SyncUtils && typeof SyncUtils.apply === "function") {
        SyncUtils.apply(j, "replace");
      }
    }
  }

  runInit().catch(() => {}).finally(() => { resolveReady(); });

  /** 立即将当前数据 PUT 到同源 /api/data（不等待防抖） */
  async function pushNow() {
    if (!remoteActive || !window.SyncUtils || typeof SyncUtils.collect !== "function") {
      throw new Error("当前不是服务端存储模式（需同源且已启用 /api/data）");
    }
    clearTimeout(pushTimer);
    pushTimer = null;
    const body = JSON.stringify(SyncUtils.collect(false));
    const r = await fetch("/api/data", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!r.ok) throw new Error("上传失败 HTTP " + r.status);
  }

  /** 从同源 /api/data 拉取并覆盖本地（与启动时逻辑一致） */
  async function pullNow() {
    if (!remoteActive) throw new Error("当前不是服务端存储模式");
    const r = await fetch("/api/data", { credentials: "same-origin" });
    if (r.status === 503) throw new Error("服务端未配置 API 密钥");
    if (r.status === 401) throw new Error("未授权");
    const text = await r.text();
    let j;
    try {
      j = JSON.parse(text);
    } catch (_) {
      throw new Error("响应不是有效 JSON");
    }
    if (r.status === 404 && j.empty === true) {
      throw new Error("服务器上尚无保存的数据");
    }
    if (r.status === 200 && j && typeof j.schema === "string" && j.schema.indexOf("sakura-nav@") === 0) {
      clearTimeout(pushTimer);
      pushTimer = null;
      if (window.SyncUtils && typeof SyncUtils.apply === "function") {
        SyncUtils.apply(j, "replace");
      }
      return;
    }
    throw new Error("无法应用服务端数据（HTTP " + r.status + "）");
  }

  window.SakuraRemote = {
    ready,
    init: () => ready,
    isRemote: () => remoteActive,
    pushNow,
    pullNow,
  };
})();
