const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { normalizeV3, migrateV2 } = require("../js/pet-config.js");
const { PetStatusBus } = require("../js/pet-events.js");

test("pet preferences use v3 server-backed storage with safe legacy migration", () => {
  const engine = fs.readFileSync("js/pet-engine.js", "utf8");
  const sync = fs.readFileSync("js/sync.js", "utf8");
  const page = fs.readFileSync("pet.html", "utf8");
  const home = fs.readFileSync("index.html", "utf8");

  assert.match(engine, /SakuraPetConfig/);
  assert.match(engine, /SakuraPetEvents/);
  assert.match(sync, /localStorage\.getItem\("sakura_pet_v3"\)/);
  assert.match(sync, /data\.pet\?\.schemaVersion === 3/);
  assert.match(page, /js\/pet-config\.js/);
  assert.match(page, /js\/pet-events\.js/);
  assert.match(home, /js\/pet-config\.js/);
  assert.match(home, /js\/pet-events\.js/);
  assert.match(page, /js\/sakura-remote\.js/);

  const clean = normalizeV3({
    schemaVersion: 3,
    skin: { kind: "custom", url: "data:image/png;base64,bad" },
  });
  assert.equal(clean.skin.kind, "builtin");
  assert.doesNotMatch(JSON.stringify(clean), /data:image/);
  assert.deepEqual(normalizeV3({ schemaVersion: 3, quickActions: [] }).quickActions, []);
  assert.equal(normalizeV3({ schemaVersion: 3, quickActions: ["todo", "calendar", "ai", "knowledge", "settings"] }).quickActions.length, 4);

  const migrated = migrateV2({
    name: "旧宠物",
    custom: { img: "data:image/png;base64,AAAA" },
    homeX: 720,
    homeY: 90,
    homeScale: "giant",
  }, { width: 1440, height: 900 });
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.anchor.xRatio, 0.5);
  assert.equal(migrated.anchor.yRatio, 0.1);
  assert.equal(migrated.homeScale, "md");
  assert.match(migrated._legacyDataUrl, /^data:image\/png/);
  assert.doesNotMatch(JSON.stringify(migrated), /data:image/);
});

test("pet controls expose activity, size and position without relying on a context menu", () => {
  const page = fs.readFileSync("pet.html", "utf8");
  const widget = fs.readFileSync("js/pet-widget.js", "utf8");
  const css = fs.readFileSync("styles/pet.css", "utf8");

  assert.match(page, /id="pet-activity-mode"/);
  assert.match(page, /id="pet-home-scale"/);
  assert.match(page, /id="btn-reset-position"/);
  assert.match(page, /id="pet-speech-frequency"/);
  assert.match(page, /id="chk-status-badge"/);
  assert.match(page, /id="pet-anchor-map"/);
  assert.match(page, /id="pet-quick-actions"/);
  assert.match(page, /ASTRAL COMPANION/);
  assert.match(widget, /class="hp-quick"/);
  assert.match(widget, /window\.innerWidth >= 720/);
  assert.match(widget, /cfg\.showStatusBadge === false/);
  assert.match(widget, /cfg\.speechFrequency === "quiet"/);
  assert.match(widget, /cfg\.anchor\?\.xRatio/);
  assert.match(widget, /cfg\.anchor\?\.yRatio/);
  assert.match(widget, /window\.addEventListener\("resize"/);
  assert.match(widget, /id = "home-pet-wheel"/);
  assert.match(widget, /setTimeout\(interact, 280\)/);
  assert.match(widget, /setTimeout\(\(\) => \{[\s\S]*showCtx[\s\S]*\}, 560\)/);
  assert.match(widget, /window\.SakuraKnowledgeUI\?\.openRecent/);
  assert.doesNotMatch(widget, /dblclick[\s\S]{0,160}location\.href = "pet\.html"/);
  assert.match(css, /\.pet-preferences\s*\{/);
  assert.match(css, /\.pet-portrait\s*\{/);
  assert.match(css, /\.pet-dashboard\s*\{/);
  assert.match(css, /\.pet-quick-grid\s*\{/);
});

test("pet animation loops pause while the page is hidden", () => {
  const engine = fs.readFileSync("js/pet-engine.js", "utf8");
  const widget = fs.readFileSync("js/pet-widget.js", "utf8");
  const page = fs.readFileSync("js/pet.js", "utf8");
  assert.match(engine, /document\.addEventListener\("visibilitychange", this\._onVisibility\)/);
  assert.match(engine, /if \(!document\.hidden\) this\._raf/);
  assert.match(widget, /syncMetaVisibility/);
  assert.match(page, /function syncVisibility\(\)/);
});

test("pet status bus honors priority and explicit events", () => {
  let now = 1000;
  let nextId = 1;
  const timers = new Map();
  const bus = new PetStatusBus({
    now: () => now,
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
  });

  bus.handle("nav:sync:start");
  assert.equal(bus.get().status, "syncing");
  bus.handle("nav:ai:start");
  assert.equal(bus.get().status, "thinking");
  bus.handle("nav:network:offline");
  bus.handle("nav:ai:error");
  assert.equal(bus.get().status, "offline");
  bus.handle("nav:network:online");
  assert.equal(bus.get().status, "error");

  now += 4000;
  for (const [id, timer] of [...timers]) {
    if (timer.at <= now) {
      timers.delete(id);
      timer.fn();
    }
  }
  assert.equal(bus.get().status, "syncing");

  const widget = fs.readFileSync("js/pet-widget.js", "utf8");
  const aiUi = fs.readFileSync("js/ui/ai.ui.js", "utf8");
  const remote = fs.readFileSync("js/sakura-remote.js", "utf8");
  assert.doesNotMatch(widget, /new MutationObserver/);
  assert.match(aiUi, /nav:ai:start/);
  assert.match(aiUi, /nav:ai:done/);
  assert.match(aiUi, /nav:ai:error/);
  assert.match(remote, /nav:sync:start/);
  assert.match(remote, /nav:sync:done/);
  assert.match(remote, /nav:sync:error/);
});

test("pet media endpoint validates content and ownership", () => {
  const server = fs.readFileSync("server/index.js", "utf8");
  assert.match(server, /app\.post\("\/api\/media\/pet"/);
  assert.match(server, /detectPetImage/);
  assert.match(server, /5 \* 1024 \* 1024/);
  assert.match(server, /app\.get\("\/api\/media\/file\/pet\/:filename", petMediaAuth/);
  assert.match(server, /getMediaFileRecord\(req\.params\.filename, req\.user\.userId\)/);
});
