/* 🔄 同步 UI（服务端存储状态面板） — 自 app.js 拆分
 * 逻辑层：js/sync.js (window.Sync / SyncUtils) / js/sakura-remote.js
 * 由 app.js 通过 window.SyncUIFactory(UIContext) 实例化。
 */
(function () {
  "use strict";

  window.SyncUIFactory = function (ctx) {
    const { $, toast } = ctx;
  const UISync = (() => {
    let inited = false;

    function setStatus(msg, type = "") {
      const el = $("#sync-status");
      if (!el) return;
      el.textContent = msg;
      el.className = "hint settings-sync-status " + (type || "").trim();
    }

    function setV(id, v) { const el = $(id); if (el) el.value = v ?? ""; }
    function setC(id, v) { const el = $(id); if (el) el.checked = !!v; }
    function getV(id) { const el = $(id); return el ? el.value : ""; }
    function getC(id) { const el = $(id); return el ? !!el.checked : false; }

    function fillForm() {
      setV("#sync-backend", Sync.data.backend);
      setV("#sync-webdav-url", Sync.data.webdav.url);
      setV("#sync-webdav-user", Sync.data.webdav.user);
      setV("#sync-webdav-pass", Sync.data.webdav.pass);
      setV("#sync-webdav-path", Sync.data.webdav.path);
      setV("#sync-gist-token", Sync.data.gist.token);
      setV("#sync-gist-id", Sync.data.gist.gistId);
      setV("#sync-gist-file", Sync.data.gist.fileName || "sakura-nav.json");
      setC("#set-sync-auto", Sync.data.auto);
      setC("#set-sync-include-keys", Sync.data.includeAiKeys);
      setC("#set-sync-include-auth", Sync.data.includeAuthCred);
      toggleBackend();
      const msg = [];
      if (Sync.data.lastPushed) msg.push("上次上传：" + new Date(Sync.data.lastPushed).toLocaleString("zh-CN"));
      if (Sync.data.lastPulled) msg.push("上次下载：" + new Date(Sync.data.lastPulled).toLocaleString("zh-CN"));
      setStatus(msg.join(" · "));
      refreshRemotePanel();
    }
    async function refreshRemotePanel() {
      const panel = $("#sync-local-server-panel");
      if (!panel) return;
      try {
        if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
      } catch (_) {}
      const show =
        window.SakuraRemote &&
        typeof SakuraRemote.isRemote === "function" &&
        SakuraRemote.isRemote();
      panel.hidden = !show;
    }
    function toggleBackend() {
      const b = getV("#sync-backend");
      const w = $("#sync-webdav-conf");
      const g = $("#sync-gist-conf");
      if (w) w.hidden = b !== "webdav";
      if (g) g.hidden = b !== "gist";
    }
    function readFormWebdav() {
      Sync.data.backend = getV("#sync-backend");
      Sync.data.webdav.url = getV("#sync-webdav-url").trim();
      Sync.data.webdav.user = getV("#sync-webdav-user").trim();
      Sync.data.webdav.pass = getV("#sync-webdav-pass");
      Sync.data.webdav.path = getV("#sync-webdav-path").trim() || "sakura-nav.json";
      Sync.save();
    }
    function readFormGist() {
      Sync.data.backend = getV("#sync-backend");
      Sync.data.gist.token = getV("#sync-gist-token").trim();
      Sync.data.gist.gistId = getV("#sync-gist-id").trim();
      Sync.data.gist.fileName = getV("#sync-gist-file").trim() || "sakura-nav.json";
      Sync.save();
    }
    function readFormOptions() {
      Sync.data.auto = getC("#set-sync-auto");
      Sync.data.includeAiKeys = getC("#set-sync-include-keys");
      Sync.data.includeAuthCred = getC("#set-sync-include-auth");
      Sync.save();
    }

    function init() {
      if (inited) return;
      inited = true;
      fillForm();
      $("#sync-backend")?.addEventListener("change", toggleBackend);

      $("#form-sync-webdav")?.addEventListener("submit", (e) => {
        e.preventDefault();
        readFormWebdav();
        setStatus("已保存 WebDAV 配置", "success");
        toggleBackend();
      });
      $("#form-sync-gist")?.addEventListener("submit", (e) => {
        e.preventDefault();
        readFormGist();
        setStatus("已保存 Gist 配置", "success");
        toggleBackend();
      });
      $("#form-sync-options")?.addEventListener("submit", (e) => {
        e.preventDefault();
        readFormOptions();
        setStatus("已保存备份选项", "success");
      });

      $("#form-sync-push")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        // 推送前确保配置已写入（按当前选择的后端）
        if (getV("#sync-backend") === "webdav") readFormWebdav();
        else if (getV("#sync-backend") === "gist") readFormGist();
        readFormOptions();
        const p = window.NavProgress ? NavProgress.open("上传到云端（" + Sync.data.backend + "）") : null;
        p?.indeterminate(true);
        p?.setLabel("正在上传到云端…");
        try {
          setStatus("正在上传到云端…");
          await SyncUtils.push();
          setStatus("云端上传成功 · " + new Date().toLocaleString("zh-CN"), "success");
          p?.done("☁ 已上传到云端");
          toast("☁ 已上传到云端");
        } catch (e) {
          setStatus("上传失败：" + e.message, "error");
          p?.fail("上传失败：" + e.message);
          toast("上传失败");
        }
      });
      $("#form-sync-pull")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!confirm("从云端下载并覆盖本地数据？")) return;
        if (getV("#sync-backend") === "webdav") readFormWebdav();
        else if (getV("#sync-backend") === "gist") readFormGist();
        readFormOptions();
        const p = window.NavProgress ? NavProgress.open("从云端拉取（" + Sync.data.backend + "）") : null;
        p?.indeterminate(true);
        p?.setLabel("正在从云端下载…");
        try {
          setStatus("正在从云端下载…");
          await SyncUtils.pull();
          setStatus("云端已同步到本地 · " + new Date().toLocaleString("zh-CN"), "success");
          p?.done("☁ 已同步，正在刷新…");
          toast("☁ 已同步，正在刷新…");
          setTimeout(() => location.reload(), 800);
        } catch (e) {
          setStatus("下载失败：" + e.message, "error");
          p?.fail("下载失败：" + e.message);
        }
      });
      $("#form-sync-export")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const run = window.NavProgress ? NavProgress.run : (_t, fn) => fn({ step() {}, done() {} });
        run("导出本地备份 JSON", async (p) => {
          p.step(0.25, "收集数据…");
          const blob = SyncUtils.exportBlob();
          p.step(0.8, `下载文件 (${(blob.size / 1024).toFixed(1)} KB)…`);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `sakura-nav-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          p.done("已生成备份文件");
        });
      });

      $("#btn-sync-remote-push")?.addEventListener("click", async () => {
        const p = window.NavProgress ? NavProgress.open("上传到服务器") : null;
        p?.indeterminate(true);
        p?.setLabel("正在上传到服务器…");
        try {
          setStatus("正在上传到服务器…");
          if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
          if (!SakuraRemote?.pushNow) throw new Error("服务端同步不可用");
          await SakuraRemote.pushNow();
          setStatus("已保存到服务器 · " + new Date().toLocaleString("zh-CN"), "success");
          p?.done("已同步到服务器");
          toast("已同步到服务器");
        } catch (e) {
          setStatus(String(e.message || e), "error");
          p?.fail(String(e.message || e));
          toast("上传失败");
        }
      });
      $("#btn-sync-remote-pull")?.addEventListener("click", async () => {
        if (!confirm("从服务器拉取并覆盖当前页数据？未上传到服务器的本地修改将丢失。")) return;
        const p = window.NavProgress ? NavProgress.open("从服务器拉取") : null;
        p?.indeterminate(true);
        p?.setLabel("正在从服务器拉取…");
        try {
          setStatus("正在从服务器拉取…");
          if (window.SakuraRemote && SakuraRemote.ready) await SakuraRemote.ready;
          if (!SakuraRemote?.pullNow) throw new Error("服务端同步不可用");
          await SakuraRemote.pullNow();
          setStatus("已拉取并应用 · " + new Date().toLocaleString("zh-CN"), "success");
          p?.done("已同步，正在刷新…");
          toast("已同步，正在刷新…");
          setTimeout(() => location.reload(), 800);
        } catch (e) {
          setStatus(String(e.message || e), "error");
          p?.fail(String(e.message || e));
          toast("拉取失败");
        }
      });
    }
    return { init, fillForm, refreshRemotePanel };
  })();

    return UISync;
  };
})();
