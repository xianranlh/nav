#!/bin/sh
set -e
export SAKURA_API_KEY="${SAKURA_API_KEY:-}"
envsubst '${SAKURA_API_KEY}' < /docker/nginx.conf.template > /etc/nginx/http.d/default.conf
node /app/index.js &
NODE_PID=$!
nginx -g "daemon off;" &
NGINX_PID=$!
trap 'kill $NODE_PID $NGINX_PID 2>/dev/null' TERM INT
wait $NODE_PID $NGINX_PID
