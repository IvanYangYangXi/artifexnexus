@echo off
setlocal enabledelayedexpansion

echo ========================================
echo  Artifex Nexus - Desktop Dev Launcher
echo ========================================
echo.

:: ---------- Node.js ----------
echo [Check] Node.js ...
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do echo   [OK] Node.js: %%i
) else (
    echo   [INSTALL] Node.js not found, installing via winget...
    where winget >nul 2>&1
    if %errorlevel% equ 0 (
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        if %errorlevel% neq 0 (
            echo   [FAIL] winget install failed, trying MSI download...
            powershell -Command "$url='https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi'; $out=\"$env:TEMP\node-installer.msi\"; Invoke-WebRequest -Uri $url -OutFile $out; Start-Process msiexec.exe -ArgumentList '/i',$out,'/quiet','/norestart' -Wait; Remove-Item $out"
        )
        echo   [DONE] Node.js installed. Please re-run this script to refresh PATH.
        pause
        exit /b 0
    ) else (
        echo   [FAIL] winget not available. Please install Node.js manually:
        echo   https://nodejs.org/
        pause
        exit /b 1
    )
)

:: ---------- pnpm ----------
echo [Check] pnpm ...
where pnpm >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('pnpm --version') do echo   [OK] pnpm: %%i
) else (
    echo   [INSTALL] pnpm not found, installing via npm...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo   [FAIL] pnpm install failed. Please run: npm install -g pnpm
        pause
        exit /b 1
    )
    for /f "tokens=*" %%i in ('pnpm --version') do echo   [OK] pnpm: %%i
)

:: ---------- Rust ----------
echo [Check] Rust ...
where rustc >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('rustc --version') do echo   [OK] Rust: %%i
) else if exist "%USERPROFILE%\.cargo\bin\rustc.exe" (
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    for /f "tokens=*" %%i in ('rustc --version') do echo   [OK] Rust: %%i
) else (
    echo   [INSTALL] Rust not found, installing via rustup...
    echo   This may take a few minutes...
    powershell -Command "Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile $env:TEMP\rustup-init.exe; & $env:TEMP\rustup-init.exe -y"
    if %errorlevel% neq 0 (
        echo   [FAIL] Rust install failed. Please install manually: https://rustup.rs/
        pause
        exit /b 1
    )
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    for /f "tokens=*" %%i in ('rustc --version') do echo   [OK] Rust: %%i
)

:: ---------- Python ----------
echo [Check] Python ...
where python >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo   [OK] Python: %%i
) else (
    echo   [INSTALL] Python not found, installing via winget...
    where winget >nul 2>&1
    if %errorlevel% equ 0 (
        winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements
        if %errorlevel% neq 0 (
            echo   [FAIL] winget install failed, trying exe download...
            powershell -Command "$url='https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe'; $out=\"$env:TEMP\python-installer.exe\"; Invoke-WebRequest -Uri $url -OutFile $out; Start-Process $out -ArgumentList '/quiet','InstallAllUsers=1','PrependPath=1' -Wait; Remove-Item $out"
        )
        echo   [DONE] Python installed. Please re-run this script to refresh PATH.
        pause
        exit /b 0
    ) else (
        echo   [FAIL] winget not available. Please install Python ^>= 3.11 manually:
        echo   https://www.python.org/  (check "Add Python to PATH")
        pause
        exit /b 1
    )
)

:: ---------- Install Dependencies ----------
echo.
echo [Install] Project dependencies...
cd /d "%~dp0.."
call pnpm install
if %errorlevel% neq 0 (
    echo   [RETRY] pnpm install failed, trying --no-frozen-lockfile...
    call pnpm install --no-frozen-lockfile
)

:: ---------- Launch ----------
echo.
echo [Launch] Starting Tauri dev server...
cd /d "%~dp0..\apps\desktop"
call pnpm tauri dev

pause
