import { KnowledgeError } from "./paths.js";

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch((error) => sendKnowledgeError(res, error));
}

function sendKnowledgeError(res, error) {
  const known = error instanceof KnowledgeError || (error && typeof error.code === "string");
  const status = known ? Number(error.status || 500) : 500;
  const code = known ? error.code : "KNOWLEDGE_ERROR";
  if (!known) console.warn("[knowledge] request failed:", error?.message || error);
  return res.status(status).json({
    ok: false,
    error: code,
    message: known ? String(error.message || code) : "知识服务暂不可用",
  });
}

function readKnowledgeConfig(bundle) {
  const raw = bundle?.obsidianKnowledge;
  if (!raw || typeof raw !== "object") {
    return {
      schemaVersion: 1,
      enabled: true,
      homeMode: "recent",
      recent: [],
      pinnedNoteIds: [],
      lastQuery: "",
      openPreference: "reader",
      updatedAt: 0,
    };
  }
  return {
    schemaVersion: 1,
    enabled: raw.enabled !== false,
    homeMode: ["recent", "pinned", "hidden"].includes(raw.homeMode) ? raw.homeMode : "recent",
    recent: Array.isArray(raw.recent) ? raw.recent.slice(0, 20) : [],
    pinnedNoteIds: Array.isArray(raw.pinnedNoteIds) ? raw.pinnedNoteIds.map(String).slice(0, 100) : [],
    lastQuery: String(raw.lastQuery || "").slice(0, 120),
    openPreference: raw.openPreference === "obsidian" ? "obsidian" : "reader",
    updatedAt: Number(raw.updatedAt || 0),
  };
}

function writeKnowledgeConfig(getBundle, setBundle, userId, config) {
  const bundle = getBundle(userId) || { schema: "sakura-nav@2" };
  bundle.savedAt = Date.now();
  bundle.obsidianKnowledge = { ...config, schemaVersion: 1, updatedAt: Date.now() };
  setBundle(userId, bundle);
}

function publicKnowledgeConfig(config) {
  return {
    schemaVersion: 1,
    enabled: config.enabled,
    homeMode: config.homeMode,
    pinnedNoteIds: config.pinnedNoteIds,
    lastQuery: config.lastQuery,
    openPreference: config.openPreference,
    updatedAt: config.updatedAt,
  };
}

export function registerKnowledgeRoutes(app, { auth, service, getBundle, setBundle }) {
  app.get("/api/knowledge/status", auth, asyncRoute(async (req, res) => {
    res.json(await service.status(req.user.userId));
  }));

  app.get("/api/knowledge/search", auth, asyncRoute(async (req, res) => {
    const query = String(req.query.q || "").trim();
    if (!query || query.length > 120) {
      throw new KnowledgeError("INVALID_QUERY", "搜索词长度须为 1–120 个字符", 400);
    }
    const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));
    const items = await service.search(req.user.userId, query, limit);
    res.json({ items, query, limit });
  }));

  app.get("/api/knowledge/tags", auth, asyncRoute(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
    res.json({ items: await service.tags(req.user.userId, limit) });
  }));

  app.get("/api/knowledge/config", auth, asyncRoute(async (req, res) => {
    const config = readKnowledgeConfig(getBundle(req.user.userId));
    const pinned = await service.summaries(req.user.userId, config.pinnedNoteIds);
    res.json({ config: publicKnowledgeConfig(config), pinned });
  }));

  app.patch("/api/knowledge/config", auth, asyncRoute(async (req, res) => {
    const config = readKnowledgeConfig(getBundle(req.user.userId));
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if ("enabled" in body) config.enabled = body.enabled !== false;
    if ("homeMode" in body && ["recent", "pinned", "hidden"].includes(body.homeMode)) {
      config.homeMode = body.homeMode;
    }
    if ("openPreference" in body) config.openPreference = body.openPreference === "obsidian" ? "obsidian" : "reader";
    if ("lastQuery" in body) config.lastQuery = String(body.lastQuery || "").slice(0, 120);
    if (Array.isArray(body.pinnedNoteIds)) {
      config.pinnedNoteIds = [...new Set(body.pinnedNoteIds.map(String).filter((id) => /^n_[A-Za-z0-9_-]{16,40}$/.test(id)))].slice(0, 100);
    }
    writeKnowledgeConfig(getBundle, setBundle, req.user.userId, config);
    const saved = readKnowledgeConfig(getBundle(req.user.userId));
    const pinned = await service.summaries(req.user.userId, saved.pinnedNoteIds);
    res.json({ ok: true, config: publicKnowledgeConfig(saved), pinned });
  }));

  app.get("/api/knowledge/notes/:noteId", auth, asyncRoute(async (req, res) => {
    const noteId = String(req.params.noteId || "");
    if (!/^n_[A-Za-z0-9_-]{16,40}$/.test(noteId)) {
      throw new KnowledgeError("NOTE_NOT_FOUND", "笔记不存在", 404);
    }
    const note = await service.note(req.user.userId, noteId);
    if (!note) throw new KnowledgeError("NOTE_NOT_FOUND", "笔记不存在", 404);
    res.json(note);
  }));

  app.get("/api/knowledge/attachments/:assetId", auth, asyncRoute(async (req, res) => {
    const assetId = String(req.params.assetId || "");
    if (!/^a_[A-Za-z0-9_-]{16,40}$/.test(assetId)) {
      throw new KnowledgeError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    }
    const asset = await service.asset(req.user.userId, assetId);
    const encodedName = encodeURIComponent(asset.name || "attachment");
    res.set({
      "Content-Type": asset.mimeType,
      "Content-Disposition": `inline; filename="attachment"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": asset.mimeType === "image/svg+xml"
        ? "default-src 'none'; style-src 'none'; script-src 'none'; sandbox"
        : "default-src 'none'; img-src 'self' data:; style-src 'none'; sandbox",
      ETag: `\"${asset.contentHash}\"`,
    });
    if (asset.bytes) res.send(asset.bytes);
    else res.sendFile(asset.path);
  }));

  app.get("/api/knowledge/recent", auth, asyncRoute(async (req, res) => {
    const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit, 10) || 6));
    const config = readKnowledgeConfig(getBundle(req.user.userId));
    const source = config.recent.slice(0, limit);
    const summaries = await service.summaries(req.user.userId, source.map((item) => item.noteId));
    const byId = new Map(summaries.map((item) => [item.noteId, item]));
    res.json({
      items: source.map((item) => ({
        ...item,
        ...(byId.get(item.noteId) || { available: false }),
        available: byId.has(item.noteId) && byId.get(item.noteId).available !== false,
      })),
    });
  }));

  app.post("/api/knowledge/opened", auth, asyncRoute(async (req, res) => {
    const noteId = String(req.body?.noteId || "");
    const note = await service.note(req.user.userId, noteId);
    if (!note) throw new KnowledgeError("NOTE_NOT_FOUND", "笔记不存在", 404);
    const config = readKnowledgeConfig(getBundle(req.user.userId));
    config.recent = [
      { noteId, title: note.title, openedAt: Date.now() },
      ...config.recent.filter((item) => item && item.noteId !== noteId),
    ].slice(0, 20);
    writeKnowledgeConfig(getBundle, setBundle, req.user.userId, config);
    res.json({ ok: true });
  }));

  app.post("/api/knowledge/reindex", auth, asyncRoute(async (req, res) => {
    const task = service.startIndex(req.user.userId, { force: true, manual: true });
    task.promise.catch(() => {});
    res.status(202).json({ ok: true, taskId: task.taskId, existing: task.existing });
  }));
}
