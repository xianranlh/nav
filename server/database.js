/**
 * 樱 · SQLite 持久化（替代 sakura-state.json 单文件）
 * - app_data：整包 sakura-nav@2 JSON
 * - media_files：已上传媒体元数据（文件仍在 data/media/）
 */
import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "node:crypto";
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
    CREATE TABLE IF NOT EXISTS data_snapshots (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      payload TEXT NOT NULL,
      checksum TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
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

function checksumPayload(raw) {
  return createHash("sha256").update(String(raw || "")).digest("hex");
}

const SUMMARY_KEYS = Object.freeze([
  "nav",
  "settings",
  "blog",
  "calendar",
  "ai",
  "chat",
  "music",
  "weather",
  "sync",
  "authCred",
  "schema",
  "savedAt",
]);

function byteSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null));
  } catch (_) {
    return String(value ?? "").length;
  }
}

function countSummaryItems(key, value) {
  if (value == null) return 0;
  if (key === "nav") {
    const groups = Array.isArray(value.groups) ? value.groups : [];
    return groups.length + groups.reduce((sum, group) => sum + (Array.isArray(group.links) ? group.links.length : 0), 0);
  }
  if (key === "calendar") return (value.tasks || value.events || []).length;
  if (key === "blog") return (value.posts || []).length;
  if (key === "chat") return Array.isArray(value) ? value.length : 0;
  if (key === "music") return (value.tracks || []).length;
  if (key === "weather") return (value.cities || []).length;
  if (key === "ai") return (value.providers || []).length + (value.personas || []).length;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value).length;
  return value ? 1 : 0;
}

export function summarizeDataBundle(bundle) {
  const source = bundle && typeof bundle === "object" ? bundle : {};
  const keys = [...new Set([...SUMMARY_KEYS, ...Object.keys(source)])];
  const categories = {};
  for (const key of keys) {
    const value = source[key];
    categories[key] = {
      key,
      exists: Object.prototype.hasOwnProperty.call(source, key),
      bytes: value == null ? 0 : byteSize(value),
      items: countSummaryItems(key, value),
    };
  }
  return {
    schema: "sakura-bundle-summary@1",
    totalBytes: byteSize(source),
    categories,
  };
}

function diffSummaries(before, after) {
  const beforeCategories = before?.categories || {};
  const afterCategories = after?.categories || {};
  const keys = [...new Set([...Object.keys(beforeCategories), ...Object.keys(afterCategories)])];
  const categories = {};
  for (const key of keys) {
    const a = beforeCategories[key] || { exists: false, bytes: 0, items: 0 };
    const b = afterCategories[key] || { exists: false, bytes: 0, items: 0 };
    categories[key] = {
      key,
      before: a,
      after: b,
      changed: a.exists !== b.exists || a.bytes !== b.bytes || a.items !== b.items,
      delta: {
        bytes: (b.bytes || 0) - (a.bytes || 0),
        items: (b.items || 0) - (a.items || 0),
      },
    };
  }
  return {
    schema: "sakura-bundle-diff@1",
    totalDeltaBytes: (after?.totalBytes || 0) - (before?.totalBytes || 0),
    categories,
  };
}

function getSnapshotRow(id) {
  return db.prepare("SELECT id, label, payload, checksum, bytes, created_at AS createdAt FROM data_snapshots WHERE id = ?").get(id);
}

function parseVerifiedSnapshotPayload(row) {
  if (!row) return null;
  const checksum = checksumPayload(row.payload);
  if (checksum !== row.checksum) {
    throw new Error("快照校验失败，已阻止读取");
  }
  return JSON.parse(row.payload);
}

function snapshotMeta(row) {
  return {
    id: row.id,
    label: row.label,
    checksum: row.checksum,
    bytes: row.bytes,
    createdAt: row.createdAt,
  };
}

export function listDataSnapshots(limit = 20) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  return db.prepare(
    `SELECT id, label, checksum, bytes, created_at AS createdAt
     FROM data_snapshots
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(safeLimit);
}

export function createDataSnapshot(label = "手动快照") {
  const bundle = getBundle();
  if (!bundle) throw new Error("尚无可快照的数据");
  const raw = JSON.stringify(bundle);
  const snapshot = {
    id: randomUUID(),
    label: String(label || "手动快照").trim().slice(0, 80) || "手动快照",
    checksum: checksumPayload(raw),
    bytes: Buffer.byteLength(raw),
    createdAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO data_snapshots (id, label, payload, checksum, bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(snapshot.id, snapshot.label, raw, snapshot.checksum, snapshot.bytes, snapshot.createdAt);
  return snapshot;
}

export function restoreDataSnapshot(id) {
  const row = getSnapshotRow(id);
  if (!row) return null;
  setBundle(parseVerifiedSnapshotPayload(row));
  return snapshotMeta(row);
}

export function compareDataSnapshot(id) {
  const row = getSnapshotRow(id);
  if (!row) return null;
  const snapshotBundle = parseVerifiedSnapshotPayload(row);
  const currentBundle = getBundle() || {};
  const current = summarizeDataBundle(currentBundle);
  const snapshot = summarizeDataBundle(snapshotBundle);
  return {
    snapshot: snapshotMeta(row),
    current,
    snapshotSummary: snapshot,
    diff: diffSummaries(current, snapshot),
  };
}

export function restoreDataSnapshotCategory(id, category) {
  const row = getSnapshotRow(id);
  if (!row) return null;
  const key = String(category || "").trim();
  if (!key || key === "schema" || key === "savedAt") {
    throw new Error("该分类不支持局部恢复");
  }
  const snapshotBundle = parseVerifiedSnapshotPayload(row);
  if (!Object.prototype.hasOwnProperty.call(snapshotBundle, key)) {
    throw new Error("快照中不存在该分类");
  }
  const currentBundle = getBundle() || {};
  currentBundle[key] = snapshotBundle[key];
  currentBundle.savedAt = Date.now();
  setBundle(currentBundle);
  return {
    snapshot: snapshotMeta(row),
    category: key,
    summary: summarizeDataBundle(currentBundle).categories[key],
  };
}

export function deleteDataSnapshot(id) {
  const result = db.prepare("DELETE FROM data_snapshots WHERE id = ?").run(id);
  return result.changes > 0;
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
