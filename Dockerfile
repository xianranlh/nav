# syntax=docker/dockerfile:1.7
#########################################
# 樱 · 个人导航 - 静态部署镜像
#   - 基于 nginx:alpine (~25MB)
#   - 仅复制必要的前端文件，避免把说明文档等打进去
#########################################
FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="Sakura Nav"
LABEL org.opencontainers.image.description="樱 · 个人导航起始页（纯前端 PWA）"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/your-user/sakura-nav"

# 清理默认站点并替换为自定义配置
RUN rm -f /etc/nginx/conf.d/default.conf \
    && rm -rf /usr/share/nginx/html/*

COPY nginx.conf /etc/nginx/conf.d/default.conf

# 拷贝前端静态文件
COPY index.html     /usr/share/nginx/html/
COPY styles.css     /usr/share/nginx/html/
COPY manifest.json  /usr/share/nginx/html/
COPY sw.js          /usr/share/nginx/html/

# 所有 JS 模块
COPY sakura.js      /usr/share/nginx/html/
COPY bookmarks.js   /usr/share/nginx/html/
COPY auth.js        /usr/share/nginx/html/
COPY ai.js          /usr/share/nginx/html/
COPY blog.js        /usr/share/nginx/html/
COPY calendar.js    /usr/share/nginx/html/
COPY sync.js        /usr/share/nginx/html/
COPY weather.js     /usr/share/nginx/html/
COPY suggest.js     /usr/share/nginx/html/
COPY exporter.js    /usr/share/nginx/html/
COPY idb.js         /usr/share/nginx/html/
COPY music.js       /usr/share/nginx/html/
COPY app.js         /usr/share/nginx/html/

# 内置 LX Music 协议音源脚本（供客户端下载导入 LX Music 桌面客户端使用）
COPY lx-sources/    /usr/share/nginx/html/lx-sources/

# 预留给自定义图标 / README 可选
# COPY README.md     /usr/share/nginx/html/

# nginx:alpine 已经用非 root 的 nginx 用户跑 worker
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
