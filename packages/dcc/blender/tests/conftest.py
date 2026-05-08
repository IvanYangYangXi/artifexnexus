"""
pytest 配置 — Blender DCC 测试

将 src/artifex_nexus/v{version} 加入 sys.path，使测试可以 import blender_addon.*
"""

import sys
from pathlib import Path

# 查找版本目录（如 v5.0.0）
_src_base = Path(__file__).parent.parent / "src" / "artifex_nexus"
_src_dir = _src_base
if _src_base.exists():
    for entry in sorted(_src_base.iterdir(), reverse=True):
        if entry.is_dir() and entry.name.startswith("v"):
            _src_dir = entry
            break

if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))
