const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("version-busts the main app controller so dialog behavior updates reach the browser", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const sw = fs.readFileSync("sw.js", "utf8");
  const swVersion = /const VERSION = "([^"]+)";/.exec(sw)?.[1];
  const appScriptVersion = /<script src="app\.js\?v=([^"]+)"><\/script>/.exec(index)?.[1];

  assert.ok(swVersion, "service worker version should be declared");
  assert.ok(appScriptVersion, "app.js should include a cache-busting version query");
  assert.equal(appScriptVersion, swVersion);
  assert.ok(
    sw.includes(`"./app.js?v=${appScriptVersion}"`) || sw.includes("`./app.js?v=${VERSION}`"),
    "service worker should pre-cache the same versioned app controller",
  );
});

test("keeps the inline group button outside the select label in the link dialog", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const groupLabelBlock = /<label[^>]*>\s*所属分组[\s\S]*?<\/label>/.exec(index)?.[0] || "";

  assert.ok(groupLabelBlock, "link dialog should expose a label for the group select");
  assert.doesNotMatch(groupLabelBlock, /link-new-group-toggle/);
});

test("keeps the AI chat placeholder compact enough to avoid input scrollbars", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const inputMarkup = /<textarea id="ai-input"[^>]*><\/textarea>/.exec(index)?.[0] || "";
  const placeholder = /placeholder="([^"]+)"/.exec(inputMarkup)?.[1] || "";

  assert.ok(inputMarkup, "AI chat textarea should exist");
  assert.ok(placeholder, "AI chat textarea should have a placeholder");
  assert.ok(
    placeholder.length <= 14,
    "visible placeholder should stay short so it does not wrap in the compact composer",
  );
  assert.doesNotMatch(placeholder, /Enter|Shift|换行|发送/);
  assert.match(inputMarkup, /aria-label="[^"]*(Enter|发送)[^"]*"/);
});

test("Docker image includes current theme assets and excludes removed LX source bundles", () => {
  const dockerfile = fs.readFileSync("Dockerfile", "utf8");

  assert.match(dockerfile, /homepage-theme\.js/);
  assert.match(dockerfile, /homepage-layout\.js/);
  assert.match(dockerfile, /COPY themes\/\s+\/usr\/share\/nginx\/html\/themes\//);
  assert.doesNotMatch(dockerfile, /lx-sources/);
});

test("service worker does not keep unused stale-while-revalidate helper", () => {
  const sw = fs.readFileSync("sw.js", "utf8");

  assert.doesNotMatch(sw, /function\s+staleWhileRevalidate/);
  assert.doesNotMatch(sw, /stale-while-revalidate/);
});
