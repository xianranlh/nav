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
import { createRequire } from "node:module";
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
  listDataSnapshots,
  createDataSnapshot,
  restoreDataSnapshot,
  compareDataSnapshot,
  restoreDataSnapshotCategory,
  deleteDataSnapshot,
} from "./database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const AIImage = require("../js/ai-image.js");
const AIWebSearch = require("../js/ai-web-search.js");

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

const MB = 1024 * 1024;
const MEDIA_RULES = Object.freeze({
  bg: {
    maxBytes: 80 * MB,
    extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".mp4", ".webm", ".mov", ".ogv"],
    mime: /^(image|video)\//i,
  },
  music: {
    maxBytes: 80 * MB,
    extensions: [".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac", ".opus"],
    mime: /^audio\//i,
  },
  lrc: {
    maxBytes: 2 * MB,
    extensions: [".lrc", ".txt"],
    mime: /^(text\/plain|application\/x-subrip|application\/octet-stream)$/i,
  },
  import: {
    maxBytes: 500 * MB,
    extensions: [".zip"],
    mime: /^(application\/zip|application\/x-zip-compressed|application\/octet-stream)$/i,
  },
});

app.disable("x-powered-by");
app.use(express.json({ limit: "50mb" }));

openDatabase(DATA_DIR);

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {}
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
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

function validateUploadedMedia(file, category, { checkSize = true } = {}) {
  const rule = MEDIA_RULES[category];
  if (!rule) throw createHttpError(400, "上传分类无效");
  if (!file) throw createHttpError(400, "无文件");
  const ext = path.extname(file.originalname || file.filename || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  const extOk = rule.extensions.includes(ext);
  const mimeOk = !!mime && rule.mime.test(mime);
  if (!extOk && !mimeOk) {
    throw createHttpError(415, "文件类型不支持");
  }
  if (checkSize && Number(file.size || 0) > rule.maxBytes) {
    throw createHttpError(413, "文件过大");
  }
  return true;
}

function cleanupUploadedFile(file) {
  if (!file || !file.path) return;
  try { fs.unlinkSync(file.path); } catch (_) {}
}

function makeUploader(cat, rule) {
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
    limits: { fileSize: rule.maxBytes },
    fileFilter: (_req, file, cb) => {
      try {
        validateUploadedMedia(file, cat, { checkSize: false });
        cb(null, true);
      } catch (e) {
        cb(e);
      }
    },
  });
}

const uploadBg = makeUploader("bg", MEDIA_RULES.bg);
const uploadMusic = makeUploader("music", MEDIA_RULES.music);
const uploadLrc = makeUploader("lrc", MEDIA_RULES.lrc);

function listMediaInventory() {
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
  return media;
}

