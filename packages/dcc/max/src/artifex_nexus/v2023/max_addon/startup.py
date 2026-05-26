"""
startup.py - Artifex Nexus 3ds Max 启动脚本
=============================================

放入 3ds Max 的 scripts/startup/ 目录，通过 artifex_startup.ms 触发。

启动策略（参照 artclaw/bridge）：
  1. 路径注入（SDK + addon）
  2. QTimer.singleShot(2000) 延迟启动（等 Max UI 完全就绪）
  3. 进程锁防止重复执行
  4. 创建 adapter → 注册菜单宏 → 启动 MCP Server → 注册事件钩子

CI 兼容：pymxs 不可用时静默退出。
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("artifex.max.startup")

# ── 进程锁：防止重复执行 ─────────────────────────────────────────────────
_startup_done = False

# ── 路径注入 ──
_addon_dir = Path(__file__).parent.parent  # startup.py 在 max_addon/ 下
_addon_str = str(_addon_dir)
if _addon_str not in sys.path:
    sys.path.insert(0, _addon_str)

_sdk_dir = _addon_dir.parents[4] / "shared"
_sdk_str = str(_sdk_dir)
if _sdk_str not in sys.path:
    sys.path.insert(0, _sdk_str)

logger.info(f"Artifex Nexus Max Addon 启动中... (addon: {_addon_str})")


def _deferred_startup():
    """延迟启动：创建 adapter → 注册菜单 → 启动 MCP Server → 注册钩子"""
    global _startup_done
    if _startup_done:
        logger.info("Max 启动已执行过，跳过重复调用")
        return
    _startup_done = True

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

        # 创建 UI（菜单 + 宏）
        try:
            from artifex_nexus.v2023.max_addon import _create_menu
            _create_menu()
        except Exception as e:
            logger.warning(f"创建菜单失败: {e}")

        # 注册事件钩子
        try:
            from trigger_dispatcher import register_max_callbacks
            register_max_callbacks()
        except Exception as e:
            logger.warning(f"注册事件钩子失败: {e}")

        # 适配器启动
        adapter.on_startup()

        # 启动 MCP Server
        if server.start():
            logger.info(f"Max MCP Server 已启动: {server.server_address}")
            try:
                import pymxs
                pymxs.runtime.print(
                    f"[Artifex Nexus] MCP Server 已启动 (端口 {DEFAULT_PORT})"
                )
            except Exception:
                pass
        else:
            logger.error("Max MCP Server 启动失败")

    except Exception as e:
        logger.error(f"启动失败: {e}")
        import traceback
        traceback.print_exc()


def _main():
    """入口：检查 pymxs 可用性，使用 QTimer 延迟启动"""
    try:
        import pymxs  # noqa: F401
    except ImportError:
        logger.warning("pymxs 不可用，跳过 Max 启动（CI 环境）")
        return

    try:
        from PySide2.QtCore import QTimer
        QTimer.singleShot(2000, _deferred_startup)
        logger.info("Artifex Nexus: 延迟启动已注册（2s 后执行）")
    except ImportError:
        logger.warning("PySide2 不可用，直接启动")
        _deferred_startup()


# ── 主入口 ──
_main()
