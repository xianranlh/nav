const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pathsModule = import("../server/knowledge/paths.js");
const scannerModule = import("../server/knowledge/scanner.js");
const indexerModule = import("../server/knowledge/indexer.js");
const databaseModule = import("../server/database.js");
const routesModule = import("../server/knowledge/routes.js");
const markdownModule = import("../server/knowledge/markdown.js");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xianran-obsidian-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("Obsidian paths stay inside the authenticated user's Vault", async (t) => {
  const { createKnowledgeConfig, resolveUserVault, safeResolveExisting, opaqueKnowledgeId } = await pathsModule;
  const root = tempDir(t);
  const vault = path.join(root, "user-1");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "note.md"), "# safe");
  fs.writeFileSync(path.join(root, "secret.md"), "secret");

  const config = createKnowledgeConfig({
    OBSIDIAN_ENABLED: "true",
    OBSIDIAN_VAULT_ROOT: root,
  });
  const resolved = await resolveUserVault(config, 1);
  assert.equal(resolved.configured, true);
  assert.equal((await safeResolveExisting(resolved.path, "note.md")).relativePath, "note.md");
  await assert.rejects(() => safeResolveExisting(resolved.path, "../secret.md"), { code: "UNSAFE_PATH" });
  await assert.rejects(() => safeResolveExisting(resolved.path, "/etc/passwd"), { code: "UNSAFE_PATH" });

  const id1 = opaqueKnowledgeId("test-secret-that-is-long-enough", 1, "n", "note.md");
  const id2 = opaqueKnowledgeId("test-secret-that-is-long-enough", 2, "n", "note.md");
  assert.match(id1, /^n_[A-Za-z0-9_-]{24}$/);
  assert.notEqual(id1, id2);

  try {
    fs.symlinkSync(path.join(root, "secret.md"), path.join(vault, "linked.md"));
    await assert.rejects(() => safeResolveExisting(resolved.path, "linked.md"), { code: "UNSAFE_PATH" });
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }
});

test("Markdown parser extracts safe metadata, tags and wiki links without executing HTML", async () => {
  const { parseMarkdownDocument } = await scannerModule;
  const note = parseMarkdownDocument(`---
title: "部署手册"
tags:
  - 运维
  - nav
__proto__: ignored
---
# 不采用这个标题

查看 [[数据库|数据库说明]] 和 [接口](api.md)。#服务器
配色示例 #abcdef
<script>alert(1)</script>
\`#c8b89a\`
\`\`\`css
color: #abcdef;
\`\`\`
`, "docs/deploy.md");

  assert.equal(note.title, "部署手册");
  assert.deepEqual(note.tags.sort(), ["nav", "服务器", "运维"].sort());
  assert.deepEqual(note.links.map((item) => item.targetRef), ["数据库", "api.md"]);
  assert.equal(Object.prototype.hasOwnProperty.call(note.frontmatter, "__proto__"), false);
  assert.doesNotMatch(note.contentText, /<script>/);
  assert.match(note.contentHash, /^[0-9a-f]{64}$/);
});

test("Vault index is isolated, searchable and skips unchanged notes", async (t) => {
  const { KnowledgeService } = await indexerModule;
  const database = await databaseModule;
  const root = tempDir(t);
  const dataDir = path.join(root, "data", "xianran-nav");
  const vault = path.join(root, "vaults", "user-1");
  fs.mkdirSync(path.join(vault, "docs"), { recursive: true });
  fs.writeFileSync(path.join(vault, "docs", "deploy.md"), `---
title: 部署手册
tags: [运维, nav]
---
# 部署
服务器部署步骤，参见 [[数据库]]。
`);
  fs.writeFileSync(path.join(vault, "数据库.md"), "# 数据库\nSQLite 数据说明。");
  fs.mkdirSync(path.join(vault, ".obsidian"));
  fs.writeFileSync(path.join(vault, ".obsidian", "private.md"), "# 不应索引");

  database.openDatabase(dataDir);
  t.after(() => database.closeDatabase());
  const service = new KnowledgeService({
    secret: "knowledge-test-secret-that-is-long-enough",
    env: {
      OBSIDIAN_ENABLED: "true",
      OBSIDIAN_VAULT_ROOT: path.join(root, "vaults"),
      OBSIDIAN_RESCAN_INTERVAL_MS: "30000",
    },
  });

  const first = await service.indexUser(1, { force: true });
  assert.equal(first.changed, 2);
  assert.equal(first.total, 2);
  const status = await service.status(1);
  assert.equal(status.noteCount, 2);
  assert.equal(status.errorCode, null);

  const results = await service.search(1, "部署", 12);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "部署手册");
  const deployNote = await service.note(1, results[0].noteId);
  assert.equal(deployNote.links.length, 1);
  assert.match(deployNote.links[0].noteId, /^n_/);
  assert.equal(deployNote.document.version, 1);
  assert.equal("markdown" in deployNote, false);
  await assert.rejects(() => service.note(2, results[0].noteId), { code: "VAULT_NOT_CONFIGURED" });

  const second = await service.indexUser(1, { force: true });
  assert.equal(second.changed, 0);
  assert.equal(second.removed, 0);
  const manual = await service.indexUser(1, { force: true, manual: true });
  assert.equal(manual.changed, 2);

  fs.appendFileSync(path.join(vault, "docs", "deploy.md"), "\n新增步骤。\n");
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(path.join(vault, "docs", "deploy.md"), future, future);
  const third = await service.indexUser(1, { force: true });
  assert.equal(third.changed, 1);
  assert.match(JSON.stringify((await service.note(1, results[0].noteId)).document), /新增步骤/);
});

