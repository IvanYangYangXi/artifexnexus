@echo off
REM ============================================================
REM  Artifex Nexus - Reset & Run
REM ============================================================

cd /d "%~dp0"
cd ..
setlocal EnableDelayedExpansion

echo.
echo === [1/6] Kill old processes ===
taskkill /F /IM artifex-nexus-desktop.exe >nul 2>&1
taskkill /F /IM python.exe                 >nul 2>&1
taskkill /F /IM pythonw.exe                >nul 2>&1
REM ----- Kill orphan OpenClaw Gateway (node.exe) -----
REM Why: OpenClaw Gateway runs as a node.exe child of sidecar; if sidecar
REM      is killed without graceful stop, the node.exe becomes an orphan
REM      that still holds port 19789 and the PID lock file.
REM      Without killing it here, the next sidecar's is_running() returns
REM      true (the PID is alive, even though it's an orphan), and the
REM      frontend skips startGateway -> overlay never disappears.
REM      We can't blindly `taskkill /F /IM node.exe` (would kill VS Code,
REM      etc), so we filter by listening port 19789.
for /f "tokens=5" %%P in ('netstat -ano -p TCP 2^>nul ^| findstr ":19789" ^| findstr "LISTEN"') do (
    echo    Killing orphan gateway PID=%%P (was holding port 19789)
    taskkill /F /PID %%P >nul 2>&1
)
echo    Done.

echo.
echo === [2/6] Delete Gateway PID lock files ===
del /F /Q "%USERPROFILE%\.artifexnexus\run\gateway.pid" >nul 2>&1
del /F /Q "%USERPROFILE%\.artifexnexus\.openclaw\run\gateway.pid" >nul 2>&1
echo    Done.

echo.
echo === [3/6] Clean sidecar stderr logs ===
del /F /Q "%USERPROFILE%\.artifexnexus\logs\sidecar-stderr-*.log" >nul 2>&1
echo    Done.

echo.
echo === [4/6] Wait 1 second for OS to release port 19789 ===
ping 127.0.0.1 -n 2 >nul

echo.
echo === [5/6] Check if port 19789 is still in use ===
netstat -ano -p TCP 2>nul | findstr ":19789" | findstr "LISTEN"
if errorlevel 1 (
    echo    Port 19789 is free.
) else (
    echo    Port 19789 still occupied! Manually kill the PID shown above and retry.
    goto :done
)

echo.
echo === [6/6] Launch artifex-nexus-desktop.exe ===
set "PROJECT_ROOT=%~dp0.."
for %%A in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fA"
set "EXE=%PROJECT_ROOT%\apps\desktop\src-tauri\target\release\artifex-nexus-desktop.exe"
if exist "%EXE%" goto :launch

echo    EXE not found: %EXE%
echo    Please run: pnpm -C apps/desktop tauri build
goto :done

:launch
start "" "%EXE%"
echo    Launched.

echo.
echo === Next Steps ===
echo    - Wait for splash screen to disappear, or wait 30s if stuck
echo    - Paste sidecar-stderr-*.log from %USERPROFILE%\.artifexnexus\logs to the chat

:done
echo.
pause
