<#
.SYNOPSIS
    Artifex Nexus 打包脚本
    构建 Tauri 桌面应用，生成便携版 zip 和 NSIS 安装器

.DESCRIPTION
    完整打包流程：
      Phase 1 - 创建 staging 目录（收集所有运行时文件）
      Phase 2 - Tauri 构建（编译 Rust + NSIS 打包，resources 从 staging 注入）
      Phase 3 - 便携版 zip（EXE/DLL 放根目录 + 完整文件树）
      Phase 4 - 产物汇总

.PARAMETER SkipBuild
    跳过 Tauri 构建（假设 EXE 已存在，仅重新打包）

.PARAMETER PortableOnly
    仅生成便携版 zip，不关注 NSIS 安装器

.PARAMETER WithRuntime
    TODO: 包含 standalone Python 3.11 + uv 二进制

.PARAMETER OutputDir
    自定义输出目录（默认：apps/desktop/src-tauri/target/release/dist/）

.EXAMPLE
    .\scripts\package.ps1
    完整打包：创建 staging → Tauri 构建 → 便携版 zip + NSIS

.EXAMPLE
    .\scripts\package.ps1 -SkipBuild -PortableOnly
    跳过编译，仅基于已有 EXE 重新打包便携版
#>

param(
    [switch]$SkipBuild,
    [switch]$PortableOnly,
    [switch]$WithRuntime,
    [string]$OutputDir,
    [string]$PackageDir
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."
$DesktopDir = "$ProjectRoot\apps\desktop"
$SrcTauriDir = "$DesktopDir\src-tauri"
$TargetDir = "$SrcTauriDir\target\release"

# --- Read version from tauri.conf.json ---
$TauriConfPath = "$SrcTauriDir\tauri.conf.json"
$TauriConf = Get-Content $TauriConfPath -Raw | ConvertFrom-Json
$Version = $TauriConf.version
$ProductName = $TauriConf.productName

# --- Output directory setup ---
$Timestamp = Get-Date -Format "yyyy-MM-dd"

if (-not $OutputDir) {
    $OutputDir = "$TargetDir\dist"
}

# Versioned package directory (for final delivery artifacts)
if ($PackageDir) {
    $VersionedDir = "$PackageDir\$Timestamp`_v$Version"
}
else {
    $VersionedDir = $null
}

$StagingDir = "$DesktopDir\staging"
$PortableName = "$ProductName-portable-v$Version"
$PortableDir = "$OutputDir\$PortableName"

# ====================================================================
# Banner
# ====================================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Artifex Nexus Packaging v$Version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Staging  : $StagingDir"
Write-Host "  Temp Out : $OutputDir"
Write-Host "  Portable : $PortableName"
if ($VersionedDir) {
    Write-Host "  Delivery : $VersionedDir" -ForegroundColor Magenta
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ====================================================================
# Helper functions
# ====================================================================

function Ensure-Dir {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Copy-Tree {
    <#
    .SYNOPSIS
        Copy source directory tree to staging, preserving relative structure.
        Skips if source doesn't exist (non-fatal).
    #>
    param(
        [string]$SourceRel,    # relative to ProjectRoot
        [string]$DestRel,      # relative to StagingDir (default: same as SourceRel)
        [string]$Label = ""    # optional label for log output
    )
    $src = Join-Path $ProjectRoot $SourceRel
    $dst = Join-Path $StagingDir $(if ($DestRel) { $DestRel } else { $SourceRel })

    if (Test-Path $src) {
        Ensure-Dir (Split-Path -Parent $dst)
        Copy-Item -Recurse -Force $src $dst
        $display = if ($Label) { $Label } else { $SourceRel }
        Write-Host "  [OK] $display" -ForegroundColor Green
    }
    else {
        Write-Host "  [SKIP] $SourceRel (not found)" -ForegroundColor DarkYellow
    }
}

function Copy-FileTo {
    <#
    .SYNOPSIS
        Copy a single file to staging, optionally renaming/relocating.
    #>
    param(
        [string]$SourceRel,
        [string]$DestRel,
        [string]$Label = ""
    )
    $src = Join-Path $ProjectRoot $SourceRel
    $dst = Join-Path $StagingDir $(if ($DestRel) { $DestRel } else { $SourceRel })

    if (Test-Path $src) {
        Ensure-Dir (Split-Path -Parent $dst)
        Copy-Item -Force $src $dst
        $display = if ($Label) { $Label } else { $SourceRel }
        Write-Host "  [OK] $display" -ForegroundColor Green
    }
    else {
        Write-Host "  [SKIP] $SourceRel (not found)" -ForegroundColor DarkYellow
    }
}

# ====================================================================
# Phase 1: Stage Files
# ====================================================================
Write-Host "=== Phase 1/4: Create staging directory ===" -ForegroundColor Cyan
Write-Host ""

# Clean and recreate staging
if (Test-Path $StagingDir) {
    Remove-Item -Recurse -Force $StagingDir
}
Ensure-Dir $StagingDir

# --- 1a. Python sidecar & wrapper (23 .py files) ---
Write-Host "  [Python sidecar]" -ForegroundColor Gray
Copy-Tree "packages\adapters\openclaw\wrapper\src\artifex_nexus\openclaw_wrapper" `
          "packages\adapters\openclaw\wrapper\src\artifex_nexus\openclaw_wrapper" `
          "sidecar + wrapper (23 .py)"

# --- 1b. Platform core & skill modules (sidecar runtime deps) ---
Write-Host "  [Platform modules]" -ForegroundColor Gray
Copy-Tree "packages\platform\core\src\artifex_nexus\core" `
          "packages\platform\core\src\artifex_nexus\core" `
          "core (skill_config.py)"
Copy-Tree "packages\platform\skill\src\artifex_nexus\skill" `
          "packages\platform\skill\src\artifex_nexus\skill" `
          "skill hub (24 .py)"

# --- 1c. Contracts: data + schemas ---
Copy-Tree "packages\platform\contracts\data" `
          "packages\platform\contracts\data" `
          "contracts/data (categories.json)"
Copy-Tree "packages\platform\contracts\schemas" `
          "packages\platform\contracts\schemas" `
          "contracts/schemas (9 .schema.json)"

# --- 1d. Gateway MCP Bridge plugin (dist only, no src/node_modules) ---
Write-Host "  [Gateway plugin]" -ForegroundColor Gray
Copy-Tree "packages\adapters\openclaw\gateway-plugin\dist" `
          "packages\adapters\openclaw\gateway-plugin\dist" `
          "gateway-plugin/dist (index.js + plugin.json)"

# --- 1e. DCC plugins & SDK ---
Write-Host "  [DCC plugins]" -ForegroundColor Gray
Copy-Tree "packages\dcc\unreal" "packages\dcc\unreal" "UE plugin template"
Copy-Tree "packages\dcc\blender\src" "packages\dcc\blender\src" "Blender addon"
Copy-Tree "packages\dcc\shared\artifex_nexus_sdk" `
          "packages\dcc\shared\artifex_nexus_sdk" `
          "SDK (5 .py)"

# --- 1f. Skills & Tools: official/ only, marketplace/ excluded ---
Write-Host "  [Skills & Tools]" -ForegroundColor Gray
Copy-Tree "skills\official" "skills\official" "skills/official (4 skills)"
Copy-Tree "tools\official"  "tools\official"  "tools/official (2 tools)"
Copy-FileTo "tools\diagnose_dcc_tool_run.py" "tools\diagnose_dcc_tool_run.py" `
            "diagnose_dcc_tool_run.py"

Write-Host "  [SKIP] skills/marketplace/ (~35 skills) - excluded from base package" -ForegroundColor DarkYellow
Write-Host "  [SKIP] tools/marketplace/  (6 tools)    - excluded from base package" -ForegroundColor DarkYellow

# --- 1g. Root marker file ---
Copy-FileTo "pnpm-workspace.yaml" "pnpm-workspace.yaml" "pnpm-workspace.yaml (root anchor)"

# --- 1h. Frontend output (will be built by tauri build, but stage now as placeholder) ---
# The actual build happens in Phase 2. We create the directory for tauri resource mapping.
Ensure-Dir "$StagingDir\packages\apps\web\out"

# --- 1i. Runtime (optional - TODO) ---
if ($WithRuntime) {
    Write-Host "  [Runtime]" -ForegroundColor Gray
    Write-Host "  [TODO] Runtime fetching not yet implemented. Use fetch-python.sh / fetch-uv.sh manually." -ForegroundColor DarkYellow
}

# --- 1j. Clean __pycache__ and .pyc files ---
Write-Host "  [Cleanup]" -ForegroundColor Gray
$pycacheDirs = Get-ChildItem -Recurse -Directory -Path $StagingDir -Filter "__pycache__" -ErrorAction SilentlyContinue
$pycacheCount = ($pycacheDirs | Measure-Object).Count
if ($pycacheCount -gt 0) {
    $pycacheDirs | Remove-Item -Recurse -Force
    Write-Host "  [OK] Removed $pycacheCount __pycache__ directories" -ForegroundColor Green
}
# Also remove stray .pyc files outside __pycache__
$pycFiles = Get-ChildItem -Recurse -File -Path $StagingDir -Filter "*.pyc" -ErrorAction SilentlyContinue
$pycCount = ($pycFiles | Measure-Object).Count
if ($pycCount -gt 0) {
    $pycFiles | Remove-Item -Force
    Write-Host "  [OK] Removed $pycCount stray .pyc files" -ForegroundColor Green
}

# --- Summary ---
$stagedCount = (Get-ChildItem -Recurse -File $StagingDir).Count
Write-Host ""
Write-Host "  Staged $stagedCount files to: $StagingDir" -ForegroundColor Green
Write-Host ""

# ====================================================================
# Phase 2: Build Tauri App
# ====================================================================
if (-not $SkipBuild) {
    Write-Host "=== Phase 2/4: Build Tauri App (pnpm tauri build) ===" -ForegroundColor Cyan
    Write-Host ""

    Push-Location $DesktopDir
    try {
        # Tauri's beforeBuildCommand will build Next.js frontend into packages/apps/web/out/
        # After build, we sync the fresh frontend output back to staging
        pnpm tauri build
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm tauri build failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    # --- Sync freshly built frontend to staging ---
    $frontendOut = "$ProjectRoot\packages\apps\web\out"
    if (Test-Path $frontendOut) {
        $stagingFrontend = "$StagingDir\packages\apps\web\out"
        if (Test-Path $stagingFrontend) { Remove-Item -Recurse -Force $stagingFrontend }
        Copy-Item -Recurse -Force $frontendOut $stagingFrontend
        Write-Host "  [OK] Synced frontend output to staging" -ForegroundColor Green
    }

    Write-Host "  Build complete." -ForegroundColor Green
    Write-Host ""
}
else {
    Write-Host "=== Phase 2/4: BUILD SKIPPED (--SkipBuild) ===" -ForegroundColor Yellow
    Write-Host ""

    # Still need frontend output for portable package
    $frontendOut = "$ProjectRoot\packages\apps\web\out"
    if (Test-Path $frontendOut) {
        $stagingFrontend = "$StagingDir\packages\apps\web\out"
        if (-not (Test-Path $stagingFrontend)) {
            Ensure-Dir (Split-Path -Parent $stagingFrontend)
            Copy-Item -Recurse -Force $frontendOut $stagingFrontend
            Write-Host "  [OK] Copied existing frontend output to staging" -ForegroundColor Green
        }
    }
    else {
        Write-Host "  [WARN] Frontend output not found. Run build first." -ForegroundColor Yellow
    }
}

# ====================================================================
# Verify build artifacts
# ====================================================================
$ExeSrc = "$TargetDir\artifex-nexus-desktop.exe"
$DllSrc = "$TargetDir\artifex_nexus_desktop_lib.dll"

if (-not (Test-Path $ExeSrc)) {
    throw "EXE not found at: $ExeSrc`nRun without --SkipBuild or check build output."
}
if (-not (Test-Path $DllSrc)) {
    Write-Host "  [WARN] DLL not found: $DllSrc" -ForegroundColor Yellow
}

$exeSize = [math]::Round((Get-Item $ExeSrc).Length / 1MB, 1)
Write-Host "  EXE: $ExeSrc ($exeSize MB)" -ForegroundColor Green
Write-Host ""

# ====================================================================
# Phase 3: Portable Package (EXE at root)
# ====================================================================
Write-Host "=== Phase 3/4: Assemble portable package ===" -ForegroundColor Cyan
Write-Host ""

# Clean and create portable dir
if (Test-Path $PortableDir) { Remove-Item -Recurse -Force $PortableDir }
Ensure-Dir $PortableDir

# --- Copy EXE + DLL to portable root (NOT nested in packages/) ---
Copy-Item -Force $ExeSrc "$PortableDir\artifex-nexus-desktop.exe"
Write-Host "  [OK] EXE -> portable root" -ForegroundColor Green

if (Test-Path $DllSrc) {
    Copy-Item -Force $DllSrc "$PortableDir\artifex_nexus_desktop_lib.dll"
    Write-Host "  [OK] DLL -> portable root" -ForegroundColor Green
}

# --- Copy all staged content ---
Copy-Item -Recurse -Force "$StagingDir\*" $PortableDir
Write-Host "  [OK] Staging tree -> portable" -ForegroundColor Green

# --- Create portable zip ---
Ensure-Dir $OutputDir
$ZipPath = "$OutputDir\$PortableName.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }

# Use .NET compression for better performance on large dirs
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($PortableDir, $ZipPath)

$zipSize = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "  Portable zip: $ZipPath" -ForegroundColor Green
Write-Host "  Size: $zipSize MB" -ForegroundColor Green
Write-Host ""

# --- Verify portable structure ---
Write-Host "  Portable package structure:" -ForegroundColor Gray
$topItems = Get-ChildItem $PortableDir -Name
foreach ($item in $topItems) {
    $marker = if ($item -eq "artifex-nexus-desktop.exe") { " <-- user entry point" } else { "" }
    Write-Host "    $item$marker"
}

# ====================================================================
# Phase 4: NSIS Installer & Final Delivery
# ====================================================================
Write-Host ""
Write-Host "=== Phase 4/4: Output summary ===" -ForegroundColor Cyan
Write-Host ""

$nsisDir = "$TargetDir\bundle\nsis"
$nsisInstaller = $null
if (Test-Path $nsisDir) {
    $nsisExe = Get-ChildItem -Path $nsisDir -Filter "*_x64-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($nsisExe) { $nsisInstaller = $nsisExe.FullName }
}
$nsisSize = $null

Write-Host "  Artifacts:" -ForegroundColor White
Write-Host "  ----------------------------------------"
Write-Host "  Portable zip : $ZipPath" -ForegroundColor Green
Write-Host "                 ($zipSize MB)" -ForegroundColor Gray

if (Test-Path $nsisInstaller) {
    $nsisSize = [math]::Round((Get-Item $nsisInstaller).Length / 1MB, 1)
    Write-Host "  NSIS installer: $nsisInstaller" -ForegroundColor Green
    Write-Host "                  ($nsisSize MB)" -ForegroundColor Gray

    # Check if resources were bundled (EXE-only builds are ~3 MB, with resources ~4+ MB)
    if ($nsisSize -lt 3.5) {
        Write-Host ""
        Write-Host "  [NOTE] NSIS installer appears to be EXE-only (~$nsisSize MB)." -ForegroundColor Yellow
        Write-Host "         Source files (packages/, skills/, tools/) are NOT bundled." -ForegroundColor Yellow
        Write-Host "         To bundle resources into NSIS, configure tauri.conf.json" -ForegroundColor Yellow
        Write-Host "         bundle.resources: {'../staging/': '.'}" -ForegroundColor Yellow
    }
}
else {
    Write-Host "  NSIS installer: not found" -ForegroundColor Yellow
    Write-Host "                  Run without --SkipBuild to generate." -ForegroundColor Yellow
}

# --- Copy to versioned delivery directory ---
if ($VersionedDir) {
    Write-Host ""
    Write-Host "  === Delivering to versioned package directory ===" -ForegroundColor Magenta
    Write-Host ""

    Ensure-Dir $VersionedDir

    # Copy portable zip
    $deliveryZip = "$VersionedDir\$PortableName.zip"
    Write-Host "  Copying portable zip..." -ForegroundColor Gray
    Copy-Item -Force $ZipPath $deliveryZip
    Write-Host "  [OK] $deliveryZip" -ForegroundColor Green

    # Copy NSIS installer
    if ($nsisInstaller -and (Test-Path $nsisInstaller)) {
        $nsisName = Split-Path -Leaf $nsisInstaller
        $deliveryNsis = "$VersionedDir\$nsisName"
        Write-Host "  Copying NSIS installer..." -ForegroundColor Gray
        Copy-Item -Force $nsisInstaller $deliveryNsis
        Write-Host "  [OK] $deliveryNsis" -ForegroundColor Green
    }

    # Manifest
    $manifestPath = "$VersionedDir\MANIFEST.txt"
    $manifest = @"
Artifex Nexus Package Manifest
===============================
Version    : $Version
Build Date : $Timestamp
Product    : $ProductName

Contents:
  $PortableName.zip         ($zipSize MB) - portable (green) package
"@
    if (Test-Path $nsisInstaller) {
        $manifest += "`n  $nsisName      ($nsisSize MB) - NSIS installer"
    }
    $manifest += @"

Notes:
  - Portable package: extract zip and run artifex-nexus-desktop.exe
  - NSIS installer: double-click to install (supports custom directory)
  - User data (config, skills cache, plugins) is stored in ~/.artifexnexus/
"@
    Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8
    Write-Host "  [OK] MANIFEST.txt" -ForegroundColor Green

    # Show delivery summary
    Write-Host ""
    Write-Host "  Delivery folder:" -ForegroundColor Magenta
    Write-Host "    $VersionedDir" -ForegroundColor Green
    Get-ChildItem $VersionedDir | ForEach-Object {
        $size = if ($_.PSIsContainer) { "[DIR]" } else { "($([math]::Round($_.Length / 1MB, 1)) MB)" }
        Write-Host "      $($_.Name) $size" -ForegroundColor Gray
    }
}

# Clean up portable dir (keep only zip in temp output)
Remove-Item -Recurse -Force $PortableDir

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Packaging complete." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
