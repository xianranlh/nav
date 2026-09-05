import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";

export class KnowledgeError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "KnowledgeError";
    this.code = code;
    this.status = status;
  }
}

function readBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function readInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function createKnowledgeConfig(env = process.env) {
  const singleUserRaw = String(env.OBSIDIAN_SINGLE_USER_ID || "").trim();
  const singleUserId = /^\d+$/.test(singleUserRaw) ? Number(singleUserRaw) : null;
  return {
    enabled: readBool(env.OBSIDIAN_ENABLED, false),
    vaultRoot: path.resolve(String(env.OBSIDIAN_VAULT_ROOT || "/vaults")),
    singleUserId,
    writeEnabled: readBool(env.OBSIDIAN_WRITE_ENABLED, false),
    inboxDir: String(env.OBSIDIAN_INBOX_DIR || "00-Inbox").trim() || "00-Inbox",
    maxNoteBytes: readInt(env.OBSIDIAN_MAX_NOTE_BYTES, 2 * 1024 * 1024, 1024, 20 * 1024 * 1024),
    maxAttachmentBytes: readInt(env.OBSIDIAN_MAX_ATTACHMENT_BYTES, 20 * 1024 * 1024, 1024, 200 * 1024 * 1024),
    maxFiles: readInt(env.OBSIDIAN_MAX_FILES, 20_000, 1, 200_000),
    rescanIntervalMs: readInt(env.OBSIDIAN_RESCAN_INTERVAL_MS, 300_000, 30_000, 86_400_000),
  };
}

export function normalizeRelativePath(input) {
  const raw = String(input || "").replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[a-z]:\//i.test(raw)) {
    throw new KnowledgeError("UNSAFE_PATH", "路径不安全", 400);
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new KnowledgeError("UNSAFE_PATH", "路径不安全", 400);
  }
  return normalized;
}

export function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

async function rejectSymlinkComponents(root, relativePath) {
  const parts = normalizeRelativePath(relativePath).split("/");
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const stat = await fs.promises.lstat(cursor);
    if (stat.isSymbolicLink()) {
      throw new KnowledgeError("UNSAFE_PATH", "不允许通过符号链接访问 Vault", 400);
    }
  }
}

export async function safeResolveExisting(vaultPath, relativePath, { allowDirectory = false } = {}) {
  const normalized = normalizeRelativePath(relativePath);
  await rejectSymlinkComponents(vaultPath, normalized);
  const candidate = path.resolve(vaultPath, ...normalized.split("/"));
  const real = await fs.promises.realpath(candidate);
  if (!isPathInside(vaultPath, real)) {
    throw new KnowledgeError("UNSAFE_PATH", "路径超出 Vault", 400);
  }
  const stat = await fs.promises.stat(real);
  if (!allowDirectory && !stat.isFile()) {
    throw new KnowledgeError("NOTE_NOT_FOUND", "目标不是文件", 404);
  }
  if (allowDirectory && !stat.isDirectory()) {
    throw new KnowledgeError("VAULT_NOT_CONFIGURED", "目标不是目录", 404);
  }
  return { path: real, relativePath: normalized, stat };
}

export async function resolveUserVault(config, userId) {
  if (!config.enabled) {
    return { enabled: false, configured: false, writable: false, errorCode: "OBS_DISABLED" };
  }
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid < 1) {
    throw new KnowledgeError("VAULT_NOT_CONFIGURED", "用户无效", 404);
  }
  if (config.singleUserId != null && uid !== config.singleUserId) {
    return { enabled: true, configured: false, writable: false, errorCode: "VAULT_NOT_CONFIGURED" };
  }

  const candidate = config.singleUserId != null
    ? config.vaultRoot
    : path.join(config.vaultRoot, `user-${uid}`);
  try {
    const linkStat = await fs.promises.lstat(candidate);
    if (linkStat.isSymbolicLink()) {
      return { enabled: true, configured: false, writable: false, errorCode: "UNSAFE_PATH" };
    }
    const real = await fs.promises.realpath(candidate);
    const stat = await fs.promises.stat(real);
    if (!stat.isDirectory()) {
      return { enabled: true, configured: false, writable: false, errorCode: "VAULT_NOT_CONFIGURED" };
    }
    if (config.singleUserId == null) {
      let rootReal;
      try {
        rootReal = await fs.promises.realpath(config.vaultRoot);
      } catch (_) {
        rootReal = path.resolve(config.vaultRoot);
      }
      if (!isPathInside(rootReal, real)) {
        return { enabled: true, configured: false, writable: false, errorCode: "UNSAFE_PATH" };
      }
    }
    return {
      enabled: true,
      configured: true,
      writable: !!config.writeEnabled,
      errorCode: null,
      path: real,
    };
  } catch (error) {
    const code = error?.code === "EACCES" ? "VAULT_UNREADABLE" : "VAULT_NOT_CONFIGURED";
    return { enabled: true, configured: false, writable: false, errorCode: code };
  }
}

export function opaqueKnowledgeId(secret, userId, kind, relativePath) {
  const key = String(secret || "");
  if (key.length < 16) throw new Error("knowledge id secret is too short");
  const normalized = normalizeRelativePath(relativePath);
  const digest = createHmac("sha256", key)
    .update(`${Number(userId)}\0${kind}\0${normalized}`)
    .digest("base64url")
    .slice(0, 24);
  return `${kind}_${digest}`;
}
