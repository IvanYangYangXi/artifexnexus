"""
trigger_dispatcher.py — Nexus Tool 触发器调度引擎
=================================================

从 MCPBridgeClient 接收 Blender trigger_event 广播，
加载 tools/ 中的 Nexus Tool manifest，
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
            nexus_tools_root: tools/ 目录路径（含 official/ + marketplace/）。
                             默认自动探测项目根下的 tools/ 目录。
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
        """自动探测项目根 tools/ 目录路径（含 official/ + marketplace/）。"""
        try:
            current = Path(__file__).resolve().parent  # openclaw_wrapper/
            for _ in range(10):
                if (current / "pnpm-workspace.yaml").exists():
                    candidate = current / "tools"
                    if candidate.is_dir():
                        return str(candidate)
                    break
                current = current.parent
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

        if not event_type or dcc not in ("blender", "unreal_engine"):
            logger.debug("[Trigger] SKIP: dcc=%s (非 blender / unreal_engine)", dcc)
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
        """扫描所有已注册的工具源码目录，加载 manifest 并索引 event 触发器。

        优先使用 tool-sources.json 中注册的所有源目录（bundled + skills + user），
        以 tools/ 目录作为 fallback。

        工具只需在 manifest.json 中声明 triggers 字段即可被自动发现，
        无需额外的配置文件注册步骤。
        """
        manifest_paths: list[Path] = []

        # ── 主路径：tool-sources.json（多源扫描）──
        try:
            from . import tool_sources as _ts
        except ImportError:
            try:
                import tool_sources as _ts  # type: ignore[no-redef]
            except ImportError:
                _ts = None  # type: ignore[assignment]

        if _ts is not None:
            try:
                raw_paths = _ts.get_all_manifest_paths()
                manifest_paths = [Path(p) for p in raw_paths]
                logger.info("[Trigger] tool-sources.json → %d manifests across all sources",
                            len(manifest_paths))
            except Exception as e:
                logger.warning("[Trigger] tool-sources.json 读取失败: %s", e)

        # ── Fallback：直接扫描 tools/ ──
        if not manifest_paths and self._nexus_tools_root:
            root = Path(self._nexus_tools_root)
            manifest_paths = list(root.rglob("manifest.json"))
            logger.info("[Trigger] FALLBACK: scanning nexus_tools_root=%s found=%d manifests",
                        root, len(manifest_paths))

        if not manifest_paths:
            logger.warning("[Trigger] 未找到任何工具 manifest，跳过触发器加载")
            self._loaded = True
            return

        # ── 读取用户配置：跳过被禁用的工具（工具总闸）──
        try:
            from artifex_nexus.core.skill_config import SkillConfig
            _cfg = SkillConfig()
            _disabled_tools = _cfg.get_disabled_nexus_tools()
            if _disabled_tools:
                logger.info("[Trigger] user-disabled tools: %s", _disabled_tools)
        except ImportError:
            _disabled_tools: set[str] = set()

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

            # 检查工具是否被用户禁用（工具总闸）
            if tool_id in _disabled_tools:
                logger.info("[Trigger] SKIP disabled tool=%s", tool_id)
                continue

            tool_dir = str(mp.parent)
            tool_triggers = manifest.get("triggers", [])

            # 筛选 event 类型的触发器
            matched_triggers = []
            for t in tool_triggers:
                # 优先读新格式，fallback 旧格式（兼容 Phase A 之前创建的旧实例）
                trigger_type = t.get("triggerType") or (t.get("trigger", {}) or {}).get("type", "")
                dcc = t.get("dcc") or (t.get("trigger", {}) or {}).get("dcc", "")
                event_name = t.get("eventType") or (t.get("trigger", {}) or {}).get("event", "")
                if trigger_type != "event":
                    continue
                # Dispatcher 处理 blender + unreal_engine（DCC 本地触发为主路径，此处理为备用）
                if dcc not in ("blender", "unreal_engine"):
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

            # 索引 event → tool_id
            for t in matched_triggers:
                event_name = t.get("eventType") or (t.get("trigger", {}) or {}).get("event", "")
                if event_name not in self._event_index:
                    self._event_index[event_name] = []
                self._event_index[event_name].append(tool_id)

            logger.info("[Trigger] REGISTERED tool=%s events=%s",
                         tool_id, [t.get("eventType") or (t.get("trigger", {}) or {}).get("event", "")
                                   for t in matched_triggers])

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

    @staticmethod
    def _find_project_root() -> Path:
        """探测项目根目录（向上查找 pnpm-workspace.yaml）。

        用于定位 packages/dcc/shared/artifex_nexus_sdk/（SDK 单一源）。
        """
        current = Path(__file__).resolve().parent
        for _ in range(10):
            if (current / "pnpm-workspace.yaml").exists():
                return current
            current = current.parent
        # fallback: 基于已知的 monorepo 层级计算
        return Path(__file__).resolve().parents[7]

    @staticmethod
    def _get_sdk_path() -> str:
        """返回 artifex_nexus_sdk 单一源目录的父目录。

        将 ``packages/dcc/shared/`` 加入 sys.path 后，
        工具脚本的 ``import artifex_nexus_sdk as sdk`` 可直接解析。
        """
        return str(TriggerDispatcher._find_project_root() / "packages" / "dcc" / "shared")

    def _execute_tool(self, tool_id: str, payload: dict) -> dict:
        """执行单个 Nexus Tool。

        Args:
            tool_id: 工具 GUID（e.g. "25080280-7302-46e8-80f5-4b846cd79184"）
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

        # ── Pre-flight 依赖检查 ──
        dependencies: List[str] = manifest.get("dependencies", [])
        if dependencies:
            missing = self._check_dependencies_importlib(dependencies)
            if missing:
                auto_install = self._read_auto_install_setting()
                if auto_install:
                    logger.info("[Trigger] auto_installing deps for tool=%s: %s", tool_id, missing)
                    installed, failed = self._pip_install_deps(missing)
                    if failed:
                        logger.error("[Trigger] dep install failed: %s", failed)
                        return {
                            "tool_id": tool_id, "action": "error",
                            "reason": f"依赖安装失败: {', '.join(failed)}",
                            "missing_deps": failed,
                        }
                    # 清空 import 缓存，确保下次 import 用新安装的包
                    importlib.invalidate_caches()
                    logger.info("[Trigger] deps installed: %s", installed)
                else:
                    logger.warning("[Trigger] dependencies missing for tool=%s: %s", tool_id, missing)
                    return {
                        "tool_id": tool_id, "action": "error",
                        "reason": f"依赖缺失，请在工具面板手动修复: {', '.join(missing)}",
                        "missing_deps": missing,
                    }

        # 实例工具 fallback：入口文件不在工具目录时，使用父工具目录
        # （实例工具只存 manifest（参数副本），脚本沿用父工具）
        entry_path = Path(tool_dir) / entry
        if not entry_path.exists():
            parent_path = manifest.get("parentPath", "")
            if parent_path and Path(parent_path).is_dir():
                logger.info("[Trigger] INSTANCE tool=%s → parent dir=%s", tool_id, parent_path)
                tool_dir = parent_path

        logger.info("[Trigger] EXECUTING tool=%s entry=%s func=%s", tool_id, entry, function)

        # 动态 import 工具
        module_name = entry.replace(".py", "")

        # 将工具目录和 SDK 单一源路径加入 sys.path
        # - 工具目录：用于 import main 模块
        # - packages/dcc/shared/：用于 import artifex_nexus_sdk（单一源，不再使用 bundled 副本）
        paths_added = []
        if tool_dir not in sys.path:
            sys.path.insert(0, tool_dir)
            paths_added.append(tool_dir)

        sdk_parent = self._get_sdk_path()
        if sdk_parent not in sys.path:
            sys.path.insert(0, sdk_parent)
            paths_added.append(sdk_parent)

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
            # ────────────────────────────────────────────────────────────
            # 字段约定（与 nexus_tool_watcher 的 watch 触发器对齐）：
            #   trigger_type:  "event" | "watch"
            #   trigger_id:    触发器在 manifest.triggers[] 中的 id
            #   tool_id:       工具 manifest.id
            #   event_type:    事件名（如 "asset.import.post" 或 "watch"）
            #   dcc_type:      DCC 名（仅 event 触发器有意义）
            #   timing:        "pre" | "post"
            #   asset_path/asset_name/asset_class: event 触发器便利字段
            #   data:          原始 payload.data 完整透传
            # ────────────────────────────────────────────────────────────
            event_type_payload = payload.get("event", "")
            # 查找该工具在本事件下匹配的第一个 event 触发器，拿 trigger_id
            matched_trigger_id = ""
            try:
                tool_entry = self._tool_registry.get(tool_id, {})
                for tr in tool_entry.get("triggers", []):
                    if not isinstance(tr, dict):
                        continue
                    tr_kind = tr.get("triggerType") or (tr.get("trigger") or {}).get("type")
                    tr_event = tr.get("eventType") or (tr.get("trigger") or {}).get("eventType", "")
                    if tr_kind == "event" and tr_event == event_type_payload:
                        matched_trigger_id = tr.get("id", "")
                        break
            except Exception:
                pass

            event_data = {
                "trigger_type": "event",
                "trigger_id": matched_trigger_id,
                "tool_id": tool_id,
                "dcc_type": payload.get("dcc", "blender"),
                "event_type": event_type_payload,
                "timing": payload.get("timing", "post"),
                "data": payload.get("data", {}),
            }
            # 兼容 artifex_nexus_sdk 格式
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
            for p in reversed(paths_added):
                if p in sys.path:
                    sys.path.remove(p)

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

    # ── 依赖检查与安装 ────────────────────────────────────────────────────────

    @staticmethod
    def _check_dependencies_importlib(dependencies: List[str]) -> List[str]:
        """在当前 Python 环境中检查哪些依赖不可 import。

        用于 sidecar 内联检查，避免 subprocess 开销。
        """
        missing: List[str] = []
        for dep in dependencies:
            pkg_name = dep.split(">=")[0].split("==")[0].split("<=")[0].strip()
            try:
                mod = importlib.import_module(pkg_name)
                # 版本约束检查（简单字符串比较）
                if ">=" in dep:
                    ver = dep.split(">=")[1].strip()
                    inst = getattr(mod, "__version__", None) or "0"
                    if not inst >= ver:
                        missing.append(f"{dep}（已安装: {inst}）")
                elif "==" in dep:
                    ver = dep.split("==")[1].strip()
                    inst = getattr(mod, "__version__", None) or "0"
                    if inst != ver:
                        missing.append(f"{dep}（已安装: {inst}）")
            except ImportError:
                missing.append(dep)
        return missing

    @staticmethod
    def _pip_install_deps(dependencies: List[str]) -> tuple:
        """在 sidecar Python 环境中安装依赖。

        Returns:
            (installed, failed): 成功和失败的包名列表。
        """
        import subprocess
        installed: List[str] = []
        failed: List[str] = []

        for dep in dependencies:
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "pip", "install", dep, "--quiet"],
                    capture_output=True, text=True, timeout=300,
                )
                if result.returncode == 0:
                    installed.append(dep)
                elif "permission" in (result.stderr or "").lower():
                    # --user fallback
                    result2 = subprocess.run(
                        [sys.executable, "-m", "pip", "install", dep, "--quiet", "--user"],
                        capture_output=True, text=True, timeout=300,
                    )
                    if result2.returncode == 0:
                        installed.append(dep)
                    else:
                        failed.append(dep)
                else:
                    failed.append(dep)
            except Exception:
                failed.append(dep)

        return installed, failed

    @staticmethod
    def _read_auto_install_setting() -> bool:
        """读取 app.settings.nexusToolAutoInstallDeps。"""
        try:
            from artifex_nexus.openclaw_wrapper import app_settings
            settings = app_settings.get_runtime_settings()
            return bool(settings.get("nexusToolAutoInstallDeps", False))
        except Exception:
            return False
