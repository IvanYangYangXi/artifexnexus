"""
decorator/core.py — @skill_tool 装饰器（re-export）
=====================================================

从 ``packages/dcc/shared/artifex_nexus_sdk/decorator.py`` 重新导出，
保持 ``from artifex_nexus.skill import skill_tool`` 导入路径不变。

使用方式：
    from artifex_nexus.skill import skill_tool, SkillToolResult

    @skill_tool(name="my_skill_tool", description="...", risk_level="low")
    def my_skill_tool(arg1: str, arg2: int = 0) -> SkillToolResult:
        ...
        return SkillToolResult.success("done")
"""

from artifex_nexus_sdk.decorator import (  # noqa: F401
    SkillToolResult,
    skill_tool,
)

# 兼容别名
artclaw_tool = skill_tool
tool = skill_tool
