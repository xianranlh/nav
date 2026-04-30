# 架构说明

本项目是一个个人导航首页，前端以原生 HTML/CSS/JavaScript 运行，服务端以 Node.js + Express + SQLite 提供持久化、媒体上传、备份迁移和快照能力。当前仍保留单页应用的轻量部署方式，但业务边界已经按模块逐步拆出到 `js/` 目录，避免所有逻辑继续堆在 `js/app.js` 中。

前端入口是 `index.html`，样式按功能拆分到 `css/`，主题样式放在 `css/themes/`。静态资源清单由 `js/static-assets.js` 统一声明，Service Worker、测试和页面脚本加载共享同一份版本号和路径。主控制器 `js/app.js` 负责启动、渲染和事件协调；纯逻辑模块负责局部能力，例如 `js/link-ui.js` 管添加网址表单，`js/calendar-ui.js` 管日历渲染，`js/ai-actions.js` 管 AI 指令预览与回滚，`js/media-cleanup.js` 管媒体引用识别。

服务端入口是 `server/index.js`。它提供 `/api/data` 整包数据读写、`/api/media/*` 媒体上传下载、`/api/snapshots` 快照、`/api/export` 与 `/api/import` 备份迁移。数据库访问集中在 `server/database.js`，其中 app bundle、AI 设置、媒体元信息和快照表分别存储。

维护方向是继续把 `app.js` 中的 UI 子系统迁移成小模块。新增的 `js/app-modules.js` 记录了当前边界：启动、导航、设置、背景、日历、AI、存储、同步、天气。后续迁移应先补测试，再把同一边界内的纯计算、渲染和事件绑定拆出，保持主控制器只做编排。
