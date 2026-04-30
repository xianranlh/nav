/* 樱 · 服务端数据模式
 * - 同源 GET /api/data 可用时：业务数据不写浏览器 localStorage，仅内存 + 防抖 PUT 到 SQLite
 * - 同源 /api/data 不可用时：禁止业务数据落入浏览器，并让应用停在服务端存储错误页
 * - 登录 token 仍只代表本机会话；账号哈希随 bundle 同步到服务端
 */
(function () {
  "use strict";

  const STORAGE_REQUIRED = true;

  /** 仅 session token 留在本机；业务数据、账号哈希、设置、聊天等都进入服务端 bundle */
  const EXCLUDE_KEYS = new Set([
    "sakura_nav_token_v1",
  ]);

  const realSetItem = Storage.prototype.setItem;
  const realGetItem = Storage.prototype.getItem;
  const realRemoveItem = Storage.prototype.removeItem;
  const realKey = Storage.prototype.key;

  function interceptKey(k) {
    return typeof k === "string" && k.startsWith("sakura_") && !EXCLUDE_KEYS.has(k);
  }

  const mem = new Map();
  let hooked = false;
  let storageMode = "native"; // native | remote | blocked
  let pushTimer = null;
  let remoteActive = false;
  let storageBlocked = false;
  let pending = false;

  function listLegacyBusinessKeys() {
    const keys = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = realKey.call(window.localStorage, i);
        if (!k) continue;
        if (!interceptKey(k)) continue;
        keys.push(k);
      }
    } catch (_) {}
    return keys;
  }

  function purgeLegacyBusinessStorage() {
    const keys = listLegacyBusinessKeys();
    for (const k of keys) {
      if (!interceptKey(k)) continue;
      try { realRemoveItem.call(window.localStorage, k); } catch (_) {}
    }
    return keys.length;
  }

  /** 首次 hook 时把浏览器 localStorage 里的已有业务键读进 mem。
   *  空服务端库会先上传 mem，再清理这些真实浏览器键，避免迁移中途丢数据。 */
  function seedMemFromLocalStorage() {
    let count = 0;
    for (const k of listLegacyBusinessKeys()) {
      if (mem.has(k)) continue;
      try {
        const v = realGetItem.call(window.localStorage, k);
        if (v != null) {
          mem.set(k, String(v));
          count++;
        }
      } catch (_) {}
    }
    return count;
  }

  async function putCurrentBundle() {
    if (!window.SyncUtils || typeof SyncUtils.collect !== "function") {
      throw new Error("同步模块尚未加载，无法写入服务端");
    }
    const body = JSON.stringify(SyncUtils.collect(false));
    const r = await fetch("/api/data", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!r.ok) throw new Error("上传失败 HTTP " + r.status);
    pending = false;
    return r;
  }

  function schedulePush() {
    if (!remoteActive || !window.SyncUtils || typeof SyncUtils.collect !== "function") return;
    pending = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      putCurrentBundle().catch((e) => {
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

  function hookStorage() {
    if (hooked) return;
    hooked = true;

    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage && interceptKey(key)) {
        if (storageMode === "remote") {
          mem.set(key, String(value));
          schedulePush();
        } else {
          console.warn("[sakura-remote] 已阻止浏览器业务数据写入：", key);
        }
        return;
      }
      return realSetItem.apply(this, arguments);
    };
    Storage.prototype.getItem = function (key) {
      if (this === window.localStorage && interceptKey(key)) {
        if (storageMode === "remote") return mem.has(key) ? mem.get(key) : null;
        return null;
      }
      return realGetItem.apply(this, arguments);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === window.localStorage && interceptKey(key)) {
        if (storageMode === "remote") {
          mem.delete(key);
          schedulePush();
        } else {
          try { realRemoveItem.call(window.localStorage, key); } catch (_) {}
        }
        return;
      }
      return realRemoveItem.apply(this, arguments);
    };
  }

  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  let initReason = "";

  function blockBrowserBusinessStorage(reason, err) {
    remoteActive = false;
    storageBlocked = true;
    storageMode = "blocked";
    initReason = reason;
    hookStorage();
    if (err) console.warn("[sakura-remote] " + reason, err);
    else console.warn("[sakura-remote] " + reason);
  }

  async function parseJsonResponse(r) {
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  async function runInit() {
    let r;
    try {
      r = await fetch("/api/data", { credentials: "same-origin" });
    } catch (e) {
      blockBrowserBusinessStorage("服务端存储不可达：" + (e && e.message ? e.message : e), e);
      return;
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("json")) {
      blockBrowserBusinessStorage("当前页面没有同源 /api/data，已停止浏览器本地业务存储");
      return;
    }

    const j = await parseJsonResponse(r);
    if (!j) {
      blockBrowserBusinessStorage("服务端 /api/data 响应不是有效 JSON");
      return;
    }

    if (r.status === 401) {
      blockBrowserBusinessStorage("服务端存储鉴权失败（SAKURA_API_KEY 不匹配）");
      return;
    }
    if (r.status === 503) {
      blockBrowserBusinessStorage("服务端 API 不可用");
      return;
    }
    if (r.status === 404 && j.empty === true) {
      const seeded = seedMemFromLocalStorage();
      storageMode = "remote";
      storageBlocked = false;
      hookStorage();
      remoteActive = true;
      if (seeded > 0) {
        try {
          await putCurrentBundle();
          const purged = purgeLegacyBusinessStorage();
          initReason = "服务端模式（空库；已迁移并清理 " + purged + " 个浏览器遗留业务键）";
        } catch (e) {
          blockBrowserBusinessStorage("浏览器遗留数据迁移到服务端失败，已停止写入浏览器", e);
        }
      } else {
        purgeLegacyBusinessStorage();
        initReason = "服务端模式（空库；等待首次保存）";
      }
      return;
    }
    if (r.status === 200 && typeof j.schema === "string" && j.schema.indexOf("sakura-nav@") === 0) {
      storageMode = "remote";
      storageBlocked = false;
      hookStorage();
      remoteActive = true;
      initReason = "服务端模式（已加载 SQLite 数据）";
      if (window.SyncUtils && typeof SyncUtils.apply === "function") {
        SyncUtils.apply(j, "replace");
      }
      const purged = purgeLegacyBusinessStorage();
      if (purged > 0) initReason += "；已清理 " + purged + " 个浏览器遗留业务键";
      return;
    }
    blockBrowserBusinessStorage("无法识别的 /api/data 响应（HTTP " + r.status + "）");
  }

  runInit().catch((e) => {
    blockBrowserBusinessStorage("服务端存储初始化失败：" + (e && e.message ? e.message : e), e);
  }).finally(() => { resolveReady(); });

  /** 立即将当前数据 PUT 到同源 /api/data（不等待防抖） */
  async function pushNow() {
    if (!remoteActive) {
      throw new Error("当前不是服务端存储模式（需同源且已启用 /api/data）");
    }
    clearTimeout(pushTimer);
    pushTimer = null;
    await putCurrentBundle();
    purgeLegacyBusinessStorage();
  }

  /** 从同源 /api/data 拉取并覆盖当前内存数据 */
  async function pullNow() {
    if (!remoteActive) throw new Error("当前不是服务端存储模式");
    const r = await fetch("/api/data", { credentials: "same-origin" });
    if (r.status === 503) throw new Error("服务端未配置 API 密钥");
    if (r.status === 401) throw new Error("未授权");
    const j = await parseJsonResponse(r);
    if (r.status === 404 && j && j.empty === true) {
      throw new Error("服务器上尚无保存的数据");
    }
    if (r.status === 200 && j && typeof j.schema === "string" && j.schema.indexOf("sakura-nav@") === 0) {
      clearTimeout(pushTimer);
      pushTimer = null;
      if (window.SyncUtils && typeof SyncUtils.apply === "function") {
        SyncUtils.apply(j, "replace");
      }
      purgeLegacyBusinessStorage();
      return;
    }
    throw new Error("无法应用服务端数据（HTTP " + r.status + "）");
  }

  window.SakuraRemote = {
    ready,
    init: () => ready,
    isRemote: () => remoteActive,
    isRequired: () => STORAGE_REQUIRED,
    isBlocked: () => storageBlocked,
    reason: () => initReason,
    pushNow,
    pullNow,
    _getBrowserLocalItem: (key) => realGetItem.call(window.localStorage, key),
    _removeBrowserLocalItem: (key) => realRemoveItem.call(window.localStorage, key),
    _purgeLegacyBusinessStorage: purgeLegacyBusinessStorage,
  };
})();
