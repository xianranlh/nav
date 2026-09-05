const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { createClient, friendlyError, formatRelativeTime, KnowledgeApiError } = require("../js/knowledge.js");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test("knowledge client keeps requests same-origin and reports stable Chinese errors", async () => {
  const calls = [];
  const client = createClient(async (url, options) => {
    calls.push({ url, options });
    return response(200, { items: [{ noteId: "n_demo" }] });
  });
  const result = await client.search("部署 手册", 99);
  assert.equal(result.items.length, 1);
  assert.equal(calls[0].url, "/api/knowledge/search?q=%E9%83%A8%E7%BD%B2%20%E6%89%8B%E5%86%8C&limit=20");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(friendlyError("OBS_DISABLED"), "服务器尚未启用 Obsidian 知识库");
  assert.equal(friendlyError("VAULT_NOT_CONFIGURED"), "当前账号还没有配置 Vault 目录");
  assert.equal(formatRelativeTime(Date.now() - 90_000).endsWith("分钟前"), true);
});

test("knowledge client preserves API error codes for empty-state routing", async () => {
  const client = createClient(async () => response(503, {
    error: "INDEX_BUILDING",
    message: "正在建立知识索引，请稍后再试",
  }));
  await assert.rejects(() => client.status(), (error) => {
    assert.equal(error instanceof KnowledgeApiError, true);
    assert.equal(error.code, "INDEX_BUILDING");
    assert.equal(error.status, 503);
    return true;
  });
});

test("homepage ships the Obsidian knowledge cabin and no longer redirects knowledge to blog", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const ui = fs.readFileSync("js/ui/knowledge.ui.js", "utf8");
  const css = fs.readFileSync("styles/astral-ui.css", "utf8");
  const routes = fs.readFileSync("server/knowledge/routes.js", "utf8");
  const server = fs.readFileSync("server/index.js", "utf8");
  const sw = fs.readFileSync("sw.js", "utf8");

  assert.match(index, /id="btn-knowledge"/);
  assert.match(index, /id="dialog-knowledge"/);
  assert.match(index, /js\/knowledge\.js/);
  assert.match(index, /js\/ui\/knowledge\.ui\.js/);
  assert.doesNotMatch(index, /id="btn-blog"/);
  assert.match(ui, /setTimeout\(\(\) => runSearch\(query\), 250\)/);
  assert.match(ui, /serial !== requestSerial/);
  assert.match(ui, /renderSafeDocument\(note\.document\)/);
  assert.match(ui, /document\.createTextNode/);
  assert.match(ui, /rel = "noopener noreferrer"/);
  assert.doesNotMatch(ui, /innerHTML\s*=/);
  assert.match(css, /repeat\(auto-fill, minmax\(min\(100%, 260px\), 1fr\)\)/);
  assert.match(css, /\.knowledge-state\[hidden\][\s\S]*display: none !important/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(routes, /app\.get\("\/api\/knowledge\/config"/);
  assert.match(routes, /app\.patch\("\/api\/knowledge\/config"/);
  assert.match(routes, /app\.get\("\/api\/knowledge\/attachments\/:assetId"/);
  assert.match(routes, /X-Content-Type-Options/);
  assert.match(server, /current\?\.obsidianKnowledge/);
  assert.match(sw, /js\/knowledge\.js/);
  assert.match(sw, /js\/ui\/knowledge\.ui\.js/);
});
