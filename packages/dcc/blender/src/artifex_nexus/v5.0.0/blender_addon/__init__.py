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
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict

# ── 日志 ────────────────────────────────────────────────────────────────
logger = logging.getLogger("artifex.blender")

# ── Blender 插件元信息 ──────────────────────────────────────────────────
bl_info = {
    "name": "Artifex Nexus Bridge",
    "author": "Ivan(杨己力)",
    "version": (5, 0, 0),
    "blender": (5, 0, 0),
    "blender_max": (5, 1, 9),
    "location": "View3D > Sidebar > Artifex Nexus",
    "description": "Artifex Nexus MCP Bridge — AI 驱动的 Blender 操作",
    "category": "Interface",
}

# ── 路径注入 ────────────────────────────────────────────────────────────
# 确保当前 addon 目录和共享 SDK 在 sys.path 中
_addon_dir = Path(__file__).parent
if str(_addon_dir) not in sys.path:
    sys.path.insert(0, str(_addon_dir))

# 共享 SDK 路径
# blender_addon → v5.0.0 → artifex_nexus → src → blender → dcc → shared
_sdk_dir = _addon_dir.parents[4] / "shared"
_sdk_path = str(_sdk_dir)
if _sdk_path not in sys.path:
    sys.path.insert(0, _sdk_path)

# ── bpy 导入（CI 环境无 bpy，跳过 Blender 特有代码）────────────────────
try:
    import bpy
    _HAS_BPY = True
except ImportError:
    _HAS_BPY = False

# ── 全局状态 ────────────────────────────────────────────────────────────
_mcp_server = None  # MCPServer 实例（延迟导入）
_adapter = None     # BlenderAdapter 实例
_skill_hub = None   # SkillHub 实例（延迟初始化）


def _get_mcp_server():
    """延迟导入 MCPServer，避免循环依赖"""
    global _mcp_server
    if _mcp_server is None:
        from mcp_server import create_server
        _mcp_server = create_server()
    return _mcp_server


def _get_adapter():
    """延迟导入 BlenderAdapter"""
    global _adapter
    if _adapter is None:
        from blender_adapter import BlenderAdapter
        _adapter = BlenderAdapter()
    return _adapter


def _get_trigger_dispatcher():
    """延迟导入 BlenderTriggerDispatcher"""
    from trigger_dispatcher import BlenderTriggerDispatcher
    return BlenderTriggerDispatcher.get_instance()


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
        import bpy as _bpy
        _skills_dir = os.path.join(os.path.expanduser("~"), ".artifexnexus", "skills")
        _skill_hub = _init_hub(
            dcc_name="blender",
            version_func=lambda: _bpy.app.version_string,
            skills_dir=_skills_dir,
            module_prefix="blender_skill_",
        )
        _skill_hub.scan_and_register()
        # 启动轮询监控（2s 间隔）
        _skill_hub.start_watching(interval=2.0)
        logger.info("SkillHub 已初始化并完成扫描")
    except Exception as e:
        logger.error(f"SkillHub 初始化失败: {e}")
    return _skill_hub


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

            # 初始化 SkillHub（MCP Server 启动后）
            _init_skill_hub()
        else:
            logger.error("MCP Server 自动启动失败")
            print("[Artifex Nexus] MCP Server 自动启动失败")

    except Exception as e:
        logger.error(f"MCP Server 自动启动异常: {e}")
        print(f"[Artifex Nexus] MCP Server 自动启动异常: {e}")


