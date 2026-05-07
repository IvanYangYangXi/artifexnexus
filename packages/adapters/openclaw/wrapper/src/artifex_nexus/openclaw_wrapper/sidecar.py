"""
JSON-RPC 2.0 over stdio server — 常驻 sidecar 入口。

Protocol: NDJSON (one JSON object per line), no Content-Length header.
Methods: ping, get_port, openclaw.install, openclaw.bootstrap, openclaw.start,
         openclaw.stop, openclaw.doctor, openclaw.status, openclaw.list_versions,
         openclaw.upgrade, openclaw.rollback, openclaw.web.get_url,
         openclaw.agent_preset.status, openclaw.agent_preset.reset_default,
         openclaw.config.dump, openclaw.config.patch, openclaw.config.test_provider
"""

import json
import sys
from pathlib import Path
from typing import Any

# 支持直接执行和包内导入两种方式
try:
    from . import agent_preset as _agent_preset
    from . import bootstrap as _bootstrap
    from . import config_io as _config_io
    from . import doctor as _doctor
    from . import installer as _installer
    from . import ports as _ports
    from . import runtime as _runtime
    from . import web_ui as _web_ui
except ImportError:
    import agent_preset as _agent_preset  # type: ignore[no-redef]
    import bootstrap as _bootstrap  # type: ignore[no-redef]
    import config_io as _config_io  # type: ignore[no-redef]
    import doctor as _doctor  # type: ignore[no-redef]
    import installer as _installer  # type: ignore[no-redef]
    import ports as _ports  # type: ignore[no-redef]
    import runtime as _runtime  # type: ignore[no-redef]
    import web_ui as _web_ui  # type: ignore[no-redef]


# ---------------------------------------------------------------------------
# 路径工具
# ---------------------------------------------------------------------------


def _get_openclaw_home() -> Path:
    """获取 OPENCLAW_HOME 路径（dev 模式自动加 .dev 后缀）。

    Returns the OPENCLAW_HOME path, with .dev suffix in dev mode.
    """
    import os

    home = os.environ.get("OPENCLAW_HOME", "")
    if home:
        return Path(home).expanduser().resolve()
    # 默认路径
    base = Path.home() / ".artifexnexus" / ".openclaw"
    return base


def _get_version(params: dict) -> str:
    """从 params 中提取版本号，默认 v2026.5.4。"""
    return params.get("version", _installer.DEFAULT_VERSION)


# ---------------------------------------------------------------------------
# RPC 方法处理
# ---------------------------------------------------------------------------


