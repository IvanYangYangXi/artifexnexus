<#
.DESCRIPTION
    Artifex Nexus 桌面应用 — 虚拟机安装测试自动化脚本
    
    自动执行：构建 → 产物校验 → 快照还原 → VM 启动
    构建失败或产物缺失时打印诊断信息并退出，不还原快照。

.PARAMETER VmName
    虚拟机名称，默认 "ArtifexNexus-Test-VM"

.PARAMETER BaseSnapshot
    基准快照名称，默认 "01-Base-CleanSystem"

.PARAMETER ProductDir
    构建产物目录，默认打包后的 NSIS 安装包目录

.PARAMETER NoRestore
    跳过快照还原（在已还原状态下重跑时使用）

.PARAMETER NoLaunch
    不启动虚拟机（仅构建 + 还原快照）

.EXAMPLE
    .\testing\test-vm.ps1
    完整流程：构建 → 还原快照 → 启动 VM

.EXAMPLE
    .\testing\test-vm.ps1 -NoRestore
    构建后在当前 VM 状态下直接启动（不还原快照）

.EXAMPLE
    .\testing\test-vm.ps1 -NoLaunch
    仅构建并还原快照，不启动 VM（适合仅需重置环境）
#>

param(
    [string]$VmName = "ArtifexNexus-Test-VM",
    [string]$BaseSnapshot = "01-Base-CleanSystem",
    [string]$ProductDir = "apps\desktop\src-tauri\target\release\bundle\nsis",
    [switch]$NoRestore,
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

# ---- 辅助函数 ----

function Write-Step {
    param([string]$Title)
    Write-Host "`n============================================================" -ForegroundColor DarkGray
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkGray
}

function Write-OK {
    param([string]$Message)
    Write-Host "  [OK] " -NoNewline -ForegroundColor Green
    Write-Host $Message
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  [FAIL] " -NoNewline -ForegroundColor Red
    Write-Host $Message
}

function Write-Info {
    param([string]$Message)
    Write-Host "  [INFO] " -NoNewline -ForegroundColor Yellow
    Write-Host $Message
}

function Find-Tool {
    param([string]$ToolName, [string[]]$SearchPaths)
    
    # 先检查直接命令
    $found = Get-Command $ToolName -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }

    # 再按路径搜索
    foreach ($p in $SearchPaths) {
        $test = Join-Path $p $ToolName
        if (Test-Path "$test.exe") { return "$test.exe" }
        if (Test-Path $test) { return $test }
    }
    return $null
}

# ---- 步骤 1：检查依赖 ----

Write-Step "步骤 1/5：检查依赖"

# 检查 cargo
$cargoPath = Find-Tool "cargo" @("$env:USERPROFILE\.cargo\bin")
if (-not $cargoPath) {
    Write-Fail "cargo 未找到，请先安装 Rust 并将 %USERPROFILE%\.cargo\bin 加入 PATH"
    Write-Info "尝试设置 PATH..."
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    $cargoPath = Get-Command cargo -ErrorAction SilentlyContinue
    if (-not $cargoPath) {
        Write-Fail "仍然找不到 cargo，请手动安装 Rust (https://rustup.rs/)"
        exit 1
    }
}
Write-OK "cargo: $cargoPath"

# 检查 pnpm
$pnpmPath = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmPath) {
    Write-Fail "pnpm 未找到，请先安装 Node.js + pnpm"
    exit 1
}
Write-OK "pnpm: $($pnpmPath.Source)"

# 检查 VBoxManage（非必需，仅在本脚本需要还原/启动 VM 时检查）
$vboxPath = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
if ((-not $NoRestore -or -not $NoLaunch) -and -not (Test-Path $vboxPath)) {
    Write-Fail "VBoxManage 未找到在默认路径: $vboxPath"
    Write-Info "如果 VirtualBox 安装在其他位置，请修改脚本中的 `$vboxPath` 变量"
    exit 1
}
if (Test-Path $vboxPath) {
    Write-OK "VBoxManage: $vboxPath"
}

# ---- 步骤 2：检查 VM 是否存在 ----

if (-not $NoRestore -and (Test-Path $vboxPath)) {
    Write-Step "步骤 2/5：检查虚拟机状态"
    
    $vmList = & $vboxPath list vms 2>&1
    if ($vmList -notmatch $VmName) {
        Write-Fail "虚拟机 '$VmName' 未找到"
        Write-Info "可用的虚拟机列表："
        Write-Host $vmList
        Write-Info "请先按 vm-setup-guide.md 创建虚拟机"
        exit 1
    }
    Write-OK "虚拟机 '$VmName' 存在"

    # 检查快照
    $snapList = & $vboxPath snapshot $VmName list 2>&1
    if ($snapList -notmatch $BaseSnapshot) {
        Write-Fail "快照 '$BaseSnapshot' 未找到"
        Write-Info "可用的快照列表："
        Write-Host $snapList
        Write-Info "请在虚拟机内配置完环境后创建快照，名称: $BaseSnapshot"
        exit 1
    }
    Write-OK "快照 '$BaseSnapshot' 存在"
} else {
    Write-Step "步骤 2/5：跳过（-NoRestore 模式）"
}

