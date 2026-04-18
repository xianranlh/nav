/**
 * 樱 · 音乐统一 API（Node）
 * GET /api/music/search  /api/music/url  /api/music/lyric
 * 第一期：酷我 kw（搜索 + antiserver 直链）
 */
import express from "express";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const UA = "Mozilla/5.0 (compatible; SakuraNav-MusicAPI/1.0)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 咪咕 listen-url 接口要求 channel 头（与官方 H5 一致） */
const MIGU_CHANNEL = "014X031";

app.disable("x-powered-by");

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok\n");
});

async function searchKuwo(q, page, pageSize) {
  const pn = page - 1;
  const upstream = new URL("https://search.kuwo.cn/r.s");
  upstream.searchParams.set("ft", "music");
  upstream.searchParams.set("itemset", "web_2013");
  upstream.searchParams.set("client", "kt");
  upstream.searchParams.set("encoding", "utf8");
  upstream.searchParams.set("rformat", "json");
  upstream.searchParams.set("vermerge", "1");
  upstream.searchParams.set("mobi", "1");
  upstream.searchParams.set("rn", String(pageSize));
  upstream.searchParams.set("pn", String(pn));
  upstream.searchParams.set("all", q);

  const r = await fetch(upstream.toString(), { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`上游搜索 HTTP ${r.status}`);
  const data = await r.json();
  const abslist = Array.isArray(data.abslist) ? data.abslist : [];
  const total = data.TOTAL != null ? Number(data.TOTAL) : null;

  const items = abslist
    .map((raw) => {
      const rid = raw.MUSICRID != null ? String(raw.MUSICRID) : "";
      const id = rid || (raw.DC_TARGETID != null ? String(raw.DC_TARGETID) : "");
      const sec = parseInt(raw.DURATION, 10);
      return {
        platform: "kw",
        id,
        name: String(raw.SONGNAME || raw.NAME || "").trim() || "未知",
        artists: String(raw.ARTIST || "").trim(),
        album: String(raw.ALBUM || "").trim(),
        durationMs: Number.isFinite(sec) && sec >= 0 ? sec * 1000 : null,
        extra: { musicRid: rid },
      };
    })
    .filter((x) => x.id);

  return {
    items,
    page,
    pageSize,
    total,
    isEnd: items.length < pageSize,
  };
}

/** 网易云音乐 web 搜索 */
async function searchNetease(q, page, pageSize) {
  const offset = (page - 1) * pageSize;
  const upstream = new URL("https://music.163.com/api/search/get/web");
  upstream.searchParams.set("s", q);
  upstream.searchParams.set("type", "1");
  upstream.searchParams.set("offset", String(offset));
  upstream.searchParams.set("limit", String(pageSize));

  const r = await fetch(upstream.toString(), {
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: "https://music.163.com/",
      Accept: "application/json, text/plain, */*",
    },
  });
  if (!r.ok) throw new Error(`网易云搜索 HTTP ${r.status}`);
  const j = await r.json();
  const songs = Array.isArray(j.result?.songs) ? j.result.songs : [];
  const total = j.result?.songCount != null ? Number(j.result.songCount) : null;

  const items = songs
    .map((s) => ({
      platform: "wy",
      id: String(s.id),
      name: String(s.name || "").trim() || "未知",
      artists: Array.isArray(s.artists) ? s.artists.map((a) => a.name).filter(Boolean).join(" / ") : "",
      album: s.album?.name != null ? String(s.album.name) : "",
      durationMs: typeof s.duration === "number" ? s.duration : null,
      extra: {},
    }))
    .filter((x) => x.id);

  return {
    items,
    page,
    pageSize,
    total,
    isEnd: items.length < pageSize,
  };
}

