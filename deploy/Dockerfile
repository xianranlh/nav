# syntax=docker/dockerfile:1.7
#########################################
# 樱 · 单容器：nginx:80 静态 + 反代 /api → Node:3000（仅回环）
#########################################
FROM node:20-alpine

RUN apk add --no-cache nginx gettext

LABEL org.opencontainers.image.title="Xianran Nav"
LABEL org.opencontainers.image.description="樱 · 个人导航（单容器：前端 + 数据 API + AI 反代）"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server/index.js server/database.js ./

COPY index.html styles.css manifest.json sw.js /usr/share/nginx/html/
COPY js/ /usr/share/nginx/html/js/
COPY themes/ /usr/share/nginx/html/themes/

COPY deploy/nginx.conf.template /docker/nginx.conf.template
COPY deploy/docker-entrypoint.sh /docker/docker-entrypoint.sh
RUN chmod +x /docker/docker-entrypoint.sh \
    && mkdir -p /var/log/nginx

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data/xianran-nav \
    BIND_HOST=127.0.0.1

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/docker/docker-entrypoint.sh"]
