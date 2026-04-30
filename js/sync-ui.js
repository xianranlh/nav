/* Sync settings UI helpers.
 * Pure form/data helpers live here so app.js keeps only DOM wiring.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SyncUI = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_FILE_NAME = "sakura-nav.json";

  function valueOf(readValue, id) {
    return readValue ? String(readValue(id) ?? "") : "";
  }

  function checkedOf(readChecked, id) {
    return !!(readChecked && readChecked(id));
  }

  function readWebdavForm(readValue) {
    return {
      backend: valueOf(readValue, "#sync-backend"),
      webdav: {
        url: valueOf(readValue, "#sync-webdav-url").trim(),
        user: valueOf(readValue, "#sync-webdav-user").trim(),
        pass: valueOf(readValue, "#sync-webdav-pass"),
        path: valueOf(readValue, "#sync-webdav-path").trim() || DEFAULT_FILE_NAME,
      },
    };
  }

  function readGistForm(readValue) {
    return {
      backend: valueOf(readValue, "#sync-backend"),
      gist: {
        token: valueOf(readValue, "#sync-gist-token").trim(),
        gistId: valueOf(readValue, "#sync-gist-id").trim(),
        fileName: valueOf(readValue, "#sync-gist-file").trim() || DEFAULT_FILE_NAME,
      },
    };
  }

  function readSyncOptions(readChecked) {
    return {
      auto: checkedOf(readChecked, "#set-sync-auto"),
      includeAiKeys: checkedOf(readChecked, "#set-sync-include-keys"),
      includeAuthCred: checkedOf(readChecked, "#set-sync-include-auth"),
    };
  }

  function applyWebdavForm(syncData, form) {
    if (!syncData || !form) return syncData;
    syncData.backend = form.backend;
    syncData.webdav = syncData.webdav || {};
    Object.assign(syncData.webdav, form.webdav || {});
    return syncData;
  }

  function applyGistForm(syncData, form) {
    if (!syncData || !form) return syncData;
    syncData.backend = form.backend;
    syncData.gist = syncData.gist || {};
    Object.assign(syncData.gist, form.gist || {});
    return syncData;
  }

  function applySyncOptions(syncData, options) {
    if (!syncData || !options) return syncData;
    syncData.auto = !!options.auto;
    syncData.includeAiKeys = !!options.includeAiKeys;
    syncData.includeAuthCred = !!options.includeAuthCred;
    return syncData;
  }

  function getBackendVisibility(backend) {
    return {
      webdavHidden: backend !== "webdav",
      gistHidden: backend !== "gist",
    };
  }

  function buildSyncStatus(syncData, formatDate) {
    const format = formatDate || ((ts) => new Date(ts).toLocaleString("zh-CN"));
    const msg = [];
    if (syncData && syncData.lastPushed) msg.push("上次上传：" + format(syncData.lastPushed));
    if (syncData && syncData.lastPulled) msg.push("上次下载：" + format(syncData.lastPulled));
    return msg.join(" · ");
  }

  return {
    DEFAULT_FILE_NAME,
    applyGistForm,
    applySyncOptions,
    applyWebdavForm,
    buildSyncStatus,
    getBackendVisibility,
    readGistForm,
    readSyncOptions,
    readWebdavForm,
  };
});