def _handle_ping(req_id: Any, _params: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": "pong"}


def _handle_get_port(req_id: Any, params: dict) -> dict:
    preferred = params.get("port", _ports.DEFAULT_PORT)
    try:
        available = _ports.find_available_port(start=preferred)
        return {"jsonrpc": "2.0", "id": req_id, "result": {"port": available}}
    except RuntimeError as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_install(req_id: Any, params: dict) -> dict:
    """openclaw.install RPC：安装 OpenClaw CLI 到隔离 prefix。

    参数：
        version (str): 版本号，默认 v2026.5.4
        prefix (str, 可选): 安装目标路径
        openclaw_home (str, 可选): OPENCLAW_HOME 路径

    返回：
        { success, version, prefix, bin_path, events[], error_code?, error_message? }
        其中 events[] 为安装过程中的进度事件列表，每条包含 { phase, message, percent }。
    """
    version = _get_version(params)
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    prefix = params.get("prefix")

    # 收集所有进度事件
    events: list[dict] = []
    for event in _installer.install_openclaw(
        version=version,
        prefix=prefix,
        openclaw_home=openclaw_home,
    ):
        events.append({
            "phase": event.phase,
            "name": event.name,
            "percent": event.percent,
            "message": event.message,
        })

    result = _installer.get_install_result(
        [_installer.ProgressEvent(**e) for e in events],
        prefix=Path(prefix) if prefix else Path(openclaw_home) / "cli" / version,
        version=version,
    )

    response = {
        "success": result.success,
        "version": result.version,
        "prefix": str(result.prefix),
        "bin_path": str(result.bin_path) if result.bin_path else None,
        "events": events,
    }
    if not result.success:
        response["error_code"] = result.error_code
        response["error_message"] = result.error_message

    return {"jsonrpc": "2.0", "id": req_id, "result": response}


def _handle_openclaw_bootstrap(req_id: Any, params: dict) -> dict:
    """openclaw.bootstrap RPC：初始化 ~/.artifexnexus/.openclaw/ 目录布局。

    参数：
        version (str): 版本号，默认 v2026.5.4
        openclaw_home (str, 可选): OPENCLAW_HOME 路径
        port (int, 可选): 首选端口，默认 19789

    返回：
        { success, created_dirs, config_path, token_generated, port }
    """
    version = _get_version(params)
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    preferred_port = params.get("port", 19789)

    try:
        result, selected_port = _bootstrap.bootstrap_with_port_probe(
            Path(openclaw_home), version, preferred_port
        )
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "success": result.success,
                "created_dirs": [str(p) for p in result.created_dirs],
                "config_path": str(result.config_path),
                "port": selected_port,
            },
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_start(req_id: Any, params: dict) -> dict:
    """openclaw.start RPC：启动 OpenClaw gateway 子进程。

    参数：
        port (int, 可选): gateway 端口，默认 19789
        openclaw_home (str, 可选): OPENCLAW_HOME 路径

    返回：
        { success, pid, port, message }
    """
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    port = params.get("port", 19789)

    try:
        result = _runtime.start_gateway(Path(openclaw_home), port)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "success": True,
                "pid": result.pid,
                "port": result.port,
                "message": result.message,
            },
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_stop(req_id: Any, params: dict) -> dict:
    """openclaw.stop RPC：停止 OpenClaw gateway 子进程。"""
    try:
        result = _runtime.stop_gateway()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": result},
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_doctor(req_id: Any, params: dict) -> dict:
    """openclaw.doctor RPC：三通道健康检查。

    参数：
        openclaw_home (str, 可选): OPENCLAW_HOME 路径
        port (int, 可选): gateway 端口

    返回：
        HealthReport 结构
    """
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    port = params.get("port", 19789)

    try:
        report = _doctor.check_openclaw_health(Path(openclaw_home), port)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": report.to_dict(),
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_status(req_id: Any, params: dict) -> dict:
    """openclaw.status RPC：聚合状态查询。

    返回：
        { cli_installed, bootstrap_done, gateway_running, health, version, port }
    """
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    port = params.get("port", 19789)

    try:
        status = _runtime.get_status(Path(openclaw_home), port)
        result = status.to_dict()
        # EPIC-0001 第二批 #2 扩展：Web UI 是否可用（轻量探测：仅查 CLI 是否安装）
        # 详细 URL 探测在 openclaw.web.get_url 中实时执行
        result["web_ui_available"] = _web_ui.is_web_ui_available(Path(openclaw_home))
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": result,
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_list_versions(req_id: Any, params: dict) -> dict:
    """openclaw.list_versions RPC：列出已安装的版本。

    返回：
        [{ version, active, installed_at }]
    """
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))

    try:
        versions = _runtime.list_versions(Path(openclaw_home))
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": [v.to_dict() for v in versions],
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_upgrade(req_id: Any, _params: dict) -> dict:
    """openclaw.upgrade RPC：升级占位（M2+ 实现）。"""
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {
            "status": "not_implemented",
            "message": "升级功能将在 M2 提供",
        },
    }


def _handle_openclaw_rollback(req_id: Any, _params: dict) -> dict:
    """openclaw.rollback RPC：回滚占位（M2+ 实现）。"""
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {
            "status": "not_implemented",
            "message": "回滚功能将在 M2 提供",
        },
    }


def _handle_openclaw_web_get_url(req_id: Any, params: dict) -> dict:
    """openclaw.web.get_url RPC：探测 OpenClaw Control UI URL。

    参数：
        openclaw_home (str, 可选): OPENCLAW_HOME 路径
        timeout (float, 可选): dashboard 子命令超时秒数，默认 5.0

    返回：
        { available: bool, url: str | null, reason: str | null }
    """
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    timeout = float(params.get("timeout", _web_ui.DASHBOARD_TIMEOUT))

    try:
        result = _web_ui.get_web_url(Path(openclaw_home), timeout=timeout)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": result.to_dict(),
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _resolve_openclaw_bin(openclaw_home: Path) -> Path:
    """解析 openclaw 可执行文件路径，找不到抛 FileNotFoundError。"""
    bin_path = _runtime._find_openclaw_bin(openclaw_home)
    if bin_path is None:
        raise FileNotFoundError(
            f"未找到 openclaw 可执行文件，请先 install。查找路径: {openclaw_home}/cli/"
        )
    return bin_path


