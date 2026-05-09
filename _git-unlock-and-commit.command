#!/usr/bin/env bash
# 一次性脚本：删掉残留的 .git/index.lock，加 -A 提交并推到 origin/main
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
git -c user.name="xianranlh" -c user.email="lh2206568981@gmail.com" commit -m "feat(v1.18.4): AI 反代 / Gemini 原生生图 / 整体 UI 视觉统一 / sakura→xianran

主要改动：
- 服务端新增 /api/ai-proxy/* 反代，绕开浏览器 → 第三方 AI 的 CORS 拦截，伪装 Chrome UA
- AI 双协议生图：自动识别 gemini-*-image-* 走 Google /v1beta/.../generateContent，
  其它（gpt-image / dall-e / imagen / flux）走 OpenAI /v1/images/generations
- 生图结果卡片化：胶囊元数据 + 图片网格 + 下载/复制提示词/再生成 操作
- 模型可用性台账：下拉每条选项前缀 ✓/❄/⚠/· 显示最近一次状态
- 生图加载占位 + 已等待计时；4K 选择自动出 3-5 分钟提示横幅
- AI 反代 4K 超时上调到 480s；502/503/520-523 重试，504/524 不重试
- AI 面板可拖动 + 可调大小 + 几何持久化 + 右键复位
- AI 错误翻译表：not supported model / safety / quota / 空响应 / HTML 响应 → 可操作中文
- 整体 UI 视觉统一：头部按钮图标+中文胶囊、气泡圆角节奏、思考动画移入气泡
- 主页顶部按钮加中文标签、无分组空状态引导卡、底部快捷键提示美化
- 数据管理面板从挤压表格改成卡片行布局
- 可编辑站点标题、login h2 与浏览器 tab 同步
- 修 messages 被坏数据顶成 null 导致 AI 面板崩溃；sync apply 不再写字面量 'null'
- proxy 误报客户端断开 bug（req.on(close) → res.on(close) + writableEnded 守卫）

容器/镜像改名：sakura-nav → xianran-nav
- docker-compose service / container_name / image / name 全改 xianran-nav
- Dockerfile LABEL / DATA_DIR 改 /data/xianran-nav
- package.json name / Caddyfile reverse_proxy 目标 / 脚本日志命令同步
- server 启动时一次性迁移：旧 /data/sakura-nav 自动 rename 到新位置，用户数据零丢失
- 内部保留 sakura_nav_* localStorage / sakura.js 等文件名 / 视觉主题 id sakura

附带：restart.command 一键重启脚本"

echo
echo "==> push"
git push origin main

echo
echo "✅ 完成"
read -n 1 -s -r -p "按任意键关闭..."
