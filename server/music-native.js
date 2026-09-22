/**
 * TuneFree 同款内置解析：网易 EAPI、QQ vkey、酷我 convert_url。
 * 协议常量来自各端公开客户端，VIP / 无版权曲目返回空。
 */
import crypto from "node:crypto";

export const NATIVE_SOURCE_ID = "builtin-native";
export const NATIVE_PLATFORMS = ["wy", "tx", "kw"];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1";
const TIMEOUT_MS = 8000;

const EAPI_KEY = Buffer.from("e82ckenh8dichen8");
const EAPI_SEP = "36cd479b6b5";
const EAPI_PATH = "/api/song/enhance/player/url";
const EAPI_URL = "https://interface3.music.163.com/eapi/song/enhance/player/url";
const QQ_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const QQ_STREAM = "https://ws.stream.qqmusic.qq.com/";
const KUWO_KEY = "ylzsxkwm";
const KUWO_MOBI = "https://mobi.kuwo.cn/mobi.s?f=kuwo&q=";

const QUALITYS = ["128k", "320k", "flac"];

export function nativeCan(platform, action = "musicUrl") {
  return action === "musicUrl" && NATIVE_PLATFORMS.includes(platform);
}

export function nativeSourceRecord(enabled = true) {
  const plats = {
    wy: { name: "网易云音乐", type: "music", actions: ["musicUrl"], qualitys: QUALITYS },
    tx: { name: "QQ 音乐", type: "music", actions: ["musicUrl"], qualitys: QUALITYS },
    kw: { name: "酷我音乐", type: "music", actions: ["musicUrl"], qualitys: QUALITYS },
  };
  return {
    id: NATIVE_SOURCE_ID,
    type: "builtin-native",
    name: "内置解析",
    description: "TuneFree 同款：网易 / QQ / 酷我公开接口拿播放地址",
    version: "1.0.0",
    author: "TuneFree",
    homepage: "https://github.com/alanbulan/TuneFree",
    enabled: enabled !== false,
    builtin: true,
    createdAt: 1,
    platforms: plats,
  };
}

export function publicNativeSource(enabled = true) {
  const rec = nativeSourceRecord(enabled);
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

async function fetchText(url, { method = "GET", headers = {}, body, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers: { "user-agent": UA, ...headers }, body, signal: ctrl.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function httpUrl(raw) {
  const s = String(raw || "").trim();
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch (_) {
    return "";
  }
}

export function parseNeteaseUrl(data) {
  const url = httpUrl(data?.data?.[0]?.url);
  if (!url) {
    const err = new Error("VIP/Copyright protected content");
    err.code = "VIP";
    throw err;
  }
  return url;
}

export function neteaseBr(quality) {
  if (quality === "320k") return 320000;
  if (quality === "flac" || quality === "flac24bit") return 999000;
  return 128000;
}

export function encryptNeteaseParams(songId, quality) {
  const payload = `{"ids":"[${songId}]","br":${neteaseBr(quality)}}`;
  const digest = crypto.createHash("md5")
    .update(`nobody${EAPI_PATH}use${payload}md5forencrypt`)
    .digest("hex");
  const plain = `${EAPI_PATH}-${EAPI_SEP}-${payload}-${EAPI_SEP}-${digest}`;
  const cipher = crypto.createCipheriv("aes-128-ecb", EAPI_KEY, null);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return enc.toString("hex").toUpperCase();
}

async function neteaseUrl(id, quality) {
  const params = encryptNeteaseParams(id, quality);
  const { text } = await fetchText(EAPI_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "os=pc;" },
    body: "params=" + params,
  });
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error("网易解析响应异常"); }
  return parseNeteaseUrl(data);
}

export function buildQqFilename(songmid, quality) {
  if (quality === "320k") return `M800${songmid}${songmid}.mp3`;
  if (quality === "flac" || quality === "flac24bit") return `F000${songmid}${songmid}.flac`;
  return `M500${songmid}${songmid}.mp3`;
}

