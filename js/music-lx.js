/* 闲然导航 · 洛雪搜索 + 自定义音源 + AIMP 播放列表
 * 依赖：window.Music / MusicUI / Dlg / toast
 */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const toast = (m, ms) => window.toast ? window.toast(m, ms) : console.log(m);
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  const PLATS = [
    { id: "kw", name: "酷我" },
    { id: "kg", name: "酷狗" },
    { id: "wy", name: "网易" },
    { id: "tx", name: "QQ" },
    { id: "mg", name: "咪咕" },
    { id: "mix", name: "聚合" },
  ];

  const MusicLx = {
    platform: "mix",
    page: 1,
    q: "",
    items: [],
    loading: false,
    sources: [],

    init() {
      if (this._inited) return;
      this._inited = true;
      const searchBtn = $("#music-search");
      const srcBtn = $("#music-sources");
      if (searchBtn) searchBtn.addEventListener("click", () => this.openSearch());
      if (srcBtn) srcBtn.addEventListener("click", () => this.openSources());

      const dlg = $("#dialog-music-search");
      const form = $("#form-music-search");
      const runSearch = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        this.page = 1;
        this.search();
      };
      form?.addEventListener("submit", runSearch);
      $("#mlx-search-btn")?.addEventListener("click", runSearch);

      dlg?.querySelector(".mlx-plats")?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-plat]");
        if (!btn) return;
        this.setPlatform(btn.dataset.plat);
      });
      dlg?.querySelector(".mlx-plats")?.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const ids = PLATS.map((p) => p.id);
        const i = ids.indexOf(this.platform);
        const n = e.key === "ArrowRight" ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length;
        this.setPlatform(ids[n]);
        dlg.querySelector(`[data-plat="${ids[n]}"]`)?.focus();
      });

      $("#mlx-go-sources")?.addEventListener("click", () => this.openSources());

      $("#mlx-results")?.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]");
        const row = e.target.closest("[data-idx]");
        if (!row) return;
        const hit = this.items[Number(row.dataset.idx)];
        if (!hit) return;
        if (act?.dataset.act === "add") {
          e.stopPropagation();
          this.enqueue(hit, false);
          return;
        }
        this.enqueue(hit, true);
      });
      $("#mlx-results")?.addEventListener("keydown", (e) => {
        const row = e.target.closest("[data-idx]");
        if (!row) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target.closest("[data-act]")) return;
        e.preventDefault();
        const hit = this.items[Number(row.dataset.idx)];
        if (hit) this.enqueue(hit, true);
      });

      $("#mlx-more")?.addEventListener("click", () => {
        this.page += 1;
        this.search({ append: true });
      });

      $("#mlx-quality")?.addEventListener("change", (e) => {
        if (window.Music) {
          Music.data.quality = e.target.value;
          Music.save();
        }
      });

      const srcDlg = $("#dialog-music-sources");
      srcDlg?.querySelector("#mlx-import-script-url")?.addEventListener("click", () => this.importScriptUrl());
      srcDlg?.querySelector("#mlx-import-script-file")?.addEventListener("click", () => $("#mlx-script-file")?.click());
      $("#mlx-script-file")?.addEventListener("change", (e) => this.importScriptFile(e.target.files?.[0]));
      srcDlg?.querySelector("#mlx-import-api")?.addEventListener("click", () => this.importHttpApi());
      srcDlg?.querySelector("#mlx-import-playlist")?.addEventListener("click", () => $("#mlx-playlist-file")?.click());
      $("#mlx-playlist-file")?.addEventListener("change", async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f || !window.Music) return;
        await Music.addFiles([f]);
      });
      $("#mlx-source-list")?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-sid]");
        if (!btn) return;
        const id = btn.dataset.sid;
        if (btn.dataset.act === "del") this.removeSource(id);
        if (btn.dataset.act === "toggle") this.toggleSource(id, btn.dataset.on !== "1");
      });

      this.renderPlats();
    },

    openSearch() {
      const dlg = $("#dialog-music-search");
      if (!dlg) return;
      if (window.Music && $("#mlx-quality")) {
        $("#mlx-quality").value = Music.data.quality || "320k";
      }
      this.refreshSources().then(() => this.renderSourceHint());
      this.renderPlats();
      this.renderResults();
      Dlg.open(dlg);
      requestAnimationFrame(() => $("#mlx-q")?.focus());
    },

    openSources() {
      const dlg = $("#dialog-music-sources");
      if (!dlg) return;
      this.refreshSources().then(() => this.renderSourceList());
      Dlg.open(dlg);
    },

    setPlatform(id) {
      if (!id || id === this.platform) return;
      this.platform = id;
      this.page = 1;
      this.renderPlats();
      if (this.q) this.search();
    },

    renderPlats() {
      const box = $(".mlx-plats");
      if (!box) return;
      box.innerHTML = PLATS.map((p) => {
        const on = this.platform === p.id;
        return `<button type="button" class="chip mlx-tab${on ? " is-on" : ""}" role="radio" aria-checked="${on ? "true" : "false"}" data-plat="${p.id}">${p.name}</button>`;
      }).join("");
    },

    renderSourceHint() {
      const el = $("#mlx-source-hint");
      const banner = $("#mlx-banner");
      const n = this.sources.filter((s) => s.enabled).length;
      if (el) {
        el.textContent = n
          ? `已接入 ${n} 个音源 · 点一行即播`
          : "先接入音源，搜到的歌才能播放";
      }
      if (banner) banner.hidden = n > 0;
    },

    async refreshSources() {
      try {
        const r = await fetch("/api/music/sources");
        const data = await r.json();
        this.sources = data.items || [];
      } catch (_) {
        this.sources = [];
      }
      this.renderSourceHint();
      this.renderSourceList();
      return this.sources;
    },

    renderSourceList() {
      const box = $("#mlx-source-list");
      if (!box) return;
      if (!this.sources.length) {
        box.innerHTML = `<li class="mlx-src-empty">还没有音源。把洛雪用的 <code>.js</code> 脚本导入进来，或填一个 HTTP 音源 API。</li>`;
        return;
      }
      box.innerHTML = this.sources.map((s) => {
        const plats = Object.keys(s.platforms || {}).filter((k) => k !== "mix").join(" / ") || (s.type === "http-api" ? "HTTP" : "脚本");
        const kind = s.type === "http-api" ? "HTTP API" : "洛雪脚本";
        const alert = s.updateAlert && s.updateAlert.log
          ? `<div class="mlx-src-alert">${escapeHtml(s.updateAlert.log)}${
              s.updateAlert.updateUrl
                ? ` <a href="${escapeHtml(s.updateAlert.updateUrl)}" target="_blank" rel="noopener">去更新</a>`
                : ""
            }</div>`
          : "";
        return `<li class="mlx-src${s.enabled ? "" : " off"}">
          <div class="mlx-src-main">
            <div class="mlx-src-name">${escapeHtml(s.name)}</div>
            <div class="mlx-src-sub">${escapeHtml(kind)} · ${escapeHtml(plats)}${s.version ? " · v" + escapeHtml(s.version) : ""}</div>
            ${alert}
          </div>
          <div class="mlx-src-acts">
            <button type="button" data-sid="${s.id}" data-act="toggle" data-on="${s.enabled ? "1" : "0"}" aria-pressed="${s.enabled ? "true" : "false"}">${s.enabled ? "停用" : "启用"}</button>
            <button type="button" data-sid="${s.id}" data-act="del" aria-label="删除 ${escapeHtml(s.name)}">删除</button>
          </div>
        </li>`;
      }).join("");
    },

    async importScriptUrl() {
      const url = ($("#mlx-script-url")?.value || "").trim();
      if (!url) { toast("先填音源脚本地址"); return; }
      await this.postSource({ type: "lx-script", url });
      const inp = $("#mlx-script-url");
      if (inp) inp.value = "";
    },

    async importScriptFile(file) {
      const inp = $("#mlx-script-file");
      if (inp) inp.value = "";
      if (!file) return;
      const script = await file.text();
      await this.postSource({ type: "lx-script", name: file.name.replace(/\.js$/i, ""), script });
    },

    async importHttpApi() {
      const apiBase = ($("#mlx-api-base")?.value || "").trim();
      const name = ($("#mlx-api-name")?.value || "").trim();
      const preset = $("#mlx-api-preset")?.value || "query";
      if (!apiBase) { toast("先填 API 根地址"); return; }
      await this.postSource({ type: "http-api", apiBase, name: name || "HTTP 音源", preset });
      if ($("#mlx-api-base")) $("#mlx-api-base").value = "";
    },

    async postSource(body) {
      toast("正在导入音源…");
      try {
        const r = await fetch("/api/music/sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!data.ok) { toast(data.error || "导入失败", 3600); return; }
        toast("音源已接入：" + (data.source?.name || ""));
        await this.refreshSources();
      } catch (e) {
        toast("导入失败：" + (e.message || e));
      }
    },

    async removeSource(id) {
      if (!confirm("删除这个音源？")) return;
      await fetch("/api/music/sources/" + encodeURIComponent(id), { method: "DELETE" });
      await this.refreshSources();
    },

    async toggleSource(id, enabled) {
      await fetch("/api/music/sources/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await this.refreshSources();
    },

    async search({ append } = {}) {
      const q = ($("#mlx-q")?.value || "").trim();
      this.q = q;
      if (!q) { toast("输入歌名或歌手"); return; }
      this.loading = true;
      this.renderResults();
      try {
        const qs = new URLSearchParams({
          platform: this.platform,
          q,
          page: String(this.page),
          pageSize: "25",
        });
        const r = await fetch("/api/music/search?" + qs.toString(), { credentials: "same-origin" });
        const data = await r.json().catch(() => ({}));
        if (!r.ok && !data.items) {
          this.error = data.error || ("搜索失败 " + r.status);
          if (!append) this.items = [];
          toast(this.error);
        } else {
          const raw = data.items || data.list || data.data?.items || [];
          const items = Array.isArray(raw) ? raw.filter((x) => x && x.name) : [];
          this.items = append ? this.items.concat(items) : items;
          this.isEnd = !!data.isEnd;
          this.error = data.error || "";
          if (!this.items.length && this.error) toast(this.error);
          else if (!this.items.length) toast("没有搜到结果，换个词或曲库再试");
          else toast(`找到 ${this.items.length} 首`);
        }
      } catch (e) {
        this.error = e.message || String(e);
        if (!append) this.items = [];
        toast("搜索失败：" + this.error);
      } finally {
        this.loading = false;
        this.renderResults();
      }
    },

    renderResults() {
      const box = $("#mlx-results");
      const more = $("#mlx-more");
      if (!box) return;
      if (this.loading && !this.items.length) {
        box.innerHTML = `<div class="mlx-empty">正在搜「${escapeHtml(this.q)}」…</div>`;
        if (more) more.hidden = true;
        return;
      }
      if (!this.items.length) {
        const noHit = !!this.q && !this.loading;
        box.innerHTML = noHit
          ? `<div class="mlx-empty">
              <p>没有「${escapeHtml(this.q)}」的结果。</p>
              <p class="mlx-empty-note">${this.error ? escapeHtml(this.error) : "换个曲库，或改几个字再搜。"}</p>
            </div>`
          : `<div class="mlx-empty">
              <p>输入歌名或歌手，回车搜索。</p>
              <p class="mlx-empty-note">点一行即播，右侧「加入」只进列表。</p>
            </div>`;
        if (more) more.hidden = true;
        return;
      }
      const plat = Object.fromEntries(PLATS.map((p) => [p.id, p.name]));
      const rows = this.items.map((it, i) => {
        const dur = Number.isFinite(it.durationMs) && it.durationMs > 0
          ? fmt(it.durationMs / 1000)
          : "";
        const sub = [it.artists, it.album].filter(Boolean).join(" · ") || "未知艺人";
        const meta = [plat[it.platform] || it.platform, dur].filter(Boolean).join(" · ");
        return `<li class="mlx-hit" data-idx="${i}" tabindex="0" role="button" aria-label="播放 ${escapeHtml(it.name)}">
          <div class="mlx-hit-num">${i + 1}</div>
          <div class="mlx-hit-main">
            <div class="mlx-hit-name">${escapeHtml(it.name)}</div>
            <div class="mlx-hit-sub">${escapeHtml(sub)}</div>
          </div>
          <div class="mlx-hit-meta">${escapeHtml(meta)}</div>
          <div class="mlx-hit-acts">
            <button type="button" data-act="add" aria-label="加入 ${escapeHtml(it.name)}">加入</button>
          </div>
        </li>`;
      }).join("");
      box.innerHTML = `<div class="mlx-count">共 ${this.items.length} 首</div><ul class="mlx-hits">${rows}</ul>`;
      if (more) more.hidden = !!this.isEnd || this.loading;
    },

    enqueue(hit, play) {
      if (!window.Music) return;
      const id = Music.addLxTrack(hit, { play });
      if (!id) return;
      toast(play ? `正在播放「${hit.name}」` : `已加入「${hit.name}」`);
      if (play && window.MusicUI && !MusicUI.isVisible()) MusicUI.show();
    },
  };

  function fmt(s) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  const boot = () => MusicLx.init();
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("DOMContentLoaded", () => {
    window.addEventListener("keydown", (e) => {
      if (document.body.classList.contains("pre-auth")) return;
      const tag = document.activeElement?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
      if (e.altKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        if (window.MusicUI && !MusicUI.isVisible()) MusicUI.show();
        MusicLx.openSearch();
        return;
      }
      const dlg = $("#dialog-music-search");
      if (dlg?.open && e.key === "Enter" && inInput && document.activeElement?.id === "mlx-q") {
        /* form submit handles it */
      }
    });
  });

  window.MusicLx = MusicLx;
})();
