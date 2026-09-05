import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  applyKnowledgeScan,
  getKnowledgeAsset,
  getKnowledgeIndexStats,
  getKnowledgeNote,
  getKnowledgeSummaries,
  listKnowledgeFingerprints,
  listKnowledgeTags,
  searchKnowledgeNotes,
} from "../database.js";
import {
  KnowledgeError,
  createKnowledgeConfig,
  normalizeRelativePath,
  opaqueKnowledgeId,
  resolveUserVault,
  safeResolveExisting,
} from "./paths.js";
import { scanVault } from "./scanner.js";
import { createSafeMarkdownDocument, sanitizeSvg } from "./markdown.js";

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function canonicalCandidate(sourcePath, targetRef) {
  let ref = String(targetRef || "").trim().replaceAll("\\", "/");
  try { ref = decodeURIComponent(ref); } catch (_) {}
  if (!ref) return null;
  if (!path.posix.extname(ref)) ref += ".md";
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), ref));
  if (candidate === ".." || candidate.startsWith("../") || candidate.startsWith("/")) return null;
  return candidate;
}

function resolveLinkTarget(sourcePath, targetRef, byPath, byBasename) {
  const candidate = canonicalCandidate(sourcePath, targetRef);
  if (candidate) {
    const exact = byPath.get(candidate.toLocaleLowerCase());
    if (exact) return exact;
  }
  const clean = String(targetRef || "").replaceAll("\\", "/").split("#")[0];
  const base = path.posix.basename(clean, path.posix.extname(clean)).toLocaleLowerCase();
  const matches = byBasename.get(base) || [];
  return matches.length === 1 ? matches[0] : null;
}

async function buildAssets({ note, vaultPath, userId, secret, maxAttachmentBytes }) {
  const assets = [];
  for (const asset of note.assets || []) {
    let ref = String(asset.targetRef || "").trim().replaceAll("\\", "/");
    try { ref = decodeURIComponent(ref); } catch (_) {}
    const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(note.relativePath), ref));
    if (!candidate || candidate === ".." || candidate.startsWith("../") || candidate.startsWith("/")) continue;
    try {
      const resolved = await safeResolveExisting(vaultPath, candidate);
      if (resolved.stat.size > maxAttachmentBytes) continue;
      const ext = path.extname(candidate).toLowerCase();
      if (!MIME_BY_EXT[ext]) continue;
      assets.push({
        assetId: opaqueKnowledgeId(secret, userId, "a", `${note.relativePath}--asset--${candidate}`),
        relativePath: candidate,
        mimeType: MIME_BY_EXT[ext],
        sizeBytes: resolved.stat.size,
        contentHash: await hashFile(resolved.path),
      });
    } catch (_) {}
  }
  return assets;
}

export class KnowledgeService {
  constructor({ env = process.env, secret }) {
    this.config = createKnowledgeConfig(env);
    this.secret = String(secret || "");
    this.states = new Map();
    this.lastManualReindex = new Map();
  }

  _state(userId) {
    const uid = Number(userId);
    if (!this.states.has(uid)) {
      this.states.set(uid, {
        ready: false,
        indexing: false,
        taskId: null,
        promise: null,
        lastStartedAt: 0,
        lastFinishedAt: 0,
        errorCode: null,
        issues: [],
      });
    }
    return this.states.get(uid);
  }

  async _vault(userId) {
    const vault = await resolveUserVault(this.config, userId);
    if (!vault.enabled) throw new KnowledgeError("OBS_DISABLED", "Obsidian 知识库未启用", 503);
    if (!vault.configured) {
      throw new KnowledgeError(vault.errorCode || "VAULT_NOT_CONFIGURED", "当前用户的 Vault 未配置", 404);
    }
    return vault;
  }

