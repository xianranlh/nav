#!/usr/bin/env bash
# 樱 · 一键重启：杀掉 18080 端口上的旧 node 进程并重新拉起 start-all.sh
# 故意不用 set -u，避免空变量在不同 macOS bash 版本里的不一致行为
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> 检查 18080 端口占用..."
PIDS=$(lsof -ti tcp:18080 2>/dev/null || true)
if [ -n "${PIDS:-}" ]; then
  echo "    发现进程：${PIDS}，发送 SIGTERM"
  kill ${PIDS} 2>/dev/null || true
  sleep 1
  STILL=$(lsof -ti tcp:18080 2>/dev/null || true)
  if [ -n "${STILL:-}" ]; then
    echo "    仍未退出，发送 SIGKILL"
    kill -9 ${STILL} 2>/dev/null || true
    sleep 1
  fi
else
  echo "    18080 端口空闲"
fi

echo "==> 兜底再清一遍 node 跑 server/index.js 的进程"
pkill -f "node .*server/index\.js" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true
sleep 1

echo "==> 启动 start-all.sh"
chmod +x start-all.sh 2>/dev/null || true
exec ./start-all.sh
