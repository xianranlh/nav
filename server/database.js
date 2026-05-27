/**
 * 樱 · SQLite 持久化（替代 sakura-state.json 单文件）
 * - app_data：整包 sakura-nav@2 JSON
 * - media_files：已上传媒体元数据（文件仍在 data/media/）
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const LEGACY_JSON = "sakura-state.json";

let db;
let currentDbPath = "";
let currentDataDir = "";

export function openDatabase(dataDir) {
  // 一次性兼容迁移：v1.18 前数据目录叫 sakura-nav，重命名后改为 xianran-nav。
  // 如果新目录还不存在但同级的 sakura-nav 存在，把它整个 rename 过来，用户数据零丢失。
  try {
    const parent = path.dirname(dataDir);
    const oldDir = path.join(parent, "sakura-nav");
    if (oldDir !== dataDir && fs.existsSync(oldDir) && !fs.existsSync(dataDir)) {
      console.log(`[xianran-data] 检测到旧 ${oldDir}，迁移到新位置 ${dataDir}`);
      fs.renameSync(oldDir, dataDir);
    }
  } catch (e) {
    console.warn("[xianran-data] 旧目录迁移跳过：", e?.message || e);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  // 数据库文件名仍然叫 sakura.db（不能改，否则丢历史数据；它是内部文件无所谓品牌）
  const dbPath = path.join(dataDir, "sakura.db");
  currentDbPath = dbPath;
  currentDataDir = dataDir;
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_data (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_files (
      filename TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      bytes INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gallery_files (
      id TEXT PRIMARY KEY,            -- 随机 ID，也是 URL slug；难猜避免被遍历
      filename TEXT NOT NULL,         -- 磁盘上的实际文件名：{id}.{ext}
      source TEXT NOT NULL,           -- "generated" | "uploaded"
      mime TEXT,
      bytes INTEGER,
      prompt TEXT,
      revised_prompt TEXT,
      model TEXT,
      size TEXT,
      quality TEXT,
      original_name TEXT,
      client_id TEXT,                 -- 浏览器侧 IDB 里的 id，便于双向对账 / 去重
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gallery_created_at ON gallery_files(created_at);
    CREATE INDEX IF NOT EXISTS idx_gallery_client_id  ON gallery_files(client_id);
  `);

  migrateFromLegacyJson(dataDir);
  migrateAiSettingsFromBundle();
  return db;
}

// 首次启用独立 ai_settings 表时，把旧 bundle.payload.ai 迁移过来
function migrateAiSettingsFromBundle() {
  const row = db.prepare("SELECT 1 AS ok FROM ai_settings WHERE id = 1").get();
  if (row) return;
  const bundle = getBundle();
  if (!bundle || typeof bundle !== "object" || !bundle.ai) return;
  try {
    const raw = JSON.stringify(bundle.ai);
    db.prepare(
      "INSERT INTO ai_settings (id, payload, updated_at) VALUES (1, ?, ?)"
    ).run(raw, Date.now());
  } catch (e) {
    console.warn("[sakura-data] 迁移 ai 失败:", e.message || e);
  }
}

function migrateFromLegacyJson(dataDir) {
  const row = db.prepare("SELECT 1 AS ok FROM app_data WHERE id = 1").get();
  if (row) return;

  const legacyPath = path.join(dataDir, LEGACY_JSON);
  if (!fs.existsSync(legacyPath)) return;

  try {
    const raw = fs.readFileSync(legacyPath, "utf8");
    JSON.parse(raw);
    db.prepare(
      "INSERT INTO app_data (id, payload, updated_at) VALUES (1, ?, ?)"
    ).run(raw, Date.now());
    try {
      fs.renameSync(legacyPath, legacyPath + ".migrated");
    } catch (_) {}
  } catch (e) {
    console.warn("[sakura-data] 迁移 " + LEGACY_JSON + " 失败:", e.message || e);
  }
}

export function getBundle() {
  const row = db.prepare("SELECT payload FROM app_data WHERE id = 1").get();
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch (_) {
    return null;
  }
}

export function setBundle(obj) {
  const raw = JSON.stringify(obj);
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO app_data (id, payload, updated_at) VALUES (1, ?, ?)"
  ).run(raw, now);
}

export function recordMediaFile({ filename, category, bytes }) {
  db.prepare(
    `INSERT INTO media_files (filename, category, bytes, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(filename) DO UPDATE SET category = excluded.category, bytes = excluded.bytes, created_at = excluded.created_at`
  ).run(filename, category, bytes || 0, Date.now());
}

export function deleteMediaRecord(filename) {
  db.prepare("DELETE FROM media_files WHERE filename = ?").run(filename);
}

/** 供 /api/storage-stats：SQLite 占用与媒体表行数 */
export function getSqliteStorageStats() {
  if (!db) return { appDataBytes: 0, mediaTableRows: 0 };
  try {
    const len = db.prepare("SELECT length(payload) AS n FROM app_data WHERE id = 1").get();
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM media_files").get();
    return {
      appDataBytes: len && typeof len.n === "number" ? len.n : 0,
      mediaTableRows: cnt && typeof cnt.c === "number" ? cnt.c : 0,
    };
  } catch (_) {
    return { appDataBytes: 0, mediaTableRows: 0 };
  }
}

