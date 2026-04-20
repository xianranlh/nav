/* 樱 · 服务端数据模式
 * - 同源 GET /api/data 返回 JSON 时：业务数据不写浏览器 localStorage，仅内存 + 防抖 PUT
 * - 登录 token / 凭据仍用真实 localStorage（见 EXCLUDE_KEYS）
 * - Docker：nginx 向上游注入 Authorization Bearer，浏览器不带密钥
 */
(function () {
  "use strict";

  /** 仅 session token 留在本地（每台机器独立会话），账号哈希随 bundle 同步到服务端 */
  const EXCLUDE_KEYS = new Set([
    "sakura_nav_token_v1",
  ]);

  function interceptKey(k) {
    return typeof k === "string" && k.startsWith("sakura_") && !EXCLUDE_KEYS.has(k);
  }

  const mem = new Map();
  let hooked = false;
  let pushTimer = null;
  let remoteActive = false;

  let pending = false;

  function schedulePush() {
    if (!remoteActive || !window.SyncUtils || typeof SyncUtils.collect !== "function") return;
    pending = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const body = JSON.stringify(SyncUtils.collect(false));
      pending = false;
      fetch("/api/data", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body,
      }).catch((e) => {
        pending = true;
        console.warn("[sakura-remote] PUT failed", e);
      });
    }, 1000);
  }

  /** 页面卸载时用 sendBeacon 兜底：不受防抖窗口影响，保证最新数据写入服务端 */
  function flushOnUnload() {
    if (!remoteActive || !pending || !window.SyncUtils) return;
    try {
      const body = JSON.stringify(SyncUtils.collect(false));
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/data", blob);
      } else {
        // 兜底：同步 XHR（老浏览器）
        const x = new XMLHttpRequest();
        x.open("PUT", "/api/data", false);
        x.setRequestHeader("Content-Type", "application/json");
        x.send(body);
      }
      pending = false;
    } catch (_) {}
  }
  window.addEventListener("pagehide", flushOnUnload);
  window.addEventListener("beforeunload", flushOnUnload);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnUnload();
  });

  /** 首次 hook 时把浏览器 localStorage 里的已有业务键读进 mem，避免用户遗留数据被"藏起来"。
   *  如果服务端此刻是空库，这相当于自动把本地数据迁到服务端（下一次防抖 push 生效）。 */
  function seedMemFromLocalStorage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (!interceptKey(k)) continue;
        if (mem.has(k)) continue;
        const v = localStorage.getItem(k);
        if (v != null) mem.set(k, String(v));
      }
    } catch (_) {}
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
  let initReason = "";

  async function runInit() {
    let r;
    try {
      r = await fetch("/api/data", { credentials: "same-origin" });
    } catch (e) {
      initReason = "网络不可达：" + (e && e.message ? e.message : e);
      console.warn("[sakura-remote] /api/data 不可达，将回退为浏览器本地存储。", e);
      return;
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("json")) {
      initReason = "同源无 /api/data（纯静态部署）";
      return;
    }

    let j = null;
    try {
      j = JSON.parse(await r.text());
    } catch (_) {
      initReason = "响应不是 JSON";
      return;
    }

    if (r.status === 401) {
      initReason = "鉴权失败（SAKURA_API_KEY 不匹配），已回退到浏览器本地存储";
      console.warn("[sakura-remote] " + initReason);
      return;
    }
    if (r.status === 503) {
      initReason = "服务端 API 不可用";
      console.warn("[sakura-remote] " + initReason);
      return;
    }
    if (r.status === 404 && j && j.empty === true) {
      // 空库：先把浏览器遗留数据塞进 mem，避免被 hook 后 getItem 返回 null（自动迁移）
      seedMemFromLocalStorage();
      hookStorage();
      remoteActive = true;
      initReason = "服务端模式（空库；本地遗留键已种入 mem，将随首次写入推送到服务端）";
      if (mem.size > 0) schedulePush();
      return;
    }
    if (r.status === 200 && j && typeof j.schema === "string" && j.schema.indexOf("sakura-nav@") === 0) {
      hookStorage();
      remoteActive = true;
      initReason = "服务端模式（已加载库存数据）";
      if (window.SyncUtils && typeof SyncUtils.apply === "function") {
        SyncUtils.apply(j, "replace");
      }
      return;
    }
    initReason = "无法识别的 /api/data 响应（HTTP " + r.status + "）";
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
    reason: () => initReason,
    pushNow,
    pullNow,
  };
})();