  startIndex(userId, { force = false, manual = false } = {}) {
    const uid = Number(userId);
    const state = this._state(uid);
    if (state.promise) return { taskId: state.taskId, promise: state.promise, existing: true };
    if (manual) {
      const last = this.lastManualReindex.get(uid) || 0;
      if (Date.now() - last < 30_000) {
        throw new KnowledgeError("REINDEX_RATE_LIMITED", "重新索引操作过于频繁", 429);
      }
      this.lastManualReindex.set(uid, Date.now());
    }
    const stats = getKnowledgeIndexStats(uid);
    if (!force && state.ready && Date.now() - state.lastFinishedAt < this.config.rescanIntervalMs) {
      return { taskId: null, promise: Promise.resolve({ ...stats, skipped: true }), existing: false };
    }

    state.taskId = randomUUID();
    state.indexing = true;
    state.errorCode = null;
    state.lastStartedAt = Date.now();
    state.promise = this._indexUser(uid, { reparse: manual })
      .then((result) => {
        state.ready = true;
        state.lastFinishedAt = Date.now();
        state.issues = result.issues || [];
        return result;
      })
      .catch((error) => {
        state.errorCode = error?.code || "INDEX_FAILED";
        throw error;
      })
      .finally(() => {
        state.indexing = false;
        state.promise = null;
      });
    return { taskId: state.taskId, promise: state.promise, existing: false };
  }

  async indexUser(userId, options = {}) {
    return this.startIndex(userId, options).promise;
  }

  async _indexUser(userId, { reparse = false } = {}) {
    const vault = await this._vault(userId);
    const existingRows = listKnowledgeFingerprints(userId);
    const existingByPath = reparse ? new Map() : new Map(existingRows.map((row) => [row.relative_path, row]));
    const scan = await scanVault({
      vaultPath: vault.path,
      existingByPath,
      maxNoteBytes: this.config.maxNoteBytes,
      maxFiles: this.config.maxFiles,
    });

    const claimedIds = new Set(scan.files.filter((file) => file.unchanged).map((file) => file.noteId));
    const rowsByHash = new Map();
    for (const row of existingRows) {
      if (!rowsByHash.has(row.content_hash)) rowsByHash.set(row.content_hash, []);
      rowsByHash.get(row.content_hash).push(row);
    }
    for (const file of scan.files) {
      if (file.unchanged) continue;
      const samePath = existingByPath.get(file.relativePath);
      if (samePath) {
        file.noteId = samePath.note_id;
      } else {
        const hashMatches = (rowsByHash.get(file.contentHash) || []).filter((row) => !claimedIds.has(row.note_id));
        file.noteId = hashMatches.length === 1
          ? hashMatches[0].note_id
          : opaqueKnowledgeId(this.secret, userId, "n", file.relativePath);
      }
      claimedIds.add(file.noteId);
    }

    const byPath = new Map();
    const byBasename = new Map();
    for (const file of scan.files) {
      byPath.set(file.relativePath.toLocaleLowerCase(), file.noteId);
      const base = path.posix.basename(file.relativePath, ".md").toLocaleLowerCase();
      if (!byBasename.has(base)) byBasename.set(base, []);
      byBasename.get(base).push(file.noteId);
    }

    const upserts = [];
    for (const file of scan.files) {
      if (file.unchanged) continue;
      file.links = (file.links || []).map((link) => ({
        ...link,
        targetNoteId: resolveLinkTarget(file.relativePath, link.targetRef, byPath, byBasename),
      }));
      file.assets = await buildAssets({
        note: file,
        vaultPath: vault.path,
        userId,
        secret: this.secret,
        maxAttachmentBytes: this.config.maxAttachmentBytes,
      });
      upserts.push(file);
    }

    const result = applyKnowledgeScan(userId, {
      upserts,
      seenPaths: scan.files.map((file) => file.relativePath),
    });
    return { ...result, issues: scan.issues };
  }

