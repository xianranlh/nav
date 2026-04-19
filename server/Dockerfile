# 已合并到仓库根目录 Dockerfile（单容器：nginx + 本服务）。仅单独调试数据 API 时可构建此文件。
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY index.js database.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
