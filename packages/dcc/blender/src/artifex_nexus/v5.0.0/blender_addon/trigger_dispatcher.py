"""
trigger_dispatcher.py — Blender 内独立触发器调度引擎
======================================================

在 Blender 进程内直接完成触发器匹配与 Nexus Tool 执行，
不再经过 sidecar round-trip。

工作流程：
  1. 读取 ~/.artifexnexus/config/tool-sources.json
  2. 获取 sdk_path 并加入 sys.path（解析 import artifex_nexus_sdk）
  3. 扫描所有已注册工具源码目录的 manifest.json
  4. 构建 event_type → [tool_id, ...] 索引
  5. 事件触发时：匹配 → import 工具 → 调用 entry 函数 → 弹窗

设计：
  - 工具代码直接在 Blender Python 中运行，可直接使用 bpy
  - 弹窗使用 bpy.context.window_manager.popup_menu()
  - 可选的 MCP 状态上报（通过 mcp_server）
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("artifex.blender.trigger")

# ── 常量 ────────────────────────────────────────────────────────────────

TOOL_SOURCES_PATH = Path.home() / ".artifexnexus" / "config" / "tool-sources.json"
"""tool-sources.json 配置文件路径（跨进程共享）"""


# ── 配置读取（内联实现，不依赖 sidecar 的 tool_sources 模块）─────────────

def _read_tool_sources_config() -> Dict[str, Any]:
    """读取 tool-sources.json 配置文件。

    不依赖 sidecar 的 tool_sources 模块（Blender addon 无法 import sidecar 包）。
    """
    if TOOL_SOURCES_PATH.exists():
        try:
            with open(TOOL_SOURCES_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to read tool-sources.json: %s", e)

    return {"version": 1, "sdk_path": None, "sources": []}


def _get_sdk_path() -> Optional[str]:
    """从 tool-sources.json 读取 SDK 父目录路径。"""
    config = _read_tool_sources_config()
    sdk_path = config.get("sdk_path")
    if sdk_path and Path(sdk_path).is_dir():
        return sdk_path
    return None


def _get_source_dirs() -> List[str]:
    """获取所有已注册的工具源码目录路径（仅返回存在的目录）。"""
    config = _read_tool_sources_config()
    sources: List[str] = []
    for src in config.get("sources", []):
        path = src.get("path", "")
        if path and Path(path).is_dir():
            sources.append(path)
    return sources


def _find_manifest_paths(source_dirs: List[str]) -> List[Path]:
    """扫描所有源码目录，返回所有 manifest.json 绝对路径。"""
    manifests: List[Path] = []
    for src_dir in source_dirs:
        root = Path(src_dir)
        try:
            for mp in root.rglob("manifest.json"):
                manifests.append(mp)
        except (OSError, PermissionError):
            continue
    return manifests


# ── BlenderTriggerDispatcher ─────────────────────────────────────────────

class BlenderTriggerDispatcher:
    """Blender 内部的 Nexus Tool 触发器调度引擎。

    单例模式：整个 Blender 进程共享一个实例。
    """

    _instance: Optional[BlenderTriggerDispatcher] = None

    def __init__(self):
        # tool_id → {"dir": str, "manifest": dict, "triggers": [dict, ...]}
        self._tool_registry: Dict[str, dict] = {}
        # event_type → [tool_id, ...]
        self._event_index: Dict[str, List[str]] = {}
        self._loaded = False
        self._enabled = True  # 全局开关

        # 状态上报回调（可选，由外部注入 mcp_server）
        self._status_reporter: Optional[Callable] = None

    @classmethod
    def get_instance(cls) -> BlenderTriggerDispatcher:
        """获取单例实例。"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── 全局开关 ──

    @property
    def enabled(self) -> bool:
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool) -> None:
        self._enabled = bool(value)
        logger.info("触发器系统: %s", "启用" if self._enabled else "禁用")

    # ── 状态上报回调 ──

    def set_status_reporter(self, reporter: Optional[Callable]) -> None:
        """注入状态上报回调（如 mcp_server.broadcast_trigger_event）。

        Args:
            reporter: callable(event_type, filepath, results) 或 None
        """
        self._status_reporter = reporter

    # ── 事件入口 ──

    def on_trigger_event(self, event_type: str, filepath: str = "",
                          data: dict = None) -> None:
        """DCC 事件入口（由 __init__.py 的 handler 调用）。

        Args:
            event_type: 事件类型，如 "file.save.post"
            filepath: 当前场景文件路径
            data: 增强数据（scene_name, asset_class 等）
        """
        if not self._enabled:
            logger.debug("[Trigger] 触发器系统已禁用，跳过 event=%s", event_type)
            return

        if data is None:
            data = {}

        logger.info("[Trigger] RECEIVED event=%s file=%s", event_type, filepath)

        # 懒加载工具注册表
        if not self._loaded:
            self._load_tools()

        # 匹配触发器
        matched = self._match_triggers(event_type)
        if not matched:
            logger.info("[Trigger] NO MATCH for event=%s", event_type)
            return

        logger.info("[Trigger] MATCHED %d tool(s) for event=%s", len(matched), event_type)

        # 构建 payload
        payload = {
            "dcc": "blender",
            "event": event_type,
            "filepath": filepath,
            "timing": event_type.rsplit(".", 1)[-1] if "." in event_type else "",
            "data": data,
        }

        # 执行匹配的工具
        results = []
        for tool_id, execution_mode in matched:
            result = self._execute_tool(tool_id, payload)
            result["execution_mode"] = execution_mode
            results.append(result)

        # 按模式分组显示
        silent_results = [r for r in results
                          if r.get("execution_mode") == "silent"
                          and r.get("action") in ("reject", "error")]
        notify_results = [r for r in results
                          if r.get("execution_mode") != "silent"
                          and r.get("action") in ("reject", "error")]

        if silent_results:
            self._show_bubble(silent_results, event_type, filepath)
        if notify_results:
            self._show_popup(notify_results, event_type, filepath)

        # 可选：上报状态到 sidecar
        self._report_status(event_type, filepath, results)

    # ── 工具加载 ──

    def _load_tools(self) -> None:
        """扫描所有已注册源码目录，加载 manifest 并构建事件索引。

        工具只需在 manifest.json 中声明 triggers 字段即可被自动发现，
        无需额外的配置文件注册步骤。
        """
        # 1. 注入 SDK 路径
        sdk_path = _get_sdk_path()
        if sdk_path and sdk_path not in sys.path:
            sys.path.insert(0, sdk_path)
            logger.info("[Trigger] SDK path 已注入: %s", sdk_path)
        elif not sdk_path:
            logger.warning("[Trigger] SDK path 未配置，工具可能无法 import artifex_nexus_sdk")

        # 2. 获取所有源码目录
        source_dirs = _get_source_dirs()
        if not source_dirs:
            logger.warning("[Trigger] 未找到任何工具源码目录")
            self._loaded = True
            return

        manifest_paths = _find_manifest_paths(source_dirs)
        if not manifest_paths:
            logger.warning("[Trigger] 未找到任何 manifest.json")
            self._loaded = True
            return

        logger.info("[Trigger] 扫描到 %d 个 manifest", len(manifest_paths))

        for mp in manifest_paths:
            try:
                with open(mp, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
            except Exception as e:
                logger.warning("[Trigger] 跳过无效 manifest %s: %s", mp, e)
                continue

            tool_id = manifest.get("id", "")
            if not tool_id:
                continue

            tool_dir = str(mp.parent)
            tool_triggers = manifest.get("triggers", [])

            # 筛选 event 类型的 blender 触发器
            matched_triggers = []
            for t in tool_triggers:
                trigger_def = t.get("trigger", {})
                if trigger_def.get("type") != "event":
                    continue
                if trigger_def.get("dcc") != "blender":
                    continue
                event_name = trigger_def.get("event", "")
                if not event_name:
                    continue
                if not t.get("enabled", True):
                    continue
                matched_triggers.append(t)

            if not matched_triggers:
                continue

            # 注册
            self._tool_registry[tool_id] = {
                "dir": tool_dir,
                "manifest": manifest,
                "triggers": matched_triggers,
            }

            # 索引 event → (tool_id, execution_mode)
            for t in matched_triggers:
                event_name = t["trigger"]["event"]
                execution_mode = t.get("executionMode", "notify")
                entry = (tool_id, execution_mode)
                if event_name not in self._event_index:
                    self._event_index[event_name] = []
                if entry not in self._event_index[event_name]:
                    self._event_index[event_name].append(entry)

            logger.info("[Trigger] REGISTERED tool=%s events=%s",
                         tool_id, [t["trigger"]["event"] for t in matched_triggers])

        self._loaded = True
        total = len(self._tool_registry)
        total_triggers = sum(len(v["triggers"]) for v in self._tool_registry.values())
        logger.info("[Trigger] LOADED tools=%d triggers=%d", total, total_triggers)

    def reload_tools(self) -> None:
        """重新加载工具注册表（用于工具目录变更后刷新）。"""
        self._tool_registry.clear()
        self._event_index.clear()
        self._loaded = False
        self._load_tools()

    # ── 触发器匹配 ──

    def _match_triggers(self, event_type: str) -> List[tuple]:
        """匹配 event_type 对应的 (tool_id, execution_mode) 列表。"""
        return list(self._event_index.get(event_type, []))

    # ── 工具执行 ──

    def _execute_tool(self, tool_id: str, payload: dict) -> dict:
        """执行单个 Nexus Tool。

        在 Blender Python 内动态 import 工具模块并调用 entry 函数。

        Args:
            tool_id: 工具 ID（e.g. "marketplace/blender-object-naming-check"）
            payload: trigger_event 数据字典

        Returns:
            {"tool_id": str, "tool_name": str, "action": "allow"|"reject"|"error", "reason": str}
        """
        reg = self._tool_registry.get(tool_id)
        if not reg:
            return {"tool_id": tool_id, "tool_name": tool_id, "action": "error", "reason": "工具未注册"}

        manifest = reg["manifest"]
        tool_dir = reg["dir"]
        tool_name = manifest.get("name", tool_id)
        impl = manifest.get("implementation", {})
        entry = impl.get("entry", "main.py")
        function = impl.get("function", "main")

        logger.info("[Trigger] EXECUTING tool=%s entry=%s func=%s", tool_id, entry, function)

        module_name = entry.replace(".py", "")

        # 临时将工具目录加入 sys.path
        paths_added = []
        if tool_dir not in sys.path:
            sys.path.insert(0, tool_dir)
            paths_added.append(tool_dir)

        try:
            # 动态 import
            if module_name in sys.modules:
                mod = importlib.reload(sys.modules[module_name])
            else:
                mod = importlib.import_module(module_name)

            fn = getattr(mod, function, None)
            if fn is None:
                return {"tool_id": tool_id, "tool_name": tool_name,
                        "action": "error", "reason": f"函数 '{function}' 未找到"}

            # 构建 event_data 参数
            event_data = {
                "dcc_type": payload.get("dcc", "blender"),
                "event_type": payload.get("event", ""),
                "timing": payload.get("timing", "post"),
                "data": payload.get("data", {}),
                "asset_path": payload.get("filepath", ""),
                "asset_name": payload.get("data", {}).get("asset_name", ""),
                "asset_class": payload.get("data", {}).get("asset_class", ""),
            }

            # 调用 entry 函数
            try:
                result = fn(event_data=event_data)
            except TypeError:
                # 函数不接受 event_data，尝试 kwargs
                result = fn(**event_data.get("data", {}))

            action = "allow"
            reason = ""
            if isinstance(result, dict):
                action = result.get("action", "allow")
                reason = result.get("reason", "")

            logger.info("[Trigger] RESULT tool=%s action=%s reason=%s",
                         tool_id, action, reason)
            return {"tool_id": tool_id, "tool_name": tool_name,
                    "action": action, "reason": reason}

        except Exception as e:
            logger.error("[Trigger] EXECUTION ERROR tool=%s: %s", tool_id, e, exc_info=True)
            return {"tool_id": tool_id, "tool_name": tool_name,
                    "action": "error", "reason": str(e)}

        finally:
            for p in reversed(paths_added):
                if p in sys.path:
                    sys.path.remove(p)

    # ── Blender 通知系统 ──

    def _show_bubble(self, issues: List[dict], event_type: str, filepath: str) -> None:
        """气泡提示（静默模式）：在 3D 视图底部显示半透明通知，5 秒后自动消失。

        使用 draw handler + timer 实现非阻塞通知。
        """
        import bpy
        import blf

        # 构建消息行
        lines = [f"事件: {event_type}", f"文件: {filepath or '(未保存)'}"]
        for issue in issues:
            tool_name = issue.get("tool_name", issue.get("tool_id", "unknown"))
            lines.append(f"[{tool_name}] {issue.get('reason', '未知错误')}")

        start_time = time.time()
        _active = [True]  # mutable flag for closure

        # 收集所有 VIEW_3D 空间
        draw_spaces = []
        for window in bpy.context.window_manager.windows:
            for area in window.screen.areas:
                if area.type == 'VIEW_3D':
                    try:
                        draw_spaces.append(area.spaces[0])
                    except Exception:
                        pass

        if not draw_spaces:
            logger.warning("[Trigger] 无可用 VIEW_3D 空间，气泡通知跳过")
            return

        def _draw_bubble():
            if not _active[0]:
                return

            try:
                region = bpy.context.region
                if not region:
                    return

                elapsed = time.time() - start_time
                alpha = min(1.0, (5.0 - elapsed) / 0.5)  # fade out last 0.5s
                if alpha <= 0:
                    return

                # 布局参数
                line_h = 20
                pad = 14
                box_w = 450
                box_h = len(lines) * line_h + pad * 2 + 8

                x = region.width / 2 - box_w / 2
                y = 80  # from bottom

                # 背景
                from gpu_extras.batch import batch_for_shader
                import gpu

                vertices = [
                    (x, y), (x + box_w, y),
                    (x + box_w, y + box_h), (x, y + box_h),
                ]
                indices = [(0, 1, 2), (0, 2, 3)]

                shader = gpu.shader.from_builtin('UNIFORM_COLOR')
                batch = batch_for_shader(shader, 'TRIS', {"pos": vertices}, indices=indices)
                shader.bind()
                shader.uniform_float("color", (0.08, 0.08, 0.10, 0.92 * alpha))
                batch.draw(shader)
            except Exception:
                return  # GPU 操作失败时静默退出

        def _draw_text():
            if not _active[0]:
                return

            try:
                region = bpy.context.region
                if not region:
                    return

                elapsed = time.time() - start_time
                alpha = min(1.0, (5.0 - elapsed) / 0.5)

                line_h = 20
                pad = 14
                box_w = 450

                x = region.width / 2 - box_w / 2
                y = 80 + pad

                blf.size(0, 14)
                blf.color(0, 0.95, 0.95, 0.95, alpha)

                for i, line in enumerate(lines):
                    blf.position(0, x + pad, y + (len(lines) - 1 - i) * line_h, 0)
                    blf.draw(0, line)
            except Exception:
                return

        # 注册绘制回调
        bg_handles = []
        text_handles = []
        for space in draw_spaces:
            try:
                h1 = space.draw_handler_add(_draw_bubble, (), 'WINDOW', 'POST_PIXEL')
                h2 = space.draw_handler_add(_draw_text, (), 'WINDOW', 'POST_PIXEL')
                bg_handles.append((space, h1))
                text_handles.append((space, h2))
            except Exception:
                pass

        # 5 秒后清理
        def _cleanup():
            _active[0] = False
            for space, h in bg_handles + text_handles:
                try:
                    space.draw_handler_remove(h, 'WINDOW')
                except Exception:
                    pass
            return None  # 停止计时器

        bpy.app.timers.register(_cleanup, first_interval=5.0)
        logger.info("[Trigger] BUBBLE SHOWN issues=%d", len(issues))

    def _show_popup(self, issues: List[dict], event_type: str, filepath: str) -> None:
        """弹窗提示（通知模式）：需要用户点击关闭。

        使用 bpy popup_menu 显示触发器结果。
        """
        # 构建弹窗消息
        lines = [f"事件: {event_type}", f"文件: {filepath or '(未保存)'}", ""]
        for issue in issues:
            tool_name = issue.get("tool_name", issue.get("tool_id", "unknown"))
            lines.append(f"[{tool_name}] {issue.get('reason', '未知错误')}")

        message = "\\n".join(lines)

        try:
            import bpy
            import json as _json

            # 使用 json.dumps 转义 message
            popup_code = (
                "import bpy, json\n"
                f"_msg = json.loads({_json.dumps(message)!r})\n"
                "def _artifex_trigger_popup(self, context):\n"
                "    for line in _msg.split('\\\\n'):\n"
                "        self.layout.label(text=line)\n"
                "bpy.context.window_manager.popup_menu(\n"
                "    _artifex_trigger_popup, title='Artifex Nexus — 触发器检查', icon='ERROR'\n"
                ")"
            )
            exec(popup_code, {"bpy": bpy, "json": _json})
            logger.info("[Trigger] POPUP SHOWN issues=%d", len(issues))
        except Exception as e:
            logger.error("[Trigger] POPUP ERROR: %s", e, exc_info=True)

    # ── 状态上报 ──

    def _report_status(self, event_type: str, filepath: str,
                        results: List[dict]) -> None:
        """可选：将执行结果上报给 sidecar（通过 MCP broadcast）。"""
        if self._status_reporter is None:
            return

        try:
            self._status_reporter(event_type, filepath, results)
        except Exception:
            logger.debug("[Trigger] 状态上报失败（非关键）", exc_info=True)

    # ── 诊断信息 ──

    def diagnose(self) -> Dict[str, Any]:
        """返回触发器系统诊断信息。"""
        return {
            "enabled": self._enabled,
            "loaded": self._loaded,
            "tools_total": len(self._tool_registry),
            "triggers_total": sum(len(v["triggers"]) for v in self._tool_registry.values()),
            "event_index": dict(self._event_index),
            "sdk_path": _get_sdk_path(),
            "source_dirs": _get_source_dirs(),
            "config_path": str(TOOL_SOURCES_PATH),
        }
