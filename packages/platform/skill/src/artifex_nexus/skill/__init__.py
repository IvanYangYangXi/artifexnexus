"""artifex_nexus.skill — Skill 子系统统一入口 / Unified Skill subsystem entry.

本模块按职责拆分为多个子模块，但通过本顶层文件统一对外暴露常用 API，
使用方只需 ``from artifex_nexus.skill import tool, ToolResult, execute, list_skills`` 即可。

子模块（按职责拆分，每文件 < 300 行）:

- ``decorator`` — ``@tool`` / ``@artclaw_tool`` (alias) 装饰器、参数 schema 推导
- ``manifest``  — manifest.json pydantic 模型 + 标准 Category 枚举
- ``loader``    — 分层加载（00_official > 01_team > 02_user > 99_custom）
- ``version``   — 版本解析/比较/匹配（packaging 增强）
- ``hub``       — 运行时 SkillHub：execute_skill / list / get / reload
- ``conflict``  — 多层级命名冲突检测
- ``registry``  — SkillRegistry：查询/匹配/最佳版本选择
- ``installer`` — SkillInstaller：install / publish / sync / uninstall / enable / disable
- ``events``    — Skill 事件枚举（created/updated/reloaded/...），通过 core.event_bus 广播

设计取自原 artclaw_bridge ``core/version_manager.py`` 与 ``cli/artclaw_bridge/skill_hub.py``，
按职责拆分并改用 pydantic v2 与统一事件总线。
"""

from __future__ import annotations

# 公共门面 / Public facade — 子模块实现后取消注释
# from .decorator import tool, ToolResult, artclaw_tool  # @artclaw_tool 为兼容别名
# from .hub import execute, list_skills, get_skill, reload
# from .registry import SkillRegistry
# from .installer import SkillInstaller
# from .manifest import SkillManifest, Category, RiskLevel
# from .events import SkillEvent

__all__ = [
    # "tool", "ToolResult", "artclaw_tool",
    # "execute", "list_skills", "get_skill", "reload",
    # "SkillRegistry", "SkillInstaller",
    # "SkillManifest", "Category", "RiskLevel",
    # "SkillEvent",
]

__version__ = "0.0.0"