/** QQ 音乐（公开 JSON 接口，仅搜索；播放链接需单独解析能力） */
async function searchQQ(q, page, pageSize) {
  const upstream = new URL("https://c.y.qq.com/soso/fcgi-bin/client_search_cp");
  upstream.searchParams.set("aggr", "1");
  upstream.searchParams.set("lossless", "0");
  upstream.searchParams.set("flag_qc", "0");
  upstream.searchParams.set("p", String(page));
  upstream.searchParams.set("n", String(pageSize));
  upstream.searchParams.set("w", q);
  upstream.searchParams.set("format", "json");

  const r = await fetch(upstream.toString(), {
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: "https://y.qq.com/",
      Accept: "application/json, text/plain, */*",
    },
  });
  if (!r.ok) throw new Error(`QQ 搜索 HTTP ${r.status}`);
  const j = await r.json();
  const list = Array.isArray(j.data?.song?.list) ? j.data.song.list : [];
  const total = j.data?.song?.totalnum != null ? Number(j.data.song.totalnum) : null;

  const items = list
    .map((s) => ({
      platform: "tx",
      id: String(s.songmid || ""),
      name: String(s.songname || "").trim() || "未知",
      artists: Array.isArray(s.singer) ? s.singer.map((x) => x.name).filter(Boolean).join(" / ") : "",
      album: s.albumname != null ? String(s.albumname) : "",
      durationMs: typeof s.interval === "number" ? s.interval * 1000 : null,
      extra: { songid: s.songid },
    }))
    .filter((x) => x.id);

  return {
    items,
    page,
    pageSize,
    total,
    isEnd: items.length < pageSize,
  };
}

