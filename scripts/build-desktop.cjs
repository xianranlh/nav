"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const target = process.argv[2];
const targetConfig = {
  mac: {
    args: ["--mac", "dmg", "--universal"],
    artifact: "Xianran-Nav.dmg",
  },
  win: {
    args: ["--win", "nsis", "--x64"],
    artifact: "Xianran-Nav-Setup.exe",
  },
};

if (!targetConfig[target]) {
  console.error("用法：node scripts/build-desktop.cjs <mac|win>");
  process.exit(2);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `xianran-nav-${target}-`));
const tempOutput = path.join(tempRoot, "output");
const destination = path.join(projectRoot, "dist", "desktop");
const builderCli = require.resolve("electron-builder/out/cli/cli.js");

try {
  const config = targetConfig[target];
  const result = spawnSync(process.execPath, [
    builderCli,
    "--config",
    "electron-builder.yml",
    ...config.args,
    "--publish",
    "never",
    `--config.directories.output=${tempOutput}`,
  ], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`electron-builder 退出码：${result.status || 1}`);

  const builtArtifact = path.join(tempOutput, config.artifact);
  if (!fs.existsSync(builtArtifact)) {
    throw new Error(`构建成功但未找到安装包：${builtArtifact}`);
  }

  fs.mkdirSync(destination, { recursive: true });
  const finalArtifact = path.join(destination, config.artifact);
  fs.copyFileSync(builtArtifact, finalArtifact);
  console.log(`安装包已生成：${finalArtifact}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
