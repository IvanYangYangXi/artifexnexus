"""
Gateway 状态控制面板的 5 个新增 RPC handler（STORY-0018 T2）。

JSON-RPC handlers for the OpenClaw gateway status control panel:

- ``openclaw.gateway.status``      —— 聚合状态（state/pid/port/started_at/last_log_id/last_error）
- ``openclaw.gateway.start``       —— 幂等启动（``force_restart`` 时先 stop 再 start）
- ``openclaw.gateway.restart``     —— 等价 ``start({force_restart: true})``
- ``openclaw.gateway.tail_log``    —— 日志增量轮询（n 与 since_id 互斥）
- ``openclaw.web.open``            —— spawn ``openclaw dashboard`` 让 OpenClaw 自开浏览器

详见 docs/specs/openclaw-status-panel.md §2。
"""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Any

try:
    from . import _subprocess as _sp
    from . import bootstrap as _bootstrap
    from . import gateway_log as _gateway_log
    from . import gateway_state as _gateway_state
    from . import runtime as _runtime
except ImportError:  # 兼容直接以脚本方式执行
    import _subprocess as _sp  # type: ignore[no-redef]
    import bootstrap as _bootstrap  # type: ignore[no-redef]
    import gateway_log as _gateway_log  # type: ignore[no-redef]
    import gateway_state as _gateway_state  # type: ignore[no-redef]
    import runtime as _runtime  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

DEFAULT_PORT = 19789
"""与 ``runtime.DEFAULT_PORT`` / ``ports.DEFAULT_PORT`` 对齐的默认 gateway 端口。"""

DEFAULT_TAIL_N = 200
"""``tail_log`` 不带 since_id 时的默认拉取行数（与 spec §2.4 一致）。"""

MAX_TAIL_N = 2000
"""单次 ``tail_log`` 拉取上限，避免一次回 8000 行打爆 stdio。"""


def _get_pid_on_port(port: int) -> int | None:
    """通过 netstat 获取监听指定端口的进程 PID（Windows only）。"""
    try:
        import subprocess as _sub
        out = _sub.check_output(
            ["netstat", "-ano"],
            timeout=3,
            creationflags=0x08000000 if os.name == "nt" else 0,
        ).decode("utf-8", errors="replace")
        for line in out.splitlines():
            # 匹配  TCP  127.0.0.1:19789  0.0.0.0:0  LISTENING  12345
            if f":{port}" in line and "LISTEN" in line:
                parts = line.split()
                if parts:
                    try:
                        return int(parts[-1])
                    except ValueError:
                        pass
    except Exception as e:
        logger.warning("_get_pid_on_port(port=%s) failed: %s", port, e, exc_info=True)
    return None


# ---------------------------------------------------------------------------
# 路径工具（与 sidecar.py 同源；这里独立一份避免循环 import）
# ---------------------------------------------------------------------------


def _get_openclaw_home() -> Path:
    """读取 OPENCLAW_HOME；缺省走 ``~/.artifexnexus/.openclaw/``。"""
    home = os.environ.get("OPENCLAW_HOME", "")
    if home:
        return Path(home).expanduser().resolve()
    return Path.home() / ".artifexnexus" / ".openclaw"


def _params_home(params: dict) -> Path:
    """从 params 提取 openclaw_home，缺省走默认。"""
    return Path(params.get("openclaw_home", str(_get_openclaw_home())))


# ---------------------------------------------------------------------------
# openclaw.gateway.auth_info
# ---------------------------------------------------------------------------


