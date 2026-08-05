/**
 * 闲然导航 · 数据 API：SQLite + 媒体文件目录
 * GET/PUT /api/data — 需 Authorization: Bearer
 * POST /api/media/bg|music — 上传（需鉴权）
 * GET /api/media/file/... — 直链读取
 * DELETE /api/media/file/... — 删除（需鉴权）
 *
 * 本地用 Node 同时托管前端：node index.js --static（或 SERVE_STATIC=1）
 * 默认端口 18080；静态根目录为仓库根，可用 STATIC_ROOT 覆盖。
 */
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import multer from "multer";
import AdmZip from "adm-zip";
import {
  openDatabase,
  closeDatabase,
  getBundle,
  setBundle,
  recordMediaFile,
  deleteMediaRecord,
  getSqliteStorageStats,
  getKeyInventory,
  getKeyValue,
  deleteKey,
  getDbPath,
  getDataDir,
  snapshotDatabaseTo,
  getAiSettings,
  setAiSettings,
  recordGalleryFile,
  getGalleryFile,
  findGalleryByClientId,
  listGalleryFiles,
  deleteGalleryFile,
  countGalleryFiles,
  findUserByCredHash,
  getUser,
  listUsers,
  createUser,
  updateUserCred,
  deleteUser,
  createSession,
  getSession,
  deleteSession,
  listMediaFiles,
} from "./database.js";
import {
  isSafeHttpUrl,
  extractTitleFromHtml,
  createTtlCache,
  readResponseTextLimited,
} from "./metadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = process.argv.slice(2);
if (argv.includes("--static") || argv.includes("-s")) {
  process.env.SERVE_STATIC = "1";
  if (!process.env.PORT) process.env.PORT = "18080";
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || "/data";
const API_KEY = (process.env.SAKURA_API_KEY || "").trim();

/**
 * 公开访问的基础 URL 前缀（用于图床 URL 拼接）。
 *
 * - 未设置：图库 URL 返回相对路径（"/api/gallery/image/xxx.png"），
 *   浏览器看到后自动拼成当前域 → 行为跟以前一样
 * - 已设置（如 "https://cdn.xianran.de"）：返回绝对 URL，
 *   复制出来的链接 / 列表里的 url 都用 CDN 域，但 nav 主站继续在原域
 *
 * 借鉴 grok2api 的 app.app_url 设计 —— 让图床域可以跟主域解耦：
 *   - cdn.xianran.de 反代到同一个 Node 后端，专门服务静态图
 *   - nav.xianran.de 服务 UI + 接受上传
 *
 * 注意：APP_URL 不必带尾斜杠；如果带了会自动去掉。
 */
const APP_URL = String(process.env.APP_URL || "").trim().replace(/\/$/, "");

/** 把 gallery 文件名拼成对外可访问的 URL。 */
function galleryPublicUrl(filename) {
  const p = `/api/gallery/image/${filename}`;
  return APP_URL ? `${APP_URL}${p}` : p;
}

const SERVE_STATIC =
  process.env.SERVE_STATIC === "1" ||
  process.env.SERVE_STATIC === "true";
const STATIC_ROOT = process.env.STATIC_ROOT
  ? path.resolve(process.env.STATIC_ROOT)
  : path.join(__dirname, "..");

app.disable("x-powered-by");
app.use(express.json({ limit: "50mb" }));

openDatabase(DATA_DIR);

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {}
}

function mediaBase(cat) {
  return path.join(DATA_DIR, "media", cat);
}

function safeJoinMedia(cat, filename) {
  const base = path.resolve(mediaBase(cat));
  const name = path.basename(filename || "");
  if (!name || name !== filename || name.includes("..")) return null;
  const filePath = path.resolve(base, name);
  if (!filePath.startsWith(base + path.sep)) return null;
  return filePath;
}

/** 多账号鉴权中间件：
 *  1. Bearer <session-token>（正常登录会话）→ req.user = { userId, username, isAdmin }
 *  2. Bearer SAKURA_API_KEY（运维/脚本兼容）→ 视为用户 #1（admin）
 *  3. ?token= 查询参数（sendBeacon 无法带 header 的兜底，仅同样走 session 校验） */
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const key = (m ? m[1] : String(req.query.token || "")).trim();
  if (!key) return res.status(401).json({ error: "未登录" });
  if (API_KEY && key === API_KEY) {
    req.user = { userId: 1, username: "api-key", isAdmin: true };
    return next();
  }
  const sess = getSession(key);
  if (!sess) return res.status(401).json({ error: "会话无效或已过期" });
  req.user = sess;
  req.sessionToken = key;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "需要管理员权限" });
  next();
}

// ===================== 登录 / 会话 =====================
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;       // 7 天
const SESSION_TTL_LONG_MS = 30 * 24 * 60 * 60 * 1000; // 「保持登录」30 天

