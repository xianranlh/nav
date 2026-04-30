const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const assets = require("../js/static-assets.js");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-smoke-"));
const port = String(19080 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ["server/index.js", "--static"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: port,
    DATA_DIR: dataDir,
    SERVE_STATIC: "1",
    STATIC_ROOT: root,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (server.exitCode != null) {
      throw new Error(`server exited early (${server.exitCode})\n${output}`);
    }
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok && (await res.text()) === "ok\n") return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server did not become ready\n${output}`);
}

async function expectOk(urlPath, predicate) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  assert.equal(res.status, 200, `${urlPath} should return HTTP 200`);
  const text = await res.text();
  if (predicate) predicate(text, res);
  return text;
}

async function expectJson(urlPath, opts, predicate) {
  const res = await fetch(`${baseUrl}${urlPath}`, opts);
  assert.ok(res.status >= 200 && res.status < 300, `${urlPath} should return 2xx, got ${res.status}`);
  const json = await res.json();
  if (predicate) predicate(json, res);
  return json;
}

async function main() {
  await waitForServer();

  await expectJson("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema: "sakura-smoke@1",
      nav: { groups: [] },
      settings: {},
      savedAt: Date.now(),
    }),
  }, (json) => assert.equal(json.ok, true));
  await expectJson("/api/data", {}, (json) => assert.equal(json.schema, "sakura-smoke@1"));

  const html = await expectOk("/", (text) => {
    for (const id of ["dialog-settings", "btn-settings", "btn-theme", "music-fab", "ai-fab", "calendar-panel"]) {
      assert.match(text, new RegExp(`id="${id}"`), `home page should include ${id}`);
    }
  });

  assert.match(html, new RegExp(`<script src="${assets.versionedAppScript.replace(/[./?]/g, "\\$&")}"><\\/script>`));
  await expectOk(`/js/app.js?v=${assets.VERSION}`, (text) => assert.match(text, /个人导航主应用/));
  await expectOk("/css/styles.css", (text) => assert.match(text, /:root/));
  await expectOk("/js/render-utils.js", (text) => assert.match(text, /SakuraRender/));
  await expectOk("/js/link-ui.js", (text) => assert.match(text, /HomepageLinkUI/));
  await expectOk("/js/ai-ui.js", (text) => assert.match(text, /HomepageAIUI/));
  await expectOk("/js/calendar-ui.js", (text) => assert.match(text, /HomepageCalendarUI/));
  await expectOk("/js/command-palette.js", (text) => assert.match(text, /HomepageCommandPalette|command-palette/));
  await expectOk("/js/media-cleanup.js", (text) => assert.match(text, /HomepageMediaCleanup/));

  console.log(`Smoke checked ${baseUrl}`);
}

main()
  .finally(() => {
    server.kill("SIGTERM");
    fs.rmSync(dataDir, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
