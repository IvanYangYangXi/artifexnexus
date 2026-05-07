"""
OpenClaw gateway 子进程管理：spawn / stop / is_running / PID 锁。

Runtime: manages the OpenClaw gateway child process lifecycle.
Spawns <cli>/bin/openclaw gateway start --port <port> with isolated env,
writes PID lock file, handles graceful shutdown (SIGTERM → 5s → SIGKILL).

关键设计决策：
- M1 不注册系统服务（不调 openclaw gateway install），由 Tauri 主进程托管
- 三件套 env 显式注入：OPENCLAW_HOME / OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH
  + OPENCLAW_NO_ONBOARD=1
- PID 锁文件：run/gateway.pid，启动时 probe pid 是否真活
- Win: taskkill /T /F，Unix: SIGTERM → 5s → SIGKILL
"""

from __future__ import annotations

import logging
import os
import platform
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    from . import _subprocess as _sp
except ImportError:  # 兼容直接以脚本方式执行
    import _subprocess as _sp  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DEFAULT_PORT = 19789
"""默认 gateway 端口。"""

SHUTDOWN_TIMEOUT = 5
"""优雅关闭超时（秒）。"""

# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class GatewayProcess:
    """Gateway 子进程句柄。

    Gateway child process handle.
    """

    pid: int
    """进程 ID。"""
    port: int
    """监听端口。"""
    message: str = ""
    """状态消息。"""


@dataclass
class VersionInfo:
    """已安装版本信息。

    Installed version info.
    """

    version: str
    """版本号。"""
    active: bool = False
    """是否为当前活动版本。"""
    installed_at: str = ""
    """安装时间 ISO 格式。"""

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "active": self.active,
            "installed_at": self.installed_at,
        }


@dataclass
class StatusReport:
    """聚合状态报告。

    Aggregated status report for openclaw.status RPC.
    """

    cli_installed: bool = False
    """CLI 是否已安装。"""
    bootstrap_done: bool = False
    """bootstrap 是否完成。"""
    gateway_running: bool = False
    """gateway 是否运行中。"""
    version: str = ""
    """当前已安装版本。"""
    supported_version: str = ""
    """Artifex Nexus 支持的 OpenClaw 版本。"""
    version_mismatch: bool = False
    """已安装版本与支持版本是否不一致。"""
    port: int = 0
    """当前端口。"""
    pid: Optional[int] = None
    """gateway 进程 PID。"""

    def to_dict(self) -> dict:
        return {
            "cli_installed": self.cli_installed,
            "bootstrap_done": self.bootstrap_done,
            "gateway_running": self.gateway_running,
            "version": self.version,
            "supported_version": self.supported_version,
            "version_mismatch": self.version_mismatch,
            "port": self.port,
            "pid": self.pid,
        }


# ---------------------------------------------------------------------------
# 平台工具
# ---------------------------------------------------------------------------


def _is_windows() -> bool:
    return _sp.is_windows()


def _find_openclaw_bin(openclaw_home: Path) -> Optional[Path]:
    """查找 openclaw 可执行文件（向后兼容 alias，转发至 :mod:`_subprocess`）。

    Backward-compatible alias preserved because tests / sibling modules
    (``web_ui.py``, ``doctor.py``) historically imported the underscored name.
    Authoritative implementation lives in ``_subprocess.find_openclaw_bin``;
    平台敏感的候选顺序见 ADR 0007。
    """
    return _sp.find_openclaw_bin(openclaw_home)


def _resolve_current_version(openclaw_home: Path) -> Optional[str]:
    """解析 cli/current 指向的版本号。

    Resolve the version pointed to by cli/current symlink or current.txt.
    """
    home = Path(openclaw_home).expanduser().resolve()
    cli_dir = home / "cli"

    # symlink
    current_link = cli_dir / "current"
    if current_link.is_symlink():
        return current_link.resolve().name

    # Win fallback
    current_txt = cli_dir / "current.txt"
    if current_txt.exists():
        try:
            return current_txt.read_text(encoding="utf-8").strip()
        except OSError:
            pass

    return None


# ---------------------------------------------------------------------------
# PID 锁文件
# ---------------------------------------------------------------------------


def _pid_file(openclaw_home: Path) -> Path:
    """返回 gateway.pid 路径。"""
    return openclaw_home.parent / "run" / "gateway.pid"