export function parseQqVkey(data) {
  const vkey = data?.queryvkey?.data;
  const purl = String(vkey?.midurlinfo?.[0]?.purl || "").trim();
  if (!purl) {
    const err = new Error("VIP/Copyright protected content");
    err.code = "VIP";
    throw err;
  }
  const abs = httpUrl(purl);
  if (abs) return abs;
  const sip = Array.isArray(vkey?.sip) ? vkey.sip.find((s) => String(s || "").trim()) : "";
  const base = String(sip || QQ_STREAM);
  try {
    return new URL(purl, base).toString();
  } catch (_) {
    throw new Error("QQ 返回了无效播放地址");
  }
}

async function qqUrl(id, quality) {
  const filename = buildQqFilename(id, quality);
  const payload = JSON.stringify({
    queryvkey: {
      method: "CgiGetVkey",
      module: "vkey.GetVkeyServer",
      param: {
        checklimit: 0, ctx: 1, downloadfrom: 0, uin: "0",
        filename: [filename], guid: "0", songmid: [id],
      },
    },
  });
  const url = QQ_URL + "?data=" + encodeURIComponent(payload);
  const { text } = await fetchText(url, {
    headers: { origin: "https://y.qq.com", referer: "https://y.qq.com/portal/search.html" },
  });
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error("QQ 解析响应异常"); }
  return parseQqVkey(data);
}

