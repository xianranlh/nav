#!/usr/bin/env bash
# v1.18.6：可优化项五连发（同步重试 / 快捷键速查 / 离线提示 / 对话导出 / 台账自清）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ -f .git/index.lock ]; then
  echo "==> 删除残留锁文件 .git/index.lock"
  rm -f .git/index.lock
fi

echo "==> git add -A"
git add -A

echo "==> git status"
git status --short

echo
echo "==> commit"
git -c user.name="xianranlh" -c user.email="lh2206568981@gmail.com" commit \
  -m "feat(v1.18.6): 同步重试 / 快捷键速查 / 离线横幅 / 对话导出 / 台账自清" \
  -m "1) sakura-remote.js：PUT /api/data 增加 15s 单次超时 + 1s/3s/7s 指数退避重试，4xx (除 408/429) 立刻放弃；连续 ≥3 次失败才弹 toast，恢复后单独提示一次。" \
  -m "2) 快捷键速查弹窗：按 ? 触发 / 点击底部 hint 也可触发，分四组列出所有快捷键，附 dialog 样式 + 主题适配。" \
  -m "3) 离线状态横幅：window.online/offline 监听 + 顶部红黄渐变条幅，恢复在线时主动触发 SakuraRemote.pushNow()。" \
  -m "4) AI 对话导出 Markdown：一键导出当前会话（含生图卡片→图片链接、附件图片、模型/尺寸 metadata），文件名带时间戳。" \
  -m "5) 定时清理失效台账：cooldownLedger 过期键 / probeStatus 5min(error)/30min(ok) / upstreamMap 孤儿映射，每 5 min + 页面回前台时跑一次。" \
  -m "杂项：版本号统一升到 v1.18.6（sw.js / index.html 资源 cache buster / ai.js header / ai-build-tag）。"

echo
echo "==> push"
git push origin main

echo
echo "✅ 完成 (v1.18.6)"
read -n 1 -s -r -p "按任意键关闭..."
