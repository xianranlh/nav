/* 樱 · 设置内「存储内容」：分类展示 localStorage / IndexedDB /（可选）服务端 SQLite 体积 */
(function () {
  "use strict";

  const KNOWN_KEYS = [
    { key: "sakura_nav_v1", label: "导航数据", hint: "分组、链接、图标 URL" },
    { key: "sakura_nav_settings_v1", label: "界面与组件设置", hint: "主题、背景、天气、樱花等" },
    { key: "sakura_nav_blog_v1", label: "博客", hint: "文章与草稿" },
    { key: "sakura_nav_calendar_v1", label: "日历与任务", hint: "事件、提醒" },
    { key: "sakura_nav_sync_v1", label: "同步配置", hint: "WebDAV / Gist 等" },
    { key: "sakura_nav_ai_v1", label: "AI 配置", hint: "模型、Key（若已存本地）" },
    { key: "sakura_nav_chat_v1", label: "AI 会话记录", hint: "最近若干条消息" },
    { key: "sakura_nav_weather_v1", label: "天气", hint: "城市列表与缓存" },
    { key: "sakura_nav_music_v1", label: "音乐播放列表元数据", hint: "曲目列表；音频大文件在 IndexedDB" },
    { key: "sakura_nav_token_v1", label: "登录会话 Token", hint: "清除后将需重新登录" },
    { key: "sakura_nav_auth_cred_v1", label: "账号密码哈希", hint: "自定义账号；清除后恢复默认账号" },
  ];

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtBytes(n) {
    const x = +n || 0;
    if (x < 1024) return x + " B";
    if (x < 1024 * 1024) return (x / 1024).toFixed(1) + " KB";
    return (x / 1024 / 1024).toFixed(2) + " MB";
  }

  function summarizeNav(raw) {
    try {
      const o = JSON.parse(raw);
      let links = 0;
      (o.groups || []).forEach((g) => { links += (g.links || []).length; });
      return `${(o.groups || []).length} 个分组，约 ${links} 个链接`;
    } catch (_) {
      return "JSON 无效";
    }
  }

  function summarizeGeneric(raw, pick) {
    try {
      const o = JSON.parse(raw);
      return pick(o);
    } catch (_) {
      return "JSON 无效";
    }
  }

  function summarizeKey(key, raw) {
    if (!raw) return "（空）";
    switch (key) {
      case "sakura_nav_v1":
        return summarizeNav(raw);
      case "sakura_nav_settings_v1":
        return summarizeGeneric(raw, () => "主题等选项若干");
      case "sakura_nav_blog_v1":
        return summarizeGeneric(raw, (o) => `文章约 ${(o.posts || []).length} 篇`);
      case "sakura_nav_calendar_v1":
        return summarizeGeneric(raw, (o) => `事件约 ${(o.events || []).length} 条`);
      case "sakura_nav_sync_v1":
        return summarizeGeneric(raw, () => "同步后端与凭据占位");
      case "sakura_nav_ai_v1":
        return summarizeGeneric(raw, () => "AI 提供商与参数");
      case "sakura_nav_chat_v1":
        return summarizeGeneric(raw, (o) => `消息约 ${Array.isArray(o) ? o.length : 0} 条`);
      case "sakura_nav_weather_v1":
        return summarizeGeneric(raw, (o) => `城市 ${(o.cities || []).length} 个`);
      case "sakura_nav_music_v1":
        return summarizeGeneric(raw, (o) => `曲目 ${(o.tracks || []).length} 首`);
      case "sakura_nav_token_v1":
        return "会话令牌（短字符串）";
      case "sakura_nav_auth_cred_v1":
        return "凭据哈希（勿分享）";
      default:
        return `约 ${fmtBytes(new Blob([raw]).size)}`;
    }
  }

  function clearLocalKey(key) {
    const msg = {
      sakura_nav_token_v1: "将退出登录，确定？",
      sakura_nav_auth_cred_v1: "将清除自定义账号信息，确定？",
    }[key] || "确定清除此项？";

    if (!confirm(msg)) return;

    try {
      localStorage.removeItem(key);
    } catch (e) {
      window.toast && window.toast("清除失败：" + e.message, 3000);
      return;
    }

    if (key === "sakura_nav_token_v1") {
      try {
        sessionStorage.removeItem("sakura_nav_token_v1");
      } catch (_) {}
      if (window.Auth && typeof Auth.logout === "function") Auth.logout();
      location.reload();
      return;
    }

    const reloadKeys = new Set([
      "sakura_nav_v1",
      "sakura_nav_settings_v1",
      "sakura_nav_blog_v1",
      "sakura_nav_calendar_v1",
      "sakura_nav_sync_v1",
      "sakura_nav_ai_v1",
      "sakura_nav_chat_v1",
      "sakura_nav_weather_v1",
      "sakura_nav_music_v1",
      "sakura_nav_auth_cred_v1",
    ]);
    if (reloadKeys.has(key)) {
      location.reload();
      return;
    }
    window.toast && window.toast("已清除", 2000);
    refresh();
  }

  async function clearIdbMusic() {
    if (!confirm("将删除 IndexedDB 中所有已缓存的音乐文件，播放列表元数据仍可保留。确定？")) return;
    if (window.NavIDB && NavIDB.music && NavIDB.music.clear) {
      try {
        await NavIDB.music.clear();
      } catch (e) {
        window.toast && window.toast("清除失败：" + e.message, 3000);
        return;
      }
    }
    location.reload();
  }

  async function clearIdbBg() {
    if (!confirm("将删除 IndexedDB 中缓存的背景图/视频文件，确定？")) return;
    if (window.NavIDB && NavIDB.bg && NavIDB.bg.clear) {
      try {
        await NavIDB.bg.clear();
      } catch (e) {
        window.toast && window.toast("清除失败：" + e.message, 3000);
        return;
      }
    }
    location.reload();
  }

  async function fetchServerStats() {
    if (!location.protocol.startsWith("http")) return null;
    try {
      const r = await fetch("/api/storage-stats", { credentials: "same-origin" });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  }

  async function refresh() {
    const mount = document.getElementById("storage-inspector-mount");
    if (!mount) return;

    const remoteHint = document.getElementById("storage-remote-hint");
    if (remoteHint) {
      if (window.SakuraRemote && typeof SakuraRemote.isRemote === "function" && SakuraRemote.isRemote()) {
        remoteHint.hidden = false;
        remoteHint.textContent =
          "当前已使用同源 /api/data：导航等会同步到服务端 SQLite；下方 localStorage 在浏览器内可能被拦截为内存副本。清除本地键后刷新会从服务器再拉取。";
      } else {
        remoteHint.hidden = true;
      }
    }

    const knownSet = new Set(KNOWN_KEYS.map((k) => k.key));
    let html = '<table class="storage-table"><thead><tr><th>类别</th><th>体积</th><th>摘要</th><th></th></tr></thead><tbody>';

    for (const row of KNOWN_KEYS) {
      let raw = null;
      try {
        raw = localStorage.getItem(row.key);
      } catch (_) {}
      const bytes = raw ? new Blob([raw]).size : 0;
      html += `<tr>
        <td><strong>${esc(row.label)}</strong><div class="hint" style="font-size:11px;margin-top:2px">${esc(row.hint)}</div><code style="font-size:10px;opacity:.75">${esc(row.key)}</code></td>
        <td>${esc(fmtBytes(bytes))}</td>
        <td class="storage-sum">${esc(summarizeKey(row.key, raw))}</td>
        <td><button type="button" class="mini-btn" data-ls-clear="${esc(row.key)}">清除</button></td>
      </tr>`;
    }

    const extra = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith("sakura_") || knownSet.has(k)) continue;
        extra.push(k);
      }
    } catch (_) {}
    extra.sort();
    for (const k of extra) {
      let raw = null;
      try {
        raw = localStorage.getItem(k);
      } catch (_) {}
      const bytes = raw ? new Blob([raw]).size : 0;
      html += `<tr>
        <td><strong>其他</strong><code style="font-size:10px;display:block;margin-top:4px">${esc(k)}</code></td>
        <td>${esc(fmtBytes(bytes))}</td>
        <td>—</td>
        <td><button type="button" class="mini-btn" data-ls-clear="${esc(k)}">清除</button></td>
      </tr>`;
    }

    html += "</tbody></table>";

    html += '<h4 class="storage-subh">IndexedDB（大文件）</h4>';
    html += '<table class="storage-table"><tbody>';

    let musicN = 0;
    let bgN = 0;
    try {
      if (window.NavIDB && NavIDB.music && NavIDB.music.keys) {
        const keys = await NavIDB.music.keys();
        musicN = keys.length;
      }
    } catch (_) {}
    try {
      if (window.NavIDB && NavIDB.bg && NavIDB.bg.keys) {
        const keys = await NavIDB.bg.keys();
        bgN = keys.length;
      }
    } catch (_) {}

    html += `<tr>
      <td><strong>音乐文件缓存</strong><div class="hint" style="font-size:11px">sakura-nav-music / tracks</div></td>
      <td>—</td>
      <td>约 ${musicN} 个 Blob</td>
      <td><button type="button" class="mini-btn" id="storage-clear-idb-music" ${musicN ? "" : "disabled"}>清空</button></td>
    </tr>`;
    html += `<tr>
      <td><strong>背景文件缓存</strong><div class="hint" style="font-size:11px">sakura-nav-bg / files</div></td>
      <td>—</td>
      <td>约 ${bgN} 个 Blob</td>
      <td><button type="button" class="mini-btn" id="storage-clear-idb-bg" ${bgN ? "" : "disabled"}>清空</button></td>
    </tr>`;
    html += "</tbody></table>";

    const srv = await fetchServerStats();
    if (srv && srv.sqlite) {
      html += '<h4 class="storage-subh">服务端（Docker / Node 数据目录）</h4>';
      html += '<table class="storage-table"><tbody>';
      html += `<tr><td><strong>SQLite 导航包</strong></td><td>${esc(fmtBytes(srv.sqlite.appDataJsonBytes || 0))}</td><td>app_data.payload（JSON）</td><td>—</td></tr>`;
      html += `<tr><td><strong>媒体元数据表</strong></td><td>—</td><td>media_files 约 ${srv.sqlite.mediaMetaRows || 0} 行</td><td>—</td></tr>`;
      html += `<tr><td><strong>磁盘 media 目录</strong></td><td>${esc(fmtBytes(srv.disk && srv.disk.mediaBytes))}</td><td>背景 ${srv.disk.bgFiles || 0} 个 · 音乐 ${srv.disk.musicFiles || 0} 个</td><td>—</td></tr>`;
      html += `<tr><td colspan="4" class="hint" style="font-size:11px">数据目录：<code>${esc(srv.dataDir || "")}</code>（宿主机挂载卷）</td></tr>`;
      html += "</tbody></table>";
    } else if (location.protocol.startsWith("http")) {
      html += '<p class="hint" style="font-size:12px">未获取到服务端统计（纯静态打开、或未走 Docker /api）。</p>';
    }

    mount.innerHTML = html;

    mount.querySelectorAll("[data-ls-clear]").forEach((btn) => {
      btn.addEventListener("click", () => clearLocalKey(btn.getAttribute("data-ls-clear")));
    });
    const bm = mount.querySelector("#storage-clear-idb-music");
    const bb = mount.querySelector("#storage-clear-idb-bg");
    if (bm) bm.addEventListener("click", () => clearIdbMusic());
    if (bb) bb.addEventListener("click", () => clearIdbBg());
  }

  window.StorageInspector = { refresh };
})();
