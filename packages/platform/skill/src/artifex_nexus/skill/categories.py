r"""
categories.py — Artifex Nexus Skill/Tool 分类与标签
=======================================================

从 ``contracts/data/categories.json`` 唯一数据源读取，暴露为 Python 常量。
不自行定义枚举值，杜绝多源漂移。

结构：
    - ``Software`` / ``RiskLevel`` — 动态构建的 str:Enum（硬约束）
    - ``ALL_CATEGORIES`` — 预设分类集合（开放，用户可自定义）
    - ``ALL_SOFTWARE`` / ``ALL_RISK_LEVELS`` — 所有合法值集合
    - ``SOFTWARE_DISPLAY`` / ``CATEGORY_DISPLAY`` / ``RISK_DISPLAY`` — 中文显示名映射
"""

from __future__ import annotations

import json
import logging
from enum import Enum
from pathlib import Path

logger = logging.getLogger("artifex_nexus.skill.categories")


# ── 加载唯一数据源 ──────────────────────────────────────────────────────────

def _load_categories_json() -> dict:
    """从 contracts/data/categories.json 加载分类数据。"""
    # 定位 categories.json：从当前模块向上找到 contracts/data/
    candidates = [
        Path(__file__).parent.parent.parent.parent.parent.parent
        / "platform" / "contracts" / "data" / "categories.json",
        # pip editable install 时的 fallback
        Path(__file__).parent.parent.parent.parent
        / "contracts" / "data" / "categories.json",
    ]
    for p in candidates:
        try:
            resolved = p.resolve(strict=True)
            logger.debug("加载 categories.json: %s", resolved)
            return json.loads(resolved.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError):
            continue

    logger.error(
        "categories.json 未找到！搜索路径: %s。"
        "所有分类常量将使用内置 fallback。",
        [str(p) for p in candidates],
    )
    return _builtin_fallback()


def _builtin_fallback() -> dict:
    """内置 fallback（categories.json 不可用时的最小保证）。"""
    return {
        "software": ["universal", "unreal_engine", "blender", "maya", "3ds_max", "houdini", "comfyui"],
        "risk_level": ["low", "medium", "high", "critical"],
        "category": ["scene", "asset", "material", "lighting", "render",
                     "blueprint", "animation", "ui",
                     "utils", "integration", "workflow",
                     "modeling", "rigging", "fx", "compositing"],
        "display": {
            "software": {},
            "risk_level": {},
            "category": {},
        },
    }


_DATA = _load_categories_json()

# ── 硬枚举：从 JSON 动态构建（str, Enum 混入，JSON 可序列化）───────────────

Software = Enum(
    "Software",
    {s.upper(): s for s in _DATA["software"]},
    type=str,
)
Software.__doc__ = "支持的 DCC 软件类型（硬约束，来自 categories.json）。"

RiskLevel = Enum(
    "RiskLevel",
    {rl.upper(): rl for rl in _DATA["risk_level"]},
    type=str,
)
RiskLevel.__doc__ = "Skill 风险级别（硬约束，来自 categories.json）。"

# ── 合法值集合 ──────────────────────────────────────────────────────────────

ALL_SOFTWARE: set[str] = set(_DATA["software"])
ALL_RISK_LEVELS: set[str] = set(_DATA["risk_level"])
ALL_CATEGORIES: set[str] = set(_DATA["category"])

# ── 中文显示名映射 ──────────────────────────────────────────────────────────

_display = _DATA.get("display", {})
SOFTWARE_DISPLAY: dict[str, str] = _display.get("software", {})
CATEGORY_DISPLAY: dict[str, str] = _display.get("category", {})
RISK_DISPLAY: dict[str, str] = _display.get("risk_level", {})

# ── 工具函数 ────────────────────────────────────────────────────────────────


def software_value(software: Software | str) -> str:
    """从 Software 枚举（或 raw 字符串）提取字符串值。

    提供统一的 software 枚举值提取入口，消除各处重复的
    ``hasattr(s, 'value')`` 模式。

    :param software: ``Software`` 枚举成员或裸字符串。
    :return: 软件标识字符串（'universal' / 'unreal' / 'blender' / ...）。
    """
    if hasattr(software, "value"):
        return software.value  # type: ignore[union-attr,return-value]
    return str(software)


# ── category 自定义格式 ─────────────────────────────────────────────────────

CATEGORY_PATTERN = r"^[\u4e00-\u9fa5a-zA-Z0-9_-]{1,31}$"
"""用户自定 category 的合法格式：中文/英文/数字/下划线/连字符，1-31 字符。"""
