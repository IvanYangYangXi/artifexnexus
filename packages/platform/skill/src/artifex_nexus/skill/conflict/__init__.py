"""
conflict/__init__.py — 冲突检测模块导出
=========================================

导出 compare_skill_dirs（文件级哈希对比）和 detect_layer_conflicts（层冲突检测）。
"""

from .detector import (
    LAYER_PRIORITY,
    LayerConflict,
    SyncState,
    SyncStatus,
    compare_skill_dirs,
    detect_layer_conflicts,
)

__all__ = [
    "LAYER_PRIORITY",
    "LayerConflict",
    "SyncState",
    "SyncStatus",
    "compare_skill_dirs",
    "detect_layer_conflicts",
]
