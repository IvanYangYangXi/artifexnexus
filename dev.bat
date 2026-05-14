@echo off
echo Starting Artifex Nexus dev mode...
echo.

cd /d %~dp0

REM Kill any stale process on port 18790
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :18790') do (
    taskkill /f /pid %%a >nul 2>&1
    echo Killed PID %%a on port 18790
)

echo.
echo Launching Tauri dev...
pnpm -C apps/desktop tauri dev
pause
