"""
trigger_dispatcher.py — Nexus Tool 触发器调度引擎
=================================================

从 MCPBridgeClient 接收 Blender trigger_event 广播，
加载 _bundled_nexus_tools 中的 Nexus Tool manifest，
匹配 event 触发器规则，执行匹配的工具，
并通过 call_blender_run_python 将结果回传 Blender 显示 popup。

线程安全：通过 MCPBridgeClient 的 event loop 投递 callback。
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class TriggerDispatcher:
    """Nexus Tool 触发器调度引擎。

    加载 bundled Nexus Tools 的 manifest，
    匹配 event 类型触发器，执行工具，回传结果。
    """

    def __init__(self, nexus_tools_root: Optional[str] = None):
        """
        Args:
            nexus_tools_root: _bundled_nexus_tools 目录路径。
                             默认自动探测当前包下的目录。
        """
        if nexus_tools_root is None:
            nexus_tools_root = self._find_nexus_tools_root()

        self._nexus_tools_root = nexus_tools_root
        # tool_id → (tool_dir, manifest, matched_triggers)
        self._tool_registry: Dict[str, dict] = {}
        # event_type → [tool_id, ...]
        self._event_index: Dict[str, List[str]] = {}

        self._loaded = False
        logger.info("TriggerDispatcher 初始化: root=%s", self._nexus_tools_root)

    def _find_nexus_tools_root(self) -> Optional[str]:
        """自动探测 _bundled_nexus_tools 目录路径。"""
        # 尝试从本文件所在包路径推导
        try:
            pkg_dir = Path(__file__).resolve().parent
            candidate = pkg_dir / "_bundled_nexus_tools"
            if candidate.is_dir():
                return str(candidate)
        except Exception:
            pass
        return None

    # ── 触发回调入口 ──

    def on_trigger_event(self, payload: dict) -> None:
        """MCPBridgeClient 的 trigger_event 回调。

        从 Blender MCP Server 广播的 trigger_event 消息中提取
        event_type / dcc / filepath / data，匹配并执行 Nexus Tools。

        Args:
            payload: trigger_event 消息字典，格式:
                {"type":"trigger_event","dcc":"blender","event":"file.save.post",...}
        """
        event_type = payload.get("event", "")
        dcc = payload.get("dcc", "")
        filepath = payload.get("filepath", "")
        data = payload.get("data", {})

        logger.info(
            "[Trigger] RECEIVED event=%s dcc=%s file=%s",
            event_type, dcc, filepath,
        )

        if not event_type or dcc != "blender":
            logger.debug("[Trigger] SKIP: dcc=%s (非 blender)", dcc)
            return

        # 懒加载工具注册表
        if not self._loaded:
            self._load_tools()

        # 匹配触发器
        matched = self._match_triggers(event_type, payload)
        if not matched:
            logger.info("[Trigger] NO MATCH for event=%s", event_type)
            return

        logger.info("[Trigger] MATCHED %d tool(s) for event=%s", len(matched), event_type)

        # 执行匹配的工具
        results = []
        for tool_id in matched:
            result = self._execute_tool(tool_id, payload)
            results.append(result)

        # 回传 Blender popup（仅当有 issue 时）
        self._send_results_to_blender(results, event_type, filepath)

    # ── 工具加载 ──

    def _load_tools(self) -> None:
        """扫描 _bundled_nexus_tools 目录，加载所有 manifest 并索引 event 触发器。"""
        if self._nexus_tools_root is None:
            logger.warning("[Trigger] 未找到 _bundled_nexus_tools 目录，跳过加载")
            self._loaded = True
            return

        root = Path(self._nexus_tools_root)
        manifest_paths = list(root.rglob("manifest.json"))
        logger.info("[Trigger] SCANNING nexus_tools_root=%s found=%d manifests",
                     root, len(manifest_paths))

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

            # 索引 event → tool_id
            for t in matched_triggers:
                event_name = t["trigger"]["event"]
                if event_name not in self._event_index:
                    self._event_index[event_name] = []
                self._event_index[event_name].append(tool_id)

            logger.info("[Trigger] REGISTERED tool=%s events=%s",
                         tool_id, [t["trigger"]["event"] for t in matched_triggers])

        self._loaded = True
        total = len(self._tool_registry)
        total_triggers = sum(len(v["triggers"]) for v in self._tool_registry.values())
        logger.info("[Trigger] LOADED tools=%d triggers=%d", total, total_triggers)

    # ── 触发器匹配 ──

    def _match_triggers(self, event_type: str, payload: dict) -> List[str]:
        """匹配 event_type 对应的工具列表。

        简单的 event_type 字符串匹配。
        conditions / filters 匹配留到 _execute_tool 中由工具自身处理。
        """
        return list(self._event_index.get(event_type, []))

    # ── 工具执行 ──

    def _execute_tool(self, tool_id: str, payload: dict) -> dict:
        """执行单个 Nexus Tool。

        Args:
            tool_id: 工具 ID（e.g. "marketplace/blender-object-naming-check"）
            payload: trigger_event 消息字典

        Returns:
            {"tool_id": str, "action": "allow"|"reject"|"error", "reason": str}
        """
        reg = self._tool_registry.get(tool_id)
        if not reg:
            return {"tool_id": tool_id, "action": "error", "reason": "工具未注册"}

        manifest = reg["manifest"]
        tool_dir = reg["dir"]
        impl = manifest.get("implementation", {})
        entry = impl.get("entry", "main.py")
        function = impl.get("function", "main")

        logger.info("[Trigger] EXECUTING tool=%s entry=%s func=%s", tool_id, entry, function)

        # 动态 import 工具
        module_name = entry.replace(".py", "")

        # 将工具目录加入 sys.path（执行后移除）
        path_added = False
        if tool_dir not in sys.path:
            sys.path.insert(0, tool_dir)
            path_added = True

        try:
            if module_name in sys.modules:
                mod = importlib.reload(sys.modules[module_name])
            else:
                mod = importlib.import_module(module_name)

            fn = getattr(mod, function, None)
            if fn is None:
                return {"tool_id": tool_id, "action": "error",
                        "reason": f"函数 '{function}' 未找到"}

            # 构建 event_data 参数
            event_data = {
                "dcc_type": payload.get("dcc", "blender"),
                "event_type": payload.get("event", ""),
                "timing": payload.get("timing", "post"),
                "data": payload.get("data", {}),
            }
            # 兼容 artclaw_sdk 格式
            event_data["asset_path"] = payload.get("filepath", "")
            event_data["asset_name"] = payload.get("data", {}).get("asset_name", "")
            event_data["asset_class"] = payload.get("data", {}).get("asset_class", "")

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
            return {"tool_id": tool_id, "action": action, "reason": reason}

        except Exception as e:
            logger.error("[Trigger] EXECUTION ERROR tool=%s: %s", tool_id, e, exc_info=True)
            return {"tool_id": tool_id, "action": "error", "reason": str(e)}

        finally:
            if path_added and tool_dir in sys.path:
                sys.path.remove(tool_dir)

    # ── 结果回传 Blender ──

    def _send_results_to_blender(self, results: List[dict],
                                  event_type: str, filepath: str) -> None:
        """将触发器执行结果通过 call_blender_run_python 在 Blender 弹出通知。

        仅当有 reject / error 结果时弹窗，全部通过则静默。
        """
        issues = [r for r in results if r.get("action") in ("reject", "error")]
        if not issues:
            logger.info("[Trigger] ALL OK for event=%s", event_type)
            return

        # 构建 popup 消息
        import textwrap as _textwrap
        lines = [f"事件: {event_type}", f"文件: {filepath or '(未保存)'}", ""]
        for issue in issues:
            tool_name = issue["tool_id"].rsplit("/", 1)[-1]
            lines.append(f"[{tool_name}] {issue['reason']}")

        message = "\\n".join(lines)

        # 通过 run_python 在 Blender 弹窗
        # 使用 json.dumps 确保 message 中的特殊字符（引号、反斜杠等）正确转义
        popup_code = _textwrap.dedent(f"""
            import bpy, json
            _msg = json.loads({json.dumps(message)!r})
            def _artifex_trigger_popup(self, context):
                for line in _msg.split('\\\\n'):
                    self.layout.label(text=line)
            bpy.context.window_manager.popup_menu(
                _artifex_trigger_popup, title='Artifex Nexus — 触发器检查', icon='ERROR'
            )
        """).strip()

        try:
            # 延迟导入避免循环依赖
            from artifex_nexus.openclaw_wrapper.mcp_bridge import call_blender_run_python
            result = call_blender_run_python(popup_code, timeout=15.0)
            is_error = result.get("isError", False) if isinstance(result, dict) else False
            if is_error:
                content = result.get("content", [{}])[0].get("text", "") if isinstance(result, dict) else ""
                logger.warning("[Trigger] POPUP FAILED: %s", content[:200])
            else:
                logger.info("[Trigger] POPUP SENT issues=%d", len(issues))
        except Exception as e:
            logger.error("[Trigger] POPUP SEND ERROR: %s", e, exc_info=True)
