/* 樱 · 服务端媒体（与 sakura-remote 同源部署时启用）
 * POST /api/media/bg|music 由 nginx 注入 Bearer；GET 直链无需密钥（供 img/audio）
 */
(function () {
  "use strict";

  function enabled() {
    return window.SakuraRemote && typeof SakuraRemote.isRemote === "function" && SakuraRemote.isRemote();
  }

  function parseMediaRef(url) {
    if (!url || typeof url !== "string") return null;
    const m = /^\/api\/media\/file\/(bg|music)\/([^/?#]+)/.exec(url.trim());
    if (!m) return null;
    return { category: m[1], filename: decodeURIComponent(m[2]) };
  }

  async function removeByUrl(mediaUrl) {
    const ref = parseMediaRef(mediaUrl);
    if (!ref || !enabled()) return false;
    try {
      const r = await fetch(
        `/api/media/file/${ref.category}/${encodeURIComponent(ref.filename)}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      return r.ok;
    } catch (_) {
      return false;
    }
  }

  async function uploadBg(file) {
    if (!file || !enabled()) return null;
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/media/bg", { method: "POST", body: fd, credentials: "same-origin" });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(t || "背景上传失败 HTTP " + r.status);
    }
    return r.json();
  }

  async function uploadMusic(file) {
    if (!file || !enabled()) return null;
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/media/music", { method: "POST", body: fd, credentials: "same-origin" });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(t || "音乐上传失败 HTTP " + r.status);
    }
    return r.json();
  }

  window.SakuraMedia = {
    enabled,
    parseMediaRef,
    removeByUrl,
    uploadBg,
    uploadMusic,
  };
})();
