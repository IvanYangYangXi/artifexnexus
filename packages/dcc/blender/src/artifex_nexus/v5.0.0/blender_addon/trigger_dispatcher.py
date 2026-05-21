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
  - 弹窗通过 _ui_callback 委托给 __init__.py（Operator 注册所在模块）
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

SKILLS_CONFIG_PATH = Path.home() / ".artifexnexus" / "config" / "skills.json"
"""skills.json 配置文件路径（含 nexus_tools.disabled 工具总闸禁用列表）"""


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


def _get_disabled_nexus_tools() -> set:
    """读取 skills.json 中 nexus_tools.disabled 列表（工具总闸）。

    返回被用户禁用的 tool_id 集合。
    Blender 无法 import artifex_nexus.core.skill_config，故直接读 JSON。
    """
    if SKILLS_CONFIG_PATH.exists():
        try:
            with open(SKILLS_CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
            nexus_tools = config.get("nexus_tools", {}) if isinstance(config, dict) else {}
            disabled = nexus_tools.get("disabled", [])
            if isinstance(disabled, list):
                return set(disabled)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to read skills.json: %s", e)
    return set()


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

        # UI 回调（由 __init__.py 注入，用于显示弹窗/气泡）
        # callable(message: str, auto_dismiss: bool) -> None
        self._ui_callback: Optional[Callable] = None

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

    # ── UI 回调 ──

    def set_ui_callback(self, callback: Optional[Callable]) -> None:
        """注入 UI 显示回调。

        Args:
            callback: callable(message: str, auto_dismiss: bool) 或 None
        """
        self._ui_callback = callback

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

        # 读取工具总闸禁用列表（skills.json → nexus_tools.disabled）
        disabled_tools = _get_disabled_nexus_tools()
        if disabled_tools:
            logger.info("[Trigger] user-disabled tools: %s", sorted(disabled_tools))

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

            # 检查工具总闸：用户是否在 UI 中禁用了此工具的触发器
            if tool_id in disabled_tools:
                logger.info("[Trigger] SKIP disabled tool=%s", tool_id)
                continue

            tool_dir = str(mp.parent)
            tool_triggers = manifest.get("triggers", [])

            # 筛选 event 类型的 blender 触发器
            matched_triggers = []
            for t in tool_triggers:
                # 优先读新格式，fallback 旧格式（兼容 Phase A 之前创建的旧实例）
                trigger_type = t.get("triggerType") or (t.get("trigger", {}) or {}).get("type", "")
                dcc = t.get("dcc") or (t.get("trigger", {}) or {}).get("dcc", "")
                event_name = t.get("eventType") or (t.get("trigger", {}) or {}).get("event", "")
                if trigger_type != "event":
                    continue
                if dcc != "blender":
                    continue
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
                event_name = t.get("eventType") or (t.get("trigger", {}) or {}).get("event", "")
                execution_mode = t.get("executionMode", "notify")
                entry = (tool_id, execution_mode)
                if event_name not in self._event_index:
                    self._event_index[event_name] = []
                if entry not in self._event_index[event_name]:
                    self._event_index[event_name].append(entry)

            logger.info("[Trigger] REGISTERED tool=%s events=%s",
                         tool_id, [t.get("eventType") or (t.get("trigger", {}) or {}).get("event", "")
                                   for t in matched_triggers])

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
            tool_id: 工具 GUID（e.g. "25080280-7302-46e8-80f5-4b846cd79184"）
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

        # 实例工具 fallback：入口文件不在工具目录时，使用父工具目录
        # （实例工具只存 manifest（参数副本），脚本沿用父工具）
        entry_path = Path(tool_dir) / entry
        if not entry_path.exists():
            parent_path = manifest.get("parentPath", "")
            if parent_path and Path(parent_path).is_dir():
                logger.info("[Trigger] INSTANCE tool=%s → parent dir=%s", tool_id, parent_path)
                tool_dir = parent_path

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

    def _show_notification(self, issues: List[dict], event_type: str,
                            filepath: str, *, auto_dismiss: bool) -> None:
        """通用通知：通过 _ui_callback 委托给 __init__.py 显示。

        所有 Blender UI 操作集中在 __init__.py 中（bpy 上下文所在），
        保持 trigger_dispatcher 不直接依赖 bpy.types.Operator。

        Args:
            auto_dismiss: True=静默模式（自动消失），False=通知模式（需用户关闭）
        """
        if self._ui_callback is None:
            logger.warning("[Trigger] UI 回调未注入，跳过通知")
            return

        lines = [f"事件: {event_type}", f"文件: {filepath or '(未保存)'}", ""]
        for issue in issues:
            tool_name = issue.get("tool_name", issue.get("tool_id", "unknown"))
            lines.append(f"[{tool_name}] {issue.get('reason', '未知错误')}")

        message = "\n".join(lines)
        try:
            self._ui_callback(message, auto_dismiss)
        except Exception:
            logger.error("[Trigger] 通知显示失败", exc_info=True)

    def _show_bubble(self, issues: List[dict], event_type: str,
                      filepath: str) -> None:
        """气泡提示（静默模式）：popup 样式，5 秒后自动消失。"""
        self._show_notification(issues, event_type, filepath, auto_dismiss=True)

    def _show_popup(self, issues: List[dict], event_type: str,
                     filepath: str) -> None:
        """弹窗提示（通知模式）：popup 样式，需用户点击外部关闭。"""
        self._show_notification(issues, event_type, filepath, auto_dismiss=False)

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
