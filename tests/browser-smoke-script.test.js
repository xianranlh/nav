const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("package exposes a maintained browser smoke check", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

  assert.equal(pkg.scripts["smoke:browser"], "node scripts/smoke-browser.js");
  assert.ok(fs.existsSync("scripts/smoke-browser.js"));
});

test("browser smoke script starts the local static server and checks key UI assets", () => {
  const script = fs.readFileSync("scripts/smoke-browser.js", "utf8");

  assert.match(script, /server\/index\.js/);
  assert.match(script, /--static/);
  assert.match(script, /\/healthz/);
  assert.match(script, /\/js\/app\.js\?v=/);
  assert.match(script, /\/css\/styles\.css/);
  assert.match(script, /dialog-settings/);
  assert.match(script, /ai-fab/);
  assert.match(script, /calendar-panel/);
});
