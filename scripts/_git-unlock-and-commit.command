#!/usr/bin/env bash
# v1.19.2：项目目录整理（js/ deploy/ scripts/）+ 累积 v1.18.6 / v1.18.7 / v1.19.0 / v1.19.1 的所有改动
set -uo pipefail

# 脚本在 scripts/ 子目录里，ROOT 是它的上一级（项目根）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo "==> 删除可能残留的所有 .lock 文件"
find .git -maxdepth 3 -name "*.lock" -print -exec rm -f {} \; 2>&1 | head -10
true

echo "==> git add -A"
git add -A

echo "==> git status"
git status --short

echo
echo "==> commit (若已无变更会跳过)"
git -c user.name="xianranlh" -c user.email="lh2206568981@gmail.com" commit \
  -m "chore(v1.19.2): 项目目录整理 — js/ deploy/ scripts/" \
  -m "把根目录 30+ 文件分类到三个子目录：" \
  -m "1) js/ — 全部 19 个前端业务模块（app.js / ai.js / sakura.js / sync.js / auth.js / blog.js / bookmarks.js / calendar.js / music.js / weather.js / suggest.js / progress.js / exporter.js / idb.js / homepage-theme.js / homepage-layout.js / sakura-remote.js / sakura-media.js / storage-inspector.js）。" \
  -m "2) deploy/ — Dockerfile / docker-entrypoint.sh / nginx.conf.template / Caddyfile（docker-compose.yml 仍在根，方便 docker compose 直接跑）。" \
  -m "3) scripts/ — 启动重启 8 个本地脚本（start-all.sh/.ps1/.bat / start-docker.ps1/.bat / restart.command / _git-unlock-and-commit.command / _smoke.ps1）。" \
  -m "同步更新引用：index.html script src 加 js/ 前缀；sw.js CORE_FILES 加 js/；Dockerfile 改为 COPY js/ + COPY deploy/nginx.conf.template；docker-compose.yml dockerfile=deploy/Dockerfile；start-all.sh / restart.command 重新计算 ROOT 为脚本上一级。" \
  -m "本提交累积：v1.18.6（同步重试 / 快捷键 / 离线 / 导出 / 台账自清）+ v1.18.7（容器查询 / sticky / 焦点环）+ v1.19.0（🍵 茶话会模式：广播 / 辩论 / 圆桌）+ v1.19.1（添加网址简化）+ v1.19.2（目录整理）。" \
  || echo "（工作区无新变更，跳过 commit）"

echo
echo "==> push"
git push origin main

echo
echo "✅ 完成 (v1.19.2 · 目录整理)"
read -n 1 -s -r -p "按任意键关闭..."
