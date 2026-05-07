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
    from . import gateway_log as _gateway_log
    from . import gateway_state as _gateway_state
    from . import runtime as _runtime
except ImportError:  # 兼容直接以脚本方式执行
    import _subprocess as _sp  # type: ignore[no-redef]
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
# openclaw.gateway.status
# ---------------------------------------------------------------------------


def handle_gateway_status(req_id: Any, _params: dict) -> dict:
    """``openclaw.gateway.status`` RPC：聚合状态查询。

    Returns:
        ``{ state, pid, port, started_at, last_log_id, last_error }``

        ``uptime_seconds`` 已去掉，前端基于 ``started_at`` 自算。
    """
    try:
        info = _gateway_state.get_info()
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
