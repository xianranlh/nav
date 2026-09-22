/**
 * TuneFree 同款 GD 音乐台客户端。
 * 公开接口：https://music.gdstudio.xyz/ （CC BY-NC 4.0）
 *
 * 平台能力以 TuneFree 2026-09 核验为准：
 *   wy  搜索走曲库，播放 / 歌词 / 封面可用
 *   kw  歌词 / 封面可用，播放地址由内置解析或跨源兜底
 *   joox 搜索 / 歌词 / 封面可用，播放走跨源兜底
 */
import crypto from "node:crypto";

export const GD_SOURCE_ID = "builtin-gd";
export const GD_API_URL = "https://music-api.gdstudio.xyz/api.php";
export const GD_TIME_URL = "https://music-api.gdstudio.xyz/time";
export const GD_SIGN_HOST = "music.gdstudio.org";
export const GD_SIGN_SALT = "20260616";
export const GD_HOMEPAGE = "https://music.gdstudio.xyz/";

const REQUEST_TIMEOUT_MS = 12000;
const TIME_SYNC_TIMEOUT_MS = 5000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const BITRATE = { "128k": "128", "320k": "320", flac: "740", flac24bit: "999" };
const QUALITYS = ["128k", "320k", "flac", "flac24bit"];

/** nav 平台 id → GD API source */
export const GD_API_SOURCE = {
  wy: "netease",
  kw: "kuwo",
  joox: "joox",
};

export const GD_PLATFORM_ACTIONS = {
  wy: ["musicUrl", "lyric", "pic"],
  kw: ["lyric", "pic"],
  joox: ["lyric", "pic", "search"],
};

const GD_PLATFORM_NAMES = {
  wy: "网易云音乐",
  kw: "酷我音乐",
  joox: "JOOX",
};

let timeDiff = 0;
let timeSynced = false;
let timeSyncPromise = null;

export function toGdApiSource(source) {
  const s = String(source || "").trim().toLowerCase();
  if (s === "qq" || s === "tx") return "tencent";
  return GD_API_SOURCE[s] || s;
}

export function fromGdApiSource(source) {
  const s = String(source || "").trim().toLowerCase();
  if (s === "netease") return "wy";
  if (s === "kuwo") return "kw";
  if (s === "tencent" || s === "qq") return "tx";
  if (s === "joox") return "joox";
  return s;
}

export function gdBitrate(quality) {
  return BITRATE[quality] || "320";
}

export function classifyGdFailure(status, text) {
  const raw = String(text || "");
  if (/source.+not supported/i.test(raw)) return "UNSUPPORTED_SOURCE";
  if (Number(status) === 429 || /频率|rate limit|too many requests/i.test(raw)) return "RATE_LIMIT";
  if (Number(status) === 403 && /__cf_chl_|Just a moment|cf-browser-verification/i.test(raw)) return "RATE_LIMIT";
  return Number(status) >= 400 ? "UNAVAILABLE" : "BAD_RESPONSE";
}

export function gdCan(platform, action) {
  const acts = GD_PLATFORM_ACTIONS[platform];
  return Array.isArray(acts) && acts.includes(action);
}

function gdPlatforms() {
  return Object.fromEntries(Object.entries(GD_PLATFORM_NAMES).map(([id, name]) => [id, {
    name,
    type: "music",
    actions: GD_PLATFORM_ACTIONS[id] || [],
    qualitys: (GD_PLATFORM_ACTIONS[id] || []).includes("musicUrl") ? QUALITYS : [],
  }]));
}

export function gdSourceRecord(enabled = true) {
  return {
    id: GD_SOURCE_ID,
    type: "builtin-gd",
    name: "GD音乐台",
    description: "TuneFree 同款公开接口，网易可播，酷我 / JOOX 提供歌词与跨源兜底",
    version: "1.0.0",
    author: "GD Studio",
    homepage: GD_HOMEPAGE,
    enabled: enabled !== false,
    builtin: true,
    createdAt: 0,
    platforms: gdPlatforms(),
  };
}

export function publicGdSource(enabled = true) {
  const rec = gdSourceRecord(enabled);
  return {
    id: rec.id,
    name: rec.name,
    type: rec.type,
    enabled: rec.enabled,
    createdAt: rec.createdAt,
    description: rec.description,
    version: rec.version,
    author: rec.author,
    homepage: rec.homepage,
    apiBase: "",
    preset: "",
    updateAlert: null,
    builtin: true,
    platforms: rec.platforms,
  };
}

function gdUrlEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

export function buildGdSignature(params, timestampMs) {
  const prefix = String(timestampMs).slice(0, 9);
  const subject = params.name !== undefined
    ? gdUrlEncode(params.name)
    : gdUrlEncode(params.id === undefined ? params.types : params.id);
  return crypto.createHash("md5")
    .update(`${prefix}|${GD_SIGN_HOST}|${GD_SIGN_SALT}|${subject}`)
    .digest("hex");
}

export function buildGdRequestBody(params, timestampMs) {
  const hash = buildGdSignature(params, timestampMs);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (key === "s" || value === undefined || value === null) continue;
    body.set(key, key === "source" ? toGdApiSource(String(value)) : String(value));
  }
  body.set("s", params?.s ? String(params.s) : hash.slice(-8).toUpperCase());
  return body;
}

