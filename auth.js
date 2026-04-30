/* 登录鉴权模块
 * - 校验凭据：优先 sakura-remote 存储中的 SHA-256("用户名::密码")；未自定义时回退内置默认哈希
 * - 用户可在「设置 → 账号与安全」中修改用户名与密码（会写入服务端 bundle，并退出登录）
 * - 登录成功后生成 token，保存到 localStorage / sessionStorage，有效期 7 天
 *
 * 注意：纯前端无法做到真正的安全鉴权（客户端代码可绕过），
 * 此机制仅用于防止他人在你的设备上随手打开页面时看到数据。
 */
(function () {
  "use strict";

  const TOKEN_KEY = "sakura_nav_token_v1";
  const CRED_KEY = "sakura_nav_auth_cred_v1";
  const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

  /** 未自定义凭据时的默认账号（与旧版一致）：SHA-256("xianran::lh116688257") */
  const LEGACY_DEFAULT_HASH = "0ae8f34aa71b498f71b88924734ef40fcfa1c2e76c72ecede5c2b56de4244ed1";
  // 用来混入 token 指纹
  const TOKEN_SECRET = "sakura-2026-v1";

  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** @returns {string|null} 64 位小写 hex */
  function getStoredCredHash() {
    try {
      const raw = localStorage.getItem(CRED_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      const h = o && typeof o.h === "string" ? o.h.trim().toLowerCase() : "";
      return /^[0-9a-f]{64}$/.test(h) ? h : null;
    } catch (_) {
      return null;
    }
  }

  function setStoredCredHash(hashHex) {
    localStorage.setItem(CRED_KEY, JSON.stringify({ h: hashHex }));
  }

  function readToken() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function writeToken(data) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
  }

  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  async function buildToken() {
    const issuedAt = Date.now();
    const nonce = crypto.getRandomValues(new Uint32Array(2)).join("-");
    const fp = await sha256(TOKEN_SECRET + "|" + issuedAt + "|" + nonce);
    return { issuedAt, expiresAt: issuedAt + SESSION_MS, nonce, fp };
  }

  async function verifyToken(tk) {
    if (!tk || typeof tk !== "object") return false;
    if (typeof tk.expiresAt !== "number" || Date.now() >= tk.expiresAt) return false;
    const fp = await sha256(TOKEN_SECRET + "|" + tk.issuedAt + "|" + tk.nonce);
    return fp === tk.fp;
  }

  /** @returns {Promise<boolean>} */
  async function isAuthed() {
    const tk = readToken();
    return await verifyToken(tk);
  }

  /** @returns {Promise<{ok: boolean, reason?: string}>} */
  async function login(user, pass, remember = true) {
    if (!user || !pass) return { ok: false, reason: "请填写用户名与密码" };
    const hash = await sha256(`${user}::${pass}`);
    const stored = getStoredCredHash();
    if (stored) {
      if (hash !== stored) return { ok: false, reason: "用户名或密码不正确" };
    } else if (hash !== LEGACY_DEFAULT_HASH) {
      return { ok: false, reason: "用户名或密码不正确" };
    }
    const tk = await buildToken();
    if (remember) writeToken(tk);
    else {
      // 不勾选"保持登录"：写入 sessionStorage（关闭标签即失效）
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tk));
    }
    return { ok: true };
  }

  function logout() {
    clearToken();
    sessionStorage.removeItem(TOKEN_KEY);
  }

  // 支持 sessionStorage 场景
  const origRead = readToken;
  function readTokenAny() {
    const a = origRead();
    if (a) return a;
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  async function isAuthedAny() {
    return await verifyToken(readTokenAny());
  }

  /**
   * 修改用户名与密码（需验证当前密码）
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async function changeCredentials(curUser, curPass, newUser, newPass, newPass2) {
    const cu = String(curUser || "").trim();
    const cp = String(curPass || "");
    const nu = String(newUser || "").trim();
    const np = String(newPass || "");
    const n2 = String(newPass2 || "");
    if (!cu || !cp) return { ok: false, reason: "请填写当前用户名与密码" };
    if (!nu) return { ok: false, reason: "请填写新用户名" };
    if (np.length < 4) return { ok: false, reason: "新密码至少 4 个字符" };
    if (np !== n2) return { ok: false, reason: "两次输入的新密码不一致" };
    const curHash = await sha256(`${cu}::${cp}`);
    const stored = getStoredCredHash();
    const curOk = stored ? curHash === stored : curHash === LEGACY_DEFAULT_HASH;
    if (!curOk) return { ok: false, reason: "当前用户名或密码不正确" };
    const newHash = await sha256(`${nu}::${np}`);
    setStoredCredHash(newHash);
    logout();
    return { ok: true };
  }

  function hasCustomCredentials() {
    return !!getStoredCredHash();
  }

  window.Auth = {
    isAuthed: isAuthedAny,
    login,
    logout,
    changeCredentials,
    hasCustomCredentials,
    // 便于调试 / 迁移说明
    _sha256: sha256,
  };
})();
