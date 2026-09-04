/* 登录鉴权模块（多账号版）
 * - 凭据校验在服务端：前端提交 SHA-256("用户名::密码")，明文不过线
 * - 登录成功后保存服务端签发的 session token（localStorage 或 sessionStorage）
 * - 全局 fetch 补丁：同源 /api/* 请求自动附带 Authorization: Bearer <token>；
 *   收到 401 时清除本地会话并回到登录页
 */
(function () {
  "use strict";

  const TOKEN_KEY = "sakura_nav_token_v1";

  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function readToken() {
    for (const store of [localStorage, sessionStorage]) {
      try {
        const raw = store.getItem(TOKEN_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
    }
    return null;
  }

  function writeToken(data, remember) {
    const raw = JSON.stringify(data);
    if (remember) localStorage.setItem(TOKEN_KEY, raw);
    else sessionStorage.setItem(TOKEN_KEY, raw);
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
  }

  function getToken() {
    const tk = readToken();
    if (!tk || typeof tk.token !== "string") return null;
    if (typeof tk.expiresAt === "number" && Date.now() >= tk.expiresAt) return null;
    return tk.token;
  }

  function currentUser() {
    const tk = readToken();
    return tk && tk.user ? tk.user : null;
  }

  async function isAuthed() {
    return !!getToken();
  }

  /** @returns {Promise<{ok: boolean, reason?: string}>} */
  async function login(user, pass, remember = true) {
    if (!user || !pass) return { ok: false, reason: "请填写用户名与密码" };
    const hash = await sha256(`${user}::${pass}`);
    let r, j;
    try {
      r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user, hash, remember: !!remember }),
      });
      j = await r.json().catch(() => null);
    } catch (e) {
      return { ok: false, reason: "无法连接服务端：" + (e?.message || e) };
    }
    if (!r.ok || !j || !j.token) {
      return { ok: false, reason: (j && j.error) || "用户名或密码不正确" };
    }
    clearToken();
    writeToken({ token: j.token, expiresAt: j.expiresAt, user: j.user }, remember);
    return { ok: true, user: j.user };
  }

  function logout() {
    const t = getToken();
    if (t) {
      try {
        fetch("/api/auth/logout", { method: "POST", headers: { authorization: "Bearer " + t } }).catch(() => {});
      } catch (_) {}
    }
    clearToken();
  }

  /** 向 .xianran.de 签发 SSO cookie，本机反代据此跳过 Basic Auth */
  async function issueSso() {
    if (!getToken()) return false;
    try {
      const r = await fetch("/api/sso/issue");
      return !!(r && r.ok);
    } catch (_) {
      return false;
    }
  }

  function isLocalProxyUrl(url) {
    try {
      const u = new URL(url, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      const h = u.hostname.toLowerCase();
      if (h === location.hostname.toLowerCase()) return false;
      return h === "xianran.de" || h.endsWith(".xianran.de");
    } catch (_) {
      return false;
    }
  }

  async function openLocal(url, target) {
    if (isLocalProxyUrl(url)) {
      try { await issueSso(); } catch (_) {}
    }
    if (!target || target === "_self") location.href = url;
    else window.open(url, target, "noopener");
  }

  /**
   * 修改用户名与密码（先在服务端验证当前凭据，再提交新凭据）
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

    // 服务端验证当前凭据（成功会发新 session，用它提交修改）
    const cur = await login(cu, cp, false);
    if (!cur.ok) return { ok: false, reason: "当前用户名或密码不正确" };

    const newHash = await sha256(`${nu}::${np}`);
    let r, j;
    try {
      r = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: "Bearer " + getToken() },
        body: JSON.stringify({ username: nu, hash: newHash }),
      });
      j = await r.json().catch(() => null);
    } catch (e) {
      return { ok: false, reason: "无法连接服务端：" + (e?.message || e) };
    }
    if (!r.ok) return { ok: false, reason: (j && j.error) || "修改失败" };
    clearToken(); // 服务端已踢掉全部会话
    return { ok: true };
  }

  // ===================== 全局 fetch 补丁 =====================
  // 同源 /api/* 自动带 Bearer token；401（登录接口除外）→ 清会话回登录页
  const realFetch = window.fetch.bind(window);
  function isSameOriginApi(input) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const u = new URL(url, location.href);
      return u.origin === location.origin && u.pathname.startsWith("/api/");
    } catch (_) { return false; }
  }
  let reloading = false;
  window.fetch = function (input, init) {
    if (isSameOriginApi(input)) {
      const t = getToken();
      if (t) {
        init = init ? { ...init } : {};
        const headers = new Headers(init.headers || (typeof input !== "string" && input.headers) || {});
        if (!headers.has("authorization")) headers.set("authorization", "Bearer " + t);
        init.headers = headers;
      }
      return realFetch(input, init).then((r) => {
        const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
        if (r.status === 401 && !path.startsWith("/api/auth/login") && getToken() && !reloading) {
          reloading = true;
          clearToken();
          if (window.toast) window.toast("登录已过期，请重新登录");
          setTimeout(() => location.reload(), 800);
        }
        return r;
      });
    }
    return realFetch(input, init);
  };

  window.Auth = {
    isAuthed,
    login,
    logout,
    issueSso,
    changeCredentials,
    getToken,
    currentUser,
    hasCustomCredentials: () => true, // 多账号版恒为服务端凭据
    _sha256: sha256,
  };

  window.NavSso = { isLocal: isLocalProxyUrl, open: openLocal };

  // 捕获本机反代链接点击：先刷新 SSO cookie 再跳转（卡片 / 最近 / 星标共用）
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    if (a.hasAttribute("download")) return;
    if (!isLocalProxyUrl(a.href)) return;
    e.preventDefault();
    openLocal(a.href, a.target || "_self");
  }, true);
})();