function countReplacement(text) {
  return (String(text).match(/\uFFFD/g) || []).length;
}

export function decodeGdResponseText(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const utf8 = bytes.toString("utf8");
  try {
    const gbk = new TextDecoder("gb18030").decode(bytes);
    return countReplacement(gbk) < countReplacement(utf8) ? gbk : utf8;
  } catch (_) {
    return utf8;
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (init?.signal) {
    if (init.signal.aborted) ctrl.abort(init.signal.reason);
    else init.signal.addEventListener("abort", () => ctrl.abort(init.signal.reason), { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function syncServerTime(signal) {
  if (timeSynced) return;
  if (!timeSyncPromise) {
    timeSyncPromise = (async () => {
      const started = Date.now();
      try {
        const response = await fetchWithTimeout(GD_TIME_URL, {
          method: "GET",
          headers: { "user-agent": UA },
          signal,
        }, TIME_SYNC_TIMEOUT_MS);
        const text = (await response.text()).trim();
        const serverTime = Number(text);
        if (response.ok && Number.isFinite(serverTime) && serverTime > 0) {
          timeDiff = serverTime * 1000 - (started + (Date.now() - started) / 2);
          timeSynced = true;
        }
      } catch (_) {
        /* 同步失败就用本地时间 */
      }
    })().finally(() => { timeSyncPromise = null; });
  }
  return timeSyncPromise;
}

export function resetGdTimeSync() {
  timeDiff = 0;
  timeSynced = false;
  timeSyncPromise = null;
}

export async function gdCall(params, signal) {
  await syncServerTime(signal);
  const body = buildGdRequestBody(params, Date.now() + timeDiff);
  const response = await fetchWithTimeout(GD_API_URL, {
    method: "POST",
    headers: {
      "user-agent": UA,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: body.toString(),
    signal,
  }, REQUEST_TIMEOUT_MS);
  const text = decodeGdResponseText(await response.arrayBuffer());
  let data = text;
  const trimmed = text.trim();
  if (/^[{[]/.test(trimmed)) {
    try { data = JSON.parse(trimmed); } catch (_) {}
  }
  const detail = data && typeof data === "object"
    ? (data.detail || data.error)
    : "";
  if (!response.ok || (typeof detail === "string" && detail)) {
    const msg = typeof detail === "string" && detail ? detail : text.slice(0, 240);
    const err = new Error(msg || ("GD 接口 HTTP " + response.status));
    err.code = classifyGdFailure(response.status, msg);
    err.status = response.status;
    throw err;
  }
  return data;
}

function pickId(track, key) {
  const value = track?.[key];
  if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  return track?.id == null ? "" : String(track.id).trim();
}

export function normalizeGdTrack(apiSource, track) {
  if (!track || typeof track !== "object" || Array.isArray(track)) return null;
  const id = pickId(track, "id");
  const name = typeof track.name === "string" ? track.name.trim() : "";
  if (!id || !name) return null;
  const artist = Array.isArray(track.artist) ? track.artist.filter(Boolean).join(" / ") : String(track.artist || "");
  const platform = fromGdApiSource(apiSource);
  return {
    platform,
    id,
    name,
    artists: artist,
    album: typeof track.album === "string" ? track.album : "",
    durationMs: null,
    extra: {
      urlId: pickId(track, "url_id"),
      lyricId: pickId(track, "lyric_id"),
      picId: typeof track.pic_id === "string" ? track.pic_id.trim() : "",
    },
  };
}

export async function gdSearch(platform, keyword, page = 1, pageSize = 25, signal) {
  const source = toGdApiSource(platform);
  if (!source) return { items: [], total: 0, isEnd: true, error: "unsupported platform" };
  const data = await gdCall({
    types: "search",
    source,
    name: keyword || "",
    count: pageSize || 25,
    pages: page || 1,
  }, signal);
  if (!Array.isArray(data)) throw new Error("GD 搜索返回格式异常");
  const items = [];
  const seen = new Set();
  for (const row of data) {
    const song = normalizeGdTrack(source, row);
    if (song && !seen.has(song.id)) {
      seen.add(song.id);
      items.push(song);
    }
  }
  return { items, page, pageSize, total: items.length, isEnd: items.length < pageSize };
}

export async function gdMusicUrl(platform, id, quality = "320k", extra = {}, signal) {
  if (!gdCan(platform, "musicUrl")) throw new Error("GD 公开接口目前不提供该平台播放地址");
  const data = await gdCall({
    types: "url",
    source: toGdApiSource(platform),
    id: extra.urlId || extra.songmid || id,
    br: gdBitrate(quality),
  }, signal);
  const url = data && typeof data.url === "string" ? data.url.trim() : "";
  if (!url) throw new Error("GD 未返回可用音频");
  return url;
}

export async function gdLyric(platform, id, extra = {}, signal) {
  if (!gdCan(platform, "lyric")) return "";
  const data = await gdCall({
    types: "lyric",
    source: toGdApiSource(platform),
    id: extra.lyricId || extra.songmid || id,
  }, signal);
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  return data;
}
