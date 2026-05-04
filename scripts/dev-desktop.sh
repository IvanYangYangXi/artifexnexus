#!/usr/bin/env bash
# dev-desktop.sh — 一键启动 Artifex Nexus 桌面壳开发环境。
#
# macOS 用法：
#   双击或在终端运行：./scripts/dev-desktop.sh
#
# Windows 用法：
#   在 Git Bash 或 WSL 中运行：bash scripts/dev-desktop.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo " Artifex Nexus — 桌面壳开发环境"
echo "========================================"
echo ""

# 检查 Node.js
if ! command -v node &>/dev/null; then
    echo "❌ 未找到 Node.js，请先安装: https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js: $(node --version)"

# 检查 pnpm
if ! command -v pnpm &>/dev/null; then
    echo "⚠️  pnpm 未安装，正在安装..."
    npm install -g pnpm
fi
echo "✅ pnpm: $(pnpm --version)"

# 检查 Rust
if ! command -v rustc &>/dev/null; then
    echo "❌ 未找到 Rust，请先安装: https://rustup.rs/"
    exit 1
fi
echo "✅ Rust: $(rustc --version)"

# 检查 Python
if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
    echo "❌ 未找到 Python >= 3.11，请先安装: https://www.python.org/"
    exit 1
fi
echo "✅ Python: $(python3 --version 2>/dev/null || python --version 2>&1)"

echo ""
echo "📦 安装依赖..."
cd "$PROJECT_ROOT"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo ""
echo "🚀 启动 Tauri 开发服务器..."
cd "$PROJECT_ROOT/apps/desktop"
pnpm tauri dev
