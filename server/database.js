/**
 * 樱 · SQLite 持久化（替代 sakura-state.json 单文件）
 * - app_data：整包 sakura-nav@2 JSON
 * - media_files：已上传媒体元数据（文件仍在 data/media/）
 */
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
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

    -- ===== 多账号隔离（v1.21+） =====
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      cred_hash TEXT NOT NULL UNIQUE,   -- sha256("用户名::密码") hex，与前端 auth.js 同一格式
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,           -- 随机 48 hex；Bearer 凭据
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    -- 每用户一份 bundle / AI 设置（替代单例 app_data/ai_settings；旧表保留作迁移源）
    CREATE TABLE IF NOT EXISTS user_data (
      user_id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_ai_settings (
      user_id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // media_files / gallery_files 追加 user_id 列（幂等；旧行归属用户 #1）
  for (const t of ["media_files", "gallery_files"]) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;`); } catch (_) {}
  }

  migrateFromLegacyJson(dataDir);
  migrateAiSettingsFromBundle();
  migrateToMultiUser();
  return db;
}

/** 未自定义凭据时的默认账号哈希（与前端 auth.js LEGACY_DEFAULT_HASH 一致）：SHA-256("xianran::lh116688257") */
const LEGACY_DEFAULT_HASH = "0ae8f34aa71b498f71b88924734ef40fcfa1c2e76c72ecede5c2b56de4244ed1";

/** 多账号迁移（幂等）：users 为空时执行
 *  1. 迁移前把 sakura.db 备份为 sakura.db.bak-multiuser
 *  2. 用户 #1 = 旧 bundle 的 authCred.h（无则内置默认哈希），username 先占位 "xianran"，is_admin=1
 *  3. 旧 app_data(id=1) → user_data(user_id=1)；旧 ai_settings(id=1) → user_ai_settings(user_id=1)
 *  4. media_files/gallery_files 旧行已通过 DEFAULT 1 归属用户 #1 */
function migrateToMultiUser() {
  const has = db.prepare("SELECT COUNT(*) AS c FROM users").get();
  if (has && has.c > 0) return;

  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    fs.copyFileSync(currentDbPath, currentDbPath + ".bak-multiuser");
    console.log("[xianran-data] 多账号迁移：已备份数据库 →", currentDbPath + ".bak-multiuser");
  } catch (e) {
    console.warn("[xianran-data] 多账号迁移备份失败（继续迁移）：", e?.message || e);
  }

  const legacyRow = db.prepare("SELECT payload FROM app_data WHERE id = 1").get();
  let legacyBundle = null;
  try { legacyBundle = legacyRow ? JSON.parse(legacyRow.payload) : null; } catch (_) {}
  const credHash =
    (legacyBundle && legacyBundle.authCred && /^[0-9a-f]{64}$/.test(String(legacyBundle.authCred.h || "").toLowerCase())
      ? String(legacyBundle.authCred.h).toLowerCase()
      : LEGACY_DEFAULT_HASH);

  const now = Date.now();
  db.prepare(
    "INSERT INTO users (id, username, cred_hash, is_admin, created_at) VALUES (1, 'xianran', ?, 1, ?)"
  ).run(credHash, now);
  if (legacyRow) {
    db.prepare("INSERT OR REPLACE INTO user_data (user_id, payload, updated_at) VALUES (1, ?, ?)")
      .run(legacyRow.payload, now);
  }
  const legacyAi = db.prepare("SELECT payload FROM ai_settings WHERE id = 1").get();
  if (legacyAi) {
    db.prepare("INSERT OR REPLACE INTO user_ai_settings (user_id, payload, updated_at) VALUES (1, ?, ?)")
      .run(legacyAi.payload, now);
  }
  console.log("[xianran-data] 多账号迁移完成：旧数据已归属用户 #1（admin，凭据 " + (credHash === LEGACY_DEFAULT_HASH ? "内置默认" : "沿用旧账号") + "）");
}

// 首次启用独立 ai_settings 表时，把旧 bundle.payload.ai 迁移过来（读旧单例 app_data 表）
function migrateAiSettingsFromBundle() {
  const row = db.prepare("SELECT 1 AS ok FROM ai_settings WHERE id = 1").get();
  if (row) return;
  const legacy = db.prepare("SELECT payload FROM app_data WHERE id = 1").get();
  let bundle = null;
  try { bundle = legacy ? JSON.parse(legacy.payload) : null; } catch (_) {}
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

export function getBundle(userId = 1) {
  const row = db.prepare("SELECT payload FROM user_data WHERE user_id = ?").get(userId);
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch (_) {
    return null;
  }
}

export function setBundle(userId, obj) {
  const raw = JSON.stringify(obj);
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO user_data (user_id, payload, updated_at) VALUES (?, ?, ?)"
  ).run(userId, raw, now);
}

// ---------------------------------------------------------------------------
// 用户与会话（多账号隔离）
// ---------------------------------------------------------------------------

export function findUserByCredHash(hash) {
  const h = String(hash || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return null;
  return db.prepare("SELECT id, username, is_admin FROM users WHERE cred_hash = ?").get(h) || null;
}

export function getUser(id) {
  return db.prepare("SELECT id, username, is_admin, created_at FROM users WHERE id = ?").get(id) || null;
}

export function listUsers() {
  return db.prepare("SELECT id, username, is_admin, created_at FROM users ORDER BY id").all();
}

export function createUser({ username, credHash, isAdmin = false }) {
  const name = String(username || "").trim();
  const h = String(credHash || "").trim().toLowerCase();
  if (!name || name.length > 64) throw new Error("用户名不合法");
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("凭据哈希不合法");
  const r = db.prepare(
    "INSERT INTO users (username, cred_hash, is_admin, created_at) VALUES (?, ?, ?, ?)"
  ).run(name, h, isAdmin ? 1 : 0, Date.now());
  return getUser(Number(r.lastInsertRowid));
}

/** 更新用户名/凭据（改密码 = 换 cred_hash），并踢掉该用户所有会话 */
export function updateUserCred(id, { username, credHash }) {
  const u = getUser(id);
  if (!u) throw new Error("用户不存在");
  const name = String(username || u.username).trim();
  const h = String(credHash || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("凭据哈希不合法");
  db.prepare("UPDATE users SET username = ?, cred_hash = ? WHERE id = ?").run(name, h, id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  return getUser(id);
}

/** 删除用户及其所有数据记录（返回其媒体/图库文件名供上层删盘） */
export function deleteUser(id) {
  const u = getUser(id);
  if (!u) return null;
  const media = db.prepare("SELECT filename, category FROM media_files WHERE user_id = ?").all(id);
  const gallery = db.prepare("SELECT filename FROM gallery_files WHERE user_id = ?").all(id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM user_data WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM user_ai_settings WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM media_files WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM gallery_files WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return { user: u, media, gallery };
}

export function createSession(userId, ttlMs) {
  const token = randomBytes(24).toString("hex");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, now + ttlMs, now);
  return { token, expiresAt: now + ttlMs };
}

/** 校验 token → { userId, username, isAdmin } | null；顺带惰性清理过期会话 */
export function getSession(token) {
  if (!token || typeof token !== "string" || token.length > 128) return null;
  const row = db.prepare(
    `SELECT s.token, s.expires_at, u.id AS uid, u.username, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).get(token);
  if (!row) return null;
  if (Date.now() >= row.expires_at) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  if (Math.random() < 0.02) {
    try { db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now()); } catch (_) {}
  }
  return { userId: row.uid, username: row.username, isAdmin: !!row.is_admin, expiresAt: row.expires_at };
}

