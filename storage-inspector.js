/* 樱 · 设置内「存储内容」
 * - 主视图：服务端 SQLite bundle 各 key（可下载/删除） + media 目录逐个文件（可下载/删除）
 * - 次视图：浏览器本地遗留（localStorage / IndexedDB）
 * - 动作：单项下载/删除、完整 ZIP 导出、ZIP 一键迁移导入、遗留数据迁移到服务端
 */
(function () {
  "use strict";

  const KNOWN_KEYS = {
    nav: { label: "导航数据", hint: "分组、链接、图标 URL" },
    settings: { label: "界面与组件设置", hint: "主题、背景、天气、樱花等" },
    blog: { label: "博客", hint: "文章与草稿" },
    calendar: { label: "日历与任务", hint: "事件、提醒、规则" },
    sync: { label: "同步配置", hint: "WebDAV / Gist 后端与参数" },
    ai: { label: "AI 配置", hint: "供应商与参数（Key 看是否选择上传）" },
    chat: { label: "AI 会话记录", hint: "最近若干条消息" },
    weather: { label: "天气", hint: "城市列表与缓存" },
    music: { label: "音乐播放列表元数据", hint: "曲目列表；音频/歌词文件在 media/" },
    authCred: { label: "账号密码哈希", hint: "自定义账号；删除后恢复默认内置账号" },
    schema: { label: "Schema 版本", hint: "bundle 结构版本号" },
    savedAt: { label: "最后保存时间", hint: "服务端最近一次写入" },
  };

  const LEGACY_KEYS = [
    { key: "sakura_nav_v1", label: "导航数据" },
    { key: "sakura_nav_settings_v1", label: "界面与组件设置" },
    { key: "sakura_nav_blog_v1", label: "博客" },
    { key: "sakura_nav_calendar_v1", label: "日历与任务" },
    { key: "sakura_nav_sync_v1", label: "同步配置" },
    { key: "sakura_nav_ai_v1", label: "AI 配置" },
    { key: "sakura_nav_chat_v1", label: "AI 会话记录" },
    { key: "sakura_nav_weather_v1", label: "天气" },
    { key: "sakura_nav_music_v1", label: "音乐播放列表元数据" },
    { key: "sakura_nav_token_v1", label: "登录会话 Token（仅本机）" },
    { key: "sakura_nav_auth_cred_v1", label: "账号密码哈希" },
  ];

  const toast = (m, ms) => (window.toast ? window.toast(m, ms) : null);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  const fmtBytes = (n) => {
    const x = +n || 0;
    if (x < 1024) return x + " B";
    if (x < 1024 * 1024) return (x / 1024).toFixed(1) + " KB";
    return (x / 1024 / 1024).toFixed(2) + " MB";
  };

  function summarizeValue(key, value) {
    if (value == null) return "（空）";
    try {
      if (key === "nav") {
        const links = (value.groups || []).reduce((s, g) => s + (g.links || []).length, 0);
        return `${(value.groups || []).length} 个分组，约 ${links} 个链接`;
      }
      if (key === "blog") return `文章约 ${(value.posts || []).length} 篇`;
      if (key === "calendar") return `事件约 ${(value.events || []).length} 条`;
      if (key === "chat") return `消息约 ${Array.isArray(value) ? value.length : 0} 条`;
      if (key === "weather") return `城市 ${(value.cities || []).length} 个`;
      if (key === "music") return `曲目 ${(value.tracks || []).length} 首`;
      if (key === "ai") return `供应商 ${(value.providers || []).length} 个`;
      if (key === "sync") return `后端：${value.backend || "-"}`;
      if (key === "savedAt") return new Date(value).toLocaleString("zh-CN");
      if (key === "authCred") return "已设置（哈希存储）";
      if (typeof value === "string") return `字符串（${value.length} 字符）`;
      return "对象";
    } catch (_) {
      return "-";
    }
  }

  async function fetchJson(url, opts) {
    const r = await fetch(url, Object.assign({ credentials: "same-origin" }, opts || {}));
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok) {
      let msg = "HTTP " + r.status;
      if (ct.includes("json")) {
        try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (_) {}
      }
      throw new Error(msg);
    }
    if (ct.includes("json")) return await r.json();
    return null;
  }

  function downloadUrl(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    a.click();
  }

  async function downloadKeyAsFile(key) {
    try {
      const r = await fetch("/api/data/key/" + encodeURIComponent(key), { credentials: "same-origin" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      downloadUrl(url, key + ".json");
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      toast("下载失败：" + (e.message || e), 3000);
    }
  }

  async function deleteKeyConfirm(key) {
    if (!confirm(`确定删除「${(KNOWN_KEYS[key] && KNOWN_KEYS[key].label) || key}」？此操作不可撤销。`)) return;
    try {
      await fetchJson("/api/data/key/" + encodeURIComponent(key), { method: "DELETE" });
      toast("已删除，正在刷新…");
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      toast("删除失败：" + (e.message || e), 3000);
    }
  }

  async function deleteMediaConfirm(cat, filename) {
    if (!confirm(`确定删除 media/${cat}/${filename}？`)) return;
    try {
      await fetchJson(`/api/media/file/${cat}/${encodeURIComponent(filename)}`, { method: "DELETE" });
      toast("已删除");
      refresh();
    } catch (e) {
      toast("删除失败：" + (e.message || e), 3000);
    }
  }

  function clearLegacyKey(key) {
    const msg = {
      sakura_nav_token_v1: "将退出登录，确定？",
      sakura_nav_auth_cred_v1: "将清除自定义账号信息，确定？",
    }[key] || "确定清除此项？";
    if (!confirm(msg)) return;
    try { localStorage.removeItem(key); } catch (e) { toast("清除失败：" + e.message, 3000); return; }
    if (key === "sakura_nav_token_v1") {
      try { sessionStorage.removeItem("sakura_nav_token_v1"); } catch (_) {}
      if (window.Auth && typeof Auth.logout === "function") Auth.logout();
      location.reload();
      return;
    }
    location.reload();
  }

  async function clearIdbStore(which) {
    const store = which === "music" ? (window.NavIDB && NavIDB.music) : (window.NavIDB && NavIDB.bg);
    const label = which === "music" ? "音乐文件" : "背景文件";
    if (!confirm(`将删除 IndexedDB 中所有 ${label}，确定？`)) return;
    try { if (store && store.clear) await store.clear(); } catch (e) { toast("清除失败：" + e.message, 3000); return; }
    location.reload();
  }

  /** 把 IndexedDB 里遗留的背景/音乐 Blob 上传到服务端，生成对应 URL */
  async function migrateIdbToServer() {
    if (!window.SakuraMedia || !SakuraMedia.enabled || !SakuraMedia.enabled()) {
      toast("未启用服务端模式（需 Docker / /api 可用）", 3000);
      return;
    }
    if (!confirm("将把浏览器 IndexedDB 中的背景/音乐文件上传到服务端，完成后可选择清空本地缓存。继续？")) return;

    const p = window.NavProgress ? NavProgress.open("迁移 IndexedDB 到服务端") : null;
    try {
      const bgKeys = window.NavIDB && NavIDB.bg ? await NavIDB.bg.keys() : [];
      const musicKeys = window.NavIDB && NavIDB.music ? await NavIDB.music.keys() : [];
      const total = bgKeys.length + musicKeys.length;
      if (!total) { p?.done("没有需要迁移的本地文件"); toast("没有需要迁移的文件"); return; }
      let done = 0;
      const migratedMusic = []; // [{oldKey, url}]

      let bgRemoteUrl = null;
      for (const k of bgKeys) {
        const blob = await NavIDB.bg.get(k);
        if (blob instanceof Blob) {
          const fname = (blob.name || String(k || "bg"));
          const f = new File([blob], fname, { type: blob.type || "application/octet-stream" });
          try {
            const up = await SakuraMedia.uploadBg(f);
            if (up && up.url && k === "bg-upload") bgRemoteUrl = up.url;
          } catch (e) { p?.log("背景上传失败: " + (e.message || e)); }
        }
        done++;
        p?.step(done / total, `迁移 ${done}/${total}：背景 ${k}`);
      }
      // 把 Store.settings.bgUpload 切到服务端 URL
      try {
        if (bgRemoteUrl && window.Store && Store.settings && Store.settings.bgUpload) {
          Store.settings.bgUpload = Object.assign({}, Store.settings.bgUpload, {
            storage: "server",
            remoteUrl: bgRemoteUrl,
          });
          Store.saveSettings();
        }
      } catch (_) {}
      for (const k of musicKeys) {
        const blob = await NavIDB.music.get(k);
        if (blob instanceof Blob) {
          const f = new File([blob], String(k || "music"), { type: blob.type || "audio/mpeg" });
          try {
            const up = await SakuraMedia.uploadMusic(f);
            if (up && up.url) migratedMusic.push({ oldKey: String(k), url: up.url });
          } catch (e) { p?.log("音乐上传失败: " + (e.message || e)); }
        }
        done++;
        p?.step(done / total, `迁移 ${done}/${total}：音乐 ${k}`);
      }

      // 更新 Music 播放列表元数据：把 kind: "file" 的 track 指向服务端 URL
      try {
        if (window.Music && Music.data && Array.isArray(Music.data.tracks)) {
          const map = new Map(migratedMusic.map((x) => [x.oldKey, x.url]));
          for (const t of Music.data.tracks) {
            if (t && t.kind === "file" && map.has(t.id)) {
              t.kind = "url";
              t.url = map.get(t.id);
              t.storage = "server";
            }
          }
          Music.save();
        }
      } catch (_) {}

      p?.done(`迁移完成：${total} 个文件已上传服务端`);
      toast("迁移完成，已上传到服务端");
      if (confirm("迁移成功。是否清空浏览器 IndexedDB 中的缓存以节省空间？")) {
        try { if (NavIDB && NavIDB.bg && NavIDB.bg.clear) await NavIDB.bg.clear(); } catch (_) {}
        try { if (NavIDB && NavIDB.music && NavIDB.music.clear) await NavIDB.music.clear(); } catch (_) {}
        location.reload();
      } else {
        refresh();
      }
    } catch (e) {
      p?.fail("迁移失败：" + (e.message || e));
      toast("迁移失败：" + (e.message || e), 4000);
    }
  }

  async function exportZip() {
    const p = window.NavProgress ? NavProgress.open("导出完整备份 ZIP") : null;
    p?.indeterminate(true);
    p?.setLabel("服务端打包中…");
    try {
      const r = await fetch("/api/export", { credentials: "same-origin" });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t || "HTTP " + r.status);
      }
      p?.setLabel("下载中…");
      const blob = await r.blob();
      p?.indeterminate(false);
      p?.step(1, `已生成 ZIP (${fmtBytes(blob.size)})`);
      const url = URL.createObjectURL(blob);
      const fn = `sakura-nav-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      downloadUrl(url, fn);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      p?.done(`已导出 (${fmtBytes(blob.size)})`);
      toast("已导出完整备份");
    } catch (e) {
      p?.fail("导出失败：" + (e.message || e));
      toast("导出失败：" + (e.message || e), 4000);
    }
  }

  async function importZip(file) {
    if (!file) return;
    if (!confirm(`确定用 ${file.name} (${fmtBytes(file.size)}) 替换当前服务端所有数据？此操作不可撤销。`)) return;
    const p = window.NavProgress ? NavProgress.open("从 ZIP 一键迁移") : null;
    p?.indeterminate(true);
    p?.setLabel("上传并解包中…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/import", { method: "POST", body: fd, credentials: "same-origin" });
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      const j = ct.includes("json") ? await r.json() : null;
      if (!r.ok) throw new Error((j && j.error) || "HTTP " + r.status);
      p?.indeterminate(false);
      const rc = (j && j.restored) || {};
      p?.done(`迁移成功：背景 ${rc.bg || 0} / 音乐 ${rc.music || 0} / 歌词 ${rc.lrc || 0}`);
      toast("迁移成功，正在刷新…");
      setTimeout(() => location.reload(), 1000);
    } catch (e) {
      p?.fail("迁移失败：" + (e.message || e));
      toast("迁移失败：" + (e.message || e), 4000);
    }
  }

  async function fetchInventory() {
    try {
      return await fetchJson("/api/inventory");
    } catch (_) {
      return null;
    }
  }

  async function fetchServerStats() {
    try {
      return await fetchJson("/api/storage-stats");
    } catch (_) {
      return null;
    }
  }

  function buildServerHtml(inv, stats) {
    let html = "";
    html += '<h4 class="storage-subh">🗄 服务端 SQLite（bundle 各项）</h4>';
    html += '<table class="storage-table"><thead><tr><th>键</th><th>体积</th><th>摘要</th><th style="min-width:140px"></th></tr></thead><tbody>';

    const keyOrder = ["nav", "settings", "blog", "calendar", "ai", "chat", "music", "weather", "sync", "authCred", "schema", "savedAt"];
    const seen = new Set();
    const byKey = new Map((inv.keys || []).map((k) => [k.key, k]));

    async function appendRow(kname) {
      if (seen.has(kname)) return;
      seen.add(kname);
      const meta = KNOWN_KEYS[kname] || { label: kname, hint: "" };
      const info = byKey.get(kname);
      const bytes = info ? info.bytes : 0;
      const isEmpty = !info || info.isEmpty || bytes === 0;
      html += `<tr>
        <td><strong>${esc(meta.label)}</strong><div class="hint" style="font-size:11px;margin-top:2px">${esc(meta.hint)}</div><code style="font-size:10px;opacity:.75">${esc(kname)}</code></td>
        <td>${isEmpty ? "（空）" : esc(fmtBytes(bytes))}</td>
        <td class="storage-sum" data-summary="${esc(kname)}">…</td>
        <td>
          <button type="button" class="mini-btn" data-srv-download="${esc(kname)}" ${isEmpty ? "disabled" : ""}>下载 JSON</button>
          <button type="button" class="mini-btn" data-srv-delete="${esc(kname)}" ${isEmpty ? "disabled" : ""}>删除</button>
        </td>
      </tr>`;
    }
    for (const k of keyOrder) appendRow(k);
    for (const item of (inv.keys || [])) appendRow(item.key);

    html += "</tbody></table>";

    for (const cat of ["bg", "music", "lrc"]) {
      const catLabel = { bg: "背景", music: "音乐", lrc: "歌词" }[cat];
      const files = (inv.media && inv.media[cat]) || [];
      html += `<h4 class="storage-subh">📁 媒体 · ${catLabel} <span class="hint" style="font-weight:400;font-size:12px">${files.length} 个</span></h4>`;
      if (!files.length) {
        html += `<p class="hint" style="font-size:12px;margin:6px 0 12px">此类别暂无文件。</p>`;
        continue;
      }
      html += '<table class="storage-table"><tbody>';
      for (const f of files) {
        html += `<tr>
          <td><code style="font-size:11px;word-break:break-all">${esc(f.filename)}</code></td>
          <td>${esc(fmtBytes(f.bytes))}</td>
          <td class="hint" style="font-size:11px">${esc(new Date(f.mtime || 0).toLocaleString("zh-CN"))}</td>
          <td style="min-width:140px">
            <a class="mini-btn" href="${esc(f.url)}" target="_blank" rel="noopener">下载</a>
            <button type="button" class="mini-btn" data-media-delete="${esc(cat)}/${esc(f.filename)}">删除</button>
          </td>
        </tr>`;
      }
      html += "</tbody></table>";
    }

    if (stats) {
      html += '<p class="hint" style="font-size:12px;margin-top:8px">数据目录：<code>' + esc(inv.dataDir || stats.dataDir || "") + "</code> · SQLite 负载 " + esc(fmtBytes((stats.sqlite && stats.sqlite.appDataJsonBytes) || 0)) + " · 媒体磁盘 " + esc(fmtBytes((stats.disk && stats.disk.mediaBytes) || 0)) + "</p>";
    }

    return html;
  }

  function buildLegacyHtml() {
    let html = '<h4 class="storage-subh">🌐 浏览器本地遗留（localStorage / IndexedDB）</h4>';
    const anyLocal = LEGACY_KEYS.some((r) => {
      try { return !!localStorage.getItem(r.key); } catch (_) { return false; }
    });
    html += '<table class="storage-table"><tbody>';
    let totalBytes = 0;
    for (const row of LEGACY_KEYS) {
      let raw = null;
      try { raw = localStorage.getItem(row.key); } catch (_) {}
      if (!raw) continue;
      const bytes = new Blob([raw]).size;
      totalBytes += bytes;
      html += `<tr>
        <td><strong>${esc(row.label)}</strong><code style="font-size:10px;display:block;opacity:.75">${esc(row.key)}</code></td>
        <td>${esc(fmtBytes(bytes))}</td>
        <td class="hint" style="font-size:11px">${row.key === "sakura_nav_token_v1" ? "会话令牌（永远只在本机）" : "应被服务端模式取代"}</td>
        <td><button type="button" class="mini-btn" data-ls-clear="${esc(row.key)}">清除</button></td>
      </tr>`;
    }
    html += "</tbody></table>";

    return { html, anyLocal, totalBytes };
  }

  async function buildIdbHtml() {
    let musicN = 0, bgN = 0;
    try { if (window.NavIDB && NavIDB.music && NavIDB.music.keys) musicN = (await NavIDB.music.keys()).length; } catch (_) {}
    try { if (window.NavIDB && NavIDB.bg && NavIDB.bg.keys) bgN = (await NavIDB.bg.keys()).length; } catch (_) {}
    const any = musicN + bgN > 0;
    let html = "";
    if (any) {
      html += '<h4 class="storage-subh">📦 浏览器 IndexedDB（遗留大文件）</h4>';
      html += '<table class="storage-table"><tbody>';
      html += `<tr><td><strong>音乐文件缓存</strong><div class="hint" style="font-size:11px">sakura-nav-music / tracks</div></td><td>—</td><td>${musicN} 个 Blob</td><td><button type="button" class="mini-btn" data-idb-clear="music" ${musicN ? "" : "disabled"}>清空</button></td></tr>`;
      html += `<tr><td><strong>背景文件缓存</strong><div class="hint" style="font-size:11px">sakura-nav-bg / files</div></td><td>—</td><td>${bgN} 个 Blob</td><td><button type="button" class="mini-btn" data-idb-clear="bg" ${bgN ? "" : "disabled"}>清空</button></td></tr>`;
      html += "</tbody></table>";
      if (window.SakuraMedia && SakuraMedia.enabled && SakuraMedia.enabled()) {
        html += `<div class="row" style="margin:6px 0 10px"><button type="button" class="btn-secondary" id="btn-legacy-migrate">⇪ 把 IndexedDB 文件搬到服务端</button></div>`;
      }
    }
    return { html, any };
  }

  async function refresh() {
    const mount = document.getElementById("storage-inspector-mount");
    if (!mount) return;

    mount.innerHTML = '<p class="hint" style="font-size:12px">正在加载…</p>';

    const remoteOn = window.SakuraRemote && SakuraRemote.isRemote && SakuraRemote.isRemote();
    const remoteHint = document.getElementById("storage-remote-hint");
    if (remoteHint) {
      if (remoteOn) {
        remoteHint.hidden = false;
        remoteHint.textContent = "当前已启用服务端存储（/api/data）。数据写入 SQLite，媒体文件存在服务器 media/ 目录。下方操作直接作用于服务端。";
      } else {
        remoteHint.hidden = false;
        remoteHint.textContent = "当前未启用服务端存储（纯静态 / API 不可用）。所有数据仅在浏览器 localStorage / IndexedDB 中。";
      }
    }

    let serverHtml = "";
    let inv = null, stats = null;
    if (remoteOn) {
      [inv, stats] = await Promise.all([fetchInventory(), fetchServerStats()]);
      if (inv) serverHtml = buildServerHtml(inv, stats);
      else serverHtml = '<p class="hint" style="font-size:12px">未能获取服务端清单（/api/inventory 无响应）。</p>';
    }

    const legacy = buildLegacyHtml();
    const idb = await buildIdbHtml();

    mount.innerHTML = serverHtml + legacy.html + idb.html;

    // 渲染摘要（按 key 拉取一次）
    if (inv) {
      const sumEls = mount.querySelectorAll("[data-summary]");
      for (const el of sumEls) {
        const key = el.getAttribute("data-summary");
        const info = (inv.keys || []).find((k) => k.key === key);
        if (!info || info.isEmpty) { el.textContent = "（空）"; continue; }
        try {
          const r = await fetch("/api/data/key/" + encodeURIComponent(key), { credentials: "same-origin" });
          if (r.ok) {
            const v = await r.json();
            el.textContent = summarizeValue(key, v);
          } else {
            el.textContent = "-";
          }
        } catch (_) { el.textContent = "-"; }
      }
    }

    mount.querySelectorAll("[data-srv-download]").forEach((b) => {
      b.addEventListener("click", () => downloadKeyAsFile(b.getAttribute("data-srv-download")));
    });
    mount.querySelectorAll("[data-srv-delete]").forEach((b) => {
      b.addEventListener("click", () => deleteKeyConfirm(b.getAttribute("data-srv-delete")));
    });
    mount.querySelectorAll("[data-media-delete]").forEach((b) => {
      b.addEventListener("click", () => {
        const v = b.getAttribute("data-media-delete");
        const [cat, ...rest] = v.split("/");
        deleteMediaConfirm(cat, rest.join("/"));
      });
    });
    mount.querySelectorAll("[data-ls-clear]").forEach((b) => {
      b.addEventListener("click", () => clearLegacyKey(b.getAttribute("data-ls-clear")));
    });
    mount.querySelectorAll("[data-idb-clear]").forEach((b) => {
      b.addEventListener("click", () => clearIdbStore(b.getAttribute("data-idb-clear")));
    });
    const mBtn = mount.querySelector("#btn-legacy-migrate");
    if (mBtn) mBtn.addEventListener("click", migrateIdbToServer);
  }

  window.StorageInspector = { refresh, exportZip, importZip };
})();