/** 酷狗 Web 搜索 */
async function searchKugou(q, page, pageSize) {
  const upstream = new URL("https://songsearch.kugou.com/song_search_v2");
  upstream.searchParams.set("keyword", q);
  upstream.searchParams.set("page", String(page));
  upstream.searchParams.set("pagesize", String(pageSize));
  upstream.searchParams.set("userid", "0");
  upstream.searchParams.set("platform", "WebFilter");

  const r = await fetch(upstream.toString(), {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json, text/plain, */*",
      Referer: "https://www.kugou.com/",
    },
  });
  if (!r.ok) throw new Error(`酷狗搜索 HTTP ${r.status}`);
  const j = await r.json();
  const lists = Array.isArray(j.data?.lists) ? j.data.lists : [];
  const total = j.data?.total != null ? Number(j.data.total) : null;

  const items = lists
    .map((raw) => {
      const hash = raw.FileHash != null ? String(raw.FileHash) : "";
      if (!hash) return null;
      const sec = parseInt(raw.Duration ?? raw.HQDuration ?? raw.timeLength, 10);
      return {
        platform: "kg",
        id: hash,
        name: String(raw.SongName || raw.OriSongName || "").trim() || "未知",
        artists: String(raw.SingerName || "").trim(),
        album: String(raw.AlbumName || "").trim(),
        durationMs: Number.isFinite(sec) && sec >= 0 ? sec * 1000 : null,
        extra: { mixSongId: raw.MixSongID != null ? String(raw.MixSongID) : "" },
      };
    })
    .filter(Boolean);

  return {
    items,
    page,
    pageSize,
    total,
    isEnd: items.length < pageSize,
  };
}

/** 咪咕（音乐 app 聚合搜索接口） */
async function searchMigu(q, page, pageSize) {
  const searchSwitch = JSON.stringify({
    song: 1,
    album: 0,
    singer: 0,
    tagSong: 1,
    mvSong: 0,
    bestShow: 1,
  });
  const u = new URL("https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do");
  u.searchParams.set("ua", "Android_migu");
  u.searchParams.set("version", "5.0.1");
  u.searchParams.set("text", q);
  u.searchParams.set("pageNo", String(page));
  u.searchParams.set("pageSize", String(pageSize));
  u.searchParams.set("searchSwitch", searchSwitch);

  const r = await fetch(u.toString(), {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json, text/plain, */*",
      Referer: "https://music.migu.cn/",
    },
  });
  if (!r.ok) throw new Error(`咪咕搜索 HTTP ${r.status}`);
  const j = await r.json();
  if (j.code && j.code !== "000000") {
    throw new Error(String(j.info || "咪咕搜索失败"));
  }
  const results = Array.isArray(j.songResultData?.result) ? j.songResultData.result : [];
  const total = j.songResultData?.totalCount != null ? Number(j.songResultData.totalCount) : null;

  const items = results
    .map((raw) => {
      const copyrightId = raw.copyrightId != null ? String(raw.copyrightId) : "";
      const contentId = raw.contentId != null ? String(raw.contentId) : "";
      if (!copyrightId || !contentId) return null;
      const id = `${copyrightId}|${contentId}`;
      const artists = Array.isArray(raw.singers)
        ? raw.singers.map((s) => (s && s.name ? String(s.name) : "")).filter(Boolean).join(" / ")
        : "";
      const album =
        Array.isArray(raw.albums) && raw.albums[0] && raw.albums[0].name != null
          ? String(raw.albums[0].name)
          : "";
      let durationMs = null;
      if (raw.duration != null) {
        const ds = parseInt(String(raw.duration), 10);
        if (Number.isFinite(ds) && ds > 0) durationMs = ds * 1000;
      }
      return {
        platform: "mg",
        id,
        name: String(raw.name || "").trim() || "未知",
        artists,
        album,
        durationMs,
        extra: { copyrightId, contentId },
      };
    })
    .filter(Boolean);

  return {
    items,
    page,
    pageSize,
    total,
    isEnd: items.length < pageSize,
  };
}

/** 聚合：多源结果交错合并（每条仍保留原 platform，便于解析试听） */
async function searchMix(q, page, pageSize) {
  const n = Math.max(4, Math.ceil(pageSize / 5));
  const settled = await Promise.allSettled([
    searchKuwo(q, page, n),
    searchNetease(q, page, n),
    searchQQ(q, page, n),
    searchKugou(q, page, n),
    searchMigu(q, page, n),
  ]);
  const buckets = settled.filter((x) => x.status === "fulfilled").map((x) => x.value.items);
  const interleaved = [];
  let idx = 0;
  while (interleaved.length < pageSize) {
    let added = false;
    for (const b of buckets) {
      if (b[idx]) {
        interleaved.push(b[idx]);
        added = true;
        if (interleaved.length >= pageSize) break;
      }
    }
    if (!added) break;
    idx++;
  }
  return {
    items: interleaved,
    page,
    pageSize,
    total: null,
    isEnd: interleaved.length < pageSize,
  };
}

app.get("/api/music/search", async (req, res) => {
  try {
    const platform = String(req.query.platform || "kw").toLowerCase();
    const q = String(req.query.q || "").trim();
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || "25"), 10) || 25));

    if (!q) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "缺少参数 q" } });
    }

    if (platform === "kw") {
      return res.json(await searchKuwo(q, page, pageSize));
    }
    if (platform === "wy") {
      return res.json(await searchNetease(q, page, pageSize));
    }
    if (platform === "tx") {
      return res.json(await searchQQ(q, page, pageSize));
    }
    if (platform === "kg") {
      return res.json(await searchKugou(q, page, pageSize));
    }
    if (platform === "mg") {
      return res.json(await searchMigu(q, page, pageSize));
    }
    if (platform === "mix") {
      return res.json(await searchMix(q, page, pageSize));
    }

    return res.status(501).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: `平台「${platform}」暂未接入搜索`,
      },
    });
  } catch (e) {
    return res.status(500).json({
      error: { code: "SEARCH_FAILED", message: String(e.message || e) },
    });
  }
});

async function resolveNeteasePlayUrl(rawId) {
  const num = String(rawId || "").replace(/\D/g, "");
  if (!num) throw new Error("无效的歌曲 id");

  const api = `https://music.163.com/song/media/outer/url?id=${num}&br=128000`;
  const r = await fetch(api, {
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: "https://music.163.com/",
      Accept: "application/json, audio/mpeg, audio/*, */*",
    },
    redirect: "manual",
  });

  if (r.status === 301 || r.status === 302 || r.status === 303 || r.status === 307 || r.status === 308) {
    const loc = r.headers.get("location");
    if (loc && /^https?:\/\//i.test(loc)) return loc.trim();
  }

  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    const j = await r.json();
    const u = j.data?.[0]?.url;
    if (u && /^https?:\/\//i.test(String(u))) return String(u).trim();
  }

  throw new Error("网易云未返回有效播放链接（可能为版权/会员限制）");
}

