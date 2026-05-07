"""
健康检查：TCP probe + lock 文件 + 上游 doctor 三通道。

Health check: three-channel probe (TCP bind, lock file, upstream doctor).
Aggregates results into a HealthReport with overall status.

关键设计决策：
- 三通道并行探测（asyncio gather），整体超时 3s
- 通道 A：TCP bind(127.0.0.1, gateway.port) 占用探测
- 通道 B：state/lock/ 锁文件存在性 + pid 存活验证
- 通道 C：spawn openclaw doctor --non-interactive，解析退出码
- 通道 D：HTTP /healthz 端点（TBD T2 已解决：v2026.5.4 上游无 HTTP health 端点，TCP probe 已覆盖）
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import socket
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

try:
    from . import _subprocess as _sp
except ImportError:  # 兼容直接以脚本方式执行
    import _subprocess as _sp  # type: ignore[no-redef]
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DEFAULT_PORT = 19789
PROBE_TIMEOUT = 3.0
"""整体健康检查超时（秒）。"""

# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class ChannelResult:
    """单个通道的探测结果。

    Single channel probe result.
    """

    name: str
    """通道名：tcp / lock / doctor / http。"""
    healthy: bool
    """是否健康。"""
    message: str = ""
    """人类可读消息。"""
    detail: dict = field(default_factory=dict)
    """额外详情。"""


@dataclass
class HealthReport:
    """三通道健康检查聚合报告。

    Aggregated health check report.
    """

    overall: str = "unknown"
    """总体状态：healthy / degraded / down / unknown。"""
    channels: list[ChannelResult] = field(default_factory=list)
    """各通道结果。"""
    problems: list[str] = field(default_factory=list)
    """问题列表。"""
    port: int = DEFAULT_PORT
    """检查的端口。"""

    def to_dict(self) -> dict:
        return {
            "overall": self.overall,
            "channels": [
                {
                    "name": c.name,
                    "healthy": c.healthy,
                    "message": c.message,
                    "detail": c.detail,
                }
                for c in self.channels
            ],
            "problems": self.problems,
            "port": self.port,
        }


# ---------------------------------------------------------------------------
# 通道 A：TCP 端口探测
# ---------------------------------------------------------------------------


def _probe_tcp(port: int, host: str = "127.0.0.1") -> ChannelResult:
    """TCP 端口可达性探测。

    Probe TCP port reachability by attempting to connect.
    """
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2.0)
        result = sock.connect_ex((host, port))
        sock.close()

        if result == 0:
            return ChannelResult(
                name="tcp",
                healthy=True,
                message=f"端口 {port} 可达",
                detail={"host": host, "port": port},
            )
        else:
            return ChannelResult(
                name="tcp",
                healthy=False,
                message=f"端口 {port} 不可达 (errno={result})",
                detail={"host": host, "port": port, "errno": result},
            )
    except OSError as e:
        return ChannelResult(
            name="tcp",
            healthy=False,
            message=f"TCP 探测失败: {e}",
            detail={"error": str(e)},
        )


# ---------------------------------------------------------------------------
# 通道 B：Lock 文件检查
# ---------------------------------------------------------------------------


def _probe_lock(openclaw_home: Path) -> ChannelResult:
    """Lock 文件存在性 + pid 存活验证。

    Check lock file existence and pid liveness.
    """
    home = Path(openclaw_home).expanduser().resolve()
    lock_dir = home / "state" / "lock"

    if not lock_dir.exists():
        return ChannelResult(
            name="lock",
            healthy=False,
            message="lock 目录不存在（gateway 可能未启动）",
            detail={"lock_dir": str(lock_dir)},
        )

    # 检查 lock 目录下是否有文件
    lock_files = list(lock_dir.iterdir())
    if not lock_files:
        return ChannelResult(
            name="lock",
            healthy=False,
            message="lock 目录为空（gateway 可能未启动）",
            detail={"lock_dir": str(lock_dir)},
        )

    # 检查 PID 文件
    try:
        from . import runtime as _runtime
    except ImportError:
        import runtime as _runtime  # type: ignore[no-redef]

    pid = _runtime._read_pid(home)
    if pid and _runtime._is_pid_alive(pid):
        return ChannelResult(
            name="lock",
            healthy=True,
            message=f"lock 文件正常，pid={pid} 存活",
            detail={"lock_dir": str(lock_dir), "pid": pid, "files": len(lock_files)},
        )
    elif pid:
        return ChannelResult(
            name="lock",
            healthy=False,
            message=f"lock 文件存在但 pid={pid} 不存活（僵尸锁）",
            detail={"lock_dir": str(lock_dir), "pid": pid, "files": len(lock_files)},
        )
    else:
        return ChannelResult(
            name="lock",
            healthy=True,
            message=f"lock 目录存在（{len(lock_files)} 个文件），无 PID 文件",
            detail={"lock_dir": str(lock_dir), "files": len(lock_files)},
        )


# ---------------------------------------------------------------------------
# 通道 C：上游 openclaw doctor
# ---------------------------------------------------------------------------


def _probe_upstream_doctor(openclaw_home: Path) -> ChannelResult:
    """调用上游 openclaw doctor --non-interactive。

    Spawn upstream openclaw doctor --non-interactive and parse exit code.
    """
    home = Path(openclaw_home).expanduser().resolve()

    try:
        from . import runtime as _runtime
    except ImportError:
        import runtime as _runtime  # type: ignore[no-redef]

    bin_path = _runtime._find_openclaw_bin(home)
    if not bin_path:
        return ChannelResult(
            name="doctor",
            healthy=False,
            message="openclaw CLI 未安装，无法执行 doctor",
            detail={},
        )

    try:
        # 统一走 helper：Win .cmd / NO_WINDOW / UTF-8 / 三件套 env 一并处理
        result = _sp.run_openclaw(
            ["doctor", "--non-interactive"],
            home,
            bin_path=bin_path,
            timeout=15,
        )

        if result.returncode == 0:
            return ChannelResult(
                name="doctor",
                healthy=True,
                message="上游 doctor 自检通过",
                detail={"exit_code": 0, "output": result.stdout[:500]},
            )
        else:
            return ChannelResult(
                name="doctor",
                healthy=False,
                message=f"上游 doctor 自检失败 (exit={result.returncode})",
                detail={
                    "exit_code": result.returncode,
                    "stdout": result.stdout[:500],
                    "stderr": result.stderr[:500],
                },
            )
    except subprocess.TimeoutExpired:
        return ChannelResult(
            name="doctor",
            healthy=False,
            message="上游 doctor 超时（15s）",
            detail={},
        )
    except OSError as e:
        return ChannelResult(
            name="doctor",
            healthy=False,
            message=f"无法执行 doctor: {e}",
            detail={"error": str(e)},
        )


# ---------------------------------------------------------------------------
# 通道 D：HTTP 健康端点
# ---------------------------------------------------------------------------


def _probe_http_health(port: int, host: str = "127.0.0.1") -> Optional[ChannelResult]:
    """探测 HTTP /healthz 端点。

    TBD T2 已解决（2026-05-07）：实测 v2026.5.4 上游 gateway 为 WebSocket 服务，
    无 HTTP /healthz 或 /api/version 端点。TCP 端口可达即视为 HTTP 层健康。
    保留此通道用于未来版本兼容。
    """
    # v2026.5.4 上游无 HTTP health 端点，TCP probe 已覆盖
    return None


# ---------------------------------------------------------------------------
# 聚合
# ---------------------------------------------------------------------------


def _compute_overall(channels: list[ChannelResult]) -> tuple[str, list[str]]:
    """根据通道结果计算总体状态和问题列表。

    Compute overall status and problem list from channel results.
    """
    healthy_count = sum(1 for c in channels if c.healthy)
    total = len(channels)

    problems = [c.message for c in channels if not c.healthy]

    if total == 0:
        return "unknown", ["无通道结果"]

    if healthy_count == total:
        return "healthy", []
    elif healthy_count == 0:
        return "down", problems
    else:
        return "degraded", problems


def check_openclaw_health(
    openclaw_home: Path,
    port: int = DEFAULT_PORT,
) -> HealthReport:
    """三通道健康检查（同步版本）。

    Three-channel health check (synchronous version).

    Args:
        openclaw_home: OPENCLAW_HOME 路径。
        port: gateway 端口。

    Returns:
        HealthReport: 聚合健康报告。
    """
    home = Path(openclaw_home).expanduser().resolve()

    channels: list[ChannelResult] = []

    # 通道 A：TCP
    channels.append(_probe_tcp(port))

    # 通道 B：Lock 文件
    channels.append(_probe_lock(home))

    # 通道 C：上游 doctor
    channels.append(_probe_upstream_doctor(home))

    # 通道 D：HTTP 端点（TBD T2）
    http_result = _probe_http_health(port)
    if http_result:
        channels.append(http_result)

    overall, problems = _compute_overall(channels)

    return HealthReport(
        overall=overall,
        channels=channels,
        problems=problems,
        port=port,
    )


async def check_openclaw_health_async(
    openclaw_home: Path,
    port: int = DEFAULT_PORT,
) -> HealthReport:
    """三通道健康检查（异步版本，并行探测）。

    Three-channel health check (async version, parallel probes).
    """
    home = Path(openclaw_home).expanduser().resolve()

    async def _run_in_thread(func, *args):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, func, *args)

    # 并行执行三个通道
    results = await asyncio.gather(
        _run_in_thread(_probe_tcp, port),
        _run_in_thread(_probe_lock, home),
        _run_in_thread(_probe_upstream_doctor, home),
        return_exceptions=True,
    )

    channels: list[ChannelResult] = []
    for r in results:
        if isinstance(r, Exception):
            channels.append(
                ChannelResult(
                    name="error",
                    healthy=False,
                    message=f"探测异常: {r}",
                )
            )
        elif isinstance(r, ChannelResult):
            channels.append(r)

    # 通道 D
    http_result = _probe_http_health(port)
    if http_result:
        channels.append(http_result)

    overall, problems = _compute_overall(channels)

    return HealthReport(
        overall=overall,
        channels=channels,
        problems=problems,
        port=port,
    )


# ---------------------------------------------------------------------------
# 便捷函数
# ---------------------------------------------------------------------------


def is_gateway_healthy(openclaw_home: Path, port: int = DEFAULT_PORT) -> bool:
    """快速检查 gateway 是否健康（仅 TCP + lock）。

    Quick health check (TCP + lock only, no upstream doctor).
    """
    home = Path(openclaw_home).expanduser().resolve()
    tcp = _probe_tcp(port)
    lock = _probe_lock(home)
    return tcp.healthy and lock.healthy
