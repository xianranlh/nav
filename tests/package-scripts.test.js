const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("package exposes a JavaScript syntax check command", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

  assert.ok(pkg.scripts.check, "npm run check should exist");
  assert.equal(pkg.scripts.check, "node scripts/check-js.js");
  assert.ok(fs.existsSync("scripts/check-js.js"), "check command should delegate to a maintained script");
});

test("JavaScript syntax checker discovers organized source directories", () => {
  const checker = fs.readFileSync("scripts/check-js.js", "utf8");

  assert.match(checker, /"js"/);
  assert.match(checker, /"server"/);
  assert.match(checker, /"sw\.js"/);
  assert.match(checker, /node_modules/);
  assert.doesNotMatch(checker, /js\/app\.js.*js\/ai\.js.*js\/auth\.js/s);
});