export function deleteSession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function recordMediaFile({ filename, category, bytes, userId = 1 }) {
  db.prepare(
    `INSERT INTO media_files (filename, category, bytes, created_at, user_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(filename) DO UPDATE SET category = excluded.category, bytes = excluded.bytes, created_at = excluded.created_at, user_id = excluded.user_id`
  ).run(filename, category, bytes || 0, Date.now(), userId);
}

/** 仅允许删除属于该用户的记录；返回是否真的删了 */
export function deleteMediaRecord(filename, userId = null) {
  if (userId == null) {
    return db.prepare("DELETE FROM media_files WHERE filename = ?").run(filename).changes > 0;
  }
  return db.prepare("DELETE FROM media_files WHERE filename = ? AND user_id = ?").run(filename, userId).changes > 0;
}

export function listMediaFiles(userId) {
  return db.prepare("SELECT filename, category, bytes, created_at FROM media_files WHERE user_id = ?").all(userId);
}

/** 供 /api/storage-stats：当前用户 bundle 体积与媒体行数（db 文件体积全局） */
export function getSqliteStorageStats(userId = 1) {
  if (!db) return { appDataBytes: 0, mediaTableRows: 0 };
  try {
    const len = db.prepare("SELECT length(payload) AS n FROM user_data WHERE user_id = ?").get(userId);
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM media_files WHERE user_id = ?").get(userId);
    return {
      appDataBytes: len && typeof len.n === "number" ? len.n : 0,
      mediaTableRows: cnt && typeof cnt.c === "number" ? cnt.c : 0,
    };
  } catch (_) {
    return { appDataBytes: 0, mediaTableRows: 0 };
  }
}

