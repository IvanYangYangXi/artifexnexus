"""
JSON-RPC 2.0 over stdio server — 常驻 sidecar 入口。

Protocol: NDJSON (one JSON object per line), no Content-Length header.
Methods: ping, get_port, openclaw.install, openclaw.bootstrap, openclaw.start,
         openclaw.stop, openclaw.doctor, openclaw.status, openclaw.list_versions,
         openclaw.upgrade, openclaw.rollback, openclaw.web.get_url,
         openclaw.agent_preset.status, openclaw.agent_preset.reset_default,
         openclaw.config.dump, openclaw.config.patch, openclaw.config.test_provider
         openclaw.auth.set_token

Lifecycle:
    sidecar 退出（正常 / Tauri 主进程关窗 / SIGTERM）时，必须主动停掉它
    spawn 的 gateway 子进程；否则会留下孤儿（见 runtime._cleanup_orphan_gateways
    的注释）。这通过 ``atexit`` + ``signal`` hook 实现。Windows 控制台关闭信号
    走 ``CTRL_BREAK_EVENT``；Tauri 主进程退出时会向 sidecar 的 stdin 关闭，
    主循环 EOF 自然退出 → 触发 atexit。
"""

import atexit
import json
import signal
import sys
from pathlib import Path
from typing import Any, Optional

# 早期启动打点 #0：捕获 import 链失败前的最早时刻；任何 ImportError 都会让
# 这一行先落到 sidecar-stderr-<pid>.log，避免"日志空白 = sidecar 黑死"。
sys.stderr.write("[sidecar.boot] python entrypoint reached\n")
sys.stderr.flush()

# 支持直接执行和包内导入两种方式
try:
    from . import agent_preset as _agent_preset
    from . import bootstrap as _bootstrap
    from . import config_io as _config_io
    from . import dcc_installer as _dcc_installer
    from . import doctor as _doctor
    from . import installer as _installer
    from . import mcp_bridge as _mcp_bridge
    from . import ports as _ports
    from . import runtime as _runtime
    from . import sidecar_gateway as _sidecar_gateway
    from . import sidecar_sessions as _sidecar_sessions
    from . import web_ui as _web_ui
except ImportError:
    import agent_preset as _agent_preset  # type: ignore[no-redef]
    import bootstrap as _bootstrap  # type: ignore[no-redef]
    import config_io as _config_io  # type: ignore[no-redef]
    import dcc_installer as _dcc_installer  # type: ignore[no-redef]
    import doctor as _doctor  # type: ignore[no-redef]
    import installer as _installer  # type: ignore[no-redef]
    import mcp_bridge as _mcp_bridge  # type: ignore[no-redef]
    import ports as _ports  # type: ignore[no-redef]
    import runtime as _runtime  # type: ignore[no-redef]
    import sidecar_gateway as _sidecar_gateway  # type: ignore[no-redef]
    import sidecar_sessions as _sidecar_sessions  # type: ignore[no-redef]
    import web_ui as _web_ui  # type: ignore[no-redef]

