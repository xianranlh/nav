/* 闲然导航 · 宠物配置 v3
 * - v3 只保存媒体 URL，不把 data:image 塞进服务端 bundle
 * - v2 自定义图片先上传 /api/media/pet，成功后才切换 v3
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.window === root) root.SakuraPetConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const SAVE_KEY = "sakura_pet_v3";
  const V2_KEY = "sakura_pet_v2";
  const LEGACY_KEY = "sakura-pet@1";
  const BUILTIN_SKIN = {
    kind: "builtin",
    id: "astral-xiaoying",
    url: "assets/pet/xiaoying-sheet.png",
    mediaFilename: null,
  };

  const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
  const validScale = (value) => ["sm", "md", "lg"].includes(value) ? value : "md";
  const validMode = (value) => value === "patrol" ? "patrol" : "guard";
  const validFrequency = (value) => ["quiet", "normal", "lively"].includes(value) ? value : "normal";

  function defaults() {
    return {
      schemaVersion: 3,
      name: "小樱",
      skin: { ...BUILTIN_SKIN },
      homeWidget: true,
      activityMode: "guard",
      homeScale: "md",
      anchor: { xRatio: 0.88, yRatio: 0.08 },
      speechFrequency: "normal",
      showStatusBadge: true,
      quickActions: ["todo", "calendar", "knowledge", "settings"],
      updatedAt: 0,
    };
  }

  function normalizeV3(input) {
    const source = input && typeof input === "object" ? input : {};
    const base = defaults();
    const skin = source.skin && source.skin.kind === "custom" && /^\/api\/media\/file\/pet\//.test(String(source.skin.url || ""))
      ? {
          kind: "custom",
          id: String(source.skin.id || "custom").slice(0, 80),
          url: String(source.skin.url),
          mediaFilename: String(source.skin.mediaFilename || "").slice(0, 160) || null,
        }
      : { ...BUILTIN_SKIN };
    const quickActions = Array.isArray(source.quickActions)
      ? [...new Set(source.quickActions.map(String).filter((item) => ["todo", "calendar", "ai", "knowledge", "recent-note", "settings"].includes(item)))].slice(0, 4)
      : base.quickActions;
    return {
      schemaVersion: 3,
      name: String(source.name || (skin.kind === "custom" ? "我的宠物" : "小樱")).trim().slice(0, 12) || "小樱",
      skin,
      homeWidget: source.homeWidget !== false,
      activityMode: validMode(source.activityMode),
      homeScale: validScale(source.homeScale),
      anchor: {
        xRatio: clamp(source.anchor?.xRatio ?? base.anchor.xRatio, 0, 1),
        yRatio: clamp(source.anchor?.yRatio ?? base.anchor.yRatio, 0, 1),
      },
      speechFrequency: validFrequency(source.speechFrequency),
      showStatusBadge: source.showStatusBadge !== false,
      quickActions: Array.isArray(source.quickActions) ? quickActions : base.quickActions,
      updatedAt: Number(source.updatedAt || 0),
    };
  }

  function migrateV2(input, viewport = {}) {
    const source = input && typeof input === "object" ? input : {};
    const width = Math.max(1, Number(viewport.width || root?.innerWidth || 1440));
    const height = Math.max(1, Number(viewport.height || root?.innerHeight || 900));
    const next = normalizeV3({
      name: source.name,
      homeWidget: source.homeWidget,
      activityMode: source.activityMode,
      homeScale: source.homeScale,
      anchor: {
        xRatio: typeof source.homeX === "number" ? clamp(source.homeX / width, 0, 1) : 0.88,
        yRatio: typeof source.homeY === "number" ? clamp(source.homeY / height, 0, 1) : 0.08,
      },
    });
    const legacyDataUrl = source.custom && /^data:image\/(?:png|jpeg|webp);/i.test(String(source.custom.img || ""))
      ? String(source.custom.img)
      : "";
    if (legacyDataUrl) {
      Object.defineProperty(next, "_legacyDataUrl", { value: legacyDataUrl, enumerable: false, configurable: true });
    }
    return next;
  }

  function readJson(storage, key) {
    try {
      const raw = storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function persistV3(storage, config) {
    const clean = normalizeV3(config);
    clean.updatedAt = Date.now();
    const raw = JSON.stringify(clean);
    if (/data:image\//i.test(raw)) throw new Error("PetConfigV3 不能包含 Data URL");
    storage?.setItem(SAVE_KEY, raw);
    try { storage?.removeItem(V2_KEY); } catch (_) {}
    try { storage?.removeItem(LEGACY_KEY); } catch (_) {}
    return clean;
  }

  function dispatchConfig(config) {
    if (!root || typeof root.dispatchEvent !== "function") return;
    try { root.dispatchEvent(new root.CustomEvent("sakura-pet-config", { detail: config })); } catch (_) {}
    try {
      const channel = new root.BroadcastChannel("sakura-pet-config");
      channel.postMessage(config);
      channel.close();
    } catch (_) {}
  }

  function dataUrlToBlob(dataUrl) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ""));
    if (!match) throw new Error("旧宠物图片格式无效");
    const binary = root.atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new root.Blob([bytes], { type: match[1] });
  }

  async function uploadCustomImage(value, filename = "pet.png", fetchImpl = root.fetch?.bind(root)) {
    if (typeof fetchImpl !== "function") throw new Error("浏览器不支持上传");
    const blob = typeof value === "string" ? dataUrlToBlob(value) : value;
    if (!blob || typeof blob.size !== "number") throw new Error("宠物图片无效");
    const form = new root.FormData();
    form.append("file", blob, filename || "pet.png");
    const response = await fetchImpl("/api/media/pet", { method: "POST", body: form });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.url || !result?.filename) {
      throw new Error(result?.error || `宠物图片上传失败（HTTP ${response.status}）`);
    }
    return {
      kind: "custom",
      id: `custom-${String(result.filename).slice(0, 40)}`,
      url: String(result.url),
      mediaFilename: String(result.filename),
    };
  }

  const Config = {
    defaults,
    load(storage = root.localStorage) {
      const v3 = readJson(storage, SAVE_KEY);
      if (v3?.schemaVersion === 3) return normalizeV3(v3);
      const v2 = readJson(storage, V2_KEY) || readJson(storage, LEGACY_KEY);
      if (!v2) return defaults();
      const migrated = migrateV2(v2);
      if (!migrated._legacyDataUrl) return persistV3(storage, migrated);
      return migrated;
    },
    save(config, storage = root.localStorage) {
      if (config?._legacyDataUrl) {
        const legacy = {
          name: config.name,
          custom: { img: config._legacyDataUrl },
          homeWidget: config.homeWidget !== false,
          homeX: Math.round(clamp(config.anchor?.xRatio, 0, 1) * Math.max(1, root.innerWidth || 1440)),
          homeY: Math.round(clamp(config.anchor?.yRatio, 0, 1) * Math.max(1, root.innerHeight || 900)),
          homeScale: validScale(config.homeScale),
          activityMode: validMode(config.activityMode),
          last: Date.now(),
        };
        storage?.setItem(V2_KEY, JSON.stringify(legacy));
        dispatchConfig(config);
        return config;
      }
      const saved = persistV3(storage, config);
      dispatchConfig(saved);
      return saved;
    },
    async ensureMigrated(config = this.load(), storage = root.localStorage) {
      if (!config?._legacyDataUrl) return normalizeV3(config);
      const skin = await uploadCustomImage(config._legacyDataUrl, "legacy-pet.png");
      const saved = persistV3(storage, { ...config, skin });
      dispatchConfig(saved);
      return saved;
    },
    uploadCustomImage,
    imageUrl(config) {
      if (config?._legacyDataUrl) return config._legacyDataUrl;
      return config?.skin?.kind === "custom" ? String(config.skin.url || "") : "";
    },
  };

  return {
    SAVE_KEY,
    V2_KEY,
    LEGACY_KEY,
    BUILTIN_SKIN,
    defaults,
    normalizeV3,
    migrateV2,
    Config,
  };
});