/** 列出 bundle 顶层 key 的体积和简要摘要 */
export function getKeyInventory() {
  const bundle = getBundle() || {};
  const out = [];
  for (const [key, value] of Object.entries(bundle)) {
    if (value === null || value === undefined) {
      out.push({ key, bytes: 0, isEmpty: true });
      continue;
    }
    const raw = JSON.stringify(value);
    out.push({ key, bytes: raw.length, isEmpty: false });
  }
  return out;
}

export function getKeyValue(key) {
  const bundle = getBundle() || {};
  return key in bundle ? bundle[key] : null;
}

export function deleteKey(key) {
  const bundle = getBundle();
  if (!bundle) return false;
  if (!(key in bundle)) return false;
  if (key === "schema" || key === "savedAt") return false;
  delete bundle[key];
  setBundle(bundle);
  return true;
}

/** 独立存储的 AI 设置（不走 app_data bundle，避免数据放在浏览器 localStorage） */
export function getAiSettings() {
  if (!db) return null;
  const row = db.prepare("SELECT payload FROM ai_settings WHERE id = 1").get();
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch (_) {
    return null;
  }
}

export function setAiSettings(obj) {
  const raw = JSON.stringify(obj || {});
  db.prepare(
    "INSERT OR REPLACE INTO ai_settings (id, payload, updated_at) VALUES (1, ?, ?)"
  ).run(raw, Date.now());
}

// ---------------------------------------------------------------------------
// Gallery files — 服务端图床
// ---------------------------------------------------------------------------

export function recordGalleryFile(row) {
  if (!db) return;
  db.prepare(
    `INSERT INTO gallery_files
       (id, filename, source, mime, bytes, prompt, revised_prompt, model, size, quality, original_name, client_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       filename       = excluded.filename,
       source         = excluded.source,
       mime           = excluded.mime,
       bytes          = excluded.bytes,
       prompt         = excluded.prompt,
       revised_prompt = excluded.revised_prompt,
       model          = excluded.model,
       size           = excluded.size,
       quality        = excluded.quality,
       original_name  = excluded.original_name,
       client_id      = excluded.client_id`
  ).run(
    row.id,
    row.filename,
    row.source || "generated",
    row.mime || "image/png",
    row.bytes || 0,
    row.prompt || "",
    row.revised_prompt || "",
    row.model || "",
    row.size || "",
    row.quality || "",
    row.original_name || "",
    row.client_id || "",
    row.created_at || Date.now()
  );
}

export function getGalleryFile(id) {
  if (!db) return null;
  const row = db.prepare("SELECT * FROM gallery_files WHERE id = ?").get(id);
  return row || null;
}

export function findGalleryByClientId(clientId) {
  if (!db || !clientId) return null;
  const row = db.prepare("SELECT * FROM gallery_files WHERE client_id = ? LIMIT 1").get(clientId);
  return row || null;
}

export function listGalleryFiles({ source, limit, offset } = {}) {
  if (!db) return [];
  const lim = Math.min(Math.max(+limit || 200, 1), 1000);
  const off = Math.max(+offset || 0, 0);
  const sql = source
    ? "SELECT * FROM gallery_files WHERE source = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    : "SELECT * FROM gallery_files ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const args = source ? [source, lim, off] : [lim, off];
  return db.prepare(sql).all(...args);
}

export function deleteGalleryFile(id) {
  if (!db) return null;
  const row = getGalleryFile(id);
  if (!row) return null;
  db.prepare("DELETE FROM gallery_files WHERE id = ?").run(id);
  return row;
}

export function countGalleryFiles() {
  if (!db) return 0;
  const r = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM gallery_files").get();
  return { count: r?.c || 0, bytes: r?.b || 0 };
}

/** 关闭当前 DB（导入前需要） */
export function closeDatabase() {
  try { db && db.close(); } catch (_) {}
  db = null;
}

export function getDbPath() { return currentDbPath; }
export function getDataDir() { return currentDataDir; }

/** 生成一份 DB 的安全快照文件路径（用于打包导出）；调用方负责删除 */
export function snapshotDatabaseTo(targetPath) {
  if (!db) throw new Error("数据库未打开");
  // better-sqlite3 提供 backup API，避免直接拷贝 WAL 未刷新的文件
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  fs.copyFileSync(currentDbPath, targetPath);
}
