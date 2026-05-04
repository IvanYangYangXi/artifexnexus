@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo  Artifex Nexus — 桌面壳开发环境
echo ========================================
echo.

:: ---------- Node.js ----------
echo [检查] Node.js ...
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do echo   ✅ Node.js: %%i
) else (
    echo   ⚠️  Node.js 未安装，正在通过 winget 安装...
    where winget >nul 2>&1
    if %errorlevel% equ 0 (
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        if %errorlevel% neq 0 (
            echo   ❌ winget 安装失败，尝试下载安装包...
            goto :install_node_manual
        )
        echo   ✅ Node.js 安装完成，请重新运行此脚本（需要刷新 PATH）。
        pause
        exit /b 0
    ) else (
        :install_node_manual
        echo   winget 不可用，正在通过 PowerShell 下载 Node.js 安装包...
        powershell -Command "$url='https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi'; $out=\"$env:TEMP\node-installer.msi\"; Invoke-WebRequest -Uri $url -OutFile $out; Start-Process msiexec.exe -ArgumentList '/i',$out,'/quiet','/norestart' -Wait; Remove-Item $out"
        if %errorlevel% neq 0 (
            echo   ❌ 自动安装失败，请手动安装 Node.js: https://nodejs.org/
            pause
            exit /b 1
        )
        echo   ✅ Node.js 安装完成，请重新运行此脚本（需要刷新 PATH）。
        pause
        exit /b 0
    )
)

:: ---------- pnpm ----------
echo [检查] pnpm ...
where pnpm >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('pnpm --version') do echo   ✅ pnpm: %%i
) else (
    echo   ⚠️  pnpm 未安装，正在通过 npm 安装...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo   ❌ pnpm 安装失败，请手动安装: npm install -g pnpm
        pause
        exit /b 1
    )
    for /f "tokens=*" %%i in ('pnpm --version') do echo   ✅ pnpm: %%i
)

:: ---------- Rust ----------
echo [检查] Rust ...
where rustc >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('rustc --version') do echo   ✅ Rust: %%i
) else if exist "%USERPROFILE%\.cargo\bin\rustc.exe" (
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    for /f "tokens=*" %%i in ('rustc --version') do echo   ✅ Rust: %%i
) else (
    echo   ⚠️  Rust 未安装，正在通过 rustup 安装...
    echo   这可能需要几分钟，请耐心等待...
    powershell -Command "Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile $env:TEMP\rustup-init.exe; & $env:TEMP\rustup-init.exe -y"
    if %errorlevel% neq 0 (
        echo   ❌ Rust 安装失败，请手动安装: https://rustup.rs/
        pause
        exit /b 1
    )
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
    for /f "tokens=*" %%i in ('rustc --version') do echo   ✅ Rust: %%i
)

:: ---------- Python ----------
echo [检查] Python ...
where python >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo   ✅ Python: %%i
) else (
    echo   ⚠️  Python 未安装，正在通过 winget 安装...
    where winget >nul 2>&1
    if %errorlevel% equ 0 (
        winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements
        if %errorlevel% neq 0 (
            echo   ❌ winget 安装失败，尝试下载安装包...
            goto :install_python_manual
        )
        echo   ✅ Python 安装完成，请重新运行此脚本（需要刷新 PATH）。
        pause
        exit /b 0
    ) else (
        :install_python_manual
        echo   winget 不可用，正在通过 PowerShell 下载 Python 安装包...
        powershell -Command "$url='https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe'; $out=\"$env:TEMP\python-installer.exe\"; Invoke-WebRequest -Uri $url -OutFile $out; Start-Process $out -ArgumentList '/quiet','InstallAllUsers=1','PrependPath=1' -Wait; Remove-Item $out"
        if %errorlevel% neq 0 (
            echo   ❌ 自动安装失败，请手动安装 Python ^>= 3.11: https://www.python.org/
            echo   安装时请勾选 "Add Python to PATH"
            pause
            exit /b 1
        )
        echo   ✅ Python 安装完成，请重新运行此脚本（需要刷新 PATH）。
        pause
        exit /b 0
    )
)

:: ---------- 安装依赖 ----------
echo.
echo 📦 安装项目依赖...
cd /d "%~dp0.."
call pnpm install
if %errorlevel% neq 0 (
    echo   ⚠️  pnpm install 失败，尝试 --no-frozen-lockfile...
    call pnpm install --no-frozen-lockfile
)

:: ---------- 启动 ----------
echo.
echo 🚀 启动 Tauri 开发服务器...
cd /d "%~dp0..\apps\desktop"
call pnpm tauri dev

pause
