"""
base_adapter.py - DCC 适配层抽象接口（共享模块）
================================================

提取自 Blender addon，供所有 DCC（Blender / Maya / Max / UE / ...）复用。
每个 DCC 实现一个子类，继承 BaseDCCAdapter。

设计原则：去掉 Qt UI 集成相关方法（get_main_window / register_menu）。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, List, Optional


class BaseDCCAdapter(ABC):
    """DCC 适配层抽象接口（共享模块）"""

    def __init__(self):
        # 持久化执行命名空间：跨 execute_code 调用保持用户定义的变量
        # 每次调用时 DCC 上下文变量（S/W/L 等）会刷新为最新值，
        # 但用户自定义的变量（节点引用、helper 函数等）会保留。
        self._exec_namespace: Dict[str, Any] = {"__builtins__": __builtins__}

    def clear_exec_namespace(self) -> None:
        """清空持久化命名空间（保留 __builtins__），用于手动重置"""
        self._exec_namespace.clear()
        self._exec_namespace["__builtins__"] = __builtins__

    # ── 基础信息 ──

    @abstractmethod
    def get_software_name(self) -> str:
        """返回软件名称，如 'blender', 'maya', '3ds_max'"""

    @abstractmethod
    def get_software_version(self) -> str:
        """返回软件版本，如 '5.1', '2024'"""

    @abstractmethod
    def get_python_version(self) -> str:
        """返回内置 Python 版本"""

    # ── 生命周期 ──

    @abstractmethod
    def on_startup(self) -> None:
        """DCC 启动时调用：注册 timer、启动 MCP Server"""

    @abstractmethod
    def on_shutdown(self) -> None:
        """DCC 关闭时调用：清理资源、断开连接"""

    # ── 主线程调度 ──

    @abstractmethod
    def execute_on_main_thread(self, fn: Callable, *args) -> Any:
        """在 DCC 主线程执行函数（场景 API 安全），阻塞等待结果"""

    @abstractmethod
    def execute_deferred(self, fn: Callable, *args) -> None:
        """延迟到主线程空闲时执行（非阻塞，不等待结果）"""

    # ── 上下文采集 ──

    @abstractmethod
    def get_selected_objects(self) -> List[Dict]:
        """获取当前选中对象列表"""

    @abstractmethod
    def get_scene_info(self) -> Dict:
        """获取当前场景基本信息（场景名、对象数、帧范围等）"""

    @abstractmethod
    def get_current_file(self) -> Optional[str]:
        """获取当前文件路径"""

    # ── 代码执行 ──

    @abstractmethod
    def execute_code(self, code: str, context: Optional[Dict] = None) -> Dict:
        """
        在 DCC 环境中执行 Python 代码（万能执行器）。

        Args:
            code: Python 代码字符串
            context: 注入的上下文变量

        Returns:
            {"success": bool, "result": Any, "error": str|None, "output": str}
        """
