"""artifex_nexus.skill — Skill 子系统统一入口 / Unified Skill subsystem entry.

本模块按职责拆分为多个子模块，但通过本顶层文件统一对外暴露常用 API，
使用方只需 ``from artifex_nexus.skill import skill_tool, SkillToolResult, execute_skill_tool, list_skills`` 即可。

子模块（按职责拆分，每文件 < 300 行）:

- ``decorator`` — ``@skill_tool`` / ``@artclaw_tool`` (alias) / ``@tool`` (legacy) 装饰器、参数 schema 推导
- ``manifest``  — manifest.json pydantic 模型（枚举从 categories.json 唯一数据源读取）
- ``loader``    — 分层加载（00_official > 01_team > 02_user > 99_custom）
- ``version``   — 版本解析/比较/匹配（packaging 增强）
- ``hub``       — 运行时 SkillHub：execute_skill_tool / list / get / reload
- ``conflict``  — 多层级命名冲突检测
- ``registry``  — SkillRegistry：查询/匹配/最佳版本选择
- ``installer`` — SkillInstaller：install / publish / sync / uninstall / enable / disable
- ``events``    — Skill 事件枚举（14 个生命周期事件）
- ``categories`` — 分类/软件/风险等级枚举（从 contracts/data/categories.json 读取）

设计取自原 artclaw_bridge ``core/version_manager.py`` 与 ``cli/artclaw_bridge/skill_hub.py``，
按职责拆分并改用 pydantic v2 与统一分类数据源。
"""

from __future__ import annotations

# ── Phase 1: decorator / manifest / version / events / categories ──────────
from .decorator import SkillToolResult, artclaw_tool, skill_tool, tool as tool_legacy  # noqa
from .manifest import (
    SkillManifest,
    load_manifest_model,
)
# 枚举从 categories.json 唯一数据源读取
from .categories import (
    ALL_RISK_LEVELS,
    ALL_SOFTWARE,
    RISK_DISPLAY,
    SOFTWARE_DISPLAY,
    RiskLevel,
    Software,
    software_value,
)
from .version import (
    compare_versions,
    parse_version,
    version_eq,
    version_gt,
    version_gte,
    version_lt,
    version_lte,
)
from .events import SkillEvent

# ── Phase 2: hub / registry / conflict — STORY-0043 ──────────────────────
from .conflict import (
    LAYER_PRIORITY,
    LayerConflict,
    SyncState,
    SyncStatus,
    compare_skill_dirs,
    detect_layer_conflicts,
)
from .hub import SkillEntry, SkillHub, SkillInstance, SkillToolInfo, execute_skill_tool, set_default_hub
from .registry import SkillRegistry

# ── Phase 3: installer — STORY-0044 ─────────────────────────────────────
from artifex_nexus.core.skill_config import SkillConfig

from .installer import (
    InstallResult,
    PublishResult,
    SkillInstaller,
    SyncResult,
)

# ── Phase 5: nexus_tool — STORY-0045 ─────────────────────────────────────
from .nexus_tool import (
    DCCEntry,
    NexusToolData,
    NexusToolInstaller,
    NexusToolRegistry,
    NexusToolResult,
    ScannedNexusTool,
    scan_nexus_tools,
)

__all__ = [
    # decorator
    "skill_tool",
    "SkillToolResult",
    "artclaw_tool",
    # manifest
    "SkillManifest",
    "load_manifest_model",
    # categories (单一数据源)
    "Software",
    "RiskLevel",
    "software_value",
    "ALL_SOFTWARE",
    "ALL_RISK_LEVELS",
    "SOFTWARE_DISPLAY",
    "RISK_DISPLAY",
    # version
    "parse_version",
    "compare_versions",
    "version_eq",
    "version_gt",
    "version_gte",
    "version_lt",
    "version_lte",
    # events
    "SkillEvent",
    # Phase 2: hub / registry / conflict
    "SkillHub",
    "SkillEntry",
    "SkillInstance",
    "SkillToolInfo",
    "execute_skill_tool",
    "set_default_hub",
    "SkillRegistry",
    "LAYER_PRIORITY",
    "LayerConflict",
    "SyncState",
    "SyncStatus",
    "compare_skill_dirs",
    "detect_layer_conflicts",
    # Phase 3: installer
    "SkillInstaller",
    "InstallResult",
    "SyncResult",
    "PublishResult",
    "SkillConfig",
    # Phase 5: nexus_tool
    "DCCEntry",
    "NexusToolRegistry",
    "NexusToolInstaller",
    "NexusToolData",
    "NexusToolResult",
    "ScannedNexusTool",
    "scan_nexus_tools",
]

__version__ = "0.1.0"
