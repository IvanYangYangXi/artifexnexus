"""
artifex_nexus_logger.py - Artifex Nexus UE Logger
==================================================

独立日志模块，供 init_unreal.py 和 ue_mcp_server.py 共同引用。

将 Python 日志按分类输出到 UE Output Log：
  - LogArtifexNexus       : 通用 Agent 日志
  - LogArtifexNexus_MCP   : MCP 协议通信日志
  - LogArtifexNexus_Error : 错误与异常日志

四级日志映射：
  DEBUG   -> UE Verbose  (灰色)
  INFO    -> UE Log      (白色)
  WARNING -> UE Warning  (黄色)
  ERROR   -> UE Error    (红色)
"""

import collections
import functools
import asyncio
import threading
from datetime import datetime
import traceback

import unreal


# ============================================================================
# 日志级别常量
# ============================================================================

class _UELogLevel:
    """UE 日志级别常量，对应 ELogVerbosity"""
    DEBUG = "Verbose"
    INFO = "Log"
    WARNING = "Warning"
    ERROR = "Error"


# ============================================================================
# UE Logger 类
# ============================================================================

class UELogger:
    """
    Artifex Nexus 统一日志接口。

    将 Python 日志按分类输出到 UE Output Log。
    """

    # 分类前缀
    CATEGORY_GENERAL = "LogArtifexNexus"
    CATEGORY_MCP = "LogArtifexNexus_MCP"
    CATEGORY_ERROR = "LogArtifexNexus_Error"

    @staticmethod
    def _log(category: str, level: str, message: str):
        """
        底层日志输出，统一格式：[CATEGORY] [LEVEL] message

        使用 unreal.log / unreal.log_warning / unreal.log_error
        将消息路由到 UE Output Log。
        """
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        formatted = f"[{category}] [{level}] {timestamp} | {message}"

        if level == _UELogLevel.ERROR:
            unreal.log_error(formatted)
        elif level == _UELogLevel.WARNING:
            unreal.log_warning(formatted)
        else:
            unreal.log(formatted)

    # --- 通用 Agent 日志 ---

    @staticmethod
    def debug(message: str):
        """DEBUG 级别 (Verbose) - 详细调试信息"""
        UELogger._log(UELogger.CATEGORY_GENERAL, _UELogLevel.DEBUG, message)

    @staticmethod
    def info(message: str):
        """INFO 级别 (Log) - 常规信息"""
        UELogger._log(UELogger.CATEGORY_GENERAL, _UELogLevel.INFO, message)

    @staticmethod
    def warning(message: str):
        """WARNING 级别 - 警告信息"""
        UELogger._log(UELogger.CATEGORY_GENERAL, _UELogLevel.WARNING, message)

    @staticmethod
    def error(message: str):
        """ERROR 级别 - 错误信息"""
        UELogger._log(UELogger.CATEGORY_ERROR, _UELogLevel.ERROR, message)

    # --- MCP 通信日志 ---

    @staticmethod
    def mcp(message: str, level: str = _UELogLevel.INFO):
        """MCP 通信专用日志，默认 INFO 级别"""
        UELogger._log(UELogger.CATEGORY_MCP, level, message)

    @staticmethod
    def mcp_error(message: str):
        """MCP 通信错误日志"""
        UELogger._log(UELogger.CATEGORY_MCP, _UELogLevel.ERROR, message)
        UELogger._log(UELogger.CATEGORY_ERROR, _UELogLevel.ERROR, f"[MCP] {message}")

    # --- 异常日志 ---

    @staticmethod
    def exception(message: str = ""):
        """
        记录当前异常的完整堆栈，以红色高亮显示。

        包含文件名、行号、函数名。
        """
        exc_info = traceback.format_exc()
        prefix = f"{message} | " if message else ""
        UELogger._log(
            UELogger.CATEGORY_ERROR,
            _UELogLevel.ERROR,
            f"{prefix}Exception:\n{exc_info}"
        )


# ============================================================================
# MCP 调用装饰器
# ============================================================================

