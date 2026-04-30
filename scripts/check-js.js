const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_DIRS = ["js", "server", "scripts"];
const SOURCE_FILES = ["sw.js"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".worktrees", "data", "dist", "build"]);

function collectJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = [
  ...SOURCE_FILES.filter((file) => fs.existsSync(file)),
  ...SOURCE_DIRS.flatMap(collectJsFiles),
].sort();

if (!files.length) {
  console.error("No JavaScript files found to check.");
  process.exit(1);
}

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`Checked ${files.length} JavaScript files.`);