# ── 触发器钩子 ──────────────────────────────────────────────────────
# 通过 bpy.app.handlers 监听 Blender 事件，当事件触发时由
# BlenderTriggerDispatcher（本地）匹配并执行 Nexus Tool 触发器。
# 同时通过 MCP 向 sidecar 上报执行状态（可选，非关键路径）。
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
    """DCC 事件 → BlenderTriggerDispatcher 本地执行 + 可选 MCP 状态上报。

    主流程在 Blender 内部完成（读配置 → 匹配 → 执行工具 → 弹窗）。
    同时通过 MCP broadcast 上报状态给 sidecar（非关键，失败不影响功能）。
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

    data = {
        "scene_name": scene_name,
        "asset_name": scene_name,
        "asset_class": "BlendFile",
    }

    # ── 主流程：Blender 本地触发器执行 ──
    try:
        dispatcher = _get_trigger_dispatcher()
        dispatcher.on_trigger_event(event_type, filepath, data)
    except Exception:
        logger.error("[Trigger] 本地触发器执行异常", exc_info=True)

    # ── 可选：MCP 状态上报（非关键）──
    try:
        server = _get_mcp_server()
        if server is not None and server.is_running:
            timing = event_type.rsplit(".", 1)[-1] if "." in event_type else ""
            server.broadcast_trigger_event(event_type, filepath, timing=timing, data=data)
    except Exception:
        pass  # 静默失败 —— 状态上报不影响 DCC 正常操作

    logger.info("[Trigger] event=%s file=%s scene=%s", event_type, filepath, scene_name)


def _report_trigger_status(event_type: str, filepath: str, results: list) -> None:
    """将触发器执行结果通过 MCP 上报给 sidecar（可选，非关键路径）。"""
    try:
        server = _get_mcp_server()
        if server is not None and server.is_running:
            payload = {
                "event": event_type,
                "filepath": filepath,
                "results": [
                    {"tool_id": r.get("tool_id", ""), "action": r.get("action", "")}
                    for r in results
                ],
            }
            server.broadcast_trigger_event(
                "trigger.result", filepath,
                timing="post",
                data={"trigger_results": payload},
            )
    except Exception:
        pass  # 静默失败


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

            layout.separator()

            # ── 触发器开关 ──
            dispatcher = _get_trigger_dispatcher()
            row = layout.row(align=True)
            if dispatcher.enabled:
                row.alert = False
                row.label(text="触发器: 已启用", icon="CHECKBOX_HLT")
                row.operator("artifex.toggle_trigger", text="禁用", icon="CHECKBOX_DEHLT")
            else:
                row.alert = True
                row.label(text="触发器: 已禁用", icon="CHECKBOX_DEHLT")
                row.operator("artifex.toggle_trigger", text="启用", icon="CHECKBOX_HLT")

            layout.separator()

            # ── 信息 ──
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

                    # 初始化 SkillHub
                    _init_skill_hub()
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


    class ARTIFEX_OT_ToggleTrigger(bpy.types.Operator):
        """启用/禁用 Nexus Tool 触发器系统"""
        bl_idname = "artifex.toggle_trigger"
        bl_label = "切换触发器"
        bl_description = "启用或禁用自动触发器检查（如保存时命名检查）"

        def execute(self, context):
            dispatcher = _get_trigger_dispatcher()
            dispatcher.enabled = not dispatcher.enabled
            status = "启用" if dispatcher.enabled else "禁用"
            self.report({"INFO"}, f"Nexus Tool 触发器已{status}")
            logger.info("触发器系统已%s", status)

            for area in context.screen.areas:
                if area.type == "VIEW_3D":
                    area.tag_redraw()
            return {"FINISHED"}


    class ARTIFEX_OT_TriggerPopup(bpy.types.Operator):
        """触发器结果弹窗。

        静默模式: popup_menu（Blender 原生浮动面板，点击外部关闭）。
        通知模式: invoke_props_dialog（标准对话框，自带"确定"按钮）。
        """
        bl_idname = "artifex.trigger_popup"
        bl_label = "Artifex Nexus — 触发器检查"
        bl_description = "查看触发器执行结果"
        bl_options = {'INTERNAL'}

        _message: str = ""
        _auto_dismiss: bool = False

        @classmethod
        def prepare(cls, message: str, auto_dismiss: bool) -> None:
            cls._message = message
            cls._auto_dismiss = auto_dismiss

        def invoke(self, context, event):
            if self.__class__._auto_dismiss:
                # 静默模式：popup_menu（闭包捕获 message，避免 self 覆盖问题）
                _message = self.__class__._message
                _title = self.bl_label
                def _draw(_self, _ctx):
                    for line in _message.split("\n"):
                        if line == "":
                            _self.layout.separator(factor=0.3)
                        else:
                            _self.layout.label(text=line)
                context.window_manager.popup_menu(
                    _draw, title=_title, icon='INFO',
                )
                return {'FINISHED'}
            else:
                # 通知模式：invoke_props_dialog（自带"确定"按钮）
                return context.window_manager.invoke_props_dialog(self, width=480)

        def execute(self, context):
            return {'FINISHED'}

        def draw(self, context):
            for line in self.__class__._message.split("\n"):
                if line == "":
                    self.layout.separator(factor=0.3)
                else:
                    self.layout.label(text=line)


    _classes = (
        ARTIFEX_PT_MainPanel,
        ARTIFEX_OT_StartServer,
        ARTIFEX_OT_StopServer,
        ARTIFEX_OT_ToggleTrigger,
        ARTIFEX_OT_TriggerPopup,
    )


    def _trigger_ui_callback(message: str, auto_dismiss: bool) -> None:
        """触发器结果弹窗回调（由 trigger_dispatcher 调用）。

        通过 bpy.app.timers 延迟一帧执行，确保 handler 回调中有正确的 context。
        """
        ARTIFEX_OT_TriggerPopup.prepare(message, auto_dismiss)

        def _invoke():
            try:
                bpy.ops.artifex.trigger_popup('INVOKE_DEFAULT')
            except Exception:
                logger.error("[Trigger] 弹窗调用失败", exc_info=True)
            return None  # 单次调用，停止 timer

        bpy.app.timers.register(_invoke, first_interval=0.0)


    def register():
        """Blender addon 注册入口 — 注册完成后自动启动 MCP Server"""
        for cls in _classes:
            bpy.utils.register_class(cls)
        logger.info("Artifex Nexus Blender addon registered")

        # 自动启动 MCP Server
        _auto_start_server()

        # 注册触发器钩子
        _register_trigger_hooks()

        # 注入回调
        dispatcher = _get_trigger_dispatcher()
        dispatcher.set_status_reporter(_report_trigger_status)
        dispatcher.set_ui_callback(_trigger_ui_callback)


    def unregister():
        """Blender addon 反注册入口 — 自动停止 MCP Server"""
        global _mcp_server, _adapter, _skill_hub

        # 注销触发器钩子
        _unregister_trigger_hooks()

        # 停止 SkillHub 监控
        if _skill_hub is not None:
            _skill_hub.stop_watching()
            _skill_hub = None

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
