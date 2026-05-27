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

import json
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

# 共享 SDK 路径注入（开发期：从源目录回溯）
# 部署后 SDK 已内嵌在 _addon_dir 内，此路径不存在时静默跳过
_sdk_probe = _addon_dir.parents[4] / "shared"
if _sdk_probe.is_dir():
    _sdk_str = str(_sdk_probe)
    if _sdk_str not in sys.path:
        sys.path.insert(0, _sdk_str)

# ── Maya 元信息 ──────────────────────────────────────────────────────────
plugin_info = {
    "name": "Artifex Nexus Bridge",
    "author": "Ivan(杨己力)",
    "version": (2023,),
    "maya_min": (2023,),
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
_skill_hub = None   # SkillHub 实例（延迟初始化）
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


def _get_skill_hub():
    """延迟获取 SkillHub 实例"""
    global _skill_hub
    return _skill_hub


def _init_skill_hub():
    """初始化 SkillHub（在 MCP Server 启动后调用）"""
    global _skill_hub
    if _skill_hub is not None:
        return _skill_hub
    try:
        from artifex_nexus_sdk.skill_hub import init_skill_hub as _init_hub
        import maya.cmds as _cmds
        _skills_dir = os.path.join(os.path.expanduser("~"), ".artifexnexus", "skills")
        _skill_hub = _init_hub(
            dcc_name="maya",
            version_func=lambda: str(_cmds.about(version=True)),
            skills_dir=_skills_dir,
            module_prefix="maya_skill_",
        )
        _skill_hub.scan_and_register()
        _skill_hub.start_watching(interval=2.0)
        logger.info("SkillHub 已初始化并完成扫描")
    except Exception as e:
        logger.error(f"SkillHub 初始化失败: {e}")
    return _skill_hub


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
        # 初始化 SkillHub
        _init_skill_hub()
    else:
        logger.error("Maya MCP Server 启动失败")
    return success


def stop_server() -> None:
    """停止 MCP Server"""
    global _mcp_server, _skill_hub
    # 停止 SkillHub 监控
    if _skill_hub is not None:
        _skill_hub.stop_watching()
        _skill_hub = None
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
        "connected_clients": server.connected_client_count,
        "triggers_enabled": _triggers_enabled,
    }


# ── 用户偏好 ────────────────────────────────────────────────────────────

_PREFS_FILE = os.path.join(str(_addon_dir), ".ui_prefs.json")


def _load_prefs() -> Dict[str, Any]:
    try:
        with open(_PREFS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_prefs(prefs: Dict[str, Any]) -> None:
    with open(_PREFS_FILE, "w", encoding="utf-8") as f:
        json.dump(prefs, f, indent=2, ensure_ascii=False)


def get_auto_show_panel() -> bool:
    """启动时是否自动显示 UI 面板（默认开启）"""
    return _load_prefs().get("auto_show_panel", True)


def set_auto_show_panel(value: bool) -> None:
    prefs = _load_prefs()
    prefs["auto_show_panel"] = value
    _save_prefs(prefs)

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

        cmds.menuItem(label="Show Panel", command=_menu_show_panel)
        cmds.menuItem(divider=True)
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

def _shelf_start(*args, show_alert: bool = True):
    if start_server():
        if _HAS_MAYA and show_alert:
            cmds.confirmDialog(
                title="Artifex Nexus",
                message=f"MCP Server 已启动\n端口: 18081",
                button=["确定"],
            )
    else:
        if _HAS_MAYA and show_alert:
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


def _menu_show_panel(*args):
    """菜单 → Show Panel"""
    try:
        from maya_ui import show_panel
        show_panel()
    except Exception as e:
        logger.error(f"无法打开面板: {e}")


# ── 生命周期 ────────────────────────────────────────────────────────────

def register():
    """
    Maya 启动时调用（由 userSetup.py 触发）。

    在 ~/Documents/maya/{ver}/scripts/userSetup.py 中添加:
        import artifex_nexus
        artifex_nexus.register()

    Maya 自动将 scripts/ 加入 Python 路径，artifex_nexus 安装后
    直接是 scripts/artifex_nexus/ 扁平面目录，无需额外路径注入。
    """
    if not _HAS_MAYA:
        logger.warning("Maya 不可用，跳过 UI 注册")
        return

    logger.info(f"Artifex Nexus Maya Addon v{'.'.join(map(str, plugin_info['version']))}")

    # 延迟执行，等 Maya UI 完全就绪
    import maya.utils as _mu

    def _deferred_startup():
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
            if start_server():
                logger.info("Maya MCP Server 已自动启动")
            else:
                logger.warning("Maya MCP Server 自动启动失败")

        logger.info("Maya addon 注册完成")

        # 自动显示 UI 面板（尊重偏好设置）
        # executeDeferred 执行时 Maya 窗口可能尚未完全就位，
        # QTimer 延迟确保面板不被主窗口遮挡
        try:
            if get_auto_show_panel():
                from PySide2.QtCore import QTimer
                QTimer.singleShot(1500, _auto_show_panel)
            else:
                logger.info("用户已关闭启动时自动显示面板，跳过")
        except Exception as e:
            logger.warning(f"无法自动显示面板: {e}")

    _mu.executeDeferred(_deferred_startup)


def _auto_show_panel():
    """延迟显示面板并确保前台（解决启动时被主窗口遮挡的问题）"""
    try:
        import maya_ui
        maya_ui.show_panel()
        panel = maya_ui._global_panel
        if panel is not None:
            from PySide2.QtCore import QTimer
            QTimer.singleShot(200, panel.raise_)
    except Exception as e:
        logger.warning(f"自动显示面板失败: {e}")


def unregister():
    """Maya 关闭/卸载时调用"""
    global _mcp_server, _adapter, _skill_hub, _triggers_enabled

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

def generate_user_setup(maya_version: str = "2023") -> str:
    """生成 userSetup.py 内容（供安装器使用）。

    Maya 启动时自动将 scripts/ 加入 Python 路径，安装后的 artifex_nexus/
    是 scripts/ 下的扁平目录，直接 import artifex_nexus 即可。

    Args:
        maya_version: Maya 版本号，如 "2023"（用于注释标记，不影响导入路径）
    """
    content = f'''# >>> Artifex Nexus Maya Bridge (auto-generated for Maya {maya_version})
import artifex_nexus
artifex_nexus.register()
# <<< Artifex Nexus Maya Bridge
'''
    return content


# ── 入口点 ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    register()