def handle_gateway_auth_info(req_id: Any, params: dict) -> dict:
    """``openclaw.gateway.auth_info`` RPC：返回前端连接 Gateway 所需的 port + token。

    Return gateway connection credentials (port + token) required by the
    frontend WebSocket client handshake.

    设计要点：
    - **仅本机 loopback 返回明文 token**：sidecar 通过 stdio 只与本机 Tauri 主进程
      通信，token 不会落盘到前端日志，也不会上网络。
    - **token 来源**：:func:`bootstrap.get_gateway_token` 从
      ``openclaw.json`` → ``gateway.auth.token`` 读取（主路径），老路径
      ``gateway.token`` 兼容。
    - **port 来源**：优先读 :class:`gateway_state` 中 running 态登记的 port，
      缺省走 :func:`bootstrap.get_gateway_port`，再缺走 :data:`DEFAULT_PORT`。

    Args (params):
        openclaw_home (str, 可选): OPENCLAW_HOME 路径，缺省走默认路径。

    Returns:
        ``{ port, token, auth_mode }``

        - ``port``: int — Gateway 实际监听端口（前端据此建 WS）
        - ``token``: str — Gateway auth token；``auth.mode == "token"`` 且配置了时返回明文，
          否则返回空串
        - ``auth_mode``: str — ``"token"`` / ``"none"`` / ``""``（未配置）
    """
    try:
        home = _params_home(params).expanduser().resolve()

        # port 优先取运行态登记值（端口探测迁移后的真实 port）
        info = _gateway_state.get_info()
        port: int = info.port if isinstance(info.port, int) and info.port > 0 else 0
        if port == 0:
            try:
                port = _bootstrap.get_gateway_port(home)
            except Exception:
                port = DEFAULT_PORT

        # token：只有 gateway.auth.mode == "token" 才返回明文
        token_val: str = ""
        auth_mode: str = ""
        try:
            cfg = _bootstrap.read_config(home) or {}
            auth = cfg.get("gateway", {}).get("auth", {}) if isinstance(cfg, dict) else {}
            if isinstance(auth, dict):
                mode = auth.get("mode")
                if isinstance(mode, str):
                    auth_mode = mode
        except Exception:
            pass

        if auth_mode == "token":
            tok = _bootstrap.get_gateway_token(home)
            if isinstance(tok, str):
                token_val = tok

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "port": port,
                "token": token_val,
                "auth_mode": auth_mode,
            },
        }
    except Exception as e:
        logger.exception("gateway.auth_info 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


# ---------------------------------------------------------------------------
# openclaw.gateway.status
# ---------------------------------------------------------------------------


def handle_gateway_status(req_id: Any, _params: dict) -> dict:
    """``openclaw.gateway.status`` RPC：聚合状态查询。

    Returns:
        ``{ state, pid, port, started_at, last_log_id, last_error }``

        ``uptime_seconds`` 已去掉，前端基于 ``started_at`` 自算。

    2026-05-12 修复：sidecar 重启后 gateway_state 是进程级单例（默认 stopped），
    但 gateway 可能仍在运行（由上一个 sidecar 启动）。
    多重 fallback：
    1. runtime.is_running()（PID 锁 + tasklist）
    2. 端口探测（直接连 127.0.0.1:port 看是否有人监听）
    只要任一检测到 running，就自动恢复 gateway_state。

    2026-05-13 修复：增加反向存活检测。
    当 state == "running" 但进程实际已死（sidecar 重启后 health monitor 未恢复），
    自动将状态修正为 stopped/errored，并重启 health monitor。
    """
    try:
        info = _gateway_state.get_info()

        # ── 反向存活检测：state == "running" 但进程可能已退出 ──
        if info.state == "running":
            actually_alive = False
            proc = _runtime._current_process
            if proc is not None:
                # 有 Popen 对象：poll() 是最快的方式（非阻塞）
                if proc.poll() is None:
                    actually_alive = True
            elif info.pid and info.pid > 0:
                # 无 Popen 对象但有 PID（sidecar 重启后恢复的场景）：
                # 用快速端口探测确认（比 tasklist 快得多）
                port = info.port or DEFAULT_PORT
                try:
                    import socket
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(0.3)  # 300ms 快速探测
                    result = s.connect_ex(("127.0.0.1", port))
                    s.close()
                    actually_alive = (result == 0)
                except Exception:
                    actually_alive = False

            if not actually_alive:
                # 进程已退出但状态未更新 → 修正
                logger.warning(
                    "gateway_status: state='running' 但进程已死 (pid=%s port=%s)，修正为 stopped",
                    info.pid, info.port,
                )
                _gateway_state.set_stopped()
                info = _gateway_state.get_info()

        # ── Fallback：单例显示 stopped/errored 但 gateway 可能仍在运行 ──
        if info.state != "running":
            recovered = False
            if _runtime.is_running():
                recovered = True

            # 端口探测（PID 锁可能失效，但端口不会骗人）
            if not recovered:
                port = DEFAULT_PORT
                try:
                    port = _bootstrap.get_gateway_port(_get_openclaw_home())
                except Exception as e:
                    logger.warning("get_gateway_port failed during status recovery: %s", e, exc_info=True)
                try:
                    import socket
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(0.5)
                    result = s.connect_ex(("127.0.0.1", port))
                    s.close()
                    if result == 0:
                        recovered = True
                        # 端口在监听但 PID 未知——尝试从 netstat 获取 PID
                        actual_pid = _get_pid_on_port(port)
                        if actual_pid and actual_pid > 0:
                            _gateway_state.set_running(pid=actual_pid, port=port)
                            logger.info(
                                "gateway_state 通过端口探测恢复: pid=%s port=%s",
                                actual_pid, port,
                            )
                        else:
                            # 没拿到 PID，用一个虚拟信息表示 running
                            info = _gateway_state.GatewayInfo(
                                state="running",
                                pid=None,
                                port=port,
                                started_at=None,
                                last_error=None,
                            )
                except Exception as e:
                    logger.warning("PID/port recovery in gateway status failed: %s", e, exc_info=True)

            # 重新读取（可能已被 is_running() 或上面的逻辑更新）
            if recovered:
                info = _gateway_state.get_info()

            # 从 stopped 恢复到 running 后，重启 health monitor
            # （sidecar 重启后 _health_monitor_started 为 False，
            #  需要重新启动以监控后续的进程退出）
            if info.state == "running":
                try:
                    _runtime._start_health_monitor()
                except Exception as e:
                    logger.warning("_start_health_monitor() failed after status recovery: %s", e, exc_info=True)

        last_log_id = _gateway_log.get_log_buffer().stats()["max_id"]
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": info.to_status_dict(last_log_id=last_log_id),
        }
    except Exception as e:
        logger.exception("gateway.status 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


# ---------------------------------------------------------------------------
# openclaw.gateway.start  /  openclaw.gateway.restart
# ---------------------------------------------------------------------------


def handle_gateway_start(req_id: Any, params: dict) -> dict:
    """``openclaw.gateway.start`` RPC：幂等启动。

    Args (params):
        force_restart (bool): ``True`` 时先 stop 再 start，等价 restart；
            默认 ``False``，已运行直接返回当前 pid/port/restarted=False。
        port (int): gateway 端口，默认 19789。
        openclaw_home (str): OPENCLAW_HOME 路径。

    Returns:
        ``{ success, restarted, pid, port, message }``
    """
    home = _params_home(params)
    port = int(params.get("port", DEFAULT_PORT))
    force_restart = bool(params.get("force_restart", False))

    try:
        info = _gateway_state.get_info()
        already_running = (
            info.state == "running"
            and info.pid is not None
            and _runtime._is_pid_alive(info.pid)
        )

        restarted = False
        if already_running and not force_restart:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "success": True,
                    "restarted": False,
                    "pid": info.pid,
                    "port": info.port if info.port is not None else port,
                    "message": "gateway 已在运行（幂等返回）",
                },
            }

        if already_running and force_restart:
            _runtime.stop_gateway()
            restarted = True

        result = _runtime.start_gateway(home, port)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "success": True,
                "restarted": restarted,
                "pid": result.pid,
                "port": result.port,
                "message": result.message,
            },
        }
    except _runtime.PortBusyError as busy:
        logger.warning("gateway.start 端口被外部进程占用: %s", busy)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32020,
                "message": str(busy),
                "data": {
                    "kind": "port_busy",
                    "port": busy.port,
                    "occupants": busy.occupants,
                },
            },
        }
    except Exception as e:
        logger.exception("gateway.start 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def handle_gateway_restart(req_id: Any, params: dict) -> dict:
    """``openclaw.gateway.restart`` RPC：等价 ``start({force_restart: true})``。"""
    merged = dict(params)
    merged["force_restart"] = True
    return handle_gateway_start(req_id, merged)


# ---------------------------------------------------------------------------
# openclaw.gateway.tail_log
# ---------------------------------------------------------------------------


def handle_gateway_tail_log(req_id: Any, params: dict) -> dict:
    """``openclaw.gateway.tail_log`` RPC：日志增量轮询。

    n 与 since_id **互斥**（两者同传时优先 since_id；spec §2.4）。

    Args (params):
        n (int): 拉最近 n 条；默认 200，上限 :data:`MAX_TAIL_N`。
        since_id (int): 拉 ``id > since_id`` 的所有条目（增量）。

    Returns:
        ``{ entries, max_id, buffer_size, dropped }``

        ``entries`` 是 :func:`gateway_log.LogEntry.to_dict` 的列表。
    """
    try:
        buf = _gateway_log.get_log_buffer()
        since_id = params.get("since_id")

        if since_id is not None:
            try:
                since_int = int(since_id)
            except (TypeError, ValueError):
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": "since_id 必须是整数"},
                }
            entries = buf.since(since_int)
        else:
            n = int(params.get("n", DEFAULT_TAIL_N))
            if n < 0:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": "n 必须 >= 0"},
                }
            n = min(n, MAX_TAIL_N)
            entries = buf.tail(n)

        stats = buf.stats()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "entries": [e.to_dict() for e in entries],
                "max_id": stats["max_id"],
                "buffer_size": stats["size"],
                "dropped": stats["dropped"],
            },
        }
    except Exception as e:
        logger.exception("gateway.tail_log 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


# ---------------------------------------------------------------------------
# openclaw.web.open
# ---------------------------------------------------------------------------


def handle_web_open(req_id: Any, params: dict) -> dict:
    """``openclaw.web.open`` RPC：spawn ``openclaw dashboard`` 让 CLI 自开浏览器。

    Spawn ``openclaw dashboard`` (without ``--no-open``) so that the upstream
    CLI itself opens the system default browser. **不阻塞、不解析 stdout、不轮询**；
    spawn 即返回。

    设计要点（STORY-0018 T2 Q2 决策）：
        - 不带 ``--no-open`` → CLI 自开浏览器
        - 仅捕捉 spawn 即时失败（OSError / FileNotFoundError），其它异步失败
          交给 T3/T4 前端集成时的 fallback（``tauri-shell.open(url)``）
        - 必须复用 :mod:`_subprocess` 的 ``popen_kwargs`` + ``build_openclaw_env``，
          避免 [WinError 193] 与 GBK 解码炸

    Returns:
        成功： ``{ success: true, method: "openclaw_dashboard", pid }``
        失败： ``{ success: false, method: "openclaw_dashboard", error }``
    """
    home = _params_home(params).expanduser().resolve()

    try:
        bin_path = _sp.find_openclaw_bin(home)
        if bin_path is None:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "success": False,
                    "method": "openclaw_dashboard",
                    "error": "openclaw 可执行文件未找到，请先 install",
                },
            }

        cmd = [str(bin_path), "dashboard"]
        env = _sp.build_openclaw_env(home)
        # web.open 是 fire-and-forget：不需要 PIPE，让 CLI 把 URL 直接打到原 console
        # （sidecar 的 stdio 正在跑 NDJSON，绝对不能让 dashboard 输出污染）→ 改 DEVNULL
        popen_kw = _sp.popen_kwargs(win_no_window=True)
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            **popen_kw,
        )
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "success": True,
                "method": "openclaw_dashboard",
                "pid": proc.pid,
            },
        }
    except (OSError, FileNotFoundError) as e:
        # spawn 即时失败：CLI 路径写错、权限不够等
        logger.warning("web.open spawn 失败: %s", e)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "success": False,
                "method": "openclaw_dashboard",
                "error": f"spawn 失败: {e}",
            },
        }
    except Exception as e:
        logger.exception("web.open 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }
