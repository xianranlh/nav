/**
 * 闲然导航 · 链接元数据（网页标题抓取）
 * - isSafeHttpUrl：仅 http(s) + 拒绝内网 / localhost（防 SSRF）
 * - extractTitleFromHtml：og:title → <title>
 * - createTtlCache：短时内存缓存
 */
import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;
  const s = String(ip).toLowerCase();
  if (s === "127.0.0.1" || s === "0.0.0.0") return true;
  if (s.startsWith("10.")) return true;
  if (s.startsWith("192.168.")) return true;
  if (s.startsWith("169.254.")) return true;
  const m172 = /^172\.(\d+)\./.exec(s);
  if (m172) {
    const n = Number(m172[1]);
    if (n >= 16 && n <= 31) return true;
  }
  // IPv6 localhost / ULA / link-local / mapped IPv4 loopback
  if (s === "::1") return true;
  if (s.startsWith("fc") || s.startsWith("fd")) return true;
  if (s.startsWith("fe80:")) return true;
  if (s.startsWith("::ffff:127.") || s === "::ffff:0:0" || s.startsWith("::ffff:0.")) return true;
  return false;
}

/** 校验 URL 是否允许服务端代抓（防 SSRF） */
export async function isSafeHttpUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch (_) {
    return false;
  }
  if (!(u.protocol === "http:" || u.protocol === "https:")) return false;
  const host = (u.hostname || "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs || addrs.length === 0) return false;
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch (_) {
    return false;
  }
}

function decodeBasicEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch (_) {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch (_) {
        return "";
      }
    });
}

function cleanTitle(raw) {
  const t = decodeBasicEntities(String(raw || ""))
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  // 与前端 name 字段 maxlength=60 对齐
  return t.length > 60 ? t.slice(0, 60).trim() : t;
}

/**
 * 从 HTML 片段提取标题。
 * 优先级：og:title → twitter:title → <title>
 */
export function extractTitleFromHtml(html) {
  const s = String(html || "");

  const metaTitle = (prop) => {
    // property/name 与 content 任意顺序
    const re1 = new RegExp(
      `<meta\\s+[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    );
    const re2 = new RegExp(
      `<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["'][^>]*>`,
      "i"
    );
    const m = re1.exec(s) || re2.exec(s);
    return m && m[1] ? cleanTitle(m[1]) : "";
  };

  const og = metaTitle("og:title");
  if (og) return og;
  const tw = metaTitle("twitter:title");
  if (tw) return tw;

  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  if (t && t[1]) return cleanTitle(t[1]);
  return "";
}

export function createTtlCache(ttlMs) {
  const m = new Map(); // key -> { exp, val }
  return {
    get(key) {
      const it = m.get(key);
      if (!it) return null;
      if (Date.now() > it.exp) {
        m.delete(key);
        return null;
      }
      return it.val;
    },
    set(key, val) {
      m.set(key, { exp: Date.now() + ttlMs, val });
      // 简单容量保护
      if (m.size > 500) {
        const first = m.keys().next().value;
        if (first != null) m.delete(first);
      }
    },
  };
}

/** 只读响应前 maxBytes 字节（够抽 title，避免大页面占内存） */
export async function readResponseTextLimited(res, maxBytes = 256 * 1024) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.length) continue;
      chunks.push(value);
      size += value.length;
      if (size >= maxBytes) break;
    }
  } finally {
    try {
      reader.cancel();
    } catch (_) {}
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)), Math.min(size, maxBytes));
  // 常见 charset 兜底：utf-8；非 utf-8 站点可能略乱码，但多数现代页 OK
  return buf.toString("utf8");
}
