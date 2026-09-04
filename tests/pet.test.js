const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("pet preferences use server-backed storage with legacy migration", () => {
  const engine = fs.readFileSync("js/pet-engine.js", "utf8");
  const sync = fs.readFileSync("js/sync.js", "utf8");
  const page = fs.readFileSync("pet.html", "utf8");

  assert.match(engine, /const SAVE_KEY = "sakura_pet_v2"/);
  assert.match(engine, /const LEGACY_SAVE_KEY = "sakura-pet@1"/);
  assert.match(engine, /homeScale:\s*"md"/);
  assert.match(sync, /pet:\s*JSON\.parse\(localStorage\.getItem\("sakura_pet_v2"\)/);
  assert.match(sync, /if \("pet" in data\) set\("sakura_pet_v2", data\.pet\)/);
  assert.match(page, /js\/sakura-remote\.js/);
});

test("pet controls expose activity, size and position without relying on a context menu", () => {
  const page = fs.readFileSync("pet.html", "utf8");
  const widget = fs.readFileSync("js/pet-widget.js", "utf8");
  const css = fs.readFileSync("styles/pet.css", "utf8");

  assert.match(page, /id="pet-activity-mode"/);
  assert.match(page, /id="pet-home-scale"/);
  assert.match(page, /id="btn-reset-position"/);
  assert.match(widget, /class="hp-quick"/);
  assert.match(widget, /Math\.min\(maxX, cfg\.homeX\)/);
  assert.match(widget, /window\.addEventListener\("resize"/);
  assert.match(css, /\.pet-preferences\s*\{/);
  assert.match(css, /\.pet-portrait\s*\{/);
});
