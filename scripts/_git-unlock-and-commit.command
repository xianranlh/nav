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
  -m "feat(v1.20.0): 提醒事项重做为 Mac Reminders 风格" \
  -m "重做 js/todo.js：双层数据 lists + items，items 字段扩到 notes / dueDate+dueTime / priority(0-3) / flagged / tags / url / subtasks / syncToCal / calTaskId。内置 5 个智能列表（今天 / 计划 / 全部 / 已标记 / 已完成）+ 用户自建列表，支持 addList / updateList / removeList，每个列表带 emoji 和颜色。v1 老数据自动迁移到 v2 schema。"  \
  -m "dialog-todo 重写为双栏 shell：左侧 sidebar（搜索框 + 智能列表 2×3 网格 + 用户列表 + + 新建列表按钮）+ 中间 main（大标题 + + 添加输入 + 项目列表 + 已完成区）+ 右侧详情面板（标题 / 备注 / 截止日期 时间 / 优先级 / 标记 / 同步日历 / URL / 标签 / 所属列表 / 删除）。" \
  -m "项目行 Mac 风格：圆形 radio（按 priority 染色 蓝/橙/红，勾选打钩动画）+ 标题 + 备注 + due（今天/明天/N 天后人话化）+ 🚩 + 列表小标 + 标签 + 链接 + ⓘ 详情按钮（hover 显)；点 ⓘ 弹右侧详情面板实时双向保存。" \
  -m "完整功能：智能列表自动归集 / 列表新建编辑删除（弹窗带 8 色 swatch）/ 子任务父项 done 自动级联子项 / 搜索（120ms debounce）/ 内联编辑标题（contenteditable）/ 智能列表上 + 添加自动填上下文（今天默认今天 due / 已标记自动 flagged） / 与日历联动保留（priority 决定颜色）。" \
  -m "杂项：sw.js v1.20.0 + index.html cache buster + 新建 dialog-rem-list 子弹窗 + 8 色 LIST_COLORS swatches + 24px 圆形 close 按钮。" \
  -m "本提交累积：v1.18.6 + v1.18.7 + v1.19.0-5 + v1.20.0（提醒事项 Reminders 风格）。" \
  -m "原老 commit message：" \
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
