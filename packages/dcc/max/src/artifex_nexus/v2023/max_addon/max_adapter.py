"""
Max Adapter — Artifex Nexus 3ds Max 适配层
============================================

继承共享 SDK 的 BaseDCCAdapter，实现 3ds Max 专用功能。

3ds Max 主线程调度：
    Max 无原生 executeInMainThreadWithResult API。
    通过 pymxs.runtime.callbacks.addScript('#timeout') 消费队列实现，
    借鉴 artclaw_bridge 的 DCCClawBridge/adapters/max_adapter.py 方案。
"""

from __future__ import annotations

import io
import logging
import queue
import sys
import threading
from typing import Any, Callable, Dict, List, Optional

from artifex_nexus_sdk.base_adapter import BaseDCCAdapter

logger = logging.getLogger("artifex.max")


class MaxAdapter(BaseDCCAdapter):
    """3ds Max 适配层实现。

    主线程调度：
        通过 pymxs.runtime.callbacks.addScript('#timeout') 定时消费
        thread-safe queue，在 Max 主线程执行函数。
    """

    def __init__(self):
        super().__init__()
        self._server = None
        self._main_thread_queue: queue.Queue = queue.Queue()
        self._results: Dict[int, Any] = {}
        self._results_lock = threading.Lock()
        self._task_id: int = 0
        self._consumer_registered = False
        self._poll_timer = None  # QTimer 引用

    def set_server(self, server):
        self._server = server

    # ── 基础信息 ──

    def get_software_name(self) -> str:
        return "3ds_max"

    def get_software_version(self) -> str:
        try:
            import pymxs
            rt = pymxs.runtime
            return str(int(rt.MaxVersion()))
        except Exception:
            return "unknown"

    def get_python_version(self) -> str:
        return sys.version.split()[0]

    # ── 生命周期 ──

    def on_startup(self) -> None:
        logger.info("Max adapter 启动")
        self._start_poll_timer()

    def on_shutdown(self) -> None:
        logger.info("Max adapter 关闭")
        if self._poll_timer is not None:
            try:
                self._poll_timer.stop()
            except Exception:
                pass
            self._poll_timer = None
        if self._server and self._server.is_running:
            self._server.stop()

    # ── 主线程调度（QTimer 轮询方案，参照 artclaw）──

    def _start_poll_timer(self):
        """启动 QTimer 轮询主线程任务队列（50ms 间隔）。

        QTimer.singleShot(0, fn) 在 Max 中不可靠，改用持久 QTimer。
        """
        if self._poll_timer is not None:
            return
        try:
            from PySide2.QtCore import QTimer
            self._poll_timer = QTimer()
            self._poll_timer.setInterval(50)
            self._poll_timer.timeout.connect(self._pump_tasks)
            self._poll_timer.start()
            logger.info("Max 主线程轮询已启动 (50ms QTimer)")
        except Exception as e:
            logger.warning(f"无法启动 QTimer 轮询: {e}")
            # fallback: 注册 timeout 回调
            self._register_timeout_fallback()

    def _register_timeout_fallback(self):
        """QTimer 不可用时的 fallback：使用 #timeout 回调"""
        if self._consumer_registered:
            return
        try:
            import pymxs
            pymxs.runtime.callbacks.addScript(
                pymxs.runtime.Name("timeout"),
                "python.execute(\"from max_adapter import _global_adapter; _global_adapter._pump_tasks()\")",
                id=pymxs.runtime.Name("artifex_max_consumer"),
            )
            self._consumer_registered = True
            logger.info("Max timeout consumer 已注册 (QTimer fallback)")
        except Exception as e:
            logger.warning(f"注册 consumer 失败: {e}")

    def _pump_tasks(self):
        """在主线程中执行队列里的所有待处理任务。"""
        while not self._main_thread_queue.empty():
            try:
                task_id, fn, args, result_event = self._main_thread_queue.get_nowait()
                result = fn(*args)
                with self._results_lock:
                    self._results[task_id] = result
                result_event.set()
            except queue.Empty:
                break
            except Exception as e:
                logger.error(f"主线程执行异常: {e}")
                # 取 task_id 用于错误报告
                try:
                    with self._results_lock:
                        self._results[task_id] = e
                    result_event.set()
                except Exception:
                    pass

    def execute_on_main_thread(self, fn: Callable, *args) -> Any:
        """在 Max 主线程执行函数（阻塞等待结果）。"""
        self._start_poll_timer()  # 确保轮询已启动
        task_id = self._task_id
        self._task_id += 1
        result_event = threading.Event()

        self._main_thread_queue.put((task_id, fn, args, result_event))

        # 等待结果（30s 超时）
        if result_event.wait(timeout=30.0):
            with self._results_lock:
                result = self._results.pop(task_id, None)
            if isinstance(result, Exception):
                raise result
            return result
        else:
            with self._results_lock:
                self._results.pop(task_id, None)
            raise TimeoutError(f"Max 主线程执行超时: {fn.__name__}")

    def execute_deferred(self, fn: Callable, *args) -> None:
        """延迟到 Max 主线程空闲时执行（非阻塞）。"""
        self._main_thread_queue.put((-1, fn, args, threading.Event()))

    # ── 上下文采集 ──

    def get_selected_objects(self) -> List[Dict]:
        try:
            import pymxs
            rt = pymxs.runtime
            result = []
            for obj in rt.selection:
                try:
                    obj_type = str(rt.classOf(obj))
                except Exception:
                    obj_type = "unknown"
                try:
                    name = obj.name
                except Exception:
                    name = str(obj)
                result.append({"name": name, "type": obj_type})
            return result
        except Exception:
            return []

    def get_scene_info(self) -> Dict:
        try:
            import pymxs
            rt = pymxs.runtime

            # 帧范围
            try:
                start_frame = rt.animationRange.start.frame
                end_frame = rt.animationRange.end.frame
                current_frame = rt.currentTime.frame
            except Exception:
                start_frame = end_frame = current_frame = 0.0

            # 对象统计
            try:
                all_objects = rt.objects
                obj_count = len(all_objects) if all_objects else 0
            except Exception:
                obj_count = 0

            scene_name = "untitled"
            try:
                filepath = rt.maxFilePath + rt.maxFileName
                if filepath:
                    import os
                    scene_name = os.path.splitext(os.path.basename(filepath))[0]
            except Exception:
                pass

            return {
                "scene_name": scene_name,
                "object_count": obj_count,
                "frame_range": [float(start_frame), float(end_frame)],
                "current_frame": float(current_frame),
                "up_axis": "Z",
                "unit": "generic",
            }
        except Exception as e:
            return {"error": str(e)}

    def get_current_file(self) -> Optional[str]:
        try:
            import pymxs
            rt = pymxs.runtime
            path = rt.maxFilePath
            name = rt.maxFileName
            if path and name:
                import os
                full = os.path.join(path, name)
                return full if full.strip() else None
            return None
        except Exception:
            return None

    # ── 代码执行 ──

    def execute_code(self, code: str, context: Optional[Dict] = None) -> Dict:
        try:
            import pymxs

            rt = pymxs.runtime

            # 刷新上下文变量到持久化命名空间
            self._exec_namespace["S"] = list(rt.selection) if rt.selection else []
            self._exec_namespace["W"] = self.get_current_file() or ""
            self._exec_namespace["L"] = rt
            self._exec_namespace["rt"] = rt
            self._exec_namespace["pymxs"] = pymxs

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


# ── 全局实例（供 #timeout 回调访问）──
_global_adapter: Optional[MaxAdapter] = None


def get_global_adapter() -> MaxAdapter:
    """获取全局 adapter 实例"""
    global _global_adapter
    if _global_adapter is None:
        _global_adapter = MaxAdapter()
    return _global_adapter