def log_mcp_call(func):
    """
    MCP 调用装饰器：自动记录请求/响应到 LogArtifexNexus_MCP 分类。

    支持同步函数和异步协程函数。

    用法::

        @log_mcp_call
        def handle_tool_call(method, params):
            ...

        @log_mcp_call
        async def async_handle_tool_call(method, params):
            ...
    """
    # 判断是否是协程函数
    if asyncio.iscoroutinefunction(func):
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            func_name = func.__name__
            # 检测 ping 消息：检查字符串参数中是否包含 "ping" method
            is_ping = False
            for arg in args:
                if isinstance(arg, str) and '"method":"ping"' in arg.replace(' ', ''):
                    is_ping = True
                    break
            # ping 消息静默跳过，不输出任何日志
            if is_ping:
                return await func(*args, **kwargs)
            UELogger.mcp(f">>> {func_name} called | args={args}, kwargs={kwargs}")
            try:
                result = await func(*args, **kwargs)
                UELogger.mcp(f"<<< {func_name} returned | result={result}")
                return result
            except Exception as e:
                UELogger.mcp_error(f"!!! {func_name} raised {type(e).__name__}: {e}")
                raise
        return async_wrapper
    else:
        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            func_name = func.__name__
            UELogger.mcp(f">>> {func_name} called | args={args}, kwargs={kwargs}")
            try:
                result = func(*args, **kwargs)
                UELogger.mcp(f"<<< {func_name} returned | result={result}")
                return result
            except Exception as e:
                UELogger.mcp_error(f"!!! {func_name} raised {type(e).__name__}: {e}")
                raise
        return sync_wrapper


# ============================================================================
# PanelLogger — 面板可见的日志环缓冲区
# ============================================================================

class PanelLogger:
    """
    线程安全的环缓冲区日志，供 UE 编辑器面板 UI 读取显示。

    特性:
      - 连续重复日志自动折叠：相同 (category, message) 的连续条目合并为 "×N"
      - 环缓冲区上限 300 条（合并后），避免面板 UI 卡顿
      - 线程安全：所有读写操作持有 Lock

    用法::

        from artifex_nexus_logger import PanelLogger
        PanelLogger.emit("PIP", "Installing cryptography...")
        PanelLogger.emit("MCP", "Server started on port 18080")

    读取::

        from artifex_nexus_logger import PanelLogger
        lines = PanelLogger.get_recent(100)  # 最近 100 条（已展开重复计数）
    """
    _lock = threading.Lock()
    _buffer: "collections.deque" = collections.deque(maxlen=300)

    # 去重状态
    _last_key = None       # (category, message) of last emitted entry
    _last_count = 0        # consecutive repeat count
    _last_ts = ""          # timestamp of last repeat update

    _MAX_BUFFER = 300

    @classmethod
    def emit(cls, category: str, message: str, level: str = _UELogLevel.INFO):
        """
        写入一条面板日志（同时输出到 UE Output Log）。

        连续相同 (category, message) 的日志会在面板中折叠显示为 "×N"，
        但每条仍会输出到 UE Output Log（不做去重），方便在 Output Log 中
        排查时序问题。

        Args:
            category: 日志分类（PIP, MCP, MCP_CONNECT, MCP_SCRIPT, SYSTEM 等）
            message: 日志内容
            level: UE 日志级别
        """
        ts = datetime.now().strftime("%H:%M:%S")
        entry_key = (category, message)

        with cls._lock:
            if cls._last_key == entry_key:
                # 连续重复 → 更新最后一条的折叠计数
                cls._last_count += 1
                cls._last_ts = ts
                if cls._buffer:
                    cls._buffer[-1] = (
                        f"[{ts}] [{category}] {message}"
                        f"  (×{cls._last_count})"
                    )
            else:
                cls._last_key = entry_key
                cls._last_count = 1
                cls._last_ts = ts
                cls._buffer.append(f"[{ts}] [{category}] {message}")

        # 每条都输出到 UE Output Log（不去重）
        UELogger._log(UELogger.CATEGORY_GENERAL, level, f"[Panel|{category}] {message}")

    @classmethod
    def get_recent(cls, count: int = 100) -> list:
        """获取最近 N 条日志（已含折叠计数）"""
        with cls._lock:
            items = list(cls._buffer)
        return items[-count:]

    @classmethod
    def get_all(cls) -> str:
        """获取全部日志，以换行符分隔的字符串"""
        with cls._lock:
            return "\n".join(cls._buffer)

    @classmethod
    def clear(cls):
        """清空日志缓冲（同时重置去重状态）"""
        with cls._lock:
            cls._buffer.clear()
            cls._last_key = None
            cls._last_count = 0