/** 登录限速：每 IP 15 分钟内最多 10 次失败 */
const _loginFails = new Map(); // ip -> { count, resetAt }
function loginRateLimited(ip) {
  const rec = _loginFails.get(ip);
  if (!rec || Date.now() > rec.resetAt) return false;
  return rec.count >= 10;
}
function noteLoginFail(ip) {
  const rec = _loginFails.get(ip);
  if (!rec || Date.now() > rec.resetAt) {
    _loginFails.set(ip, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
  } else {
    rec.count += 1;
  }
  if (_loginFails.size > 5000) _loginFails.clear();
}

/** 登录：前端提交 sha256("用户名::密码") 哈希，明文不过线 */
app.post("/api/auth/login", (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "?";
  if (loginRateLimited(ip)) {
    return res.status(429).json({ error: "尝试过于频繁，请 15 分钟后再试" });
  }
  const body = req.body || {};
  const hash = String(body.hash || "").trim().toLowerCase();
  const u = findUserByCredHash(hash);
  if (!u) {
    noteLoginFail(ip);
    return res.status(401).json({ error: "用户名或密码错误" });
  }
  const ttl = body.remember ? SESSION_TTL_LONG_MS : SESSION_TTL_MS;
  const sess = createSession(u.id, ttl);
  return res.json({
    ok: true,
    token: sess.token,
    expiresAt: sess.expiresAt,
    user: { id: u.id, username: u.username, isAdmin: !!u.is_admin },
  });
});

app.post("/api/auth/logout", auth, (req, res) => {
  if (req.sessionToken) deleteSession(req.sessionToken);
  res.json({ ok: true });
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json({ ok: true, user: { id: req.user.userId, username: req.user.username, isAdmin: !!req.user.isAdmin } });
});

/** 修改自己的用户名/密码：提交新 sha256 哈希；成功后所有会话失效，需重新登录 */
app.put("/api/auth/password", auth, (req, res) => {
  try {
    const body = req.body || {};
    const u = updateUserCred(req.user.userId, {
      username: body.username,
      credHash: body.hash,
    });
    res.json({ ok: true, user: u });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// ===================== 用户管理（仅 admin） =====================
app.get("/api/users", auth, adminOnly, (_req, res) => {
  res.json({ users: listUsers().map((u) => ({ id: u.id, username: u.username, isAdmin: !!u.is_admin, createdAt: u.created_at })) });
});

app.post("/api/users", auth, adminOnly, (req, res) => {
  try {
    const body = req.body || {};
    const u = createUser({ username: body.username, credHash: body.hash, isAdmin: !!body.isAdmin });
    res.json({ ok: true, user: { id: u.id, username: u.username, isAdmin: !!u.is_admin } });
  } catch (e) {
    const msg = String(e.message || e);
    res.status(/UNIQUE/i.test(msg) ? 409 : 400).json({ error: /UNIQUE/i.test(msg) ? "用户名或凭据已存在" : msg });
  }
});

app.put("/api/users/:id/password", auth, adminOnly, (req, res) => {
  try {
    const u = updateUserCred(Number(req.params.id), { username: req.body?.username, credHash: req.body?.hash });
    res.json({ ok: true, user: u });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.delete("/api/users/:id", auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.userId) return res.status(400).json({ error: "不能删除自己" });
  if (id === 1) return res.status(400).json({ error: "不能删除初始管理员" });
  const r = deleteUser(id);
  if (!r) return res.status(404).json({ error: "用户不存在" });
  // 清理该用户的媒体与图库磁盘文件
  let removed = 0;
  for (const f of r.media) {
    const fp = safeJoinMedia(f.category, f.filename);
    if (fp && fs.existsSync(fp)) { try { fs.unlinkSync(fp); removed++; } catch (_) {} }
  }
  for (const g of r.gallery) {
    const fp = path.join(DATA_DIR, "media", "gallery", path.basename(g.filename || ""));
    if (g.filename && fs.existsSync(fp)) { try { fs.unlinkSync(fp); removed++; } catch (_) {} }
  }
  res.json({ ok: true, removedFiles: removed });
});

function makeUploader(cat) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        try {
          fs.mkdirSync(mediaBase(cat), { recursive: true });
        } catch (_) {}
        cb(null, mediaBase(cat));
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "") || "";
        cb(null, randomUUID() + ext);
      },
    }),
    limits: { fileSize: 80 * 1024 * 1024 },
  });
}

const uploadBg = makeUploader("bg");
const uploadMusic = makeUploader("music");
const uploadLrc = makeUploader("lrc");

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok\n");
});

// ===================== 链接元数据（网页标题） =====================
const metaCache = createTtlCache(20 * 60 * 1000); // 20 min
const META_TIMEOUT_MS = Number(process.env.METADATA_TIMEOUT_MS) || 4500;