test("safe Markdown model keeps rich blocks while dropping executable URLs and HTML", async () => {
  const { createSafeMarkdownDocument, sanitizeSvg } = await markdownModule;
  const document = createSafeMarkdownDocument(`# 标题

查看 [[目标#部署步骤|目标笔记]]、[官网](https://example.com/docs) 和 [危险](javascript:alert(1))。

- [x] 已完成
- **加粗** 与 \`代码\`

<script>alert('xss')</script><iframe src="https://evil.example"></iframe>
`, {
    sourcePath: "docs/current.md",
    links: [{ targetRef: "目标", targetNoteId: "n_123456789012345678901234" }],
  });
  const serialized = JSON.stringify(document);
  assert.equal(document.version, 1);
  assert.match(serialized, /"type":"heading"/);
  assert.match(serialized, /"type":"note"/);
  assert.match(serialized, /"heading":"部署步骤"/);
  assert.match(serialized, /https:\/\/example\.com\/docs/);
  assert.doesNotMatch(serialized, /javascript:/i);
  assert.doesNotMatch(serialized, /<script|<iframe/i);
  assert.ok(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>'));
  assert.equal(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), null);
  assert.equal(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), null);
});

test("knowledge attachments require ownership, unchanged content and safe SVG", async (t) => {
  const { KnowledgeService } = await indexerModule;
  const database = await databaseModule;
  const root = tempDir(t);
  const dataDir = path.join(root, "data", "xianran-nav");
  const vault1 = path.join(root, "vaults", "user-1");
  const vault2 = path.join(root, "vaults", "user-2");
  fs.mkdirSync(vault1, { recursive: true });
  fs.mkdirSync(vault2, { recursive: true });
  fs.writeFileSync(path.join(vault1, "safe.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>');
  fs.writeFileSync(path.join(vault1, "unsafe.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  fs.writeFileSync(path.join(vault1, "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  fs.writeFileSync(path.join(vault1, "note.md"), "# 附件\n![[safe.svg]]\n![[unsafe.svg]]\n![[pixel.png]]");

  database.openDatabase(dataDir);
  t.after(() => database.closeDatabase());
  const service = new KnowledgeService({
    secret: "asset-test-secret-that-is-long-enough",
    env: { OBSIDIAN_ENABLED: "true", OBSIDIAN_VAULT_ROOT: path.join(root, "vaults") },
  });
  await service.indexUser(1, { force: true });
  await service.indexUser(2, { force: true });
  const summary = (await service.search(1, "附件", 5))[0];
  const note = await service.note(1, summary.noteId);
  assert.equal(note.assets.length, 3);
  const safe = note.assets.find((asset) => asset.name === "safe.svg");
  const unsafe = note.assets.find((asset) => asset.name === "unsafe.svg");
  const pixel = note.assets.find((asset) => asset.name === "pixel.png");
  assert.match((await service.asset(1, safe.assetId)).bytes.toString(), /<circle/);
  const streamed = await service.asset(1, pixel.assetId);
  assert.equal(streamed.bytes, null);
  assert.equal(streamed.path, fs.realpathSync(path.join(vault1, "pixel.png")));
  await assert.rejects(() => service.asset(1, unsafe.assetId), { code: "UNSAFE_ATTACHMENT" });
  await assert.rejects(() => service.asset(2, safe.assetId), { code: "ATTACHMENT_NOT_FOUND" });
  fs.appendFileSync(path.join(vault1, "safe.svg"), " ");
  await assert.rejects(() => service.asset(1, safe.assetId), { code: "ATTACHMENT_CHANGED" });
});

test("server backups strip rebuildable Obsidian note bodies", async (t) => {
  const { KnowledgeService } = await indexerModule;
  const database = await databaseModule;
  const Database = require("../server/node_modules/better-sqlite3");
  const root = tempDir(t);
  const dataDir = path.join(root, "data", "xianran-nav");
  const vault = path.join(root, "vaults", "user-1");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "private.md"), "# 私密正文\n不会进入备份索引。");
  database.openDatabase(dataDir);
  t.after(() => database.closeDatabase());
  const service = new KnowledgeService({
    secret: "backup-test-secret-that-is-long-enough",
    env: { OBSIDIAN_ENABLED: "true", OBSIDIAN_VAULT_ROOT: path.join(root, "vaults") },
  });
  await service.indexUser(1, { force: true });
  const snapshotPath = path.join(root, "backup.db");
  database.snapshotDatabaseTo(snapshotPath, { stripKnowledge: true });
  const snapshot = new Database(snapshotPath, { readonly: true });
  t.after(() => snapshot.close());
  assert.equal(snapshot.prepare("SELECT COUNT(*) AS count FROM obsidian_notes").get().count, 0);
  assert.equal(snapshot.prepare("SELECT COUNT(*) AS count FROM obsidian_links").get().count, 0);
});

test("knowledge config routes persist pinned note IDs without accepting paths", async () => {
  const { registerKnowledgeRoutes } = await routesModule;
  const handlers = new Map();
  const app = {
    get(pathname, ...stack) { handlers.set(`GET ${pathname}`, stack.at(-1)); },
    patch(pathname, ...stack) { handlers.set(`PATCH ${pathname}`, stack.at(-1)); },
    post(pathname, ...stack) { handlers.set(`POST ${pathname}`, stack.at(-1)); },
  };
  let bundle = { schema: "sakura-nav@2" };
  const service = {
    async summaries(userId, ids) {
      assert.equal(userId, 1);
      return ids.map((noteId) => ({ noteId, title: "固定笔记", available: true }));
    },
  };
  registerKnowledgeRoutes(app, {
    auth() {},
    service,
    getBundle: () => bundle,
    setBundle: (_userId, next) => { bundle = next; },
  });
  let payload;
  let status = 200;
  const res = {
    status(value) { status = value; return this; },
    json(value) { payload = value; return value; },
  };
  await handlers.get("PATCH /api/knowledge/config")({
    user: { userId: 1 },
    body: {
      pinnedNoteIds: ["n_1234567890123456", "n_1234567890123456", "../../etc/passwd"],
      lastQuery: "部署",
    },
  }, res);
  assert.equal(status, 200);
  assert.deepEqual(bundle.obsidianKnowledge.pinnedNoteIds, ["n_1234567890123456"]);
  assert.equal(bundle.obsidianKnowledge.lastQuery, "部署");
  assert.deepEqual(payload.pinned.map((item) => item.noteId), ["n_1234567890123456"]);
});

test("attachment route authenticates by user and sends restrictive response headers", async () => {
  const { registerKnowledgeRoutes } = await routesModule;
  const handlers = new Map();
  const app = {
    get(pathname, ...stack) { handlers.set(`GET ${pathname}`, stack.at(-1)); },
    patch() {},
    post() {},
  };
  let requestedUser = null;
  registerKnowledgeRoutes(app, {
    auth() {},
    service: {
      async asset(userId, assetId) {
        requestedUser = userId;
        assert.match(assetId, /^a_/);
        return {
          bytes: Buffer.from("safe"),
          mimeType: "image/svg+xml",
          name: "星图.svg",
          contentHash: "a".repeat(64),
        };
      },
    },
    getBundle: () => ({}),
    setBundle() {},
  });
  let headers;
  let body;
  const res = {
    set(value) { headers = value; return this; },
    send(value) { body = value; return value; },
    status() { return this; },
    json(value) { body = value; return value; },
  };
  await handlers.get("GET /api/knowledge/attachments/:assetId")({
    user: { userId: 7 },
    params: { assetId: "a_123456789012345678901234" },
  }, res);
  assert.equal(requestedUser, 7);
  assert.equal(body.toString(), "safe");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Content-Security-Policy"], /script-src 'none'/);
  assert.match(headers["Content-Disposition"], /filename\*=UTF-8''/);
});
