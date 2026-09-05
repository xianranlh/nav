import path from "node:path";

const INLINE_TOKEN = /(!?\[\[[^\]\n]{1,500}\]\]|!\[[^\]\n]{0,300}\]\([^\n)]{1,1000}\)|\[[^\]\n]{1,500}\]\([^\n)]{1,1000}\)|`[^`\n]{1,2000}`|\*\*[^*\n]{1,1000}\*\*|__[^_\n]{1,1000}__|(?<!\*)\*[^*\n]{1,1000}\*(?!\*)|(?<!_)_[^_\n]{1,1000}_(?!_))/g;

function cleanText(value) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[A-Za-z][^>]{0,2000}>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function splitDestination(value) {
  const raw = String(value || "").trim();
  if (raw.startsWith("<") && raw.includes(">")) return raw.slice(1, raw.indexOf(">"));
  return raw.replace(/\s+["'][^"']*["']\s*$/, "").trim();
}

function safeExternalUrl(value) {
  try {
    const url = new URL(splitDestination(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

function refKey(value) {
  let ref = splitDestination(value).replaceAll("\\", "/").split("#")[0];
  try { ref = decodeURIComponent(ref); } catch (_) {}
  return ref.trim().toLocaleLowerCase();
}

function textPart(value) {
  return { type: "text", text: cleanText(value) };
}

export function renderInlineSafe(value, { noteLinks = new Map(), assets = new Map() } = {}) {
  const source = String(value || "");
  const parts = [];
  let cursor = 0;
  for (const match of source.matchAll(INLINE_TOKEN)) {
    if (match.index > cursor) parts.push(textPart(source.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("![[")) {
      const inner = token.slice(3, -2);
      const [target, alias] = inner.split("|", 2);
      const asset = assets.get(refKey(target));
      parts.push(asset
        ? { type: "asset", assetId: asset.assetId, mimeType: asset.mimeType, name: asset.name, alt: cleanText(alias || asset.name || "附件") }
        : textPart(alias || target));
    } else if (token.startsWith("![")) {
      const parsed = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
      const asset = parsed ? assets.get(refKey(parsed[2])) : null;
      parts.push(asset
        ? { type: "asset", assetId: asset.assetId, mimeType: asset.mimeType, name: asset.name, alt: cleanText(parsed[1] || asset.name || "附件") }
        : textPart(parsed?.[1] || "附件"));
    } else if (token.startsWith("[[")) {
      const inner = token.slice(2, -2);
      const [targetWithHeading, alias] = inner.split("|", 2);
      const [target, heading] = targetWithHeading.split("#", 2);
      const noteId = noteLinks.get(refKey(target));
      parts.push(noteId
        ? { type: "note", noteId, text: cleanText(alias || target), heading: cleanText(heading || "") }
        : textPart(alias || target));
    } else if (token.startsWith("[")) {
      const parsed = /^\[([^\]]+)\]\(([^)]*)\)$/.exec(token);
      const label = cleanText(parsed?.[1] || "链接");
      const destination = parsed?.[2] || "";
      const noteId = noteLinks.get(refKey(destination));
      const href = safeExternalUrl(destination);
      const heading = splitDestination(destination).split("#", 2)[1] || "";
      parts.push(noteId
        ? { type: "note", noteId, text: label, heading: cleanText(heading) }
        : href ? { type: "external", href, text: label } : textPart(label));
    } else if (token.startsWith("`")) {
      parts.push({ type: "code", text: cleanText(token.slice(1, -1)) });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      parts.push({ type: "strong", text: cleanText(token.slice(2, -2)) });
    } else {
      parts.push({ type: "em", text: cleanText(token.slice(1, -1)) });
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) parts.push(textPart(source.slice(cursor)));
  return parts.filter((part) => part.type !== "text" || part.text);
}

function assetLookupKey(sourcePath, relativePath) {
  let ref = splitDestination(relativePath).replaceAll("\\", "/");
  try { ref = decodeURIComponent(ref); } catch (_) {}
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), ref));
  return refKey(candidate);
}

export function createSafeMarkdownDocument(markdown, { sourcePath = "note.md", links = [], assets = [] } = {}) {
  const noteLinks = new Map();
  for (const link of links) {
    if (link?.targetNoteId) noteLinks.set(refKey(link.targetRef), link.targetNoteId);
  }
  const assetMap = new Map();
  for (const asset of assets) {
    const publicAsset = {
      assetId: asset.assetId,
      mimeType: asset.mimeType,
      name: asset.name || path.posix.basename(asset.relativePath || "附件"),
    };
    assetMap.set(refKey(asset.relativePath), publicAsset);
    const relativeToNote = path.posix.relative(path.posix.dirname(sourcePath), asset.relativePath || "");
    assetMap.set(refKey(relativeToNote), publicAsset);
  }
  const context = { noteLinks, assets: assetMap };
  const lines = String(markdown || "").replaceAll("\r\n", "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ type: "paragraph", parts: renderInlineSafe(text, context) });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push(list);
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const fence = /^\s{0,3}```\s*([A-Za-z0-9_+#.-]{0,40})\s*$/.exec(rawLine);
    if (fence) {
      flushParagraph(); flushList();
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s{0,3}```\s*$/.test(lines[index])) {
        code.push(lines[index]); index += 1;
      }
      blocks.push({ type: "code", language: fence[1] || "", text: cleanText(code.join("\n")) });
      continue;
    }
    if (!rawLine.trim()) { flushParagraph(); flushList(); continue; }
    if (/^\s{0,3}(?:---+|\*\*\*+|___+)\s*$/.test(rawLine)) {
      flushParagraph(); flushList(); blocks.push({ type: "divider" }); continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(rawLine);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push({ type: "heading", level: heading[1].length, parts: renderInlineSafe(heading[2], context) });
      continue;
    }
    const item = /^\s{0,3}([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(rawLine);
    if (item) {
      flushParagraph();
      const ordered = /^\d/.test(item[1]);
      if (!list || list.ordered !== ordered) { flushList(); list = { type: "list", ordered, items: [] }; }
      list.items.push({ checked: item[2] == null ? null : /x/i.test(item[2]), parts: renderInlineSafe(item[3], context) });
      continue;
    }
    const quote = /^\s{0,3}>\s?(.*)$/.exec(rawLine);
    if (quote) {
      flushParagraph(); flushList();
      blocks.push({ type: "blockquote", parts: renderInlineSafe(quote[1], context) });
      continue;
    }
    paragraph.push(rawLine.trim());
  }
  flushParagraph(); flushList();
  return { version: 1, blocks: blocks.slice(0, 10_000) };
}

export function sanitizeSvg(source) {
  let svg = Buffer.isBuffer(source) ? source.toString("utf8") : String(source || "");
  if (Buffer.byteLength(svg) > 5 * 1024 * 1024 || !/^\s*(?:<\?xml[^>]*>\s*)?<svg\b[\s\S]*<\/svg>\s*$/i.test(svg)) return null;
  const dangerous = /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed|link|style|use|image|a|animate|set|audio|video|canvas|base|meta)\b|\son[a-z]+\s*=|(?:href|xlink:href)\s*=|\burl\s*\(|@import|<\?/i;
  if (dangerous.test(svg)) return null;
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  return Buffer.from(svg, "utf8");
}

export function assetReferenceKey(sourcePath, relativePath) {
  return assetLookupKey(sourcePath, relativePath);
}