/**
 * GET /api/metadata?url=...
 * 服务端代抓网页标题（og:title / <title>），带 SSRF 校验、超时与缓存。
 * 需登录（与 /api/data 一致）；失败时 ok:false，前端回退域名。
 */
app.get("/api/metadata", auth, async (req, res) => {
  const url = String(req.query.url || "").trim();
  if (!url) return res.status(400).json({ ok: false, error: "missing url" });
  if (!(await isSafeHttpUrl(url))) {
    return res.status(400).json({ ok: false, error: "unsafe url" });
  }

  const cached = metaCache.get(url);
  if (cached) return res.json({ ok: true, title: cached.title || "" });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; XianranNav-Metadata/1.0; +https://github.com/xianran-nav)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!r.ok) {
      return res.json({ ok: false, error: `upstream ${r.status}` });
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    // 无 content-type 时仍尝试解析（部分站点省略）
    if (ct && !ct.includes("html") && !ct.includes("xml") && !ct.includes("text/plain")) {
      metaCache.set(url, { title: "" });
      return res.json({ ok: true, title: "" });
    }
    const html = await readResponseTextLimited(r, 256 * 1024);
    const title = extractTitleFromHtml(html);
    metaCache.set(url, { title });
    return res.json({ ok: true, title });
  } catch (e) {
    return res.json({
      ok: false,
      error: String(e && e.name === "AbortError" ? "timeout" : e && e.message ? e.message : e),
    });
  } finally {
    clearTimeout(timer);
  }
});

app.get("/api/data", auth, (req, res) => {
  ensureDir();
  try {
    const data = getBundle(req.user.userId);
    if (!data) {
      return res.status(404).json({ empty: true, message: "尚无数据，使用前端默认或首次保存后生成" });
    }
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/** 浏览器经 nginx 会带上注入的 Bearer，用于「存储一览」里展示服务端库体积 */
app.get("/api/storage-stats", auth, (req, res) => {
  try {
    ensureDir();
    const sqlite = getSqliteStorageStats(req.user.userId);
    let mediaBytes = 0;
    let bgFiles = 0;
    let musicFiles = 0;
    let lrcFiles = 0;
    for (const cat of ["bg", "music", "lrc"]) {
      const dir = mediaBase(cat);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const fp = path.join(dir, name);
        try {
          const st = fs.statSync(fp);
          if (!st.isFile()) continue;
          mediaBytes += st.size;
          if (cat === "bg") bgFiles++;
          else if (cat === "music") musicFiles++;
          else if (cat === "lrc") lrcFiles++;
        } catch (_) {}
      }
    }
    return res.json({
      dataDir: DATA_DIR,
      sqlite: {
        appDataJsonBytes: sqlite.appDataBytes,
        mediaMetaRows: sqlite.mediaTableRows,
      },
      disk: { bgFiles, musicFiles, lrcFiles, mediaBytes },
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/** AI 设置独立存储（不走 bundle；避免浏览器 localStorage 持久化） */
app.get("/api/ai-settings", auth, (req, res) => {
  ensureDir();
  try {
    const data = getAiSettings(req.user.userId);
    if (!data) return res.json({ empty: true });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/ai-settings", auth, (req, res) => {
  ensureDir();
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "请求体须为 JSON 对象" });
    }
    setAiSettings(req.user.userId, body);
    return res.json({ ok: true, savedAt: Date.now() });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/data", auth, saveBundleHandler);
// sendBeacon 只能发 POST（页面卸载兜底保存），语义同 PUT
app.post("/api/data", auth, saveBundleHandler);
function saveBundleHandler(req, res) {
  ensureDir();
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "请求体须为 JSON 对象" });
    }
    setBundle(req.user.userId, body);
    return res.json({ ok: true, savedAt: Date.now() });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

/** 按 key 清单：bundle 顶层 + 媒体文件（带文件大小/名称） */
app.get("/api/inventory", auth, (req, res) => {
  try {
    const keys = getKeyInventory(req.user.userId);
    const media = { bg: [], music: [], lrc: [] };
    for (const cat of ["bg", "music", "lrc"]) {
      const dir = mediaBase(cat);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const fp = path.join(dir, name);
        try {
          const st = fs.statSync(fp);
          if (!st.isFile()) continue;
          media[cat].push({
            filename: name,
            bytes: st.size,
            url: `/api/media/file/${cat}/${encodeURIComponent(name)}`,
            mtime: st.mtimeMs,
          });
        } catch (_) {}
      }
    }
    return res.json({ keys, media, dataDir: DATA_DIR });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/data/key/:key", auth, (req, res) => {
  try {
    const v = getKeyValue(req.params.key, req.user.userId);
    if (v == null) return res.status(404).json({ error: "不存在或为空" });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.key}.json"`
    );
    return res.end(JSON.stringify(v, null, 2));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/data/key/:key", auth, (req, res) => {
  try {
    const ok = deleteKey(req.params.key, req.user.userId);
    if (!ok) return res.status(404).json({ error: "不存在" });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/media/bg", auth, uploadBg.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "无文件" });
  const fn = req.file.filename;
  try {
    recordMediaFile({ filename: fn, category: "bg", bytes: req.file.size, userId: req.user.userId });
  } catch (_) {}
  const url = `/api/media/file/bg/${encodeURIComponent(fn)}`;
  return res.json({ ok: true, url, filename: fn, category: "bg" });
});

app.post("/api/media/music", auth, uploadMusic.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "无文件" });
  const fn = req.file.filename;
  try {
    recordMediaFile({ filename: fn, category: "music", bytes: req.file.size, userId: req.user.userId });
  } catch (_) {}
  const url = `/api/media/file/music/${encodeURIComponent(fn)}`;
  return res.json({ ok: true, url, filename: fn, category: "music" });
});

app.post("/api/media/lrc", auth, uploadLrc.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "无文件" });
  const fn = req.file.filename;
  try {
    recordMediaFile({ filename: fn, category: "lrc", bytes: req.file.size, userId: req.user.userId });
  } catch (_) {}
  const url = `/api/media/file/lrc/${encodeURIComponent(fn)}`;
  return res.json({ ok: true, url, filename: fn, category: "lrc" });
});

