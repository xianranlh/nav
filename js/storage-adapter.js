/* Business data storage adapter.
 * In server mode, SakuraRemote intercepts these keys and persists them to SQLite.
 */
(function (root) {
  "use strict";

  const APP_STATE_KEY = "sakura_nav_v1";
  const SETTINGS_KEY = "sakura_nav_settings_v1";

  function readJson(storage, key) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      console.warn("[storage-adapter] read failed", key, e);
      return null;
    }
  }

  function writeJson(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  function createStorageAdapter(storage) {
    if (!storage) throw new Error("Storage adapter requires a storage backend");

    return {
      keys: Object.freeze({
        appState: APP_STATE_KEY,
        settings: SETTINGS_KEY,
      }),
      readJson: (key) => readJson(storage, key),
      writeJson: (key, value) => writeJson(storage, key, value),
      remove: (key) => storage.removeItem(key),
      readAppState: () => readJson(storage, APP_STATE_KEY),
      writeAppState: (state) => writeJson(storage, APP_STATE_KEY, state),
      readSettings: () => readJson(storage, SETTINGS_KEY),
      writeSettings: (settings) => writeJson(storage, SETTINGS_KEY, settings),
      clearBusinessData() {
        storage.removeItem(APP_STATE_KEY);
        storage.removeItem(SETTINGS_KEY);
      },
    };
  }

  const api = {
    APP_STATE_KEY,
    SETTINGS_KEY,
    createStorageAdapter,
  };

  if (root.localStorage) {
    api.adapter = createStorageAdapter(root.localStorage);
  }

  root.SakuraStorageAdapter = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
