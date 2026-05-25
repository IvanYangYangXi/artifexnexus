"""
Maya Adapter — Artifex Nexus 适配层实现
========================================

继承共享 SDK 的 BaseDCCAdapter，实现 Maya 专用功能。

Maya 主线程调度：
    Maya 原生支持 maya.utils.executeInMainThreadWithResult(fn, *args)，
    比 Blender 的 queue+timer 方案简单得多，无需自定义队列。

所有 maya.cmds/pymel 调用集中在此文件。
"""

from __future__ import annotations

import io
import logging
import sys
from typing import Any, Callable, Dict, List, Optional

from artifex_nexus_sdk.base_adapter import BaseDCCAdapter

logger = logging.getLogger("artifex.maya")

# ── 上下文变量名 ────────────────────────────────────────────────────────
# execute_code 注入的变量名，确保 AI 提示词与实现一致
_CTX_VARS = ["S", "W", "L", "maya", "pymel"]


class MayaAdapter(BaseDCCAdapter):
    """Maya 适配层实现"""

    def __init__(self):
        super().__init__()
        self._server = None

    def set_server(self, server):
        """注入 MCP Server 引用（供 broadcast_trigger_event 使用）"""
        self._server = server

    # ── 基础信息 ──

    def get_software_name(self) -> str:
        return "maya"

    def get_software_version(self) -> str:
        try:
            import maya.cmds as cmds
            return str(cmds.about(version=True))
        except Exception:
            return "unknown"

    def get_python_version(self) -> str:
        return sys.version.split()[0]

    # ── 生命周期 ──

    def on_startup(self) -> None:
        """Maya 启动时调用"""
        logger.info("Maya adapter 启动")

    def on_shutdown(self) -> None:
        """Maya 关闭时调用"""
        logger.info("Maya adapter 关闭")
        if self._server and self._server.is_running:
            self._server.stop()

    # ── 主线程调度 ──

    def execute_on_main_thread(self, fn: Callable, *args) -> Any:
        """在 Maya 主线程执行函数（阻塞等待结果）。

        Maya 原生支持 executeInMainThreadWithResult，无需自定义队列。
        """
        try:
            import maya.utils
            return maya.utils.executeInMainThreadWithResult(fn, *args)
        except ImportError:
            # CI 环境回退：直接调用
            return fn(*args)

    def execute_deferred(self, fn: Callable, *args) -> None:
        """延迟到 Maya 主线程空闲时执行（非阻塞）。"""
        try:
            import maya.utils
            maya.utils.executeDeferred(fn, *args)
        except ImportError:
            logger.warning("Maya utils 不可用，直接执行")
            fn(*args)

    # ── 上下文采集 ──

    def get_selected_objects(self) -> List[Dict]:
        """获取当前选中对象列表。返回 [{name, type}]"""
        try:
            import maya.cmds as cmds
            selected = cmds.ls(selection=True) or []
            result = []
            for obj in selected:
                try:
                    obj_type = cmds.objectType(obj)
                except Exception:
                    obj_type = "unknown"
                result.append({"name": obj, "type": obj_type})
            return result
        except Exception:
            return []

    def get_scene_info(self) -> Dict:
        """获取当前场景基本信息。"""
        try:
            import maya.cmds as cmds
            # 帧范围
            try:
                start_frame = cmds.playbackOptions(query=True, minTime=True)
                end_frame = cmds.playbackOptions(query=True, maxTime=True)
                current_frame = cmds.currentTime(query=True)
            except Exception:
                start_frame = end_frame = current_frame = 0.0

            # 对象统计
            try:
                all_transforms = cmds.ls(type="transform") or []
                all_meshes = cmds.ls(type="mesh") or []
            except Exception:
                all_transforms = []
                all_meshes = []

            scene_name = "untitled"
            try:
                filepath = cmds.file(query=True, sceneName=True)
                if filepath:
                    import os
                    scene_name = os.path.splitext(os.path.basename(filepath))[0]
            except Exception:
                pass

            return {
                "scene_name": scene_name,
                "object_count": len(all_transforms),
                "mesh_count": len(all_meshes),
                "frame_range": [float(start_frame), float(end_frame)],
                "current_frame": float(current_frame),
                "up_axis": "Y",
                "unit": "cm",
            }
        except Exception as e:
            return {"error": str(e)}

    def get_current_file(self) -> Optional[str]:
        """获取当前文件路径。"""
        try:
            import maya.cmds as cmds
            return cmds.file(query=True, sceneName=True) or None
        except Exception:
            return None

    # ── 代码执行 ──

    def execute_code(self, code: str, context: Optional[Dict] = None) -> Dict:
        """在 Maya 环境中执行 Python 代码。

        每次调用前刷新 S/W/L 等上下文变量到持久化命名空间。
        """
        try:
            import maya.cmds

            # 刷新上下文变量到持久化命名空间
            self._exec_namespace["S"] = maya.cmds.ls(selection=True) or []
            self._exec_namespace["W"] = self.get_current_file() or ""
            self._exec_namespace["L"] = maya.cmds
            self._exec_namespace["maya"] = maya.cmds

            # pymel 可选
            try:
                import pymel.core as pymel_core
                self._exec_namespace["pymel"] = pymel_core
            except ImportError:
                self._exec_namespace["pymel"] = None

            # 注入额外上下文
            if context:
                self._exec_namespace.update(context)

            # 捕获 stdout/stderr
            stdout = io.StringIO()
            stderr = io.StringIO()
            old_stdout = sys.stdout
            old_stderr = sys.stderr
            sys.stdout = stdout
            sys.stderr = stderr

            try:
                exec(code, self._exec_namespace)
                result = self._exec_namespace.get("result")
                success_val = True
                error_msg = None
            except Exception as e:
                result = None
                success_val = False
                error_msg = str(e)
                logger.error(f"代码执行异常: {e}")
            finally:
                sys.stdout = old_stdout
                sys.stderr = old_stderr

            output = stdout.getvalue()
            err_output = stderr.getvalue()
            if err_output and not error_msg:
                error_msg = err_output

            return {
                "success": success_val,
                "result": result,
                "error": error_msg,
                "output": output,
            }
        except Exception as e:
            return {
                "success": False,
                "result": None,
                "error": str(e),
                "output": "",
            }