  async status(userId) {
    const uid = Number(userId);
    const state = this._state(uid);
    const stats = getKnowledgeIndexStats(uid);
    const vault = await resolveUserVault(this.config, uid);
    if (vault.enabled && vault.configured && !state.promise) {
      const stale = !state.ready || Date.now() - state.lastFinishedAt >= this.config.rescanIntervalMs;
      if (stale) {
        const task = this.startIndex(uid);
        task.promise.catch(() => {});
      }
    }
    return {
      enabled: vault.enabled,
      configured: vault.configured,
      writable: !!(vault.configured && this.config.writeEnabled),
      indexing: this._state(uid).indexing,
      noteCount: stats.noteCount,
      lastIndexedAt: stats.lastIndexedAt,
      errorCode: vault.errorCode || state.errorCode || null,
      taskId: state.indexing ? state.taskId : null,
      issueCount: state.issues.length,
    };
  }

  async _assertReadable(userId) {
    await this._vault(userId);
    const state = this._state(userId);
    const stats = getKnowledgeIndexStats(userId);
    if (!state.ready && !state.promise) {
      const task = this.startIndex(userId);
      task.promise.catch(() => {});
    }
    if (!state.ready && stats.noteCount === 0) {
      throw new KnowledgeError("INDEX_BUILDING", "Vault 正在建立索引", 503);
    }
  }

  async search(userId, query, limit) {
    await this._assertReadable(userId);
    return searchKnowledgeNotes(userId, query, limit);
  }

  async note(userId, noteId) {
    await this._assertReadable(userId);
    const note = getKnowledgeNote(userId, noteId);
    if (!note) return null;
    const document = createSafeMarkdownDocument(note.markdown, {
      sourcePath: note.relativePath,
      links: note.links,
      assets: note.assets,
    });
    return {
      noteId: note.noteId,
      title: note.title,
      excerpt: note.excerpt,
      tags: note.tags,
      frontmatter: note.frontmatter,
      updatedAt: note.updatedAt,
      document,
      links: note.links.map((link) => ({
        noteId: link.targetNoteId,
        title: link.targetTitle || path.posix.basename(link.targetRef, path.posix.extname(link.targetRef)),
        kind: link.kind,
        available: !!link.targetNoteId,
      })),
      backlinks: note.backlinks,
      assets: note.assets.map((asset) => ({
        assetId: asset.assetId,
        name: path.posix.basename(asset.relativePath),
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      })),
    };
  }

  async asset(userId, assetId) {
    await this._assertReadable(userId);
    const record = getKnowledgeAsset(userId, assetId);
    if (!record) throw new KnowledgeError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    const vault = await this._vault(userId);
    const resolved = await safeResolveExisting(vault.path, record.relative_path);
    if (resolved.stat.size > this.config.maxAttachmentBytes || resolved.stat.size !== Number(record.size_bytes)) {
      throw new KnowledgeError("ATTACHMENT_CHANGED", "附件已变化，请重新索引", 409);
    }
    const expectedMime = MIME_BY_EXT[path.extname(record.relative_path).toLowerCase()];
    if (!expectedMime || expectedMime !== record.mime_type) {
      throw new KnowledgeError("UNSAFE_ATTACHMENT", "附件类型不受支持", 415);
    }
    const hash = await hashFile(resolved.path);
    if (hash !== record.content_hash) {
      throw new KnowledgeError("ATTACHMENT_CHANGED", "附件已变化，请重新索引", 409);
    }
    let bytes = null;
    if (expectedMime === "image/svg+xml") {
      bytes = await fs.promises.readFile(resolved.path);
      bytes = sanitizeSvg(bytes);
      if (!bytes) throw new KnowledgeError("UNSAFE_ATTACHMENT", "SVG 包含不安全内容", 415);
    }
    return {
      bytes,
      path: bytes ? null : resolved.path,
      mimeType: expectedMime,
      name: path.posix.basename(record.relative_path),
      contentHash: record.content_hash,
    };
  }

  async summaries(userId, noteIds) {
    await this._assertReadable(userId);
    return getKnowledgeSummaries(userId, noteIds);
  }

  async tags(userId, limit) {
    await this._assertReadable(userId);
    return listKnowledgeTags(userId, limit);
  }
}
