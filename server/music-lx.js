/**
 * 闲然导航 · 洛雪音源运行时 + 曲库搜索 + 播放列表导入
 *
 * 模型与官方洛雪一致：播放器本身不内置平台直链破解，
 * 只提供：
 *   1) 用户自行导入的 LX 音源脚本（在隔离 VM 里跑）
 *   2) 用户自行配置的 HTTP 音源 API（洛雪 API Server / query 风格）
 *   3) 公开曲库搜索（只拿歌名/歌手/id，不解析播放直链）
 *   4) AIMP / M3U / PLS 播放列表解析
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

export const PLATFORMS = [
  { id: "kw", name: "酷我" },
  { id: "kg", name: "酷狗" },
  { id: "wy", name: "网易" },
  { id: "tx", name: "QQ" },
  { id: "mg", name: "咪咕" },
  { id: "mix", name: "聚合" },
];

export const API_PRESETS = {
  "lx-api": {
    label: "洛雪 API Server",
    search: "",
    url: "{base}/url/{source}/{id}/{quality}",
    lyric: "{base}/lrc/{source}/{id}",
  },
  query: {
    label: "Query 风格",
    search: "{base}/search?source={source}&keywords={q}&page={page}&pageSize={pageSize}",
    url: "{base}/url?source={source}&songId={id}&quality={quality}",
    lyric: "{base}/lrc?source={source}&songId={id}",
  },
};

const MAX_SOURCES = 20;
const MAX_SCRIPT_BYTES = 1.5 * 1024 * 1024;
const INIT_TIMEOUT_MS = 12000;
const ACTION_TIMEOUT_MS = 12000;
const URL_TIMEOUT_MS = 12000;
const LYRIC_TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 10000;
const TICKET_TTL_MS = 10 * 60 * 1000;
const URL_CACHE_TTL_MS = 10 * 60 * 1000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const tickets = new Map(); // ticket -> { url, referer, expiresAt }
const runtimeCache = new Map(); // `${userId}:${sourceId}` -> LxRuntime
const urlCache = new Map(); // key -> { exp, val }

function sourcesDir(dataDir, userId) {
  return path.join(dataDir, "music-sources", String(userId || "0"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeId(id) {
  const s = String(id || "");
  return /^[a-zA-Z0-9_-]{6,64}$/.test(s) ? s : null;
}

export async function probeLxScript(script, isSafeHttpUrl) {
  const rt = new LxRuntime(script, parseSourceHeader(script), isSafeHttpUrl);
  try {
    const inited = await rt.ensure();
    return { inited, runtime: rt };
  } catch (e) {
    rt.dispose();
    throw e;
  }
}

export function parseSourceHeader(script) {
  const head = String(script || "").slice(0, 2500);
  const pick = (key) => {
    const re = new RegExp(`@${key}\\s+([^\\n\\r*]+)`, "i");
    const m = re.exec(head);
    return m ? m[1].trim() : "";
  };
  return {
    name: pick("name") || "未命名音源",
    description: pick("description"),
    version: pick("version"),
    author: pick("author"),
    homepage: pick("homepage"),
  };
}

export function fillTemplate(tpl, vars) {
  return String(tpl || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => {
    const v = vars[k];
    if (v == null) return "";
    if (k === "base") return String(v).replace(/\/+$/, "");
    if (k === "q" || k === "keywords") return encodeURIComponent(String(v));
    return encodeURIComponent(String(v));
  });
}

function toBuf(x) {
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  if (typeof x === "string") return Buffer.from(x);
  if (x && x.type === "Buffer" && Array.isArray(x.data)) return Buffer.from(x.data);
  return Buffer.from(String(x ?? ""));
}

function aesMode(mode, key) {
  const m = String(mode || "aes-128-cbc").toLowerCase();
  if (m.includes("aes")) return m;
  const bits = toBuf(key).length >= 32 ? "256" : toBuf(key).length >= 24 ? "192" : "128";
  if (m === "ecb") return `aes-${bits}-ecb`;
  if (m === "cfb") return `aes-${bits}-cfb`;
  return `aes-${bits}-cbc`;
}

function makeLxUtils() {
  return {
    buffer: {
      from: (...args) => Buffer.from(...args),
      bufToString(buf, format) {
        if (Buffer.isBuffer(buf) || buf instanceof Uint8Array) {
          return Buffer.from(buf).toString(format);
        }
        return Buffer.from(buf, "binary").toString(format);
      },
    },
    crypto: {
      aesEncrypt(buffer, mode, key, iv) {
        const alg = aesMode(mode, key);
        const keyBuf = toBuf(key);
        const isEcb = /ecb/i.test(alg);
        const cipher = crypto.createCipheriv(
          alg,
          keyBuf,
          isEcb ? null : toBuf(iv || Buffer.alloc(16)),
        );
        return Buffer.concat([cipher.update(toBuf(buffer)), cipher.final()]);
      },
      md5(str) {
        return crypto.createHash("md5").update(String(str ?? "")).digest("hex");
      },
      randomBytes(size) {
        return crypto.randomBytes(Number(size) || 16);
      },
      rsaEncrypt(buffer, key) {
        const b = toBuf(buffer);
        const padded = b.length >= 128 ? b : Buffer.concat([Buffer.alloc(128 - b.length), b]);
        return crypto.publicEncrypt(
          { key: String(key), padding: crypto.constants.RSA_NO_PADDING },
          padded,
        );
      },
    },
    zlib: {
      inflate(buf) {
        return new Promise((resolve, reject) => {
          zlib.inflate(toBuf(buf), (err, data) => (err ? reject(err) : resolve(data)));
        });
      },
      deflate(data) {
        return new Promise((resolve, reject) => {
          zlib.deflate(toBuf(data), (err, buf) => (err ? reject(err) : resolve(buf)));
        });
      },
    },
  };
}

async function lxHttpRequest(url, options, isSafeHttpUrl) {
  const method = String(options?.method || "GET").toUpperCase();
  const timeout = Math.min(Number(options?.timeout) || ACTION_TIMEOUT_MS, 20000);
  let reqUrl = String(url || "");
  if (!(await isSafeHttpUrl(reqUrl))) {
    throw new Error("blocked url");
  }
  const headers = { "user-agent": UA, ...(options?.headers || {}) };
  let body;
  if (options?.form) {
    headers["content-type"] = headers["content-type"] || "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  } else if (options?.formData) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(options.formData)) fd.append(k, v);
    body = fd;
  } else if (options?.body != null) {
    if ((method === "GET" || method === "HEAD") && typeof options.body === "object" && !Buffer.isBuffer(options.body)) {
      const u = new URL(reqUrl);
      for (const [k, v] of Object.entries(options.body)) {
        if (v != null) u.searchParams.set(k, String(v));
      }
      reqUrl = u.toString();
    } else if (typeof options.body === "object" && !Buffer.isBuffer(options.body)) {
      headers["content-type"] = headers["content-type"] || "application/json";
      body = JSON.stringify(options.body);
    } else {
      body = options.body;
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  if (options?.signal) {
    if (options.signal.aborted) ctrl.abort();
    else options.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const r = await fetch(reqUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      redirect: options?.followRedirect === false && options?.follow_max === 0 ? "manual" : "follow",
      signal: ctrl.signal,
    });
    const rawBuf = Buffer.from(await r.arrayBuffer());
    let parsed = rawBuf.toString("utf8");
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("json") || /^\s*[\[{]/.test(parsed)) {
      try { parsed = JSON.parse(parsed); } catch (_) { /* keep text */ }
    }
    const hdrs = {};
    r.headers.forEach((v, k) => { hdrs[k] = v; });
    return {
      body: parsed,
      statusCode: r.status,
      statusMessage: r.statusText,
      headers: hdrs,
      raw: rawBuf,
      bytes: rawBuf.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Wrap host functions as same-realm closures so obfuscated sources can bind() them. */
function installHostFns(ctx, hostMap) {
  ctx.__hostInject = hostMap;
  vm.runInContext(`
    (() => {
      const hosts = globalThis.__hostInject;
      function wrapFn(fn, name) {
        const wrapped = function (...args) {
          if (new.target) return new fn(...args);
          return fn.apply(this, args);
        };
        try { Object.defineProperty(wrapped, "name", { value: name }); } catch (_) {}
        return wrapped;
      }
      for (const name of Object.keys(hosts)) {
        const value = hosts[name];
        globalThis[name] = typeof value === "function" ? wrapFn(value, name) : value;
      }
      delete globalThis.__hostInject;
    })();
  `, ctx);
}

function installLxProxy(ctx, hostLx) {
  ctx.__hostLx = hostLx;
  vm.runInContext(`
    (() => {
      const host = globalThis.__hostLx;
      const wrap = (fn) => function (...args) { return fn.apply(host, args); };
      const wrapObj = (obj) => {
        const out = {};
        for (const key of Object.keys(obj || {})) {
          const v = obj[key];
          out[key] = typeof v === "function" ? wrap(v)
            : (v && typeof v === "object") ? wrapObj(v)
            : v;
        }
        return out;
      };
      globalThis.lx = {
        EVENT_NAMES: host.EVENT_NAMES,
        version: host.version,
        env: host.env,
        currentScriptInfo: host.currentScriptInfo,
        utils: wrapObj(host.utils),
        request: wrap(host.request),
        send: wrap(host.send),
        on: wrap(host.on),
      };
      delete globalThis.__hostLx;
    })();
  `, ctx);
}

class LxRuntime {
  constructor(script, meta, isSafeHttpUrl, onUpdateAlert) {
    this.script = script;
    this.meta = meta || {};
    this.isSafeHttpUrl = isSafeHttpUrl;
    this.onUpdateAlert = typeof onUpdateAlert === "function" ? onUpdateAlert : null;
    this.handler = null;
    this.inited = null;
    this.updateAlert = null;
    this.ready = null;
    this.timers = new Set();
    this._alertWaiters = [];
  }

  waitForUpdateAlert(ms = 2000) {
    if (this.updateAlert) return Promise.resolve(this.updateAlert);
    return Promise.race([
      new Promise((res) => { this._alertWaiters.push(res); }),
      new Promise((res) => setTimeout(() => res(this.updateAlert), ms)),
    ]);
  }

  dispose() {
    for (const id of this.timers) {
      try { clearTimeout(id); } catch (_) {}
      try { clearInterval(id); } catch (_) {}
    }
    this.timers.clear();
  }

  async ensure() {
    if (this.ready) return this.ready;
    this.ready = this._boot();
    try {
      await this.ready;
    } catch (e) {
      this.ready = null;
      throw e;
    }
    return this.inited;
  }

  async _boot() {
    const self = this;
    let resolveInit;
    let rejectInit;
    const initWait = new Promise((res, rej) => {
      resolveInit = res;
      rejectInit = rej;
    });

    const lx = {
      EVENT_NAMES: { request: "request", inited: "inited", updateAlert: "updateAlert" },
      // Match official desktop custom-source API version (preload.js).
      version: "2.0.0",
      env: "desktop",
      currentScriptInfo: {
        name: this.meta.name || "",
        description: this.meta.description || "",
        version: this.meta.version || "",
        author: this.meta.author || "",
        rawScript: this.script,
        homepage: this.meta.homepage || "",
      },
      utils: makeLxUtils(),
      request(url, opts, cb) {
        const options = typeof opts === "function" ? {} : (opts || {});
        const callback = typeof opts === "function" ? opts : cb;
        const ctrl = new AbortController();
        let aborted = false;
        lxHttpRequest(url, { ...options, signal: ctrl.signal }, self.isSafeHttpUrl)
          .then((resp) => {
            if (aborted) return;
            if (typeof callback === "function") callback(null, resp, resp.body);
          })
          .catch((err) => {
            if (aborted) return;
            if (typeof callback === "function") callback(err, null, null);
          });
        return () => {
          aborted = true;
          try { ctrl.abort(); } catch (_) {}
        };
      },
      send(event, data) {
        if (event === "inited" || event === lx.EVENT_NAMES.inited) {
          self.inited = data || {};
          resolveInit(self.inited);
        } else if (event === "updateAlert" || event === lx.EVENT_NAMES.updateAlert) {
          self.updateAlert = data || null;
          const waiters = self._alertWaiters.splice(0);
          for (const w of waiters) {
            try { w(self.updateAlert); } catch (_) {}
          }
          if (self.onUpdateAlert) {
            try { self.onUpdateAlert(self.updateAlert); } catch (_) {}
          }
        }
        return Promise.resolve();
      },
      on(event, handler) {
        if (event === "request" || event === lx.EVENT_NAMES.request) {
          self.handler = handler;
        }
        return Promise.resolve();
      },
    };

    // Do NOT inject host primordials (Array/Object/Function/…) or host-realm
    // JS functions such as `console.log = () => {}`. Obfuscated LX sources
    // call `fn.bind(...)` on whatever they find; mixing realms throws
    // "Bind must be called on a function" on every musicUrl request.
    // Native console is required: obfuscated sources detect a replaced
    // console.log and then throw "Bind must be called on a function".
    const ctx = vm.createContext({ lx, Buffer, console }, {
      name: "lx-source",
      codeGeneration: { strings: true, wasm: false },
    });
    vm.runInContext(`
      globalThis.window = globalThis;
      globalThis.global = globalThis;
    `, ctx);
    installLxProxy(ctx, lx);
    installHostFns(ctx, {
      setTimeout: (fn, ms, ...args) => {
        const id = setTimeout(() => { self.timers.delete(id); fn(...args); }, ms);
        self.timers.add(id);
        return id;
      },
      setInterval: (fn, ms, ...args) => {
        const id = setInterval(fn, ms, ...args);
        self.timers.add(id);
        return id;
      },
      clearTimeout: (id) => { self.timers.delete(id); clearTimeout(id); },
      clearInterval: (id) => { self.timers.delete(id); clearInterval(id); },
      atob: (s) => Buffer.from(String(s), "base64").toString("binary"),
      btoa: (s) => Buffer.from(String(s), "binary").toString("base64"),
      fetch: async (url, opts) => {
        if (!(await self.isSafeHttpUrl(String(url)))) throw new Error("blocked url");
        return fetch(url, opts);
      },
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
    });

    const bootTimer = setTimeout(() => rejectInit(new Error("音源初始化超时")), INIT_TIMEOUT_MS);
    try {
      vm.runInContext(this.script, ctx, {
        filename: "lx-source.js",
        timeout: 8000,
      });
      await initWait;
    } finally {
      clearTimeout(bootTimer);
    }
    if (!this.inited) throw new Error("音源未调用 lx.send(inited)");
    return this.inited;
  }

  async requestAction({ source, action, info, timeoutMs }) {
    await this.ensure();
    if (typeof this.handler !== "function") {
      throw new Error("音源未注册 request 处理");
    }
    const result = this.handler({ source, action, info });
    const ms = Math.min(Math.max(Number(timeoutMs) || ACTION_TIMEOUT_MS, 1000), 20000);
    let timer;
    try {
      return await Promise.race([
        Promise.resolve(result),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error("音源请求超时")), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function listSources(dataDir, userId) {
  const dir = sourcesDir(dataDir, userId);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      out.push(raw);
    } catch (_) {}
  }
  out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return out.map((s) => publicSource(s, userId));
}

function readSource(dataDir, userId, id) {
  const sid = safeId(id);
  if (!sid) return null;
  const fp = path.join(sourcesDir(dataDir, userId), sid + ".json");
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch (_) {
    return null;
  }
}

function writeSource(dataDir, userId, rec) {
  const dir = sourcesDir(dataDir, userId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, rec.id + ".json"), JSON.stringify(rec, null, 2), "utf8");
}

function deleteSourceFile(dataDir, userId, id) {
  const sid = safeId(id);
  if (!sid) return false;
  const fp = path.join(sourcesDir(dataDir, userId), sid + ".json");
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  runtimeCache.delete(`${userId}:${sid}`);
  return true;
}

function runtimeAlertFor(rec, userId) {
  if (!rec?.id) return rec?.updateAlert || null;
  if (userId != null) {
    const rt = runtimeCache.get(`${userId}:${rec.id}`);
    if (rt?.updateAlert) return rt.updateAlert;
  }
  for (const [k, rt] of runtimeCache) {
    if (String(k).endsWith(":" + rec.id) && rt?.updateAlert) return rt.updateAlert;
  }
  return rec.updateAlert || null;
}

function publicSource(rec, userId) {
  const platforms = rec.platforms && typeof rec.platforms === "object" ? rec.platforms : {};
  const updateAlert = runtimeAlertFor(rec, userId);
  return {
    id: rec.id,
    name: rec.name,
    type: rec.type,
    enabled: rec.enabled !== false,
    createdAt: rec.createdAt,
    description: rec.description || "",
    version: rec.version || "",
    author: rec.author || "",
    apiBase: rec.apiBase || "",
    preset: rec.preset || "",
    updateAlert: updateAlert && typeof updateAlert === "object"
      ? { log: String(updateAlert.log || "").slice(0, 1024), updateUrl: String(updateAlert.updateUrl || "").slice(0, 1024) }
      : null,
    platforms: Object.fromEntries(
      Object.entries(platforms).map(([k, v]) => [
        k,
        {
          name: v?.name || k,
          type: v?.type || "music",
          actions: Array.isArray(v?.actions) ? v.actions : [],
          qualitys: Array.isArray(v?.qualitys) ? v.qualitys : [],
        },
      ]),
    ),
  };
}

function persistSourceAlert(dataDir, userId, rec, alert) {
  if (!rec?.id || !alert) return;
  rec.updateAlert = {
    log: String(alert.log || "").slice(0, 1024),
    updateUrl: String(alert.updateUrl || "").slice(0, 1024),
  };
  try { writeSource(dataDir, userId, rec); } catch (_) {}
}

async function getRuntime(dataDir, userId, rec, isSafeHttpUrl) {
  const key = `${userId}:${rec.id}`;
  let rt = runtimeCache.get(key);
  if (!rt) {
    rt = new LxRuntime(rec.script, rec, isSafeHttpUrl, (alert) => persistSourceAlert(dataDir, userId, rec, alert));
    runtimeCache.set(key, rt);
  }
  await rt.ensure();
  return rt;
}

function enabledSources(dataDir, userId) {
  return listSources(dataDir, userId)
    .map((s) => readSource(dataDir, userId, s.id))
    .filter((s) => s && s.enabled !== false);
}

function sourceSupports(rec, platform, action) {
  if (!rec) return false;
  if (rec.type === "http-api") {
    if (action === "musicUrl") return !!rec.urlPath;
    if (action === "lyric") return !!rec.lyricPath;
    if (action === "search") return !!rec.searchPath;
    return false;
  }
  const p = rec.platforms?.[platform];
  if (!p) return false;
  const acts = p.actions || [];
  return acts.includes(action) || (action === "musicUrl" && acts.includes("musicUrl"));
}

export function createTicket(url, referer) {
  const id = randomUUID().replace(/-/g, "") + crypto.randomBytes(8).toString("hex");
  tickets.set(id, {
    url: String(url),
    referer: referer || "",
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  if (tickets.size > 2000) {
    const now = Date.now();
    for (const [k, v] of tickets) {
      if (v.expiresAt < now) tickets.delete(k);
    }
  }
  return id;
}

export function takeTicket(id) {
  const t = tickets.get(String(id || ""));
  if (!t) return null;
  if (t.expiresAt < Date.now()) {
    tickets.delete(id);
    return null;
  }
  return t;
}

function platformReferer(platform) {
  return ({
    kw: "https://www.kuwo.cn/",
    kg: "https://www.kugou.com/",
    wy: "https://music.163.com/",
    tx: "https://y.qq.com/",
    mg: "https://music.migu.cn/",
  })[platform] || "";
}

function pickStr(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function pickNum(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function normalizeTrack(raw, platform) {
  if (!raw || typeof raw !== "object") return null;
  const id = pickStr(
    raw.id, raw.songmid, raw.songId, raw.MUSICRID, raw.hash,
    raw.copyrightId, raw.contentId, raw.rid,
  );
  const name = pickStr(raw.name, raw.songname, raw.SONGNAME, raw.NAME, raw.title, raw.songName);
  if (!name) return null;
  let artists = "";
  if (Array.isArray(raw.artists) && raw.artists[0] && typeof raw.artists[0] === "object") {
    artists = raw.artists.map((s) => s?.name || "").filter(Boolean).join(" / ");
  } else if (Array.isArray(raw.artists)) {
    artists = raw.artists.map((s) => String(s || "")).filter(Boolean).join(" / ");
  } else if (Array.isArray(raw.singer)) {
    artists = raw.singer.map((s) => s?.name || s?.title || "").filter(Boolean).join(" / ");
  }
  if (!artists && Array.isArray(raw.ar)) {
    artists = raw.ar.map((s) => s?.name || "").filter(Boolean).join(" / ");
  }
  if (!artists) {
    artists = pickStr(raw.artist, raw.ARTIST, raw.singername, raw.singerName, raw.artists);
  }
  const nameClean = decodeEntities(name);
  if (!nameClean) return null;
  const album = decodeEntities(pickStr(
    raw.album, raw.ALBUM, raw.albumname, raw.albumName, raw.album?.name, raw.al?.name,
  ));
  let durationMs = pickNum(raw.durationMs, raw.interval && raw.interval * 1000, raw.DURATION && raw.DURATION * 1000, raw.duration && (raw.duration > 10000 ? raw.duration : raw.duration * 1000), raw.dt);
  const plat = pickStr(raw.platform, raw.source, platform) || platform;
  let songId = id;
  if (plat === "kw" && /^MUSIC_/i.test(songId)) songId = songId.replace(/^MUSIC_/i, "");
  return {
    platform: plat,
    id: songId || nameClean,
    name: nameClean,
    artists: decodeEntities(artists),
    album,
    durationMs,
    extra: {
      hash: pickStr(raw.hash, raw.FileHash, raw.hqhash),
      albumId: pickStr(raw.albumId, raw.albumid, raw.albummid, raw.ALBUMID),
      strMediaMid: pickStr(raw.strMediaMid, raw.media_mid),
      copyrightId: pickStr(raw.copyrightId, raw.contentId),
    },
  };
}

export function normalizeSearchBody(body, platform) {
  if (!body) return { items: [], total: null, isEnd: true };
  if (Array.isArray(body)) {
    return { items: body.map((x) => normalizeTrack(x, platform)).filter(Boolean), total: body.length, isEnd: true };
  }
  const bags = [
    body.items,
    body.data?.list,
    body.data?.songs,
    body.data?.song?.list,
    body.data,
    body.result?.songs,
    body.result?.songCount && body.result?.songs,
    body.abslist,
    body.list,
    body.songs,
  ];
  let arr = [];
  for (const b of bags) {
    if (Array.isArray(b) && b.length) { arr = b; break; }
  }
  if (!arr.length && Array.isArray(body.data) && body.data.length) arr = body.data;
  const total = pickNum(body.total, body.TOTAL, body.data?.total, body.result?.songCount, arr.length);
  const items = arr.map((x) => normalizeTrack(x, platform)).filter(Boolean);
  const pageSize = Number(body.pageSize) || items.length || 25;
  return {
    items,
    total: total ?? null,
    isEnd: total == null ? items.length < pageSize : items.length === 0,
  };
}

export function normalizeUrlBody(body) {
  if (!body) return "";
  if (typeof body === "string") {
    const s = body.trim();
    if (/^https?:\/\//i.test(s)) return s;
    try {
      const j = JSON.parse(s);
      return normalizeUrlBody(j);
    } catch (_) {
      return "";
    }
  }
  if (typeof body === "object") {
    const u = pickStr(
      body.url,
      body.data?.url,
      typeof body.data === "string" ? body.data : "",
      body.result,
      body.play_url,
      body.playUrl,
    );
    return /^https?:\/\//i.test(u) ? u : "";
  }
  return "";
}

function pickLyric(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === "object") {
      if (Array.isArray(v)) {
        const fromList = kuwoListToLrc(v);
        if (fromList) return fromList;
        continue;
      }
      const inner = pickLyric(v.lyric, v.lrc, v.syncedLyrics, v.plainLyrics, v.lrclist);
      if (inner) return inner;
      continue;
    }
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

export function kuwoListToLrc(list) {
  if (!Array.isArray(list) || !list.length) return "";
  const lines = [];
  for (const item of list) {
    const text = String(item?.lineLyric || item?.line_lyric || item?.text || "").trim();
    if (!text || text === "//") continue;
    const t = Number(item.time ?? item.t ?? 0);
    if (!Number.isFinite(t) || t < 0) continue;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const ss = s.toFixed(2).padStart(5, "0");
    lines.push(`[${String(m).padStart(2, "0")}:${ss}]${text}`);
  }
  return lines.join("\n");
}

export function normalizeLyricBody(body) {
  if (!body) return "";
  if (typeof body === "string") {
    const t = body.trim();
    if (t.startsWith("{")) {
      try { return normalizeLyricBody(JSON.parse(t)); } catch (_) { return body; }
    }
    return body;
  }
  if (Array.isArray(body)) return kuwoListToLrc(body);
  return pickLyric(
    body.lrc?.lyric,
    body.tlyric?.lyric,
    body.syncedLyrics,
    body.plainLyrics,
    body.lrclist,
    body.data?.lrclist,
    body.lrc,
    body.lyric,
    body.data?.lrc,
    body.data?.lyric,
    body.data,
    body.lyric_str,
  );
}

function lyricScore(lrc) {
  const s = String(lrc || "");
  if (!s.trim()) return 0;
  const timed = (s.match(/\[\d{1,3}\s*:\s*\d{1,2}/g) || []).length;
  return timed * 1000 + s.length;
}

async function fetchKuwoLyric(id) {
  const url = `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(id)}`;
  const body = await fetchJson(url, { referer: "https://m.kuwo.cn/" });
  return normalizeLyricBody(body);
}

async function fetchNeteaseLyric(id) {
  const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&kv=1&tv=-1`;
  const body = await fetchJson(url, { referer: "https://music.163.com/" });
  return normalizeLyricBody(body);
}

async function fetchLrclibLyric(name, artists, album) {
  const qs = new URLSearchParams();
  if (name) qs.set("track_name", name);
  if (artists) qs.set("artist_name", String(artists).split(/[\/,&]/)[0].trim());
  if (album) qs.set("album_name", album);
  const url = `https://lrclib.net/api/search?${qs.toString()}`;
  const body = await fetchJson(url, { referer: "https://lrclib.net/" });
  const rows = Array.isArray(body) ? body : [];
  let best = "";
  let bestN = 0;
  for (const row of rows) {
    const lrc = pickLyric(row?.syncedLyrics, row?.plainLyrics);
    const n = lyricScore(lrc);
    if (n > bestN) {
      best = lrc;
      bestN = n;
    }
  }
  return best;
}

/** Public-catalog lyric fallback (does not depend on LX source lyric action). */
export async function catalogLyric({ platform, id, name, artists, album } = {}) {
  const tasks = [];
  if (platform === "wy" && id) tasks.push(() => fetchNeteaseLyric(id));
  if (platform === "kw" && id) tasks.push(() => fetchKuwoLyric(id));
  if (name) tasks.push(() => fetchLrclibLyric(name, artists, album));
  if (!tasks.length) return "";
  const settled = await Promise.allSettled(tasks.map((fn) => fn()));
  let best = "";
  let bestN = 0;
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const n = lyricScore(r.value);
    if (n > bestN) {
      best = r.value;
      bestN = n;
    }
  }
  return best;
}

function urlCacheGet(key) {
  const it = urlCache.get(key);
  if (!it) return null;
  if (Date.now() > it.exp) {
    urlCache.delete(key);
    return null;
  }
  return it.val;
}

function urlCacheSet(key, val) {
  urlCache.set(key, { exp: Date.now() + URL_CACHE_TTL_MS, val });
  if (urlCache.size > 400) {
    const first = urlCache.keys().next().value;
    if (first != null) urlCache.delete(first);
  }
}

async function raceFirstOk(jobs) {
  if (!jobs.length) return { ok: false, errors: [] };
  return await new Promise((resolve) => {
    let pending = jobs.length;
    let settled = false;
    const errors = [];
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    for (const job of jobs) {
      Promise.resolve()
        .then(job)
        .then((v) => {
          if (v && v.url) return finish({ ok: true, ...v, errors });
          errors.push(v?.error || "空直链");
          pending -= 1;
          if (!pending) finish({ ok: false, errors });
        })
        .catch((e) => {
          errors.push(e.message || String(e));
          pending -= 1;
          if (!pending) finish({ ok: false, errors });
        });
    }
  });
}

export function parseRemoteJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("empty body");
  const cleaned = raw.replace(/^callback\(|^\w+\(|\)$/g, "");
  for (const s of [cleaned, raw]) {
    try { return JSON.parse(s); } catch (_) {}
  }
  // 酷我 r.s 旧接口有时返回 {'KEY':'val'} 这种单引号伪 JSON
  if (/^\s*\{/.test(cleaned) && cleaned.includes("'")) {
    try { return JSON.parse(cleaned.replace(/'/g, '"')); } catch (_) {}
  }
  throw new Error("bad json");
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url, { referer } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "application/json,text/plain,*/*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...(referer ? { referer } : {}),
      },
      signal: ctrl.signal,
    });
    const text = await r.text();
    try {
      return parseRemoteJson(text);
    } catch (e) {
      throw new Error(`bad json from ${url}: ${r.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function tryCatalogUrls(urls, referer, mapBody) {
  const errors = [];
  for (const url of urls) {
    try {
      const body = await fetchJson(url, { referer });
      const mapped = mapBody(body);
      if (mapped && mapped.items && mapped.items.length) return mapped;
      if (mapped && mapped.error) errors.push(mapped.error);
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  return { items: [], total: 0, isEnd: true, error: errors[0] || "empty" };
}

export async function catalogSearch(platform, q, page = 1, pageSize = 25) {
  const keyword = String(q || "").trim();
  if (!keyword) return { items: [], page, pageSize, total: 0, isEnd: true };
  const pn = Math.max(1, Number(page) || 1);
  const rn = Math.min(50, Math.max(5, Number(pageSize) || 25));
  const enc = encodeURIComponent(keyword);

  if (platform === "mix") {
    const plats = ["kw", "wy", "kg", "tx"];
    const parts = await Promise.allSettled(plats.map((p) => catalogSearch(p, keyword, pn, Math.min(12, rn))));
    const seen = new Set();
    const items = [];
    const errors = [];
    for (const part of parts) {
      if (part.status !== "fulfilled") {
        errors.push(String(part.reason || ""));
        continue;
      }
      if (part.value.error) errors.push(part.value.error);
      for (const it of part.value.items || []) {
        const key = `${it.platform}:${it.name}:${it.artists}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(it);
      }
    }
    return { items, page: pn, pageSize: rn, total: items.length, isEnd: true, error: items.length ? "" : errors[0] };
  }

  try {
    if (platform === "kw") {
      const mapped = await tryCatalogUrls([
        `https://search.kuwo.cn/r.s?client=kt&all=${enc}&pn=${pn - 1}&rn=${rn}&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&issubtitle=1&newsearch=1&platform=pc&vipver=1&show_copyright_off=1`,
        `https://search.kuwo.cn/r.s?all=${enc}&ft=music&itemset=web_2013&client=kt&pn=${pn - 1}&rn=${rn}&rformat=json&encoding=utf8&mobi=1`,
        `https://search.kuwo.cn/r.s?all=${enc}&ft=music&itemset=web_2013&client=kt&pn=${pn - 1}&rn=${rn}&rformat=json&encoding=utf8`,
      ], "https://www.kuwo.cn/", (body) => {
        const items = (body.abslist || []).map((row) => normalizeTrack({
          id: String(row.MUSICRID || row.DC_TARGETID || "").replace(/^MUSIC_/i, ""),
          name: row.SONGNAME || row.NAME,
          artists: row.ARTIST,
          album: row.ALBUM,
          duration: Number(row.DURATION) || 0,
          albumId: row.ALBUMID,
        }, "kw")).filter(Boolean);
        return { items, total: Number(body.TOTAL) || items.length, isEnd: items.length < rn };
      });
      return { ...mapped, page: pn, pageSize: rn };
    }
    if (platform === "wy") {
      const mapped = await tryCatalogUrls([
        `https://music.163.com/api/cloudsearch/pc?s=${enc}&type=1&offset=${(pn - 1) * rn}&limit=${rn}`,
        `https://music.163.com/api/search/get?s=${enc}&type=1&offset=${(pn - 1) * rn}&limit=${rn}`,
        `https://music.163.com/api/search/get/web?s=${enc}&type=1&offset=${(pn - 1) * rn}&total=true&limit=${rn}`,
      ], "https://music.163.com/", (body) => {
        const songs = Array.isArray(body.result?.songs) ? body.result.songs : [];
        const items = songs.map((row) => normalizeTrack({
          id: row.id,
          name: row.name,
          artists: row.ar || row.artists,
          album: row.al?.name || row.album?.name,
          duration: row.dt || row.duration,
        }, "wy")).filter(Boolean);
        return { items, total: Number(body.result?.songCount) || items.length, isEnd: items.length < rn };
      });
      return { ...mapped, page: pn, pageSize: rn };
    }
    if (platform === "kg") {
      const mapped = await tryCatalogUrls([
        `https://songsearch.kugou.com/song_search_v2?keyword=${enc}&page=${pn}&pagesize=${rn}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0`,
      ], "https://www.kugou.com/", (body) => {
        const list = body.data?.lists || body.data?.list || [];
        const items = list.map((row) => normalizeTrack({
          id: row.FileHash || row.HQFileHash || row.SqFileHash,
          name: row.SongName || row.OriSongName,
          artists: row.SingerName,
          album: row.AlbumName,
          duration: (row.Duration || 0) * 1000,
          hash: row.FileHash,
          albumId: row.AlbumID,
        }, "kg")).filter(Boolean);
        return { items, total: Number(body.data?.total) || items.length, isEnd: items.length < rn };
      });
      return { ...mapped, page: pn, pageSize: rn };
    }
    if (platform === "tx") {
      const mapped = await tryCatalogUrls([
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=${pn}&n=${rn}&w=${enc}&format=json&outCharset=utf-8&cr=1&new_json=1`,
      ], "https://y.qq.com/", (body) => {
        const list = body.data?.song?.list || [];
        const items = list.map((row) => normalizeTrack({
          id: row.songmid || row.mid || row.file?.media_mid,
          name: row.songname || row.name || row.title,
          artists: row.singer,
          album: row.albumname || row.album?.name || row.album?.title,
          interval: row.interval,
          strMediaMid: row.strMediaMid || row.file?.media_mid,
        }, "tx")).filter(Boolean);
        return { items, total: Number(body.data?.song?.totalnum) || items.length, isEnd: items.length < rn };
      });
      return { ...mapped, page: pn, pageSize: rn };
    }
    if (platform === "mg") {
      const mapped = await tryCatalogUrls([
        `https://m.music.migu.cn/migu/remoting/scr_search_tag?rows=${rn}&type=2&keyword=${enc}&pgc=${pn}`,
      ], "https://music.migu.cn/", (body) => {
        const list = body.musics || body.songResultData?.result || [];
        const items = list.map((row) => normalizeTrack({
          id: row.copyrightId || row.contentId || row.id,
          name: row.songName || row.name || row.title,
          artists: row.singerName || row.singer,
          album: row.albumName || row.album,
          copyrightId: row.copyrightId,
        }, "mg")).filter(Boolean);
        return { items, total: Number(body.pgt) || items.length, isEnd: items.length < rn };
      });
      return { ...mapped, page: pn, pageSize: rn };
    }
  } catch (e) {
    return { items: [], page: pn, pageSize: rn, total: 0, isEnd: true, error: String(e.message || e) };
  }
  return { items: [], page: pn, pageSize: rn, total: 0, isEnd: true, error: "unsupported platform" };
}

async function httpApiCall(rec, kind, vars, isSafeHttpUrl) {
  const tpl = kind === "search" ? rec.searchPath : kind === "lyric" ? rec.lyricPath : rec.urlPath;
  if (!tpl) throw new Error("该 HTTP 音源未配置 " + kind);
  const url = fillTemplate(tpl, { base: rec.apiBase, ...vars, source: vars.platform || vars.source });
  if (!(await isSafeHttpUrl(url))) throw new Error("blocked url");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ACTION_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*" },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let body = text;
    try { body = JSON.parse(text); } catch (_) {}
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function buildMusicInfo(query) {
  return {
    songmid: query.id,
    songId: query.id,
    hash: query.hash || query.id,
    name: query.name || "",
    singer: query.artists || query.artist || "",
    albumName: query.album || "",
    albumId: query.albumId || "",
    strMediaMid: query.strMediaMid || "",
    copyrightId: query.copyrightId || query.id,
    source: query.platform,
    _qualitys: {},
  };
}

export function parsePlaylist(text, filename = "") {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".pls") || /^\[playlist\]/i.test(raw.trim())) {
    return parsePls(raw);
  }
  if (lower.endsWith(".aimppl") || lower.endsWith(".aimppl4") || /#-----SUMMARY-----#/i.test(raw) || /#-----CONTENT-----#/i.test(raw)) {
    return parseAimp(raw);
  }
  return parseM3u(raw);
}

function parseM3u(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  const tracks = [];
  let pendingTitle = "";
  let name = "";
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith("#EXTM3U")) continue;
    if (s.startsWith("#PLAYLIST:")) { name = s.slice(10).trim(); continue; }
    if (s.startsWith("#EXTINF:")) {
      const comma = s.indexOf(",");
      pendingTitle = comma >= 0 ? s.slice(comma + 1).trim() : "";
      continue;
    }
    if (s.startsWith("#")) continue;
    tracks.push(playlistEntry(s, pendingTitle));
    pendingTitle = "";
  }
  return { name: name || "M3U 播放列表", tracks };
}

function parsePls(raw) {
  const map = {};
  for (const line of raw.split(/\r\n|\n|\r/)) {
    const m = /^([A-Za-z]+)(\d+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    const idx = m[2];
    map[idx] = map[idx] || {};
    map[idx][key] = m[3];
  }
  const tracks = Object.keys(map)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => playlistEntry(map[k].file || "", map[k].title || ""))
    .filter((t) => t.url || t.localPath);
  return { name: "PLS 播放列表", tracks };
}

function parseAimp(raw) {
  let name = "AIMP 播放列表";
  const summary = /#-----SUMMARY-----#([\s\S]*?)(?:#-----CONTENT-----#|$)/i.exec(raw);
  if (summary) {
    const nm = /^Name=(.*)$/im.exec(summary[1]);
    if (nm) name = nm[1].trim() || name;
  }
  const contentMatch = /#-----CONTENT-----#([\s\S]*)$/i.exec(raw);
  const content = contentMatch ? contentMatch[1] : raw;
  const byIndex = {};
  const loose = [];
  for (const line of content.split(/\r\n|\n|\r/)) {
    const s = line.trim();
    if (!s || s === "-%") continue;
    const kv = /^(File|Title|Artist|Album|Duration)(\d+)=(.*)$/i.exec(s);
    if (kv) {
      const idx = kv[2];
      byIndex[idx] = byIndex[idx] || {};
      byIndex[idx][kv[1].toLowerCase()] = kv[3];
      continue;
    }
    if (!s.startsWith("#") && (/\.(mp3|m4a|flac|wav|ogg|aac|opus)(\?|$)/i.test(s) || /^https?:\/\//i.test(s) || /^[A-Za-z]:[\\/]/.test(s))) {
      loose.push(s);
    }
  }
  const tracks = [];
  const idxs = Object.keys(byIndex).sort((a, b) => Number(a) - Number(b));
  if (idxs.length) {
    for (const i of idxs) {
      const row = byIndex[i];
      tracks.push(playlistEntry(row.file || "", row.title || "", row.artist, row.album));
    }
  } else {
    for (const p of loose) tracks.push(playlistEntry(p, ""));
  }
  return { name, tracks: tracks.filter((t) => t.url || t.localPath) };
}

function playlistEntry(file, title, artist = "", album = "") {
  const loc = String(file || "").trim().replace(/^file:\/\//i, "");
  const isUrl = /^https?:\/\//i.test(loc);
  let name = String(title || "").trim();
  if (!name) {
    name = decodeURIComponent((isUrl ? loc.split("?")[0] : loc).split(/[\\/]/).pop() || "未命名");
    name = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  }
  return {
    url: isUrl ? loc : "",
    localPath: isUrl ? "" : loc,
    name,
    artists: artist || "",
    album: album || "",
  };
}

export function decodePlaylistBuffer(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(u8);
  }
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(u8);
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(u8);
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gb18030").decode(u8);
  } catch (_) {
    return utf8;
  }
}

export function registerMusicRoutes(app, { auth, dataDir, isSafeHttpUrl }) {
  app.get("/api/music/platforms", auth, (_req, res) => {
    res.json({ ok: true, platforms: PLATFORMS, presets: API_PRESETS });
  });

  app.get("/api/music/sources", auth, (req, res) => {
    res.json({ ok: true, items: listSources(dataDir, req.user.userId) });
  });

  app.post("/api/music/sources", auth, async (req, res) => {
    try {
      const items = listSources(dataDir, req.user.userId);
      if (items.length >= MAX_SOURCES) {
        return res.status(400).json({ ok: false, error: `最多导入 ${MAX_SOURCES} 个音源` });
      }
      const body = req.body || {};
      const type = body.type === "http-api" ? "http-api" : "lx-script";
      const id = randomUUID().replace(/-/g, "").slice(0, 16);
      let rec;

      if (type === "http-api") {
        const apiBase = String(body.apiBase || "").trim().replace(/\/+$/, "");
        if (!(await isSafeHttpUrl(apiBase))) {
          return res.status(400).json({ ok: false, error: "API 地址不合法" });
        }
        const preset = API_PRESETS[body.preset] ? body.preset : "query";
        const def = API_PRESETS[preset];
        rec = {
          id,
          type,
          name: String(body.name || "HTTP 音源").slice(0, 80),
          enabled: true,
          createdAt: Date.now(),
          apiBase,
          preset,
          searchPath: String(body.searchPath || def.search || ""),
          urlPath: String(body.urlPath || def.url),
          lyricPath: String(body.lyricPath || def.lyric),
          platforms: Object.fromEntries(PLATFORMS.filter((p) => p.id !== "mix").map((p) => [p.id, {
            name: p.name, type: "music", actions: ["musicUrl", "lyric"], qualitys: ["128k", "320k", "flac"],
          }])),
        };
      } else {
        let script = String(body.script || "");
        if (!script && body.url) {
          const srcUrl = String(body.url).trim();
          if (!(await isSafeHttpUrl(srcUrl))) {
            return res.status(400).json({ ok: false, error: "音源 URL 不合法" });
          }
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 15000);
          try {
            const r = await fetch(srcUrl, { headers: { "user-agent": UA }, signal: ctrl.signal });
            if (!r.ok) return res.status(400).json({ ok: false, error: `下载音源失败 HTTP ${r.status}` });
            script = await r.text();
          } finally {
            clearTimeout(timer);
          }
        }
        if (!script.trim()) return res.status(400).json({ ok: false, error: "缺少音源脚本" });
        if (Buffer.byteLength(script) > MAX_SCRIPT_BYTES) {
          return res.status(400).json({ ok: false, error: "音源脚本过大" });
        }
        const meta = parseSourceHeader(script);
        rec = {
          id,
          type: "lx-script",
          name: String(body.name || meta.name || "洛雪音源").slice(0, 80),
          description: meta.description,
          version: meta.version,
          author: meta.author,
          enabled: true,
          createdAt: Date.now(),
          script,
          platforms: {},
        };
        const rt = new LxRuntime(script, rec, isSafeHttpUrl, (alert) => persistSourceAlert(dataDir, req.user.userId, rec, alert));
        try {
          const inited = await rt.ensure();
          rec.platforms = inited?.sources || inited || {};
          if (inited?.sources) rec.platforms = inited.sources;
          await rt.waitForUpdateAlert(1800);
          if (rt.updateAlert) rec.updateAlert = rt.updateAlert;
        } catch (e) {
          rt.dispose();
          return res.status(400).json({ ok: false, error: "音源初始化失败：" + (e.message || e) });
        }
        runtimeCache.set(`${req.user.userId}:${id}`, rt);
      }

      writeSource(dataDir, req.user.userId, rec);
      return res.json({ ok: true, source: publicSource(rec, req.user.userId) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.patch("/api/music/sources/:id", auth, (req, res) => {
    const rec = readSource(dataDir, req.user.userId, req.params.id);
    if (!rec) return res.status(404).json({ ok: false, error: "音源不存在" });
    if (typeof req.body?.enabled === "boolean") rec.enabled = req.body.enabled;
    if (req.body?.name) rec.name = String(req.body.name).slice(0, 80);
    writeSource(dataDir, req.user.userId, rec);
    return res.json({ ok: true, source: publicSource(rec, req.user.userId) });
  });

  app.delete("/api/music/sources/:id", auth, (req, res) => {
    const ok = deleteSourceFile(dataDir, req.user.userId, req.params.id);
    if (!ok) return res.status(404).json({ ok: false, error: "音源不存在" });
    return res.json({ ok: true });
  });

  app.get("/api/music/search", auth, async (req, res) => {
    const platform = String(req.query.platform || "kw");
    const q = String(req.query.q || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 25));
    if (!q) return res.json({ ok: true, items: [], page, pageSize, total: 0, isEnd: true });

    const srcs = enabledSources(dataDir, req.user.userId);
    const api = srcs.find((s) => s.type === "http-api" && s.searchPath);
    if (api && platform !== "mix") {
      try {
        const body = await httpApiCall(api, "search", { platform, q, page, pageSize }, isSafeHttpUrl);
        const norm = normalizeSearchBody(body, platform);
        return res.json({ ok: true, page, pageSize, ...norm, via: "http-api" });
      } catch (e) {
        /* fall through to catalog */
      }
    }

    let result = await catalogSearch(platform, q, page, pageSize);
    if ((!result.items || !result.items.length) && platform !== "mix") {
      const mix = await catalogSearch("mix", q, page, pageSize);
      if (mix.items && mix.items.length) {
        result = { ...mix, fallbackFrom: platform };
      }
    }
    return res.json({ ok: true, ...result, via: "catalog" });
  });

  app.get("/api/music/url", auth, async (req, res) => {
    const platform = String(req.query.platform || "");
    const id = String(req.query.id || "");
    const quality = String(req.query.quality || "320k");
    if (!platform || !id) return res.status(400).json({ ok: false, error: "missing platform/id" });

    const cacheKey = `${req.user.userId}:${platform}:${id}:${quality}`;
    const skipCache = req.query.fresh === "1" || req.query.fresh === "true";
    const cached = skipCache ? null : urlCacheGet(cacheKey);
    if (cached && cached.url) {
      const ticket = createTicket(cached.url, platformReferer(platform));
      return res.json({
        ok: true,
        url: cached.url,
        proxy: `/api/music/stream/${ticket}`,
        quality: cached.quality || quality,
        sourceId: cached.sourceId,
        sourceName: cached.sourceName,
        cached: true,
      });
    }

    const srcs = enabledSources(dataDir, req.user.userId);
    const preferredId = String(req.query.sourceId || "");
    const ordered = [
      ...(preferredId ? srcs.filter((s) => s.id === preferredId) : []),
      ...srcs.filter((s) => s.id !== preferredId),
    ];
    if (!ordered.length) {
      return res.status(409).json({
        ok: false,
        code: "no_source",
        error: "还没有可用音源。请先导入洛雪音源脚本或填写 HTTP 音源 API。",
      });
    }

    const qualities = [quality, "320k", "128k"].filter((v, i, a) => a.indexOf(v) === i);
    const errors = [];

    const sourceCan = (src, q) => {
      if (src.type === "http-api") return !!src.urlPath;
      if (src.platforms && Object.keys(src.platforms).length && !src.platforms[platform]) return false;
      const qs = src.platforms?.[platform]?.qualitys;
      if (Array.isArray(qs) && qs.length && !qs.includes(q)) return false;
      return true;
    };

    const resolveFromSource = async (src, q) => {
      let url = "";
      if (src.type === "http-api") {
        const body = await httpApiCall(src, "url", {
          platform, id, quality: q, hash: req.query.hash || id,
        }, isSafeHttpUrl);
        url = normalizeUrlBody(body);
      } else {
        const rt = await getRuntime(dataDir, req.user.userId, src, isSafeHttpUrl);
        const info = {
          type: q,
          musicInfo: buildMusicInfo({ ...req.query, platform, id, quality: q }),
        };
        const out = await rt.requestAction({
          source: platform, action: "musicUrl", info, timeoutMs: URL_TIMEOUT_MS,
        });
        url = normalizeUrlBody(out) || (typeof out === "string" ? out : "");
      }
      if (!/^https?:\/\//i.test(url)) return { error: src.name + "@" + q + ": 空直链" };
      if (!(await isSafeHttpUrl(url))) return { error: src.name + ": 直链被安全策略拦截" };
      return { url, quality: q, sourceId: src.id, sourceName: src.name };
    };

    for (const q of qualities) {
      const jobs = ordered.filter((src) => sourceCan(src, q)).map((src) => () => resolveFromSource(src, q));
      if (!jobs.length) continue;
      const raced = await raceFirstOk(jobs);
      if (raced.ok && raced.url) {
        urlCacheSet(cacheKey, {
          url: raced.url, quality: raced.quality, sourceId: raced.sourceId, sourceName: raced.sourceName,
        });
        const ticket = createTicket(raced.url, platformReferer(platform));
        return res.json({
          ok: true,
          url: raced.url,
          proxy: `/api/music/stream/${ticket}`,
          quality: raced.quality,
          sourceId: raced.sourceId,
          sourceName: raced.sourceName,
        });
      }
      if (Array.isArray(raced.errors)) errors.push(...raced.errors);
    }

    const alert = ordered
      .map((s) => runtimeCache.get(`${req.user.userId}:${s.id}`)?.updateAlert || s.updateAlert)
      .find((a) => a && a.log);
    const alertLog = alert?.log ? String(alert.log) : "";
    return res.status(502).json({
      ok: false,
      code: "resolve_failed",
      error: alertLog || "音源未能解析出可播放地址",
      detail: errors.slice(0, 6),
      updateAlert: alert || null,
    });
  });

  app.get("/api/music/lyric", auth, async (req, res) => {
    const platform = String(req.query.platform || "");
    const id = String(req.query.id || "");
    const name = String(req.query.name || "");
    const artists = String(req.query.artists || req.query.artist || "");
    const album = String(req.query.album || "");
    if (!platform || !id) return res.status(400).json({ ok: false, error: "missing platform/id" });

    const srcs = enabledSources(dataDir, req.user.userId);
    const sourceJobs = [];
    for (const src of srcs) {
      if (src.type === "http-api" && src.lyricPath) {
        sourceJobs.push(async () => {
          const body = await httpApiCall(src, "lyric", { platform, id }, isSafeHttpUrl);
          return normalizeLyricBody(body);
        });
      } else if (src.type === "lx-script" && sourceSupports(src, platform, "lyric")) {
        sourceJobs.push(async () => {
          const rt = await getRuntime(dataDir, req.user.userId, src, isSafeHttpUrl);
          const out = await rt.requestAction({
            source: platform,
            action: "lyric",
            timeoutMs: LYRIC_TIMEOUT_MS,
            info: { musicInfo: buildMusicInfo({ ...req.query, platform, id }) },
          });
          return normalizeLyricBody(out) || (typeof out === "string" ? out : "");
        });
      }
    }

    const catalogJob = () => catalogLyric({ platform, id, name, artists, album });
    const settled = await Promise.allSettled([...sourceJobs, catalogJob].map((fn) => fn()));
    let best = "";
    let bestN = 0;
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      const n = lyricScore(r.value);
      if (n > bestN) {
        best = r.value;
        bestN = n;
      }
    }
    return res.json({ ok: true, lrc: best || "" });
  });

  app.get("/api/music/stream/:ticket", async (req, res) => {
    const t = takeTicket(req.params.ticket);
    if (!t) return res.status(410).type("text/plain").send("expired");
    if (!(await isSafeHttpUrl(t.url))) return res.status(400).end();
    const headers = { "user-agent": UA, accept: "*/*" };
    if (t.referer) headers.referer = t.referer;
    if (req.headers.range) headers.range = req.headers.range;
    try {
      const up = await fetch(t.url, { headers, redirect: "follow" });
      if (!up.ok && up.status !== 206) {
        if (!res.headersSent) res.status(up.status || 502).type("text/plain").send("upstream " + up.status);
        else res.end();
        return;
      }
      res.status(up.status);
      const pass = ["content-type", "content-length", "content-range", "accept-ranges"];
      pass.forEach((k) => {
        const v = up.headers.get(k);
        if (v) res.setHeader(k, v);
      });
      if (!res.getHeader("content-type")) res.setHeader("content-type", "audio/mpeg");
      res.setHeader("cache-control", "private, max-age=60");
      res.setHeader("x-accel-buffering", "no");
      if (!up.body) return res.end();
      const reader = up.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const ok = res.write(Buffer.from(value));
        if (!ok) await new Promise((r) => res.once("drain", r));
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) res.status(502).json({ error: String(e.message || e) });
      else res.end();
    }
  });

  app.post("/api/music/playlist/parse", auth, (req, res) => {
    try {
      let text = String(req.body?.text || "");
      const filename = String(req.body?.filename || "playlist.m3u");
      if (req.body?.base64) {
        const buf = Buffer.from(String(req.body.base64), "base64");
        text = decodePlaylistBuffer(buf);
      }
      if (!text.trim()) return res.status(400).json({ ok: false, error: "空播放列表" });
      const parsed = parsePlaylist(text, filename);
      return res.json({ ok: true, ...parsed });
    } catch (e) {
      return res.status(400).json({ ok: false, error: String(e.message || e) });
    }
  });
}
