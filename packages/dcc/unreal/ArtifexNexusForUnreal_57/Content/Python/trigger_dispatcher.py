"""
trigger_dispatcher.py — UE 内独立触发器调度引擎
================================================

在 UE Python 环境中直接完成触发器匹配与 Nexus Tool 执行，
参考 Blender BlenderTriggerDispatcher 架构，适配 UE 环境。

工作流程：
  1. 读取 ~/.artifexnexus/config/tool-sources.json
  2. 获取 sdk_path 并加入 sys.path（解析 import artifex_nexus_sdk）
  3. 扫描所有已注册工具源码目录的 manifest.json
  4. 构建 event_type → [(tool_id, execution_mode), ...] 索引
  5. 事件触发时：匹配 → import 工具 → 调用 entry 函数 → 通知

设计：
  - 工具代码直接在 UE Python 中运行，可直接使用 unreal 模块
  - 通知通过 EditorDialog（notify 模式）或 log_warning + pending 文件（silent 模式）
  - 全局开关联动 UArtifexNexusSubsystem.bTriggersEnabled
  - 工具级总闸：读取 skills.json → nexus_tools.disabled
"""

from __future__ import annotations

import fnmatch
import importlib
import inspect
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger("artifex.ue.trigger")

# UE Output Log 可见的调试输出（Python logging 在 UE 中不显示）
def _ue_log(msg: str) -> None:
    """写入 UE Output Log（级别: Log）。"""
    try:
        import unreal
        unreal.log(f"[ArtifexNexus|Trigger] {msg}")
    except Exception:
        pass


def _ue_warn(msg: str) -> None:
    """写入 UE Output Log（级别: Warning，黄色高亮）。"""
    try:
        import unreal
        unreal.log_warning(f"[ArtifexNexus|Trigger] {msg}")
    except Exception:
        pass

# ── 常量 ────────────────────────────────────────────────────────────────

TOOL_SOURCES_PATH = Path.home() / ".artifexnexus" / "config" / "tool-sources.json"
"""tool-sources.json 配置文件路径（跨进程共享）"""

SKILLS_CONFIG_PATH = Path.home() / ".artifexnexus" / "config" / "skills.json"
"""skills.json 配置文件路径（含 nexus_tools.disabled 工具总闸禁用列表）"""


# ── 配置读取（内联实现，不依赖 sidecar 的 tool_sources 模块）─────────────

def _read_tool_sources_config() -> Dict[str, Any]:
    """读取 tool-sources.json 配置文件。"""
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

    UE 无法 import artifex_nexus.core.skill_config，故直接读 JSON。
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


# ── 条件匹配 ─────────────────────────────────────────────────────────────

def _match_conditions(conditions: Dict[str, Any], asset_path: str,
                       asset_name: str, asset_class: str = "") -> bool:
    """条件匹配：path glob + typeFilter.types。空 conditions = 全部匹配。"""
    if not conditions:
        return True

    # path 条件匹配（任意一条命中即通过）
    path_conditions = conditions.get("path", [])
    if path_conditions:
        matched = False
        for pc in path_conditions:
            pattern = pc.get("pattern", "")
            if not pattern:
                continue
            base = pattern.rstrip("/*")
            if asset_path.startswith(base) or fnmatch.fnmatch(asset_path, pattern):
                matched = True
                break
        if not matched:
            return False

    # typeFilter 匹配（asset_class 在列表中即通过）
    type_filter = conditions.get("typeFilter", {})
    allowed_types = type_filter.get("types", []) if type_filter else []
    if allowed_types and asset_class:
        if asset_class not in allowed_types:
            return False

    return True


# ── UETriggerDispatcher ──────────────────────────────────────────────────