function sendMedia(cat, req, res) {
  const filePath = safeJoinMedia(cat, req.params.filename);
  if (!filePath) return res.status(400).end();
  try {
    if (!fs.existsSync(filePath)) return res.status(404).end();
    return res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

app.get("/api/media/file/bg/:filename", (req, res) => sendMedia("bg", req, res));
app.get("/api/media/file/music/:filename", (req, res) => sendMedia("music", req, res));
app.get("/api/media/file/lrc/:filename", (req, res) => sendMedia("lrc", req, res));

app.delete("/api/media/file/:category/:filename", auth, (req, res) => {
  const cat = req.params.category;
  if (cat !== "bg" && cat !== "music" && cat !== "lrc") {
    return res.status(400).json({ error: "category 无效" });
  }
  const filePath = safeJoinMedia(cat, req.params.filename);
  if (!filePath) return res.status(400).json({ error: "路径无效" });
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    try {
      deleteMediaRecord(req.params.filename, req.user.userId);
    } catch (_) {}
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/** 导出：把 SQLite + 所有媒体打成 ZIP 下载 */
app.get("/api/export", auth, adminOnly, (_req, res) => {
  try {
    ensureDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-export-"));
    const dbSnap = path.join(tmpDir, "sakura.db");
    snapshotDatabaseTo(dbSnap);

    const zip = new AdmZip();
    zip.addLocalFile(dbSnap, "", "sakura.db");
    for (const cat of ["bg", "music", "lrc"]) {
      const dir = mediaBase(cat);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const fp = path.join(dir, name);
        try {
          const st = fs.statSync(fp);
          if (!st.isFile()) continue;
          zip.addLocalFile(fp, `media/${cat}`, name);
        } catch (_) {}
      }
    }

    const manifest = {
      schema: "sakura-nav-backup@1",
      exportedAt: new Date().toISOString(),
      dataDir: DATA_DIR,
      includes: ["sakura.db", "media/bg/*", "media/music/*", "media/lrc/*"],
    };
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));

    const buf = zip.toBuffer();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    const fn = `sakura-nav-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${fn}"`);
    res.setHeader("Content-Length", buf.length);
    return res.end(buf);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/** 导入：接收 ZIP，替换 SQLite + 媒体目录 */
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});
app.post("/api/import", auth, adminOnly, importUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "无文件" });
  let zip;
  try {
    zip = new AdmZip(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: "ZIP 解析失败：" + (e.message || e) });
  }
  const entries = zip.getEntries();
  const hasDb = entries.some((e) => e.entryName === "sakura.db");
  const hasManifest = entries.some((e) => e.entryName === "manifest.json");
  if (!hasDb || !hasManifest) {
    return res.status(400).json({ error: "ZIP 内缺少 sakura.db 或 manifest.json" });
  }

  try {
    ensureDir();
    closeDatabase();

    const dbPath = getDbPath();
    const dataDir = getDataDir();

    // 备份旧 DB + 媒体目录到回滚目录，导入失败可还原
    const rollbackDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-rollback-"));
    try {
      if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, path.join(rollbackDir, "sakura.db"));
      for (const sfx of ["-wal", "-shm"]) {
        const sf = dbPath + sfx;
        if (fs.existsSync(sf)) fs.copyFileSync(sf, path.join(rollbackDir, "sakura.db" + sfx));
      }
    } catch (_) {}

    // 清掉旧 WAL/SHM 以免与新 DB 冲突
    for (const sfx of ["-wal", "-shm"]) {
      const sf = dbPath + sfx;
      if (fs.existsSync(sf)) try { fs.unlinkSync(sf); } catch (_) {}
    }

    // 写 DB
    const dbEntry = entries.find((e) => e.entryName === "sakura.db");
    fs.writeFileSync(dbPath, dbEntry.getData());

    // 清空并重建媒体目录
    for (const cat of ["bg", "music", "lrc"]) {
      const dir = mediaBase(cat);
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir)) {
          try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
        }
      } else {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    let restored = { bg: 0, music: 0, lrc: 0 };
    for (const entry of entries) {
      const m = /^media\/(bg|music|lrc)\/(.+)$/.exec(entry.entryName);
      if (!m) continue;
      const cat = m[1];
      const name = path.basename(m[2]);
      if (!name || name.includes("..")) continue;
      const outPath = path.join(mediaBase(cat), name);
      fs.writeFileSync(outPath, entry.getData());
      restored[cat]++;
    }

    // 重新打开 DB
    openDatabase(dataDir);

    try { fs.rmSync(rollbackDir, { recursive: true, force: true }); } catch (_) {}

    return res.json({ ok: true, restored });
  } catch (e) {
    // 重新打开旧 DB，防止进程卡在无 DB 状态
    try { openDatabase(getDataDir()); } catch (_) {}
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/**
 * 天气反代（绕过浏览器 → open-meteo 的 CORS / 间歇 502）
 *   浏览器 → GET /api/weather/forecast?lat=…&lon=…
 *   服务端 → GET https://api.open-meteo.com/v1/forecast?…
 *
 * - 不挂 auth：天气数据不敏感
 * - 60 秒内存缓存，按 (lat,lon) 取整到 2 位小数（≈ 1km 精度）做 key
 * - 上游 5xx 自动重试一次（间隔 800ms），仍失败才返回错误
 * - 透传响应 JSON，主动加 CORS 头，避免被中间代理剥掉
 */
const _weatherCache = new Map(); // key -> { data, expireAt }
const WEATHER_CACHE_MS = 60_000;
const WEATHER_TIMEOUT_MS = 12_000;

async function _fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error("timeout")), ms);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "sakura-nav-weather/1.0" },
      signal: ctrl.signal,
    });
    return r;
  } finally {
    clearTimeout(t);
  }
}

