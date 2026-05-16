"""
hub/executor.py — Skill-Tool 执行器（模块级便捷函数）
=======================================================

提供 ``execute_skill_tool(tool_name, arguments, hub=...)`` 纯函数，
作为 ``SkillHub.execute_skill_tool()`` 的模块级便捷入口。

使用方式::

    from artifex_nexus.skill.hub import execute_skill_tool

    result = execute_skill_tool("my_skill_tool", {"arg1": "hello"})
    # → SkillToolResult(is_success=True, data="...")
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ..decorator import SkillToolResult


def execute_skill_tool(
    tool_name: str,
    arguments: Optional[Dict[str, Any]] = None,
    *,
    hub: Optional[Any] = None,
    skill_name: Optional[str] = None,
) -> SkillToolResult:
    """执行指定 Skill-Tool（便捷入口）。

    需要先创建 SkillHub 实例并传入 ``hub`` 参数（或设置全局默认）。

    :param tool_name: Skill-Tool 名称。
    :param arguments: Skill-Tool 参数（dict）。
    :param hub: SkillHub 实例（关键字参数，避免与 arguments 混淆）。
    :param skill_name: 可选，指定 Skill 名称以加速查找。
    :return: SkillToolResult。
    """
    if hub is None:
        # 从全局默认获取
        hub = _get_default_hub()
        if hub is None:
            return SkillToolResult.error(
                "未初始化 SkillHub。请先创建 SkillHub 实例并调用 scan_all_skills()，"
                "然后传入 hub= 参数或调用 set_default_hub(hub)"
            )

    if not hasattr(hub, "execute_skill_tool"):
        return SkillToolResult.error(f"hub 对象不支持 execute_skill_tool 方法: {type(hub).__name__}")

    return hub.execute_skill_tool(tool_name, arguments, skill_name=skill_name)


# ── 全局默认 Hub ──────────────────────────────────────────────────────────────

_default_hub: Optional[Any] = None


def set_default_hub(hub: Any) -> None:
    """设置全局默认 SkillHub 实例。

    之后调用 ``execute()`` 时可以省略 ``hub=`` 参数。

    :param hub: SkillHub 实例。
    """
    global _default_hub
    _default_hub = hub


def get_default_hub() -> Optional[Any]:
    """获取全局默认 SkillHub 实例。"""
    return _default_hub


def _get_default_hub() -> Optional[Any]:
    """内部获取全局默认 Hub（避免名称冲突）。"""
    return _default_hub
