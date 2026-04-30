const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("Docker builds ignore local-only and heavyweight workspace files", () => {
  assert.ok(fs.existsSync(".dockerignore"), ".dockerignore should exist");
  const dockerignore = fs.readFileSync(".dockerignore", "utf8");

  assert.match(dockerignore, /^\.git\/?$/m);
  assert.match(dockerignore, /^node_modules\/?$/m);
  assert.match(dockerignore, /^server\/node_modules\/?$/m);
  assert.match(dockerignore, /^data\/?$/m);
  assert.match(dockerignore, /^\*\.log$/m);
  assert.doesNotMatch(dockerignore, /^css\/?$/m);
  assert.doesNotMatch(dockerignore, /^js\/?$/m);
});

test("git ignore rules keep Docker hygiene files versioned", () => {
  const gitignore = fs.readFileSync(".gitignore", "utf8");

  assert.doesNotMatch(gitignore, /^\.dockerignore$/m);
  assert.match(gitignore, /^data\/$/m);
});

test("docker compose exposes configurable persistent data directories", () => {
  const compose = fs.readFileSync("docker-compose.yml", "utf8");
  const envExample = fs.readFileSync(".env.example", "utf8");

  assert.match(compose, /DATA_DIR:\s+\$\{SAKURA_DATA_DIR:-\/data\/sakura-nav\}/);
  assert.match(compose, /\$\{SAKURA_DATA_HOST_DIR:-\.\/data\}:\/data/);
  assert.match(envExample, /^SAKURA_DATA_HOST_DIR=\.\/data$/m);
  assert.match(envExample, /^SAKURA_DATA_DIR=\/data\/sakura-nav$/m);
  assert.match(envExample, /SAKURA_DATA_DIR.*\/data/);
});
