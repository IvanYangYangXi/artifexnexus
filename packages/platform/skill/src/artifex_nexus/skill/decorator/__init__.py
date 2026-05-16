"""decorator 子包 — @skill_tool 装饰器与 SkillToolResult。

导出：
    - ``skill_tool`` — @skill_tool 装饰器
    - ``SkillToolResult`` — Skill-Tool 函数返回值
    - ``artclaw_tool`` — 兼容别名（等价于 skill_tool）
    - ``tool`` — legacy 别名（过渡期，推荐使用 skill_tool）
"""

from __future__ import annotations

from .core import (
    SkillToolResult,
    artclaw_tool,
    skill_tool,
    tool,
)

__all__ = [
    "skill_tool",
    "SkillToolResult",
    "artclaw_tool",
    "tool",
]
