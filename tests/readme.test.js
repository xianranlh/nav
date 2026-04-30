const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("README describes the current server-required storage model", () => {
  const readme = fs.readFileSync("README.md", "utf8");

  assert.match(readme, /业务数据必须写入同源 `\/api\/data` 背后的 SQLite/);
  assert.match(readme, /会话 token/);
  assert.doesNotMatch(readme, /双击 `index\.html`/);
  assert.doesNotMatch(readme, /本项目纯前端/);
  assert.doesNotMatch(readme, /数据存储在 `localStorage/);
  assert.doesNotMatch(readme, /凭据[^。\n]*localStorage/);
  assert.doesNotMatch(readme, /所有数据仅存在你本地浏览器/);
});

test("README documents the organized front-end asset directories", () => {
  const readme = fs.readFileSync("README.md", "utf8");

  assert.match(readme, /├── css\/\s+# 样式资源/);
  assert.match(readme, /│\s+[├└]── themes\/\s+# 视觉主题样式/);
  assert.match(readme, /ai\.css\s+# AI 浮动按钮 \/ 聊天面板/);
  assert.match(readme, /calendar\.css\s+# 日历面板 \/ 任务视图/);
  assert.match(readme, /music\.css\s+# 音乐播放器 \/ 歌词面板/);
  assert.match(readme, /weather\.css\s+# 天气卡片 \/ 城市搜索/);
  assert.match(readme, /cards\.css\s+# 首页导航卡片 \/ 分组/);
  assert.match(readme, /├── js\/\s+# 前端脚本模块/);
  assert.match(readme, /js\/app\.js/);
  assert.match(readme, /static-assets\.js\s+# 静态资源清单/);
  assert.match(readme, /css\/styles\.css/);
});
