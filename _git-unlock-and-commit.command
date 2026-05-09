#!/usr/bin/env bash
# v1.18.5：弹窗内容溢出截断修复
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
git -c user.name="xianranlh" -c user.email="lh2206568981@gmail.com" commit -m "fix(v1.18.5): 弹窗内容溢出截断" -m "修复添加网址 → 卡片背景媒体展开后下半部分被 footer 遮挡。" -m "根因：.dialog-body 作为 form 的 flex 子元素默认 flex: 0 1 auto，没 min-height: 0，按内容撑开后超出 form 的 max-height:90vh 被 overflow:hidden 裁掉，body 自身的 overflow-y: auto 不触发。.sec (details) 也有 overflow:hidden 进一步压缩展开内容。" -m "修：.dialog-body 显式 flex: 1 1 auto + min-height: 0；.dialog-body > details.sec 显式 flex-shrink: 0 + overflow: visible；.dialog-actions/.dialog-header 标记 flex: 0 0 auto。" -m "副作用：所有 .glass-dialog 弹窗（添加网址 / 新建分组 / AI 设置 / 任务 / 博客 / 供应商编辑）滚动行为统一修好，footer 稳定底部，body 内容超出会出滚动条。"

echo
echo "==> push"
git push origin main

echo
echo "✅ 完成 (v1.18.5)"
read -n 1 -s -r -p "按任意键关闭..."
