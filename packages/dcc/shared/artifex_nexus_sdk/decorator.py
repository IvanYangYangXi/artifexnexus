"""
decorator.py — @skill_tool 装饰器（全平台统一）
=================================================

从 ``packages/platform/skill/src/artifex_nexus/skill/decorator/core.py``
提取到共享 SDK，作为所有 DCC（UE / Blender / Maya / Max / ...）和
平台通用的 Skill-Tool 装饰器唯一源。

纯 Python 实现，零 DCC 依赖。
Hub 通过 ``_artifex_skill_tool`` 属性 walk ``module.__dict__`` 发现工具。

使用方式：
    from artifex_nexus_sdk.decorator import skill_tool, SkillToolResult

    @skill_tool(name="my_tool", description="...", risk_level="low")
    def my_tool(arg1: str, arg2: int = 0) -> SkillToolResult:
        ...
        return SkillToolResult.success("done")
"""

from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("artifex_nexus.skill.decorator")


# ---------------------------------------------------------------------------
# SkillToolResult — Skill-Tool 函数返回值
# ---------------------------------------------------------------------------

@dataclass
class SkillToolResult:
    """工具函数返回值，提供 success/error 静态工厂方法。

    Attributes:
        is_success: 执行是否成功。
        data: 成功时的返回数据（any JSON-serializable）。
        error_message: 失败时的错误信息。
    """

    is_success: bool
    data: Any = None
    error_message: Optional[str] = None

    @staticmethod
    def success(data: Any = None) -> "SkillToolResult":
        """创建成功结果。"""
        return SkillToolResult(is_success=True, data=data)

    @staticmethod
    def error(msg: str) -> "SkillToolResult":
        """创建错误结果。"""
        return SkillToolResult(is_success=False, error_message=msg)

    @staticmethod
    def ok(data: Any = None) -> "SkillToolResult":
        """创建成功结果（success 的便捷别名）。"""
        return SkillToolResult(is_success=True, data=data)

    def __bool__(self) -> bool:
        return self.is_success


# ---------------------------------------------------------------------------
# 类型推导 → JSON Schema
# ---------------------------------------------------------------------------

def _generate_schema_from_hints(func: Callable) -> dict:
    """从函数签名的 type hints 生成 JSON Schema。"""
    try:
        sig = inspect.signature(func)
    except (ValueError, TypeError):
        return {"type": "object", "properties": {}}

    properties: dict = {}
    required: list = []

    for param_name, param in sig.parameters.items():
        if param_name in ("self", "cls", "arguments"):
            continue

        prop: dict = {}
        annotation = param.annotation

        if annotation is str:
            prop["type"] = "string"
        elif annotation is int:
            prop["type"] = "integer"
        elif annotation is float:
            prop["type"] = "number"
        elif annotation is bool:
            prop["type"] = "boolean"
        elif annotation is list or annotation is List:
            prop["type"] = "array"
        elif annotation is dict or annotation is Dict:
            prop["type"] = "object"
        else:
            if annotation is not inspect.Parameter.empty:
                logger.debug(
                    "_generate_schema_from_hints: 无法识别的类型 %r（参数 %s），"
                    "fallback 为 string",
                    annotation, param_name,
                )
            prop["type"] = "string"

        if param.default is inspect.Parameter.empty:
            required.append(param_name)
        else:
            prop["default"] = param.default

        properties[param_name] = prop

    schema: dict = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


# ---------------------------------------------------------------------------
# @skill_tool 装饰器（唯一源）
# ---------------------------------------------------------------------------

def skill_tool(
    func: Optional[Callable] = None,
    *,
    name: Optional[str] = None,
    description: str = "",
    risk_level: str = "low",
) -> Callable:
    """
    @skill_tool 装饰器 — 声明 Skill 内的 Skill-Tool 函数。

    全平台统一入口。Hub 通过 walk ``module.__dict__`` 查找
    ``_artifex_skill_tool = True`` 标记发现工具。

    支持两种写法：
    - ``@skill_tool()`` — 带括号，可传入参数
    - ``@skill_tool`` — 无括号，使用默认参数

    Args:
        name:        Skill-Tool 名称。默认使用函数名。
        description: Skill-Tool 描述，AI 可见。默认从 docstring 提取。
        risk_level:  风险级别（low / medium / high / critical）。
    """
    def decorator(fn: Callable) -> Callable:
        tool_name = name or fn.__name__
        tool_desc = description or (inspect.getdoc(fn) or "").split("\n")[0]
        _ = _generate_schema_from_hints(fn)  # schema generated on-the-fly by Hub

        # 统一标记（所有 Hub 通过 _artifex_skill_tool 发现）
        fn._artifex_skill_tool = True
        fn._artifex_skill_tool_name = tool_name

        return fn

    # 支持 @skill_tool 无括号写法
    if func is not None:
        return decorator(func)
    return decorator
