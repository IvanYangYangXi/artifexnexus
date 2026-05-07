"""
Gateway 进程级运行信息（state/pid/port/started_at/last_error）的 sidecar 单例存放。

Sidecar process-level singleton holding the OpenClaw gateway runtime info
(state / pid / port / started_at / last_error), consumed by the
``openclaw.gateway.status`` RPC.

设计：
    - ``GatewayState`` 字符串枚举：``running`` / ``stopped`` / ``errored``
    - ``GatewayInfo`` dataclass：上述五元组 + ``to_status_dict()`` 输出对接 spec §2.1
    - 模块级单例（线程安全），由 :func:`set_running` / :func:`set_stopped` /
      :func:`set_errored` 三个语义入口写入；:func:`get_info` 只读拷贝
    - sidecar 进程级（与 :mod:`gateway_log` 同生命周期）；进程退出 = 单例消亡

为什么单独成文：
    runtime.py 已逼近 500 行硬上限，且本模块只承载"进程信息聚合"单一职责，
    与 gateway_log.py（"日志缓冲"单一职责）风格对齐。详见 STORY-0018 T2 Q1 决策。
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field, replace
from typing import Literal, Optional

# ---------------------------------------------------------------------------
# 常量与类型
# ---------------------------------------------------------------------------

GatewayState = Literal["running", "stopped", "errored"]
"""Gateway 三态：

- ``running`` —— sidecar 持有的 Popen 对象仍存活，且写入了 pid/port/started_at
- ``stopped`` —— 从未启动，或上次 ``set_stopped()`` 显式标记
- ``errored`` —— spawn 失败、或 status RPC 探测时发现进程已退出但 PID 文件还在
"""


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GatewayInfo:
    """Gateway 运行信息快照（不可变）。

    Immutable snapshot of the gateway runtime info.

    Attributes:
        state: 三态之一。
        pid: 进程 ID；仅 ``running`` 时有值。
        port: 监听端口；仅 ``running`` 时有值。
        started_at: 启动 unix ts（秒，float）；仅 ``running`` 时有值。
        last_error: 最近一次错误摘要；仅 ``errored`` 时有值。
    """

    state: GatewayState = "stopped"
    pid: Optional[int] = None
    port: Optional[int] = None
    started_at: Optional[float] = None
    last_error: Optional[str] = None

    def to_status_dict(self, *, last_log_id: int = 0) -> dict:
        """序列化为 ``openclaw.gateway.status`` RPC 响应体。

        与 ``docs/specs/openclaw-status-panel.md`` §2.1 字段对齐。
        ``uptime_seconds`` 已去掉，由前端基于 ``started_at`` 自算。

        Args:
            last_log_id: 当前 :mod:`gateway_log` buffer 的最大 id；前端首次
                拉日志时用此值初始化 ``since_id``。
        """
        return {
            "state": self.state,
            "pid": self.pid,
            "port": self.port,
            "started_at": self.started_at,
            "last_error": self.last_error,
            "last_log_id": last_log_id,
        }


# 默认空状态：进程刚启动 sidecar、gateway 还没 spawn 时的初值
_INITIAL = GatewayInfo(state="stopped")


# ---------------------------------------------------------------------------
# 单例
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_info: GatewayInfo = _INITIAL


def get_info() -> GatewayInfo:
    """读取当前 ``GatewayInfo`` 快照。

    Snapshot read of the current gateway info (thread-safe).

    Note:
        返回的是 frozen dataclass 实例，调用方可以直接传出去；不需要再拷贝。
    """
    with _lock:
        return _info


def set_running(pid: int, port: int, *, started_at: Optional[float] = None) -> GatewayInfo:
    """标记 gateway 为 running，写入 pid/port/started_at。

    Mark gateway as running with the given pid/port. ``started_at`` defaults
    to ``time.time()`` if not provided.

    Args:
        pid: 子进程 PID。
        port: 监听端口。
        started_at: 启动时间（unix ts）；为 ``None`` 时取 ``time.time()``。

    Returns:
        写入后的 ``GatewayInfo`` 副本。
    """
    if pid <= 0:
        raise ValueError(f"pid 必须 > 0, 实际 = {pid}")
    if port <= 0:
        raise ValueError(f"port 必须 > 0, 实际 = {port}")

    eff_ts = started_at if started_at is not None else time.time()
    new = GatewayInfo(
        state="running",
        pid=pid,
        port=port,
        started_at=eff_ts,
        last_error=None,
    )
    global _info
    with _lock:
        _info = new
    return new


def set_stopped() -> GatewayInfo:
    """标记 gateway 为 stopped，清空 pid/port/started_at/last_error。

    Mark gateway as stopped; clears pid/port/started_at/last_error.
    """
    new = GatewayInfo(state="stopped")
    global _info
    with _lock:
        _info = new
    return new


def set_errored(message: str) -> GatewayInfo:
    """标记 gateway 为 errored，记录错误摘要；保留上次的 pid/port 便于排错。

    Mark gateway as errored with a short error message; keeps the previous
    pid/port for diagnostics so the UI can still show "last known PID".

    Args:
        message: 错误摘要（建议 ≤ 200 字符；调用方自行 truncate）。
    """
    global _info
    with _lock:
        prev = _info
        _info = replace(
            prev,
            state="errored",
            last_error=message,
        )
        return _info


def reset_for_test() -> None:
    """重置为初始 stopped 状态；仅供单元测试用，禁止生产代码调用。

    Reset to the initial stopped state. Test/debug helper only.
    """
    global _info
    with _lock:
        _info = _INITIAL
