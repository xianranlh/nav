# 樱 · 使用 Docker Compose 构建并启动（与 start-all 二选一）
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "未检测到 Docker，请先安装 Docker Desktop 或 Docker Engine。" -ForegroundColor Red
  exit 1
}

docker compose up -d --build

$port = if ($env:HOST_PORT) { $env:HOST_PORT } else { "8080" }
Write-Host "已启动。浏览器访问：http://127.0.0.1:$port" -ForegroundColor Green
Write-Host "查看日志：docker compose logs -f sakura-nav" -ForegroundColor DarkGray
Write-Host "停止服务：docker compose down" -ForegroundColor DarkGray