class UETriggerDispatcher:
    """UE 内部的 Nexus Tool 触发器调度引擎。

    单例模式：整个 UE 进程共享一个实例。
    """

    _instance: Optional["UETriggerDispatcher"] = None

    def __init__(self):
        # tool_id → {"dir": str, "manifest": dict, "triggers": [dict, ...]}
        self._tool_registry: Dict[str, dict] = {}
        # event_type → [(tool_id, execution_mode), ...]
        self._event_index: Dict[str, List[Tuple[str, str]]] = {}
        self._loaded = False
        self._enabled = True

        # 自动重载：追踪配置文件 mtime
        self._last_load_time: float = 0.0
        self._config_mtimes: Dict[str, float] = {}  # path → mtime (tool-sources.json, skills.json)
        self._manifest_mtimes: Dict[str, float] = {}  # path → mtime (全部已加载 manifest.json)
        self._reload_cooldown: float = 5.0  # 两次重载之间最少 5 秒

        # MCP 状态上报回调（可选，由外部注入 mcp_server）
        self._status_reporter: Optional[Callable] = None

    @classmethod
    def get_instance(cls) -> "UETriggerDispatcher":
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
        logger.info("UE 触发器系统: %s", "启用" if self._enabled else "禁用")

    def set_status_reporter(self, reporter: Optional[Callable]) -> None:
        """注入 MCP 状态上报回调。

        Args:
            reporter: callable(event_type, filepath, results) 或 None
        """
        self._status_reporter = reporter

    # ── 事件入口 ──

    def on_trigger_event(self, event_type: str, filepath: str = "",
                          data: dict = None) -> Dict[str, Any]:
        """DCC 事件入口。

        统一接口，同时支持 Pre 和 Post 事件。
        Pre 事件返回 {"blocked": bool, "reason": str} 用于拦截。
        Post 事件返回 {"executed": int, "issues": list} 用于通知。

        Args:
            event_type: 事件类型，如 "asset.save.post", "asset.save.pre"
            filepath: 资产路径
            data: 增强数据（asset_name, asset_class 等）

        Returns:
            Pre 事件: {"blocked": bool, "reason": str}
            Post 事件: {"executed": int, "issues": list}
        """
        if not self._enabled:
            _ue_log(f"触发器已禁用，跳过 event={event_type}")
            return {"blocked": False, "reason": ""}

        if data is None:
            data = {}

        timing = event_type.rsplit(".", 1)[-1] if "." in event_type else ""
        is_pre = (timing == "pre")

        # 自动重载：检测配置文件变更（用户在前端修改触发器后实时生效）
        if not self._loaded:
            self._load_tools()
        elif self._should_auto_reload():
            _ue_log("检测到配置变更，自动重载触发器注册表...")
            self.reload_tools()

        _ue_log(f"[Trigger] RECEIVED event={event_type} file={filepath}")

        # 匹配
        matched = self._match_triggers(event_type)
        if not matched:
            _ue_log(f"NO MATCH for event={event_type} file={filepath}")
            return {"blocked": False, "reason": ""} if is_pre else {"executed": 0, "issues": []}

        _ue_log(f"MATCHED {len(matched)} tool(s) for event={event_type}")

        # 构建 payload
        asset_name = data.get("asset_name", "")
        asset_class = data.get("asset_class", "")
        payload = {
            "dcc": "unreal_engine",
            "event": event_type,
            "filepath": filepath,
            "timing": timing,
            "data": data,
        }

        # 执行匹配的工具
        results = []
        blocked = False
        block_reason = ""

        for tool_id, execution_mode in matched:
            result = self._execute_tool(tool_id, payload, asset_path=filepath,
                                         asset_name=asset_name,
                                         asset_class=asset_class)
            result["execution_mode"] = execution_mode
            results.append(result)

            action = result.get("action", "allow")
            if is_pre and action == "reject":
                blocked = True
                block_reason = result.get("reason", "Blocked by trigger rule")
                break  # Pre 事件第一个 reject 即拦截

        # 通知（仅 Post 事件的 reject/error）
        if not is_pre:
            silent_issues = [r for r in results
                             if r.get("execution_mode") == "silent"
                             and r.get("action") in ("reject", "error")]
            notify_issues = [r for r in results
                             if r.get("execution_mode") != "silent"
                             and r.get("action") in ("reject", "error")]

            if silent_issues:
                self._notify_silent(silent_issues, event_type, filepath)
            if notify_issues:
                self._notify_popup(notify_issues, event_type, filepath)

        # 可选 MCP 上报
        self._report_status(event_type, filepath, results)

        if is_pre:
            return {"blocked": blocked, "reason": block_reason}
        else:
            return {
                "executed": len(results),
                "issues": [{"tool": r.get("tool_id", ""),
                            "reason": r.get("reason", "")}
                           for r in results if r.get("action") in ("reject", "error")],
            }

    # ── 工具加载 ──

    def _load_tools(self) -> None:
        """扫描所有已注册源码目录，加载 manifest 并构建事件索引。"""
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
            _ue_warn("未找到任何 manifest.json，请检查 tool-sources.json 中的源码目录")
            self._loaded = True
            return

        _ue_log(f"扫描到 {len(manifest_paths)} 个 manifest")

        # 读取工具总闸禁用列表
        disabled_tools = _get_disabled_nexus_tools()
        if disabled_tools:
            logger.info("[Trigger] user-disabled tools: %s", sorted(disabled_tools))

        # 记录所有 manifest mtime 用于自动重载检测
        self._manifest_mtimes.clear()

        for mp in manifest_paths:
            try:
                with open(mp, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
            except Exception as e:
                logger.warning("[Trigger] 跳过无效 manifest %s: %s", mp, e)
                continue

            # 记录 manifest mtime
            try:
                self._manifest_mtimes[str(mp)] = os.path.getmtime(mp)
            except OSError:
                pass

            tool_id = manifest.get("id", "")
            if not tool_id:
                continue

            # 工具总闸
            if tool_id in disabled_tools:
                logger.info("[Trigger] SKIP disabled tool=%s", tool_id)
                continue

            tool_dir = str(mp.parent)
            tool_triggers = manifest.get("triggers", [])

            # 筛选 event 类型的 unreal_engine 触发器
            matched_triggers = []
            for t in tool_triggers:
                # 兼容新旧格式
                trigger_type = t.get("triggerType") or (t.get("trigger", {}) or {}).get("type", "")
                dcc = t.get("dcc") or (t.get("trigger", {}) or {}).get("dcc", "")
                event_name = t.get("eventType") or (t.get("trigger", {}) or {}).get("event", "")
                trigger_id = t.get("id", "?")
                trigger_enabled = t.get("enabled", True)
                
                if trigger_type != "event":
                    continue
                if dcc != "unreal_engine":
                    continue
                if not event_name:
                    continue
                if not trigger_enabled:
                    _ue_log(f"SKIP disabled trigger [{trigger_id}] {event_name} (enabled=false)")
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
        _ue_log(f"已加载: {total} 个工具, {total_triggers} 条触发器规则")
        for evt, entries in self._event_index.items():
            _ue_log(f"  事件 {evt}: {[tid for tid, _ in entries]}")

        self._loaded = True
        self._last_load_time = time.time()
        # 记录配置文件 mtime 用于后续自动重载检测
        for path in [str(TOOL_SOURCES_PATH), str(SKILLS_CONFIG_PATH)]:
            try:
                self._config_mtimes[path] = os.path.getmtime(path)
            except OSError:
                pass

    def reload_tools(self) -> None:
        """重新加载工具注册表（用于工具目录变更后刷新）。"""
        self._tool_registry.clear()
        self._event_index.clear()
        self._loaded = False
        self._load_tools()

    def _should_auto_reload(self) -> bool:
        """检查配置文件是否变更，决定是否需要自动重载。

        检测 tool-sources.json + skills.json + 所有已加载 manifest.json 的 mtime。
        如果任一文件 mtime 比上次加载时新 → 需要重载。
        冷却期 5 秒防止频繁重载。
        """
        now = time.time()
        if now - self._last_load_time < self._reload_cooldown:
            return False

        config_paths = [str(TOOL_SOURCES_PATH), str(SKILLS_CONFIG_PATH)]
        for path in config_paths:
            try:
                current_mtime = os.path.getmtime(path)
                if path not in self._config_mtimes:
                    continue  # 首次加载中未记录，跳过（下次事件再检查）
                if current_mtime > self._config_mtimes[path] + 0.5:
                    _ue_log(f"配置文件变更: {path}")
                    return True
            except OSError:
                continue

        # 检查已加载的 manifest.json 是否有变更
        for mp_path, last_mtime in list(self._manifest_mtimes.items()):
            try:
                current_mtime = os.path.getmtime(mp_path)
                if current_mtime > last_mtime + 0.5:
                    _ue_log(f"Manifest 变更: {mp_path}")
                    return True
            except OSError:
                # 文件被删除等，也需要重载
                _ue_log(f"Manifest 已消失，触发重载: {mp_path}")
                return True

        return False

    # ── 触发器匹配 ──

    def _match_triggers(self, event_type: str) -> List[Tuple[str, str]]:
        """匹配 event_type 对应的 (tool_id, execution_mode) 列表。"""
        return list(self._event_index.get(event_type, []))

    # ── 工具执行 ──

    def _execute_tool(self, tool_id: str, payload: dict,
                       asset_path: str = "", asset_name: str = "",
                       asset_class: str = "") -> dict:
        """执行单个 Nexus Tool。

        在 UE Python 内动态 import 工具模块并调用 entry 函数。

        Returns:
            {"tool_id": str, "tool_name": str, "action": "allow"|"reject"|"error", "reason": str}
        """
        reg = self._tool_registry.get(tool_id)
        if not reg:
            return {"tool_id": tool_id, "tool_name": tool_id, "action": "error", "reason": "工具未注册"}

        manifest = reg["manifest"]
        tool_dir = reg["dir"]
        tool_name = manifest.get("name", tool_id)
        tool_triggers = reg["triggers"]

        # 根据 trigger 的 conditions 做文件级筛选
        for t in tool_triggers:
            use_default = t.get("useDefaultFilters", False)
            if use_default:
                conditions = manifest.get("defaultFilters", {})
            else:
                conditions = t.get("conditions", {})
            if not _match_conditions(conditions, asset_path, asset_name, asset_class):
                continue

        impl = manifest.get("implementation", {})
        entry = impl.get("entry", "main.py")
        function = impl.get("function", "main")

        # 实例工具 fallback
        entry_path = Path(tool_dir) / entry
        if not entry_path.exists():
            parent_path = manifest.get("parentPath", "")
            if parent_path and Path(parent_path).is_dir():
                logger.info("[Trigger] INSTANCE tool=%s → parent dir=%s", tool_id, parent_path)
                tool_dir = parent_path

        logger.info("[Trigger] EXECUTING tool=%s entry=%s func=%s", tool_id, entry, function)

        module_name = entry.replace(".py", "")

        paths_added = []
        if tool_dir not in sys.path:
            sys.path.insert(0, tool_dir)
            paths_added.append(tool_dir)

        try:
            if module_name in sys.modules:
                mod = importlib.reload(sys.modules[module_name])
            else:
                mod = importlib.import_module(module_name)

            fn = getattr(mod, function, None)
            if fn is None:
                return {"tool_id": tool_id, "tool_name": tool_name,
                        "action": "error", "reason": f"函数 '{function}' 未找到"}

            # 构建 event_data
            event_data = {
                "dcc_type": "unreal_engine",
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

    # ── UE 通知系统 ──

    def _notify_silent(self, issues: List[dict], event_type: str,
                        filepath: str) -> None:
        """静默模式：log_warning + pending 文件（气泡通知）。"""
        try:
            import unreal
            for issue in issues:
                tool_name = issue.get("tool_name", issue.get("tool_id", "unknown"))
                reason = issue.get("reason", "")
                unreal.log_warning(
                    f"[Artifex Nexus] {event_type}: [{tool_name}] {reason}"
                )
        except Exception:
            pass

    def _notify_popup(self, issues: List[dict], event_type: str,
                       filepath: str) -> None:
        """通知模式：EditorDialog 弹窗。"""
        try:
            import unreal
            lines = [f"事件: {event_type}"]
            if filepath:
                lines.append(f"资产: {filepath.rsplit('/', 1)[-1] if '/' in filepath else filepath}")
            lines.append("")
            for issue in issues:
                tool_name = issue.get("tool_name", issue.get("tool_id", "unknown"))
                reason = issue.get("reason", "未知错误")
                lines.append(f"[{tool_name}] {reason}")

            message = "\n".join(lines)
            unreal.EditorDialog.show_message(
                unreal.Text("Artifex Nexus — 触发器检查"),
                unreal.Text(message),
                unreal.AppMsgType.OK,
            )
        except Exception:
            # 回退到 log_warning
            self._notify_silent(issues, event_type, filepath)

    # ── 状态上报 ──

    def _report_status(self, event_type: str, filepath: str,
                        results: List[dict]) -> None:
        """可选：将执行结果通过 MCP broadcast 上报给 sidecar。"""
        if self._status_reporter is None:
            return
        try:
            self._status_reporter(event_type, filepath, results)
        except Exception:
            logger.debug("[Trigger] 状态上报失败（非关键）", exc_info=True)

    # ── 诊断 ──

    def diagnose(self) -> Dict[str, Any]:
        """返回触发器系统诊断信息。"""
        return {
            "enabled": self._enabled,
            "loaded": self._loaded,
            "tools_total": len(self._tool_registry),
            "triggers_total": sum(len(v["triggers"]) for v in self._tool_registry.values()),
            "event_index": {k: [tid for tid, _ in v] for k, v in self._event_index.items()},
            "sdk_path": _get_sdk_path(),
            "source_dirs": _get_source_dirs(),
            "config_path": str(TOOL_SOURCES_PATH),
            "disabled_tools": sorted(_get_disabled_nexus_tools()),
        }
