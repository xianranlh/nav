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

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "sakura.db");
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
  `);

  migrateFromLegacyJson(dataDir);
  return db;
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