function collectReferencedMedia(bundle) {
  const refs = new Set();
  const raw = JSON.stringify(bundle || {});
  const re = /\/api\/media\/file\/(bg|music|lrc)\/([^"'`\s<>)?#]+)/gi;
  let match;
  while ((match = re.exec(raw))) {
    const cat = match[1];
    let filename = String(match[2] || "").split(/[?#]/)[0];
    try { filename = decodeURIComponent(filename); } catch (_) {}
    if (filename) refs.add(`${cat}/${filename}`);
  }
  return refs;
}

function classifyOrphanMedia(inventory, refs) {
  const orphans = [];
  for (const cat of ["bg", "music", "lrc"]) {
    for (const file of inventory[cat] || []) {
      const ref = `${cat}/${file.filename}`;
      if (refs.has(ref)) continue;
      orphans.push({ category: cat, filename: file.filename, bytes: file.bytes || 0, url: file.url, mtime: file.mtime });
    }
  }
  return {
    referenced: [...refs],
    orphans,
    totalBytes: orphans.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0),
  };
}

function currentOrphanMedia() {
  const inventory = listMediaInventory();
  const refs = collectReferencedMedia(getBundle() || {});
  return classifyOrphanMedia(inventory, refs);
}

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

function normalizeAiBase(url) {
  let base = String(url || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (!/\/v\d+$/i.test(base) && !/\/chat\/completions$/i.test(base) && !/\/responses$/i.test(base)) {
    base += "/v1";
  }
  return base;
}

function findAiProvider(settings, providerId) {
  const providers = Array.isArray(settings?.providers) ? settings.providers : [];
  return providers.find((provider) => provider.id === providerId) ||
    providers.find((provider) => provider.id === settings?.currentProviderId) ||
    providers[0] ||
    null;
}

async function readUpstreamJsonOrText(response) {
  const text = await response.text().catch(() => "");
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch (_) {
    return { text, json: null };
  }
}

function upstreamError(status, text, json) {
  const raw = json ? JSON.stringify(json).slice(0, 500) : String(text || "").slice(0, 500);
  return createHttpError(status || 502, raw ? `上游 AI 返回错误：${raw}` : "上游 AI 返回错误");
}

async function postAiJson(url, provider, body, signal) {
  return fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (provider.apiKey || ""),
    },
    body: JSON.stringify(body),
  });
}

async function proxyAiImage({ provider, model, messages, signal }) {
  const base = normalizeAiBase(provider.baseUrl);
  const prompt = AIImage.extractPromptFromMessages(messages);
  const body = AIImage.buildImageGenerationBody({ model, prompt });
  if (!body.prompt) throw createHttpError(400, "请先输入图片描述");
  const response = await postAiJson(AIImage.imageGenerationEndpoint(base), provider, body, signal);
  const { text, json } = await readUpstreamJsonOrText(response);
  if (!response.ok) throw upstreamError(response.status, text, json);
  return {
    mode: "image",
    content: AIImage.renderImageGenerationMessage(json || {}, body.prompt),
  };
}

async function proxyAiWebSearch({ provider, model, messages, signal }) {
  const base = normalizeAiBase(provider.baseUrl);
  const useChatSearch = AIWebSearch.isChatCompletionsSearchModel(model);
  const endpoint = useChatSearch ? `${base}/chat/completions` : AIWebSearch.responsesEndpoint(base);
  const body = useChatSearch
    ? AIWebSearch.buildChatCompletionsSearchBody({ model, messages })
    : AIWebSearch.buildResponsesSearchBody({ model, messages });
  const response = await postAiJson(endpoint, provider, body, signal);
  const { text, json } = await readUpstreamJsonOrText(response);
  if (!response.ok) throw upstreamError(response.status, text, json);
  return {
    mode: "web_search",
    content: useChatSearch
      ? AIWebSearch.renderChatCompletionsMessage(json || {})
      : AIWebSearch.renderResponsesMessage(json || {}),
  };
}

async function proxyAiChatStream({ provider, model, messages, temperature, signal }, res) {
  const base = normalizeAiBase(provider.baseUrl);
  const response = await postAiJson(`${base}/chat/completions`, provider, {
    model,
    messages,
    stream: true,
    temperature: temperature ?? 0.7,
  }, signal);
  if (!response.ok) {
    const { text, json } = await readUpstreamJsonOrText(response);
    throw upstreamError(response.status, text, json);
  }
  if (!response.body) throw createHttpError(502, "上游 AI 未返回流式内容");

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  for await (const chunk of response.body) {
    res.write(Buffer.from(chunk));
  }
  res.end();
}

app.post("/api/ai/chat", auth, asyncHandler(async (req, res) => {
  ensureDir();
  const settings = getAiSettings();
  const provider = findAiProvider(settings, req.body?.providerId);
  if (!provider) throw createHttpError(400, "请先在 AI 设置中添加供应商");
  const model = String(req.body?.model || settings?.currentModel || provider.defaultModel || "").trim();
  if (!model) throw createHttpError(400, "请先选择模型");
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length) throw createHttpError(400, "消息不能为空");

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  if (AIImage.isImageGenerationModel(model)) {
    return res.json(await proxyAiImage({ provider, model, messages, signal: controller.signal }));
  }
  if (req.body?.webSearch) {
    return res.json(await proxyAiWebSearch({ provider, model, messages, signal: controller.signal }));
  }
  return proxyAiChatStream({
    provider,
    model,
    messages,
    temperature: req.body?.temperature,
    signal: controller.signal,
  }, res);
}));

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

