#!/usr/bin/env bash
# 樱 · 个人导航 — 本地一键启动（Node 静态站 + SQLite 数据 API）
# 用法：chmod +x start-all.sh && ./start-all.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装：https://nodejs.org/" >&2
  exit 1
fi

export DATA_DIR="${DATA_DIR:-$ROOT/data}"
mkdir -p "$DATA_DIR"

if [[ ! -d "$ROOT/server/node_modules" ]]; then
  echo "正在安装 server 依赖（首次）..."
  npm install --prefix server
fi

echo "启动开发服务：http://127.0.0.1:18080  （Ctrl+C 停止）"
echo "DATA_DIR=$DATA_DIR"

exec npm run dev
