# Auto Fill Link Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“添加网址”弹窗中只输入 URL 时，自动回填标题与图标（标题由服务端抓取，图标沿用现有 favicon 回退链），且不覆盖用户手动输入。

**Architecture:** 前端监听 `#form-link` 的 URL 输入，debounce 后并行触发 favicon 回退与服务端 `/api/metadata` 标题抓取；通过 touched 标记与请求序号确保只应用最新结果且不覆盖手动编辑。服务端新增 `/api/metadata`，包含 SSRF 限制、超时与短缓存。

**Tech Stack:** Vanilla JS（`app.js`）、Express（`server/index.js`）、Node 内置 `fetch`、现有 `BookmarkTools.getBestIcon`（`bookmarks.js`）。

---

## File structure changes

**Modify:**
- `index.html`（确认“添加网址”表单字段与选择器保持一致；如需增加提示/状态位）
- `app.js`（新增 URL 输入监听、debounce、自动回填逻辑）
- `server/index.js`（新增 `/api/metadata` 路由）

**Optional new file (recommended for cleanliness):**
- Create `server/metadata.js`（URL 校验、SSRF 防护、title 解析、缓存逻辑）

**Tests:**
- Create `server/metadata.test.js`（使用 Node 内置 `node:test` + `assert`，对 URL 校验与 title 解析做单元测试）

---

### Task 1: Add server metadata utility + tests

**Files:**
- Create: `server/metadata.js`
- Create: `server/metadata.test.js`

- [ ] **Step 1: Write failing tests for URL allow/deny + title extraction**

```js
// server/metadata.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { isSafeHttpUrl, extractTitleFromHtml } from "./metadata.js";

test("isSafeHttpUrl allows normal https url", () => {
  assert.equal(isSafeHttpUrl("https://example.com/"), true);
});

test("isSafeHttpUrl denies non-http schemes", () => {
  assert.equal(isSafeHttpUrl("file:///etc/passwd"), false);
  assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHttpUrl("data:text/html,hi"), false);
});

test("isSafeHttpUrl denies localhost and private ranges", () => {
  assert.equal(isSafeHttpUrl("http://127.0.0.1/"), false);
  assert.equal(isSafeHttpUrl("http://localhost/"), false);
  assert.equal(isSafeHttpUrl("http://10.0.0.1/"), false);
  assert.equal(isSafeHttpUrl("http://192.168.1.2/"), false);
  assert.equal(isSafeHttpUrl("http://172.16.0.5/"), false);
});

test("extractTitleFromHtml prefers og:title then <title>", () => {
  const html1 = `<html><head><meta property="og:title" content="OG Title"><title>Doc Title</title></head></html>`;
  assert.equal(extractTitleFromHtml(html1), "OG Title");
  const html2 = `<html><head><title>Doc Title</title></head></html>`;
  assert.equal(extractTitleFromHtml(html2), "Doc Title");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test server/metadata.test.js
```

Expected: FAIL because `server/metadata.js` does not exist.

- [ ] **Step 3: Implement minimal metadata utilities**

```js
// server/metadata.js
import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;
  // IPv4 ranges
  if (ip === "127.0.0.1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  const m = /^172\\.(\\d+)\\./.exec(ip);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  // link-local
  if (ip.startsWith("169.254.")) return true;
  // IPv6 localhost / unique local / link-local
  if (ip === "::1") return true;
  if (ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd")) return true;
  if (ip.toLowerCase().startsWith("fe80:")) return true;
  return false;
}

export async function isSafeHttpUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (_) { return false; }
  if (!(u.protocol === "http:" || u.protocol === "https:")) return false;
  const host = (u.hostname || "").toLowerCase();
  if (!host) return false;
  if (host === "localhost") return false;
  // If hostname is IP, validate directly. Else resolve DNS A/AAAA.
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs || addrs.length === 0) return false;
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch (_) {
    return false;
  }
}

export function extractTitleFromHtml(html) {
  const s = String(html || "");
  // og:title
  const og = /<meta\\s+[^>]*property=[\"']og:title[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>/i.exec(s);
  if (og && og[1]) return og[1].trim();
  // <title>
  const t = /<title[^>]*>([\\s\\S]*?)<\\/title>/i.exec(s);
  if (t && t[1]) return t[1].replace(/\\s+/g, " ").trim();
  return "";
}

export function createTtlCache(ttlMs) {
  const m = new Map(); // url -> { exp, val }
  return {
    get(key) {
      const it = m.get(key);
      if (!it) return null;
      if (Date.now() > it.exp) { m.delete(key); return null; }
      return it.val;
    },
    set(key, val) {
      m.set(key, { exp: Date.now() + ttlMs, val });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
node --test server/metadata.test.js
```

Expected: PASS.

---

### Task 2: Add `/api/metadata` endpoint

**Files:**
- Modify: `server/index.js`
- Modify (if needed): `server/metadata.js`

- [ ] **Step 1: Add route using SSRF checks + timeout + cache**

