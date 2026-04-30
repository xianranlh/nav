# 测试与验证

项目测试使用 Node 内置 `node:test`。常规验证命令是 `npm test`，它会运行 `tests/*.test.js` 下的全部测试；语法检查命令是 `npm run check`，会扫描 `js/`、`server/`、`scripts/` 和 `sw.js` 中的 JavaScript 文件。静态资源版本、项目结构、设置样式、服务端硬化、存储适配和扩展功能都有对应测试覆盖。

新增功能应优先补回归测试，再实现。纯前端逻辑适合放进独立 UMD 模块并用 CommonJS require 测试，例如 `js/ai-actions.js`、`js/media-cleanup.js`、`js/data-versioning.js`。服务端新增接口至少要有静态结构测试；涉及真实数据读写时，可补临时数据目录下的集成测试。

浏览器冒烟命令是 `npm run smoke:browser`。脚本会启动 `server/index.js --static`，写入一份最小 `/api/data`，再检查首页、关键按钮、主应用脚本、样式和新增维护模块是否可访问。这个检查不能替代真实浏览器交互，但能及时发现端口启动失败、静态路径漏配和 Service Worker manifest 不一致。

提交前建议依次运行：`npm run check`、`npm test`、`git diff --check`、`npm run smoke:browser`。如果只是改文档，可说明未运行完整验证；如果改了前端交互，至少应跑相关测试和 smoke。
