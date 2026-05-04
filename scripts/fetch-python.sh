#!/usr/bin/env bash
# fetch-python.sh — 下载/验证嵌入式 Python 3.11 standalone 到 vendor/。
#
# 开发期 dev-home 模式：直接使用系统 Python（python3）。
# 生产模式：下载 python-build-standalone 到 vendor/python/。
#
# 用法：
#   ./scripts/fetch-python.sh          # 开发模式（默认）
#   ./scripts/fetch-python.sh --prod   # 生产模式（下载 standalone）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$PROJECT_ROOT/vendor/python"

MODE="${1:-dev}"

echo "=== fetch-python.sh ==="
echo "模式: $MODE"

if [ "$MODE" = "--prod" ]; then
    # 生产模式：下载 python-build-standalone
    # 骨架阶段：占位，后续填充实际下载逻辑
    echo "[SKIP] 生产模式下载逻辑待实现"
    echo "  目标目录: $VENDOR_DIR"
    echo "  来源: https://github.com/indygreg/python-build-standalone/releases"
else
    # 开发模式：检查系统 Python
    if command -v python3 &>/dev/null; then
        PYTHON_VERSION=$(python3 --version 2>&1)
        echo "✅ 系统 Python: $PYTHON_VERSION"
        echo "  路径: $(which python3)"
    else
        echo "❌ 未找到 python3，请安装 Python >= 3.11"
        exit 1
    fi
fi

echo "=== fetch-python.sh 完成 ==="
