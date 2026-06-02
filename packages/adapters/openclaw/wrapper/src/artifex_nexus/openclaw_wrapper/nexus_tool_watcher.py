"""
nexus_tool_watcher.py — Nexus Tool 文件变更监听 + watch 触发器调度
=====================================================================

两阶段机制：
  1. 轮询监听 manifest.json/source 文件变化 → 清除工具列表缓存 + 通知前端
  2. watch 触发器匹配：变化文件命中 triggers[].conditions.path 模式 → 执行工具

无外部依赖，纯 Python 轮询 + mtime 指纹对比。
"""

from __future__ import annotations

import fnmatch
import importlib.util
import json
import logging
import os
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── 通知文件模块路径 ──
_PENDING_DIR = Path.home() / ".artifexnexus" / "pending_notifications"

# ── 轮询间隔 ──
# 默认值；最终值优先来自 app.settings.nexusToolWatcherPollIntervalSec
# （用户可在「设置 → 常规」面板调节，1~300s）。
_DEFAULT_POLL_INTERVAL = 2.0  # 秒
_POLL_INTERVAL_MIN = 1.0
_POLL_INTERVAL_MAX = 300.0


def _read_poll_interval_from_settings(fallback: float = _DEFAULT_POLL_INTERVAL) -> float:
    """从 app.settings 读取用户配置的轮询周期。

    设置缺失或非法时返回 fallback。返回值已 clamp 到 [_POLL_INTERVAL_MIN, _POLL_INTERVAL_MAX]。
    """
    try:
        from artifex_nexus.openclaw_wrapper import app_settings as _app
        s = _app.get_runtime_settings()
        raw = s.get("nexusToolWatcherPollIntervalSec", fallback)
        v = float(raw)
        if v < _POLL_INTERVAL_MIN:
            v = _POLL_INTERVAL_MIN
        elif v > _POLL_INTERVAL_MAX:
            v = _POLL_INTERVAL_MAX
        return v
    except Exception as exc:
        logger.debug("[nt-watcher] read poll interval from settings failed: %s", exc)
        return fallback

# ── 目标目录 ──
_WATCH_ROOTS = [
    Path.home() / ".artifexnexus" / "nexus-tools",
]

# ── 防抖：同一工具两次触发的最小间隔 ──
_DEBOUNCE_MAP: Dict[str, float] = {}

# ── 全局单例 ──
_global_watcher: Optional["NexusToolWatcher"] = None


# ============================================================================
# 路径变量解析（与 trigger-mechanism.md 对齐）
# ============================================================================

def _resolve_path_variables() -> Dict[str, str]:
    """从 ~/.artifexnexus/config/artifexnexus.json 解析路径变量。"""
    cfg_path = Path.home() / ".artifexnexus" / "config" / "artifexnexus.json"
    project_root = ""
    try:
        if cfg_path.exists():
            cfg = json.loads(cfg_path.read_text("utf-8"))
            project_root = cfg.get("project_root", "")
    except Exception:
        pass
    return {
        "$skills_installed": str(Path.home() / ".artifexnexus" / ".openclaw" / "workspace" / "skills"),
        "$project_root": project_root,
        "$tools_dir": str(Path.home() / ".artifexnexus" / "nexus-tools"),
        "$nexus_tools_dir": str(Path.home() / ".artifexnexus" / "nexus-tools"),
        "$home": str(Path.home()),
    }


def _resolve_pattern(pattern: str, variables: Dict[str, str]) -> Optional[str]:
    """将 $variable/** 模式解析为绝对 glob 模式。"""
    for var, value in variables.items():
        if pattern.startswith(var):
            if not value:
                return None
            return pattern.replace(var, value, 1).replace("/", os.sep)
    return pattern.replace("/", os.sep)


def _match_path(actual_path: str, pattern: str) -> bool:
    """检查文件路径是否匹配 watch pattern（支持 ** 通配符）。"""
    # fnmatch 需要 Unix 风格路径
    norm_path = actual_path.replace(os.sep, "/")
    norm_pattern = pattern.replace(os.sep, "/")
    return fnmatch.fnmatch(norm_path, norm_pattern)