app.get("/api/weather/forecast", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "lat / lon 必须是数字" });
  }
  const key = `${lat.toFixed(2)}:${lon.toFixed(2)}`;
  const now = Date.now();
  const cached = _weatherCache.get(key);
  if (cached && cached.expireAt > now) {
    res.set("X-Weather-Cache", "HIT");
    return res.json(cached.data);
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,apparent_temperature` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=7`;

  // 最多 2 次尝试：原请求 + 一次重试（5xx / 网络异常时）
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
    try {
      const r = await _fetchWithTimeout(url, WEATHER_TIMEOUT_MS);
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        if (r.status >= 500 && attempt === 0) continue;
        return res.status(r.status).json({ error: "open-meteo 上游错误", status: r.status });
      }
      const data = await r.json();
      _weatherCache.set(key, { data, expireAt: now + WEATHER_CACHE_MS });
      res.set("X-Weather-Cache", "MISS");
      return res.json(data);
    } catch (e) {
      lastErr = String(e?.message || e);
      // timeout / 网络异常允许重试
      if (attempt === 0) continue;
    }
  }
  // 用 stale 缓存兜底（如果有），避免上游短暂抖动让前端没数据可显
  if (cached) {
    res.set("X-Weather-Cache", "STALE");
    return res.json(cached.data);
  }
  return res.status(502).json({ error: "open-meteo 暂不可达", detail: lastErr });
});

// ===========================================================================
// 图库（图床）— 服务端持久化 + 公开 URL 访问
// ===========================================================================
//   - 上传：POST /api/gallery/upload  (auth)
//       body JSON: { dataUrl, source, prompt, revisedPrompt, model, size, quality, name, mime, client_id }
//       存盘到 ${DATA_DIR}/media/gallery/{id}.{ext}，DB 记录元信息
//       返回 { id, url, ext }，url 形如 /api/gallery/image/{id}.{ext}
//   - 读取：GET /api/gallery/image/:idExt  (无 auth；id 是随机长字符串作为密钥)
//       匹配 {id}.{ext}；ext 可省略（兼容老链接），实际 mime 以 DB 记录为准
//   - 列出：GET /api/gallery/list?source=generated|uploaded  (auth)
//   - 删除：DELETE /api/gallery/image/:idExt  (auth)

