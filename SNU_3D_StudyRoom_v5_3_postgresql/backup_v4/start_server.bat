@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required. https://nodejs.org/
  pause
  exit /b 1
)
node server\index.js
pause
