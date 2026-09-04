const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AstralIcons = require("../js/astral-icons.js");
const ROOT = path.resolve(__dirname, "..");

test("provides the shared astral icon set used by navigation chrome", () => {
  for (const name of ["star", "install", "calendar", "station", "folder", "grid", "list", "details", "close"]) {
    assert.ok(AstralIcons.paths[name], `${name} should be declared`);
    const svg = AstralIcons.markup(name);
    assert.match(svg, /<svg[^>]+viewBox="0 0 24 24"/);
    assert.match(svg, /stroke="currentColor"/);
  }
});

test("wires the astral visual layer and local-site treatment into the app", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "styles/astral-ui.css"), "utf8");

  assert.match(html, /styles\/astral-ui\.css\?v=v1\.24\.0/);
  assert.match(html, /js\/astral-icons\.js\?v=v1\.24\.0/);
  assert.match(html, /id="brand-title"/);
  assert.match(app, /function isLocalSiteGroup/);
  assert.match(app, /group-local-sites/);
  assert.match(css, /\.group-local-sites/);
  assert.match(css, /\.cards\[data-view="icons"\] \.card \{ aspect-ratio: auto; min-height: 104px; \}/);
});
