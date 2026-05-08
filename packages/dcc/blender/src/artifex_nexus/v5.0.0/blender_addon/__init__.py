"""
Artifex Nexus Blender Addon — 侧栏面板 + MCP Server 生命周期管理
================================================================

复刻自 artclaw_bridge/subprojects/DCCClawBridge/blender_addon.py，
精简：去掉 Qt Bridge、事件拦截、Tool Manager 相关代码。

在 Blender 侧栏（N 面板）提供：
  - 状态指示灯（红/绿）
  - 启动/停止按钮
  - 端口号显示
  - MCP Server 生命周期管理

安装方式：
  1. 将 packages/dcc/blender/src/artifex_nexus 放到 Blender addons 目录
  2. 在 Blender 偏好设置中启用 "Artifex Nexus Bridge"

CI 兼容：bpy 导入失败时（非 Blender 环境），仅暴露子模块供测试导入。
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

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
_addon_dir = Path(__file__).parent
_src_dir = _addon_dir.parent  # packages/dcc/blender/src/artifex_nexus
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))

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
        from blender_addon.mcp_server import MCPServer
        _mcp_server = MCPServer(port=8083)
    return _mcp_server


def _get_adapter():
    """延迟导入 BlenderAdapter"""
    global _adapter
    if _adapter is None:
        from blender_addon.blender_adapter import BlenderAdapter
        _adapter = BlenderAdapter()
    return _adapter


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
                row.label(text="●", icon="PLAY")
                row.label(text="运行中")
            else:
                row.alert = True
                row.label(text="●", icon="PAUSE")
                row.label(text="已停止")

            # ── 端口信息 ──
            if server.is_running and server.actual_port:
                layout.label(text=f"端口: {server.actual_port}")
                layout.label(text=f"地址: ws://127.0.0.1:{server.actual_port}")

            layout.separator()

            # ── 启动/停止按钮 ──
            row = layout.row(align=True)
            if server.is_running:
                row.operator("artifex.stop_server", text="停止", icon="CANCEL")
            else:
                row.operator("artifex.start_server", text="启动", icon="PLAY")

            # ── 信息 ──
            layout.separator()
            layout.label(text="MCP Bridge v0.1.0")
            layout.label(text="AI 驱动的 Blender 操作")


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
                from blender_addon.mcp_server import register_builtin_tools
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
        """Blender addon 注册入口"""
        for cls in _classes:
            bpy.utils.register_class(cls)
        logger.info("Artifex Nexus Blender addon registered")


    def unregister():
        """Blender addon 反注册入口 — 自动停止 MCP Server"""
        global _mcp_server, _adapter

        if _mcp_server is not None and _mcp_server.is_running:
            try:
                _mcp_server.stop()
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