def _read_pid(openclaw_home: Path) -> Optional[int]:
    """读取 PID 锁文件。"""
    pf = _pid_file(openclaw_home)
    if not pf.exists():
        return None
    try:
        return int(pf.read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        return None


def _write_pid(openclaw_home: Path, pid: int) -> None:
    """写入 PID 锁文件。"""
    pf = _pid_file(openclaw_home)
    pf.parent.mkdir(parents=True, exist_ok=True)
    pf.write_text(str(pid), encoding="utf-8")


def _clear_pid(openclaw_home: Path) -> None:
    """清除 PID 锁文件。"""
    pf = _pid_file(openclaw_home)
    try:
        pf.unlink(missing_ok=True)
    except OSError:
        pass


def _is_pid_alive(pid: int) -> bool:
    """检查 PID 是否存活。

    Check if a process with the given PID is alive.
    """
    try:
        if _is_windows():
            # Windows: 用 tasklist 检查；CREATE_NO_WINDOW 避免每次轮询闪黑窗
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True,
                timeout=5,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
            )
            # tasklist 输出可能是非 UTF-8 编码
            try:
                stdout = result.stdout.decode("utf-8", errors="replace")
            except (UnicodeDecodeError, AttributeError):
                stdout = str(result.stdout)
            return str(pid) in stdout
        else:
            # Unix: kill -0
            os.kill(pid, 0)
            return True
    except (OSError, subprocess.TimeoutExpired):
        return False


# ---------------------------------------------------------------------------
# Gateway 进程管理
# ---------------------------------------------------------------------------

# 模块级状态：当前运行的 gateway 进程
_current_process: Optional[subprocess.Popen] = None
_current_openclaw_home: Optional[Path] = None


def start_gateway(
    openclaw_home: Path,
    port: int = DEFAULT_PORT,
) -> GatewayProcess:
    """启动 OpenClaw gateway 子进程。

    Start the OpenClaw gateway child process.

    Args:
        openclaw_home: OPENCLAW_HOME 路径。
        port: gateway 端口，默认 19789。

    Returns:
        GatewayProcess: 包含 pid 和 port。

    Raises:
        RuntimeError: CLI 未安装或启动失败。
        FileNotFoundError: openclaw 可执行文件不存在。
    """
    global _current_process, _current_openclaw_home

    home = Path(openclaw_home).expanduser().resolve()

    # 1. PID 锁检查：如果已有 pid 且存活，复用
    existing_pid = _read_pid(home)
    if existing_pid and _is_pid_alive(existing_pid):
        return GatewayProcess(
            pid=existing_pid,
            port=port,
            message="gateway 已在运行（复用现有进程）",
        )

    # 2. 查找 openclaw 可执行文件
    bin_path = _find_openclaw_bin(home)
    if not bin_path:
        raise FileNotFoundError(
            f"未找到 openclaw 可执行文件。请先运行 install。"
            f"查找路径: {home}/cli/"
        )

    # 3. 构建命令
    cmd = [str(bin_path), "gateway", "start", "--port", str(port)]

    # 4. 注入隔离环境变量（统一走 helper，保证三件套一致）
    env = _sp.build_openclaw_env(home)

    # 5. 启动子进程
    #    Win 上必须 CREATE_NO_WINDOW 避免黑窗 + CREATE_NEW_PROCESS_GROUP 便于 taskkill /T
    popen_kw = _sp.popen_kwargs(win_no_window=True, win_new_process_group=True)
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            **popen_kw,
        )
    except OSError as e:
        raise RuntimeError(f"启动 gateway 失败: {e}") from e

    # 6. 写入 PID 锁文件
    _write_pid(home, proc.pid)

    # 7. 保存模块级状态
    _current_process = proc
    _current_openclaw_home = home

    return GatewayProcess(
        pid=proc.pid,
        port=port,
        message=f"gateway 已启动 (pid={proc.pid})",
    )


def stop_gateway() -> bool:
    """停止 OpenClaw gateway 子进程。

    Stop the OpenClaw gateway child process.
    优雅关闭：SIGTERM → 5s 超时 → SIGKILL（Win: taskkill /T /F）。

    Returns:
        True 如果成功停止。
    """
    global _current_process, _current_openclaw_home

    proc = _current_process
    home = _current_openclaw_home

    if proc is None:
        # 尝试从 PID 文件读取
        if home:
            pid = _read_pid(home)
            if pid and _is_pid_alive(pid):
                _force_kill(pid)
                _clear_pid(home)
                return True
        return False

    pid = proc.pid

    # 优雅关闭
    try:
        if _is_windows():
            # Windows: taskkill /T 杀进程树；CREATE_NO_WINDOW 避免黑窗
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T"],
                capture_output=True,
                timeout=SHUTDOWN_TIMEOUT,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
            )
        else:
            proc.terminate()  # SIGTERM
            try:
                proc.wait(timeout=SHUTDOWN_TIMEOUT)
            except subprocess.TimeoutExpired:
                proc.kill()  # SIGKILL
                proc.wait(timeout=5)
    except Exception:
        # 强制杀
        _force_kill(pid)

    # 清理
    _current_process = None
    if home:
        _clear_pid(home)

    return True