/* ---- 酷我 DES-like，表格与 TuneFree kuwo.rs 一致 ---- */
const C0 = [0x1f,0,1,2,3,4,-1,-1,3,4,5,6,7,8,-1,-1,7,8,9,10,11,12,-1,-1,11,12,13,14,15,16,-1,-1,15,16,17,18,19,20,-1,-1,19,20,21,22,23,24,-1,-1,23,24,25,26,27,28,-1,-1,27,28,29,30,31,30,-1,-1];
const C1 = [0x39,0x31,0x29,0x21,0x19,0x11,9,1,0x3b,0x33,0x2b,0x23,0x1b,0x13,0xb,3,0x3d,0x35,0x2d,0x25,0x1d,0x15,0xd,5,0x3f,0x37,0x2f,0x27,0x1f,0x17,0xf,7,0x38,0x30,0x28,0x20,0x18,0x10,8,0,0x3a,0x32,0x2a,0x22,0x1a,0x12,0xa,2,0x3c,0x34,0x2c,0x24,0x1c,0x14,0xc,4,0x3e,0x36,0x2e,0x26,0x1e,0x16,0xe,6];
const C2 = [0x27,7,0x2f,0xf,0x37,0x17,0x3f,0x1f,0x26,6,0x2e,0xe,0x36,0x16,0x3e,0x1e,0x25,5,0x2d,0xd,0x35,0x15,0x3d,0x1d,0x24,4,0x2c,0xc,0x34,0x14,0x3c,0x1c,0x23,3,0x2b,0xb,0x33,0x13,0x3b,0x1b,0x22,2,0x2a,0xa,0x32,0x12,0x3a,0x1a,0x21,1,0x29,9,0x31,0x11,0x39,0x19,0x20,0,0x28,8,0x30,0x10,0x38,0x18];
const C3 = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const C4 = [0n, 0x100001n, 0x300003n];
const P = [0xf,6,0x13,0x14,0x1c,0xb,0x1b,0x10,0,0xe,0x16,0x19,4,0x11,0x1e,9,1,7,0x17,0xd,0x1f,0x1a,2,8,0x12,0xc,0x1d,5,0x15,0xa,3,0x18];
const Q = [0x38,0x30,0x28,0x20,0x18,0x10,8,0,0x39,0x31,0x29,0x21,0x19,0x11,9,1,0x3a,0x32,0x2a,0x22,0x1a,0x12,0xa,2,0x3b,0x33,0x2b,0x23,0x3e,0x36,0x2e,0x26,0x1e,0x16,0xe,6,0x3d,0x35,0x2d,0x25,0x1d,0x15,0xd,5,0x3c,0x34,0x2c,0x24,0x1c,0x14,0xc,4,0x1b,0x13,0xb,3];
const S = [0xd,0x10,0xa,0x17,0,4,-1,-1,2,0x1b,0xe,5,0x14,9,-1,-1,0x16,0x12,0xb,3,0x19,7,-1,-1,0xf,6,0x1a,0x13,0xc,1,-1,-1,0x28,0x33,0x1e,0x24,0x2e,0x36,-1,-1,0x1d,0x27,0x32,0x2c,0x20,0x2f,-1,-1,0x2b,0x30,0x26,0x37,0x21,0x34,-1,-1,0x2d,0x29,0x31,0x23,0x1c,0x1f,-1,-1];
const SBOX = [
  [14,4,3,15,2,13,5,3,13,14,6,9,11,2,0,5,4,1,10,12,15,6,9,10,1,8,12,7,8,11,7,0,0,15,10,5,14,4,9,10,7,8,12,3,13,1,3,6,15,12,6,11,2,9,5,0,4,2,11,14,1,7,8,13],
  [15,0,9,5,6,10,12,9,8,7,2,12,3,13,5,2,1,14,7,8,11,4,0,3,14,11,13,6,4,1,10,15,3,13,12,11,15,3,6,0,4,10,1,7,8,4,11,14,13,8,0,6,2,15,9,5,7,1,10,12,14,2,5,9],
  [10,13,1,11,6,8,11,5,9,4,12,2,15,3,2,14,0,6,13,1,3,15,4,10,14,9,7,12,5,0,8,7,13,1,2,4,3,6,12,11,0,13,5,14,6,8,15,2,7,10,8,15,4,9,11,5,9,0,14,3,10,7,1,12],
  [7,10,1,15,0,12,11,5,14,9,8,3,9,7,4,8,13,6,2,1,6,11,12,2,3,0,5,14,10,13,15,4,13,3,4,9,6,10,1,12,11,0,2,5,0,13,14,2,8,15,7,4,15,1,10,7,5,6,12,11,3,8,9,14],
  [2,4,8,15,7,10,13,6,4,1,3,12,11,7,14,0,12,2,5,9,10,13,0,3,1,11,15,5,6,8,9,14,14,11,5,6,4,1,3,10,2,12,15,0,13,2,8,5,11,8,0,15,7,14,9,4,12,7,10,9,1,13,6,3],
  [12,9,0,7,9,2,14,1,10,15,3,4,6,12,5,11,1,14,13,0,2,8,7,13,15,5,4,10,8,3,11,6,10,4,6,11,7,9,0,6,4,2,13,1,9,15,3,8,15,3,1,14,12,5,11,0,2,12,14,7,5,10,8,13],
  [4,1,3,10,15,12,5,0,2,11,9,6,8,7,6,9,11,4,12,15,0,3,10,5,14,13,7,8,13,14,1,2,13,6,14,9,4,1,2,14,11,13,5,0,1,10,8,3,0,11,3,5,9,4,15,2,7,8,12,15,10,7,6,12],
  [13,7,10,0,6,9,5,15,8,4,3,10,11,14,12,5,2,11,9,6,15,12,0,3,4,1,14,13,1,2,7,8,1,2,12,15,10,4,0,3,13,14,6,9,7,8,9,6,15,1,5,12,3,10,14,5,8,7,11,0,4,13,2,11],
];

const MASK64 = 0xffffffffffffffffn;
const MASK32 = 0xffffffffn;

function applyMask(arr, len, val) {
  let res = 0n;
  const v = BigInt(val) & MASK64;
  for (let i = 0; i < len; i++) {
    const idx = arr[i];
    if (idx < 0) continue;
    if ((v & (1n << BigInt(idx))) !== 0n) res |= 1n << BigInt(i);
  }
  return res & MASK64;
}

function encryptBlock(keyArr, data) {
  const res = applyMask(C1, 64, data);
  const blocks = [res & MASK32, (res >> 32n) & MASK32];
  for (let i = 0; i < 16; i++) {
    let right = applyMask(C0, 64, blocks[1]) ^ keyArr[i];
    let sboxOut = 0n;
    for (let j = 7; j >= 0; j--) {
      const b = Number((right >> BigInt(j * 8)) & 0xffn);
      sboxOut = (sboxOut << 4n) | BigInt(SBOX[j][b]);
    }
    const p = applyMask(P, 32, sboxOut);
    const temp = blocks[0];
    blocks[0] = blocks[1];
    blocks[1] = (temp ^ p) & MASK32;
  }
  const combined = ((blocks[0] << 32n) & 0xffffffff00000000n) | (blocks[1] & MASK32);
  return applyMask(C2, 64, combined);
}

