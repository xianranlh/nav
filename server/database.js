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
  fs.mkdirSync(dataDir, { recursive: true });
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