const GALLERY_CAT = "gallery";
const GALLERY_MAX_BYTES = 25 * 1024 * 1024;
const _MIME_TO_EXT = {
  "image/png":  "png",
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/webp": "webp",
  "image/gif":  "gif",
  "image/bmp":  "bmp",
  "image/avif": "avif",
};
function _extFromMime(mime) {
  return _MIME_TO_EXT[(mime || "").toLowerCase()] || "png";
}
function _splitIdExt(s) {
  if (!s) return { id: "", ext: "" };
  const i = s.lastIndexOf(".");
  if (i <= 0) return { id: s, ext: "" };
  return { id: s.slice(0, i), ext: s.slice(i + 1).toLowerCase() };
}
function _parseDataUrl(dataUrl) {
  // data:[<mime>][;base64],<data>
  const m = /^data:([^;,]+)?(?:;([^,]*))?,(.*)$/s.exec(dataUrl || "");
  if (!m) return null;
  const mime = (m[1] || "image/png").toLowerCase();
  const isB64 = (m[2] || "").includes("base64");
  const payload = m[3] || "";
  let buf;
  try {
    if (isB64) buf = Buffer.from(payload, "base64");
    else buf = Buffer.from(decodeURIComponent(payload), "utf8");
  } catch (_) { return null; }
  return { mime, bytes: buf };
}

