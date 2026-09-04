const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { APP_URL, isSafeExternalUrl, isTrustedAppUrl } = require("../desktop/main.cjs");

test("desktop shell only treats the production HTTPS origin as trusted", () => {
  assert.equal(APP_URL, "https://nav.xianran.de/");
  assert.equal(isTrustedAppUrl("https://nav.xianran.de/"), true);
  assert.equal(isTrustedAppUrl("https://nav.xianran.de/settings?from=desktop"), true);
  assert.equal(isTrustedAppUrl("http://nav.xianran.de/"), false);
  assert.equal(isTrustedAppUrl("https://nav.xianran.de.evil.example/"), false);
  assert.equal(isTrustedAppUrl("javascript:alert(1)"), false);
});

test("desktop shell only opens safe web links in the system browser", () => {
  assert.equal(isSafeExternalUrl("https://github.com/xianranlh/nav"), true);
  assert.equal(isSafeExternalUrl("http://192.168.1.10/"), true);
  assert.equal(isSafeExternalUrl("https://nav.xianran.de/"), false);
  assert.equal(isSafeExternalUrl("file:///etc/passwd"), false);
  assert.equal(isSafeExternalUrl("mailto:test@example.com"), false);
});

test("desktop packaging produces stable EXE and DMG asset names", () => {
  const config = fs.readFileSync("electron-builder.yml", "utf8");
  const workflow = fs.readFileSync(".github/workflows/desktop-release.yml", "utf8");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

  assert.equal(pkg.main, "desktop/main.cjs");
  assert.match(config, /target: nsis/);
  assert.match(config, /artifactName: Xianran-Nav-Setup\.exe/);
  assert.match(config, /target: dmg/);
  assert.match(config, /artifactName: Xianran-Nav\.dmg/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /release_tag/);
  assert.match(workflow, /gh release upload/);
  assert.ok(fs.existsSync("scripts/build-desktop.cjs"));
});

test("website install entry links to the native desktop releases", () => {
  const index = fs.readFileSync("index.html", "utf8");
  const install = fs.readFileSync("js/install.js", "utf8");

  assert.match(index, /Xianran-Nav-Setup\.exe/);
  assert.match(index, /Xianran-Nav\.dmg/);
  assert.match(index, /id="btn-install-pwa"/);
  assert.match(install, /beforeinstallprompt/);
  assert.match(install, /function isElectronApp/);
});