function prepareKey(key) {
  let keyVal = applyMask(Q, 56, key);
  const arr = new Array(16);
  for (let i = 0; i < 16; i++) {
    const c3 = BigInt(C3[i]);
    const c4 = C4[C3[i] % 3];
    const part1 = (keyVal & c4) << (28n - c3);
    const part2 = (keyVal & (c4 ^ MASK64)) >> c3;
    keyVal = (part1 | part2) & MASK64;
    arr[i] = applyMask(S, 64, keyVal);
  }
  return arr;
}

export function kuwoEncrypt(text, keyStr = KUWO_KEY) {
  const keyBytes = Buffer.from(String(keyStr), "ascii");
  let keyInt = 0n;
  for (let i = 0; i < 8; i++) {
    if (i < keyBytes.length) keyInt |= BigInt(keyBytes[i]) << BigInt(i * 8);
  }
  const keyArr = prepareKey(keyInt);
  const buf = Buffer.from(String(text), "ascii");
  const blockCount = Math.floor(buf.length / 8);
  const cipher = [];
  for (let i = 0; i < blockCount; i++) {
    let block = 0n;
    for (let j = 0; j < 8; j++) block |= BigInt(buf[j + i * 8]) << BigInt(j * 8);
    cipher.push(encryptBlock(keyArr, block));
  }
  let last = 0n;
  const remain = buf.length % 8;
  for (let i = 0; i < remain; i++) last |= BigInt(buf[blockCount * 8 + i]) << BigInt(i * 8);
  cipher.push(encryptBlock(keyArr, last));
  const out = Buffer.alloc(cipher.length * 8);
  cipher.forEach((block, n) => {
    for (let i = 0; i < 8; i++) out[n * 8 + i] = Number((block >> BigInt(i * 8)) & 0xffn);
  });
  return out;
}

export function parseKuwoUrl(body) {
  const text = String(body || "");
  if (text.split(/\r?\n/).some((line) => line.trim() === "bitrate=1")) {
    const err = new Error("VIP/Copyright protected content");
    err.code = "VIP";
    throw err;
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (s.startsWith("url=")) {
      const url = httpUrl(s.slice(4).trim());
      if (url) return url;
    }
  }
  const loose = httpUrl(text.trim());
  if (loose) return loose;
  throw new Error("酷我未返回可播放地址");
}

function kuwoBr(quality) {
  if (quality === "320k") return ["320kmp3", "mp3"];
  if (quality === "flac" || quality === "flac24bit") return ["2000kflac", "flac"];
  if (quality === "192k") return ["192kmp3", "mp3"];
  return ["128kmp3", "mp3"];
}

async function kuwoUrl(id, quality) {
  const rid = String(id || "").replace(/^MUSIC_/i, "");
  const [br, format] = kuwoBr(quality);
  const params = `type=convert_url&br=${br}&format=${format}&sig=0&rid=${rid}&network=wifi&response=url&prod=kwplayer_ar_10.3.3.0`;
  const q = kuwoEncrypt(params).toString("base64");
  const { text, ok } = await fetchText(KUWO_MOBI + q, {
    headers: { "user-agent": UA_MOBILE, referer: "http://kuwo.cn/" },
  });
  if (!ok && !text) throw new Error("酷我接口不可用");
  try {
    return parseKuwoUrl(text);
  } catch (e) {
    const alt = `https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=${encodeURIComponent(rid)}&format=${format}&response=url&httpsStatus=1`;
    const second = await fetchText(alt, { headers: { referer: "https://www.kuwo.cn/" } });
    return parseKuwoUrl(second.text);
  }
}

export async function nativeMusicUrl(platform, id, quality = "320k") {
  const songId = String(id || "").trim();
  if (!songId) throw new Error("missing id");
  if (platform === "wy") return neteaseUrl(songId, quality);
  if (platform === "tx") return qqUrl(songId, quality);
  if (platform === "kw") return kuwoUrl(songId, quality);
  throw new Error("unsupported platform");
}