app.post("/api/gallery/upload", auth, async (req, res) => {
  try {
    const body = req.body || {};
    const dataUrl = String(body.dataUrl || "");
    if (!dataUrl) return res.status(400).json({ error: "缺少 dataUrl" });

    // 已上传过同一个 client_id（IDB id）的图，直接复用，避免重复占用磁盘
    if (body.client_id) {
      const exist = findGalleryByClientId(String(body.client_id), req.user.userId);
      if (exist) {
        return res.json({
          ok: true,
          id: exist.id,
          ext: path.extname(exist.filename).slice(1) || _extFromMime(exist.mime),
          url: galleryPublicUrl(exist.filename),
          existing: true,
        });
      }
    }

    let parsed;
    if (dataUrl.startsWith("data:")) parsed = _parseDataUrl(dataUrl);
    else {
      // 远程 url：服务端拉一次再存。失败给 502。
      try {
        const r = await fetch(dataUrl);
        if (!r.ok) return res.status(502).json({ error: "拉取远程图片失败：HTTP " + r.status });
        const ab = await r.arrayBuffer();
        const mime = r.headers.get("content-type") || body.mime || "image/png";
        parsed = { mime, bytes: Buffer.from(ab) };
      } catch (e) {
        return res.status(502).json({ error: "拉取远程图片失败：" + String(e?.message || e) });
      }
    }
    if (!parsed) return res.status(400).json({ error: "dataUrl 解析失败" });
    if (parsed.bytes.length > GALLERY_MAX_BYTES) {
      return res.status(413).json({ error: `图片过大（${parsed.bytes.length} > ${GALLERY_MAX_BYTES} 字节）` });
    }

    const mime = (body.mime && body.mime !== "application/octet-stream") ? body.mime : parsed.mime;
    const ext  = _extFromMime(mime);

    // 32 chars hex → 难猜，作为公开 URL 的密钥
    const id = randomUUID().replace(/-/g, "").slice(0, 24);
    const filename = `${id}.${ext}`;

    const dir = path.join(DATA_DIR, "media", GALLERY_CAT);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), parsed.bytes);

    recordGalleryFile({
      id,
      filename,
      source:        body.source || "generated",
      mime,
      bytes:         parsed.bytes.length,
      prompt:        body.prompt || "",
      revised_prompt: body.revisedPrompt || body.revised_prompt || "",
      model:         body.model || "",
      size:          body.size || "",
      quality:       body.quality || "",
      original_name: body.name || "",
      client_id:     body.client_id || "",
      created_at:    Date.now(),
      user_id:       req.user.userId,
    });

    return res.json({
      ok: true,
      id,
      ext,
      url: galleryPublicUrl(filename),
    });
  } catch (e) {
    console.warn("[gallery] upload failed:", e?.message || e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/gallery/image/:idExt", (req, res) => {
  const { id, ext } = _splitIdExt(req.params.idExt);
  if (!id) return res.status(400).end();
  const row = getGalleryFile(id);
  if (!row) return res.status(404).end();
  const fileExt = path.extname(row.filename).slice(1).toLowerCase();
  if (ext && ext !== fileExt) {
    // 客户端写错 ext，重定向到正确的，便于浏览器 / RSS 抓取兼容
    return res.redirect(302, `/api/gallery/image/${row.filename}`);
  }
  const filePath = path.join(DATA_DIR, "media", GALLERY_CAT, row.filename);
  if (!fs.existsSync(filePath)) return res.status(410).end();   // DB 有记录但文件丢了
  res.set("Content-Type", row.mime || "application/octet-stream");
  res.set("Cache-Control", "public, max-age=31536000, immutable");  // 内容寻址，永远缓存
  return res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

app.get("/api/gallery/list", auth, (req, res) => {
  try {
    const source = req.query.source ? String(req.query.source) : "";
    const limit  = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const rows = listGalleryFiles({ source: source || undefined, limit, offset, userId: req.user.userId });
    const items = rows.map((r) => ({
      id: r.id,
      url: galleryPublicUrl(r.filename),
      source: r.source,
      mime: r.mime,
      bytes: r.bytes,
      prompt: r.prompt || "",
      revisedPrompt: r.revised_prompt || "",
      model: r.model || "",
      size: r.size || "",
      quality: r.quality || "",
      name: r.original_name || "",
      clientId: r.client_id || "",
      createdAt: r.created_at,
    }));
    const stat = countGalleryFiles(req.user.userId);
    return res.json({ items, total: stat.count, bytes: stat.bytes });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/gallery/image/:idExt", auth, (req, res) => {
  const { id } = _splitIdExt(req.params.idExt);
  if (!id) return res.status(400).json({ error: "id 无效" });
  const row = deleteGalleryFile(id, req.user.userId);
  if (row) {
    const filePath = path.join(DATA_DIR, "media", GALLERY_CAT, row.filename);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
  }
  return res.json({ ok: true });
});

/**
 * AI 反代（绕过浏览器 → 第三方 OpenAI 兼容端点的 CORS 拦截）
 *   浏览器 → POST /api/ai-proxy/<sub-path>   带 X-Sakura-Target-Base 头
 *   服务端 → POST <X-Sakura-Target-Base>/<sub-path>   把 X-Sakura-Target-Auth 当 Authorization 转发
 *   流式响应一边读一边写回，body 不缓冲，整个链路对图片/SSE 都透明。
 *
 * 不挂 auth：用户的 API Key 通过 X-Sakura-Target-Auth 自己带上来，不存在我们这里。
 * 风险提示：如果你把 18080 暴露到公网，这就是个开放代理；建议只在内网/本机使用。
 */
app.all(/^\/api\/ai-proxy(\/.*)?$/, async (req, res) => {
  const targetBase = String(req.headers["x-sakura-target-base"] || "").trim();
  const targetAuth = String(req.headers["x-sakura-target-auth"] || "").trim();
  // 探测请求：GET，或 path 以 __probe / __ping 结尾，没带 target → 直接 200 回执，让前端能用 200 OK 判定端点存在，
  // 控制台不会出现红色 4xx。
  const subRawProbe = (req.params[0] || "").replace(/^\/+/, "");
  if (!targetBase) {
    if (req.method === "GET" || /(?:^|\/)(?:__probe|__ping)$/i.test(subRawProbe)) {
      return res.json({ ok: true, kind: "sakura-nav-ai-proxy" });
    }
    return res.status(400).json({ error: "缺少 X-Sakura-Target-Base 头，或不是 http(s) URL" });
  }
  if (!/^https?:\/\//i.test(targetBase)) {
    return res.status(400).json({ error: "X-Sakura-Target-Base 必须是 http(s) URL" });
  }
  const upstreamUrl = targetBase.replace(/\/+$/, "") + "/" + subRawProbe;

  // Cloudflare 等中转会按 UA / 头规范判 bot，Node 默认 fetch 的 "undici/x.x" UA 经常被拒。
  // 这里默认把请求伪装成主流浏览器；同时透传一些原始浏览器请求里有用的语义头，但排除 Origin/Referer/Cookie 等会泄密或乱跨域的。
  const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const upstreamHeaders = {
    "user-agent": req.headers["user-agent"] || BROWSER_UA,
    "accept": req.headers["accept"] || "application/json, text/event-stream, */*",
    "accept-language": req.headers["accept-language"] || "zh-CN,zh;q=0.9,en;q=0.8",
  };
  const ct = req.headers["content-type"];
  if (ct) upstreamHeaders["content-type"] = ct;
  if (targetAuth) upstreamHeaders["authorization"] = targetAuth;
  // 透传百炼（DashScope）异步生图头：image-synthesis 提交必须带 X-DashScope-Async: enable，否则会被拒
  if (req.headers["x-dashscope-async"]) upstreamHeaders["x-dashscope-async"] = req.headers["x-dashscope-async"];
  // 不转发：origin / referer / cookie / accept-encoding（会让 undici 自动解压打乱 content-length）

  let body;
  if (req.method !== "GET" && req.method !== "HEAD" && req.body != null) {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }

  // 上游硬超时：
  //   普通对话：100s（跟 Cloudflare 自然超时同步）
  //   生图接口（含 OpenAI /images/generations 和 Gemini :generateContent）：默认 480s（8 分钟），4K + thinking 模型常需 3-5 分钟
  // 可以用环境变量 AI_PROXY_TIMEOUT_MS / AI_PROXY_IMAGE_TIMEOUT_MS 覆盖
  const isImageGen = /\/images\/(generations|edits)\b/.test(subRawProbe)
                  || /:generateContent\b/.test(subRawProbe)
                  || /:streamGenerateContent\b/.test(subRawProbe);
  const defaultTimeoutMs = isImageGen
    ? (+process.env.AI_PROXY_IMAGE_TIMEOUT_MS || 480_000)
    : (+process.env.AI_PROXY_TIMEOUT_MS || 100_000);
  const timeoutMs = defaultTimeoutMs;
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(new Error("upstream timeout")), timeoutMs);
  // 客户端主动断开 / 取消按钮 → 立刻 abort 上游 fetch，避免 zombie
  // 必须用 res.on("close")：req 流在 body 解析完就会 emit 'close'（Node Readable 语义），
  // 用 req.on("close") 会在每次正常请求里都误报"客户端断开"而提前 abort 上游。
  const onClientClose = () => {
    if (!res.writableEnded) {
      try { ctrl.abort(new Error("client closed")); } catch (_) {}
    }
  };
  res.on("close", onClientClose);

  const startedAt = Date.now();
  console.log(`[ai-proxy] → ${req.method} ${upstreamUrl}  body=${body ? body.length + "B" : "-"}  auth=${targetAuth ? "yes" : "no"}  timeout=${timeoutMs}ms`);

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    res.off("close", onClientClose);
    const ms = Date.now() - startedAt;
    const isTimeout = ctrl.signal.aborted && /timeout/i.test(String(e?.message || ""));
    const isClientClose = ctrl.signal.aborted && /client closed/i.test(String(e?.message || ""));
    console.warn(`[ai-proxy] ✗ ${isTimeout ? "超时" : isClientClose ? "客户端断开" : "转发失败"} (${ms}ms): ${e?.message || e}`);
    if (res.headersSent) { try { res.end(); } catch (_) {} return; }
    if (isTimeout) {
      return res.status(504).json({
        error: `上游响应超时（已等待 ${Math.round(timeoutMs / 1000)}s 仍未返回）`,
        target: upstreamUrl,
      });
    }
    if (isClientClose) {
      try { res.end(); } catch (_) {}
      return;
    }
    return res.status(502).json({
      error: "代理请求失败：" + (e?.message || String(e)),
      target: upstreamUrl,
    });
  }
  clearTimeout(timeoutId);
  res.off("close", onClientClose);
  const ms = Date.now() - startedAt;
  const upCt = upstream.headers.get("content-type") || "(无)";
  const upLen = upstream.headers.get("content-length") || "?";
  console.log(`[ai-proxy] ← ${upstream.status} ${upstream.statusText || ""}  (${ms}ms)  content-type=${upCt}  content-length=${upLen}`);

  res.status(upstream.status);
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    // 跳过会和 Node http 自动写入冲突的头
    if (lk === "transfer-encoding" || lk === "connection" || lk === "content-encoding" || lk === "content-length") return;
    try { res.setHeader(k, v); } catch (_) {}
  });

  if (!upstream.body) {
    console.log(`[ai-proxy]   (上游 body=null，直接 end)`);
    return res.end();
  }
  let streamedBytes = 0;
  try {
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamedBytes += value.length;
      const ok = res.write(Buffer.from(value));
      if (!ok) await new Promise((r) => res.once("drain", r));
    }
  } catch (e) {
    // 流被中途打断（客户端断开 / 上游 reset）：直接结束响应
    console.warn(`[ai-proxy]   (流中断 streamed=${streamedBytes}B): ${e?.message || e}`);
  }
  if (streamedBytes === 0) {
    console.warn(`[ai-proxy]   ⚠ 上游 body 流为 0 字节 —— 这会让前端看到"生图响应不是 JSON：" 错误`);
  } else {
    console.log(`[ai-proxy]   streamed=${streamedBytes}B`);
  }
  res.end();
});

if (SERVE_STATIC) {
  const root = path.resolve(STATIC_ROOT);
  if (!fs.existsSync(root)) {
    console.warn(`[sakura-data] SERVE_STATIC: 静态目录不存在: ${root}`);
  } else {
    app.use(express.static(root));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      const indexPath = path.join(root, "index.html");
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      return next();
    });
  }
}

const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";

app.listen(PORT, BIND_HOST, () => {
  const staticHint = SERVE_STATIC ? `, 静态=${STATIC_ROOT}` : "";
  console.log(
    `[sakura-data] SQLite + media, listening on ${BIND_HOST}:${PORT}, DATA_DIR=${DATA_DIR}${staticHint}`
  );
});
