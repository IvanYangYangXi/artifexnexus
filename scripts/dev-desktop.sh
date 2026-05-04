#!/usr/bin/env bash
# dev-desktop.sh — 一键启动 Artifex Nexus 桌面壳开发环境。
#
# macOS 用法：
#   终端运行：bash scripts/dev-desktop.sh
#   或 Finder 中右键 → 打开方式 → 终端
#
# Windows 用法：
#   Git Bash 或 WSL 中运行：bash scripts/dev-desktop.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo " Artifex Nexus — 桌面壳开发环境"
echo "========================================"
echo ""

# ---------- Node.js ----------
echo -n "Node.js ... "
if command -v node &>/dev/null; then
    echo -e "${GREEN}$(node --version)${NC}"
elif command -v nvm &>/dev/null; then
    echo "通过 nvm 加载..."
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm use default 2>/dev/null || nvm install --lts
elif [ -d "$HOME/.nvm" ]; then
    echo "通过 nvm 加载..."
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm use default 2>/dev/null || nvm install --lts
elif [ -d "/usr/local/opt/node" ]; then
    export PATH="/usr/local/opt/node/bin:$PATH"
    echo -e "${GREEN}$(node --version)${NC}"
elif [ -d "/opt/homebrew/opt/node" ]; then
    export PATH="/opt/homebrew/opt/node/bin:$PATH"
    echo -e "${GREEN}$(node --version)${NC}"
else
    echo -e "${YELLOW}未找到，尝试通过 Homebrew 安装...${NC}"
    if command -v brew &>/dev/null; then
        brew install node
    else
        echo -e "${RED}请手动安装 Node.js: https://nodejs.org/${NC}"
        exit 1
    fi
fi

# 再次确认
if ! command -v node &>/dev/null; then
    echo -e "${RED}Node.js 安装失败，请手动安装: https://nodejs.org/${NC}"
    exit 1
fi

# ---------- pnpm ----------
echo -n "pnpm ... "
if command -v pnpm &>/dev/null; then
    echo -e "${GREEN}$(pnpm --version)${NC}"
else
    echo -e "${YELLOW}未找到，通过 npm 安装...${NC}"
    npm install -g pnpm
    echo -e "${GREEN}$(pnpm --version)${NC}"
fi

# ---------- Rust ----------
echo -n "Rust ... "
if command -v rustc &>/dev/null; then
    echo -e "${GREEN}$(rustc --version)${NC}"
elif [ -f "$HOME/.cargo/bin/rustc" ]; then
    export PATH="$HOME/.cargo/bin:$PATH"
    echo -e "${GREEN}$(rustc --version)${NC}"
else
    echo -e "${YELLOW}未找到，通过 rustup 安装...${NC}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    export PATH="$HOME/.cargo/bin:$PATH"
    echo -e "${GREEN}$(rustc --version)${NC}"
fi

# ---------- Python ----------
echo -n "Python ... "
if command -v python3 &>/dev/null; then
    echo -e "${GREEN}$(python3 --version 2>&1)${NC}"
elif command -v python &>/dev/null; then
    echo -e "${GREEN}$(python --version 2>&1)${NC}"
elif [ -d "/Library/Frameworks/Python.framework" ]; then
    # macOS Python.org 安装
    export PATH="/Library/Frameworks/Python.framework/Versions/3.11/bin:$PATH"
    echo -e "${GREEN}$(python3 --version 2>&1)${NC}"
else
    echo -e "${YELLOW}未找到，尝试通过 Homebrew 安装...${NC}"
    if command -v brew &>/dev/null; then
        brew install python@3.11
    else
        echo -e "${RED}请手动安装 Python >= 3.11: https://www.python.org/${NC}"
        exit 1
    fi
fi

echo ""
echo "📦 安装项目依赖..."
cd "$PROJECT_ROOT"
pnpm install 2>/dev/null || pnpm install --no-frozen-lockfile

echo ""
echo "🚀 启动 Tauri 开发服务器..."
cd "$PROJECT_ROOT/apps/desktop"
pnpm tauri dev
