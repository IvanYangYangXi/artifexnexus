#!/usr/bin/env bash
# fetch-uv.sh — 下载/验证 uv 包管理器到 vendor/。
#
# 开发期 dev-home 模式：直接使用系统 uv（或 pip install uv）。
# 生产模式：下载 uv standalone 二进制到 vendor/uv/。
#
# 用法：
#   ./scripts/fetch-uv.sh          # 开发模式（默认）
#   ./scripts/fetch-uv.sh --prod   # 生产模式（下载 standalone）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$PROJECT_ROOT/vendor/uv"

MODE="${1:-dev}"

echo "=== fetch-uv.sh ==="
echo "模式: $MODE"

if [ "$MODE" = "--prod" ]; then
    # 生产模式：下载 uv standalone
    # 骨架阶段：占位，后续填充实际下载逻辑
    echo "[SKIP] 生产模式下载逻辑待实现"
    echo "  目标目录: $VENDOR_DIR"
    echo "  来源: https://github.com/astral-sh/uv/releases"
else
    # 开发模式：检查 uv
    if command -v uv &>/dev/null; then
        UV_VERSION=$(uv --version 2>&1)
        echo "✅ uv: $UV_VERSION"
        echo "  路径: $(which uv)"
    elif python3 -c "import uv" 2>/dev/null; then
        echo "✅ uv (Python 模块) 可用"
    else
        echo "⚠️  uv 未安装，尝试通过 pip 安装..."
        pip3 install uv 2>&1 || {
            echo "❌ 安装 uv 失败，请手动安装: pip3 install uv"
            exit 1
        }
        echo "✅ uv 安装完成"
    fi
fi

echo "=== fetch-uv.sh 完成 ==="
