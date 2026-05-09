/* 樱 · 统一 IndexedDB 助手
 *
 * 历史上有两个独立 DB：
 *   - "sakura-nav-bg"    ->  store "files"    （本地上传背景）
 *   - "sakura-nav-music" ->  store "tracks"   （音乐文件）
 *     v2 起曾有 store "scripts"（历史遗留，已不再使用）
 * 为了保持旧用户数据不丢，保留这两个 DB 不合并，只把"打开 + 增删改查"这一层提公共。
 *
 * 暴露：window.NavIDB = { bg, music }
 *   StoreLike: put(key, value) / get(key) / del(key) / clear() / keys()
 */
(function () {
  "use strict";

  const cache = new Map();

  function openDB(dbName, version, stores) {
    const cacheKey = `${dbName}@v${version}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const p = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("当前浏览器不支持 IndexedDB"));
      const req = indexedDB.open(dbName, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of stores) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { try { db.close(); } catch (_) {} };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
    cache.set(cacheKey, p);
    return p;
  }

  function makeStore(dbName, version, storeName, allStores) {
    const stores = allStores || [storeName];
    return {
      async put(key, value) {
        const db = await openDB(dbName, version, stores);
        return new Promise((res, rej) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).put(value, key);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
      },
      async get(key) {
        const db = await openDB(dbName, version, stores);
        return new Promise((res, rej) => {
          const tx = db.transaction(storeName, "readonly");
          const r = tx.objectStore(storeName).get(key);
          r.onsuccess = () => res(r.result || null);
          r.onerror = () => rej(r.error);
        });
      },
      async del(key) {
        const db = await openDB(dbName, version, stores);
        return new Promise((res, rej) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).delete(key);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
      },
      async clear() {
        const db = await openDB(dbName, version, stores);
        return new Promise((res, rej) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).clear();
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
      },
      async keys() {
        const db = await openDB(dbName, version, stores);
        return new Promise((res, rej) => {
          const tx = db.transaction(storeName, "readonly");
          const r = tx.objectStore(storeName).getAllKeys();
          r.onsuccess = () => res(r.result || []);
          r.onerror = () => rej(r.error);
        });
      },
    };
  }

  const MUSIC_DB = "sakura-nav-music";
  const MUSIC_VER = 2;
  const MUSIC_STORES = ["tracks", "scripts"];

  window.NavIDB = {
    bg: makeStore("sakura-nav-bg", 1, "files", ["files"]),
    music: makeStore(MUSIC_DB, MUSIC_VER, "tracks", MUSIC_STORES),
  };
})();