/** 咪咕：listen-url 返回播放直链与歌词链接 */
async function fetchMiguListenData(copyrightId, contentId) {
  const listenUrl = new URL("https://c.musicapp.migu.cn/MIGUM3.0/strategy/listen-url/v2.4");
  listenUrl.searchParams.set("resourceType", "2");
  listenUrl.searchParams.set("netType", "01");
  listenUrl.searchParams.set("toneFlag", "PQ");
  listenUrl.searchParams.set("contentId", contentId);
  listenUrl.searchParams.set("copyrightId", copyrightId);
  listenUrl.searchParams.set("lowerQualityContentId", contentId);

  const r = await fetch(listenUrl.toString(), {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json, text/plain, */*",
      channel: MIGU_CHANNEL,
      Referer: "https://y.migu.cn/",
    },
  });
  if (!r.ok) throw new Error(`咪咕解析 HTTP ${r.status}`);
  const j = await r.json();
  if (j.code !== "000000") {
    throw new Error(String(j.info || "咪咕解析失败"));
  }
  return j.data && typeof j.data === "object" ? j.data : {};
}

app.get("/api/music/url", async (req, res) => {
  try {
    const platform = String(req.query.platform || "kw").toLowerCase();
    let id = String(req.query.id || "").trim();
    const _quality = String(req.query.quality || "128k");

    if (!id) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "缺少参数 id" } });
    }

    if (platform === "kw") {
      if (!id.startsWith("MUSIC_")) id = `MUSIC_${id}`;

      const upstream = new URL("https://antiserver.kuwo.cn/anti.s");
      upstream.searchParams.set("type", "convert_url");
      upstream.searchParams.set("format", "mp3");
      upstream.searchParams.set("rid", id);

      const r = await fetch(upstream.toString(), { headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error(`上游解析 HTTP ${r.status}`);
      const text = (await r.text()).trim();
      if (!/^https?:\/\//i.test(text)) {
        return res.status(502).json({
          error: { code: "URL_RESOLVE_FAILED", message: "上游未返回有效直链" },
        });
      }
      return res.json({ url: text, mime: "audio/mpeg", expiresAt: null });
    }

    if (platform === "wy") {
      const url = await resolveNeteasePlayUrl(id);
      return res.json({ url, mime: "audio/mpeg", expiresAt: null });
    }

    if (platform === "tx") {
      return res.status(501).json({
        error: {
          code: "NOT_IMPLEMENTED",
          message: "QQ 音乐试听解析未接入（需 vkey 等签名接口）。请改用酷我或网易云结果，或仅使用本列表查看曲目信息。",
        },
      });
    }

    if (platform === "kg") {
      const hash = String(id).trim();
      if (!/^[0-9a-fA-F]{32}$/.test(hash)) {
        return res.status(400).json({ error: { code: "BAD_REQUEST", message: "酷狗歌曲 id 应为 32 位 FileHash" } });
      }
      const r = await fetch(`https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`, {
        headers: {
          "User-Agent": BROWSER_UA,
          Referer: "https://m.kugou.com/",
          Accept: "application/json, text/plain, */*",
        },
      });
      if (!r.ok) throw new Error(`酷狗解析 HTTP ${r.status}`);
      const j = await r.json();
      const playUrl = typeof j.url === "string" && /^https?:\/\//i.test(j.url) ? j.url.trim() : "";
      if (!playUrl) {
        return res.status(502).json({
          error: {
            code: "URL_RESOLVE_FAILED",
            message: String(j.error || "酷狗未返回可用链接（可能需付费或版权限制）"),
          },
        });
      }
      return res.json({ url: playUrl, mime: "audio/mpeg", expiresAt: null });
    }

    if (platform === "mg") {
      const parts = String(id).split("|");
      const copyrightId = parts[0]?.trim();
      const contentId = parts[1]?.trim();
      if (!copyrightId || !contentId) {
        return res.status(400).json({
          error: { code: "BAD_REQUEST", message: "咪咕 id 格式应为 copyrightId|contentId" },
        });
      }
      try {
        const data = await fetchMiguListenData(copyrightId, contentId);
        const playUrl = typeof data.url === "string" && /^https?:\/\//i.test(data.url) ? data.url.trim() : "";
        if (!playUrl) {
          return res.status(502).json({ error: { code: "URL_RESOLVE_FAILED", message: "咪咕未返回播放链接" } });
        }
        return res.json({ url: playUrl, mime: "audio/mpeg", expiresAt: null });
      } catch (err) {
        return res.status(502).json({
          error: { code: "URL_RESOLVE_FAILED", message: String(err.message || err) },
        });
      }
    }

    return res.status(501).json({
      error: { code: "NOT_IMPLEMENTED", message: `平台「${platform}」暂未接入解析` },
    });
  } catch (e) {
    return res.status(500).json({
      error: { code: "URL_FAILED", message: String(e.message || e) },
    });
  }
});