/** 列出 bundle 顶层 key 的体积和简要摘要 */
export function getKeyInventory(userId = 1) {
  const bundle = getBundle(userId) || {};
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

export function getKeyValue(key, userId = 1) {
  const bundle = getBundle(userId) || {};
  return key in bundle ? bundle[key] : null;
}

export function deleteKey(key, userId = 1) {
  const bundle = getBundle(userId);
  if (!bundle) return false;
  if (!(key in bundle)) return false;
  if (key === "schema" || key === "savedAt") return false;
  delete bundle[key];
  setBundle(userId, bundle);
  return true;
}

/** 独立存储的 AI 设置（不走 user_data bundle，避免数据放在浏览器 localStorage） */
export function getAiSettings(userId = 1) {
  if (!db) return null;
  const row = db.prepare("SELECT payload FROM user_ai_settings WHERE user_id = ?").get(userId);
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch (_) {
    return null;
  }
}

export function setAiSettings(userId, obj) {
  const raw = JSON.stringify(obj || {});
  db.prepare(
    "INSERT OR REPLACE INTO user_ai_settings (user_id, payload, updated_at) VALUES (?, ?, ?)"
  ).run(userId, raw, Date.now());
}

// ---------------------------------------------------------------------------
// Gallery files — 服务端图床
// ---------------------------------------------------------------------------

export function recordGalleryFile(row) {
  if (!db) return;
  db.prepare(
    `INSERT INTO gallery_files
       (id, filename, source, mime, bytes, prompt, revised_prompt, model, size, quality, original_name, client_id, created_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       client_id      = excluded.client_id,
       user_id        = excluded.user_id`
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
    row.created_at || Date.now(),
    row.user_id || 1
  );
}

export function getGalleryFile(id) {
  if (!db) return null;
  const row = db.prepare("SELECT * FROM gallery_files WHERE id = ?").get(id);
  return row || null;
}

export function findGalleryByClientId(clientId, userId = null) {
  if (!db || !clientId) return null;
  const row = userId == null
    ? db.prepare("SELECT * FROM gallery_files WHERE client_id = ? LIMIT 1").get(clientId)
    : db.prepare("SELECT * FROM gallery_files WHERE client_id = ? AND user_id = ? LIMIT 1").get(clientId, userId);
  return row || null;
}

export function listGalleryFiles({ source, limit, offset, userId = 1 } = {}) {
  if (!db) return [];
  const lim = Math.min(Math.max(+limit || 200, 1), 1000);
  const off = Math.max(+offset || 0, 0);
  const sql = source
    ? "SELECT * FROM gallery_files WHERE user_id = ? AND source = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    : "SELECT * FROM gallery_files WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const args = source ? [userId, source, lim, off] : [userId, lim, off];
  return db.prepare(sql).all(...args);
}

/** 仅允许删除属于该用户的图库记录（userId=null 为管理清理场景） */
export function deleteGalleryFile(id, userId = null) {
  if (!db) return null;
  const row = getGalleryFile(id);
  if (!row) return null;
  if (userId != null && row.user_id !== userId) return null;
  db.prepare("DELETE FROM gallery_files WHERE id = ?").run(id);
  return row;
}

export function countGalleryFiles(userId = 1) {
  if (!db) return 0;
  const r = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM gallery_files WHERE user_id = ?").get(userId);
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
