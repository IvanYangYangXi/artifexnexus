"""
Artifex Nexus 3ds Max Addon — 菜单栏 + MCP Server 生命周期管理
================================================================

在 3ds Max 提供：
  - Artifex Nexus 菜单栏
  - 启动/停止 MCP Server（端口 18082）
  - 触发器开关
  - 状态查看

自动加载：scripts/startup/artifex_startup.ms → startup.py

CI 兼容：pymxs 导入失败时暴露空壳 register/unregister。
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger("artifex.max")

# ── 路径注入 ────────────────────────────────────────────────────────────
_addon_dir = Path(__file__).parent
if str(_addon_dir) not in sys.path:
    sys.path.insert(0, str(_addon_dir))

_sdk_dir = _addon_dir.parents[4] / "shared"
_sdk_str = str(_sdk_dir)
if _sdk_str not in sys.path:
    sys.path.insert(0, _sdk_str)

# ── 元信息 ──────────────────────────────────────────────────────────────
plugin_info = {
    "name": "Artifex Nexus Bridge",
    "author": "Ivan(杨己力)",
    "version": (2023,),
    "max_min": (2023,),
    "max_max": None,
    "description": "Artifex Nexus MCP Bridge — AI 驱动的 3ds Max 操作",
}

# ── pymxs 导入 ──────────────────────────────────────────────────────────
try:
    import pymxs
    _HAS_MAX = True
except ImportError:
    _HAS_MAX = False

# ── 全局状态 ────────────────────────────────────────────────────────────
_mcp_server = None
_adapter = None
_triggers_enabled = True


def _get_mcp_server():
    global _mcp_server
    if _mcp_server is None:
        from mcp_server import create_server
        _mcp_server = create_server()
    return _mcp_server


def _get_adapter():
    global _adapter
    if _adapter is None:
        from max_adapter import MaxAdapter
        _adapter = MaxAdapter()
        # 设置全局引用（供 #timeout 回调使用）
        import max_adapter as _ma
        _ma._global_adapter = _adapter
    return _adapter


def _warn_port_occupied(port: int) -> None:
    """端口被占用时输出警告（Max Listener + 日志）"""
    msg = f"[Artifex Nexus] 警告: 端口 {port} 被占用，MCP Server 无法启动"
    print(msg)
    if _HAS_MAX:
        try:
            from pymxs import runtime as rt
            rt.print(msg, warning=True)
        except Exception:
            pass


# ── 公共 API ────────────────────────────────────────────────────────────

def start_server() -> bool:
    from mcp_server import DEFAULT_PORT

    server = _get_mcp_server()
    if server.is_running:
        logger.info("MCP Server 已在运行")
        return True

    # 端口预检查：被占用时跳过启动并提示
    from artifex_nexus_sdk.mcp_server import MCPServer as _MCPServer
    if not _MCPServer._is_port_available("127.0.0.1", DEFAULT_PORT):
        logger.warning(f"端口 {DEFAULT_PORT} 被占用，MCP Server 无法启动")
        _warn_port_occupied(DEFAULT_PORT)
        return False

    adapter = _get_adapter()
    server.set_adapter(adapter)
    adapter.set_server(server)

    from mcp_server import register_builtin_tools
    register_builtin_tools(server, adapter)

    success = server.start()
    if success:
        logger.info(f"Max MCP Server 已启动: {server.server_address}")
    else:
        logger.error("Max MCP Server 启动失败")
    return success


def stop_server() -> None:
    global _mcp_server
    if _mcp_server and _mcp_server.is_running:
        _mcp_server.stop()
    _mcp_server = None


def restart_server() -> bool:
    stop_server()
    return start_server()


def toggle_triggers(enabled: bool = None) -> bool:
    global _triggers_enabled
    if enabled is not None:
        _triggers_enabled = enabled
    else:
        _triggers_enabled = not _triggers_enabled

    if _HAS_MAX:
        from trigger_dispatcher import register_max_callbacks, unregister_max_callbacks
        if _triggers_enabled:
            register_max_callbacks()
        else:
            unregister_max_callbacks()

    logger.info(f"触发器: {'已启用' if _triggers_enabled else '已禁用'}")
    return _triggers_enabled


def get_status() -> Dict[str, Any]:
    server = _get_mcp_server()
    return {
        "software": "3ds_max",
        "version": _get_adapter().get_software_version(),
        "server_running": server.is_running,
        "server_address": server.server_address,
        "triggers_enabled": _triggers_enabled,
    }


# ── Max UI ──────────────────────────────────────────────────────────────

def _create_menu():
    """创建 Artifex Nexus 菜单（先注册 MacroScript，再创建菜单项）。

    参照 artclaw：先用 rt.execute('macroScript ...') 注册宏，
    再用 menuMan.createActionItem 引用它们。
    """
    if not _HAS_MAX:
        return

    try:
        from pymxs import runtime as rt

        # 1. 注册 MacroScript（幂等：先 cleanup 再注册）
        rt.execute('''
            -- 清理已有
            for m in #(artifex_nexus_start, artifex_nexus_stop, artifex_nexus_status, artifex_nexus_toggle_triggers) do (
                try (macros.delete m) catch()
            )

            macroScript artifex_nexus_start
                category:"ArtifexNexus"
                tooltip:"Start Artifex Nexus MCP Server"
            (
                python.execute "from artifex_nexus.v2023.max_addon import start_server, _print_status; start_server(); _print_status()"
            )

            macroScript artifex_nexus_stop
                category:"ArtifexNexus"
                tooltip:"Stop Artifex Nexus MCP Server"
            (
                python.execute "from artifex_nexus.v2023.max_addon import stop_server, _print_status; stop_server(); _print_status()"
            )

            macroScript artifex_nexus_status
                category:"ArtifexNexus"
                tooltip:"Show Artifex Nexus Status"
            (
                python.execute "from artifex_nexus.v2023.max_addon import _print_status; _print_status()"
            )

            macroScript artifex_nexus_toggle_triggers
                category:"ArtifexNexus"
                tooltip:"Toggle Artifex Nexus Triggers"
            (
                python.execute "from artifex_nexus.v2023.max_addon import toggle_triggers, _print_status; toggle_triggers(); _print_status()"
            )
        ''')

        # 2. 创建菜单（幂等：先清理再创建）
        rt.execute('''
            -- 清理已有菜单
            for i = 1 to 5 do (
                m = menuMan.findMenu "ArtifexNexus"
                if m != undefined do menuMan.unRegisterMenu m
            )
            mainMenu = menuMan.getMainMenuBar()
            for i = mainMenu.numItems() to 1 by -1 do (
                item = mainMenu.getItem i
                if item != undefined and item.getTitle() == "Artifex Nexus" do
                    mainMenu.removeItemByPosition i
            )

            -- 创建新菜单
            anMenu = menuMan.createMenu "ArtifexNexus"

            startAction = menuMan.createActionItem "artifex_nexus_start" "ArtifexNexus"
            startAction.setTitle "Start MCP Server"
            startAction.setUseCustomTitle true
            anMenu.addItem startAction -1

            stopAction = menuMan.createActionItem "artifex_nexus_stop" "ArtifexNexus"
            stopAction.setTitle "Stop MCP Server"
            stopAction.setUseCustomTitle true
            anMenu.addItem stopAction -1

            anMenu.addItem (menuMan.createSeparatorItem()) -1

            toggleAction = menuMan.createActionItem "artifex_nexus_toggle_triggers" "ArtifexNexus"
            toggleAction.setTitle "Toggle Triggers"
            toggleAction.setUseCustomTitle true
            anMenu.addItem toggleAction -1

            anMenu.addItem (menuMan.createSeparatorItem()) -1

            statusAction = menuMan.createActionItem "artifex_nexus_status" "ArtifexNexus"
            statusAction.setTitle "Status"
            statusAction.setUseCustomTitle true
            anMenu.addItem statusAction -1

            subItem = menuMan.createSubMenuItem "Artifex Nexus" anMenu
            mainMenu.addItem subItem (mainMenu.numItems())
            menuMan.updateMenuBar()
        ''')

        logger.info("Max 菜单已创建")
    except Exception as e:
        logger.error(f"创建 Max 菜单失败: {e}")


def _print_status():
    """打印状态到 Max Listener"""
    status = get_status()
    msg = (
        f"[Artifex Nexus] 3ds Max {status['version']} | "
        f"Server: {'ON' if status['server_running'] else 'OFF'} | "
        f"Port: 18082 | "
        f"Triggers: {'ON' if status['triggers_enabled'] else 'OFF'}"
    )
    if _HAS_MAX:
        try:
            from pymxs import runtime as rt
            rt.print(msg)
        except Exception:
            pass
    print(msg)


# ── 生命周期 ────────────────────────────────────────────────────────────

def register():
    """Max 启动时调用（由 startup.py 通过 _deferred_startup 触发）。

    仅创建菜单，不自动启动 Server（Server 由 startup.py 管理）。
    保留此函数用于手动调用场景（如 Shelf 按钮）。
    """
    if not _HAS_MAX:
        logger.warning("pymxs 不可用，跳过 UI 注册")
        return

    logger.info(f"Artifex Nexus Max Addon v{'.'.join(map(str, plugin_info['version']))}")

    try:
        _create_menu()
    except Exception as e:
        logger.warning(f"创建菜单失败: {e}")

    logger.info("Max addon 注册完成")
    _print_status()


def unregister():
    """Max 关闭/卸载时调用"""
    global _mcp_server, _adapter

    stop_server()

    if _HAS_MAX:
        from trigger_dispatcher import unregister_max_callbacks
        unregister_max_callbacks()

        try:
            from pymxs import runtime as rt
            main_menu = rt.menuMan.getMainMenuBar()
            # 移除菜单项
            for i in range(main_menu.numItems()):
                item = main_menu.getItem(i)
                if item and item.getTitle() == "Artifex Nexus":
                    main_menu.removeItemByPosition(i)
                    break
            rt.menuMan.updateMenuBar()
        except Exception:
            pass

    _adapter = None
    logger.info("Max addon 已卸载")


# ── 宏脚本注册（供 MaxScript 菜单调用）──

def _macro_start():
    """macroScript: 启动 MCP Server"""
    if start_server():
        _print_status()


def _macro_stop():
    """macroScript: 停止 MCP Server"""
    stop_server()
    _print_status()


def _macro_status():
    """macroScript: 查看状态"""
    _print_status()


def _macro_toggle_triggers():
    """macroScript: 切换触发器"""
    toggle_triggers()
    _print_status()
