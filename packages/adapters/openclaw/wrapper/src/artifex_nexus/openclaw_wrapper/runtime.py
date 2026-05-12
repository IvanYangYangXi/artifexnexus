"""
OpenClaw gateway 子进程管理：spawn / stop / is_running / PID 锁。

Runtime: manages the OpenClaw gateway child process lifecycle.
Spawns ``<cli>/bin/openclaw gateway run --port <port>`` (foreground mode) with
isolated env, writes PID lock file, handles graceful shutdown
(SIGTERM → 5s → SIGKILL).

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
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Optional

try:
    from . import _subprocess as _sp
    from . import gateway_log as _gateway_log
    from . import gateway_state as _gateway_state
except ImportError:  # 兼容直接以脚本方式执行
    import _subprocess as _sp  # type: ignore[no-redef]
    import gateway_log as _gateway_log  # type: ignore[no-redef]
    import gateway_state as _gateway_state  # type: ignore[no-redef]

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


class PortBusyError(RuntimeError):
    """启动前检测到目标端口被非 OpenClaw 进程占用（STORY-0039）。

    Raised when the target gateway port is held by a non-OpenClaw process
    that we refuse to kill. Carries structured payload so the sidecar can
    map it to a JSON-RPC error with ``data`` for the frontend dialog.
    """

    def __init__(self, port: int, occupants: list[dict]):
        self.port = port
        # occupants = [{"pid": 12345, "name": "python.exe", "cmdline": "..."}]
        self.occupants = occupants
        sample = occupants[0] if occupants else {"pid": -1, "name": "unknown"}
        super().__init__(
            f"端口 {port} 被非 OpenClaw 进程占用 "
            f"(PID={sample.get('pid')}, name={sample.get('name')})；"
            f"请手动停止该进程或改用其它端口，Artifex Nexus 不会自动杀它。"
        )


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


def _ensure_control_ui_allowed_origins(
    bin_path: Path,
    openclaw_home: Path,
    port: int,
) -> None:
    """启动前对 ``gateway.controlUi`` 做幂等自愈：白名单 + 禁用 device auth。

    Idempotent self-heal for ``gateway.controlUi`` before each gateway start:

    - **allowedOrigins**：保证至少覆盖当前 loopback port + Tauri 内嵌 4 个 origin
    - **dangerouslyDisableDeviceAuth**：M1 本地 Tauri 部署语义为 trusted local，
      显式关闭 device pairing 握手，否则 ws 会被 1008
      "pairing required: device is not approved yet" 拒绝

    Behavior：通过 ``openclaw config get gateway.controlUi`` 读现状；任一字段缺失
    或不达标 → 计算并集 / 设默认值，统一一次 ``openclaw config patch --stdin``
    写回（尊重 schema validate + atomic write）。

    设计要点：
    - **走官方 patch 通道**：不直接写 openclaw.json 文本（AGENTS 规则）
    - **保留用户附加项**：origin 取并集；用户在面板里加的额外 origin 不丢
    - **best-effort**：任何步骤失败都仅 log warning，不阻塞 gateway 启动

    Args:
        bin_path: openclaw CLI 可执行文件路径。
        openclaw_home: OPENCLAW_HOME 路径（用于注入隔离 env）。
        port: 当前 gateway 监听端口（loopback 白名单从此派生）。
    """
    required_origins = [
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
    ]

    # STORY-0039：清理漂移过的旧 loopback 白名单条目。
    # 历史原因：旧版 bootstrap_with_port_probe 在 19789 被占时迁到 19809/19829/…，
    # 并把 http://127.0.0.1:<drift> / http://localhost:<drift> 塞进 allowedOrigins。
    # 新版固定 19789 后，这些旧条目就是死代码；必须剥掉，否则永远留着。
    # 判定规则（保守，避免误删用户面板里加的额外白名单）：
    #   scheme=http + host∈{127.0.0.1, localhost} + 非当前 port + port 属于
    #   pick_port 曾经可能选中的端口段。常量与 ports.py 对齐（此处内联避免
    #   额外 import 造成循环依赖风险）。
    _DRIFT_BASE = 19789
    _DRIFT_STEP = 20
    _DRIFT_MAX_TRIES = 5
    _drift_candidates = {
        _DRIFT_BASE + i * _DRIFT_STEP for i in range(_DRIFT_MAX_TRIES)
    }
    _drift_candidates.discard(port)  # 当前 port 白名单不能清
    _stale_loopback_origins = {
        f"http://127.0.0.1:{p}" for p in _drift_candidates
    } | {
        f"http://localhost:{p}" for p in _drift_candidates
    }

    try:
        try:
            from . import config_io as _cfg
        except ImportError:
            import config_io as _cfg  # type: ignore[no-redef]

        # 读现状
        current = _cfg._run_config_get(bin_path, openclaw_home, "gateway.controlUi")
        cur_origins: list[str] = []
        cur_enabled: Optional[bool] = None
        cur_disable_device: Optional[bool] = None
        if isinstance(current, dict):
            ao = current.get("allowedOrigins")
            if isinstance(ao, list):
                cur_origins = [str(x) for x in ao if isinstance(x, str)]
            en = current.get("enabled")
            if isinstance(en, bool):
                cur_enabled = en
            dd = current.get("dangerouslyDisableDeviceAuth")
            if isinstance(dd, bool):
                cur_disable_device = dd

        # 判定：条目齐 + 无漂移残留 + 标志位合规 → 跳过
        has_stale = any(o in _stale_loopback_origins for o in cur_origins)
        origins_ok = (
            all(o in cur_origins for o in required_origins) and not has_stale
        )
        enabled_ok = cur_enabled is not False  # None 或 True 都算 OK（schema 默认 true）
        device_ok = cur_disable_device is True
        if origins_ok and enabled_ok and device_ok:
            return

        # 1. 先剔除漂移过的旧 loopback 条目（只删匹配已知漂移段的，
        #    用户面板里加的外部 origin 不动）
        cleaned = [o for o in cur_origins if o not in _stale_loopback_origins]

        # 2. 再加上必需条目（并集），保留用户面板附加项
        merged = list(cleaned)
        for o in required_origins:
            if o not in merged:
                merged.append(o)

        if has_stale:
            dropped = [o for o in cur_origins if o in _stale_loopback_origins]
            logger.info(
                "controlUi 清理漂移白名单: %d 条 (%s)",
                len(dropped), ", ".join(dropped),
            )

        patch = {
            "gateway": {
                "controlUi": {
                    "enabled": True,
                    "allowedOrigins": merged,
                    "dangerouslyDisableDeviceAuth": True,
                }
            }
        }
        ok, err = _cfg._run_config_patch(bin_path, openclaw_home, patch)
        if ok:
            logger.info(
                "controlUi 自愈完成: origins %d→%d, deviceAuth disabled=%s→True",
                len(cur_origins),
                len(merged),
                cur_disable_device,
            )
        else:
            logger.warning("controlUi 自愈失败（已忽略）: %s", err)
    except Exception as exc:  # noqa: BLE001 - 启动期自愈不能抛
        logger.warning("controlUi 自愈抛异常（已忽略）: %s", exc)


def _pump_stream_to_log_buffer(
    stream: IO[str],
    source: str,
) -> None:
    """守护线程入口：逐行读 stdout/stderr 灌入 :func:`gateway_log.get_log_buffer`。

    Daemon thread entry: drain a child process stdout/stderr line stream into
    the global gateway log buffer. Exits naturally on EOF (gateway 退出时
    PIPE 自动关闭，``for line in stream`` 退出循环）。

    Args:
        stream: ``proc.stdout`` 或 ``proc.stderr``（``text=True`` 模式）。
        source: ``"stdout"`` 或 ``"stderr"``，写入 ``LogEntry.stream``。
    """
    buf = _gateway_log.get_log_buffer()
    try:
        for line in stream:
            text = line.strip()
            if not text:
                continue
            try:
                buf.append(source, text)  # type: ignore[arg-type]
            except Exception:
                # 单行入 buffer 失败不应弄死整条 pump 线程
                logger.debug("pump %s: append failed for line=%r", source, text)
    except (OSError, ValueError):
        # stream 已关闭等 IO 异常 → EOF 等价，安静退出
        pass
    finally:
        try:
            stream.close()
        except Exception:
            pass


def start_gateway(
    openclaw_home: Path,
    port: int = DEFAULT_PORT,
) -> GatewayProcess:
    """启动 OpenClaw gateway 子进程。

    Start the OpenClaw gateway child process.

    改造（STORY-0018 T2）：
        - ``stdout=PIPE, stderr=PIPE, bufsize=1``，spawn 后启 2 个 daemon 线程
          逐行灌 :func:`gateway_log.get_log_buffer`，供前端 ``tail_log`` RPC 拉取
        - 写 :mod:`gateway_state`（``set_running`` / ``set_errored``）供
          ``openclaw.gateway.status`` RPC 查询
        - **签名/返回值兼容**：现有调用方（doctor / sidecar.openclaw.start）
          无感知

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
        # 复用语义：sidecar 这一进程内并未 spawn，无法挂日志 pump；
        # started_at 取"sidecar 接管时间"作为近似下界（前端展示无歧义）
        _gateway_state.set_running(pid=existing_pid, port=port)
        return GatewayProcess(
            pid=existing_pid,
            port=port,
            message="gateway 已在运行（复用现有进程）",
        )

    # 2. 查找 openclaw 可执行文件
    bin_path = _find_openclaw_bin(home)
    if not bin_path:
        msg = (
            f"未找到 openclaw 可执行文件。请先运行 install。"
            f"查找路径: {home}/cli/"
        )
        _gateway_state.set_errored(msg)
        raise FileNotFoundError(msg)

    # 2.5 启动前配置自愈：保证 Control UI 浏览器白名单覆盖当前 port
    #     Pre-start config self-heal: ensure Control UI allowedOrigins covers
    #     current loopback port. Idempotent — safe to call every start.
    #     Why：v2026.5.4 Control UI 默认严格 origin 校验；当本机存在任何
    #     代理头注入（浏览器扩展/路由器透明代理）时，loopback 客户端不再被
    #     视为 local，必须命中显式白名单，否则 ws 握手 1008 origin not allowed。
    _ensure_control_ui_allowed_origins(bin_path, home, port)

    # 2.6 启动前孤儿清理：如目标端口仍被旧 openclaw 进程占用 → 强杀
    #     Pre-start orphan cleanup: kill any leftover openclaw process still
    #     holding the port. Covers:
    #     - 上次 sidecar 崩溃后的孤儿（Tauri 主进程被任务管理器强结束，
    #       sidecar 来不及收 child）
    #     - taskkill /T 未杀透留下的"端口占着但 PID 改了"残留
    #     - OpenClaw advisory lock 未释放（与端口绑定，杀进程即释放）
    #     这层与 ``--force`` 互补：``--force`` 只清 listener，不清 lockfile；
    #     这里直接杀进程，lockfile 跟着走。
    cleaned = _cleanup_orphan_gateways(port)
    if cleaned > 0:
        logger.info("启动前清理了 %d 个 openclaw 孤儿进程", cleaned)

    # 2.7 启动前硬检查：若端口仍被 **非 OpenClaw 进程**占用 → 拒绝启动、上抛
    #     PortBusyError，前端会弹窗让用户决定（STORY-0039 方案 A）。
    #     我们宁可显式失败也不偷偷换端口——端口漂移比启动失败更难排查。
    logger.info("start_gateway: 端口检查 (port=%d) ...", port)
    remaining = _list_pids_on_port(port)
    logger.info("start_gateway: _list_pids_on_port(%d) → %s", port, remaining)
    if remaining:
        occupants = [
            _describe_pid(pid)
            for pid in remaining
            if not _is_openclaw_process(pid)
        ]
        if occupants:
            msg = f"端口 {port} 被以下非 OpenClaw 进程占用，拒绝自动切换端口："
            for o in occupants:
                msg += f"\n  - PID={o['pid']} name={o['name']}"
            _gateway_state.set_errored(msg)
            raise PortBusyError(port, occupants)

    # 3. 构建命令
    #    用 "gateway run" 而不是 "gateway start"：
    #    - "gateway start"：把 gateway 安装为 OS 服务（schtasks/launchd/systemd）后 detach；
    #      Windows 无管理员权限可能直接失败；即使成功，进程也与我们 spawn 的 PIPE 解耦，
    #      pump 线程拿不到任何 stdout/stderr → 日志面板永远空。
    #    - "gateway run"：foreground 模式，gateway 直接 attach 在我们的 stdout/stderr 上，
    #      sidecar 退出时 daemon 线程 + Popen 自然回收。这是 STORY-0018 T2 设计要的模式。
    #    `--port` 是 `gateway` 父命令的选项；放在 `run` 之后可被 commander.js 正确解析
    #    （`start` 子命令解析对 `--port` 不友好，会报 unknown option）。
    #
    #    `--force` 让 OpenClaw 启动时主动 kill 占用目标端口的旧 listener，
    #    与我们 ``stop_gateway`` 里的 ``_wait_pid_dead`` 形成双保险：
    #    - sidecar 自身管理的进程：stop 时已等到死透 → spawn 时端口已释放
    #    - 异常残留（上次 sidecar 崩溃没收 / 用户手动起的 gateway）：
    #      `--force` 兜底，避免 "Port 19789 is already in use" 阻塞
    #    本地单 user 场景没有"杀别人 gateway"的风险，安全可用。
    cmd = [str(bin_path), "gateway", "run", "--port", str(port), "--force"]

    logger.info("start_gateway: 启动命令: %s", cmd)

    # 4. 注入隔离环境变量（统一走 helper，保证三件套一致）
    env = _sp.build_openclaw_env(home)

    # 5. 启动子进程
    #    Win 上必须 CREATE_NO_WINDOW 避免黑窗 + CREATE_NEW_PROCESS_GROUP 便于 taskkill /T
    #    stdout/stderr 拆 PIPE+PIPE（不再合流到 stdout）：日志 pump 线程
    #    分别带上正确的 source 标签灌进 GatewayLogBuffer
    popen_kw = _sp.popen_kwargs(win_no_window=True, win_new_process_group=True)
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,  # line-buffered（text=True 时按行 flush）
            env=env,
            **popen_kw,
        )
        logger.info("start_gateway: gateway 子进程已启动 pid=%d", proc.pid)
    except OSError as e:
        msg = f"启动 gateway 失败: {e}"
        _gateway_state.set_errored(msg)
        raise RuntimeError(msg) from e

    # 6. 写入 PID 锁文件
    _write_pid(home, proc.pid)

    # 7. 启动两个守护日志泵线程（daemon=True：sidecar 退出自动收）
    if proc.stdout is not None:
        threading.Thread(
            target=_pump_stream_to_log_buffer,
            args=(proc.stdout, "stdout"),
            name=f"gateway-log-stdout-{proc.pid}",
            daemon=True,
        ).start()
    if proc.stderr is not None:
        threading.Thread(
            target=_pump_stream_to_log_buffer,
            args=(proc.stderr, "stderr"),
            name=f"gateway-log-stderr-{proc.pid}",
            daemon=True,
        ).start()

    # 8. 保存模块级状态 + 写 gateway_state（供 status RPC 读）
    _current_process = proc
    _current_openclaw_home = home
    _gateway_state.set_running(pid=proc.pid, port=port)

    return GatewayProcess(
        pid=proc.pid,
        port=port,
        message=f"gateway 已启动 (pid={proc.pid})",
    )