# ---- 步骤 3：构建 ----

Write-Step "步骤 3/5：构建安装包 (pnpm tauri build)"

Set-Location $ProjectRoot

$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$buildStart = Get-Date

$buildOutput = pnpm -C apps/desktop tauri build 2>&1
$buildExit = $LASTEXITCODE

$buildDuration = [math]::Round(((Get-Date) - $buildStart).TotalSeconds, 1)

if ($buildExit -ne 0) {
    Write-Fail "tauri build 失败 (exit code: $buildExit, 耗时: ${buildDuration}s)"
    Write-Host "`n--- 构建输出（最后 30 行）---" -ForegroundColor DarkGray
    $buildOutput | Select-Object -Last 30 | ForEach-Object { Write-Host $_ }
    Write-Host "--- 输出结束 ---" -ForegroundColor DarkGray
    exit 1
}
Write-OK "tauri build 成功 (耗时: ${buildDuration}s)"

# ---- 步骤 4：校验产物 ----

Write-Step "步骤 4/5：校验产物"

$productFullPath = Join-Path $ProjectRoot $ProductDir

if (-not (Test-Path $productFullPath)) {
    Write-Fail "产物目录不存在: $productFullPath"
    Write-Info "请检查 tauri build 输出，确认 NSIS 打包是否启用"
    exit 1
}

$installer = Get-ChildItem "$productFullPath\*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $installer) {
    Write-Fail "未找到 .exe 安装包"
    Write-Info "目录内容："
    Get-ChildItem $productFullPath | ForEach-Object { Write-Host "    $($_.Name)" }
    exit 1
}

$exeSizeMB = [math]::Round($installer.Length / 1MB, 2)
$exeTimestamp = $installer.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
$exePath = $installer.FullName

Write-OK "安装包: $($installer.Name)"
Write-OK "大小: ${exeSizeMB} MB"
Write-OK "时间戳: $exeTimestamp"
Write-OK "路径: $exePath"

# 验证可执行文件也编译成功
$mainExe = Join-Path $ProjectRoot "apps\desktop\src-tauri\target\release\artifex-nexus-desktop.exe"
if (Test-Path $mainExe) {
    $exeSize = [math]::Round((Get-Item $mainExe).Length / 1MB, 2)
    $exeTime = (Get-Item $mainExe).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
    Write-OK "主程序: artifex-nexus-desktop.exe (${exeSize} MB, $exeTime)"
} else {
    Write-Info "主程序 exe 未找到（可能被 strip 移除，NSIS 安装包内已包含）"
}

# ---- 步骤 5：还原快照并启动 ----

if (-not $NoLaunch -and (Test-Path $vboxPath)) {
    Write-Step "步骤 5/5：还原快照 & 启动虚拟机"

    if (-not $NoRestore) {
        Write-Info "正在还原快照 '$BaseSnapshot'..."
        $restoreOutput = & $vboxPath snapshot $VmName restore $BaseSnapshot 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "快照还原失败"
            Write-Host $restoreOutput
            exit 1
        }
        Write-OK "快照已还原"
    }

    Write-Info "正在启动虚拟机 '$VmName'..."
    $startOutput = & $vboxPath startvm $VmName 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "虚拟机启动失败"
        Write-Host $startOutput
        exit 1
    }
    Write-OK "虚拟机已启动"
} elseif (-not $NoLaunch) {
    Write-Step "步骤 5/5：跳过（VBoxManage 不可用）"
    Write-Info "请手动启动虚拟机并执行安装测试"
}

# ---- 完成 ----

Write-Host "`n============================================================" -ForegroundColor DarkGray
Write-Host "  测试环境就绪！" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor DarkGray

Write-Host ""
Write-Host "虚拟机内操作指南：" -ForegroundColor Yellow
Write-Host "  1. 打开文件资源管理器，导航到共享文件夹（通常 Z: 盘）"
Write-Host "  2. 双击 $($installer.Name) 开始安装"
Write-Host "  3. 按 testing/install-checklist.md 逐项验证"
Write-Host ""
Write-Host "测试完成后还原环境：" -ForegroundColor Yellow
Write-Host "  运行: .\testing\test-vm.ps1 （再次构建新版）"
Write-Host "  或手动: VBoxManage snapshot ""$VmName"" restore ""$BaseSnapshot"""
Write-Host ""

exit 0
