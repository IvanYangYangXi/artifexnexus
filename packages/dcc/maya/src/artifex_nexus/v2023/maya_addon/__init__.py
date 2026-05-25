"""
Artifex Nexus Maya Addon — Shelf + MCP Server 生命周期管理
============================================================

在 Maya 提供：
  - Artifex Nexus Shelf（工具栏按钮）
  - Artifex Nexus 菜单
  - 启动/停止 MCP Server
  - 触发器开关

通过 userSetup.py 自动加载：
  将 artifact_nexus 目录放入 ~/Documents/maya/{ver}/scripts/
  在 userSetup.py 中 import 并调用 register()

CI 兼容：maya.cmds 导入失败时暴露空壳 register/unregister。
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger("artifex.maya")

# ── 路径注入 ────────────────────────────────────────────────────────────
_addon_dir = Path(__file__).parent
if str(_addon_dir) not in sys.path:
    sys.path.insert(0, str(_addon_dir))

# 共享 SDK 路径（开发期）
_sdk_dir = _addon_dir.parents[4] / "shared"
_sdk_path = str(_sdk_dir)
if _sdk_path not in sys.path:
    sys.path.insert(0, _sdk_path)

# ── Maya 元信息 ──────────────────────────────────────────────────────────
plugin_info = {
    "name": "Artifex Nexus Bridge",
    "author": "Ivan(杨己力)",
    "version": (2023,),
    "maya_max": None,
    "description": "Artifex Nexus MCP Bridge — AI 驱动的 Maya 操作",
}

# ── maya.cmds 导入（CI 环境无 maya，跳过 Maya 特有代码）─────────────────
try:
    import maya.cmds as cmds
    import maya.mel as mel
    _HAS_MAYA = True
except ImportError:
    _HAS_MAYA = False

# ── 全局状态 ────────────────────────────────────────────────────────────
_mcp_server = None
_adapter = None
_triggers_enabled = True


def _get_mcp_server():
    """延迟导入 MCPServer"""
    global _mcp_server
    if _mcp_server is None:
        from mcp_server import create_server
        _mcp_server = create_server()
    return _mcp_server


def _get_adapter():
    """延迟导入 Adapter"""
    global _adapter
    if _adapter is None:
        from maya_adapter import MayaAdapter
        _adapter = MayaAdapter()
    return _adapter


# ── 公共 API ────────────────────────────────────────────────────────────

def start_server() -> bool:
    """启动 MCP Server（端口 18081）"""
    from mcp_server import DEFAULT_PORT

    server = _get_mcp_server()
    if server.is_running:
        logger.info("MCP Server 已在运行")
        return True

    # 端口预检查：被占用时跳过启动并提示
    from artifex_nexus_sdk.mcp_server import MCPServer as _MCPServer
    if not _MCPServer._is_port_available("127.0.0.1", DEFAULT_PORT):
        logger.warning(f"端口 {DEFAULT_PORT} 被占用，MCP Server 无法启动")
        if _HAS_MAYA:
            cmds.confirmDialog(
                title="Artifex Nexus",
                message=f"端口 {DEFAULT_PORT} 被占用\nMCP Server 无法启动，请检查端口占用",
                button=["确定"],
                icon="warning",
            )
        return False

    adapter = _get_adapter()
    server.set_adapter(adapter)
    adapter.set_server(server)

    from mcp_server import register_builtin_tools
    register_builtin_tools(server, adapter)

    success = server.start()
    if success:
        logger.info(f"Maya MCP Server 已启动: {server.server_address}")
    else:
        logger.error("Maya MCP Server 启动失败")
    return success


def stop_server() -> None:
    """停止 MCP Server"""
    global _mcp_server
    if _mcp_server and _mcp_server.is_running:
        _mcp_server.stop()
    _mcp_server = None


def restart_server() -> bool:
    """重启 MCP Server"""
    stop_server()
    return start_server()


def toggle_triggers(enabled: bool = None) -> bool:
    """切换触发器开关"""
    global _triggers_enabled
    if enabled is not None:
        _triggers_enabled = enabled
    else:
        _triggers_enabled = not _triggers_enabled
    logger.info(f"触发器: {'已启用' if _triggers_enabled else '已禁用'}")
    return _triggers_enabled


def get_status() -> Dict[str, Any]:
    """获取当前状态"""
    server = _get_mcp_server()
    return {
        "software": "maya",
        "version": _get_adapter().get_software_version(),
        "server_running": server.is_running,
        "server_address": server.server_address,
        "triggers_enabled": _triggers_enabled,
    }


# ── Maya UI：Shelf + Menu ───────────────────────────────────────────────

def _create_shelf():
    """创建 Artifex Nexus Shelf 按钮"""
    if not _HAS_MAYA:
        return

    try:
        # 获取或创建 "ArtifexNexus" shelf
        shelf_name = "ArtifexNexus"
        shelves = cmds.shelfLayout(query=True, childArray=True) or []
        if shelf_name not in shelves:
            cmds.shelfLayout(shelf_name, parent="ShelfLayout")
            logger.info(f"创建 Shelf: {shelf_name}")

        # 添加到当前活动 shelf
        current_shelf = cmds.shelfTabLayout(shelf_name, query=True, selectTab=True)

        # 启动按钮
        cmds.shelfButton(
            parent=current_shelf,
            label="AN Start",
            annotation="启动 Artifex Nexus MCP Server (端口 18081)",
            image="commandButton.png",
            command=_shelf_start,
        )

        # 停止按钮
        cmds.shelfButton(
            parent=current_shelf,
            label="AN Stop",
            annotation="停止 Artifex Nexus MCP Server",
            image="commandButton.png",
            command=_shelf_stop,
        )

        # 状态按钮
        cmds.shelfButton(
            parent=current_shelf,
            label="AN Status",
            annotation="查看 Artifex Nexus 状态",
            image="commandButton.png",
            command=_shelf_status,
        )

        logger.info("Shelf 按钮已创建")
    except Exception as e:
        logger.error(f"创建 Shelf 失败: {e}")


def _create_menu():
    """创建 Artifex Nexus 菜单"""
    if not _HAS_MAYA:
        return

    try:
        main_window = mel.eval("$tmpVar=$gMainWindow")
        menu_name = "ArtifexNexusMenu"

        # 删除旧菜单
        if cmds.menu(menu_name, exists=True):
            cmds.deleteUI(menu_name)

        # 创建菜单
        cmds.menu(
            menu_name,
            label="Artifex Nexus",
            parent=main_window,
            tearOff=True,
        )

        cmds.menuItem(label="启动 MCP Server", command=_shelf_start)
        cmds.menuItem(label="停止 MCP Server", command=_shelf_stop)
        cmds.menuItem(divider=True)
        cmds.menuItem(label="切换触发器", command=_shelf_toggle_triggers)
        cmds.menuItem(divider=True)
        cmds.menuItem(label="查看状态", command=_shelf_status)

        logger.info("菜单已创建")
    except Exception as e:
        logger.error(f"创建菜单失败: {e}")


# ── Shelf 回调 ──────────────────────────────────────────────────────────

def _shelf_start(*args):
    if start_server():
        if _HAS_MAYA:
            cmds.confirmDialog(
                title="Artifex Nexus",
                message=f"MCP Server 已启动\n端口: 18081",
                button=["确定"],
            )
    else:
        if _HAS_MAYA:
            cmds.confirmDialog(
                title="Artifex Nexus",
                message="MCP Server 启动失败",
                button=["确定"],
                icon="critical",
            )


def _shelf_stop(*args):
    stop_server()
    if _HAS_MAYA:
        cmds.confirmDialog(
            title="Artifex Nexus",
            message="MCP Server 已停止",
            button=["确定"],
        )


def _shelf_status(*args):
    status = get_status()
    if _HAS_MAYA:
        msg = (
            f"软件: Maya {status['version']}\n"
            f"Server: {'运行中' if status['server_running'] else '已停止'}\n"
            f"地址: {status['server_address'] or 'N/A'}\n"
            f"触发器: {'启用' if status['triggers_enabled'] else '禁用'}"
        )
        cmds.confirmDialog(
            title="Artifex Nexus 状态",
            message=msg,
            button=["确定"],
        )


def _shelf_toggle_triggers(*args):
    enabled = toggle_triggers()
    if _HAS_MAYA:
        if enabled:
            from trigger_dispatcher import register_maya_callbacks
            register_maya_callbacks()
        else:
            from trigger_dispatcher import unregister_maya_callbacks
            unregister_maya_callbacks()
        cmds.confirmDialog(
            title="Artifex Nexus",
            message=f"触发器: {'已启用' if enabled else '已禁用'}",
            button=["确定"],
        )


# ── 生命周期 ────────────────────────────────────────────────────────────

def register():
    """
    Maya 启动时调用（由 userSetup.py 触发）。

    在 ~/Documents/maya/{ver}/scripts/userSetup.py 中添加:
        from artifex_nexus.v2023.maya_addon import register
        register()
    """
    if not _HAS_MAYA:
        logger.warning("Maya 不可用，跳过 UI 注册")
        return

    logger.info(f"Artifex Nexus Maya Addon v{'.'.join(map(str, plugin_info['version']))}")

    # 创建 UI
    _create_menu()
    _create_shelf()

    # 注册事件钩子
    from trigger_dispatcher import register_maya_callbacks
    register_maya_callbacks()

    # 自动启动 MCP Server（可选，由用户配置决定）
    auto_start = os.environ.get("ARTIFEX_MAYA_AUTO_START", "1") == "1"
    if auto_start:
        logger.info("自动启动 MCP Server...")
        start_server()

    logger.info("Maya addon 注册完成")


def unregister():
    """Maya 关闭/卸载时调用"""
    global _mcp_server, _adapter, _triggers_enabled

    stop_server()

    if _HAS_MAYA:
        from trigger_dispatcher import unregister_maya_callbacks
        unregister_maya_callbacks()

        # 清理 UI
        try:
            if cmds.menu("ArtifexNexusMenu", exists=True):
                cmds.deleteUI("ArtifexNexusMenu")
        except Exception:
            pass

        try:
            if cmds.shelfLayout("ArtifexNexus", exists=True):
                cmds.deleteUI("ArtifexNexus", layout=True)
        except Exception:
            pass

    _adapter = None
    logger.info("Maya addon 已卸载")


# ── userSetup.py 模板────────────────────────────────────────────────────

def generate_user_setup(target_dir: str = None) -> str:
    """生成 userSetup.py 内容（供安装器使用）"""
    content = '''# Artifex Nexus Maya Bridge — 自动加载
import sys
import os

# 添加插件路径（安装器自动填充）
_addon_path = os.path.join(
    os.path.expanduser("~"), "Documents", "maya",
    os.path.basename(os.path.dirname(os.path.dirname(__file__))) if "__file__" in dir() else "",
    "scripts", "artifex_nexus"
)
if os.path.exists(_addon_path) and _addon_path not in sys.path:
    sys.path.insert(0, _addon_path)

try:
    from artifex_nexus.v2023.maya_addon import register
    register()
except ImportError as e:
    print(f"[Artifex Nexus] 加载失败: {e}")
'''
    return content


# ── 入口点 ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    register()
