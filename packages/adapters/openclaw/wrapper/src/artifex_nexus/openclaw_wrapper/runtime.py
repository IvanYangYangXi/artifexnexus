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


def _gateway_log_file(openclaw_home: Path) -> Path:
    """返回 gateway 持久化日志文件路径。
    用于 Gateway 崩溃后事后追查（内存 log buffer 不够）。"""
    log_dir = openclaw_home.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / "gateway.log"


def _audit_log(reason: str, detail: str = "") -> None:
    """v4.1.6 新增：记录 sidecar 主动操作 gateway 的审计日志。

    同时写入：
      - sys.stderr（→ sidecar-stderr-*.log）
      - gateway.log（→ 与 Gateway 自身日志同文件，便于事后排查"谁杀的 gateway"）

    Args:
        reason: 操作原因（如 "STOP_GATEWAY:idle_timeout", "FORCE_KILL:port_busy"）
        detail: 额外细节（pid, caller frame 等）
    """
    import datetime
    import traceback as _tb
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    # 抓上一级调用栈（跳过 _audit_log 自身和直接调用方）
    stack = _tb.extract_stack(limit=4)
    callers = []
    for frame in stack[:-1]:  # 排除当前 frame
        callers.append(f"{Path(frame.filename).name}:{frame.lineno}:{frame.name}")
    caller_chain = " ← ".join(callers[-3:])  # 取最后 3 层
    line = f"[sidecar.audit] {ts} {reason} | {detail} | stack={caller_chain}"
    # 写 stderr（sidecar-stderr-*.log 会捕获）
    try:
        sys.stderr.write(line + "\n")
        sys.stderr.flush()
    except Exception:
        pass
    # 写 gateway.log（与 Gateway 自身日志同文件，时间线对齐）
    home = _current_openclaw_home
    if home:
        try:
            log_file_path = _gateway_log_file(home)
            with open(log_file_path, "a", encoding="utf-8") as f:
                f.write(f"{ts} [sidecar.audit] {reason} | {detail}\n")
                f.flush()
        except Exception:
            pass


def _sidecar_marker_file(openclaw_home: Path) -> Path:
    """返回 sidecar 实例标记文件（独立于 PID 文件，防复用误判）。"""
    return openclaw_home.parent / "run" / "sidecar.instance"


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
    """写入 PID 锁文件，同时写入 sidecar 实例标记。"""
    import os as _os
    pf = _pid_file(openclaw_home)
    pf.parent.mkdir(parents=True, exist_ok=True)
    pf.write_text(str(pid), encoding="utf-8")
    # 写入 sidecar 实例标记（含 PID + 启动时间，用于检测 sidecar 重启）
    sf = _sidecar_marker_file(openclaw_home)
    sf.parent.mkdir(parents=True, exist_ok=True)
    sf.write_text(f"{_os.getpid()}\n{time.time()}", encoding="utf-8")


def _is_current_sidecar_instance(openclaw_home: Path) -> bool:
    """判断当前运行的 sidecar 是否就是创建 gateway 的那个实例。

    2026-05-13 P1-8 修复：sidecar 重启后，旧 gateway 进程可能仍在运行，
    但 pump 线程（stdout/stderr → log buffer）已随旧 sidecar 死亡。
    新 sidecar 无法 attach 到旧进程的 PIPE，导致日志面板永远空。
    此函数用于检测"我是不是原始 sidecar"，若否则应强制重启 gateway。
    """
    import os as _os
    sf = _sidecar_marker_file(openclaw_home)
    if not sf.exists():
        return False
    try:
        lines = sf.read_text(encoding="utf-8").strip().split("\n")
        if len(lines) < 1:
            return False
        recorded_pid = int(lines[0].strip())
        return recorded_pid == _os.getpid()
    except (ValueError, OSError, IndexError):
        return False


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

    .. note::
        本函数 **只判活，不验身份**。Windows 的 PID 在进程结束后会被
        快速回收复用——如果某次 OpenClaw Gateway crash 没清 PID 锁，
        这个 PID 可能已经被另一个完全不相关的程序（VS Code、chrome.exe
        甚至 Tauri 自己）占用，导致 :func:`is_running` 误报 true。
        想知道 "PID 是不是 OpenClaw Gateway" 请用 :func:`_is_openclaw_gateway_pid`。
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
    except (OSError, subprocess.TimeoutExpired) as e:
        logger.debug("_is_pid_alive: check failed pid=%d: %s", pid, e)
        return False


