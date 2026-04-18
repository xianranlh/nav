/* 登录鉴权模块
 * - 账号密码以 SHA-256(用户名::密码) 的形式保存在代码中（非明文）
 * - 登录成功后生成 token，保存到 localStorage，有效期 7 天
 * - 页面刷新时自动校验 token 是否有效；无效则显示登录层
 *
 * 注意：纯前端无法做到真正的安全鉴权（客户端代码可绕过），
 * 此机制仅用于防止他人在你的设备上随手打开页面时看到数据。
 */
(function () {
  "use strict";

  const TOKEN_KEY = "sakura_nav_token_v1";
  const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

  // SHA-256("xianran::lh116688257")
  const EXPECTED_HASH = "0ae8f34aa71b498f71b88924734ef40fcfa1c2e76c72ecede5c2b56de4244ed1";
  // 用来混入 token 指纹，换账号时改这个即可使旧 token 失效
  const TOKEN_SECRET = "sakura-2026-v1";

  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
    if (hash !== EXPECTED_HASH) return { ok: false, reason: "用户名或密码不正确" };
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

  window.Auth = {
    isAuthed: isAuthedAny,
    login,
    logout,
    // 便于调试
    _sha256: sha256,
  };
})();