function isPrivateHostname(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || h === "::1") return true;
  // Basic IPv4 private ranges (best-effort without DNS resolution)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split(".").map((x) => parseInt(x, 10));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

/**
 * 同源音频流代理：解决上游直链无 CORS 导致 <audio> 播放失败。
 * 支持 Range，允许拖动进度条。
 *
 * GET /api/music/stream?u=<encodeURIComponent(url)>
 */
app.get("/api/music/stream", async (req, res) => {
  try {
    const u = String(req.query.u || "").trim();
    if (!u) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "缺少参数 u" } });

    let target;
    try {
      target = new URL(u);
    } catch {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "参数 u 不是合法 URL" } });
    }
    if (!/^https?:$/.test(target.protocol)) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "仅支持 http/https" } });
    }
    if (isPrivateHostname(target.hostname)) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "禁止代理内网/本机地址" } });
    }

    let referer = "https://www.kuwo.cn/";
    const host = target.hostname.toLowerCase();
    if (host.includes("126.net") || host.includes("music.126") || host.endsWith("163.com")) {
      referer = "https://music.163.com/";
    } else if (host.includes("qq.com") || host.includes("qcloud.com") || host.includes("gtimg.com")) {
      referer = "https://y.qq.com/";
    } else if (host.includes("kugou.com")) {
      referer = "https://www.kugou.com/";
    } else if (host.includes("migu.cn") || host.includes("migu.com")) {
      referer = "https://y.migu.cn/";
    }

    const headers = {
      "User-Agent": BROWSER_UA,
      Accept: "*/*",
      Referer: referer,
    };
    const range = req.headers.range;
    if (range) headers.Range = range;

    const r = await fetch(target.toString(), { headers });
    if (!r.ok && r.status !== 206) {
      return res.status(502).json({
        error: { code: "STREAM_FAILED", message: `上游音频 HTTP ${r.status}` },
      });
    }

    // Mirror important headers for media playback
    const passHeaders = [
      "content-type",
      "content-length",
      "accept-ranges",
      "content-range",
      "cache-control",
      "etag",
      "last-modified",
    ];
    for (const k of passHeaders) {
      const v = r.headers.get(k);
      if (v) res.setHeader(k, v);
    }
    // Same-origin already avoids CORS; still safe for dev tools / fetch.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-expose-headers", "content-length,content-range,accept-ranges,content-type");

    res.status(r.status);
    if (!r.body) return res.end();

    // Stream body to client
    const reader = r.body.getReader();
    const pump = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    pump().catch(() => {
      try { res.end(); } catch (_) {}
    });
  } catch (e) {
    return res.status(500).json({
      error: { code: "STREAM_FAILED", message: String(e.message || e) },
    });
  }
});

function kuwoNumericId(raw) {
  const s = String(raw || "").trim();
  const n = s.replace(/^MUSIC_/i, "");
  return /^\d+$/.test(n) ? n : "";
}

/** 酷我 lrclist（行 + 秒）→ LRC 文本 */
function lrclistToLrc(list) {
  if (!Array.isArray(list) || !list.length) return "";
  const out = [];
  for (const row of list) {
    const txt = String(row.lineLyric ?? row.word ?? "").trim();
    if (!txt) continue;
    let sec = parseFloat(row.time);
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const mm = Math.floor(sec / 60);
    const ss = sec - mm * 60;
    const whole = Math.floor(ss);
    const cent = Math.min(99, Math.round((ss - whole) * 100));
    out.push(
      `[${String(mm).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(cent).padStart(2, "0")}]${txt}`,
    );
  }
  return out.join("\n");
}

