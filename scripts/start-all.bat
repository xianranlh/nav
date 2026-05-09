@echo off
chcp 65001 >nul
REM 脚本在 scripts/ 子目录里；npm run dev 要在项目根跑
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 https://nodejs.org/
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1"
if errorlevel 1 pause
