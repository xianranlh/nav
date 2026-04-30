# 部署说明

本地开发推荐使用 `npm run dev`，它会启动 `server/index.js --static`，默认监听 `18080`，并从仓库根目录托管前端静态文件。生产或长期自用推荐 Docker 部署，使用 `docker compose up -d --build` 构建并启动服务。数据目录需要挂载为持久化卷，否则 SQLite 和媒体文件会随容器删除而丢失。

关键环境变量包括 `PORT`、`DATA_DIR`、`STATIC_ROOT`、`SERVE_STATIC`、`BIND_HOST` 和 `SAKURA_API_KEY`。Docker Compose 额外提供 `SAKURA_DATA_HOST_DIR` 与 `SAKURA_DATA_DIR`：前者配置宿主机持久化目录，后者配置容器内应用写入目录，默认分别为 `./data` 和 `/data/sakura-nav`。如果设置 `SAKURA_API_KEY`，API 请求需要携带 Bearer Token；未设置时适合本机或受保护网络使用。前端静态服务与 API 同源时，存储适配层会优先使用服务端数据，避免业务数据落入浏览器 localStorage。

静态资源由 `js/static-assets.js` 控制版本。修改脚本或样式后需要同步提升 `VERSION`，并确保 `index.html` 中 `js/app.js?v=...` 与 manifest 一致。Service Worker 会预缓存 manifest 中的核心文件，因此漏配路径可能导致旧资源残留。

部署后建议运行 `npm run smoke:browser` 做冒烟检查。该脚本会启动临时本地服务，验证 `/healthz`、`/api/data`、首页 HTML、主样式与关键脚本资源。若本机安全策略阻止临时端口监听，需要允许 Node 在本机回环地址启动测试服务。