function pickLrcFromKuwoJson(j) {
  if (!j || typeof j !== "object") return "";
  const tryStr = (v) => (typeof v === "string" && v.trim().length ? v.trim() : "");
  let s = tryStr(j.lyric) || tryStr(j.lrctxt) || tryStr(j.lrc);
  if (s) return s;
  const dig = (obj, depth) => {
    if (!obj || typeof obj !== "object" || depth > 4) return "";
    s = tryStr(obj.lyric) || tryStr(obj.lrctxt) || tryStr(obj.lrc);
    if (s) return s;
    if (Array.isArray(obj.lrclist) && obj.lrclist.length) {
      s = lrclistToLrc(obj.lrclist);
      if (s) return s;
    }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && typeof v === "object") {
        s = dig(v, depth + 1);
        if (s) return s;
      }
    }
    return "";
  };
  return dig(j, 0);
}

app.get("/api/music/lyric", async (req, res) => {
  try {
    const platform = String(req.query.platform || "kw").toLowerCase();
    const id = String(req.query.id || "").trim();

    if (platform === "wy") {
      const num = String(id).replace(/\D/g, "");
      if (!num) return res.json({ lrc: "" });
      const r = await fetch(`https://music.163.com/api/song/lyric?id=${num}&lv=1&kv=1&tv=-1`, {
        headers: {
          "User-Agent": BROWSER_UA,
          Referer: "https://music.163.com/",
          Accept: "application/json, text/plain, */*",
        },
      });
      if (!r.ok) return res.json({ lrc: "" });
      const j = await r.json();
      const lrc = typeof j.lrc?.lyric === "string" ? j.lrc.lyric : "";
      return res.json({ lrc });
    }

    if (platform === "mg") {
      const parts = String(id).split("|");
      const copyrightId = parts[0]?.trim();
      const contentId = parts[1]?.trim();
      if (!copyrightId || !contentId) return res.json({ lrc: "" });
      try {
        const data = await fetchMiguListenData(copyrightId, contentId);
        const lrcUrl = typeof data.lrcUrl === "string" && /^https?:\/\//i.test(data.lrcUrl) ? data.lrcUrl.trim() : "";
        if (!lrcUrl) return res.json({ lrc: "" });
        const lr = await fetch(lrcUrl, {
          headers: {
            "User-Agent": BROWSER_UA,
            Referer: "https://y.migu.cn/",
            Accept: "text/plain, application/json, */*",
          },
        });
        if (!lr.ok) return res.json({ lrc: "" });
        const text = await lr.text();
        return res.json({ lrc: text || "" });
      } catch {
        return res.json({ lrc: "" });
      }
    }

    if (platform === "tx" || platform === "kg" || platform === "mix") {
      return res.json({ lrc: "" });
    }

    if (platform !== "kw") {
      return res.status(501).json({ error: { code: "NOT_IMPLEMENTED", message: "歌词暂未接入" } });
    }

    const num = kuwoNumericId(id);
    if (!num) return res.json({ lrc: "" });

    const headers = {
      "User-Agent": UA,
      Referer: "https://www.kuwo.cn/",
      Accept: "application/json, text/plain, */*",
    };

    const candidates = [
      `https://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${num}`,
      `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${num}`,
      `https://www.kuwo.cn/api/www/music/musicInfo?mid=MUSIC_${num}`,
    ];

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);

    try {
      for (const u of candidates) {
        try {
          const r = await fetch(u, { headers, signal: ctl.signal });
          if (!r.ok) continue;
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          let j;
          if (ct.includes("json")) {
            j = await r.json();
          } else {
            const text = (await r.text()).trim();
            if (!text.startsWith("{")) continue;
            try {
              j = JSON.parse(text);
            } catch {
              continue;
            }
          }
          const lrc = pickLrcFromKuwoJson(j);
          if (lrc) return res.json({ lrc });
        } catch {
          /* 尝试下一上游 */
        }
      }
      return res.json({ lrc: "" });
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    return res.status(500).json({
      error: { code: "LYRIC_FAILED", message: String(e.message || e) },
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[music-api] listening on :${PORT}`);
});
