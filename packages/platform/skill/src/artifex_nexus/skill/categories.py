r"""
categories.py — Artifex Nexus Skill/Tool 分类与标签
=======================================================

从 ``contracts/data/categories.json`` 唯一数据源读取，暴露为 Python 常量。
不自行定义枚举值，杜绝多源漂移。

结构：
    - ``Software`` / ``RiskLevel`` — 动态构建的 str:Enum（硬约束）
    - ``ALL_SOFTWARE`` / ``ALL_RISK_LEVELS`` — 所有合法值集合
    - ``SOFTWARE_DISPLAY`` / ``RISK_DISPLAY`` — 中文显示名映射

注：category 字段已合并入 tags，不再单独存在。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import List

logger = logging.getLogger("artifex_nexus.skill.categories")


# ── DCC 条目数据类 ──────────────────────────────────────────────────────────

@dataclass
class DCCEntry:
    """单个目标 DCC 软件的条目，支持版本约束。

    字段：
        - ``dcc``: 软件标识符（来自 ALL_SOFTWARE）
        - ``min_version``: 最低版本要求，如 "3.0"（可选）
        - ``max_version``: 最高版本上限，如 "5.0"（可选）
    """
    dcc: str
    min_version: str = ""
    max_version: str = ""

    def to_dict(self) -> dict:
        """转为 manifest JSON 兼容的 dict（字段名使用 camelCase）。"""
        result: dict = {"dcc": self.dcc}
        if self.min_version:
            result["minVersion"] = self.min_version
        if self.max_version:
            result["maxVersion"] = self.max_version
        return result

    @classmethod
    def from_dict(cls, data: dict) -> "DCCEntry":
        """从 dict 创建 DCCEntry（兼容新旧字段名）。"""
        return cls(
            dcc=data.get("dcc", ""),
            min_version=data.get("minVersion", data.get("min_version", "")),
            max_version=data.get("maxVersion", data.get("max_version", "")),
        )

    @classmethod
    def from_string(cls, dcc: str) -> "DCCEntry":
        """从旧格式纯字符串创建 DCCEntry。"""
        return cls(dcc=dcc)


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
        "software": ["general", "unreal_engine", "blender", "maya", "3ds_max", "houdini", "comfyui", "substance_painter", "substance_designer", "unity"],
        "risk_level": ["low", "medium", "high", "critical"],
        "dcc": {},
        "display": {
            "software": {},
            "risk_level": {},
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

# ── 显示名映射 ──────────────────────────────────────────────────────────────

_display = _DATA.get("display", {})
SOFTWARE_DISPLAY: dict[str, str] = _display.get("software", {})
RISK_DISPLAY: dict[str, str] = _display.get("risk_level", {})

# ── DCC Identity（ADR 0011）──────────────────────────────────────────────────

_DCC_IDENTITY: dict[str, dict] = _DATA.get("dcc", {})


def get_dcc_display_name(dcc_key: str) -> str:
    """获取 DCC 显示名称（英文），如 'Unreal Engine'。
    优先从 display.software 取，回退到原始 key。"""
    return SOFTWARE_DISPLAY.get(dcc_key, dcc_key)


def get_dcc_short_name(dcc_key: str) -> str:
    """获取 DCC 短名称（如 'UE'、'Max'），用于状态栏/徽标。"""
    return _DCC_IDENTITY.get(dcc_key, {}).get("shortName", dcc_key)


def get_dcc_mcp_server_id(dcc_key: str) -> str | None:
    """获取 DCC 对应的 MCP Server 名称（如 'unreal-editor'）。无 MCP Server 的返回 None。"""
    return _DCC_IDENTITY.get(dcc_key, {}).get("mcpServerId")


def find_dcc_by_mcp_server_id(server_id: str) -> str | None:
    """反向查找：通过 MCP Server 名称找到对应的 DCC key。
    如 'unreal-editor' → 'unreal_engine'。"""
    for key, identity in _DCC_IDENTITY.items():
        if identity.get("mcpServerId") == server_id:
            return key
    return None


def get_all_dcc_mcp_servers() -> dict[str, str]:
    """获取所有有 MCP Server 的 DCC：{dcc_key: mcpServerId}。"""
    return {
        k: v["mcpServerId"]
        for k, v in _DCC_IDENTITY.items()
        if v.get("mcpServerId")
    }


# ── 工具函数 ────────────────────────────────────────────────────────────────


def software_value(software: Software | str) -> str:
    """从 Software 枚举（或 raw 字符串）提取字符串值。

    提供统一的 software 枚举值提取入口，消除各处重复的
    ``hasattr(s, 'value')`` 模式。

    :param software: ``Software`` 枚举成员或裸字符串。
    :return: 软件标识字符串（'general' / 'unreal' / 'blender' / ...）。
    """
    if hasattr(software, "value"):
        return software.value  # type: ignore[union-attr,return-value]
    return str(software)
