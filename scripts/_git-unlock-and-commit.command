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
  -m "feat(v1.19.5): 任务弹窗重整 + 节假日实时 API + 待办事项模块" \
  -m "1) 任务弹窗 UI 重整：dialog-task 套用标准三段式（dialog-header / dialog-body / dialog-actions），修复内容紧贴边框；重复区改成胶囊 legend + 虚线粉框；color radio 大 32px 选中态加阴影；星期 picker 加 hover 高亮 & 选中 box-shadow；time + 全天 checkbox 用 task-time-row 横排；输入控件统一 padding 8px 12px + 8px 圆角。" \
  -m "2) 节假日实时 API（方案一）：js/holidays.js 接入 timor.tech/api/holiday/year/{Y}，90 天 localStorage 缓存；renderMonth 异步预拉当前年 + 次年，cal-holidays-updated 事件触发重渲染；2026 硬编码兜底（含调休主日）；2027 及以后由 API 同步，每年 12 月国务院公告后 24h 内自动更新。" \
  -m "3) 待办事项模块（新）：js/todo.js 极简 todo store（localStorage sakura_nav_todos_v1）+ 顶栏 ✅ 按钮 + 红点 badge 显示未完成数 + dialog-todo 弹窗。功能：勾选 / 内联截止日期 / 删除 / 双击文本编辑 / 拖拽排序 / 清除已完成 / 过期红色高亮。可选'📅 同步到日历'：勾选后 upsert 到 Cal.data.tasks 作为该日期一次性任务（标题加 📝 前缀），删除/取消同步会清掉日历副本，todo 勾选完成时日历副本同步打勾。" \
  -m "4) 杂项：sw.js CORE_FILES 加 ./js/todo.js；index.html script src 注册；版本 v1.19.5。" \
  -m "本提交累积：v1.18.6 + v1.18.7 + v1.19.0 (茶话会) + v1.19.1 (添加网址简化) + v1.19.2 (目录整理) + v1.19.3 (README 配图) + v1.19.4 (日历节日) + v1.19.5 (任务弹窗 + API + 待办)。" \
  || echo "（工作区无新变更，跳过 commit）"

echo
echo "==> push"
git push origin main

echo
echo "✅ 完成 (v1.19.2 · 目录整理)"
read -n 1 -s -r -p "按任意键关闭..."