def _force_kill(pid: int) -> None:
    """强制终止进程。"""
    try:
        if _is_windows():
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                timeout=5,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
            )
        else:
            os.kill(pid, signal.SIGKILL)
    except Exception:
        pass


def is_running() -> bool:
    """检查 gateway 是否运行中。

    Check if the gateway is currently running.
    """
    global _current_process, _current_openclaw_home

    # 先检查内存中的进程
    if _current_process is not None:
        poll = _current_process.poll()
        if poll is None:
            return True
        # 进程已退出，清理
        _current_process = None

    # 检查 PID 文件
    if _current_openclaw_home:
        pid = _read_pid(_current_openclaw_home)
        if pid and _is_pid_alive(pid):
            return True

    return False


# ---------------------------------------------------------------------------
# 版本管理
# ---------------------------------------------------------------------------


def list_versions(openclaw_home: Path) -> list[VersionInfo]:
    """列出 cli/ 下所有已安装版本。

    List all installed versions under cli/.
    """
    home = Path(openclaw_home).expanduser().resolve()
    cli_dir = home / "cli"

    if not cli_dir.exists():
        return []

    current_version = _resolve_current_version(home)
    versions: list[VersionInfo] = []

    for entry in sorted(cli_dir.iterdir(), reverse=True):
        if not entry.is_dir():
            continue
        if entry.name == "current":
            continue

        # 检查是否包含 openclaw 可执行文件
        bin_path = entry / "bin" / "openclaw"
        bin_cmd = entry / "bin" / "openclaw.cmd"
        if not bin_path.exists() and not bin_cmd.exists():
            continue

        # 获取安装时间
        installed_at = ""
        try:
            mtime = entry.stat().st_mtime
            import datetime
            installed_at = datetime.datetime.fromtimestamp(mtime).isoformat()
        except OSError:
            pass

        versions.append(
            VersionInfo(
                version=entry.name,
                active=(entry.name == current_version),
                installed_at=installed_at,
            )
        )

    return versions


def set_current_version(openclaw_home: Path, version: str) -> None:
    """设置 cli/current 指向指定版本。

    Set cli/current symlink (or current.txt on Windows) to point to a version.
    """
    home = Path(openclaw_home).expanduser().resolve()
    cli_dir = home / "cli"
    target = cli_dir / version

    if not target.exists():
        raise FileNotFoundError(f"版本目录不存在: {target}")

    current_link = cli_dir / "current"

    if _is_windows():
        # Windows: 尝试 mklink /D，失败则 fallback 到 current.txt
        try:
            if current_link.exists() or current_link.is_symlink():
                current_link.unlink()
            os.symlink(str(target), str(current_link), target_is_directory=True)
        except OSError:
            # Fallback: current.txt 指针文件
            current_txt = cli_dir / "current.txt"
            current_txt.write_text(version, encoding="utf-8")
    else:
        # Unix: symlink
        if current_link.exists() or current_link.is_symlink():
            current_link.unlink()
        current_link.symlink_to(target, target_is_directory=True)


# ---------------------------------------------------------------------------
# 状态聚合
# ---------------------------------------------------------------------------


def get_status(openclaw_home: Path, port: int = DEFAULT_PORT) -> StatusReport:
    """聚合状态查询。

    Aggregate status for openclaw.status RPC.
    """
    try:
        from . import installer as _installer
    except ImportError:
        import installer as _installer  # type: ignore[no-redef]

    home = Path(openclaw_home).expanduser().resolve()

    # CLI 是否安装
    bin_path = _find_openclaw_bin(home)
    cli_installed = bin_path is not None

    # bootstrap 是否完成
    try:
        from . import bootstrap as _bootstrap
    except ImportError:
        import bootstrap as _bootstrap  # type: ignore[no-redef]

    bootstrap_done = _bootstrap.is_bootstrap_done(home)

    # gateway 是否运行
    gateway_running = is_running()

    # 版本
    version = _resolve_current_version(home) or ""
    supported_version = _installer.DEFAULT_VERSION

    # 版本一致性检查：已安装版本是否与 Artifex Nexus 支持版本一致
    version_mismatch = bool(version and version != supported_version)

    # PID
    pid = _read_pid(home)

    return StatusReport(
        cli_installed=cli_installed,
        bootstrap_done=bootstrap_done,
        gateway_running=gateway_running,
        version=version,
        supported_version=supported_version,
        version_mismatch=version_mismatch,
        port=port,
        pid=pid,
    )