def _handle_openclaw_agent_preset_status(req_id: Any, params: dict) -> dict:
    """openclaw.agent_preset.status RPC：查询 Artifex Nexus 默认预设状态。

    返回：
        { installed, version, modifiedByUser, lockPath }
    """
    openclaw_home = Path(params.get("openclaw_home", str(_get_openclaw_home())))
    try:
        # bin_path 找不到也允许返回 status（installed=False 的情况由 lock 决定）
        bin_path = _runtime._find_openclaw_bin(openclaw_home)
        status = _agent_preset.get_status(bin_path or Path("openclaw"), openclaw_home)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": status.to_dict(),
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_agent_preset_reset(req_id: Any, params: dict) -> dict:
    """openclaw.agent_preset.reset_default RPC：强制重置 Artifex Nexus 预设。

    参数：
        force (bool, 默认 True): 是否覆盖用户改动
        openclaw_home (str, 可选)

    返回：
        { success, action, version, error? }
    """
    openclaw_home = Path(params.get("openclaw_home", str(_get_openclaw_home())))
    force = bool(params.get("force", True))

    try:
        bin_path = _resolve_openclaw_bin(openclaw_home)
        result = _agent_preset.reset_default(bin_path, openclaw_home, force=force)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": result.to_dict(),
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_config_dump(req_id: Any, params: dict) -> dict:
    """openclaw.config.dump RPC：聚合配置 + 脱敏。

    返回：
        { providers, authProfiles, authOrder, agentDefaults, extras }
    """
    openclaw_home = Path(params.get("openclaw_home", str(_get_openclaw_home())))
    try:
        bin_path = _resolve_openclaw_bin(openclaw_home)
        dump = _config_io.dump_config(bin_path, openclaw_home)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": dump.to_dict(),
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_config_patch(req_id: Any, params: dict) -> dict:
    """openclaw.config.patch RPC：透传 patch + 写 extras。

    参数：
        patch (dict): 给上游 ``openclaw config patch --stdin`` 的 JSON
        extrasPatch (dict, 可选): wrapper extras 增量
        openclaw_home (str, 可选)

    返回：
        { success, validateError? }
    """
    openclaw_home = Path(params.get("openclaw_home", str(_get_openclaw_home())))
    patch_payload = params.get("patch", {})
    extras_patch = params.get("extrasPatch")

    if not isinstance(patch_payload, dict):
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "patch 必须是 object"},
        }

    try:
        bin_path = _resolve_openclaw_bin(openclaw_home)
        result = _config_io.patch_config(
            bin_path, openclaw_home, patch_payload, extras_patch=extras_patch
        )
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": result.to_dict(),
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_config_test_provider(req_id: Any, params: dict) -> dict:
    """openclaw.config.test_provider RPC：跑一次最小请求测连通。

    参数：
        providerId (str, 必填)
        modelId (str, 必填)
        authProfileId (str, 可选)
        timeout (float, 可选): 默认 INFER_TIMEOUT

    返回：
        { success, latencyMs?, modelEcho?, error? }
    """
    openclaw_home = Path(params.get("openclaw_home", str(_get_openclaw_home())))
    provider_id = params.get("providerId", "")
    model_id = params.get("modelId", "")
    auth_profile_id = params.get("authProfileId")
    timeout = float(params.get("timeout", _config_io.INFER_TIMEOUT))

    try:
        bin_path = _resolve_openclaw_bin(openclaw_home)
        result = _config_io.test_provider(
            bin_path,
            openclaw_home,
            provider_id,
            model_id,
            auth_profile_id=auth_profile_id,
            timeout=timeout,
        )
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": result.to_dict(),
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


# ---------------------------------------------------------------------------
# 方法路由表
# ---------------------------------------------------------------------------

METHOD_TABLE: dict[str, Any] = {
    "ping": _handle_ping,
    "get_port": _handle_get_port,
    "openclaw.install": _handle_openclaw_install,
    "openclaw.bootstrap": _handle_openclaw_bootstrap,
    "openclaw.start": _handle_openclaw_start,
    "openclaw.stop": _handle_openclaw_stop,
    "openclaw.doctor": _handle_openclaw_doctor,
    "openclaw.status": _handle_openclaw_status,
    "openclaw.list_versions": _handle_openclaw_list_versions,
    "openclaw.upgrade": _handle_openclaw_upgrade,
    "openclaw.rollback": _handle_openclaw_rollback,
    "openclaw.web.get_url": _handle_openclaw_web_get_url,
    "openclaw.agent_preset.status": _handle_openclaw_agent_preset_status,
    "openclaw.agent_preset.reset_default": _handle_openclaw_agent_preset_reset,
    "openclaw.config.dump": _handle_openclaw_config_dump,
    "openclaw.config.patch": _handle_openclaw_config_patch,
    "openclaw.config.test_provider": _handle_openclaw_config_test_provider,
}


def handle_request(request: dict) -> dict:
    """处理单个 JSON-RPC 请求，返回响应 dict。

    Handle a single JSON-RPC request and return a response dict.
    """
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    handler = METHOD_TABLE.get(method)
    if handler is None:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }

    try:
        return handler(req_id, params)
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32603, "message": f"Internal error: {e}"},
        }


def main() -> None:
    """stdio JSON-RPC 主循环：逐行读取 stdin，逐行写回 stdout。

    Main stdio JSON-RPC loop: reads NDJSON from stdin, writes NDJSON to stdout.
    """
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            resp = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": "Parse error"},
            }
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
            continue

        response = handle_request(request)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
