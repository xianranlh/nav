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

  // ===================== LRC 解析 =====================
  /** 统一全角符号、去 BOM、部分客户端把整包 JSON 存成 .lrc */
  function preprocessLrcText(text) {
    let s = String(text || "").replace(/^\uFEFF/, "");
    const tr = s.trim();
    if (tr.startsWith("{")) {
      try {
        const j = JSON.parse(tr);
        if (typeof j.lyric === "string") s = j.lyric;
        else if (typeof j.lrc === "string") s = j.lrc;
        else if (j.data && typeof j.data.lyric === "string") s = j.data.lyric;
        else if (j.result && typeof j.result.lyric === "string") s = j.result.lyric;
      } catch (_) { /* 非 JSON，保持原样 */ }
    }
    s = s.replace(/［/g, "[").replace(/］/g, "]");
    s = s.replace(/(\[\d{1,3})[：](\d{1,2})/g, "$1:$2");
    return s;
  }

  /** 从 [mm:ss] / [mm:ss.xx] / [mm:ss:xx] 算秒；fraction 多为百分秒或毫秒 */
  function timeFromTag(mm, ss, fracRaw, mode) {
    const m = +mm;
    const sec = +ss;
    if (!fracRaw && fracRaw !== 0) return m * 60 + sec;
    const fr = String(fracRaw);
    const n = +fr;
    if (mode === "colon3") {
      if (n <= 99 && fr.length <= 2) return m * 60 + sec + n / 100;
      return m * 60 + sec + n / 1000;
    }
    return m * 60 + sec + parseInt((fr + "000").slice(0, 3), 10) / 1000;
  }

  /**
   * 两段 [mm:ss.xx]（允许标签内空格）；三段 [mm:ss:xx] 需先匹配，否则 [00:12:50] 会被误拆成 mm+ss+小数
   */
  const TAG_RE_2 = /\[\s*(\d{1,3})\s*:\s*(\d{1,2})\s*(?:[.:]\s*(\d{1,3}))?\s*\]/g;
  const TAG_RE_3 = /\[\s*(\d{1,3})\s*:\s*(\d{1,2})\s*:\s*(\d{1,3})\s*\]/g;

  /** 仅含 [mm:ss] 时间轴的标准 LRC */
  function parseLrcTimed(text) {
    const src = preprocessLrcText(text);
    if (!src) return [];
    const lines = [];
    for (const raw of src.split(/\r\n|\n|\r/)) {
      const line = raw.trim();
      if (!line) continue;
      const stamps = [];
      let lastEnd = 0;
      let m;

      TAG_RE_3.lastIndex = 0;
      const hasTriple = TAG_RE_3.test(line);
      TAG_RE_3.lastIndex = 0;

      if (hasTriple) {
        while ((m = TAG_RE_3.exec(line)) !== null) {
          stamps.push(timeFromTag(m[1], m[2], m[3], "colon3"));
          lastEnd = m.index + m[0].length;
        }
      } else {
        TAG_RE_2.lastIndex = 0;
        while ((m = TAG_RE_2.exec(line)) !== null) {
          stamps.push(timeFromTag(m[1], m[2], m[3], "dot"));
          lastEnd = m.index + m[0].length;
        }
      }

      if (!stamps.length) continue;

      let txt = line.slice(lastEnd).trim();
      txt = txt.replace(/<[\d:.,\s]+>/g, "").trim();
      if (stamps.length && txt) {
        for (const t of stamps) lines.push({ t, text: txt });
      }
    }
    lines.sort((a, b) => a.t - b.t);
    return lines;
  }

  /** 网易云等导出的「假 .lrc」：只有逐行歌词，无时间标签 */
  function extractPlainLyricLines(text) {
    const src = preprocessLrcText(text);
    if (!src) return [];
    return src.split(/\r\n|\n|\r/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  /**
   * 优先解析带时间轴的 LRC；否则退化为纯文本逐行展示（不与播放进度同步）
   */
  function parseLrc(text) {
    const timed = parseLrcTimed(text);
    if (timed.length) return timed;
    const plain = extractPlainLyricLines(text);
    if (!plain.length) return [];
    return plain.map((line) => ({ t: 0, text: line, plain: true }));
  }

  /**
   * 读取 .lrc 文本：网易云/本地下载常为 GBK；Windows 记事本另存可能是 UTF-16 LE
   * 用 UTF-8 直接读会导致乱码，时间轴匹配失败 → 界面仍显示「暂无歌词」
   */
  async function readLrcFileText(file) {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (!u8.length) return "";

    const decode = (enc) => {
      try {
        return new TextDecoder(enc, { fatal: false }).decode(u8);
      } catch (_) {
        return "";
      }
    };

    const score = (text) => parseLrc(text).length;

    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
      const t = decode("utf-16le");
      if (score(t) > 0) return t;
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
      const t = decode("utf-16be");
      if (score(t) > 0) return t;
    }

    let best = decode("utf-8");
    let bestN = score(best);
    for (const enc of ["gb18030", "gbk"]) {
      const t = decode(enc);
      const n = score(t);
      if (n > bestN) {
        best = t;
        bestN = n;
      }
    }
    return best;
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

  // ===================== 数据层 =====================
  const Music = {
    data: {
      tracks: [],        // [{id, kind:'file'|'url', name, size?, mime?, duration?, lrc, url?}]
      current: -1,
      shuffle: false,
      loop: "all",       // none | all | one
      volume: 0.75,
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
        if (!raw) return;
        const o = JSON.parse(raw);
        Object.assign(this.data, o);
        delete this.data.currentSource;
        delete this.data.sourceFilter;
        delete this.data.customSources;
        if (Array.isArray(this.data.tracks)) {
          for (const t of this.data.tracks) {
            if (t && typeof t === "object") delete t.source;
          }
        }
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
      const useServer = window.SakuraMedia && SakuraMedia.enabled && SakuraMedia.uploadMusic;
      // 先音频后歌词：同批多选时 OS 给出的顺序不定，避免 .lrc 先于 .mp3 被处理导致绑错/无效
      const ordered = [...files].sort((a, b) => {
        const al = a && /\.lrc$/i.test(a.name);
        const bl = b && /\.lrc$/i.test(b.name);
        if (al === bl) return 0;
        return al ? 1 : -1;
      });
      for (const f of ordered) {
        if (!f) continue;
        const isAudio = (f.type && f.type.startsWith("audio/")) || /\.(mp3|m4a|flac|wav|ogg|aac|opus)$/i.test(f.name);
        // Windows 下 .lrc 常为 file.type === ""，不能用 !f.type 直接跳过
        const isLrc = /\.lrc$/i.test(f.name) || f.type === "application/x-subrip" || f.type === "text/plain";
        if (isAudio) {
          if (useServer) {
            try {
              const up = await SakuraMedia.uploadMusic(f);
              if (up && up.url) {
                const id = uid();
                this.data.tracks.push({
                  id,
                  kind: "url",
                  url: up.url,
                  name: f.name.replace(/\.[^.]+$/, ""),
                  size: f.size,
                  mime: f.type,
                  duration: 0,
                  lrc: "",
                  storage: "server",
                });
                added++;
                continue;
              }
            } catch (e) {
              toast("服务端上传失败，改存本地：" + (e.message || e), 3500);
            }
          }
          const id = uid();
          try { await IDB.put(id, f); } catch (e) { toast("保存失败：" + (e.message || e)); continue; }
          this.data.tracks.push({
            id,
            kind: "file",
            name: f.name.replace(/\.[^.]+$/, ""),
            size: f.size, mime: f.type, duration: 0, lrc: "",
          });
          added++;
        } else if (isLrc) {
          const baseName = f.name.replace(/\.lrc$/i, "").toLowerCase();
          const text = await readLrcFileText(f);
          let matched = this.data.tracks.find((t) => t.name.toLowerCase() === baseName);
          if (!matched) matched = this.data.tracks[this.data.tracks.length - 1];
          if (matched) {
            await this._persistLyrics(matched, text, f.name);
            if (this.currentTrack() && this.currentTrack().id === matched.id) {
              this._lrcLines = parseLrc(text);
              this._lastLrcIdx = -1;
              MusicUI.renderLyrics();
            }
            toast(`歌词已绑定到《${matched.name}》`);
          } else {
            toast("请先导入与歌词同名的音频（例如 歌名.mp3 + 歌名.lrc）", 3200);
          }
        }
      }
      if (added > 0 && this.data.current < 0) this.data.current = 0;
      this.save();
      MusicUI.render();
      return added;
    },

    /** 在线导入：把一个远程 URL 加为曲目（不落 IDB） */
    addUrl({ url, name, lrc } = {}) {
      if (!url) return null;
      if (!/^https?:\/\//i.test(url)) { toast("URL 必须以 http(s):// 开头"); return null; }
      const fname = name || decodeURIComponent(url.split("?")[0].split("#")[0].split("/").pop() || "远程音乐");
      const id = uid();
      this.data.tracks.push({
        id,
        kind: "url",
        url,
        name: fname.replace(/\.[^.]+$/, ""),
        mime: "",
        duration: 0,
        lrc: lrc || "",
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
      if (track && track.storage === "server" && track.url && window.SakuraMedia && SakuraMedia.removeByUrl) {
        await SakuraMedia.removeByUrl(track.url);
      }
      if (track && track.lrcUrl && window.SakuraMedia && SakuraMedia.removeByUrl) {
        SakuraMedia.removeByUrl(track.lrcUrl).catch(() => {});
      }
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
      if (window.SakuraMedia && SakuraMedia.removeByUrl) {
        for (const t of this.data.tracks) {
          if (t && t.storage === "server" && t.url) await SakuraMedia.removeByUrl(t.url);
          if (t && t.lrcUrl) SakuraMedia.removeByUrl(t.lrcUrl).catch(() => {});
        }
      }
      // 只清 IDB 里的本地文件；外链 URL 曲目无实体
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
        const raw = String(t.url || "").trim();
        audio.removeAttribute("crossorigin");
        audio.src = raw;
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
      // 若服务端有歌词文件但本地 inline 为空，异步补回
      if (!t.lrc && t.lrcUrl && window.SakuraMedia && SakuraMedia.fetchLrcText) {
        SakuraMedia.fetchLrcText(t.lrcUrl).then((text) => {
          if (!text || this.currentTrack() !== t) return;
          t.lrc = text;
          this._lrcLines = parseLrc(text);
          this._lastLrcIdx = -1;
          this.save();
          MusicUI.renderLyrics();
        }).catch(() => {});
      }
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
    async setLyrics(id, lrc) {
      const t = this.data.tracks.find((x) => x.id === id);
      if (!t) return;
      await this._persistLyrics(t, lrc || "", (t.name || "lyric") + ".lrc");
      if (this.currentTrack() && this.currentTrack().id === id) {
        this._lrcLines = parseLrc(lrc || "");
        this._lastLrcIdx = -1;
        MusicUI.renderLyrics();
      }
      if (typeof MusicUI !== "undefined" && MusicUI.render) MusicUI.render();
    },

    /** 写入歌词：服务端模式下同时落盘到 /api/media/lrc，并清掉旧文件；总是保留 inline 文本作为兜底 */
    async _persistLyrics(track, text, filename) {
      track.lrc = text || "";
      const useServer = window.SakuraMedia && SakuraMedia.enabled && SakuraMedia.uploadLrc;
      if (useServer && text) {
        try {
          const prevUrl = track.lrcUrl;
          const up = await SakuraMedia.uploadLrc(text, filename);
          if (up && up.url) track.lrcUrl = up.url;
          if (prevUrl && prevUrl !== track.lrcUrl && SakuraMedia.removeByUrl) {
            SakuraMedia.removeByUrl(prevUrl).catch(() => {});
          }
        } catch (e) {
          console.warn("[music] 歌词落盘失败，已保留 inline 文本", e);
        }
      } else if (useServer && !text && track.lrcUrl && SakuraMedia.removeByUrl) {
        SakuraMedia.removeByUrl(track.lrcUrl).catch(() => {});
        delete track.lrcUrl;
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

    _updateLyric() {
      if (!this._lrcLines || !this._lrcLines.length || !this.audio) return;
      if (this._lrcLines[0] && this._lrcLines[0].plain) return;
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

  // ===================== UI =====================
  const MusicUI = {
    inited: false,
    vizRaf: null,

    init() {
      if (this.inited) return;
      const fab = $("#music-fab");
      const panel = $("#music-panel");
      if (!fab || !panel) return;
      this.inited = true;

      fab.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.toggle(); });
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

      const dlgLrc = $("#dialog-music-lrc");
      const formLrc = $("#form-music-lrc");
      const lrcFileInp = $("#music-lrc-file-input");
      const btnLrcFile = $("#music-lrc-from-file");

      function feedbackLrcBind(text) {
        const trimmed = String(text || "").trim();
        const parsed = parseLrc(text || "");
        if (!trimmed) toast("已清空歌词");
        else if (parsed.length > 0) {
          toast(parsed[0].plain
            ? `已绑定 ${parsed.length} 行（纯文本，无时间轴，仅展示）`
            : `歌词已绑定（${parsed.length} 行）`);
        } else toast("未能识别为歌词文本", 3000);
      }

      formLrc?.addEventListener("submit", (e) => {
        e.preventDefault();
        const tid = dlgLrc && dlgLrc.dataset.tid;
        if (!tid) return;
        const raw = (new FormData(formLrc).get("lrc") || "").toString();
        Music.setLyrics(tid, raw);
        feedbackLrcBind(raw);
        dlgLrc.close();
      });

      btnLrcFile?.addEventListener("click", () => lrcFileInp && lrcFileInp.click());
      lrcFileInp?.addEventListener("change", async () => {
        const f = lrcFileInp.files && lrcFileInp.files[0];
        lrcFileInp.value = "";
        if (!f || !formLrc) return;
        try {
          const text = await readLrcFileText(f);
          const ta = formLrc.querySelector("textarea[name=lrc]");
          if (ta) ta.value = text;
          toast("已从文件载入，可编辑后点「应用」");
        } catch (err) {
          toast("读取失败：" + err.message);
        }
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
            const dlgLrc = $("#dialog-music-lrc");
            const formLrc = $("#form-music-lrc");
            const ta = formLrc && formLrc.querySelector("textarea[name=lrc]");
            if (!dlgLrc || !formLrc || !ta) {
              const inp = document.createElement("input");
              inp.type = "file"; inp.accept = ".lrc,text/plain";
              inp.onchange = async () => {
                const f = inp.files && inp.files[0];
                if (!f) return;
                try {
                  const text = await readLrcFileText(f);
                  Music.setLyrics(id, text);
                  const parsed = parseLrc(text);
                  const n = parsed.length;
                  if (n > 0) {
                    toast(parsed[0].plain
                      ? `已绑定 ${n} 行（纯文本，无时间轴，仅展示）`
                      : `歌词已绑定（${n} 行）`);
                  } else toast("未能识别为歌词文本", 3000);
                } catch (err) { toast("读取失败：" + err.message); }
              };
              inp.click();
              return;
            }
            dlgLrc.dataset.tid = id;
            const tr = Music.data.tracks.find((x) => x.id === id);
            ta.value = tr && tr.lrc ? tr.lrc : "";
            dlgLrc.showModal();
            requestAnimationFrame(() => { try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} });
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
        ? (t.kind === "url"
          ? `在线 URL · ${(t.mime || "").split("/")[1] || "流式"}`
          : `${fmtSize(t.size)} · ${(t.mime || "").split("/")[1] || "音频"}`)
        : "导入本地音乐文件或添加在线 URL";

      // shuffle / loop 状态
      $("#music-shuffle").classList.toggle("active", !!Music.data.shuffle);
      const lb = $("#music-loop");
      lb.classList.toggle("active", Music.data.loop !== "none");
      lb.dataset.mode = Music.data.loop;
      lb.textContent = Music.data.loop === "one" ? "🔂" : "🔁";
      lb.title = { none: "关闭循环", all: "列表循环", one: "单曲循环" }[Music.data.loop];

      const list = $("#music-list");
      const allTracks = Music.data.tracks;
      const countEl = $("#music-list-count");
      if (countEl) countEl.textContent = allTracks.length ? `(${allTracks.length})` : "";

      if (!allTracks.length) {
        list.innerHTML = `<li class="music-empty">
          点击右上角 <b>📁</b> 导入本地文件，或 <b>🌐</b> 添加在线 URL；<br>
          也可以直接拖拽音乐/LRC 文件到此面板。<br>
          <small>支持 mp3 · m4a · flac · wav · ogg · aac · opus</small>
        </li>`;
      } else {
        list.innerHTML = allTracks.map((t, i) => {
          const active = i === Music.data.current;
          const isUrl = t.kind === "url";
          const sizeLabel = isUrl ? "在线" : fmtSize(t.size);
          return `<li class="music-track${active ? " active" : ""}" data-tid="${t.id}">
            <div class="mt-num">${active && playing ? "🎵" : i + 1}</div>
            <div class="mt-main">
              <div class="mt-name">${isUrl ? "🌐 " : ""}${escapeHtml(t.name)}</div>
              <div class="mt-sub">${sizeLabel}${t.duration ? ` · ${fmtTime(t.duration)}` : ""}${t.lrc ? " · 🎤" : ""}</div>
            </div>
            <div class="mt-actions">
              <button data-act="lrc" title="绑定歌词（粘贴 LRC 文本或 .lrc 文件）">📝</button>
              <button data-act="del" title="移除">✕</button>
            </div>
          </li>`;
        }).join("");
      }
      this.renderProgress();
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
        box.innerHTML = `<div class="lyric-empty">此曲暂无歌词，点列表上的 📝 粘贴或导入 .lrc</div>`;
        return;
      }
      if (lines[0].plain) {
        box.innerHTML = lines.map((l, i) => `<div class="lyric-line lyric-plain-line" data-idx="${i}">${escapeHtml(l.text)}</div>`).join("")
          + `<div class="lyric-plain-hint">纯文本歌词（无 [分:秒] 时间轴），仅展示，不与播放同步</div>`;
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
  window.addEventListener("DOMContentLoaded", async () => {
    if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
    Music.load();
    // 延迟到用户交互时才确保 audio 元素；此处仅绑定 UI
    MusicUI.init();
    // 全局快捷键：Alt+M 打开音乐；Esc 关闭；空格 播/停
    window.addEventListener("keydown", (e) => {
      const tag = document.activeElement?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
      if (e.altKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        MusicUI.toggle();
        return;
      }
      if (!MusicUI.isVisible()) return;
      if (e.key === "Escape" && !inInput) { MusicUI.hide(); return; }
      if (e.code === "Space" && !inInput) { e.preventDefault(); Music.togglePlay(); }
    });
  });

  window.Music = Music;
  window.MusicUI = MusicUI;
})();