sys.stderr.write("[sidecar.boot] all submodules imported\n")
sys.stderr.flush()


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
        preserve_options (dict, 可选): 重装时保留选项
            - preserveProviders (bool)
            - preserveAuth (bool)
            - preserveAgents (bool)
            - preservePlugins (bool)

    返回：
        { success, created_dirs, config_path, token_generated, port }
    """
    version = _get_version(params)
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    preferred_port = params.get("port", 19789)
    preserve_options = params.get("preserve_options")

    try:
        # STORY-0039：bootstrap 固定写 19789，不再自动迁移到 19809/19829。
        # 端口占用由 runtime.start_gateway 处理：自家孤儿杀掉 / 外部占用显式报错。
        result, selected_port = _bootstrap.bootstrap_fixed_port(
            Path(openclaw_home), version, preferred_port,
            preserve_options=preserve_options,
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
    except _runtime.PortBusyError as busy:
        # STORY-0039：外部进程占用端口 → 结构化错误 -32020，让前端能弹
        # "端口 19789 被 xxx (PID=123) 占用" 对话框；不自动迁移到 19809。
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

    # P2-7b：每次 status 轮询都报告活动，重置网关空闲关闭计时器
    _runtime.report_gateway_activity()

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

    .. deprecated:: STORY-0018-T2
        使用 ``openclaw.web.open`` 替代（spawn dashboard 让 CLI 自开浏览器，
        无需把 token 透传到前端，更安全）。本 handler 实现保留一个 release 周期，
        2026-Q3 移除。

    .. deprecated:: STORY-0018-T2 (EN)
        Use ``openclaw.web.open`` instead. This handler is kept for one release
        cycle for backwards compatibility with older frontends.

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


def _handle_openclaw_auth_set_token(req_id: Any, params: dict) -> dict:
    """openclaw.auth.set_token RPC：把 API token 写到上游凭证文件 + 元数据。

    参数：
        provider (str, 必填): provider id（如 ``deepseek``）
        profileId (str, 必填): auth profile id（如 ``deepseek-default``）
        token (str, 必填): 新 token；脱敏占位会被拒绝
        expiresIn (str, 可选): 过期时长（如 ``"365d"``）
        openclaw_home (str, 可选)

    返回：
        { success, profileId?, error? }

    实现：spawn ``openclaw models auth paste-token --provider <p>
    --profile-id <id>`` via stdin（token 不入 argv）。上游 CLI 会同时写
    ``state/agents/<agentId>/agent/auth-profiles.json`` 和 ``openclaw.json``
    的 ``auth.profiles.<id>`` 元数据。
    """
    openclaw_home = Path(params.get("openclaw_home", str(_get_openclaw_home())))
    provider = params.get("provider", "") or params.get("providerId", "")
    profile_id = params.get("profileId", "") or params.get("profile_id", "")
    token = params.get("token", "")
    expires_in = params.get("expiresIn") or params.get("expires_in")

    try:
        bin_path = _resolve_openclaw_bin(openclaw_home)
        result = _config_io.set_auth_token(
            bin_path,
            openclaw_home,
            provider,
            profile_id,
            token,
            expires_in=expires_in,
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


def _handle_openclaw_models_fetch_remote(req_id: Any, params: dict) -> dict:
    """openclaw.models.fetch_remote RPC：调远端 provider 的 /models 获取模型列表。

    Fetch model list from a remote provider's OpenAI-compatible GET /models.

    参数：
        baseUrl (str, 必填): provider 的 baseUrl（如 https://api.deepseek.com/v1）
        token (str, 必填): API key / bearer token
        providerId (str, 可选): 若传入且 token 为空，自动从 auth-profiles.json 读取
        timeout (float, 可选): HTTP 超时秒数，默认 10

    返回：
        { success, models?: [{id, name?, ownedBy?}], error? }
    """
    base_url = params.get("baseUrl", "")
    token = params.get("token", "")
    provider_id = params.get("providerId", "")
    timeout = float(params.get("timeout", _config_io.FETCH_MODELS_TIMEOUT))

    # Bug #2 修复：如果前端传来的 token 为空或者是脱敏占位，
    # 尝试从 auth-profiles.json 中读取已保存的真实 token
    if (not token or _config_io.is_masked_value(token)) and provider_id:
        resolved_token = _resolve_stored_token(provider_id)
        if resolved_token:
            token = resolved_token

    try:
        result = _config_io.fetch_remote_models(
            base_url, token, timeout=timeout
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


def _resolve_stored_token(provider_id: str) -> Optional[str]:
    """从 auth-profiles.json 中读取指定 provider 的已保存 token。

    Read stored token from auth-profiles.json for a given provider.
    查找路径：state/agents/*/agent/auth-profiles.json
    """
    import glob
    openclaw_home = _get_openclaw_home()
    pattern = str(openclaw_home / "state" / "agents" / "*" / "agent" / "auth-profiles.json")
    for filepath in glob.glob(pattern):
        try:
            data = json.loads(Path(filepath).read_text(encoding="utf-8"))
            profiles = data.get("profiles", {})
            for _pid, profile in profiles.items():
                if not isinstance(profile, dict):
                    continue
                if profile.get("provider") == provider_id:
                    token_val = profile.get("token", "")
                    if token_val and not _config_io.is_masked_value(token_val):
                        return token_val
        except (OSError, json.JSONDecodeError, KeyError):
            continue
    return None


def _handle_openclaw_mcp_blender_run_python(req_id: Any, params: dict) -> dict:
    """openclaw.mcp.blender.run_python RPC：在 Blender 中执行 Python 代码。

    Gateway 作为 MCP 客户端连接 Blender MCP Server，
    转发 tools/call run_python 请求。

    参数：
        code (str, 可选): 要执行的 Python 代码
        get_context (bool, 可选): 设为 true 时仅获取编辑器上下文
        timeout (float, 可选): 超时秒数，默认 30

    返回：
        MCP tools/call 响应 result（含 content 和 isError）
    """
    code = params.get("code", "")
    get_context = bool(params.get("get_context", False))
    timeout = float(params.get("timeout", _mcp_bridge.DEFAULT_TIMEOUT))

    try:
        result = _mcp_bridge.call_blender_run_python(
            code=code,
            get_context=get_context,
            timeout=timeout,
        )
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


# ── DCC 安装器 RPC handlers ─────────────────────────────────────────────

def _handle_openclaw_dcc_blender_detect(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.blender.detect RPC：检测本机 Blender 版本及插件安装状态。

    返回：
        {
            "versions": [
                {
                    "version": "4.2",
                    "installed": true,
                    "compatible": true,
                    "compat_reason": "兼容",
                    "addon_info": {...}
                },
                ...
            ]
        }
    """
    try:
        versions = _dcc_installer.find_blender_versions()
        addon_info = _dcc_installer.get_addon_info()

        result_versions = []
        for ver in versions:
            installed = _dcc_installer.is_addon_installed(ver)
            compatible, reason = _dcc_installer.check_version_compatibility(ver)
            result_versions.append({
                "version": ver,
                "installed": installed,
                "compatible": compatible,
                "compat_reason": reason,
            })

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "versions": result_versions,
                "addon_info": {
                    "name": addon_info.get("name", ""),
                    "version": ".".join(str(x) for x in addon_info.get("version", (5, 0, 0))),
                    "blender_min": ".".join(str(x) for x in addon_info.get("blender_min", (5, 0, 0))),
                    "blender_max": ".".join(str(x) for x in addon_info.get("blender_max", (5, 1, 9))) if addon_info.get("blender_max") else None,
                },
            },
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_dcc_blender_install(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.blender.install RPC：安装插件到指定 Blender 版本。

    参数：
        version (str): Blender 版本号，如 "4.2"
        force (bool, 可选): 是否跳过兼容性检查

    返回：
        {"success": bool, "method": "copy", "target": str, "error": str|None}
    """
    version = params.get("version", "")
    force = bool(params.get("force", False))

    if not version:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: version"},
        }

    try:
        result = _dcc_installer.install_blender_addon(version, force=force)
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


def _handle_openclaw_dcc_blender_uninstall(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.blender.uninstall RPC：卸载插件。

    参数：
        version (str): Blender 版本号

    返回：
        {"success": bool, "target": str, "error": str|None}
    """
    version = params.get("version", "")

    if not version:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: version"},
        }

    try:
        result = _dcc_installer.uninstall_blender_addon(version)
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


def _handle_openclaw_gateway_mcp_bridge_install(req_id: Any, params: dict) -> dict:
    """openclaw.gateway.mcp_bridge.install RPC：部署 mcp-bridge 插件到 OpenClaw。

    返回：
        {"success": bool, "method": str, "target": str, "error": str|None}
    """
    try:
        result = _dcc_installer.install_gateway_mcp_bridge()
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


def _handle_openclaw_gateway_mcp_bridge_status(req_id: Any, params: dict) -> dict:
    """openclaw.gateway.mcp_bridge.status RPC：检查 mcp-bridge 插件部署状态 + Blender MCP 连通性。

    返回：
        {"installed": bool, "blenderConnected": bool, "blenderAddress": str, "blenderError": str | None}

    blenderConnected 的判断逻辑：
    - 先检查 Gateway 是否运行中
    - 如果 Gateway 没运行，blenderConnected 一定为 false
    - 如果 Gateway 运行中，尝试通过 WebSocket 探测 Blender MCP Server 是否可达
    """
    try:
        installed = _dcc_installer.is_gateway_mcp_bridge_installed()
        blender_status = {"connected": False, "address": "", "error": None}
        if installed:
            # Bug #6 修复：先检查 Gateway 是否运行
            gateway_running = False
            try:
                gateway_running = _runtime.is_running()
            except Exception:
                pass

            if gateway_running:
                # Gateway 运行中：检测 Blender MCP Server 是否可达
                try:
                    blender_status = _mcp_bridge.check_blender_mcp_connection(timeout=3.0)
                except Exception as e:
                    blender_status = {
                        "connected": False,
                        "address": "",
                        "error": str(e),
                    }
            else:
                # Gateway 未运行：blenderConnected = False，附带提示
                blender_status = {
                    "connected": False,
                    "address": _mcp_bridge.MCPBridgeClient.get_instance().server_address,
                    "error": "Gateway 未运行，无法检测 MCP Bridge 连通性",
                }
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "installed": installed,
                "blenderConnected": blender_status.get("connected", False),
                "blenderAddress": blender_status.get("address", ""),
                "blenderError": blender_status.get("error"),
            },
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_dcc_port_get(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.port.get RPC：获取 DCC MCP Server 端口配置。

    参数：
        dcc (str): DCC 标识，如 "blender"

    返回：
        {"port": int, "url": str, "server_name": str}
    """
    dcc = params.get("dcc", "")
    if not dcc:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: dcc"},
        }

    try:
        result = _dcc_installer.get_dcc_port(dcc)
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_dcc_port_set(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.port.set RPC：设置 DCC MCP Server 端口。

    参数：
        dcc (str): DCC 标识
        port (int): 新端口号

    返回：
        {"success": bool, "port": int, "url": str, "error": str|None}
    """
    dcc = params.get("dcc", "")
    port = params.get("port", 0)

    if not dcc:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: dcc"},
        }
    if not isinstance(port, int) or port < 1024 or port > 65535:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": f"无效端口: {port}（范围 1024-65535）"},
        }

    try:
        result = _dcc_installer.set_dcc_port(dcc, port)
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_deploy_validate(req_id: Any, params: dict) -> dict:
    """openclaw.deploy.validate RPC：全局部署校验。

    遍历 deploy-manifest.json 中的所有部署项，对比磁盘文件的 sha256 校验和。
    返回每个部署项的状态：ok / outdated / missing / corrupted。

    Validate all deployments against deploy-manifest.json.
    Returns list of {id, status, target, sourceVersion, ...} per deployment.

    返回：
        {
            "deployments": [
                {
                    "id": str,
                    "status": "ok" | "outdated" | "missing" | "corrupted",
                    "target": str,
                    "sourceVersion": str,
                    "deployedAt": str,
                    "details": str,
                },
                ...
            ],
            "summary": {"total": int, "ok": int, "outdated": int, "missing": int, "corrupted": int},
        }
    """
    try:
        results = _dcc_installer.validate_all_deployments()
        summary = {
            "total": len(results),
            "ok": sum(1 for r in results if r["status"] == "ok"),
            "outdated": sum(1 for r in results if r["status"] == "outdated"),
            "missing": sum(1 for r in results if r["status"] == "missing"),
            "corrupted": sum(1 for r in results if r["status"] == "corrupted"),
        }
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "deployments": results,
                "summary": summary,
            },
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_shell_open_path(req_id: Any, params: dict) -> dict:
    """shell.open_path RPC：在操作系统中打开文件/目录/URL。

    参数：
        path (str): 要打开的文件路径、目录路径或 URL

    返回：
        {"success": bool, "error": str|None}
    """
    path = params.get("path", "")
    if not path:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: path"},
        }

    try:
        import os as _os
        import platform as _platform
        import subprocess as _subprocess

        system = _platform.system()
        if system == "Windows":
            _os.startfile(path)
        elif system == "Darwin":
            _subprocess.run(["open", path], check=True)
        else:
            _subprocess.run(["xdg-open", path], check=True)

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": True, "error": None},
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": False, "error": str(e)},
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
    # Deprecated（保留一个 release 周期；新前端请用 openclaw.web.open）
    "openclaw.web.get_url": _handle_openclaw_web_get_url,
    "openclaw.agent_preset.status": _handle_openclaw_agent_preset_status,
    "openclaw.agent_preset.reset_default": _handle_openclaw_agent_preset_reset,
    "openclaw.config.dump": _handle_openclaw_config_dump,
    "openclaw.config.patch": _handle_openclaw_config_patch,
    "openclaw.config.test_provider": _handle_openclaw_config_test_provider,
    "openclaw.auth.set_token": _handle_openclaw_auth_set_token,
    "openclaw.models.fetch_remote": _handle_openclaw_models_fetch_remote,
    # STORY-0024 M2：Blender MCP 桥接
    "openclaw.mcp.blender.run_python": _handle_openclaw_mcp_blender_run_python,
    # STORY-0026 M2：DCC 安装器
    "openclaw.dcc.blender.detect": _handle_openclaw_dcc_blender_detect,
    "openclaw.dcc.blender.install": _handle_openclaw_dcc_blender_install,
    "openclaw.dcc.blender.uninstall": _handle_openclaw_dcc_blender_uninstall,
    # STORY-0028 M2：Gateway MCP Bridge 插件部署
    "openclaw.gateway.mcp_bridge.install": _handle_openclaw_gateway_mcp_bridge_install,
    "openclaw.gateway.mcp_bridge.status": _handle_openclaw_gateway_mcp_bridge_status,
    # STORY-0029 M2：DCC 端口管理
    "openclaw.dcc.port.get": _handle_openclaw_dcc_port_get,
    "openclaw.dcc.port.set": _handle_openclaw_dcc_port_set,
    # STORY-0029 T2：全局部署校验
    "openclaw.deploy.validate": _handle_openclaw_deploy_validate,
    # STORY-0033 M3：Shell 打开路径（文件夹/文件/URL）
    "shell.open_path": _handle_shell_open_path,
    # STORY-0018 T2：Gateway 状态控制面板（实现在 sidecar_gateway.py）
    "openclaw.gateway.status": _sidecar_gateway.handle_gateway_status,
    "openclaw.gateway.start": _sidecar_gateway.handle_gateway_start,
    "openclaw.gateway.restart": _sidecar_gateway.handle_gateway_restart,
    "openclaw.gateway.tail_log": _sidecar_gateway.handle_gateway_tail_log,
    "openclaw.web.open": _sidecar_gateway.handle_web_open,
    # STORY-0039 M3：Chat WS 直连 — 前端需要 port + token 才能完成握手
    "openclaw.gateway.auth_info": _sidecar_gateway.handle_gateway_auth_info,
    # STORY-0039 M3：对话列表管理 — 前端需要列出/恢复 Gateway 对话
    "openclaw.sessions.list": _sidecar_sessions.handle_sessions_list,
    "openclaw.sessions.history": _sidecar_sessions.handle_sessions_history,
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


def _shutdown_gateway_quietly() -> None:
    """sidecar 退出时静默停掉 gateway 子进程，避免孤儿残留。

    Quiet shutdown hook: stop any gateway process spawned by this sidecar
    before the Python interpreter exits. Called from ``atexit`` and from
    signal handlers (SIGTERM / SIGINT / SIGBREAK on Windows).

    设计要点：
        - **幂等**：多次触发只生效一次（_runtime.stop_gateway 自身幂等）
        - **静默**：任何异常都吞掉（atexit 抛出会污染 stderr，且此时 stdout
          可能已关闭，写日志会引发 BrokenPipeError）
        - **快速**：不能阻塞 sidecar 退出超过 SHUTDOWN_TIMEOUT（5s）

    2026-05-12 修复：stdin EOF 退出（Rust 端重建 sidecar）时**不杀 gateway**。
        当 Rust SidecarManager 因 RPC 超时 drop 旧 client 并 spawn 新 sidecar
        时，旧 sidecar 收到 stdin EOF → main() 循环退出 → atexit 触发。
        此时 gateway 应该继续运行，由新 sidecar 接管。只有真正的终止信号
        （SIGTERM / SIGINT / SIGBREAK = Tauri 主进程退出）才应杀 gateway。
        通过 _exit_reason 全局变量区分退出原因。
    """
    try:
        if _exit_reason == "eof":
            # stdin EOF = Rust 端重建 sidecar，不杀 gateway
            return
        if _runtime.is_running():
            _runtime.stop_gateway()
    except Exception:
        pass


# sidecar 退出原因标记：
#   "eof"    = stdin EOF（Rust drop client 重建 sidecar）→ 不杀 gateway
#   "signal" = 终止信号（Tauri 主进程退出）→ 杀 gateway
#   "unknown"= 默认/异常退出 → 杀 gateway（安全兜底）
_exit_reason: str = "unknown"


def _signal_handler(signum: int, _frame: Any) -> None:
    """收到终止信号时停 gateway，然后正常退出。

    Signal handler: stop gateway then exit. ``atexit`` will fire as part of
    sys.exit, but we call shutdown explicitly to ensure stop_gateway runs even
    if some atexit handler upstream raises.
    """
    global _exit_reason
    _exit_reason = "signal"
    _shutdown_gateway_quietly()
    sys.exit(0)


def main() -> None:
    """stdio JSON-RPC 主循环：逐行读取 stdin，逐行写回 stdout。

    Main stdio JSON-RPC loop: reads NDJSON from stdin, writes NDJSON to stdout.

    Lifecycle hooks:
        - ``atexit``：覆盖正常退出 / 异常退出 / stdin EOF（Tauri 关窗时
          stdin 关闭 → for 循环结束 → main 返回 → atexit 触发）
        - SIGTERM：Tauri 主动 kill sidecar（POSIX）
        - SIGINT (Ctrl+C)：开发期手动中断
        - SIGBREAK：Windows CTRL_BREAK_EVENT（Tauri 退出时父进程 group break）
    """
    # 注册退出 hook
    atexit.register(_shutdown_gateway_quietly)
    sys.stderr.write("[sidecar.boot] atexit registered\n")
    sys.stderr.flush()

    # 注册信号 hook（Win/POSIX 通用 + Win 专属 SIGBREAK）
    try:
        signal.signal(signal.SIGTERM, _signal_handler)
        signal.signal(signal.SIGINT, _signal_handler)
        if hasattr(signal, "SIGBREAK"):  # Windows
            signal.signal(signal.SIGBREAK, _signal_handler)
    except (ValueError, OSError):
        # 在某些环境（比如 PyInstaller 子线程）下注册可能失败，不阻塞启动
        pass
    sys.stderr.write("[sidecar.boot] signal handlers installed\n")
    sys.stderr.flush()

    # STORY-0039：启动期 port-drift 自愈
    # 旧版 bootstrap_with_port_probe 可能把 gateway.port 迁到 19809/19829，
    # 启动时检测到就改回 19789（+ run/ports.json 同步）。任何异常吞掉——
    # 自愈失败不能阻塞 sidecar 主循环（前端还要靠它跑 openclaw.status）。
    try:
        _bootstrap.reset_config_port_if_drifted(_get_openclaw_home())
    except Exception as exc:
        sys.stderr.write(f"[sidecar.boot] port-drift self-heal raised: {exc!r}\n")
        sys.stderr.flush()

    # 启动调试打点：标记主循环已进入；用于排查 Tauri spawn 模式下
    # stdin 是否被 buffer 卡住、Python 是否真到达读取阶段。
    sys.stderr.write("[sidecar.main] entering stdin loop\n")
    sys.stderr.flush()

    # 用 readline() 替代 `for line in sys.stdin:` —— 后者在 Windows 命名管道上
    # 走 BufferedReader iterator 协议，可能预读整个 buffer 后才返回，
    # 与 Tauri PIPE 的"短行写入"配合不佳；readline() 一次只处理一行，
    # 行为更可预测。
    while True:
        try:
            line = sys.stdin.readline()
        except Exception as exc:
            sys.stderr.write(f"[sidecar.main] readline error: {exc!r}\n")
            sys.stderr.flush()
            break
        if not line:
            # EOF：Tauri 关窗 / stdin 被关 → 主循环退出
            # 标记为 EOF 退出 → atexit 不杀 gateway（Rust 端可能在重建 sidecar）
            global _exit_reason
            _exit_reason = "eof"
            sys.stderr.write("[sidecar.main] stdin EOF, exiting\n")
            sys.stderr.flush()
            break
        line = line.strip()
        if not line:
            continue
        # 调试打点：每条 RPC 入口
        try:
            preview = line[:140].replace("\n", " ")
        except Exception:
            preview = "<preview-failed>"
        sys.stderr.write(f"[sidecar.rpc] in: {preview}\n")
        sys.stderr.flush()
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
        # 调试打点：每条 RPC 出口
        try:
            method = request.get("method", "?")
        except Exception:
            method = "?"
        sys.stderr.write(f"[sidecar.rpc] out: {method}\n")
        sys.stderr.flush()


if __name__ == "__main__":
    main()