# ============================================================================
# Watch 触发器数据结构
# ============================================================================

class WatchTrigger:
    """单个工具的一个 watch 触发器。"""

    def __init__(
        self,
        tool_id: str,
        tool_dir: str,
        trigger_id: str,
        entry: str,
        function: str,
        debounce_ms: int,
        watch_events: List[str],
        path_patterns: List[str],
        poll_interval_sec: float,
    ):
        self.tool_id = tool_id
        self.tool_dir = tool_dir
        self.trigger_id = trigger_id
        self.entry = entry
        self.function = function
        self.debounce_ms = debounce_ms
        self.watch_events = watch_events
        self.path_patterns = path_patterns  # 已解析的绝对路径 glob 模式
        # ── per-trigger 轮询周期（秒） ──
        # 仅控制"此触发器何时被检查"，不影响主循环 tick；最小 1s，最大 300s。
        # 主循环 tick 取所有触发器中最快的一个，慢触发器通过 last_check_at 节流跳过。
        self.poll_interval_sec = max(_POLL_INTERVAL_MIN, min(_POLL_INTERVAL_MAX, float(poll_interval_sec)))
        self.last_check_at: float = 0.0  # 上次被 dispatch 的时间戳（time.time()）

    def is_due(self, now: float) -> bool:
        """是否到达自身轮询周期。首次（last_check_at=0）总是判定为到期。"""
        if self.last_check_at <= 0.0:
            return True
        return (now - self.last_check_at) >= self.poll_interval_sec

    def matches(self, filepath: str, event: str) -> bool:
        """检查文件路径是否匹配此触发器的监听范围。"""
        if event not in self.watch_events:
            return False
        return any(_match_path(filepath, p) for p in self.path_patterns)

    def __repr__(self) -> str:
        return (
            f"WatchTrigger({self.tool_id}/{self.trigger_id}, "
            f"patterns={len(self.path_patterns)}, poll={self.poll_interval_sec}s)"
        )


# ============================================================================
# 轮询监听器 + watch 触发器调度
# ============================================================================

