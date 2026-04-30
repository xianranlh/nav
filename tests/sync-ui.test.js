const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSyncStatus,
  getBackendVisibility,
  readWebdavForm,
  readGistForm,
  readSyncOptions,
  applyWebdavForm,
  applyGistForm,
  applySyncOptions,
} = require("../js/sync-ui.js");

function makeReader(values) {
  return (id) => values[id] ?? "";
}

test("sync UI helpers normalize WebDAV and Gist form data", () => {
  assert.deepEqual(
    readWebdavForm(makeReader({
      "#sync-backend": "webdav",
      "#sync-webdav-url": "  https://dav.example/remote.php/dav  ",
      "#sync-webdav-user": "  muxin  ",
      "#sync-webdav-pass": "secret",
      "#sync-webdav-path": "  backups/nav.json  ",
    })),
    {
      backend: "webdav",
      webdav: {
        url: "https://dav.example/remote.php/dav",
        user: "muxin",
        pass: "secret",
        path: "backups/nav.json",
      },
    },
  );

  assert.deepEqual(
    readGistForm(makeReader({
      "#sync-backend": "gist",
      "#sync-gist-token": "  ghp_token  ",
      "#sync-gist-id": "  abc123  ",
      "#sync-gist-file": "",
    })),
    {
      backend: "gist",
      gist: {
        token: "ghp_token",
        gistId: "abc123",
        fileName: "sakura-nav.json",
      },
    },
  );
});

test("sync UI helpers apply normalized data without replacing existing nested objects", () => {
  const syncData = {
    backend: "webdav",
    webdav: { url: "", user: "", pass: "", path: "old.json", keep: true },
    gist: { token: "old", gistId: "old-id", fileName: "old.json", keep: true },
    auto: false,
    includeAiKeys: false,
    includeAuthCred: false,
  };

  applyWebdavForm(syncData, {
    backend: "webdav",
    webdav: { url: "https://dav", user: "u", pass: "p", path: "nav.json" },
  });
  applyGistForm(syncData, {
    backend: "gist",
    gist: { token: "new", gistId: "gid", fileName: "file.json" },
  });
  applySyncOptions(syncData, { auto: true, includeAiKeys: true, includeAuthCred: false });

  assert.deepEqual(syncData.webdav, { url: "https://dav", user: "u", pass: "p", path: "nav.json", keep: true });
  assert.deepEqual(syncData.gist, { token: "new", gistId: "gid", fileName: "file.json", keep: true });
  assert.equal(syncData.backend, "gist");
  assert.equal(syncData.auto, true);
  assert.equal(syncData.includeAiKeys, true);
  assert.equal(syncData.includeAuthCred, false);
});

test("sync UI helpers derive visibility and status text", () => {
  assert.deepEqual(getBackendVisibility("webdav"), { webdavHidden: false, gistHidden: true });
  assert.deepEqual(getBackendVisibility("gist"), { webdavHidden: true, gistHidden: false });
  assert.deepEqual(getBackendVisibility("off"), { webdavHidden: true, gistHidden: true });

  assert.equal(
    buildSyncStatus(
      { lastPushed: 1710000000000, lastPulled: 1710003600000 },
      (ts) => `T${ts}`,
    ),
    "上次上传：T1710000000000 · 上次下载：T1710003600000",
  );
  assert.equal(buildSyncStatus({ lastPushed: 0, lastPulled: 0 }), "");
});

test("sync UI helper reads backup option checkboxes", () => {
  const readChecked = (id) => id === "#set-sync-auto" || id === "#set-sync-include-auth";

  assert.deepEqual(readSyncOptions(readChecked), {
    auto: true,
    includeAiKeys: false,
    includeAuthCred: true,
  });
});