def _wait_pid_dead(pid: int, timeout: float) -> bool:
    """轮询等待 PID 真的退出；返回 ``True`` = 已死，``False`` = 超时仍存活。

    Poll until the PID actually exits. Used after ``taskkill /T`` on Windows
    where the call returns immediately even though the child may take a few
    seconds to flush + exit. Without this wait, ``restart_gateway`` will
    spawn a new process before the old one releases the port → "Port already
    in use" + "gateway already running (lock timeout)" errors.
    """
    deadline = time.monotonic() + max(timeout, 0.0)
    while time.monotonic() < deadline:
        if not _is_pid_alive(pid):
            return True
        time.sleep(0.1)
    return not _is_pid_alive(pid)


def stop_gateway() -> bool:
    """停止 OpenClaw gateway 子进程。

    Stop the OpenClaw gateway child process.
    优雅关闭：SIGTERM → 5s 超时 → SIGKILL（Win: taskkill /T → 3s wait → /T /F）。

    改造（STORY-0018 hot-fix）：
        Windows 路径增加 ``_wait_pid_dead`` 等待，确保 ``stop_gateway`` 返回时
        PID 一定已退出 + 端口已释放，避免 ``restart_gateway`` 紧接 ``start_gateway``
        时遇 "Port 19789 is already in use" / "gateway already running"。

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
                _wait_pid_dead(pid, SHUTDOWN_TIMEOUT)
                _clear_pid(home)
                return True
        return False

    pid = proc.pid

    # 优雅关闭
    try:
        if _is_windows():
            # Windows: taskkill /T 杀进程树（不带 /F = 先发 WM_CLOSE 让进程优雅退出）
            # CREATE_NO_WINDOW 避免黑窗
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T"],
                capture_output=True,
                timeout=SHUTDOWN_TIMEOUT,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
            )
            # 关键：taskkill 返回不代表进程已死。轮询直到真的退出。
            if not _wait_pid_dead(pid, SHUTDOWN_TIMEOUT):
                # 超时还活着 → /F 强杀 + 再 wait 一小段
                _force_kill(pid)
                _wait_pid_dead(pid, 2.0)
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
        _wait_pid_dead(pid, 2.0)

    # 清理
    _current_process = None
    if home:
        _clear_pid(home)
    _gateway_state.set_stopped()

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


def _list_pids_on_port(port: int) -> list[int]:
    """返回所有监听指定 TCP 端口的 PID（LISTENING 状态）。

    Return PIDs holding a LISTEN socket on the given TCP port.

    Implementation:
        - Windows: parse ``netstat -ano | findstr :PORT`` (system tools, no
          extra deps)
        - POSIX: parse ``ss -ltnp`` then ``lsof -i:PORT`` as fallback

    设计要点：
        - **零外部依赖**（不用 psutil），保持 sidecar 安装面最小
        - **best-effort**：任何异常返回空列表；启动期不能因此挂起
        - **去重**：set 收集，避免 IPv4/IPv6 dual-stack 重复
    """
    pids: set[int] = set()
    try:
        if _is_windows():
            # netstat 输出（按列）：
            #   Proto  Local Addr:port  Foreign  State       PID
            #   TCP    127.0.0.1:19789  ...      LISTENING   32376
            r = subprocess.run(
                ["netstat", "-ano", "-p", "TCP"],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
                encoding="utf-8",
                errors="replace",
            )
            for line in (r.stdout or "").splitlines():
                # netstat -ano 列格式（中/英文 Win 均适用）：
                #   Proto  Local Address          Foreign Address        State           PID
                #   0      1_:   2                 3_:   4                5               6
                # 用 "LISTENING" 或 "LISTEN" 或本地化 "监听中" 三种形式
                if not ("LISTEN" in line.upper()):
                    continue
                parts = line.split()
                if len(parts) < 5:
                    continue
                local = parts[1]
                # 匹配 "host:port"，host 可能是 0.0.0.0/127.0.0.1/[::]/[::1]
                if not local.endswith(f":{port}"):
                    continue
                try:
                    pids.add(int(parts[-1]))
                except ValueError:
                    continue
        else:
            # POSIX: 优先 ss（systemd 标配），fallback lsof
            try:
                r = subprocess.run(
                    ["ss", "-ltnpH", f"sport = :{port}"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                # ss 输出含 ``users:(("node",pid=32376,fd=12))``
                import re as _re
                for line in r.stdout.splitlines():
                    for m in _re.finditer(r"pid=(\d+)", line):
                        pids.add(int(m.group(1)))
            except FileNotFoundError:
                r = subprocess.run(
                    ["lsof", "-iTCP:" + str(port), "-sTCP:LISTEN", "-P", "-n", "-Fp"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                for line in r.stdout.splitlines():
                    if line.startswith("p"):
                        try:
                            pids.add(int(line[1:]))
                        except ValueError:
                            continue
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return []

    return sorted(pids)


def _describe_pid(pid: int) -> dict:
    """尽力描述 PID：返回 ``{"pid", "name", "cmdline"}``，任一字段取不到则 ``""``。

    Best-effort process description used by :class:`PortBusyError` payload.
    Keeps the runtime module self-contained (avoid pulling psutil dependency).
    """
    name = ""
    cmdline = ""
    try:
        if _is_windows():
            r = subprocess.run(
                [
                    "wmic", "process", "where", f"ProcessId={pid}",
                    "get", "Name,CommandLine", "/format:list",
                ],
                capture_output=True, text=True, timeout=3,
                creationflags=0x08000000,
            )
            for line in (r.stdout or "").splitlines():
                line = line.strip()
                if line.lower().startswith("name="):
                    name = line.split("=", 1)[1].strip()
                elif line.lower().startswith("commandline="):
                    cmdline = line.split("=", 1)[1].strip()
        else:
            try:
                with open(f"/proc/{pid}/comm", "r", encoding="utf-8") as f:
                    name = f.read().strip()
            except (FileNotFoundError, PermissionError):
                pass
            try:
                with open(f"/proc/{pid}/cmdline", "rb") as f:
                    cmdline = f.read().replace(b"\x00", b" ").decode(
                        "utf-8", errors="ignore"
                    ).strip()
            except (FileNotFoundError, PermissionError):
                pass
    except (subprocess.TimeoutExpired, OSError):
        pass
    return {"pid": pid, "name": name, "cmdline": cmdline[:300]}


def _is_openclaw_process(pid: int) -> bool:
    """判断 PID 是否是 openclaw gateway 进程（避免误杀同端口的其它服务）。

    Check whether the given PID's command line contains "openclaw" markers.
    Used as a safety guard before ``_force_kill`` on orphan-cleanup path.

    Returns:
        True 如果 PID 命令行含 "openclaw" 关键词；False 含义包括"不是
        openclaw"、"读不到 cmdline"（保守拒杀）。
    """
    try:
        if _is_windows():
            # WMIC 已过保（Win11 后弃用），但仍可用；失败时退而求其次用 PS
            r = subprocess.run(
                [
                    "wmic", "process", "where",
                    f"ProcessId={pid}",
                    "get", "CommandLine", "/value",
                ],
                capture_output=True,
                text=True,
                timeout=3,
                creationflags=0x08000000,
            )
            cmdline = r.stdout.lower()
            if "openclaw" in cmdline:
                return True
            # WMIC 失败 fallback：PowerShell CIM
            r2 = subprocess.run(
                [
                    "powershell", "-NoProfile", "-Command",
                    f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine",
                ],
                capture_output=True,
                text=True,
                timeout=3,
                creationflags=0x08000000,
            )
            return "openclaw" in r2.stdout.lower()
        else:
            # POSIX: /proc/<pid>/cmdline 是 NUL 分隔
            try:
                with open(f"/proc/{pid}/cmdline", "rb") as f:
                    cmdline = f.read().replace(b"\x00", b" ").decode(
                        "utf-8", errors="ignore"
                    )
                return "openclaw" in cmdline.lower()
            except (FileNotFoundError, PermissionError):
                # macOS 没有 /proc，用 ps
                r = subprocess.run(
                    ["ps", "-p", str(pid), "-o", "command="],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                return "openclaw" in r.stdout.lower()
    except (subprocess.TimeoutExpired, OSError):
        return False


def _cleanup_orphan_gateways(port: int) -> int:
    """启动前清理：杀掉所有监听 ``port`` 且命令行含 "openclaw" 的残留进程。

    Pre-start orphan cleanup: kill any process listening on ``port`` whose
    command line indicates it's an OpenClaw gateway, then wait for the port
    to be released.

    设计要点：
        - **双重确认**：监听该端口 + 命令行含 openclaw → 两条件同时满足才杀
          （单纯端口冲突不杀，避免误杀用户其它服务；如端口冲突非 openclaw，
          用户应改 port 而不是被我们 silently 干掉）
        - **应对场景**：
          1. sidecar 异常崩溃留下的孤儿（无父进程回收）
          2. 上次 stop_gateway 因 taskkill 未带 /F 没真杀死的残留
          3. Tauri 窗口被强制结束（任务管理器）但 sidecar 还活着的间隙
        - 不处理用户独立安装的 OpenClaw（监听不同端口、不同安装目录）

    Returns:
        实际杀掉的孤儿数量；0 表示无残留或所有候选都不是 openclaw。
    """
    candidates = _list_pids_on_port(port)
    if not candidates:
        return 0

    killed = 0
    for pid in candidates:
        if not _is_openclaw_process(pid):
            logger.warning(
                "端口 %d 被 PID %d 占用但非 openclaw 进程，跳过（请改用其它端口或手动停止）",
                port, pid,
            )
            continue
        logger.info("发现孤儿 openclaw gateway PID=%d 占用端口 %d，清理中…", pid, port)
        _force_kill(pid)
        if _wait_pid_dead(pid, 3.0):
            killed += 1
        else:
            logger.warning("PID %d 强杀后仍未退出（可能权限不足）", pid)

    if killed:
        # 端口释放有 OS 层延迟（TIME_WAIT 等），再 poll 一会确认端口空了
        for _ in range(20):  # 最多 2s
            if not _list_pids_on_port(port):
                break
            time.sleep(0.1)

    return killed



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