Implement in `server/index.js` (exact placement: after `/healthz` is fine):

```js
import { isSafeHttpUrl, extractTitleFromHtml, createTtlCache } from "./metadata.js";

const metaCache = createTtlCache(20 * 60 * 1000); // 20 min

app.get("/api/metadata", auth, async (req, res) => {
  const rawUrl = String(req.query.url || "");
  const url = rawUrl.trim();
  if (!url) return res.status(400).json({ ok: false, error: "missing url" });
  if (!(await isSafeHttpUrl(url))) return res.status(400).json({ ok: false, error: "unsafe url" });

  const cached = metaCache.get(url);
  if (cached) return res.json({ ok: true, title: cached.title || "" });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4500);
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "sakura-nav-metadata/1.0",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("html")) {
      return res.json({ ok: true, title: "" });
    }
    const html = await r.text();
    const title = extractTitleFromHtml(html);
    metaCache.set(url, { title });
    return res.json({ ok: true, title });
  } catch (e) {
    return res.json({ ok: false, error: String(e && e.message ? e.message : e) });
  } finally {
    clearTimeout(t);
  }
});
```

- [ ] **Step 2: Manual smoke test**

Run server (your normal way), then:

```bash
curl -s "http://127.0.0.1:3001/api/metadata?url=$(python - <<'PY'\nimport urllib.parse\nprint(urllib.parse.quote('https://example.com/'))\nPY)"
```

Expected: JSON with `ok` and `title` (may be empty depending on site).

---

### Task 3: Frontend auto-fill for link dialog

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add small helper to call `/api/metadata` safely**

Add a function near the “链接弹窗” section:

```js
async function fetchMetaTitle(url) {
  try {
    const r = await fetch("/api/metadata?url=" + encodeURIComponent(url), { credentials: "same-origin" });
    const j = await r.json().catch(() => null);
    if (!j || j.ok !== true) return "";
    return String(j.title || "").trim();
  } catch (_) {
    return "";
  }
}
```

- [ ] **Step 2: Track touched flags and request sequencing**

Add state in the “链接弹窗” section:

```js
let linkNameTouched = false;
let linkIconTouched = false;
let linkAutoReq = 0;
let linkAutoTimer = null;
```

Bind listeners once:

```js
formLink.name.addEventListener("input", () => { linkNameTouched = true; });
$("#icon-url-input")?.addEventListener("input", () => { linkIconTouched = true; });
```

Reset flags in `openLinkDialog()` depending on edit/new:
- For new link: both false
- For edit link: set to true if field already has value (so we don't overwrite)

- [ ] **Step 3: Implement debounce auto-fill on URL input**

Bind:

```js
formLink.url.addEventListener("input", () => {
  clearTimeout(linkAutoTimer);
  const myReq = ++linkAutoReq;
  linkAutoTimer = setTimeout(async () => {
    if (myReq !== linkAutoReq) return;
    let url = formLink.url.value.trim();
    if (!url) return;
    if (!/^https?:\\/\\//i.test(url)) url = "https://" + url;

    // name: immediate fallback to host
    if (!linkNameTouched && !formLink.name.value.trim()) {
      formLink.name.value = safeHost(url) || "";
    }

    // icon
    if (!linkIconTouched && !formLink.icon.value.trim() && window.BookmarkTools?.getBestIcon) {
      const iconUrl = await BookmarkTools.getBestIcon(url);
      if (myReq !== linkAutoReq) return;
      if (iconUrl && !linkIconTouched && !formLink.icon.value.trim()) {
        formLink.icon.value = iconUrl;
        updateIconPreview(iconUrl);
      }
    }

    // title from server
    if (!linkNameTouched) {
      const title = await fetchMetaTitle(url);
      if (myReq !== linkAutoReq) return;
      if (title && !linkNameTouched) formLink.name.value = title;
    }
  }, 500);
});
```

- [ ] **Step 4: Manual test**

In browser:
- Open “添加网址”
- Paste `https://example.com/`
- Expect: name auto-fills (host then title), icon auto-fills if available
- Then manually edit name/icon; change URL again; ensure manual values are not overwritten

---

### Task 4: Polish + regression checks

**Files:**
- Modify: `index.html` (optional small hint text)
- Modify: `app.js` (optional toasts or status)

- [ ] **Step 1: Ensure no new console errors**
- [ ] **Step 2: Verify link save path unchanged**
  - Submit form still uses existing `formLink.addEventListener("submit", ...)`
  - Ensure URL normalization still happens there
- [ ] **Step 3: Verify server mode + static mode behavior**
  - Static mode: `/api/metadata` fails → name stays as host; icon may still fill via third-party favicon services

---

## Self-review checklist

- [ ] Spec coverage: debounce + touched protection + server title fetch + SSRF restriction + timeout + cache all covered
- [ ] Placeholder scan: no TODO/TBD in tasks
- [ ] Consistency: IDs match `index.html` (`#form-link`, `#icon-url-input`, etc.)