class NexusToolWatcher:
    """Nexus Tool 目录轮询监听器 + watch 触发器调度器。

    发现文件变更时：
      1. 清除工具列表缓存 + 通知前端刷新
      2. 匹配 watch 触发器 → 执行工具
    """

    def __init__(self, poll_interval: float = _DEFAULT_POLL_INTERVAL):
        self._poll_interval = poll_interval
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._fingerprint: str = ""
        self._watch_triggers: List[WatchTrigger] = []
        # per-trigger 节流：跨重载保留 last_check_at（key=tool_id:trigger_id → ts）
        self._last_check_state: Dict[str, float] = {}
        # 等待消费的文件变化事件 [(absolute_path, event_kind, ts), ...]，60s 内保留
        self._pending_changes: List[Tuple[str, str, float]] = []

    # ── 公共 API ────────────────────────────────────────────────────────

    def start(self) -> None:
        """启动后台轮询线程。"""
        if self._running:
            return
        # 启动前从 app.settings 读取一次最新轮询周期，覆盖构造函数默认值
        self._poll_interval = _read_poll_interval_from_settings(self._poll_interval)
        self._running = True
        # 初始化指纹
        self._fingerprint = self._compute_fingerprint()
        # 加载 watch 触发器
        self._load_watch_triggers()
        self._thread = threading.Thread(
            target=self._poll_loop, daemon=True, name="nt-watcher",
        )
        self._thread.start()
        logger.info("[nt-watcher] started (interval=%.1fs, watch_triggers=%d)",
                     self._poll_interval, len(self._watch_triggers))

    def stop(self) -> None:
        """停止轮询线程。"""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=self._poll_interval + 1)
        logger.info("[nt-watcher] stopped")

    def set_poll_interval(self, interval_sec: float) -> float:
        """运行时调整全局兜底轮询周期（热更新）。

        语义说明（2026-06-02 之后）：
            - 此值是 **未在 manifest 中显式配置 pollIntervalSec 的触发器** 的兜底默认值，
              同时也作为主循环 tick 的上限（实际 tick = min(所有 trigger 的 pollIntervalSec)）。
            - 已经显式配置 pollIntervalSec 的触发器不受此值影响。

        新值在下一次 ``_load_watch_triggers`` 之后完整生效（最大延迟 ≈ 当前 tick）。
        返回 clamp 之后实际生效的值。
        """
        try:
            v = float(interval_sec)
        except (TypeError, ValueError):
            v = _DEFAULT_POLL_INTERVAL
        if v < _POLL_INTERVAL_MIN:
            v = _POLL_INTERVAL_MIN
        elif v > _POLL_INTERVAL_MAX:
            v = _POLL_INTERVAL_MAX
        old = self._poll_interval
        self._poll_interval = v
        logger.info("[nt-watcher] global default poll_interval %s → %s sec", old, v)
        # 立即重算 tick：未显式配置 pollIntervalSec 的触发器需要重新读默认
        if self._watch_triggers:
            self._load_watch_triggers()
        else:
            self._update_tick_interval()
        return v

    def _update_tick_interval(self) -> None:
        """根据所有触发器中最快的 pollIntervalSec 更新主循环 tick。

        无触发器时 tick 退回到 self._poll_interval（全局默认，本身已 clamp 过）。
        tick 总会 clamp 到 [_POLL_INTERVAL_MIN, _POLL_INTERVAL_MAX]。

        语义：触发器显式配置的 pollIntervalSec **完全覆盖** 全局默认值。
        例如全局默认 10s，但某触发器配置 1s → 主循环 tick = 1s，其他触发器
        仍按各自的 pollIntervalSec 节流（is_due）跳过。
        """
        if not self._watch_triggers:
            return  # 保持当前 self._poll_interval
        fastest = min(ft.poll_interval_sec for ft in self._watch_triggers)
        tick = max(_POLL_INTERVAL_MIN, min(_POLL_INTERVAL_MAX, fastest))
        if abs(tick - self._poll_interval) > 1e-6:
            logger.info(
                "[nt-watcher] tick adjusted to fastest trigger interval: %ss (was %ss)",
                tick, self._poll_interval,
            )
            self._poll_interval = tick

    # ── 内部：轮询主循环 ────────────────────────────────────────────────

    def _poll_loop(self) -> None:
        """轮询主循环。

        每 tick 流程：
            1. 计算文件指纹，与上一轮 diff
            2. 把变化文件追加到 self._pending_changes（保留 60s 内的事件）
            3. 文件有变化时刷新工具缓存 + 通知前端 + 重载触发器
            4. 让"已到自身周期"的触发器从 _pending_changes 中匹配并派发
            5. 按 self._poll_interval 睡眠

        per-trigger 节流不在主循环 sleep 里实现（共享指纹基础设施），
        而是在 _dispatch_watch_triggers 里通过 is_due 跳过。
        """
        while self._running:
            try:
                new_fp = self._compute_fingerprint()
                if new_fp != self._fingerprint:
                    changed = self._diff_fingerprints(self._fingerprint, new_fp)
                    self._fingerprint = new_fp
                    if changed:
                        # 1. 缓存失效 + 前端通知（每次变化都触发，不受 trigger 节流影响）
                        changed_paths = [p for p, _ in changed]
                        logger.info("[nt-watcher] %d file(s) changed", len(changed))
                        self._invalidate_cache()
                        self._notify_frontend(changed_paths)
                        # 2. 把变化追加到 pending buffer，等到期触发器消费
                        now = time.time()
                        for entry in changed:
                            self._pending_changes.append((entry[0], entry[1], now))
                        # 3. 重新加载触发器（可能有新工具安装/manifest 修改）
                        self._load_watch_triggers()

                # 4. 让到期的触发器消费 pending buffer
                self._dispatch_pending()
            except Exception as exc:
                logger.error("[nt-watcher] poll error: %s", exc, exc_info=True)
            time.sleep(self._poll_interval)

    def _dispatch_pending(self) -> None:
        """从 _pending_changes 中拿"近期未消费"的变化，喂给到期的触发器。

        清理策略：保留 60s 内的事件，避免内存泄漏。
        """
        # 60s 之外的事件丢弃
        cutoff = time.time() - 60.0
        self._pending_changes = [
            (p, ev, ts) for (p, ev, ts) in self._pending_changes if ts >= cutoff
        ]
        if not self._pending_changes:
            return
        # 派发只关心 (path, event)，不关心 ts
        changes = [(p, ev) for (p, ev, _) in self._pending_changes]
        self._dispatch_watch_triggers(changes)

    # ── 内部：指纹计算 ──────────────────────────────────────────────────

    @staticmethod
    def _compute_fingerprint() -> str:
        """计算所有 manifest.json + source 文件的路径+mtime 指纹。"""
        parts: list[str] = []
        for root in _WATCH_ROOTS:
            if not root.is_dir():
                continue
            try:
                # 扫描 manifest.json 和 Python 源码
                for pattern in ("manifest.json", "*.py", "SKILL.md"):
                    for mf in sorted(root.rglob(pattern)):
                        rel = mf.relative_to(root)
                        if len(rel.parts) > 5:
                            continue
                        try:
                            parts.append(f"{rel}:{mf.stat().st_mtime}")
                        except OSError:
                            pass
            except (OSError, PermissionError):
                continue

        # 也监听项目 tools/ 目录
        variables = _resolve_path_variables()
        project_root = variables.get("$project_root", "")
        if project_root:
            tools_src = Path(project_root) / "tools"
            if tools_src.is_dir():
                try:
                    for pattern in ("manifest.json", "*.py", "SKILL.md"):
                        for mf in sorted(tools_src.rglob(pattern)):
                            try:
                                rel = "project_tools/" + "/".join(mf.relative_to(tools_src).parts)
                                if len(rel.split("/")) > 6:
                                    continue
                                parts.append(f"{rel}:{mf.stat().st_mtime}")
                            except OSError:
                                pass
                except (OSError, PermissionError):
                    pass

        # 监听已安装 skills 目录
        skills_dir = variables.get("$skills_installed", "")
        if skills_dir:
            skills_path = Path(skills_dir)
            if skills_path.is_dir():
                try:
                    for pattern in ("SKILL.md", "manifest.json", "__init__.py", "*.py"):
                        for mf in sorted(skills_path.rglob(pattern)):
                            try:
                                rel = "skills/" + "/".join(mf.relative_to(skills_path).parts)
                                if len(rel.split("/")) > 6:
                                    continue
                                parts.append(f"{rel}:{mf.stat().st_mtime}")
                            except OSError:
                                pass
                except (OSError, PermissionError):
                    pass

        return "|".join(parts)

    @staticmethod
    def _diff_fingerprints(old_fp: str, new_fp: str) -> list[Tuple[str, str]]:
        """比较两个指纹，返回 (文件绝对路径, 事件类型) 列表。
        
        事件类型: "created" | "modified" | "deleted"
        """
        variables = _resolve_path_variables()
        old_map: Dict[str, str] = {}
        for entry in old_fp.split("|"):
            if ":" not in entry:
                continue
            path, mtime = entry.rsplit(":", 1)
            old_map[path] = mtime

        new_map: Dict[str, str] = {}
        for entry in new_fp.split("|"):
            if ":" not in entry:
                continue
            path, mtime = entry.rsplit(":", 1)
            new_map[path] = mtime

        # 解析为绝对路径
        def _to_abs(rel: str) -> str:
            if rel.startswith("project_tools/"):
                actual = rel[len("project_tools/"):]
                base = variables.get("$project_root", "")
                if base:
                    return str(Path(base) / "tools" / actual)
                return rel
            elif rel.startswith("skills/"):
                actual = rel[len("skills/"):]
                base = variables.get("$skills_installed", "")
                if base:
                    return str(Path(base) / actual)
                return rel
            else:
                # nexus-tools/ 下
                base = str(Path.home() / ".artifexnexus" / "nexus-tools")
                return str(Path(base) / rel)

        changed_files: list[Tuple[str, str]] = []
        for path in new_map:
            if path not in old_map:
                changed_files.append((_to_abs(path), "created"))
            elif old_map[path] != new_map[path]:
                changed_files.append((_to_abs(path), "modified"))
        # 检测删除：在旧指纹但不在新指纹中的文件
        for path in old_map:
            if path not in new_map:
                changed_files.append((_to_abs(path), "deleted"))

        return changed_files

    # ── 内部：watch 触发器加载 ──────────────────────────────────────────

    def _load_watch_triggers(self) -> None:
        """扫描所有工具源，加载 watch 类型触发器。"""
        triggers: List[WatchTrigger] = []
        variables = _resolve_path_variables()
        # 缺省 per-trigger 轮询周期 = 当前 watcher 的 poll_interval（已在 start 中读自 settings）。
        # 这样未配置 pollIntervalSec 的旧 manifest 也能受全局设置控制。
        global_default_poll = float(self._poll_interval) if self._poll_interval else _DEFAULT_POLL_INTERVAL

        # 查找所有 manifest.json
        manifest_paths = self._find_all_manifests()

        for mp in manifest_paths:
            try:
                with open(mp, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
            except Exception:
                continue

            tool_id = manifest.get("id", "")
            if not tool_id:
                continue

            tool_triggers = manifest.get("triggers", [])
            tool_dir = str(mp.parent)

            for tr in tool_triggers:
                if not isinstance(tr, dict):
                    continue

                trigger_type = tr.get("triggerType", "") or (
                    (tr.get("trigger", {}) or {}).get("type", "")
                )
                if trigger_type != "watch":
                    continue

                if not tr.get("enabled", True):
                    continue

                trigger_id = tr.get("id", "")
                impl = manifest.get("implementation", {})
                entry = impl.get("entry", "main.py")
                function = impl.get("function", "main")
                debounce_ms = int(tr.get("debounceMs", 3000))
                watch_events = tr.get("watchEvents", ["created", "modified"])
                use_default = tr.get("useDefaultFilters", False)

                # ── 解析 per-trigger 轮询周期 ──
                # 优先级：trigger.pollIntervalSec → app.settings 全局默认 → 模块默认 2s
                # 旧 manifest 不含 pollIntervalSec 时也能平滑工作。
                raw_poll = tr.get("pollIntervalSec", None)
                if raw_poll is None:
                    poll_sec = global_default_poll
                else:
                    try:
                        poll_sec = float(raw_poll)
                    except (TypeError, ValueError):
                        poll_sec = global_default_poll

                # 解析路径模式
                patterns: List[str] = []
                if use_default:
                    df = manifest.get("defaultFilters", {})
                    for pe in df.get("path", []):
                        pat = pe.get("pattern", "") if isinstance(pe, dict) else str(pe)
                        resolved = _resolve_pattern(pat, variables)
                        if resolved:
                            patterns.append(resolved)
                else:
                    cond = tr.get("conditions", {}) or tr.get("filters", {}) or {}
                    for pe in cond.get("path", []):
                        pat = pe.get("pattern", "") if isinstance(pe, dict) else str(pe)
                        resolved = _resolve_pattern(pat, variables)
                        if resolved:
                            patterns.append(resolved)

                if not patterns:
                    logger.warning(
                        "[nt-watcher] watch trigger %s/%s has no patterns, skip",
                        tool_id, trigger_id,
                    )
                    continue

                triggers.append(WatchTrigger(
                    tool_id=tool_id,
                    tool_dir=tool_dir,
                    trigger_id=trigger_id,
                    entry=entry,
                    function=function,
                    debounce_ms=debounce_ms,
                    watch_events=watch_events,
                    path_patterns=patterns,
                    poll_interval_sec=poll_sec,
                ))

                logger.debug("[nt-watcher] loaded watch trigger: %s/%s → %d patterns, poll=%ss",
                             tool_id, trigger_id, len(patterns), poll_sec)

        self._watch_triggers = triggers

        # 主循环 tick 取所有触发器中最快的；无触发器时退回全局默认。
        # 跨触发器迁移已注册的 last_check_at（按 tool_id+trigger_id 配对），
        # 避免 _load 重新加载时全部回到"立即触发"状态。
        prev_state: Dict[str, float] = getattr(self, "_last_check_state", {})
        for ft in self._watch_triggers:
            key = f"{ft.tool_id}:{ft.trigger_id}"
            if key in prev_state:
                ft.last_check_at = prev_state[key]
        self._last_check_state = {
            f"{ft.tool_id}:{ft.trigger_id}": ft.last_check_at
            for ft in self._watch_triggers
        }
        self._update_tick_interval()

    @staticmethod
    def _find_all_manifests() -> List[Path]:
        """查找所有工具 manifest.json（nexus-tools + project tools/）。"""
        result: List[Path] = []

        # 1. ~/.artifexnexus/nexus-tools/
        for root in _WATCH_ROOTS:
            if root.is_dir():
                try:
                    for mf in root.rglob("manifest.json"):
                        rel = mf.relative_to(root)
                        if len(rel.parts) <= 4:
                            result.append(mf)
                except (OSError, PermissionError):
                    continue

        # 2. 项目 tools/ 目录
        variables = _resolve_path_variables()
        project_root = variables.get("$project_root", "")
        if project_root:
            tools_src = Path(project_root) / "tools"
            if tools_src.is_dir():
                try:
                    for mf in tools_src.rglob("manifest.json"):
                        result.append(mf)
                except (OSError, PermissionError):
                    pass

        # 3. 已安装 skills 目录
        skills_dir = variables.get("$skills_installed", "")
        if skills_dir:
            skills_path = Path(skills_dir)
            if skills_path.is_dir():
                try:
                    for mf in skills_path.rglob("manifest.json"):
                        result.append(mf)
                except (OSError, PermissionError):
                    pass

        return result

    # ── 内部：watch 触发器匹配 + 执行 ───────────────────────────────────

    def _dispatch_watch_triggers(self, changed_files: List[Tuple[str, str]]) -> None:
        """匹配变化文件与 watch 触发器，执行命中项。

        changed_files: [(绝对路径, 事件类型), ...]
        事件类型: "created" | "modified" | "deleted"

        per-trigger 节流：只把"已到达自身轮询周期"的触发器纳入匹配，
        其他慢周期触发器在本 tick 跳过（即使主循环 tick 因更快的触发器被拉低）。
        每次到期都更新 last_check_at，无论是否真的命中。
        """
        # 必须先声明 global，再使用模块级名字 _DEBOUNCE_MAP，
        # 否则 Python 编译期会抛 SyntaxError
        # ("name '_DEBOUNCE_MAP' is used prior to global declaration")。
        global _DEBOUNCE_MAP

        if not self._watch_triggers:
            logger.debug("[nt-watcher] no watch triggers to dispatch")
            return

        now = time.time()

        # 1. per-trigger 节流：选出本 tick 应当被检查的触发器
        due_triggers = [ft for ft in self._watch_triggers if ft.is_due(now)]
        if not due_triggers:
            logger.debug("[nt-watcher] all triggers throttled this tick")
            return

        # 标记本轮到期的触发器（无论是否命中文件，都更新最近检查时间）
        for ft in due_triggers:
            ft.last_check_at = now
            self._last_check_state[f"{ft.tool_id}:{ft.trigger_id}"] = now

        # 2. 在到期触发器中匹配变化文件
        matched_triggers: list[Tuple[WatchTrigger, str, str]] = []
        for ft in due_triggers:
            for fpath, event in changed_files:
                if ft.matches(fpath, event):
                    matched_triggers.append((ft, fpath, event))
                    break  # 同一触发器每轮只计数一次

        if not matched_triggers:
            logger.debug("[nt-watcher] no watch triggers matched (%d due)", len(due_triggers))
            return

        logger.info(
            "[nt-watcher] %d watch trigger(s) matched (out of %d due)",
            len(matched_triggers), len(due_triggers),
        )

        # 3. 防抖 + 执行
        for ft, fpath, event in matched_triggers:
            key = f"{ft.tool_id}:{ft.trigger_id}"
            last = _DEBOUNCE_MAP.get(key, 0)
            if now - last < ft.debounce_ms / 1000.0:
                logger.debug("[nt-watcher] debounced: %s", key)
                continue
            _DEBOUNCE_MAP[key] = now

            self._execute_trigger(ft, fpath)

        # 定期清理过期防抖条目（>60s 未触发的 key）
        _DEBOUNCE_MAP = {k: v for k, v in _DEBOUNCE_MAP.items() if now - v < 60}

    def _execute_trigger(self, trigger: WatchTrigger, trigger_file: str) -> None:
        """执行单个 watch 触发器对应的工具。

        使用 importlib.util.spec_from_file_location 按文件路径精确加载，
        避免模块名冲突和 sys.modules 污染。
        """
        logger.info(
            "[nt-watcher] EXECUTING tool=%s trigger=%s file=%s",
            trigger.tool_id, trigger.trigger_id, trigger_file,
        )

        entry_path = Path(trigger.tool_dir) / trigger.entry
        if not entry_path.is_file():
            logger.error("[nt-watcher] entry file not found: %s", entry_path)
            return

        # 唯一模块名：避开 sys.modules 同名冲突
        module_name = f"__nt_trigger__{trigger.tool_id.replace('-', '_')}"

        # 确保 SDK 路径可用（import 时可能需要）
        sdk_parent = self._get_sdk_parent()
        paths_added = []
        if sdk_parent not in sys.path:
            sys.path.insert(0, sdk_parent)
            paths_added.append(sdk_parent)

        try:
            spec = importlib.util.spec_from_file_location(
                module_name, str(entry_path),
            )
            if spec is None or spec.loader is None:
                logger.error("[nt-watcher] cannot create module spec for %s", entry_path)
                return

            mod = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = mod
            spec.loader.exec_module(mod)

            fn = getattr(mod, trigger.function, None)
            if fn is None:
                logger.error(
                    "[nt-watcher] function %r not found in %s",
                    trigger.function, trigger.entry,
                )
                return

            result = fn()

            if isinstance(result, dict):
                success = result.get("success", True)
                message = result.get("message", "")
                if success:
                    logger.info(
                        "[nt-watcher] trigger %s SUCCESS: %s",
                        trigger.trigger_id, message,
                    )
                else:
                    error = result.get("error", message)
                    logger.warning(
                        "[nt-watcher] trigger %s FAILED: %s",
                        trigger.trigger_id, error,
                    )
                self._send_result_notification(trigger, result)

        except Exception as e:
            logger.error(
                "[nt-watcher] trigger %s execution error: %s",
                trigger.trigger_id, e, exc_info=True,
            )
        finally:
            # 清理 sys.modules 避免内存泄漏
            sys.modules.pop(module_name, None)
            for p in reversed(paths_added):
                if p in sys.path:
                    sys.path.remove(p)

    @staticmethod
    def _get_sdk_parent() -> str:
        """返回 artifex_nexus_sdk 单一源目录的父目录。"""
        current = Path(__file__).resolve().parent
        for _ in range(10):
            if (current / "pnpm-workspace.yaml").exists():
                return str(current / "packages" / "dcc" / "shared")
            current = current.parent
        return str(Path(__file__).resolve().parents[7] / "packages" / "dcc" / "shared")

    @staticmethod
    def _send_result_notification(trigger: WatchTrigger, result: dict) -> None:
        """发送触发器执行结果通知（气泡 + 铃铛）。"""
        try:
            data = result.get("data", {})
            issues_found = data.get("issues_found",
                                     (len(data.get("issues", []))
                                      if isinstance(data, dict) else 0))

            notif_type = "success"
            title = "合规检查完成"
            if issues_found > 0:
                notif_type = "warning"
                title = f"合规检查发现 {issues_found} 个问题"

            _PENDING_DIR.mkdir(parents=True, exist_ok=True)
            ts = int(time.time() * 1000)
            rand = str(uuid.uuid4())[:4]
            fpath = _PENDING_DIR / f"ntrigger_{ts}_{rand}.json"
            fpath.write_text(json.dumps({
                "type": notif_type,
                "title": title,
                "message": result.get("message", ""),
                "source": "nt-watcher",
                "timestamp": ts,
            }, ensure_ascii=False), encoding="utf-8")
            logger.info("[nt-watcher] trigger notification sent: type=%s issues=%d",
                         notif_type, issues_found)
        except Exception as exc:
            logger.error("[nt-watcher] trigger notification failed: %s", exc)

    # ── 内部：缓存失效 + 通知 ──────────────────────────────────────────

    @staticmethod
    def _invalidate_cache() -> None:
        """清除 nexus_tool_rpc 中的缓存。"""
        try:
            from artifex_nexus.openclaw_wrapper import nexus_tool_rpc as nt_rpc
            nt_rpc._refresh_cache_ts = 0.0
            try:
                nt_rpc._NT_CACHE_FILE.unlink(missing_ok=True)
            except Exception:
                pass
        except ImportError:
            pass

    @staticmethod
    def _notify_frontend(changed_files: List[str]) -> None:
        """通过 pending_notifications 通知前端工具列表变更。"""
        try:
            _PENDING_DIR.mkdir(parents=True, exist_ok=True)
            ts = int(time.time() * 1000)
            rand = str(uuid.uuid4())[:4]
            fname = f"ntool_change_{ts}_{rand}.json"
            fpath = _PENDING_DIR / fname

            # 只记录前 10 个文件，避免 payload 过大
            sample = changed_files[:10]

            payload = {
                "type": "nexus_tool_changed",
                "title": "工具变更检测",
                "message": f"检测到 {len(changed_files)} 个文件变更",
                "source": "nt-watcher",
                "timestamp": ts,
                "data": {
                    "changed_files": sample,
                    "action": "refresh_tool_list",
                },
            }
            fpath.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        except Exception as exc:
            logger.error("[nt-watcher] notify failed: %s", exc)


# ── 全局 API ──

def get_nexus_tool_watcher(
    poll_interval: float = _DEFAULT_POLL_INTERVAL,
) -> NexusToolWatcher:
    """获取全局 NexusToolWatcher 单例。"""
    global _global_watcher
    if _global_watcher is None:
        _global_watcher = NexusToolWatcher(poll_interval=poll_interval)
    return _global_watcher


def start_nexus_tool_watcher() -> None:
    """启动全局工具文件监听器 + watch 触发器调度器（由 sidecar main() 调用）。"""
    watcher = get_nexus_tool_watcher()
    watcher.start()


def stop_nexus_tool_watcher() -> None:
    """停止全局工具文件监听器。"""
    global _global_watcher
    if _global_watcher is not None:
        _global_watcher.stop()
        _global_watcher = None


def apply_settings() -> None:
    """从 app.settings 重新读取配置并应用到正在运行的 watcher（热更新）。

    由 ``app_settings.handle_app_settings_set`` 在写入设置后调用，
    使「轮询周期」等参数无需重启 sidecar 即可生效。
    若 watcher 尚未启动则静默跳过——下次 ``start()`` 会自动读取最新值。
    """
    global _global_watcher
    if _global_watcher is None:
        return
    new_interval = _read_poll_interval_from_settings()
    _global_watcher.set_poll_interval(new_interval)
