"""
Artifex Nexus Blender Addon — 侧栏面板 + MCP Server 生命周期管理
================================================================

在 Blender 侧栏（N 面板）提供：
  - 状态指示灯（红/绿）
  - 启动/停止按钮
  - 端口号显示
  - MCP Server 生命周期管理

addon 启用时自动启动 MCP Server，无需手动操作。

CI 兼容：bpy 导入失败时（非 Blender 环境），仅暴露子模块供测试导入。
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path
from typing import Any, Dict

# ── 日志 ────────────────────────────────────────────────────────────────
logger = logging.getLogger("artifex.blender")

# ── Blender 插件元信息 ──────────────────────────────────────────────────
bl_info = {
    "name": "Artifex Nexus Bridge",
    "author": "Artifex Nexus",
    "version": (5, 0, 0),
    "blender": (5, 0, 0),
    "blender_max": (5, 1, 9),
    "location": "View3D > Sidebar > Artifex Nexus",
    "description": "Artifex Nexus MCP Bridge — AI 驱动的 Blender 操作",
    "category": "Interface",
}

# ── 路径注入 ────────────────────────────────────────────────────────────
# 确保当前 addon 目录在 sys.path 中，以便相对导入 mcp_server 等同级模块
_addon_dir = Path(__file__).parent
if str(_addon_dir) not in sys.path:
    sys.path.insert(0, str(_addon_dir))

# ── bpy 导入（CI 环境无 bpy，跳过 Blender 特有代码）────────────────────
try:
    import bpy
    _HAS_BPY = True
except ImportError:
    _HAS_BPY = False

# ── 全局状态 ────────────────────────────────────────────────────────────
_mcp_server = None  # MCPServer 实例（延迟导入）
_adapter = None     # BlenderAdapter 实例


def _get_mcp_server():
    """延迟导入 MCPServer，避免循环依赖"""
    global _mcp_server
    if _mcp_server is None:
        from mcp_server import MCPServer
        _mcp_server = MCPServer(port=18083)
    return _mcp_server


def _get_adapter():
    """延迟导入 BlenderAdapter"""
    global _adapter
    if _adapter is None:
        from blender_adapter import BlenderAdapter
        _adapter = BlenderAdapter()
    return _adapter


def _auto_start_server():
    """自动启动 MCP Server（addon 启用时调用）"""
    try:
        server = _get_mcp_server()
        adapter = _get_adapter()

        if server.is_running:
            logger.info("MCP Server 已在运行，跳过自动启动")
            return

        from mcp_server import register_builtin_tools
        register_builtin_tools(server, adapter)
        server.set_adapter(adapter)

        if server.start():
            logger.info(f"Artifex Nexus MCP Server 自动启动成功 — 端口 {server.actual_port}")
            print(f"[Artifex Nexus] MCP Server 已启动: ws://127.0.0.1:{server.actual_port}")
        else:
            logger.error("MCP Server 自动启动失败")
            print("[Artifex Nexus] MCP Server 自动启动失败")

    except Exception as e:
        logger.error(f"MCP Server 自动启动异常: {e}")
        print(f"[Artifex Nexus] MCP Server 自动启动异常: {e}")


# ── 触发器钩子 ──────────────────────────────────────────────────────
# 通过 bpy.app.handlers 监听 Blender 事件，当事件触发时通知
# Artifex Nexus sidecar 检查并执行匹配的 Nexus Tool 触发器。
#
# 事件覆盖（精简版，M2 验收范围）：
#   - file.save.post : 文件保存后
#   - file.open.post : 文件打开后
#
# 反重载保护：handler wrapper 函数存储在 sys.modules 特殊 key 下，
# 模块热重载后 wrapper 引用不变，内部通过 sys.modules 动态查找最新实现。

_TRIGGER_HANDLERS_ACTIVE = False

_DEDUP_WINDOW = 0.5
_dedup_state: Dict[str, Any] = {"key": "", "time": 0.0}

# 反重载保护：wrapper 函数存储在 sys.modules 特殊 key
_WRAPPER_KEY = "__artifex_blender_wrappers__"


def _get_or_create_wrappers():
    """返回跨 reload 稳定的 handler wrapper 函数对。

    wrapper 存储在 sys.modules[_WRAPPER_KEY] 下，
    不随本模块重载而变化，内部通过 sys.modules 动态查找最新实现。
    """
    registry = sys.modules.get(_WRAPPER_KEY)
    if registry is not None:
        return registry["save_post"], registry["load_post"]

    import bpy as _bpy

    @_bpy.app.handlers.persistent
    def save_post_wrapper(*_args: object) -> None:
        mod = sys.modules.get(__name__)
        if mod is not None:
            mod._on_save_post_impl(*_args)

    @_bpy.app.handlers.persistent
    def load_post_wrapper(*_args: object) -> None:
        mod = sys.modules.get(__name__)
        if mod is not None:
            mod._on_load_post_impl(*_args)

    registry = {"save_post": save_post_wrapper, "load_post": load_post_wrapper}
    sys.modules[_WRAPPER_KEY] = registry
    return save_post_wrapper, load_post_wrapper


def _on_save_post_impl(*_args: object) -> None:
    """file.save.post 实现（可随模块重载更新）"""
    import bpy as _bpy
    fp = _bpy.data.filepath or ""
    _notify_trigger_event("file.save.post", fp)


def _on_load_post_impl(*_args: object) -> None:
    """file.open.post 实现（可随模块重载更新）"""
    import bpy as _bpy
    fp = _bpy.data.filepath or ""
    _notify_trigger_event("file.open.post", fp)


def _notify_trigger_event(event_type: str, filepath: str = "") -> None:
    """将 DCC 事件推送给 Artifex Nexus sidecar（通过 MCP 广播）。

    含 500ms 去重保护 + 增强 payload（scene_name / asset_class / timing）。
    """
    # ── 去重 ──
    now = time.monotonic()
    dedup_key = f"{event_type}:{filepath}"
    if dedup_key == _dedup_state["key"] and (now - _dedup_state["time"]) < _DEDUP_WINDOW:
        return
    _dedup_state["key"] = dedup_key
    _dedup_state["time"] = now

    # ── 增强 payload ──
    try:
        import bpy as _bpy
        scene_name = _bpy.context.scene.name if _bpy.context.scene else ""
    except Exception:
        scene_name = ""

    timing = event_type.rsplit(".", 1)[-1] if "." in event_type else ""
    data = {
        "scene_name": scene_name,
        "asset_name": scene_name,
        "asset_class": "BlendFile",
    }

    try:
        server = _get_mcp_server()
        if server is not None and server.is_running:
            server.broadcast_trigger_event(event_type, filepath, timing=timing, data=data)
    except Exception:
        pass  # 静默失败 —— 触发器通知不应影响 DCC 正常操作

    logger.info("[Trigger] event=%s file=%s scene=%s", event_type, filepath, scene_name)


def _register_trigger_hooks() -> None:
    """注册 Blender 事件钩子（save_post / load_post）。

    使用 sys.modules wrapper 反重载保护。
    """
    global _TRIGGER_HANDLERS_ACTIVE
    if _TRIGGER_HANDLERS_ACTIVE or not _HAS_BPY:
        return

    import bpy as _bpy

    # 先清理已存在的（防止重复注册）
    _unregister_trigger_hooks()

    save_w, load_w = _get_or_create_wrappers()

    if save_w not in _bpy.app.handlers.save_post:
        _bpy.app.handlers.save_post.append(save_w)

    if load_w not in _bpy.app.handlers.load_post:
        _bpy.app.handlers.load_post.append(load_w)

    _TRIGGER_HANDLERS_ACTIVE = True
    logger.info("触发器钩子已注册 (save_post, load_post)")
    print("[Artifex Nexus] 触发器钩子已注册 (save_post, load_post)")


def _unregister_trigger_hooks() -> None:
    """注销 Blender 事件钩子。"""
    global _TRIGGER_HANDLERS_ACTIVE
    if not _HAS_BPY:
        return
    import bpy as _bpy

    save_w, load_w = _get_or_create_wrappers()

    for handler_list, fn in [
        (_bpy.app.handlers.save_post, save_w),
        (_bpy.app.handlers.load_post, load_w),
    ]:
        if fn in handler_list:
            handler_list.remove(fn)

    _TRIGGER_HANDLERS_ACTIVE = False
    logger.info("触发器钩子已注销")


# ── Blender 特有代码（仅在 bpy 可用时定义）─────────────────────────────

if _HAS_BPY:

    class ARTIFEX_PT_MainPanel(bpy.types.Panel):
        """Artifex Nexus 主面板 — 侧栏（N 键）"""
        bl_label = "Artifex Nexus"
        bl_idname = "ARTIFEX_PT_MainPanel"
        bl_space_type = "VIEW_3D"
        bl_region_type = "UI"
        bl_category = "Artifex Nexus"

        def draw(self, context):
            layout = self.layout
            server = _get_mcp_server()

            # ── 状态指示 ──
            row = layout.row(align=True)
            if server.is_running:
                row.alert = False
                row.label(text="MCP Server 运行中", icon="PLAY")
            else:
                row.alert = True
                row.label(text="MCP Server 已停止", icon="PAUSE")

            # ── 端口信息 ──
            if server.is_running and server.actual_port:
                layout.label(text=f"端口: {server.actual_port}")
                layout.label(text=f"地址: ws://127.0.0.1:{server.actual_port}")

            layout.separator()

            # ── 启动/停止按钮 ──
            row = layout.row(align=True)
            if server.is_running:
                row.operator("artifex.stop_server", text="停止 MCP Server", icon="CANCEL")
            else:
                row.operator("artifex.start_server", text="启动 MCP Server", icon="PLAY")

            # ── 信息 ──
            layout.separator()
            layout.label(text="Artifex Nexus MCP Bridge v5.0.0")


    class ARTIFEX_OT_StartServer(bpy.types.Operator):
        """启动 Artifex Nexus MCP Server"""
        bl_idname = "artifex.start_server"
        bl_label = "启动 MCP Server"
        bl_description = "启动 MCP WebSocket 服务器，等待 AI Agent 连接"

        def execute(self, context):
            server = _get_mcp_server()
            adapter = _get_adapter()

            if server.is_running:
                self.report({"INFO"}, "MCP Server 已在运行")
                return {"FINISHED"}

            try:
                from mcp_server import register_builtin_tools
                register_builtin_tools(server, adapter)
                server.set_adapter(adapter)

                if server.start():
                    self.report({"INFO"}, f"MCP Server 已启动 — 端口 {server.actual_port}")
                    logger.info(f"Artifex Nexus MCP Server started on port {server.actual_port}")
                else:
                    self.report({"ERROR"}, "MCP Server 启动失败")
                    logger.error("MCP Server failed to start")

            except Exception as e:
                self.report({"ERROR"}, f"启动失败: {e}")
                logger.error(f"Start server error: {e}")

            for area in context.screen.areas:
                if area.type == "VIEW_3D":
                    area.tag_redraw()
            return {"FINISHED"}


    class ARTIFEX_OT_StopServer(bpy.types.Operator):
        """停止 Artifex Nexus MCP Server"""
        bl_idname = "artifex.stop_server"
        bl_label = "停止 MCP Server"
        bl_description = "停止 MCP WebSocket 服务器"

        def execute(self, context):
            server = _get_mcp_server()

            if not server.is_running:
                self.report({"INFO"}, "MCP Server 未在运行")
                return {"FINISHED"}

            try:
                server.stop()
                self.report({"INFO"}, "MCP Server 已停止")
                logger.info("Artifex Nexus MCP Server stopped")
            except Exception as e:
                self.report({"ERROR"}, f"停止失败: {e}")
                logger.error(f"Stop server error: {e}")

            for area in context.screen.areas:
                if area.type == "VIEW_3D":
                    area.tag_redraw()
            return {"FINISHED"}


    _classes = (
        ARTIFEX_PT_MainPanel,
        ARTIFEX_OT_StartServer,
        ARTIFEX_OT_StopServer,
    )


    def register():
        """Blender addon 注册入口 — 注册完成后自动启动 MCP Server"""
        for cls in _classes:
            bpy.utils.register_class(cls)
        logger.info("Artifex Nexus Blender addon registered")

        # 自动启动 MCP Server
        _auto_start_server()

        # 注册触发器钩子
        _register_trigger_hooks()


    def unregister():
        """Blender addon 反注册入口 — 自动停止 MCP Server"""
        global _mcp_server, _adapter

        # 注销触发器钩子
        _unregister_trigger_hooks()

        if _mcp_server is not None and _mcp_server.is_running:
            try:
                _mcp_server.stop()
                logger.info("MCP Server 已随 addon 禁用自动停止")
            except Exception as e:
                logger.error(f"Error stopping MCP Server during unregister: {e}")

        _mcp_server = None
        _adapter = None

        for cls in reversed(_classes):
            bpy.utils.unregister_class(cls)
        logger.info("Artifex Nexus Blender addon unregistered")


    if __name__ == "__main__":
        register()

else:
    # CI 环境：提供空壳 register/unregister
    def register():
        pass

    def unregister():
        pass
