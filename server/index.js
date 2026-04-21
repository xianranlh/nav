/**
 * 樱 · 数据 API：SQLite + 媒体文件目录
 * GET/PUT /api/data — 需 Authorization: Bearer
 * POST /api/media/bg|music — 上传（需鉴权）
 * GET /api/media/file/... — 直链读取
 * DELETE /api/media/file/... — 删除（需鉴权）
 *
 * 本地用 Node 同时托管前端：node index.js --static（或 SERVE_STATIC=1）
 * 默认端口 8080；静态根目录为仓库根，可用 STATIC_ROOT 覆盖。
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
} from "./database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = process.argv.slice(2);
if (argv.includes("--static") || argv.includes("-s")) {
  process.env.SERVE_STATIC = "1";
  if (!process.env.PORT) process.env.PORT = "8080";
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || "/data";
const API_KEY = (process.env.SAKURA_API_KEY || "").trim();

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

function auth(req, res, next) {
  if (!API_KEY) {
    return next();
  }
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const key = m ? m[1].trim() : "";
  if (key !== API_KEY) {
    return res.status(401).json({ error: "未授权" });
  }
  next();
}

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

app.get("/api/data", auth, (_req, res) => {
  ensureDir();
  try {
    const data = getBundle();
    if (!data) {
      return res.status(404).json({ empty: true, message: "尚无数据，使用前端默认或首次保存后生成" });
    }
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/** 浏览器经 nginx 会带上注入的 Bearer，用于「存储一览」里展示服务端库体积 */
app.get("/api/storage-stats", auth, (_req, res) => {
  try {
    ensureDir();
    const sqlite = getSqliteStorageStats();
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
app.get("/api/ai-settings", auth, (_req, res) => {
  ensureDir();
  try {
    const data = getAiSettings();
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
    setAiSettings(body);
    return res.json({ ok: true, savedAt: Date.now() });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/data", auth, (req, res) => {
  ensureDir();
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "请求体须为 JSON 对象" });
    }
    setBundle(body);
    return res.json({ ok: true, savedAt: Date.now() });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/** 按 key 清单：bundle 顶层 + 媒体文件（带文件大小/名称） */
app.get("/api/inventory", auth, (_req, res) => {
  try {
    const keys = getKeyInventory();
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
    const v = getKeyValue(req.params.key);
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
    const ok = deleteKey(req.params.key);
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
    recordMediaFile({ filename: fn, category: "bg", bytes: req.file.size });
  } catch (_) {}
  const url = `/api/media/file/bg/${encodeURIComponent(fn)}`;
  return res.json({ ok: true, url, filename: fn, category: "bg" });
});

app.post("/api/media/music", auth, uploadMusic.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "无文件" });
  const fn = req.file.filename;
  try {
    recordMediaFile({ filename: fn, category: "music", bytes: req.file.size });
  } catch (_) {}
  const url = `/api/media/file/music/${encodeURIComponent(fn)}`;
  return res.json({ ok: true, url, filename: fn, category: "music" });
});

app.post("/api/media/lrc", auth, uploadLrc.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "无文件" });
  const fn = req.file.filename;
  try {
    recordMediaFile({ filename: fn, category: "lrc", bytes: req.file.size });
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
      deleteMediaRecord(req.params.filename);
    } catch (_) {}
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/** 导出：把 SQLite + 所有媒体打成 ZIP 下载 */
app.get("/api/export", auth, (_req, res) => {
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
app.post("/api/import", auth, importUpload.single("file"), (req, res) => {
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
