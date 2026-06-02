"""artifex_nexus_sdk — Artifex Nexus 工具开发 SDK

替代 artclaw_sdk，为所有 Nexus Tool 脚本提供统一的参数解析、
结果封装、DCC 上下文查询、事件解析、日志接口、@skill_tool 装饰器
和 SkillHub（Skill 管理与执行）。

跨 DCC 兼容：Blender / Unreal Engine / Maya / 3ds Max / Houdini。
"""

from artifex_nexus_sdk.params import parse_params
from artifex_nexus_sdk.result import success, fail, allow, reject
from artifex_nexus_sdk.context import get_selected_objects, get_selected_assets
from artifex_nexus_sdk.event import parse as event_parse
from artifex_nexus_sdk.logger import get_tool_logger
from artifex_nexus_sdk.decorator import skill_tool, SkillToolResult
from artifex_nexus_sdk.skill_hub import SkillHub, init_skill_hub, get_skill_hub
from artifex_nexus_sdk.skill_manifest import (
    SkillManifest, ToolEntry, SoftwareVersion, ManifestValidationError,
    parse_manifest, validate_manifest,
)

# 兼容 artclaw_sdk 命名空间结构
class params:
    parse_params = staticmethod(parse_params)


class result:
    success = staticmethod(success)
    fail = staticmethod(fail)
    allow = staticmethod(allow)
    reject = staticmethod(reject)


class context:
    get_selected_objects = staticmethod(get_selected_objects)
    get_selected_assets = staticmethod(get_selected_assets)


class event:
    parse = staticmethod(event_parse)


class logger:
    get_tool_logger = staticmethod(get_tool_logger)


__all__ = [
    "parse_params",
    "success", "fail", "allow", "reject",
    "get_selected_objects", "get_selected_assets",
    "event_parse",
    "get_tool_logger",
    "skill_tool", "SkillToolResult",
    "SkillHub", "init_skill_hub", "get_skill_hub",
    "SkillManifest", "ToolEntry", "SoftwareVersion",
    "ManifestValidationError", "parse_manifest", "validate_manifest",
    "params", "result", "context", "event", "logger",
]
