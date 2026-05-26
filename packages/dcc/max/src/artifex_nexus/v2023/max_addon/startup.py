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
# 部署后: startup.py 在 scripts/startup/，artifex_nexus/ 在 scripts/
_scripts_dir = Path(__file__).parent.parent  # → scripts/
_addon_dir = _scripts_dir / "artifex_nexus"   # → scripts/artifex_nexus/

for _d in (_scripts_dir, _addon_dir):
    _ds = str(_d)
    if _ds not in sys.path:
        sys.path.insert(0, _ds)

# SDK 路径（开发期：从源目录回溯；部署后可能不存在，静默跳过）
_sdk_probe = _scripts_dir.parents[3] / "packages" / "dcc" / "shared"
_sdk_dir = _sdk_probe if _sdk_probe.is_dir() else _addon_dir
if str(_sdk_dir) not in sys.path:
    sys.path.insert(0, str(_sdk_dir))

logger.info(f"Artifex Nexus Max Addon 启动中... (addon: {_addon_dir})")


def _deferred_startup():
    """延迟启动：创建 adapter → 注册菜单 → 启动 MCP Server → 注册钩子"""
    global _startup_done
    if _startup_done:
        logger.info("Max 启动已执行过，跳过重复调用")
        return
    _startup_done = True

    # ⚠️ sys.path 优先级修复：
    #   如果同一 Max 中同时安装了 artclaw，artifex 的模块导入会被 artclaw 的
    #   同名模块劫持（DCCClawBridge/core/mcp_server.py 等）。
    #   此时必须把 artifex 的 _addon_dir 提到 sys.path 最前面。
    _addon_str = str(_addon_dir)
    while _addon_str in sys.path:
        sys.path.remove(_addon_str)
    sys.path.insert(0, _addon_str)
    # 同时确保 SDK 优先
    _sdk_str = str(_sdk_dir) if _sdk_dir else ""
    if _sdk_str and _sdk_str != _addon_str:
        while _sdk_str in sys.path:
            sys.path.remove(_sdk_str)
        sys.path.insert(1, _sdk_str)

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

        # 设置全局引用（供 QTimer fallback #timeout 回调使用）
        import max_adapter as _ma
        _ma._global_adapter = adapter

        register_builtin_tools(server, adapter)

        # 创建 UI（菜单 + 宏）
        try:
            from artifex_nexus import _create_menu
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
        server_started = server.start()
        if server_started:
            logger.info(f"Max MCP Server 已启动: {server.server_address}")

            # 共享 server/adapter 实例给 UI 面板（避免 __init__.py 创建第二实例）
            import artifex_nexus as _an
            _an._mcp_server = server
            _an._adapter = adapter

            try:
                import pymxs
                pymxs.runtime.print(
                    f"[Artifex Nexus] MCP Server 已启动 (端口 {DEFAULT_PORT})"
                )
            except Exception:
                pass
        else:
            logger.error("Max MCP Server 启动失败")

        # 自动显示 UI 面板
        try:
            from PySide2.QtCore import QTimer as _Qt2
            _Qt2.singleShot(500, _show_panel_safe)
        except Exception:
            pass

    except Exception as e:
        logger.error(f"启动失败: {e}")
        import traceback
        traceback.print_exc()


def _show_panel_safe():
    """安全地显示 UI 面板（忽略所有异常）"""
    try:
        from max_ui import show_panel
        show_panel()
    except Exception as e:
        logger.warning(f"无法显示面板: {e}")


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
