"""
startup.py - Artifex Nexus 3ds Max 启动脚本
=============================================

放入 3ds Max 的 scripts/startup/ 目录，启动时自动执行。

该脚本：
  1. 注入 sys.path（共享 SDK + addon 目录）
  2. 导入并启动 MCP Server
  3. 注册事件钩子
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("artifex.max.startup")

# ── 路径注入 ──
# addon 目录：startup.py 所在目录的父目录
_addon_dir = Path(__file__).parent.parent
_addon_str = str(_addon_dir)
if _addon_str not in sys.path:
    sys.path.insert(0, _addon_str)

# 共享 SDK 路径（开发期）
_sdk_dir = _addon_dir.parents[4] / "shared"
_sdk_str = str(_sdk_dir)
if _sdk_str not in sys.path:
    sys.path.insert(0, _sdk_str)

logger.info(f"Artifex Nexus Max Addon 启动中... (addon: {_addon_str})")


def _start():
    """启动 MCP Server + 注册钩子"""
    try:
        from mcp_server import create_server, register_builtin_tools, DEFAULT_PORT
        from max_adapter import MaxAdapter
        from artifex_nexus_sdk.mcp_server import MCPServer as _MCPServer

        # 端口预检查
        if not _MCPServer._is_port_available("127.0.0.1", DEFAULT_PORT):
            msg = f"[Artifex Nexus] 警告: 端口 {DEFAULT_PORT} 被占用，MCP Server 无法启动"
            logger.warning(msg)
            try:
                import pymxs
                pymxs.runtime.print(msg, warning=True)
            except Exception:
                print(msg)
            return

        adapter = MaxAdapter()

        server = create_server()
        server.set_adapter(adapter)
        adapter.set_server(server)

        register_builtin_tools(server, adapter)

        # 注册事件钩子
        from trigger_dispatcher import register_max_callbacks
        register_max_callbacks()

        # 启动 MCP Server
        if server.start():
            logger.info(f"Max MCP Server 已启动: {server.server_address}")
        else:
            logger.error("Max MCP Server 启动失败")

    except Exception as e:
        logger.error(f"启动失败: {e}")


# ── 主入口 ──
_start()
