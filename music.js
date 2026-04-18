/* 樱 · 音乐播放器
 *  - 导入本地音频文件（mp3 / m4a / flac / wav / ogg）到 IndexedDB
 *  - 播放列表、随机、单曲/列表循环、进度/音量
 *  - LRC 歌词解析 + 同步滚动 + 逐行高亮
 *  - Web Audio API 频谱可视化（AnalyserNode -> canvas 柔和光带）
 *  - 数据：元信息存 localStorage，文件本体存 IndexedDB（避免 5MB 限制）
 */
(function () {
  "use strict";

  const META_KEY = "sakura_nav_music_v1";
  const toast = (m, ms) => window.toast ? window.toast(m, ms) : console.log(m);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => "t_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  // ===================== IndexedDB =====================
  // 共享实现见 idb.js 中的 window.NavIDB.music
  const IDB = (window.NavIDB && window.NavIDB.music) || {
    put: async () => { throw new Error("IndexedDB 不可用"); },
    get: async () => null,
    del: async () => {},
    clear: async () => {},
  };
  const SCRIPT_IDB = (window.NavIDB && window.NavIDB.musicScripts) || {
    put: async () => { throw new Error("IndexedDB 不可用"); },
    get: async () => null,
    del: async () => {},
  };
  const sourceUid = () => "cs_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

  // ===================== LRC 解析 =====================
  const TAG_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  function parseLrc(text) {
    if (!text) return [];
    const lines = [];
    for (const raw of text.split(/\r?\n/)) {
      const stamps = [];
      let m, lastEnd = 0;
      TAG_RE.lastIndex = 0;
      while ((m = TAG_RE.exec(raw)) !== null) {
        const mm = +m[1], ss = +m[2];
        const frac = m[3] ? parseInt((m[3] + "000").slice(0, 3), 10) / 1000 : 0;
        stamps.push(mm * 60 + ss + frac);
        lastEnd = m.index + m[0].length;
      }
      const txt = raw.slice(lastEnd).trim();
      if (stamps.length && txt) {
        for (const t of stamps) lines.push({ t, text: txt });
      }
    }
    lines.sort((a, b) => a.t - b.t);
    return lines;
  }

  function fmtTime(s) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  function fmtSize(b) {
    if (!b && b !== 0) return "";
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
  }

  // ===================== 内置 LX Music 协议音源清单 =====================
  // 浏览器里无法直接执行这些脚本（它们依赖 LX Music 桌面客户端的 globalThis.lx 与服务端 API）。
  // 这里只作为"源标签"使用，同时让用户一键下载脚本以便导入 LX Music 客户端。
  const BUILTIN_SOURCES = [
    { id: "file",       name: "本地文件",         desc: "从电脑选择 mp3/m4a/flac/wav/ogg 等", file: null },
    { id: "url",        name: "在线 URL",         desc: "粘贴音频直链，浏览器直接流式播放",    file: null },
    { id: "lx-aggregate",     name: "全豆要 · 聚合音源 v9.3", desc: "LX Music 协议（QQ/网易/酷狗/酷我/咪咕/B 站）", file: "lx-sources/quandouyao-aggregate-v9.3.js" },
    { id: "lx-changqing",     name: "长青 SVIP 音源",          desc: "LX Music 协议（多平台 SVIP）",                 file: "lx-sources/changqing-svip.js" },
    { id: "lx-nianxin",       name: "念心音源 v1.0.0",         desc: "LX Music 协议",                                file: "lx-sources/nianxin-v1.0.0.js" },
    { id: "lx-luoxue",        name: "洛雪音乐源 v2-fix",       desc: "LX Music 协议（QQ/酷狗/酷我/网易/咪咕）",      file: "lx-sources/luoxue-v2-fix.js" },
    { id: "lx-aggregate-api", name: "聚合 API (CF)",           desc: "LX Music 协议（Cloudflare 聚合代理 v3）",      file: "lx-sources/aggregate-api.js" },
    { id: "lx-luoxue-wechat-v3",   name: "洛雪公众号音源 V3.0",     desc: "LX Music 协议（公众号 / API 服务端，多平台音质）", file: "lx-sources/luoxue-wechat-v3.0.js" },
    { id: "lx-luoxue-wechat-v3-2", name: "洛雪公众号音源 V3.0 · 副本", desc: "同上脚本另一份拷贝，便于对比或备份",                 file: "lx-sources/luoxue-wechat-v3.0-2.js" },
  ];

  // ===================== 数据层 =====================
  const Music = {
    data: {
      tracks: [],        // [{id, kind:'file'|'url', name, size?, mime?, duration?, lrc, source, url?}]
      current: -1,
      shuffle: false,
      loop: "all",       // none | all | one
      volume: 0.75,
      currentSource: "file",  // 当前选中的"源"标签（用于添加时默认 + 过滤）
      sourceFilter: "__all__", // 播放列表过滤：__all__ 或某个 source id
      /** 在线导入的音源：元信息在 localStorage，脚本全文在 NavIDB.musicScripts */
      customSources: [], // [{ id, name, remoteUrl }]
    },
    audio: null,
    _ctx: null, _analyser: null, _srcNode: null, _dataArr: null,
    _vizRaf: null,
    _blobUrl: null,
    _lrcLines: [],
    _lastLrcIdx: -1,

    load() {
      try {
        const raw = localStorage.getItem(META_KEY);
        if (raw) Object.assign(this.data, JSON.parse(raw));
      } catch (_) {}
    },
    save() { localStorage.setItem(META_KEY, JSON.stringify(this.data)); },

    ensureAudio() {
      if (this.audio) return this.audio;
      const a = new Audio();
      a.preload = "metadata";
      a.volume = this.data.volume ?? 0.75;
      a.addEventListener("timeupdate", () => this._onTime());
      a.addEventListener("play", () => { MusicUI.render(); this._ensureAudioCtx(); });
      a.addEventListener("pause", () => MusicUI.render());
      a.addEventListener("ended", () => this._onEnded());
      a.addEventListener("loadedmetadata", () => {
        const t = this.currentTrack();
        if (t) { t.duration = a.duration; this.save(); }
        MusicUI.render();
      });
      a.addEventListener("error", () => {
        toast("播放出错");
        MusicUI.render();
      });
      this.audio = a;
      return a;
    },

    _ensureAudioCtx() {
      if (this._ctx || !this.audio) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const src = ctx.createMediaElementSource(this.audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.82;
        src.connect(analyser);
        analyser.connect(ctx.destination);
        this._ctx = ctx; this._srcNode = src; this._analyser = analyser;
        this._dataArr = new Uint8Array(analyser.frequencyBinCount);
      } catch (e) { console.warn("AudioContext 初始化失败：", e); }
    },

    currentTrack() {
      const i = this.data.current;
      return i >= 0 && i < this.data.tracks.length ? this.data.tracks[i] : null;
    },

    async addFiles(files) {
      if (!files || !files.length) return 0;
      let added = 0;
      const srcTag = (this.data.currentSource === "url") ? "file" : this.data.currentSource;
      for (const f of files) {
        if (!f || !f.type) continue;
        const isAudio = f.type.startsWith("audio/") || /\.(mp3|m4a|flac|wav|ogg|aac|opus)$/i.test(f.name);
        const isLrc = /\.lrc$/i.test(f.name) || f.type === "application/x-subrip" || f.type === "text/plain";
        if (isAudio) {
          const id = uid();
          try { await IDB.put(id, f); } catch (e) { toast("保存失败：" + (e.message || e)); continue; }
          this.data.tracks.push({
            id,
            kind: "file",
            name: f.name.replace(/\.[^.]+$/, ""),
            size: f.size, mime: f.type, duration: 0, lrc: "",
            source: srcTag || "file",
          });
          added++;
        } else if (isLrc) {
          // 尝试匹配同名音频
          const baseName = f.name.replace(/\.lrc$/i, "").toLowerCase();
          const text = await f.text();
          let matched = this.data.tracks.find((t) => t.name.toLowerCase() === baseName);
          if (!matched) matched = this.data.tracks[this.data.tracks.length - 1];
          if (matched) {
            matched.lrc = text;
            if (this.currentTrack() && this.currentTrack().id === matched.id) {
              this._lrcLines = parseLrc(text);
              this._lastLrcIdx = -1;
              MusicUI.renderLyrics();
            }
            toast(`歌词已绑定到《${matched.name}》`);
          }
        }
      }
      if (added > 0 && this.data.current < 0) this.data.current = 0;
      this.save();
      MusicUI.render();
      return added;
    },

    /** 在线导入：把一个远程 URL 加为曲目（不落 IDB）；source 可显式指定音源标签 */
    addUrl({ url, name, lrc, source } = {}) {
      if (!url) return null;
      if (!/^https?:\/\//i.test(url)) { toast("URL 必须以 http(s):// 开头"); return null; }
      const fname = name || decodeURIComponent(url.split("?")[0].split("#")[0].split("/").pop() || "远程音乐");
      let srcTag;
      if (typeof source === "string" && source.length) srcTag = source;
      else srcTag = (this.data.currentSource && this.data.currentSource !== "file" ? this.data.currentSource : "url");
      const id = uid();
      this.data.tracks.push({
        id,
        kind: "url",
        url,
        name: fname.replace(/\.[^.]+$/, ""),
        mime: "",
        duration: 0,
        lrc: lrc || "",
        source: srcTag,
      });
      if (this.data.current < 0) this.data.current = this.data.tracks.length - 1;
      this.save();
      MusicUI.render();
      return id;
    },

    async removeTrack(id) {
      const idx = this.data.tracks.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const track = this.data.tracks[idx];
      const wasCurrent = this.data.current === idx;
      this.data.tracks.splice(idx, 1);
      // 只有本地 file 类型才在 IDB 里有实体
      if (track && track.kind !== "url") { try { await IDB.del(id); } catch (_) {} }
      if (wasCurrent) {
        this.pause();
        this._revokeBlobUrl();
        this.audio && this.audio.removeAttribute("src");
        if (this.data.tracks.length) this.data.current = Math.min(idx, this.data.tracks.length - 1);
        else this.data.current = -1;
        this._lrcLines = [];
      } else if (this.data.current > idx) {
        this.data.current--;
      }
      this.save();
      MusicUI.render();
    },

    async clearAll() {
      this.pause();
      this._revokeBlobUrl();
      this.audio && this.audio.removeAttribute("src");
      // 只清 IDB 里的本地文件；URL 曲目无实体
      try { await IDB.clear(); } catch (_) {}
      this.data.tracks = []; this.data.current = -1;
      this._lrcLines = [];
      this.save();
      MusicUI.render();
    },

    async playIndex(idx) {
      if (idx < 0 || idx >= this.data.tracks.length) return;
      const t = this.data.tracks[idx];
      const audio = this.ensureAudio();
      this._revokeBlobUrl();

      if (t.kind === "url") {
        // 在线 URL：很多直链不带 CORS，浏览器会报“跨域不支持”而无法播放；改走同源流代理
        const raw = String(t.url || "").trim();
        const proxied = toSameOriginStreamUrl(raw);
        audio.removeAttribute("crossorigin");
        audio.src = proxied || raw;
      } else {
        let blob;
        try { blob = await IDB.get(t.id); } catch (_) {}
        if (!blob) { toast("本地文件已丢失，将从列表移除"); await this.removeTrack(t.id); return; }
        const url = URL.createObjectURL(blob);
        this._blobUrl = url;
        audio.src = url;
      }

      this.data.current = idx;
      this._lrcLines = parseLrc(t.lrc || "");
      this._lastLrcIdx = -1;
      try { await audio.play(); }
      catch (e) { toast("播放失败：" + (e.message || e) + (t.kind === "url" ? "（该在线源可能不允许跨域）" : "")); }
      this.save();
      MusicUI.render();
      MusicUI.renderLyrics();
    },

    setSource(id) {
      this.data.currentSource = id;
      this.save();
      MusicUI.render();
    },
    setFilter(id) {
      this.data.sourceFilter = id;
      this.save();
      MusicUI.render();
    },

    _revokeBlobUrl() {
      if (this._blobUrl) { try { URL.revokeObjectURL(this._blobUrl); } catch (_) {} this._blobUrl = null; }
    },

    async play() {
      if (!this.audio || !this.audio.src) {
        if (this.data.current < 0 && this.data.tracks.length) return this.playIndex(0);
        if (this.data.current >= 0) return this.playIndex(this.data.current);
        return;
      }
      if (this._ctx && this._ctx.state === "suspended") {
        try { await this._ctx.resume(); } catch (_) {}
      }
      try { await this.audio.play(); }
      catch (e) { toast("播放失败：" + (e.message || e)); }
    },
    pause() { this.audio && this.audio.pause(); },
    async togglePlay() {
      if (!this.audio || this.audio.paused) await this.play();
      else this.pause();
    },

    async next() {
      const len = this.data.tracks.length;
      if (!len) return;
      if (this.data.loop === "one") return this.playIndex(this.data.current);
      let nx;
      if (this.data.shuffle) {
        if (len === 1) nx = 0;
        else { do { nx = Math.floor(Math.random() * len); } while (nx === this.data.current); }
      } else {
        nx = (this.data.current + 1) % len;
        if (nx === 0 && this.data.loop === "none" && this.data.current === len - 1) { this.pause(); return; }
      }
      return this.playIndex(nx);
    },
    async prev() {
      const len = this.data.tracks.length;
      if (!len) return;
      if (this.audio && this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
      const nx = (this.data.current - 1 + len) % len;
      return this.playIndex(nx);
    },
    seek(t) { if (this.audio) this.audio.currentTime = t; },
    setVolume(v) {
      const vv = Math.max(0, Math.min(1, +v));
      this.data.volume = vv;
      if (this.audio) this.audio.volume = vv;
      this.save();
    },
    setShuffle(b) { this.data.shuffle = !!b; this.save(); MusicUI.render(); },
    cycleLoop() {
      const order = ["none", "all", "one"];
      const i = order.indexOf(this.data.loop);
      this.data.loop = order[(i + 1) % order.length];
      this.save();
      MusicUI.render();
    },
    setLyrics(id, lrc) {
      const t = this.data.tracks.find((x) => x.id === id);
      if (!t) return;
      t.lrc = lrc || "";
      if (this.currentTrack() && this.currentTrack().id === id) {
        this._lrcLines = parseLrc(lrc || "");
        this._lastLrcIdx = -1;
        MusicUI.renderLyrics();
      }
      this.save();
    },

    _onTime() {
      MusicUI.renderProgress();
      this._updateLyric();
    },
    _onEnded() {
      if (this.data.loop === "one") return this.playIndex(this.data.current);
      this.next();
    },

    /** 从 URL 拉取 .js 音源并写入 IndexedDB，加入自定义音源列表 */
    async importRemoteSource(url, displayName) {
      const u = (url || "").trim();
      if (!/^https?:\/\//i.test(u)) { toast("URL 必须以 http(s):// 开头"); return null; }
      toast("正在拉取音源脚本…");
      let text;
      try {
        const r = await fetch(u, { mode: "cors", credentials: "omit" });
        if (!r.ok) throw new Error(r.status + " " + r.statusText);
        text = await r.text();
      } catch (e) {
        toast("获取失败：" + (e.message || e) + "（若站点未放行 CORS，请改用同源直链或先下载再本地托管）");
        return null;
      }
      if (!text || text.length < 30) { toast("内容过短，可能不是有效脚本"); return null; }
      const id = sourceUid();
      const dispName = (displayName || "").trim()
        || decodeURIComponent(u.split("?")[0].split("#")[0].split("/").pop() || "").replace(/\.js$/i, "")
        || "自定义音源";
      try {
        await SCRIPT_IDB.put(id, { body: text, remoteUrl: u, name: dispName, fetchedAt: Date.now(), size: text.length });
      } catch (e) {
        toast("缓存失败：" + (e.message || e));
        return null;
      }
      this.data.customSources = this.data.customSources || [];
      this.data.customSources.push({ id, name: dispName, remoteUrl: u });
      this.save();
      MusicUI.refreshSourceSelect();
      toast("音源已在线导入并缓存 🎛");
      return id;
    },

    async removeCustomSource(rid) {
      const list = this.data.customSources || [];
      const idx = list.findIndex((x) => x.id === rid);
      if (idx < 0) return;
      list.splice(idx, 1);
      try { await SCRIPT_IDB.del(rid); } catch (_) {}
      for (const t of this.data.tracks) {
        if (t.source === rid) t.source = "file";
      }
      if (this.data.currentSource === rid) this.data.currentSource = "file";
      if (this.data.sourceFilter === rid) this.data.sourceFilter = "__all__";
      this.save();
      MusicUI.refreshSourceSelect();
      MusicUI.render();
      toast("已移除该在线音源");
    },

    _updateLyric() {
      if (!this._lrcLines || !this._lrcLines.length || !this.audio) return;
      const t = this.audio.currentTime;
      let idx = -1;
      for (let i = 0; i < this._lrcLines.length; i++) {
        if (this._lrcLines[i].t <= t) idx = i; else break;
      }
      if (idx !== this._lastLrcIdx) {
        this._lastLrcIdx = idx;
        MusicUI.highlightLyric(idx);
      }
    },
  };

  function getSourceDef(id) {
    const c = Music.data.customSources && Music.data.customSources.find((x) => x.id === id);
    if (c) {
      return {
        id: c.id, name: c.name, desc: "在线导入（脚本缓存在本机 IndexedDB）", file: null, isCustom: true, remoteUrl: c.remoteUrl,
      };
    }
    return BUILTIN_SOURCES.find((s) => s.id === id) || null;
  }
  function getSourceName(id) { return getSourceDef(id)?.name || id || ""; }

  /** 音乐统一 API（与当前页面同协议/同域，避免 HTTPS 页去请求 http:// 触发混合内容） */
  const MUSIC_API = (() => {
    try {
      const { protocol, origin } = window.location;
      if (protocol === "http:" || protocol === "https:") {
        return `${origin.replace(/\/$/, "")}/api/music`;
      }
    } catch (_) {}
    return "/api/music";
  })();

  async function fetchMusicSearch(platform, q, page = 1, pageSize = 25) {
    const r = await fetch(`${MUSIC_API}/search?${new URLSearchParams({
      platform,
      q,
      page: String(page),
      pageSize: String(pageSize),
    })}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || `HTTP ${r.status}`);
    return data;
  }

  async function fetchMusicPlayUrl(platform, id, quality = "128k") {
    const r = await fetch(`${MUSIC_API}/url?${new URLSearchParams({ platform, id, quality })}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || `HTTP ${r.status}`);
    return data.url;
  }

  function toSameOriginStreamUrl(upstreamUrl) {
    if (!upstreamUrl) return "";
    const u = String(upstreamUrl).trim();
    if (!/^https?:\/\//i.test(u)) return "";
    return `${MUSIC_API}/stream?${new URLSearchParams({ u })}`;
  }

  async function fetchMusicLyric(platform, id) {
    const r = await fetch(`${MUSIC_API}/lyric?${new URLSearchParams({ platform, id })}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || `HTTP ${r.status}`);
    return typeof data.lrc === "string" ? data.lrc : "";
  }

  const MUSIC_SEARCH_Q_KEY = "musicSearchLastQ";

  function getSearchQuality() {
    const sel = $("#music-search-quality");
    const v = sel && sel.value ? String(sel.value) : "128k";
    return v === "320k" ? "320k" : "128k";
  }

  const MSD_EMPTY_DEFAULT = `<p class="msd-empty-title">搜我所想~~ 😉</p>
    <p class="msd-empty-sub">已接入：<b>酷我 / 网易云 / QQ / 酷狗 / 咪咕</b> 搜索，<b>聚合</b> 为多源交错结果。单击选行、双击或 ▶ 播放；<b>词</b> 会尝试拉取歌词；<b>QQ</b> 仅搜索、试听需换源。<br><small>若某源超时，请换其它 Tab 或稍后重试。</small></p>`;

  /** 在线搜索加入列表时打的音源标签：优先当前选中的 LX 源，否则「在线 URL」 */
  function pickSourceTagForSearch() {
    const s = Music.data.currentSource;
    if (s && s !== "file" && s !== "url") return s;
    return "url";
  }

  // ===================== UI =====================
  const MusicUI = {
    inited: false,
    vizRaf: null,
    _searchHits: [],
    _searchPlatform: "kw",
    _searchType: "song",
    _searchPage: 1,
    _searchQuery: "",
    _searchIsEnd: true,
    _searchLoading: false,
    _searchSelIdx: -1,

    init() {
      if (this.inited) return;
      this.inited = true;

      const fab = $("#music-fab");
      const panel = $("#music-panel");
      $("#music-fab").addEventListener("click", () => this.toggle());
      $("#music-close").addEventListener("click", () => this.hide());

      $("#music-play").addEventListener("click", () => Music.togglePlay());
      $("#music-next").addEventListener("click", () => Music.next());
      $("#music-prev").addEventListener("click", () => Music.prev());
      $("#music-shuffle").addEventListener("click", () => Music.setShuffle(!Music.data.shuffle));
      $("#music-loop").addEventListener("click", () => Music.cycleLoop());

      const vol = $("#music-volume");
      vol.value = Music.data.volume;
      vol.addEventListener("input", (e) => Music.setVolume(e.target.value));

      const progress = $("#music-progress");
      progress.addEventListener("input", (e) => {
        if (!Music.audio || !Music.audio.duration) return;
        Music.seek((e.target.value / 1000) * Music.audio.duration);
      });

      // 文件导入
      const fileInput = $("#music-file-input");
      $("#music-add").addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async (e) => {
        const files = [...(e.target.files || [])];
        if (!files.length) return;
        toast(`正在导入 ${files.length} 个文件…`);
        await Music.addFiles(files);
        toast("导入完成 🎵");
        e.target.value = "";
      });

      // 在线导入
      const dlgUrl = $("#dialog-music-url");
      $("#music-add-url").addEventListener("click", () => {
        if (!dlgUrl) return;
        const f = dlgUrl.querySelector("form");
        f.reset();
        dlgUrl.showModal();
      });
      dlgUrl?.querySelector("form")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = Music.addUrl({
          url: (fd.get("url") || "").toString().trim(),
          name: (fd.get("name") || "").toString().trim(),
          lrc: (fd.get("lrc") || "").toString(),
        });
        if (id) {
          toast("已添加到播放列表");
          dlgUrl.close();
        }
      });

      // 在线导入音源脚本（URL → IndexedDB scripts）
      const dlgSrc = $("#dialog-music-source-url");
      $("#music-source-import")?.addEventListener("click", () => {
        if (!dlgSrc) return;
        const f = dlgSrc.querySelector("form");
        f?.reset();
        dlgSrc.showModal();
      });
      dlgSrc?.querySelector("form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const sid = await Music.importRemoteSource(
          (fd.get("url") || "").toString().trim(),
          (fd.get("name") || "").toString().trim(),
        );
        if (sid) dlgSrc.close();
      });

      // 音源切换 + 过滤（"全部"= 仅用于过滤，不作"当前源"）
      const srcSel = $("#music-source-select");
      if (srcSel && !srcSel._musicBound) {
        srcSel._musicBound = true;
        srcSel.addEventListener("change", (e) => {
          const v = e.target.value;
          Music.setFilter(v);
          if (v !== "__all__") Music.setSource(v);  // 选中具体源 → 也作为"当前源"标签
        });
      }
      this.refreshSourceSelect();
      $("#music-source-info")?.addEventListener("click", () => this.openSourceDialog());

      $("#music-open-search")?.addEventListener("click", () => this.openSearchModal());
      $("#music-search-fab")?.addEventListener("click", () => this.openSearchModal());
      const dlgSearch = $("#dialog-music-search");
      $("#music-search-modal-close")?.addEventListener("click", () => { try { dlgSearch?.close(); } catch (_) {} });
      $("#music-search-modal-go")?.addEventListener("click", () => this.doSearchModal());
      $("#music-search-modal-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); this.doSearchModal(); }
      });
      $("#music-search-modal-more")?.addEventListener("click", () => this.loadMoreSearch());
      dlgSearch?.addEventListener("keydown", (e) => this.onSearchModalKeydown(e));

      $(".msd-source-tabs")?.addEventListener("click", (e) => {
        const t = e.target.closest(".msd-src-tab");
        if (!t) return;
        if (t.dataset.available === "0") {
          toast("该平台网页版暂未接入，请先用「小蜗音乐」（酷我）");
          return;
        }
        $$(".msd-src-tab", dlgSearch || document).forEach((b) => b.classList.remove("active"));
        t.classList.add("active");
        this._searchPlatform = t.dataset.platform || "kw";
      });
      $(".msd-source-tabs")?.addEventListener("keydown", (e) => {
        const t = e.target.closest(".msd-src-tab");
        if (!t) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        if (t.dataset.available === "0") {
          e.preventDefault();
          toast("该平台网页版暂未接入，请先用「小蜗音乐」（酷我）");
        }
      });

      $(".msd-type-tabs")?.addEventListener("click", (e) => {
        const t = e.target.closest(".msd-type-tab");
        if (!t) return;
        $$(".msd-type-tab", dlgSearch || document).forEach((b) => b.classList.remove("active"));
        t.classList.add("active");
        this._searchType = t.dataset.searchType || "song";
        const plHint = $("#music-search-modal-playlist-hint");
        const table = $("#music-search-modal-table");
        const empty = $("#music-search-modal-empty");
        if (this._searchType === "playlist") {
          if (table) table.hidden = true;
          if (empty) empty.hidden = true;
          if (plHint) plHint.hidden = false;
          this.updateSearchFooter();
        } else {
          if (plHint) plHint.hidden = true;
          if (this._searchHits.length) {
            if (table) table.hidden = false;
            if (empty) empty.hidden = true;
          } else {
            if (table) table.hidden = true;
            if (empty) { empty.hidden = false; empty.innerHTML = MSD_EMPTY_DEFAULT; }
          }
          this.updateSearchFooter();
        }
      });

      $("#music-search-modal-tbody")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-act]");
        if (btn) {
          const act = btn.dataset.act;
          const idx = +btn.dataset.idx;
          if (!Number.isFinite(idx)) return;
          e.stopPropagation();
          if (act === "add") await this.addFromSearchHit(idx);
          else if (act === "play") await this.playFromSearchHit(idx);
          else if (act === "lrc") await this.addFromSearchHitWithLyric(idx);
          return;
        }
        const tr = e.target.closest("tr.msd-row");
        if (tr) {
          const idx = +tr.dataset.idx;
          if (Number.isFinite(idx)) this.selectSearchRow(idx, { scroll: true });
        }
      });
      $("#music-search-modal-tbody")?.addEventListener("dblclick", async (e) => {
        const tr = e.target.closest("tr.msd-row");
        if (!tr) return;
        const idx = +tr.dataset.idx;
        await this.playFromSearchHit(idx);
      });

      $("#music-clear").addEventListener("click", async () => {
        if (!Music.data.tracks.length) return;
        if (!confirm(`确定清空 ${Music.data.tracks.length} 首歌曲？`)) return;
        await Music.clearAll();
      });

      // 播放列表点击 / 删除 / 歌词绑定
      $("#music-list").addEventListener("click", async (e) => {
        const act = e.target.closest("button[data-act]");
        const item = e.target.closest(".music-track");
        if (!item) return;
        const id = item.dataset.tid;
        const idx = Music.data.tracks.findIndex((t) => t.id === id);
        if (act) {
          const a = act.dataset.act;
          if (a === "del") { e.stopPropagation(); await Music.removeTrack(id); return; }
          if (a === "lrc") {
            e.stopPropagation();
            const inp = document.createElement("input");
            inp.type = "file"; inp.accept = ".lrc,text/plain";
            inp.onchange = async () => {
              const f = inp.files && inp.files[0];
              if (!f) return;
              try {
                const text = await f.text();
                Music.setLyrics(id, text);
                toast("歌词已绑定");
              } catch (err) { toast("读取失败：" + err.message); }
            };
            inp.click();
            return;
          }
        }
        if (idx >= 0) Music.playIndex(idx);
      });

      // 拖拽导入
      panel.addEventListener("dragover", (e) => { e.preventDefault(); panel.classList.add("drag-in"); });
      panel.addEventListener("dragleave", (e) => {
        if (e.target === panel || !panel.contains(e.relatedTarget)) panel.classList.remove("drag-in");
      });
      panel.addEventListener("drop", async (e) => {
        e.preventDefault(); panel.classList.remove("drag-in");
        const files = [...(e.dataTransfer?.files || [])];
        if (files.length) { await Music.addFiles(files); toast("已添加 🎵"); }
      });

      this.render();
      // 若已有曲目，预加载当前（不自动播放）
      if (Music.data.tracks.length && Music.data.current >= 0) {
        Music.ensureAudio();
      }
    },

    isVisible() { return !$("#music-panel").hidden; },
    toggle() { this.isVisible() ? this.hide() : this.show(); },
    show() {
      const p = $("#music-panel"); p.hidden = false;
      $("#music-fab").classList.add("active");
      this.render();
      this.renderLyrics();
      this.startVisualizer();
    },
    hide() {
      $("#music-panel").hidden = true;
      $("#music-fab").classList.remove("active");
      this.stopVisualizer();
    },

    render() {
      const t = Music.currentTrack();
      const audio = Music.audio;
      const playing = audio && !audio.paused && audio.src;
      $("#music-play").textContent = playing ? "❚❚" : "▶";
      $("#music-title").textContent = t ? t.name : "— 没有歌曲 —";
      $("#music-meta").textContent = t
        ? `${fmtSize(t.size)} · ${(t.mime || "").split("/")[1] || "音频"}`
        : "导入本地音乐文件开始使用";

      // shuffle / loop 状态
      $("#music-shuffle").classList.toggle("active", !!Music.data.shuffle);
      const lb = $("#music-loop");
      lb.classList.toggle("active", Music.data.loop !== "none");
      lb.dataset.mode = Music.data.loop;
      lb.textContent = Music.data.loop === "one" ? "🔂" : "🔁";
      lb.title = { none: "关闭循环", all: "列表循环", one: "单曲循环" }[Music.data.loop];

      // 播放列表（按过滤器筛选）
      const list = $("#music-list");
      const filter = Music.data.sourceFilter || "__all__";
      const allTracks = Music.data.tracks;
      const visible = filter === "__all__"
        ? allTracks.map((t, i) => ({ t, i }))
        : allTracks.map((t, i) => ({ t, i })).filter(({ t }) => (t.source || "file") === filter);

      const countEl = $("#music-list-count");
      if (countEl) {
        countEl.textContent = filter === "__all__"
          ? (allTracks.length ? `(${allTracks.length})` : "")
          : `(${visible.length} / ${allTracks.length})`;
      }

      if (!allTracks.length) {
        list.innerHTML = `<li class="music-empty">
          点击右上角 <b>📁</b> 导入本地文件，或 <b>🌐</b> 添加在线 URL；<br>
          也可以直接拖拽音乐/LRC 文件到此面板。<br>
          <small>支持 mp3 · m4a · flac · wav · ogg · aac · opus</small>
        </li>`;
      } else if (!visible.length) {
        list.innerHTML = `<li class="music-empty">
          当前"${escapeHtml(getSourceName(filter))}"源下没有曲目。<br>
          <small>切换到"全部"即可看到其他源的歌曲。</small>
        </li>`;
      } else {
        list.innerHTML = visible.map(({ t, i }) => {
          const active = i === Music.data.current;
          const isUrl = t.kind === "url";
          const srcLabel = (t.source && t.source !== "file") ? `<span class="mt-source-badge">${escapeHtml(getSourceName(t.source))}</span>` : "";
          const sizeLabel = isUrl ? "在线" : fmtSize(t.size);
          return `<li class="music-track${active ? " active" : ""}" data-tid="${t.id}">
            <div class="mt-num">${active && playing ? "🎵" : i + 1}</div>
            <div class="mt-main">
              <div class="mt-name">${isUrl ? "🌐 " : ""}${escapeHtml(t.name)}</div>
              <div class="mt-sub">${srcLabel}${sizeLabel}${t.duration ? ` · ${fmtTime(t.duration)}` : ""}${t.lrc ? " · 🎤" : ""}</div>
            </div>
            <div class="mt-actions">
              <button data-act="lrc" title="绑定歌词 (.lrc)">📝</button>
              <button data-act="del" title="移除">✕</button>
            </div>
          </li>`;
        }).join("");
      }
      this.renderProgress();
    },

    openSearchModal() {
      const d = $("#dialog-music-search");
      if (!d) { toast("搜索组件未加载，请刷新页面"); return; }
      try {
        if (d.open) d.close();
      } catch (_) {}
      try {
        if (typeof d.showModal === "function") d.showModal();
        else d.setAttribute("open", "");
      } catch (err) {
        console.warn("showModal:", err);
        try { d.show(); } catch (_) { d.setAttribute("open", ""); }
      }
      try {
        const last = sessionStorage.getItem(MUSIC_SEARCH_Q_KEY);
        const inp = $("#music-search-modal-input");
        if (inp && last && !inp.value.trim()) inp.value = last;
      } catch (_) {}
      setTimeout(() => $("#music-search-modal-input")?.focus(), 80);
    },

    setSearchLoading(on) {
      this._searchLoading = !!on;
      const wrap = $("#music-search-modal-table-wrap");
      if (wrap) wrap.classList.toggle("msd-table-wrap--loading", !!on);
      this.updateSearchFooter();
    },

    updateSearchFooter() {
      const footer = $("#music-search-modal-footer");
      const status = $("#music-search-modal-status");
      const more = $("#music-search-modal-more");
      const table = $("#music-search-modal-table");
      if (!footer || !status || !more) return;
      const show = table && !table.hidden && this._searchHits.length > 0 && this._searchType === "song";
      footer.hidden = !show;
      if (!show) return;
      status.textContent = `第 ${this._searchPage} 页 · 共 ${this._searchHits.length} 条${this._searchIsEnd ? " · 已到底" : ""}`;
      more.disabled = this._searchLoading || this._searchIsEnd;
    },

    renderSearchModalTable() {
      const tbody = $("#music-search-modal-tbody");
      if (!tbody) return;
      tbody.innerHTML = this._searchHits.map((hit, i) => {
        const dur = (hit.durationMs != null && Number.isFinite(hit.durationMs))
          ? fmtTime(hit.durationMs / 1000)
          : "—";
        const sel = i === this._searchSelIdx ? " msd-row--sel" : "";
        return `<tr class="msd-row${sel}" data-idx="${i}">
          <td>${i + 1}</td>
          <td><span class="msd-name">${escapeHtml(hit.name)}</span> <span class="msd-plat">${escapeHtml(hit.platform)}</span></td>
          <td>${escapeHtml(hit.artists || "—")}</td>
          <td>${escapeHtml(hit.album || "—")}</td>
          <td>${dur}</td>
          <td><button type="button" class="msd-icon-btn" data-act="play" data-idx="${i}" title="播放">▶</button></td>
          <td><button type="button" class="mini-btn" data-act="add" data-idx="${i}">加入</button></td>
          <td><button type="button" class="msd-icon-btn" data-act="lrc" data-idx="${i}" title="加入并拉取歌词">词</button></td>
        </tr>`;
      }).join("");
      this.updateSearchFooter();
    },

    selectSearchRow(idx, opts) {
      const n = this._searchHits.length;
      if (!n) {
        this._searchSelIdx = -1;
        return;
      }
      this._searchSelIdx = Math.max(0, Math.min(idx, n - 1));
      const tbody = $("#music-search-modal-tbody");
      if (!tbody) return;
      $$("tr.msd-row", tbody).forEach((row, i) => {
        row.classList.toggle("msd-row--sel", i === this._searchSelIdx);
      });
      if (opts && opts.scroll) {
        const row = tbody.querySelector(`tr.msd-row[data-idx="${this._searchSelIdx}"]`);
        row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    },

    onSearchModalKeydown(e) {
      const dlg = $("#dialog-music-search");
      if (!dlg || !dlg.open) return;
      const tag = document.activeElement?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        try { dlg.close(); } catch (_) {}
        return;
      }

      if (this._searchType !== "song" || !this._searchHits.length) return;

      if (e.key === "ArrowDown") {
        if (inInput) return;
        e.preventDefault();
        const start = this._searchSelIdx < 0 ? -1 : this._searchSelIdx;
        this.selectSearchRow(start + 1, { scroll: true });
        return;
      }
      if (e.key === "ArrowUp") {
        if (inInput) return;
        e.preventDefault();
        const start = this._searchSelIdx < 0 ? 0 : this._searchSelIdx;
        this.selectSearchRow(start - 1, { scroll: true });
        return;
      }
      if (e.key === "Enter" && !inInput) {
        e.preventDefault();
        if (this._searchSelIdx >= 0) this.playFromSearchHit(this._searchSelIdx);
      }
    },

    async loadMoreSearch() {
      await this.runSearchModal(true);
    },

    async doSearchModal() {
      await this.runSearchModal(false);
    },

    async runSearchModal(append) {
      const inp = $("#music-search-modal-input");
      const tbody = $("#music-search-modal-tbody");
      const table = $("#music-search-modal-table");
      const empty = $("#music-search-modal-empty");
      const plHint = $("#music-search-modal-playlist-hint");
      if (!inp || !tbody || !table || !empty) return;

      if (this._searchType === "playlist") {
        table.hidden = true;
        empty.hidden = true;
        if (plHint) plHint.hidden = false;
        this.updateSearchFooter();
        return;
      }
      if (plHint) plHint.hidden = true;

      const q = inp.value.trim();
      if (!q) { toast("请输入关键词"); return; }

      if (append) {
        if (!this._searchQuery || q !== this._searchQuery) {
          toast("请先完成当前关键词的首次搜索");
          return;
        }
        if (this._searchIsEnd || this._searchLoading) return;
      }

      const platform = this._searchPlatform || "kw";
      const page = append ? this._searchPage + 1 : 1;
      const pageSize = 25;

      this.setSearchLoading(true);
      try {
        if (!append) toast("正在搜索…", 1200);
        else toast("加载更多…", 1000);

        const data = await fetchMusicSearch(platform, q, page, pageSize);
        const items = Array.isArray(data.items) ? data.items : [];

        if (!append) {
          this._searchHits = items;
          this._searchQuery = q;
          try { sessionStorage.setItem(MUSIC_SEARCH_Q_KEY, q); } catch (_) {}
          this._searchSelIdx = items.length ? 0 : -1;
        } else {
          const seen = new Set(this._searchHits.map((h) => `${h.platform}:${h.id}`));
          for (const it of items) {
            const k = `${it.platform}:${it.id}`;
            if (!seen.has(k)) {
              seen.add(k);
              this._searchHits.push(it);
            }
          }
        }

        this._searchPage = page;
        this._searchIsEnd = data.isEnd === true || items.length < pageSize;

        if (!this._searchHits.length) {
          table.hidden = true;
          tbody.innerHTML = "";
          empty.hidden = false;
          empty.innerHTML = `<p class="msd-empty-title">没有匹配结果</p><p class="msd-empty-sub">换个关键词试试</p>`;
          this.updateSearchFooter();
          return;
        }

        empty.hidden = true;
        table.hidden = false;
        this.renderSearchModalTable();
      } catch (e) {
        if (!append) {
          this._searchHits = [];
          this._searchQuery = "";
          this._searchSelIdx = -1;
          table.hidden = true;
          tbody.innerHTML = "";
          empty.hidden = false;
          empty.innerHTML = `<p class="msd-empty-title">搜索失败</p><p class="msd-empty-sub">${escapeHtml(e.message || e)}<br><small>请确认已 <b>docker compose up</b> 启动 music-api 与 nginx 反代。</small></p>`;
        } else {
          toast("加载失败：" + (e.message || e));
        }
      } finally {
        this.setSearchLoading(false);
      }
    },

    async addFromSearchHit(idx) {
      const hit = this._searchHits[idx];
      if (!hit?.id || !hit?.platform) { toast("数据无效"); return; }
      const title = hit.artists ? `${hit.name} — ${hit.artists}` : hit.name;
      const q = getSearchQuality();
      try {
        toast("正在解析直链…", 1500);
        const raw = await fetchMusicPlayUrl(hit.platform, hit.id, q);
        const url = toSameOriginStreamUrl(raw) || raw;
        Music.addUrl({ url, name: title, source: pickSourceTagForSearch() });
        toast("已加入播放列表");
      } catch (err) {
        toast("加入失败：" + (err.message || err));
      }
    },

    async addFromSearchHitWithLyric(idx) {
      const hit = this._searchHits[idx];
      if (!hit?.id || !hit?.platform) { toast("数据无效"); return; }
      const title = hit.artists ? `${hit.name} — ${hit.artists}` : hit.name;
      const q = getSearchQuality();
      try {
        toast("正在解析直链与歌词…", 2000);
        const [raw, lrc] = await Promise.all([
          fetchMusicPlayUrl(hit.platform, hit.id, q),
          fetchMusicLyric(hit.platform, hit.id),
        ]);
        const url = toSameOriginStreamUrl(raw) || raw;
        Music.addUrl({
          url,
          name: title,
          source: pickSourceTagForSearch(),
          lrc: (lrc && lrc.trim()) ? lrc : "",
        });
        if (lrc && lrc.trim()) toast("已加入（含歌词）");
        else toast("已加入（暂无歌词）");
      } catch (err) {
        toast("加入失败：" + (err.message || err));
      }
    },

    async playFromSearchHit(idx) {
      const hit = this._searchHits[idx];
      if (!hit?.id || !hit?.platform) { toast("数据无效"); return; }
      const title = hit.artists ? `${hit.name} — ${hit.artists}` : hit.name;
      const q = getSearchQuality();
      try {
        toast("正在解析并播放…", 1500);
        const raw = await fetchMusicPlayUrl(hit.platform, hit.id, q);
        const url = toSameOriginStreamUrl(raw) || raw;
        const id = Music.addUrl({ url, name: title, source: pickSourceTagForSearch() });
        const j = Music.data.tracks.findIndex((t) => t.id === id);
        if (j >= 0) await Music.playIndex(j);
      } catch (err) {
        toast("播放失败：" + (err.message || err));
      }
    },

    refreshSourceSelect() {
      const sel = $("#music-source-select");
      if (!sel) return;
      const want = Music.data.sourceFilter || "__all__";
      const addOpt = (parent, val, text) => {
        const o = document.createElement("option");
        o.value = val;
        o.textContent = text;
        parent.appendChild(o);
      };
      sel.textContent = "";
      addOpt(sel, "__all__", "全部");
      addOpt(sel, "file", "本地文件");
      addOpt(sel, "url", "在线 URL");
      const ogIn = document.createElement("optgroup");
      ogIn.label = "内置 LX Music 协议脚本";
      sel.appendChild(ogIn);
      for (const s of BUILTIN_SOURCES) {
        if (!s.file) continue;
        addOpt(ogIn, s.id, s.name);
      }
      const customs = Music.data.customSources || [];
      if (customs.length) {
        const ogC = document.createElement("optgroup");
        ogC.label = "在线导入";
        sel.appendChild(ogC);
        for (const c of customs) addOpt(ogC, c.id, c.name);
      }
      if ([...sel.options].some((o) => o.value === want)) sel.value = want;
      else {
        sel.value = "__all__";
        Music.data.sourceFilter = "__all__";
        Music.save();
      }
    },

    /** 打开音源说明 / 下载列表 */
    openSourceDialog() {
      const dlg = $("#dialog-music-source");
      const ul = $("#music-source-list");
      if (!dlg || !ul) return;
      const built = BUILTIN_SOURCES.map((s) => {
        const action = s.file
          ? `<a class="s-link" href="${escapeHtml(s.file)}" download target="_blank" rel="noopener">⇩ 下载脚本</a>`
          : `<span class="s-link" style="opacity:.5">—</span>`;
        return `<li>
          <div>
            <div class="s-name">${escapeHtml(s.name)}</div>
            <div class="s-desc">${escapeHtml(s.desc)}</div>
          </div>
          ${action}
        </li>`;
      }).join("");
      const customs = Music.data.customSources || [];
      const customHtml = customs.length
        ? `<li class="music-source-subtitle"><strong>在线导入</strong>（缓存在本机，可导出给 LX Music 客户端）</li>`
        + customs.map((c) => `<li class="music-source-custom">
          <div>
            <div class="s-name">${escapeHtml(c.name)}</div>
            <div class="s-desc">${escapeHtml(c.remoteUrl || "")}</div>
          </div>
          <div class="s-actions">
            <button type="button" class="s-link-btn" data-export-source="${escapeHtml(c.id)}">⇩ 导出 .js</button>
            <button type="button" class="s-link-btn danger" data-remove-source="${escapeHtml(c.id)}">移除</button>
          </div>
        </li>`).join("")
        : "";
      ul.innerHTML = built + customHtml;
      ul.onclick = async (e) => {
        const exp = e.target.closest("[data-export-source]");
        const rm = e.target.closest("[data-remove-source]");
        if (exp) {
          e.preventDefault();
          const id = exp.getAttribute("data-export-source");
          const rec = await SCRIPT_IDB.get(id);
          if (!rec || !rec.body) { toast("本地缓存不存在"); return; }
          const blob = new Blob([rec.body], { type: "text/javascript;charset=utf-8" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = ((rec.name || id).replace(/[\\/:*?"<>|]+/g, "_")) + ".js";
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          return;
        }
        if (rm) {
          e.preventDefault();
          const id = rm.getAttribute("data-remove-source");
          if (confirm("确定移除该在线导入的音源？已打此标签的曲目将改回「本地文件」分类。")) {
            await Music.removeCustomSource(id);
            this.openSourceDialog();
          }
        }
      };
      dlg.showModal();
    },

    renderProgress() {
      const a = Music.audio;
      const bar = $("#music-progress");
      const cur = $("#music-time-cur");
      const dur = $("#music-time-dur");
      if (!a || !a.duration) {
        bar.value = 0; cur.textContent = "00:00"; dur.textContent = "00:00"; return;
      }
      bar.value = Math.round((a.currentTime / a.duration) * 1000);
      cur.textContent = fmtTime(a.currentTime);
      dur.textContent = fmtTime(a.duration);
    },

    renderLyrics() {
      const box = $("#music-lyrics");
      if (!box) return;
      const lines = Music._lrcLines || [];
      if (!lines.length) {
        box.innerHTML = `<div class="lyric-empty">此曲暂无歌词，点列表上的 📝 绑定 .lrc</div>`;
        return;
      }
      box.innerHTML = lines.map((l, i) => `<div class="lyric-line" data-idx="${i}">${escapeHtml(l.text)}</div>`).join("");
    },

    highlightLyric(idx) {
      const box = $("#music-lyrics");
      if (!box) return;
      $$(".lyric-line", box).forEach((el) => el.classList.remove("active"));
      if (idx < 0) return;
      const el = box.querySelector(`.lyric-line[data-idx="${idx}"]`);
      if (el) {
        el.classList.add("active");
        const offset = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
        box.scrollTo({ top: offset, behavior: "smooth" });
      }
    },

    // 频谱可视化
    startVisualizer() {
      this.stopVisualizer();
      const cvs = $("#music-visualizer");
      if (!cvs) return;
      const dpr = window.devicePixelRatio || 1;
      const ctx2d = cvs.getContext("2d");
      const resize = () => {
        cvs.width = Math.floor(cvs.clientWidth * dpr);
        cvs.height = Math.floor(cvs.clientHeight * dpr);
      };
      resize();
      const draw = () => {
        this.vizRaf = requestAnimationFrame(draw);
        ctx2d.clearRect(0, 0, cvs.width, cvs.height);
        const accentRgb = (getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb") || "255,143,171").trim();
        if (!Music._analyser || !Music._dataArr) {
          // 无音频上下文时画呼吸圈
          const t = performance.now() / 1000;
          const r = 20 * dpr + Math.sin(t * 2) * 4 * dpr;
          ctx2d.beginPath();
          ctx2d.arc(cvs.width / 2, cvs.height / 2, r, 0, Math.PI * 2);
          ctx2d.fillStyle = `rgba(${accentRgb}, 0.18)`;
          ctx2d.fill();
          return;
        }
        Music._analyser.getByteFrequencyData(Music._dataArr);
        const bins = Music._dataArr.length;
        const w = cvs.width, h = cvs.height;
        const bars = 64;
        const step = Math.floor(bins / bars);
        const gap = 2 * dpr;
        const barW = (w - gap * (bars - 1)) / bars;
        const grad = ctx2d.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, `rgba(${accentRgb}, 0.35)`);
        grad.addColorStop(1, `rgba(${accentRgb}, 1)`);
        ctx2d.fillStyle = grad;
        for (let i = 0; i < bars; i++) {
          // 取该 bin 段的平均值
          let sum = 0;
          for (let j = 0; j < step; j++) sum += Music._dataArr[i * step + j] || 0;
          const v = sum / step / 255;
          const bh = Math.max(v * h * 0.92, 2 * dpr);
          const x = i * (barW + gap);
          const y = h - bh;
          const r = Math.min(barW / 2, 4 * dpr);
          // 圆角柱
          ctx2d.beginPath();
          ctx2d.moveTo(x + r, y);
          ctx2d.arcTo(x + barW, y, x + barW, y + bh, r);
          ctx2d.arcTo(x + barW, y + bh, x, y + bh, 0);
          ctx2d.lineTo(x, y + bh);
          ctx2d.lineTo(x, y + r);
          ctx2d.arcTo(x, y, x + r, y, r);
          ctx2d.closePath();
          ctx2d.fill();
        }
      };
      draw();
    },
    stopVisualizer() {
      if (this.vizRaf) { cancelAnimationFrame(this.vizRaf); this.vizRaf = null; }
    },
  };

  // 初始化（等 DOMContentLoaded，让 app.js 暴露 toast 后再 init）
  window.addEventListener("DOMContentLoaded", () => {
    Music.load();
    // 延迟到用户交互时才确保 audio 元素；此处仅绑定 UI
    MusicUI.init();
    // 全局快捷键：Alt+M 打开音乐；Esc 关闭；空格 播/停
    window.addEventListener("keydown", (e) => {
      const tag = document.activeElement?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
      if (!inInput && MusicUI.isVisible() && (e.ctrlKey && (e.key === "k" || e.key === "K") || (e.altKey && (e.key === "f" || e.key === "F")))) {
        e.preventDefault();
        MusicUI.openSearchModal();
        return;
      }
      if (e.altKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        MusicUI.toggle();
        return;
      }
      const dlgMusicSearch = document.getElementById("dialog-music-search");
      if (dlgMusicSearch && dlgMusicSearch.open) return;
      if (!MusicUI.isVisible()) return;
      if (e.key === "Escape" && !inInput) { MusicUI.hide(); return; }
      if (e.code === "Space" && !inInput) { e.preventDefault(); Music.togglePlay(); }
    });
  });

  window.Music = Music;
  window.MusicUI = MusicUI;
})();
