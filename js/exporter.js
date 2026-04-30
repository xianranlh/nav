/* 樱 · 导出工具
 *  - RSS 2.0 XML（博客）
 *  - 静态站生成（自包含 HTML 每篇 + index.html）
 *  - 极简无压缩 ZIP 打包器（STORE 方式，不依赖库）
 *  CRC32 使用经典表驱动实现
 */
(function () {
  "use strict";

  // ===================== CRC32 =====================
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ===================== 极简 ZIP（STORE） =====================
  function strToU8(s) { return new TextEncoder().encode(s); }
  function writeU16(buf, off, v) { buf[off] = v & 0xff; buf[off + 1] = (v >>> 8) & 0xff; }
  function writeU32(buf, off, v) { buf[off] = v & 0xff; buf[off + 1] = (v >>> 8) & 0xff; buf[off + 2] = (v >>> 16) & 0xff; buf[off + 3] = (v >>> 24) & 0xff; }
  function dosTime(d = new Date()) {
    const t = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
    const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
    return { t, date };
  }

  function zip(files /* [{name, data}] */) {
    const entries = files.map((f) => {
      const data = typeof f.data === "string" ? strToU8(f.data) : f.data;
      const nameU8 = strToU8(f.name);
      const crc = crc32(data);
      const { t, date } = dosTime();
      return { name: nameU8, data, crc, t, date };
    });

    // 计算总大小
    let localSize = 0;
    let centralSize = 0;
    for (const e of entries) {
      localSize += 30 + e.name.length + e.data.length;
      centralSize += 46 + e.name.length;
    }
    const total = localSize + centralSize + 22;
    const buf = new Uint8Array(total);
    let off = 0;
    const centralStart = localSize;
    const centrals = [];

    for (const e of entries) {
      const localOff = off;
      writeU32(buf, off, 0x04034b50); off += 4;
      writeU16(buf, off, 20); off += 2;        // version
      writeU16(buf, off, 0); off += 2;         // flags
      writeU16(buf, off, 0); off += 2;         // method = store
      writeU16(buf, off, e.t); off += 2;
      writeU16(buf, off, e.date); off += 2;
      writeU32(buf, off, e.crc); off += 4;
      writeU32(buf, off, e.data.length); off += 4;
      writeU32(buf, off, e.data.length); off += 4;
      writeU16(buf, off, e.name.length); off += 2;
      writeU16(buf, off, 0); off += 2;
      buf.set(e.name, off); off += e.name.length;
      buf.set(e.data, off); off += e.data.length;
      centrals.push({ e, localOff });
    }

    for (const { e, localOff } of centrals) {
      writeU32(buf, off, 0x02014b50); off += 4;
      writeU16(buf, off, 20); off += 2;
      writeU16(buf, off, 20); off += 2;
      writeU16(buf, off, 0); off += 2;
      writeU16(buf, off, 0); off += 2;
      writeU16(buf, off, e.t); off += 2;
      writeU16(buf, off, e.date); off += 2;
      writeU32(buf, off, e.crc); off += 4;
      writeU32(buf, off, e.data.length); off += 4;
      writeU32(buf, off, e.data.length); off += 4;
      writeU16(buf, off, e.name.length); off += 2;
      writeU16(buf, off, 0); off += 2; // extra
      writeU16(buf, off, 0); off += 2; // comment
      writeU16(buf, off, 0); off += 2; // disk number
      writeU16(buf, off, 0); off += 2; // internal attrs
      writeU32(buf, off, 0); off += 4; // external attrs
      writeU32(buf, off, localOff); off += 4;
      buf.set(e.name, off); off += e.name.length;
    }

    // EOCD
    writeU32(buf, off, 0x06054b50); off += 4;
    writeU16(buf, off, 0); off += 2;
    writeU16(buf, off, 0); off += 2;
    writeU16(buf, off, entries.length); off += 2;
    writeU16(buf, off, entries.length); off += 2;
    writeU32(buf, off, centralSize); off += 4;
    writeU32(buf, off, centralStart); off += 4;
    writeU16(buf, off, 0); off += 2;

    return new Blob([buf], { type: "application/zip" });
  }

  // ===================== 工具 =====================
  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function slugify(s) {
    return String(s || "post").toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 60) || "post";
  }

  // ===================== RSS 2.0 =====================
  function buildRss({ title = "樱 · 博客", description = "Sakura Nav Blog", link = "" } = {}) {
    const posts = (window.Blog?.list?.(true) || []).filter((p) => p.published !== false);
    const items = posts.map((p) => {
      const pub = new Date(p.updatedAt || p.createdAt || Date.now()).toUTCString();
      const permalink = `${link || ""}#post-${p.id}`;
      const desc = (p.content || "").slice(0, 800);
      return `<item>
  <title>${esc(p.title)}</title>
  <link>${esc(permalink)}</link>
  <guid isPermaLink="false">${esc(p.id)}</guid>
  <pubDate>${pub}</pubDate>
  ${(p.tags || []).map((t) => `<category>${esc(t)}</category>`).join("")}
  <description><![CDATA[${desc}]]></description>
</item>`;
    }).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(title)}</title>
  <link>${esc(link)}</link>
  <description>${esc(description)}</description>
  <language>zh-cn</language>
  <generator>Sakura Nav</generator>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;
  }

  // ===================== 静态站 =====================
  const STATIC_CSS = `:root{--accent:#ff8fab;--text:#2d2432;--soft:#6f5a6a;--bg:#fff5f9;}
*{box-sizing:border-box}
body{margin:0;font:16px/1.65 -apple-system,"PingFang SC","Microsoft Yahei",sans-serif;color:var(--text);background:var(--bg)}
.wrap{max-width:760px;margin:0 auto;padding:32px 20px 80px}
header.site{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid #f4d2df;margin-bottom:24px}
header.site a{color:var(--accent);text-decoration:none;font-weight:600}
h1,h2,h3{color:var(--text)}
a{color:var(--accent)}
.meta{color:var(--soft);font-size:13px;margin-bottom:18px}
.tags span{display:inline-block;background:#ffd6e6;color:#c34f74;padding:2px 8px;border-radius:999px;font-size:12px;margin-right:6px}
.post-list{list-style:none;padding:0}
.post-list li{padding:14px 0;border-bottom:1px dashed #f0d6e0}
.post-list a{text-decoration:none;font-size:18px;font-weight:600}
.post-list .excerpt{color:var(--soft);font-size:14px;margin-top:6px}
article{background:#fff;border-radius:16px;padding:28px 26px;box-shadow:0 6px 24px rgba(255,143,171,.15)}
article img{max-width:100%;border-radius:10px}
article pre{background:#2d2432;color:#ffd6e6;padding:14px;border-radius:10px;overflow-x:auto;font-size:13px}
article code{background:#ffd6e6;color:#c34f74;padding:2px 6px;border-radius:4px;font-size:13px}
article pre code{background:none;color:inherit;padding:0}
article blockquote{border-left:3px solid var(--accent);padding:6px 16px;color:var(--soft);background:#ffeaf2;border-radius:8px;margin:12px 0}
footer{margin-top:40px;color:var(--soft);font-size:12px;text-align:center}
@media(prefers-color-scheme:dark){:root{--bg:#1f1a24;--text:#ffe4ee;--soft:#c8a0b0}article{background:#2a2230;box-shadow:0 6px 24px rgba(0,0,0,.4)}header.site{border-color:#3a2a35}}`;

  function renderPostHtml(post) {
    const html = window.AI?.renderMarkdown?.(post.content || "") || `<pre>${esc(post.content || "")}</pre>`;
    const tagsHtml = (post.tags || []).map((t) => `<span>${esc(t)}</span>`).join("");
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(post.title)} - 樱 · 博客</title>
<link rel="stylesheet" href="style.css" /></head>
<body><div class="wrap">
<header class="site"><a href="index.html">← 返回首页</a><a href="index.html">🌸 樱 · 博客</a></header>
<article>
<h1>${esc(post.title)}</h1>
<div class="meta">${new Date(post.createdAt || Date.now()).toLocaleDateString("zh-CN")}${post.tags?.length ? ' · <span class="tags">' + tagsHtml + '</span>' : ''}</div>
${html}
</article>
<footer>Generated by Sakura Nav · ${new Date().toLocaleDateString("zh-CN")}</footer>
</div></body></html>`;
  }

  function renderIndexHtml(posts) {
    const items = posts.map((p) => {
      const fname = slugify(p.title) + "-" + p.id.slice(0, 6) + ".html";
      const excerpt = (p.content || "").replace(/[#*`>\-!\[\]()]/g, "").slice(0, 120).trim();
      const tagsHtml = (p.tags || []).map((t) => `<span>${esc(t)}</span>`).join("");
      return `<li>
  <a href="${esc(fname)}">${esc(p.title)}</a>
  <div class="meta">${new Date(p.createdAt || Date.now()).toLocaleDateString("zh-CN")} ${tagsHtml ? '· <span class="tags">' + tagsHtml + '</span>' : ''}</div>
  <div class="excerpt">${esc(excerpt)}…</div>
</li>`;
    }).join("");

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>樱 · 博客</title>
<link rel="stylesheet" href="style.css" />
<link rel="alternate" type="application/rss+xml" href="rss.xml" /></head>
<body><div class="wrap">
<header class="site"><a href="index.html">🌸 樱 · 博客</a><a href="rss.xml">RSS</a></header>
<h1>全部文章（${posts.length}）</h1>
<ul class="post-list">${items}</ul>
<footer>Generated by Sakura Nav · ${new Date().toLocaleDateString("zh-CN")}</footer>
</div></body></html>`;
  }

  function buildStaticSite(opts = {}) {
    const posts = (window.Blog?.list?.(false) || []);
    const files = [
      { name: "style.css", data: STATIC_CSS },
      { name: "index.html", data: renderIndexHtml(posts) },
      { name: "rss.xml", data: buildRss(opts) },
    ];
    for (const p of posts) {
      const fname = slugify(p.title) + "-" + p.id.slice(0, 6) + ".html";
      files.push({ name: fname, data: renderPostHtml(p) });
    }
    return zip(files);
  }

  window.Exporter = { crc32, zip, buildRss, buildStaticSite };
})();
