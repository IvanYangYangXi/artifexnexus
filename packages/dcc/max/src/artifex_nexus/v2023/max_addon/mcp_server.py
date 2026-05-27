"""
mcp_server.py - 3ds Max MCP Server 入口
========================================

从共享 SDK 导入 MCPServer，绑定 3ds Max 专用内置工具。
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, Optional

from artifex_nexus_sdk.mcp_server import MCPServer

logger = logging.getLogger("artifex.max.mcp")

# ── 3ds Max 专用常量 ──
DCC_NAME = "3ds_max"
DCC_VERSION = "2023"
DEFAULT_PORT = 18082


def create_server(host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> MCPServer:
    """创建 3ds Max MCP Server 实例（固定端口 18082，不探测其他端口）"""
    return MCPServer(
        dcc_name=DCC_NAME,
        dcc_version=DCC_VERSION,
        host=host,
        port=port,
        max_port_probe=0,
    )


# ── 内置工具注册 ────────────────────────────────────────────────────────

def register_builtin_tools(server: MCPServer, adapter=None) -> None:
    """注册 3ds Max 内置 MCP 工具（run_python + get_editor_context）"""

    def _handle_run_python(arguments: dict) -> dict:
        if arguments.get("get_context", False):
            if not adapter:
                return {"content": [{"type": "text", "text": "错误: DCC adapter 未初始化"}], "isError": True}
            try:
                info = {
                    "software": adapter.get_software_name(),
                    "version": adapter.get_software_version(),
                    "python": adapter.get_python_version(),
                    "current_file": adapter.get_current_file() or "untitled",
                    "selected_objects": adapter.get_selected_objects(),
                    "scene_info": adapter.get_scene_info(),
                }
                return {"content": [{"type": "text", "text": json.dumps(info, ensure_ascii=False, indent=2)}], "isError": False}
            except Exception as e:
                return {"content": [{"type": "text", "text": f"错误: {e}"}], "isError": True}

        code = arguments.get("code", "")
        if not code:
            return {"content": [{"type": "text", "text": "错误: 未提供代码"}], "isError": True}

        if adapter:
            result = adapter.execute_code(code)
            output_parts = []
            if result.get("output"):
                output_parts.append(result["output"])
            if result.get("error"):
                output_parts.append(f"错误: {result['error']}")
            elif result.get("result") is not None:
                output_parts.append(f"返回值: {result['result']}")
            text = "\n".join(output_parts) if output_parts else "执行完成 (无输出)"
            return {"content": [{"type": "text", "text": text}], "isError": not result.get("success", False)}
        else:
            return {"content": [{"type": "text", "text": "错误: DCC adapter 未初始化"}], "isError": True}

    server.register_tool(
        name="run_python",
        description=(
            "在 3ds Max 中执行 Python 代码（通过 pymxs）。\n\n"
            "上下文变量（已自动注入，无需 import）:\n"
            "  S = 选中对象列表 (pymxs.runtime.selection)\n"
            "  W = 当前场景文件路径\n"
            "  L = pymxs.runtime 模块\n"
            "  rt = pymxs.runtime 别名\n"
            "  pymxs = pymxs 模块\n\n"
            "将返回值赋给 result 变量，框架会自动提取并返回。\n"
            "坐标系统：Z-Up。\n\n"
            "Skill 执行（通过 SkillHub）:\n"
            "  from artifex_nexus_sdk.skill_hub import get_skill_hub\n"
            "  hub = get_skill_hub()\n"
            "  hub.execute_skill(\"skill_name\", {\"arg\": \"value\"})\n"
            "  hub.list_skills()\n\n"
            "快捷上下文: 设 get_context=true（无需 code）可获取编辑器状态。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "要执行的 Python 代码"},
                "get_context": {"type": "boolean", "description": "仅获取上下文", "default": False},
            },
            "required": [],
        },
        handler=_handle_run_python,
        main_thread=True,
    )

    def _handle_get_context(arguments: dict) -> dict:
        if not adapter:
            return {"content": [{"type": "text", "text": "错误: DCC adapter 未初始化"}], "isError": True}
        try:
            info = {
                "software": adapter.get_software_name(),
                "version": adapter.get_software_version(),
                "python": adapter.get_python_version(),
                "current_file": adapter.get_current_file() or "untitled",
                "selected_objects": adapter.get_selected_objects(),
                "scene_info": adapter.get_scene_info(),
            }
            return {"content": [{"type": "text", "text": json.dumps(info, ensure_ascii=False, indent=2)}], "isError": False}
        except Exception as e:
            return {"content": [{"type": "text", "text": f"错误: {e}"}], "isError": True}

    server.register_tool(
        name="get_editor_context",
        description=(
            "获取 3ds Max 编辑器上下文信息。\n\n"
            "返回：软件名称/版本、Python 版本、当前文件路径、"
            "选中对象列表（名称 + 类型）、场景统计（对象数/帧范围/Up Axis）。"
        ),
        input_schema={"type": "object", "properties": {}},
        handler=_handle_get_context,
        main_thread=True,
    )

    logger.info("已注册 2 个内置工具: run_python, get_editor_context")
