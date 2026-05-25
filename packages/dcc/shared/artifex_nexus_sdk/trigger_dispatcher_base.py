"""
trigger_dispatcher_base.py - 共享触发器调度器基类
=================================================

Maya 和 3ds Max 的 trigger_dispatcher.py 有 ~90% 重复代码，
本模块提取共享逻辑：工具加载、匹配、执行、去重。
各 DCC 侧仅保留事件钩子注册/注销函数。

用法（以 Maya 为例）:
    from artifex_nexus_sdk.trigger_dispatcher_base import TriggerDispatcher
    dispatcher = TriggerDispatcher("maya")
    dispatcher.handle_post_save(filepath)
    dispatcher.handle_post_open(filepath)
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

# ── 常量 ────────────────────────────────────────────────────────────────
_DEDUP_WINDOW = 0.5  # 去重窗口（秒）

_TOOL_SOURCES_PATH = os.path.join(
    os.path.expanduser("~"), ".artifexnexus", "config", "tool-sources.json"
)


class TriggerDispatcher:
    """共享触发器调度器。

    每个 DCC 实例化一个，通过 dcc_name 区分日志前缀。
    """

    def __init__(self, dcc_name: str = "unknown"):
        self._dcc_name = dcc_name
        self._logger = logging.getLogger(f"artifex.{dcc_name}.trigger")
        self._last_event: Dict[str, float] = {}

    # ── 去重 ────────────────────────────────────────────────────────────

    def _is_duplicate(self, event_key: str) -> bool:
        """检查事件是否在去重窗口内重复"""
        now = time.time()
        if event_key in self._last_event:
            if now - self._last_event[event_key] < _DEDUP_WINDOW:
                return True
        self._last_event[event_key] = now
        return False

    # ── 工具源加载 ──────────────────────────────────────────────────────

    def _load_tool_sources(self) -> List[Dict]:
        """加载 tool-sources.json"""
        if not os.path.exists(_TOOL_SOURCES_PATH):
            self._logger.debug("tool-sources.json 不存在，跳过触发器")
            return []
        try:
            with open(_TOOL_SOURCES_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            self._logger.warning(f"加载 tool-sources.json 失败: {e}")
            return []

    # ── 触发器匹配 ──────────────────────────────────────────────────────

    def _find_matching_tools(self, event_type: str) -> List[Dict]:
        """查找匹配当前事件的工具"""
        sources = self._load_tool_sources()
        matching = []

        for source in sources:
            if not source.get("is_enabled", False):
                continue

            manifest_path = Path(source.get("path", "")) / "manifest.json"
            if not manifest_path.exists():
                continue

            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
            except Exception:
                continue

            triggers = manifest.get("triggers", [])
            for trigger in triggers:
                trigger_event = trigger.get("event", "")
                if trigger_event == event_type:
                    matching.append({
                        "manifest": manifest,
                        "source": source,
                        "trigger": trigger,
                        "entry": trigger.get("entry", ""),
                        "script_path": source.get("path", ""),
                    })

        return matching

    # ── 触发器执行 ──────────────────────────────────────────────────────

    def _execute_trigger_entry(self, tool: Dict) -> Optional[str]:
        """执行触发器 entry 函数"""
        try:
            script_path = tool["script_path"]
            entry_func = tool["entry"]
            manifest = tool["manifest"]

            if not script_path or not entry_func:
                return None

            # 将脚本路径加入 sys.path
            if script_path not in sys.path:
                sys.path.insert(0, script_path)

            # 动态导入并执行
            main_module_name = manifest.get("module", "main")
            try:
                mod = __import__(main_module_name, fromlist=[entry_func])
                fn = getattr(mod, entry_func)
                result = fn()
                return str(result) if result else None
            except Exception as e:
                self._logger.error(f"触发器执行失败 ({entry_func}): {e}")
                return None
        except Exception as e:
            self._logger.error(f"触发器调度异常: {e}")
            return None

    # ── 事件处理器 ──────────────────────────────────────────────────────

    def handle_post_save(self, filepath: str = "") -> None:
        """处理保存后事件"""
        event_key = f"save.{filepath}"
        if self._is_duplicate(event_key):
            return

        self._logger.info(f"触发器: file.save.post → {filepath}")
        tools = self._find_matching_tools("file.save.post")
        for tool in tools:
            self._execute_trigger_entry(tool)

    def handle_post_open(self, filepath: str = "") -> None:
        """处理打开后事件"""
        event_key = f"open.{filepath}"
        if self._is_duplicate(event_key):
            return

        self._logger.info(f"触发器: file.open.post → {filepath}")
        tools = self._find_matching_tools("file.open.post")
        for tool in tools:
            self._execute_trigger_entry(tool)
