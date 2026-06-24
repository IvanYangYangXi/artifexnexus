@echo off
setlocal enabledelayedexpansion

echo ========================================
echo  Artifex Nexus - Dev Launcher
echo ========================================
echo.

cd /d "%~dp0"

:: ---------- 1. Node.js ----------
echo [Check] Node.js ...
where node >nul 2>&1
if !errorlevel! equ 0 (
    for /f "tokens=*" %%i in ('node --version') do echo   [OK] Node.js: %%i
) else (
    echo   [INSTALL] Node.js not found, installing via winget...
    where winget >nul 2>&1
    if !errorlevel! equ 0 (
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        echo   [INFO] Node.js installed. Please CLOSE this window and re-run dev.bat.
        pause
        exit /b 0
    ) else (
        echo   [FAIL] winget not available. Please install Node.js manually: https://nodejs.org/
        pause
        exit /b 1
    )
)

:: ---------- 2. pnpm ----------
echo [Check] pnpm ...
where pnpm >nul 2>&1
if !errorlevel! equ 0 (
    for /f "tokens=*" %%i in ('pnpm --version') do echo   [OK] pnpm: %%i
) else (
    echo   [INSTALL] Enabling pnpm via corepack...
    call corepack enable pnpm 2>nul
    call corepack prepare pnpm@9.12.0 --activate 2>nul
    if !errorlevel! neq 0 (
        echo   [INSTALL] corepack failed, trying npm install -g pnpm...
        call npm install -g pnpm@9.12.0
    )
    where pnpm >nul 2>&1
    if !errorlevel! neq 0 (
        echo   [FAIL] pnpm install failed. Please run: npm install -g pnpm@9.12.0
        pause
        exit /b 1
    )
    for /f "tokens=*" %%i in ('pnpm --version') do echo   [OK] pnpm: %%i
)

:: ---------- 3. Rust ----------
echo [Check] Rust ...
where rustc >nul 2>&1
if !errorlevel! equ 0 (
    for /f "tokens=*" %%i in ('rustc --version') do echo   [OK] Rust: %%i
) else if exist "%USERPROFILE%\.cargo\bin\rustc.exe" (
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    for /f "tokens=*" %%i in ('rustc --version') do echo   [OK] Rust: %%i
) else (
    echo   [INSTALL] Rust not found, installing via rustup...
    echo   This may take a few minutes...
    powershell -Command "Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile $env:TEMP\rustup-init.exe; & $env:TEMP\rustup-init.exe -y"
    if !errorlevel! neq 0 (
        echo   [FAIL] Rust install failed. Please install manually: https://rustup.rs/
        pause
        exit /b 1
    )
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    for /f "tokens=*" %%i in ('rustc --version') do echo   [OK] Rust: %%i
)

:: ---------- 4. MSVC Build Tools (warning only) ----------
echo [Check] MSVC Build Tools ...
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "!VSWHERE!" (
    for /f "tokens=*" %%i in ('"!VSWHERE!" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul') do set "VS_PATH=%%i"
    if defined VS_PATH (
        echo   [OK] MSVC: !VS_PATH!
    ) else (
        echo   [WARN] VS Build Tools installed but C++ workload missing.
        echo   Run: winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools"
    )
) else (
    echo   [WARN] MSVC Build Tools not found. Tauri Rust compilation will fail.
    echo   Run: winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools"
)

:: ---------- 5. Project Dependencies ----------
echo [Check] Project dependencies ...
if not exist "node_modules" (
    echo   [INSTALL] Running pnpm install...
    call pnpm install
    if !errorlevel! neq 0 (
        echo   [RETRY] pnpm install failed, trying --no-frozen-lockfile...
        call pnpm install --no-frozen-lockfile
    )
) else (
    echo   [OK] node_modules exists
)

:: Build contracts package if dist/ missing
if not exist "packages\platform\contracts\typescript\dist" (
    echo   [BUILD] Building @artifex-nexus/contracts...
    call pnpm --filter @artifex-nexus/contracts build
)

:: ---------- 6. Staging ----------
echo [Check] Staging directory ...
if not exist "apps\desktop\staging\pnpm-workspace.yaml" (
    echo   [PREPARE] Creating staging directory...
    node scripts\prepare-staging.mjs
    if !errorlevel! neq 0 (
        echo   [FAIL] Staging preparation failed.
        pause
        exit /b 1
    )
) else (
    echo   [OK] Staging ready
)

:: ---------- 7. OpenClaw CLI ----------
echo [Check] OpenClaw CLI ...
set "OPENCLAW_HOME=%USERPROFILE%\.artifexnexus\.openclaw"
set "OPENCLAW_VERSION=v2026.5.4"
set "CLI_PREFIX=%OPENCLAW_HOME%\cli\%OPENCLAW_VERSION%"

if exist "%CLI_PREFIX%\openclaw.cmd" (
    echo   [OK] OpenClaw CLI: %OPENCLAW_VERSION%
) else (
    echo   [INSTALL] Installing OpenClaw CLI %OPENCLAW_VERSION% ...
    echo   This downloads ~100MB, please wait...
    mkdir "%CLI_PREFIX%" 2>nul
    call npm install -g --prefix "%CLI_PREFIX%" openclaw@%OPENCLAW_VERSION%
    if !errorlevel! neq 0 (
        echo   [FAIL] OpenClaw CLI install failed.
        echo   You can retry later via the app Settings page.
    ) else (
        :: Create pointer file (Windows fallback for version resolution)
        echo %OPENCLAW_VERSION%> "%OPENCLAW_HOME%\cli\current.txt"
        :: Create bin\openclaw.cmd wrapper
        mkdir "%CLI_PREFIX%\bin" 2>nul
        echo @echo off> "%CLI_PREFIX%\bin\openclaw.cmd"
        echo "%%~dp0..\openclaw.cmd" %%*>> "%CLI_PREFIX%\bin\openclaw.cmd"
        echo   [OK] OpenClaw CLI installed
    )
)

:: ---------- 8. OpenClaw Bootstrap (config) ----------
echo [Check] OpenClaw config ...
if exist "%OPENCLAW_HOME%\openclaw.json" (
    echo   [OK] Config exists
) else (
    echo   [BOOTSTRAP] Running first-time setup...
    uv run python -c "import sys; sys.path.insert(0, r'packages\adapters\openclaw\wrapper\src'); sys.path.insert(0, r'packages\platform\core\src'); sys.path.insert(0, r'packages\platform\skill\src'); from pathlib import Path; from artifex_nexus.openclaw_wrapper.bootstrap import bootstrap_fixed_port; r,p = bootstrap_fixed_port(Path.home()/'.artifexnexus'/'.openclaw'); print('bootstrap:', r.success)"
    if !errorlevel! neq 0 (
        echo   [WARN] Bootstrap failed. The app will retry on startup.
    )
)

:: ---------- 9. Kill stale process on port 18790 ----------
echo [Check] Port 18790 ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :18790') do (
    taskkill /f /pid %%a >nul 2>&1
    echo   Killed PID %%a on port 18790
)

:: ---------- 10. Launch ----------
echo.
echo ========================================
echo  Launching Tauri Dev
echo ========================================
echo.
pnpm -C apps/desktop tauri dev
pause