def _is_openclaw_gateway_pid(pid: int) -> bool:
    """校验 PID 真是 OpenClaw Gateway 进程（不只是个活进程）。

    Verify that the given PID is **actually** an OpenClaw Gateway process,
    not a stale PID lock pointing to a recycled PID owned by another app.

    Why（2026-05-12 修复）：
        之前 :func:`is_running` 只用 :func:`_is_pid_alive` 判活——但 Windows
        进程 ID 回收很快，PID 锁文件里的 PID 完全可能指向某个完全无关的
        chrome.exe / Code.exe / 甚至 tauri 子进程。结果 sidecar 报告
        ``gateway_running=true``，前端走"已运行"分支不调 ``startGateway``，
        但实际 19789 端口空着 / Gateway 根本没活——遮罩不会卡，但 ChatView
        WS 握手立刻失败，用户体验极差。

        这里用 ``tasklist /FI "PID eq {pid}"`` 拿 image name，确认是
        ``node.exe``（OpenClaw CLI 是 Node 程序）才返回 True。

    Returns:
        - True：PID 存活且 image name 是 ``node.exe``。
        - False：PID 不存在 / image name 不匹配 / 子进程查询失败。
    """
    if pid <= 0:
        return False
    try:
        if _is_windows():
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                timeout=5,
                creationflags=0x08000000,  # CREATE_NO_WINDOW
            )
            try:
                stdout = result.stdout.decode("utf-8", errors="replace")
            except (UnicodeDecodeError, AttributeError):
                stdout = str(result.stdout)
            # CSV 行示例： "node.exe","12345","Console","1","45,678 K"
            # 简单子串匹配 node.exe 即可（OpenClaw Gateway 是 Node 进程）
            return "node.exe" in stdout.lower() and str(pid) in stdout
        else:
            # Unix: 读 /proc/<pid>/comm 看进程名是否是 node
            try:
                comm = Path(f"/proc/{pid}/comm").read_text(encoding="utf-8").strip()
                return "node" in comm.lower()
            except OSError:
                # macOS 没 /proc，退到 ps
                result = subprocess.run(
                    ["ps", "-p", str(pid), "-o", "comm="],
                    capture_output=True,
                    timeout=5,
                )
                comm = result.stdout.decode("utf-8", errors="replace").strip()
                return "node" in comm.lower()
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
    log_file_path: Optional[Path] = None,
) -> None:
    """守护线程入口：逐行读 stdout/stderr 灌入 :func:`gateway_log.get_log_buffer`。

    Daemon thread entry: drain a child process stdout/stderr line stream into
    the global gateway log buffer. Exits naturally on EOF (gateway 退出时
    PIPE 自动关闭，``for line in stream`` 退出循环）。

    Args:
        stream: ``proc.stdout`` 或 ``proc.stderr``（``text=True`` 模式）。
        source: ``"stdout"`` 或 ``"stderr"``，写入 ``LogEntry.stream``。
        log_file_path: 可选磁盘日志文件，每行同时追加（事后崩溃追查）。
    """
    buf = _gateway_log.get_log_buffer()
    log_file = None
    if log_file_path is not None:
        try:
            log_file = open(log_file_path, "a", encoding="utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            logger.warning("无法打开 gateway 持久化日志 %s: %s", log_file_path, exc)
            log_file = None
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
            # 同时写磁盘文件（崩溃后能事后追查）
            if log_file is not None:
                try:
                    import datetime as _dt
                    ts = _dt.datetime.now().strftime("%H:%M:%S")
                    log_file.write(f"{ts} [{source}] {text}\n")
                    log_file.flush()
                except Exception:
                    pass
    except (OSError, ValueError):
        # stream 已关闭等 IO 异常 → EOF 等价，安静退出
        pass
    finally:
        try:
            stream.close()
        except Exception:
            pass
        if log_file is not None:
            try:
                log_file.close()
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

    # 1. PID 锁检查：如果已有 pid 且存活，判断是否当前 sidecar 实例创建
    existing_pid = _read_pid(home)
    if existing_pid and _is_pid_alive(existing_pid):
        if _is_current_sidecar_instance(home):
            # 同一 sidecar 实例 → 复用（pump 线程存活，日志可正常拉取）
            _gateway_state.set_running(pid=existing_pid, port=port)
            # v4.1.8 审计：复用路径也记录（_current_process 仍为 None，health_monitor 改用 PID 检测）
            _audit_log("START_GATEWAY:reused", f"existing_pid={existing_pid} port={port}")
            # v4.1.11 关键修复：复用路径也必须启动 health_monitor
            # 之前漏调 → status_rpc 检测到崩溃 set_errored 后无人接力 → 必须用户手动重启
            report_gateway_activity()
            _start_health_monitor()
            return GatewayProcess(
                pid=existing_pid,
                port=port,
                message="gateway 已在运行（复用现有进程）",
            )
        else:
            # 不同 sidecar 实例 → 旧 gateway 的 pump 线程已死，必须重启
            logger.info(
                "start_gateway: 检测到前一个 sidecar 实例残留的 gateway (pid=%s)，"
                "pump 线程已无法捕获日志，强制重启",
                existing_pid,
            )
            try:
                logger.info(
                    "start_gateway: 强制终止旧 gateway (pid=%s)...",
                    existing_pid,
                )
                _audit_log(
                    "FORCE_KILL:stale_sidecar_instance",
                    f"existing_pid={existing_pid} reason=different_sidecar_instance_owned_old_gateway",
                )
                _force_kill(existing_pid)
                _wait_pid_dead(existing_pid, SHUTDOWN_TIMEOUT)
                _clear_pid(home)
                logger.info("start_gateway: 旧 gateway 已终止，将启动新进程")
            except Exception as e:
                logger.warning("start_gateway: 停止旧 gateway 失败: %s", e)

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
    _ensure_control_ui_allowed_origins(bin_path, home, port)

    # 2.6 孤儿清理 + 端口检查：跳过 netstat（中文 Windows 兼容性差），
    #     改用 --force 兜底 + subprocess 5s timeout 保护
    logger.info("start_gateway: 跳过孤儿检查（依赖 --force）")

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
    # v4: 同时持久化到磁盘文件 logs/gateway.log（崩溃后能事后追查）
    log_file_path = _gateway_log_file(home)
    # 启动时写入分隔符标记新启动
    try:
        import datetime as _dt
        with open(log_file_path, "a", encoding="utf-8") as _f:
            _f.write(f"\n========== Gateway started PID={proc.pid} port={port} at {_dt.datetime.now().isoformat()} ==========\n")
    except Exception as exc:
        logger.warning("写入 gateway 日志启动标记失败: %s", exc)
    if proc.stdout is not None:
        threading.Thread(
            target=_pump_stream_to_log_buffer,
            args=(proc.stdout, "stdout", log_file_path),
            name=f"gateway-log-stdout-{proc.pid}",
            daemon=True,
        ).start()
    if proc.stderr is not None:
        threading.Thread(
            target=_pump_stream_to_log_buffer,
            args=(proc.stderr, "stderr", log_file_path),
            name=f"gateway-log-stderr-{proc.pid}",
            daemon=True,
        ).start()

    # 8. 保存模块级状态 + 写 gateway_state（供 status RPC 读）
    _current_process = proc
    _current_openclaw_home = home
    _gateway_state.set_running(pid=proc.pid, port=port)
    # v4.1.8 审计：每次新启动都记录（区分复用/新进程）
    _audit_log("START_GATEWAY:new_process", f"pid={proc.pid} port={port}")

    # 8.5 初始化空闲计时器（P2-7b）
    report_gateway_activity()

    # 9. 启动后台健康监控 daemon 线程（崩溃检测 + 自动重启）
    _start_health_monitor()

    return GatewayProcess(
        pid=proc.pid,
        port=port,
        message=f"gateway 已启动 (pid={proc.pid})",
    )


# ─── 后台健康监控（P0-3：崩溃检测 + 自动重启） ─────────────────────────

_health_monitor_started = False
_health_monitor_restart_count = 0
_health_monitor_restart_window_start = 0.0
_MAX_RESTARTS_PER_WINDOW = 3
_RESTART_WINDOW_SECS = 60.0

# ─── 空闲检测（P2-7b：Gateway 空闲关闭，节省资源） ─────────────────────
_GATEWAY_IDLE_SHUTDOWN_SECS = 1800  # 30 分钟无活动 → 关闭 gateway
_last_gateway_activity = 0.0       # 上次活动时间戳


def report_gateway_activity() -> None:
    """报告 Gateway 有活动，重置空闲计时器。

    Report gateway activity to reset the idle shutdown timer.
    应由 sidecar 的 RPC handler（status / chat 等）在每次前端交互时调用。
    """
    global _last_gateway_activity
    _last_gateway_activity = time.time()


def _start_health_monitor() -> None:
    """启动后台 daemon 线程：每 5s 检测 gateway 进程存活，死则自动重启。

    Start a background daemon thread that polls the gateway child process
    every 5 seconds. If the process has exited, auto-restart with rate
    limiting (max 3 restarts per 60s window).
    """
    global _health_monitor_started
    if _health_monitor_started:
        return
    _health_monitor_started = True

    t = threading.Thread(
        target=_health_monitor_loop,
        name="gateway-health-monitor",
        daemon=True,
    )
    t.start()
    logger.info("_start_health_monitor: health monitor thread started")


def _health_monitor_loop() -> None:
    """后台循环：每 5s poll() 一次 gateway 子进程。"""
    global _health_monitor_started

    while _health_monitor_started:
        time.sleep(5)

        # 只有 sidecar 标记为 running 或 errored 才监控
        # v4.1.9: errored 状态 = Gateway 异常死亡（status_rpc 检测到）→ 触发自动重启
        info = _gateway_state.get_info()
        if info.state == "errored":
            # 直接进入崩溃恢复路径
            check_pid = info.pid
            is_dead = True
            exit_code = "errored_state"
            proc = _current_process
            _audit_log(
                "GATEWAY_EXITED:health_monitor_picked_up_errored",
                f"pid={check_pid} state={info.state} last_error={info.last_error}",
            )
        elif info.state == "running":
            # 正常路径：检查子进程是否还活着
            # v4.1.8 关键修复：proc is None 时改用 PID 文件 + _is_pid_alive 检测
            proc = _current_process
            is_dead = False
            exit_code: Any = None
            check_pid = info.pid

            if proc is not None:
                poll_result = proc.poll()
                is_dead = poll_result is not None
                exit_code = poll_result
            elif check_pid is not None:
                # 复用旧 Gateway 路径：用 PID 检测
                if not _is_pid_alive(check_pid):
                    is_dead = True
                    exit_code = "unknown(reused-pid)"
        else:
            continue

        if not is_dead:
            # 进程仍在运行 → 检查空闲超时
            if (
                _last_gateway_activity > 0
                and time.time() - _last_gateway_activity > _GATEWAY_IDLE_SHUTDOWN_SECS
            ):
                idle_min = _GATEWAY_IDLE_SHUTDOWN_SECS / 60
                logger.info(
                    "health_monitor: gateway 已空闲 %.0f 分钟，关闭以节省资源",
                    idle_min,
                )
                _audit_log(
                    "STOP_GATEWAY:idle_timeout",
                    f"pid={check_pid} idle_min={idle_min} last_activity={_last_gateway_activity}",
                )
                stop_gateway()
                # idle 关闭后不设 error，下次 start_gateway 会重新初始化
            continue

        # ── 进程已退出 → 崩溃检测 ──
        dead_pid = proc.pid if proc is not None else check_pid
        logger.warning(
            "health_monitor: gateway pid=%s 已退出 (exit_code=%s)，触发自动重启",
            dead_pid,
            exit_code,
        )
        # v4.1.6 审计：记录 Gateway 进程意外退出（关键事件！）
        _audit_log(
            "GATEWAY_EXITED:detected",
            f"pid={dead_pid} exit_code={exit_code} reason=process_died_externally has_proc_obj={proc is not None}",
        )

        # 速率限制
        now = time.time()
        global _health_monitor_restart_count, _health_monitor_restart_window_start
        if now - _health_monitor_restart_window_start > _RESTART_WINDOW_SECS:
            _health_monitor_restart_count = 0
            _health_monitor_restart_window_start = now

        _health_monitor_restart_count += 1
        if _health_monitor_restart_count > _MAX_RESTARTS_PER_WINDOW:
            logger.error(
                "health_monitor: %ds 内重启了 %d 次，超出上限 %d 次，暂停自动重启",
                _RESTART_WINDOW_SECS,
                _health_monitor_restart_count - 1,
                _MAX_RESTARTS_PER_WINDOW,
            )
            _gateway_state.set_errored(
                f"Gateway 频繁崩溃（{_RESTART_WINDOW_SECS}s 内 {_health_monitor_restart_count - 1} 次重启），已暂停自动恢复"
            )
            _health_monitor_started = False
            return

        # 执行自动重启
        try:
            logger.info(
                "health_monitor: 正在自动重启 gateway (第 %d/%d 次)...",
                _health_monitor_restart_count,
                _MAX_RESTARTS_PER_WINDOW,
            )
            _audit_log(
                "AUTO_RESTART:starting",
                f"attempt={_health_monitor_restart_count}/{_MAX_RESTARTS_PER_WINDOW} prev_exit_code={exit_code}",
            )
            _gateway_state.set_errored(
                f"Gateway 进程退出 (exit_code={exit_code})，正在自动重启 ({_health_monitor_restart_count}/{_MAX_RESTARTS_PER_WINDOW})..."
            )

            # 复用 start_gateway 的重启逻辑
            # v4.1.11: 保留 health_monitor，否则下次崩溃无人接力
            stop_gateway(keep_health_monitor=True)
            _ = start_gateway(
                openclaw_home=_current_openclaw_home or Path.home() / ".artifexnexus" / ".openclaw",
            )
            logger.info("health_monitor: gateway 自动重启成功")
        except Exception as e:
            logger.error("health_monitor: 自动重启失败: %s", e)
            _gateway_state.set_errored(f"Gateway 自动重启失败: {e}")


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


def stop_gateway(*, keep_health_monitor: bool = False) -> bool:
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

    # v4.1.6 审计：记录 stop_gateway 调用 + 调用栈
    _audit_log(
        "STOP_GATEWAY:called",
        f"current_pid={proc.pid if proc else None} home={home}",
    )

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
    except Exception as e:
        logger.warning("stop_gateway graceful shutdown failed for pid=%s, force killing: %s", pid, e, exc_info=True)
        # 强制杀
        _force_kill(pid)
        _wait_pid_dead(pid, 2.0)

    # 清理
    _current_process = None
    if home:
        _clear_pid(home)
    _gateway_state.set_stopped()

    # 停止后台健康监控（用户主动 stop 不需要自动重启）
    # v4.1.11: keep_health_monitor=True 时保留监控（崩溃自动恢复路径用）
    global _health_monitor_started
    if not keep_health_monitor:
        _health_monitor_started = False

    return True


def _force_kill(pid: int) -> None:
    """强制终止进程。"""
    # v4.1.6 审计：记录 force_kill（最危险的操作）
    _audit_log("FORCE_KILL:called", f"pid={pid}")
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
    except Exception as e:
        logger.debug("_force_kill: failed to kill pid=%d: %s", pid, e)


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
        _audit_log(
            "FORCE_KILL:orphan_cleanup",
            f"pid={pid} port={port} reason=port_busy_orphan_gateway",
        )
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

    自愈语义（2026-05-12 修复）：
        本函数会在 sidecar **任意进程**调用时返回正确状态，包括 Rust 端因
        前一次 sidecar 超时被 drop 后 spawn 出来的新 sidecar。新 sidecar 的
        模块级全局 ``_current_process`` / ``_current_openclaw_home`` 都是 None，
        但 ``run/gateway.pid`` 锁文件还在；只要文件指向的 PID 真实存活，就
        认为 gateway 仍在跑。

        之前的实现只在 ``_current_openclaw_home`` 不为 None 时才查 PID 锁文件，
        导致新 sidecar 永远报 ``gateway_running=false`` → 前端遮罩永不消失。
    """
    global _current_process, _current_openclaw_home

    # 1) 同进程内 spawn 过 → 用 Popen.poll 判活
    if _current_process is not None:
        poll = _current_process.poll()
        if poll is None:
            return True
        # 进程已退出，清理
        _current_process = None

    # 2) PID 锁文件 fallback
    #    优先用本进程记下的 home；否则回退默认路径，让新 sidecar 也能识别
    #    上一代 sidecar 留下的 gateway。
    home = _current_openclaw_home
    if home is None:
        env_home = os.environ.get("OPENCLAW_HOME", "")
        if env_home:
            home = Path(env_home).expanduser().resolve()
        else:
            home = Path.home() / ".artifexnexus" / ".openclaw"

    pid = _read_pid(home)
    if pid and _is_openclaw_gateway_pid(pid):
        # 同步把 home 记到模块单例上，下次 stop_gateway 才有 home 可用
        if _current_openclaw_home is None:
            _current_openclaw_home = home
        # 同步把 gateway_state 拉成 running，让 openclaw.gateway.status 也能正确
        try:
            from . import bootstrap as _bs
            port = _bs.get_gateway_port(home)
        except Exception:
            port = DEFAULT_PORT
        try:
            cur = _gateway_state.get_info()
            if cur.state != "running" or cur.pid != pid:
                _gateway_state.set_running(pid=pid, port=port)
        except Exception as e:
            logger.warning("gateway_state.set_running failed in is_running: %s", e, exc_info=True)
        return True

    # PID 锁存在但指向的不是 node.exe（孤儿/谎言）→ 主动清理避免下次再误报
    if pid and not _is_openclaw_gateway_pid(pid):
        try:
            _clear_pid(home)
        except Exception:
            pass

    # 3) 端口探测 fallback：PID 锁不可靠时，直接探端口
    #    openclaw gateway run --force 可能在 wrapper 进程退出后留下 node.exe
    #    子进程在不同 PID 运行，此时 PID 锁无效但端口在监听。
    port = DEFAULT_PORT
    try:
        from . import bootstrap as _bs
        port = _bs.get_gateway_port(home)
    except Exception:
        pass
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        result = s.connect_ex(("127.0.0.1", port))
        s.close()
        if result == 0:
            # 端口有人监听 → gateway 在跑
            if _current_openclaw_home is None:
                _current_openclaw_home = home
            # 尝试从 netstat 获取真实 PID 并写入 PID 锁
            actual_pid = _get_pid_on_port(port)
            if actual_pid and actual_pid > 0:
                try:
                    _write_pid(home, actual_pid)
                    _gateway_state.set_running(pid=actual_pid, port=port)
                except Exception as e:
                    logger.warning("PID write/state sync failed after port probe: %s", e, exc_info=True)
            return True
    except Exception as e:
        logger.warning("Port probe failed for port=%s: %s", port, e, exc_info=True)

    return False


def _get_pid_on_port(port: int) -> int | None:
    """通过 netstat 获取监听指定端口的进程 PID。"""
    try:
        out = subprocess.check_output(
            ["netstat", "-ano"],
            timeout=3,
            creationflags=0x08000000 if os.name == "nt" else 0,
        ).decode("utf-8", errors="replace")
        for line in out.splitlines():
            if f":{port}" in line and "LISTEN" in line:
                parts = line.split()
                if parts:
                    try:
                        return int(parts[-1])
                    except ValueError as e:
                        logger.debug("PID parse failed for port %s: %s", port, e)
    except Exception:
        pass
    return None


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
