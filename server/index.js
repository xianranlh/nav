/**
 * 樱 · 数据 API：SQLite + 媒体文件目录
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
} from "./database.js";

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
