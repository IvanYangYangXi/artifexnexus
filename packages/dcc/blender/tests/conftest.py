"""
pytest 配置 — Blender DCC 测试

将 src/artifex_nexus 加入 sys.path，使测试可以 import blender_addon.*
"""

import sys
from pathlib import Path

# 将 src/artifex_nexus 加入 sys.path
_src_dir = Path(__file__).parent.parent / "src" / "artifex_nexus"
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))
