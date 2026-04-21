# 樱 · 个人导航 — 本地一键启动（Node 静态站 + SQLite 数据 API）
# 用法：在仓库根目录执行 .\start-all.ps1
$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "未检测到 Node.js，请先安装：https://nodejs.org/" -ForegroundColor Red
  exit 1
}

$env:DATA_DIR = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $ProjectRoot "data" }
if (-not (Test-Path $env:DATA_DIR)) {
  New-Item -ItemType Directory -Path $env:DATA_DIR | Out-Null
  Write-Host "已创建数据目录: $($env:DATA_DIR)"
}

if (-not (Test-Path (Join-Path $ProjectRoot "server\node_modules"))) {
  Write-Host "正在安装 server 依赖（首次）..." -ForegroundColor Cyan
  npm install --prefix server
}

Write-Host "启动开发服务：http://127.0.0.1:18080  （Ctrl+C 停止）" -ForegroundColor Green
Write-Host "DATA_DIR=$($env:DATA_DIR)" -ForegroundColor DarkGray

npm run dev