app.get("/api/snapshots", auth, (req, res) => {
  try {
    ensureDir();
    return res.json({ snapshots: listDataSnapshots(req.query.limit) });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/snapshots", auth, (req, res) => {
  try {
    ensureDir();
    const snapshot = createDataSnapshot(req.body?.label || "手动快照");
    return res.json({ ok: true, snapshot });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/snapshots/:id/restore", auth, (req, res) => {
  try {
    ensureDir();
    const snapshot = restoreDataSnapshot(req.params.id);
    if (!snapshot) return res.status(404).json({ error: "快照不存在" });
    return res.json({ ok: true, snapshot });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/snapshots/:id/compare", auth, (req, res) => {
  try {
    ensureDir();
    const result = compareDataSnapshot(req.params.id);
    if (!result) return res.status(404).json({ error: "快照不存在" });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/snapshots/:id/restore-category", auth, (req, res) => {
  try {
    ensureDir();
    const result = restoreDataSnapshotCategory(req.params.id, req.body?.category);
    if (!result) return res.status(404).json({ error: "快照不存在" });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/snapshots/:id", auth, (req, res) => {
  try {
    const ok = deleteDataSnapshot(req.params.id);
    if (!ok) return res.status(404).json({ error: "快照不存在" });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

function normalizeCheckUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

async function checkOneLink(rawUrl) {
  const url = normalizeCheckUrl(rawUrl);
  const checkedAt = Date.now();
  if (!url) return { url: rawUrl, ok: false, status: 0, checkedAt, error: "URL 无效" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    if ([405, 403, 501].includes(r.status)) {
      r = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal });
    }
    return { url, ok: r.status < 400, status: r.status, checkedAt };
  } catch (e) {
    return { url, ok: false, status: 0, checkedAt, error: e.name === "AbortError" ? "请求超时" : String(e.message || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

app.post("/api/link-check", auth, asyncHandler(async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.map(normalizeCheckUrl).filter(Boolean) : [];
  const uniqueUrls = [...new Set(urls)].slice(0, 50);
  const results = [];
  for (let i = 0; i < uniqueUrls.length; i += 5) {
    const chunk = uniqueUrls.slice(i, i + 5);
    results.push(...await Promise.all(chunk.map(checkOneLink)));
  }
  return res.json({ ok: true, checkedAt: Date.now(), results });
}));

/** 按 key 清单：bundle 顶层 + 媒体文件（带文件大小/名称） */
app.get("/api/inventory", auth, (_req, res) => {
  try {
    const keys = getKeyInventory();
    const media = listMediaInventory();
    return res.json({ keys, media, dataDir: DATA_DIR });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/media/orphans", auth, (_req, res) => {
  try {
    ensureDir();
    const result = currentOrphanMedia();
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/media/orphans/delete", auth, (req, res) => {
  try {
    ensureDir();
    const requested = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
    const orphanSet = new Set(currentOrphanMedia().orphans.map((item) => `${item.category}/${item.filename}`));
    const deleted = [];
    const skipped = [];
    for (const item of requested) {
      const cat = String(item?.category || "");
      const filename = String(item?.filename || "");
      if (!["bg", "music", "lrc"].includes(cat) || !filename) {
        skipped.push({ category: cat, filename, reason: "invalid" });
        continue;
      }
      const ref = `${cat}/${filename}`;
      if (!orphanSet.has(ref)) {
        skipped.push({ category: cat, filename, reason: "referenced" });
        continue;
      }
      const filePath = safeJoinMedia(cat, filename);
      if (!filePath) {
        skipped.push({ category: cat, filename, reason: "unsafe-path" });
        continue;
      }
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      try { deleteMediaRecord(filename); } catch (_) {}
      deleted.push({ category: cat, filename });
    }
    return res.json({ ok: true, deleted, skipped });
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

function handleMediaUpload(category) {
  return asyncHandler(async (req, res) => {
    try {
      validateUploadedMedia(req.file, category);
    } catch (e) {
      cleanupUploadedFile(req.file);
      throw e;
    }
    const fn = req.file.filename;
    try {
      recordMediaFile({ filename: fn, category, bytes: req.file.size });
    } catch (_) {}
    const url = `/api/media/file/${category}/${encodeURIComponent(fn)}`;
    return res.json({ ok: true, url, filename: fn, category });
  });
}

app.post("/api/media/bg", auth, uploadBg.single("file"), handleMediaUpload("bg"));
app.post("/api/media/music", auth, uploadMusic.single("file"), handleMediaUpload("music"));
app.post("/api/media/lrc", auth, uploadLrc.single("file"), handleMediaUpload("lrc"));

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
  limits: { fileSize: MEDIA_RULES.import.maxBytes },
  fileFilter: (_req, file, cb) => {
    try {
      validateUploadedMedia(file, "import", { checkSize: false });
      cb(null, true);
    } catch (e) {
      cb(e);
    }
  },
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

function jsonErrorHandler(err, _req, res, next) {
  if (res.headersSent) {
    return next(err);
  }
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "文件过大" });
  }
  const status = Number(err && (err.status || err.statusCode)) || 500;
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const message = err && err.message ? String(err.message) : "服务器错误";
  if (safeStatus >= 500) {
    console.error("[sakura-data] request failed", err);
  }
  return res.status(safeStatus).json({ error: message });
}

app.use(jsonErrorHandler);

const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";

app.listen(PORT, BIND_HOST, () => {
  const staticHint = SERVE_STATIC ? `, 静态=${STATIC_ROOT}` : "";
  console.log(
    `[sakura-data] SQLite + media, listening on ${BIND_HOST}:${PORT}, DATA_DIR=${DATA_DIR}${staticHint}`
  );
});
