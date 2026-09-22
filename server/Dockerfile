# Standalone API: docker build -f server/Dockerfile . (repository root context).
FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY server/index.js server/database.js server/metadata.js server/music-lx.js server/sso.js ./
COPY server/knowledge/ ./knowledge/
COPY server/ai/ ./ai/
COPY js/ai-image-api.js /js/ai-image-api.js
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
