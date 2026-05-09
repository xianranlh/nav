@echo off
chcp 65001 >nul
REM 脚本在 scripts/ 子目录里，先 cd 到上一级（项目根），docker compose 才能找到 docker-compose.yml
cd /d "%~dp0.."

where docker >nul 2>&1
if errorlevel 1 (
  echo 未检测到 Docker，请先安装 Docker Desktop
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-docker.ps1"
pause
