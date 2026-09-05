import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isPathInside } from "./paths.js";

const HIDDEN_DIRS = new Set([".obsidian", ".trash", ".git"]);
const SAFE_FRONTMATTER_KEYS = new Set(["title", "tags", "aliases", "description", "created", "updated"]);
const ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".pdf"]);

function scalar(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith("[") && text.endsWith("]")) {
    return text.slice(1, -1).split(",").map((item) => scalar(item)).filter((item) => item !== "");
  }
  return text;
}

function parseFrontmatter(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return { data: {}, body: source };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0 || end > 64 * 1024) return { data: {}, body: source };

  const data = Object.create(null);
  let listKey = "";
  for (const line of normalized.slice(4, end).split("\n")) {
    const list = /^\s*-\s+(.+)$/.exec(line);
    if (list && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(scalar(list[1]));
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]{0,63}):\s*(.*)$/.exec(line);
    if (!match) {
      listKey = "";
      continue;
    }
    const key = match[1].toLowerCase();
    listKey = "";
    if (!SAFE_FRONTMATTER_KEYS.has(key)) continue;
    if (!match[2].trim() && (key === "tags" || key === "aliases")) {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = scalar(match[2]);
    }
  }
  return { data: { ...data }, body: normalized.slice(end + 5) };
}

function stripMarkdown(markdown) {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => alias || target)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[>*_~=-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stringArray(value) {
  const input = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[ ,]+/) : [];
  return [...new Set(input.map((item) => String(item || "").trim().replace(/^#/, "")).filter(Boolean))].slice(0, 100);
}

function collectTags(body, frontmatter) {
  const tags = new Set(stringArray(frontmatter.tags));
  const tagSource = String(body || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  for (const match of tagSource.matchAll(/(?:^|[\s，。！？、；：])#([\p{L}_][\p{L}\p{N}_/-]*)/gu)) {
    if (match[1] && !/^[0-9a-f]{6,8}$/i.test(match[1])) tags.add(match[1]);
    if (tags.size >= 100) break;
  }
  return [...tags];
}

function collectLinks(body) {
  const links = [];
  const seen = new Set();
  for (const match of body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const targetRef = String(match[1] || "").trim();
    if (!targetRef || seen.has(`wiki:${targetRef}`)) continue;
    seen.add(`wiki:${targetRef}`);
    links.push({ kind: "wiki", targetRef });
  }
  for (const match of body.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
    const targetRef = String(match[1] || "").trim().split("#")[0];
    if (!targetRef || /^(?:[a-z]+:|#)/i.test(targetRef) || !targetRef.toLowerCase().endsWith(".md")) continue;
    if (seen.has(`markdown:${targetRef}`)) continue;
    seen.add(`markdown:${targetRef}`);
    links.push({ kind: "markdown", targetRef });
  }
  return links;
}

function collectAssets(body) {
  const assets = [];
  const seen = new Set();
  const add = (targetRef) => {
    const clean = String(targetRef || "").trim().split("#")[0];
    if (!clean || /^(?:[a-z]+:|\/)/i.test(clean)) return;
    if (!ASSET_EXTENSIONS.has(path.extname(clean).toLowerCase()) || seen.has(clean)) return;
    seen.add(clean);
    assets.push({ targetRef: clean });
  };
  for (const match of body.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) add(match[1]);
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) add(match[1]);
  return assets;
}

export function parseMarkdownDocument(source, relativePath) {
  const raw = String(source || "");
  const { data: frontmatter, body } = parseFrontmatter(raw);
  const heading = /^\s{0,3}#\s+(.+)$/m.exec(body);
  const fallbackTitle = path.posix.basename(relativePath, path.posix.extname(relativePath));
  const title = String(frontmatter.title || heading?.[1] || fallbackTitle).replace(/\s+/g, " ").trim().slice(0, 300);
  const contentText = stripMarkdown(body);
  return {
    relativePath,
    title: title || fallbackTitle,
    excerpt: String(frontmatter.description || contentText).slice(0, 240),
    tags: collectTags(body, frontmatter),
    frontmatter,
    contentText,
    markdown: body,
    contentHash: createHash("sha256").update(raw).digest("hex"),
    links: collectLinks(body),
    assets: collectAssets(body),
  };
}

export async function scanVault({ vaultPath, existingByPath = new Map(), maxNoteBytes = 2 * 1024 * 1024, maxFiles = 20_000 }) {
  const files = [];
  const issues = [];
  let visited = 0;

  async function walk(absDir, relativeDir = "") {
    const entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || HIDDEN_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        issues.push({ code: "SYMLINK_SKIPPED", relativePath: path.posix.join(relativeDir, entry.name) });
        continue;
      }
      const relativePath = path.posix.join(relativeDir, entry.name);
      const absolutePath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
      visited += 1;
      if (visited > maxFiles) throw Object.assign(new Error("Vault 文件数量超过限制"), { code: "VAULT_FILE_LIMIT" });

      const stat = await fs.promises.lstat(absolutePath);
      if (stat.size > maxNoteBytes) {
        issues.push({ code: "NOTE_TOO_LARGE", relativePath, bytes: stat.size });
        continue;
      }
      const real = await fs.promises.realpath(absolutePath);
      if (!isPathInside(vaultPath, real)) {
        issues.push({ code: "UNSAFE_PATH", relativePath });
        continue;
      }
      const mtimeMs = Math.round(stat.mtimeMs);
      const existing = existingByPath.get(relativePath);
      if (existing && Number(existing.mtime_ms) === mtimeMs && Number(existing.size_bytes) === stat.size) {
        files.push({
          relativePath,
          unchanged: true,
          noteId: existing.note_id,
          contentHash: existing.content_hash,
          mtimeMs,
          sizeBytes: stat.size,
        });
        continue;
      }
      const source = await fs.promises.readFile(real, "utf8");
      files.push({
        ...parseMarkdownDocument(source, relativePath),
        unchanged: false,
        mtimeMs,
        sizeBytes: stat.size,
      });
    }
  }

  await walk(vaultPath);
  return { files, issues };
}
