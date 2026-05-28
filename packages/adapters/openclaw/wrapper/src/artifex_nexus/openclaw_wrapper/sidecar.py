"""
JSON-RPC 2.0 over stdio server — 常驻 sidecar 入口。

Protocol: NDJSON (one JSON object per line), no Content-Length header.
Methods: ping, get_port, openclaw.install, openclaw.bootstrap, openclaw.start,
         openclaw.stop, openclaw.doctor, openclaw.status, openclaw.list_versions,
         openclaw.upgrade, openclaw.rollback, openclaw.web.get_url,
         openclaw.agent_preset.status, openclaw.agent_preset.reset_default,
         openclaw.config.dump, openclaw.config.patch, openclaw.config.test_provider
         openclaw.auth.set_token,
         openclaw.backup, openclaw.restore, openclaw.backups.list,
         openclaw.backups.delete,
         skill.list, skill.detail, skill.install, skill.uninstall, skill.enable,
         skill.disable, skill.pin, skill.unpin, skill.favorite, skill.unfavorite,
         skill.sync, skill.publish, skill.batch, skill.search,
         nexus-tool.list, nexus-tool.detail, nexus-tool.create, nexus-tool.update,
         nexus-tool.delete, nexus-tool.enable, nexus-tool.disable, nexus-tool.pin,
         nexus-tool.unpin, nexus-tool.favorite, nexus-tool.unfavorite,
         nexus-tool.publish, nexus-tool.run, nexus-tool.batch

Lifecycle:
    sidecar 退出（正常 / Tauri 主进程关窗 / SIGTERM）时，必须主动停掉它
    spawn 的 gateway 子进程；否则会留下孤儿（见 runtime._cleanup_orphan_gateways
    的注释）。这通过 ``atexit`` + ``signal`` hook 实现。Windows 控制台关闭信号
    走 ``CTRL_BREAK_EVENT``；Tauri 主进程退出时会向 sidecar 的 stdin 关闭，
    主循环 EOF 自然退出 → 触发 atexit。
"""

import atexit
import json
import logging
import signal
import sys
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

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
    from . import skill_rpc as _skill_rpc
    from . import nexus_tool_rpc as _nexus_tool_rpc
    from . import app_settings as _app_settings
    from . import dcc_connections as _dcc_connections
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
    import skill_rpc as _skill_rpc  # type: ignore[no-redef]
    import nexus_tool_rpc as _nexus_tool_rpc  # type: ignore[no-redef]
    import app_settings as _app_settings  # type: ignore[no-redef]
    import dcc_connections as _dcc_connections  # type: ignore[no-redef]
    import web_ui as _web_ui  # type: ignore[no-redef]

sys.stderr.write("[sidecar.boot] all submodules imported\n")
sys.stderr.flush()

# ── SDK 路径注入 ────────────────────────────────────────────────────────

def _find_project_root() -> Path:
    """探测项目根目录（向上查找 pnpm-workspace.yaml）。

    用于定位 packages/dcc/shared/artifex_nexus_sdk/（SDK 单一源）。
    """
    current = Path(__file__).resolve().parent
    for _ in range(10):
        if (current / "pnpm-workspace.yaml").exists():
            return current
        current = current.parent
    # fallback: 基于已知的 monorepo 层级计算
    return Path(__file__).resolve().parents[7]


def _inject_sdk_path() -> None:
    """将 packages/dcc/shared/ 加入 sys.path，
    使工具脚本可以通过 ``import artifex_nexus_sdk as sdk`` 找到 SDK。

    遵循单一源原则：SDK 只有一份源，位于 packages/dcc/shared/artifex_nexus_sdk/。
    Nexus-Tool 统一存放在项目根 tools/{official,marketplace}/ 下。
    """
    try:
        _project_root = _find_project_root()
        _sdk_parent = _project_root / "packages" / "dcc" / "shared"
        _sdk_parent_str = str(_sdk_parent)
        if _sdk_parent.is_dir() and _sdk_parent_str not in sys.path:
            sys.path.insert(0, _sdk_parent_str)
            sys.stderr.write(
                f"[sidecar.boot] injected SDK path (single-source): {_sdk_parent_str}\n"
            )
        elif not _sdk_parent.is_dir():
            sys.stderr.write(
                f"[sidecar.boot] WARNING: SDK single-source not found at {_sdk_parent_str}\n"
            )
    except Exception as e:
        sys.stderr.write(f"[sidecar.boot] SDK path injection failed: {e}\n")


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
    logger.info("[sidecar] openclaw.install 请求, version=%s", params.get("version", "v2026.5.4"))
    version = _get_version(params)
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    prefix = params.get("prefix")

    # ── 安全网：安装/重装前先对整个 .openclaw/ 做容错全量快照 ──
    # 独立路径 ~/.artifexnexus/full-snapshots/<ts>/，永久保留（保留最近 3 份）
    try:
        snap = _bootstrap.create_full_snapshot(Path(openclaw_home))
        if snap.get("snapshot_dir"):
            logger.info(
                "[sidecar] full snapshot ready: %s (files=%d, skipped=%d)",
                snap["snapshot_dir"], snap.get("file_count", 0), snap.get("skipped_count", 0),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[sidecar] full snapshot 失败（继续安装）: %s", exc)

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
    logger.info("[sidecar] openclaw.bootstrap 请求, version=%s", params.get("version", "v2026.5.4"))
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
        _runtime._audit_log("STOP_GATEWAY:rpc_called", f"method=openclaw.stop req_id={req_id}")
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


# 上次 status 输出的关键字段快照（抑制稳态重复日志）
_last_status_snapshot: dict = {}


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

        # 2026-05-14：响应摘要日志（仅在状态变化时打印，抑制稳态噪声）
        _snap = {
            "cli_installed": result.get("cli_installed"),
            "bootstrap_done": result.get("bootstrap_done"),
            "gateway_running": result.get("gateway_running"),
            "pid": result.get("pid"),
            "version": result.get("version"),
        }
        if _snap != _last_status_snapshot:
            sys.stderr.write(
                f"[sidecar.status] cli_installed={_snap['cli_installed']} "
                f"bootstrap_done={_snap['bootstrap_done']} "
                f"gateway_running={_snap['gateway_running']} "
                f"pid={_snap['pid']} version={_snap['version']!r}\n"
            )
            sys.stderr.flush()
            _last_status_snapshot.clear()
            _last_status_snapshot.update(_snap)

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
        replacePaths (list[str], 可选): 让指定 dot/bracket 路径**整体替换**
            而非递归 merge。前端"删除 provider / model"应传：
            - patch 里给被删父路径一个不含被删项的新值（或 null 删 key）
            - replacePaths 加该父路径（如 ``["models.providers"]`` 或
              ``["models.providers.custom.models"]``）
        openclaw_home (str, 可选)

    返回：
        { success, validateError? }
    """
    openclaw_home = Path(params.get("openclaw_home", str(_get_openclaw_home())))
    patch_payload = params.get("patch", {})
    extras_patch = params.get("extrasPatch")
    replace_paths = params.get("replacePaths") or None
    if replace_paths is not None and not isinstance(replace_paths, list):
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "replacePaths 必须是 string[] 或省略"},
        }

    if not isinstance(patch_payload, dict):
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "patch 必须是 object"},
        }

    try:
        bin_path = _resolve_openclaw_bin(openclaw_home)
        result = _config_io.patch_config(
            bin_path, openclaw_home, patch_payload,
            extras_patch=extras_patch,
            replace_paths=replace_paths,
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
    双路径查找：先 .openclaw/agents/*/agent/auth-profiles.json（新路径），
    再 state/agents/*/agent/auth-profiles.json（旧路径），以适配上游
    v2026.5.4+ 的迁移。
    """
    openclaw_home = _get_openclaw_home()
    # 反向迭代：新路径优先（_iter_auth_profiles_files 是先旧后新）
    files = list(_config_io._iter_auth_profiles_files(openclaw_home))
    for filepath in reversed(files):
        try:
            data = json.loads(filepath.read_text(encoding="utf-8"))
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


# ── M5 UE 插件安装/卸载 RPC ──────────────────────────────────────────────

def _handle_openclaw_dcc_unreal_detect(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.unreal.detect RPC：检测可用 UE 插件版本。

    返回：
        {
            "versions": [{"version": "5.7", "source_dir": str, "compatible": bool}, ...],
            "plugin_info": {...}
        }
    """
    try:
        versions = _dcc_installer.find_ue_versions()
        plugin_info = _dcc_installer.get_ue_plugin_info()

        result_versions = []
        for ver in versions:
            try:
                src_dir = str(_dcc_installer._get_ue_plugin_src_dir(ver))
                compatible, reason = _dcc_installer.check_ue_version_compatibility(ver)
            except Exception:
                src_dir = ""
                compatible = False
                reason = f"目录不存在"
            result_versions.append({
                "version": ver,
                "source_dir": src_dir,
                "compatible": compatible,
                "compat_reason": reason,
            })

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "versions": result_versions,
                "plugin_info": {
                    "name": plugin_info.get("name", ""),
                    "version": ".".join(str(x) for x in plugin_info.get("version", (0, 1, 0))),
                    "ue_min": ".".join(str(x) for x in plugin_info.get("ue_min", (5, 7, 0))),
                    "ue_max": ".".join(str(x) for x in plugin_info.get("ue_max", (5, 7, 9))),
                },
            },
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_dcc_unreal_install(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.unreal.install RPC：安装 UE 插件到指定项目目录。

    参数：
        version (str): UE 版本号，如 "5.7" 或 "5.7.4"
        project_path (str): UE 项目根目录（包含 .uproject 的目录）
        force (bool, 可选): 是否覆盖已有安装（重装时保留 Lib/）

    返回：
        {"success": bool, "source_dir": str, "target": str, "error": str|None}
    """
    version = params.get("version", "")
    project_path = params.get("project_path", "")
    force = bool(params.get("force", False))

    if not version:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: version"},
        }
    if not project_path:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: project_path（UE 项目根目录）"},
        }

    try:
        result = _dcc_installer.install_ue_plugin(version, project_path=project_path, force=force)
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


def _handle_openclaw_dcc_unreal_uninstall(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.unreal.uninstall RPC：卸载 UE 插件。

    参数：
        version (str): UE 版本号（当前未使用，保留接口一致性）
        project_path (str): UE 项目根目录
        keep_lib (bool, 可选): True=重装场景保留 Lib/；False=完全删除

    返回：
        {"success": bool, "target": str, "error": str|None}
    """
    version = params.get("version", "")
    project_path = params.get("project_path", "")
    keep_lib = bool(params.get("keep_lib", False))

    if not project_path:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: project_path（UE 项目根目录）"},
        }

    try:
        result = _dcc_installer.uninstall_ue_plugin(version, project_path=project_path, keep_lib=keep_lib)
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


# ── M7 Maya & 3ds Max 插件 检测/安装/卸载 RPC ───────────────────────────

def _handle_openclaw_dcc_maya_detect(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.maya.detect RPC：检测本机 Maya 版本及插件安装状态。"""
    try:
        versions = _dcc_installer.find_maya_versions()
        addon_info = _dcc_installer.get_dcc_plugin_info("maya")

        result_versions = []
        for ver in versions:
            installed = _dcc_installer.is_dcc_addon_installed("maya", ver)
            compatible, reason = _dcc_installer.check_dcc_version_compatibility("maya", ver)
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
                    "version": ".".join(str(x) for x in addon_info.get("version", (0, 0, 0))),
                    "dcc_min": ".".join(str(x) for x in addon_info.get("dcc_min", (0, 0, 0))),
                    "dcc_max": ".".join(str(x) for x in addon_info.get("dcc_max", (0,))) if addon_info.get("dcc_max") else None,
                },
            },
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_dcc_maya_install(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.maya.install RPC：安装插件到指定 Maya 版本。"""
    version = params.get("version", "")
    force = bool(params.get("force", False))

    if not version:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: version"},
        }

    try:
        result = _dcc_installer.install_maya_addon(version, force=force)
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


def _handle_openclaw_dcc_maya_uninstall(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.maya.uninstall RPC：卸载 Maya 插件。"""
    version = params.get("version", "")

    if not version:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: version"},
        }

    try:
        result = _dcc_installer.uninstall_maya_addon(version)
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


def _handle_openclaw_dcc_max_detect(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.max.detect RPC：检测本机 3ds Max 版本及插件安装状态。"""
    try:
        versions = _dcc_installer.find_max_versions()
        addon_info = _dcc_installer.get_dcc_plugin_info("3ds_max")

        result_versions = []
        for ver in versions:
            installed = _dcc_installer.is_dcc_addon_installed("3ds_max", ver)
            compatible, reason = _dcc_installer.check_dcc_version_compatibility("3ds_max", ver)
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
                    "version": ".".join(str(x) for x in addon_info.get("version", (0, 0, 0))),
                    "dcc_min": ".".join(str(x) for x in addon_info.get("dcc_min", (0, 0, 0))),
                    "dcc_max": ".".join(str(x) for x in addon_info.get("dcc_max", (0,))) if addon_info.get("dcc_max") else None,
                },
            },
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_dcc_max_install(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.max.install RPC：安装插件到指定 3ds Max 版本。"""
    version = params.get("version", "")
    force = bool(params.get("force", False))

    if not version:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: version"},
        }

    try:
        result = _dcc_installer.install_max_addon(version, force=force)
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


def _handle_openclaw_dcc_max_uninstall(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.max.uninstall RPC：卸载 3ds Max 插件。"""
    version = params.get("version", "")

    if not version:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: version"},
        }

    try:
        result = _dcc_installer.uninstall_max_addon(version)
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


def _handle_openclaw_dcc_plugin_versions(req_id: Any, params: dict) -> dict:
    """获取指定 DCC 所有可用的插件版本及兼容范围。"""
    try:
        dcc = params.get("dcc", "")
        if dcc not in ("maya", "3ds_max", "blender", "unreal_engine"):
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32602, "message": f"不支持的 DCC: {dcc}"},
            }
        versions = _dcc_installer.get_available_plugin_versions(dcc)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"versions": versions},
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_dcc_plugin_all(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.plugin.all：获取所有 DCC 所有版本的插件兼容信息。"""
    try:
        plugins = _dcc_installer._cached_get_all_plugins()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"plugins": plugins},
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_dcc_plugin_compat_update(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.plugin.compat_update：更新插件兼容范围。"""
    try:
        dcc = params.get("dcc", "")
        version = params.get("version", "")
        dcc_min = params.get("dcc_min", "")
        dcc_max = params.get("dcc_max")
        result = _dcc_installer.update_plugin_compatibility(dcc, version, dcc_min, dcc_max)
        _dcc_installer._invalidate_plugin_cache()
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_dcc_plugin_compat_reset(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.plugin.compat_reset：重置插件兼容范围为内置默认值。"""
    try:
        dcc = params.get("dcc", "")
        version = params.get("version", "")
        result = _dcc_installer.reset_plugin_compatibility(dcc, version)
        _dcc_installer._invalidate_plugin_cache()
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
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
    """openclaw.gateway.mcp_bridge.status RPC：检查 mcp-bridge 插件部署状态 + Blender/UE/Maya/Max MCP 连通性 + 过时检测。

    返回：
        {
            "installed": bool,
            "blenderConnected": bool,
            "blenderServerRunning": bool,
            "blenderAddress": str,
            "blenderError": str | None,
            "unrealConnected": bool,
            "unrealServerRunning": bool,
            "unrealAddress": str,
            "unrealError": str | None,
            "mayaConnected": bool,
            "mayaServerRunning": bool,
            "mayaAddress": str,
            "mayaError": str | None,
            "maxConnected": bool,
            "maxServerRunning": bool,
            "maxAddress": str,
            "maxError": str | None,
            "upToDate": bool,
            "sourceHash": str | None,
            "deployedHash": str | None,
        }

    blenderServerRunning 与 blenderConnected 的区别：
    - blenderServerRunning：纯 TCP socket connect 到端口，仅判断进程是否在监听。
      用于区分"Blender 未启动"（端口无人监听 → don't show）和
      "Blender 已启动但 MCP 未就绪"（端口有人监听但握手失败 → 黄色）。
    - blenderConnected：WebSocket 连接 + MCP initialize 握手完成 → 绿色。

    blenderConnected 的判断逻辑：
    - 先检查 Gateway 是否运行中
    - 如果 Gateway 没运行，blenderConnected 一定为 false
    - 如果 Gateway 运行中，尝试通过 WebSocket 探测 Blender MCP Server 是否可达
    """
    try:
        installed = _dcc_installer.is_gateway_mcp_bridge_installed()

        # C1: 过时检测
        freshness = {"upToDate": False, "sourceHash": None, "deployedHash": None, "error": None}
        if installed:
            try:
                freshness = _dcc_installer.check_mcp_bridge_freshness()
            except Exception as e:
                freshness["error"] = str(e)

        blender_status = {"connected": False, "address": "", "error": None}
        blender_server_running = False
        if installed:
            # Bug #6 修复：先检查 Gateway 是否运行
            gateway_running = False
            try:
                gateway_running = _runtime.is_running()
            except Exception as e:
                logger.warning("is_running() failed during status fetch: %s", e, exc_info=True)

            if gateway_running:
                # 先做轻量 TCP 探测（快速，无 MCP 协议开销）
                try:
                    blender_server_running = _mcp_bridge.check_blender_mcp_server_running(timeout=1.0)
                except Exception as e:
                    logger.warning("check_blender_mcp_server_running() failed: %s", e, exc_info=True)

                # 如果 TCP 可达，再做 MCP 握手检测
                if blender_server_running:
                    try:
                        blender_status = _mcp_bridge.check_blender_mcp_connection(timeout=3.0)
                    except Exception as e:
                        blender_status = {
                            "connected": False,
                            "address": "",
                            "error": str(e),
                        }
                else:
                    blender_status = {
                        "connected": False,
                        "address": _mcp_bridge.MCPBridgeClient.get_instance().server_address,
                        "error": "Blender MCP Server 未启动（端口无监听）",
                    }
            else:
                # Gateway 未运行：blenderConnected = False，附带提示
                blender_status = {
                    "connected": False,
                    "address": _mcp_bridge.MCPBridgeClient.get_instance().server_address,
                    "error": "Gateway 未运行，无法检测 MCP Bridge 连通性",
                }
        # ── UE MCP 连通性检测（与 Blender 并行） ──
        unreal_server_running = False
        unreal_status = {"connected": False, "address": "ws://127.0.0.1:18080", "error": None}
        if installed and gateway_running:
            try:
                unreal_server_running = _mcp_bridge.check_unreal_mcp_server_running(timeout=1.0)
            except Exception as e:
                logger.warning("check_unreal_mcp_server_running() failed: %s", e, exc_info=True)

            if unreal_server_running:
                try:
                    unreal_status = _mcp_bridge.check_unreal_mcp_connection(timeout=3.0)
                except Exception as e:
                    unreal_status = {
                        "connected": False,
                        "address": unreal_status.get("address", "ws://127.0.0.1:18080"),
                        "error": str(e),
                    }
            else:
                unreal_status = {
                    "connected": False,
                    "address": "ws://127.0.0.1:18080",
                    "error": "UE MCP Server 未启动（端口无监听）",
                }
        elif not gateway_running:
            unreal_status = {
                "connected": False,
                "address": "ws://127.0.0.1:18080",
                "error": "Gateway 未运行，无法检测 MCP Bridge 连通性",
            }

        # ── Maya MCP 连通性检测 ──
        maya_server_running = False
        maya_status = {"connected": False, "address": "ws://127.0.0.1:18081", "error": None}
        if installed and gateway_running:
            try:
                maya_server_running = _mcp_bridge.check_maya_mcp_server_running(timeout=1.0)
            except Exception as e:
                logger.warning("check_maya_mcp_server_running() failed: %s", e, exc_info=True)
            if maya_server_running:
                try:
                    maya_status = _mcp_bridge.check_maya_mcp_connection(timeout=3.0)
                except Exception as e:
                    maya_status = {"connected": False, "address": "ws://127.0.0.1:18081", "error": str(e)}
            else:
                maya_status = {"connected": False, "address": "ws://127.0.0.1:18081", "error": "Maya MCP Server 未启动"}
        elif not gateway_running:
            maya_status = {"connected": False, "address": "ws://127.0.0.1:18081", "error": "Gateway 未运行"}

        # ── 3ds Max MCP 连通性检测 ──
        max_server_running = False
        max_status = {"connected": False, "address": "ws://127.0.0.1:18082", "error": None}
        if installed and gateway_running:
            try:
                max_server_running = _mcp_bridge.check_max_mcp_server_running(timeout=1.0)
            except Exception as e:
                logger.warning("check_max_mcp_server_running() failed: %s", e, exc_info=True)
            if max_server_running:
                try:
                    max_status = _mcp_bridge.check_max_mcp_connection(timeout=3.0)
                except Exception as e:
                    max_status = {"connected": False, "address": "ws://127.0.0.1:18082", "error": str(e)}
            else:
                max_status = {"connected": False, "address": "ws://127.0.0.1:18082", "error": "3ds Max MCP Server 未启动"}
        elif not gateway_running:
            max_status = {"connected": False, "address": "ws://127.0.0.1:18082", "error": "Gateway 未运行"}

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "installed": installed,
                "blenderConnected": blender_status.get("connected", False),
                "blenderServerRunning": blender_server_running,
                "blenderAddress": blender_status.get("address", ""),
                "blenderError": blender_status.get("error"),
                "unrealConnected": unreal_status.get("connected", False),
                "unrealServerRunning": unreal_server_running,
                "unrealAddress": unreal_status.get("address", ""),
                "unrealError": unreal_status.get("error"),
                "mayaConnected": maya_status.get("connected", False),
                "mayaServerRunning": maya_server_running,
                "mayaAddress": maya_status.get("address", ""),
                "mayaError": maya_status.get("error"),
                "maxConnected": max_status.get("connected", False),
                "maxServerRunning": max_server_running,
                "maxAddress": max_status.get("address", ""),
                "maxError": max_status.get("error"),
                "upToDate": freshness.get("upToDate", False),
                "sourceHash": freshness.get("sourceHash"),
                "deployedHash": freshness.get("deployedHash"),
            },
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_openclaw_gateway_mcp_bridge_uninstall(req_id: Any, params: dict) -> dict:
    """openclaw.gateway.mcp_bridge.uninstall RPC：卸载 mcp-bridge 插件。

    返回：
        {"success": bool, "target": str, "error": str|None}
    """
    try:
        result = _dcc_installer.uninstall_gateway_mcp_bridge()
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


def _handle_openclaw_deploy_repair(req_id: Any, params: dict) -> dict:
    """openclaw.deploy.repair RPC：修复指定部署项（重新部署以同步 manifest）。

    参数：
        dep_id (str): 部署项 ID（如 "gateway-mcp-bridge"）
    """
    dep_id = params.get("dep_id")
    if not dep_id:
        return {
            "jsonrpc": "2.0", "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: dep_id"},
        }
    try:
        result = _dcc_installer.repair_deployment(dep_id)
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    except Exception as e:
        return {
            "jsonrpc": "2.0", "id": req_id,
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
# Nexus Tool 源码目录管理 RPC
# ---------------------------------------------------------------------------

def _handle_tool_sources_list(req_id: Any, params: dict) -> dict:
    """列出所有已注册的 Nexus Tool / Skill 源码目录。"""
    try:
        from . import tool_sources as _ts
    except ImportError:
        import tool_sources as _ts  # type: ignore[no-redef]

    source_type = params.get("type")
    sources = _ts.get_sources(source_type)
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {"sources": sources},
    }


def _handle_tool_sources_register(req_id: Any, params: dict) -> dict:
    """注册一个新的 Nexus Tool / Skill 源码目录。"""
    try:
        from . import tool_sources as _ts
    except ImportError:
        import tool_sources as _ts  # type: ignore[no-redef]

    path = params.get("path", "")
    source_type = params.get("type", "user")
    updated_by = params.get("updated_by", "rpc")

    if not path:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": False, "error": "path is required"},
        }

    ok = _ts.register_source(path, source_type, updated_by)
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {"success": ok},
    }


def _handle_tool_sources_verify(req_id: Any, params: dict) -> dict:
    """验证所有已注册的源码目录并刷新统计信息。"""
    try:
        from . import tool_sources as _ts
    except ImportError:
        import tool_sources as _ts  # type: ignore[no-redef]

    result = _ts.verify_and_refresh()
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": result,
    }


# ---------------------------------------------------------------------------
# STORY-0041：备份-安装-恢复 RPC
# ---------------------------------------------------------------------------


def _handle_openclaw_backup(req_id: Any, params: dict) -> dict:
    """openclaw.backup RPC：Phase 1 备份用户数据。

    参数：
        preserve_options (dict): 5 个勾选项键
            - preserveProvidersAndAuth (bool)
            - preserveAgents (bool)
            - preservePluginsAndMemory (bool)
            - preserveMCPServers (bool)
            - preserveSkills (bool)
        openclaw_home (str, 可选): OPENCLAW_HOME 路径

    返回：
        { success, backup_dir, timestamp, manifest, total_size_bytes, items }
    """
    logger.info("[sidecar] openclaw.backup 请求, options=%s", list(params.get("preserve_options", {}).keys()))
    import time as _time

    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    preserve_options = params.get("preserve_options", {})
    if not preserve_options:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "success": False,
                "error": "preserve_options 为空，无数据可备份",
            },
        }

    # ── 安全网：备份前同时做一次整个 .openclaw/ 的容错全量快照 ──
    # 独立路径，永久保留（保留最近 3 份）。即使后续 restore 删了选择性备份目录也不丢
    full_snapshot_info: dict | None = None
    try:
        full_snapshot_info = _bootstrap.create_full_snapshot(Path(openclaw_home))
        if full_snapshot_info.get("snapshot_dir"):
            logger.info(
                "[sidecar] full snapshot ready: %s (files=%d, skipped=%d)",
                full_snapshot_info["snapshot_dir"],
                full_snapshot_info.get("file_count", 0),
                full_snapshot_info.get("skipped_count", 0),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[sidecar] full snapshot 失败（继续备份）: %s", exc)

    timestamp = f"{_time.time():.0f}"
    backup_dir = Path(openclaw_home).parent / "backups" / timestamp

    try:
        manifest = _bootstrap._backup_for_reinstall(
            Path(openclaw_home), preserve_options, backup_dir,
        )
        item_keys = sorted(manifest.get("items", {}).keys())
        skipped = manifest.get("skipped", []) or []
        _invalidate_backups_cache()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "success": True,
                "backup_dir": str(backup_dir),
                "timestamp": timestamp,
                "manifest": manifest,
                "total_size_bytes": manifest.get("total_size_bytes", 0),
                "items": item_keys,
                "skipped_count": len(skipped),
                "skipped": skipped[:20],  # 截断避免响应过大
                "full_snapshot": full_snapshot_info,  # 安全网快照位置
            },
        }
    except Exception as exc:
        logger.exception("backup 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": False, "error": str(exc)},
        }


def _handle_openclaw_restore(req_id: Any, params: dict) -> dict:
    """openclaw.restore RPC：Phase 2-3 全新安装 + 恢复

    参数：
        backup_timestamp (str): 备份时间戳
        preserve_options (dict): 要恢复的勾选项
        openclaw_home (str, 可选): OPENCLAW_HOME 路径
        version (str, 可选): 版本号

    返回：
        { success, message, errors[]? }
    """
    logger.info("[sidecar] openclaw.restore 请求, ts=%s, version=%s", params.get("backup_timestamp"), params.get("version", "v2026.5.4"))
    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    backup_timestamp = params.get("backup_timestamp")
    preserve_options = params.get("preserve_options", {})
    version = params.get("version", "v2026.5.4")

    if not backup_timestamp:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": False, "error": "缺少 backup_timestamp 参数"},
        }

    backup_dir = Path(openclaw_home).parent / "backups" / backup_timestamp
    manifest_path = backup_dir / "backup-manifest.json"

    if not manifest_path.exists():
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "success": False,
                "error": f"备份 {backup_timestamp} 不存在或 manifest 缺失",
            },
        }

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": False, "error": f"manifest 读取失败: {exc}"},
        }

    import shutil

    openclaw_home_path = Path(openclaw_home).expanduser().resolve()
    backup_dir_resolved = Path(backup_dir).expanduser().resolve()

    try:
        # ── 安全网快照已由 backup handler 在备份阶段创建（位于
        # ~/.artifexnexus/full-snapshots/）。此处不再重复创建。 ──

        # Phase 2: 全新安装
        _bootstrap._clean_install(openclaw_home_path)

        # 全量重装 CLI（匹配目标版本，替换被 _clean_install 删除的旧 CLI）
        cli_prefix = openclaw_home_path / "cli" / version
        cli_events = list(_installer.install_openclaw(
            version=version,
            prefix=str(cli_prefix),
            openclaw_home=str(openclaw_home_path),
        ))
        cli_result = _installer.get_install_result(
            cli_events, prefix=cli_prefix, version=version,
        )
        if not cli_result.success:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "success": False,
                    "error": f"CLI 安装失败: {cli_result.error_message or '未知错误'}",
                },
            }

        bootstrap_result = _bootstrap.bootstrap(
            openclaw_home_path, version=version,
        )
        if not bootstrap_result.success:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "success": False,
                    "error": f"bootstrap 失败: {bootstrap_result.error_message}",
                },
            }

        # Phase 3: 恢复
        restore_result = _bootstrap._restore_from_backup(
            openclaw_home_path, backup_dir_resolved, preserve_options, manifest,
        )

        if restore_result["success"]:
            # 成功后删除选择性备份 + 安全网
            shutil.rmtree(str(backup_dir_resolved), ignore_errors=True)
            logger.info("restore: 已清理备份 %s", backup_timestamp)
            _invalidate_backups_cache()

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "success": restore_result["success"],
                "message": "恢复完成" if restore_result["success"] else "部分恢复失败",
                "errors": restore_result.get("errors"),
            },
        }
    except Exception as exc:
        logger.exception("restore 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": False, "error": str(exc)},
        }


# ── 备份列表缓存（避免每次页面打开都 rglob 计算大小）─────────────────────
_BACKUPS_CACHE_TTL = 60.0  # 备份列表变更频率低，60s TTL
_backups_cache: dict = {"ts": 0.0, "data": None}


def _invalidate_backups_cache() -> None:
    _backups_cache["ts"] = 0.0
    _backups_cache["data"] = None


def _handle_openclaw_backups_list(req_id: Any, params: dict) -> dict:
    """openclaw.backups.list RPC：列出所有备份。

    参数：
        openclaw_home (str, 可选): OPENCLAW_HOME 路径

    返回：
        { backups: [{timestamp, size_bytes, item_count, items[], created}] }
    """
    import time as _time

    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))

    # ── 缓存检查 ──
    cache_key = f"backups:{openclaw_home}"
    cached = _backups_cache.get(cache_key)
    now = _time.time()
    if cached and now - cached["ts"] < _BACKUPS_CACHE_TTL:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": cached["data"],
        }

    backups_dir = Path(openclaw_home).parent / "backups"

    if not backups_dir.is_dir():
        empty_data = {"backups": []}
        _backups_cache[cache_key] = {"ts": now, "data": empty_data}
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": empty_data,
        }

    backups: list[dict] = []
    for entry in sorted(backups_dir.iterdir(), reverse=True):
        if not entry.is_dir():
            continue
        manifest_path = entry / "backup-manifest.json"
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            total_size = sum(
                f.stat().st_size for f in entry.rglob("*") if f.is_file()
            )
            backups.append({
                "timestamp": entry.name,
                "size_bytes": total_size,
                "item_count": len(manifest.get("items", {})),
                "items": sorted(manifest.get("items", {}).keys()),
                "created": manifest.get("timestamp", 0),
            })
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("backups.list: 跳过 %s: %s", entry.name, exc)

    result_data = {"backups": backups}
    _backups_cache[cache_key] = {"ts": now, "data": result_data}
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": result_data,
    }


def _handle_openclaw_backups_delete(req_id: Any, params: dict) -> dict:
    """openclaw.backups.delete RPC：删除指定备份。

    参数：
        timestamp (str): 备份时间戳
        openclaw_home (str, 可选): OPENCLAW_HOME 路径

    返回：
        { success, message }
    """
    import shutil

    timestamp = params.get("timestamp")
    if not timestamp:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": False, "error": "缺少 timestamp 参数"},
        }

    openclaw_home = params.get("openclaw_home", str(_get_openclaw_home()))
    backup_dir = Path(openclaw_home).parent / "backups" / timestamp

    if not backup_dir.is_dir():
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": False, "error": f"备份 {timestamp} 不存在"},
        }

    try:
        shutil.rmtree(str(backup_dir))
        logger.info("backups.delete: 已删除 %s", backup_dir)
        _invalidate_backups_cache()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": True, "message": f"备份 {timestamp} 已删除"},
        }
    except OSError as exc:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"success": False, "error": str(exc)},
        }


# ---------------------------------------------------------------------------
# 方法路由表
# ── 触发器诊断 RPC ───────────────────────────────────────────────────────

def _handle_trigger_diagnose(req_id: Any, params: dict) -> dict:
    """openclaw.trigger.diagnose RPC：诊断触发器系统的连接和注册状态。

    返回:
        connected: MCPBridgeClient 是否已连接 Blender MCP Server
        server_address: MCP Bridge 目标地址
        tools_total: 已注册的带触发器工具总数
        triggers_total: 已注册的触发器规则总数
        event_index: {event_type: [tool_id, ...]} 事件→工具映射
    """
    try:
        from artifex_nexus.openclaw_wrapper.mcp_bridge import MCPBridgeClient
    except ImportError:
        from mcp_bridge import MCPBridgeClient  # type: ignore[no-redef]

    client = MCPBridgeClient.get_instance()
    connected = client.is_connected
    server_address = client.server_address

    # 获取已注册的工具和触发器信息
    tools_total = 0
    triggers_total = 0
    event_index: dict[str, list[str]] = {}

    dispatcher = _trigger_dispatcher_instance
    if dispatcher is not None:
        # 如果还没加载工具，手动触发加载
        if not dispatcher._loaded:
            try:
                dispatcher._load_tools()
            except Exception:
                pass
        tools_total = len(dispatcher._tool_registry)
        triggers_total = sum(len(v["triggers"]) for v in dispatcher._tool_registry.values())
        event_index = dict(dispatcher._event_index)

    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {
            "connected": connected,
            "server_address": server_address,
            "tools_total": tools_total,
            "triggers_total": triggers_total,
            "event_index": event_index,
        },
    }


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
    # STORY-0051 M5：UE 插件安装/卸载
    "openclaw.dcc.unreal.detect": _handle_openclaw_dcc_unreal_detect,
    "openclaw.dcc.unreal.install": _handle_openclaw_dcc_unreal_install,
    "openclaw.dcc.unreal.uninstall": _handle_openclaw_dcc_unreal_uninstall,
    # STORY-0063/0064 M7：Maya & 3ds Max 插件安装/卸载
    "openclaw.dcc.maya.detect": _handle_openclaw_dcc_maya_detect,
    "openclaw.dcc.maya.install": _handle_openclaw_dcc_maya_install,
    "openclaw.dcc.maya.uninstall": _handle_openclaw_dcc_maya_uninstall,
    "openclaw.dcc.max.detect": _handle_openclaw_dcc_max_detect,
    "openclaw.dcc.max.install": _handle_openclaw_dcc_max_install,
    "openclaw.dcc.max.uninstall": _handle_openclaw_dcc_max_uninstall,
    "openclaw.dcc.plugin.versions": _handle_openclaw_dcc_plugin_versions,
    "openclaw.dcc.plugin.all": _handle_openclaw_dcc_plugin_all,
    "openclaw.dcc.plugin.compat_update": _handle_openclaw_dcc_plugin_compat_update,
    "openclaw.dcc.plugin.compat_reset": _handle_openclaw_dcc_plugin_compat_reset,
    # STORY-0028 M2：Gateway MCP Bridge 插件部署
    "openclaw.gateway.mcp_bridge.install": _handle_openclaw_gateway_mcp_bridge_install,
    "openclaw.gateway.mcp_bridge.status": _handle_openclaw_gateway_mcp_bridge_status,
    "openclaw.gateway.mcp_bridge.uninstall": _handle_openclaw_gateway_mcp_bridge_uninstall,
    # 触发器诊断
    "openclaw.trigger.diagnose": _handle_trigger_diagnose,
    # STORY-0029 M2：DCC 端口管理
    "openclaw.dcc.port.get": _handle_openclaw_dcc_port_get,
    "openclaw.dcc.port.set": _handle_openclaw_dcc_port_set,
    # DCC 连接状态统一查询（v2: agent 无需逐个探测）
    **_dcc_connections.DCC_CONNECTIONS_METHODS,
    # STORY-0029 T2：全局部署校验
    "openclaw.deploy.validate": _handle_openclaw_deploy_validate,
    "openclaw.deploy.repair": _handle_openclaw_deploy_repair,
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
    # STORY-0041：备份-安装-恢复
    "openclaw.backup": _handle_openclaw_backup,
    "openclaw.restore": _handle_openclaw_restore,
    "openclaw.backups.list": _handle_openclaw_backups_list,
    "openclaw.backups.delete": _handle_openclaw_backups_delete,
    # STORY-0046：Skill / Nexus-Tool RPC（27 方法，不含 nexus-tool.run）
    **_skill_rpc.SKILL_METHODS,
    **_nexus_tool_rpc.NEXUS_TOOL_METHODS,
    # 应用级设置（设置页 → 常规）
    **_app_settings.APP_SETTINGS_METHODS,
    # Nexus Tool 源码目录管理
    "tool_sources.list": _handle_tool_sources_list,
    "tool_sources.register": _handle_tool_sources_register,
    "tool_sources.verify": _handle_tool_sources_verify,
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
        import traceback
        sys.stderr.write(
            f"[sidecar.rpc] handler error: method={method} error={e}\n"
            f"{traceback.format_exc()}\n"
        )
        sys.stderr.flush()
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
            try:
                sys.stderr.write(f"[sidecar.audit] _shutdown_gateway_quietly: SKIP (reason=stdin_eof, gateway 保留给新 sidecar 接管)\n")
                sys.stderr.flush()
            except Exception:
                pass
            return
        if _runtime.is_running():
            try:
                sys.stderr.write(f"[sidecar.audit] _shutdown_gateway_quietly: KILLING (exit_reason={_exit_reason})\n")
                sys.stderr.flush()
            except Exception:
                pass
            _runtime._audit_log(
                "STOP_GATEWAY:sidecar_exiting",
                f"exit_reason={_exit_reason}",
            )
            _runtime.stop_gateway()
    except Exception as e:
        logger.warning("stop_gateway failed during exit cleanup: %s", e, exc_info=True)


# sidecar 退出原因标记：
#   "eof"    = stdin EOF（Rust drop client 重建 sidecar）→ 不杀 gateway
#   "signal" = 终止信号（Tauri 主进程退出）→ 杀 gateway
#   "unknown"= 默认/异常退出 → 杀 gateway（安全兜底）
_exit_reason: str = "unknown"

# 触发器调度器实例引用（由 _init_trigger_dispatcher() 设置，供诊断 RPC 访问）
_trigger_dispatcher_instance: Any = None


def _signal_handler(signum: int, _frame: Any) -> None:
    """收到终止信号时停 gateway，然后正常退出。

    Signal handler: stop gateway then exit. ``atexit`` will fire as part of
    sys.exit, but we call shutdown explicitly to ensure stop_gateway runs even
    if some atexit handler upstream raises.
    """
    global _exit_reason
    _exit_reason = "signal"
    try:
        sys.stderr.write(f"[sidecar.audit] signal_handler: signum={signum} → exit_reason=signal → killing gateway\n")
        sys.stderr.flush()
    except Exception:
        pass
    _shutdown_gateway_quietly()
    sys.exit(0)


# 高频轮询方法：成功时静默 RPC 出入日志（状态变化在各自的 handler 中单独打点）
_POLL_METHODS = frozenset({
    "openclaw.status",
    "openclaw.gateway.status",
    "openclaw.gateway.auth_info",
    "openclaw.dcc.port.get",
    "openclaw.gateway.mcp_bridge.status",
    "openclaw.gateway.tail_log",
})


def _init_trigger_dispatcher() -> None:
    """初始化触发器调度引擎并注册到 MCPBridgeClient。

    在 sidecar 主循环启动前调用，确保 Blender 触发事件
    能被正确接收、匹配并回传结果。

    注册回调后立即建立到 Blender MCP Server 的持久连接，
    否则 broadcast_trigger_event 发现 _clients 为空会跳过广播。

    同时启动后台重连线程：sidecar 可能在 Blender 之前启动，
    初次 connect() 失败后需要周期性重试，确保 Blender 启动后
    自动恢复连接。
    """
    global _trigger_dispatcher_instance  # 供诊断 RPC 访问
    import threading as _threading
    import time as _time

    try:
        from artifex_nexus.openclaw_wrapper.trigger_dispatcher import TriggerDispatcher
        from artifex_nexus.openclaw_wrapper.mcp_bridge import MCPBridgeClient

        dispatcher = TriggerDispatcher()
        _trigger_dispatcher_instance = dispatcher
        client = MCPBridgeClient.get_instance()
        client.on_trigger_event(dispatcher.on_trigger_event)

        # 建立持久连接以接收 Blender trigger_event 广播
        # MCPBridgeClient 的 _message_reader 持续监听 WS 消息，
        #    当收到 type="trigger_event" 时回调 dispatcher.on_trigger_event
        if not client.is_connected:
            connected = client.connect()
            if connected:
                sys.stderr.write("[sidecar.boot] TriggerDispatcher connected to Blender MCP\n")
            else:
                sys.stderr.write("[sidecar.boot] TriggerDispatcher: Blender MCP not reachable, starting reconnect loop\n")
                # ── 后台重连循环 ──
                _reconnect_flag = {"stop": False, "interval": 10.0}

                def _reconnect_loop():
                    _time.sleep(_reconnect_flag["interval"])
                    while not _reconnect_flag["stop"]:
                        try:
                            if not client.is_connected:
                                if client.connect():
                                    sys.stderr.write("[sidecar.reconnect] TriggerDispatcher reconnected to Blender MCP\n")
                                    sys.stderr.flush()
                                    break  # 连上了，退出重连循环
                        except Exception:
                            pass
                        _time.sleep(_reconnect_flag["interval"])

                t = _threading.Thread(target=_reconnect_loop, daemon=True, name="trigger-reconnect")
                t.start()
        else:
            sys.stderr.write("[sidecar.boot] TriggerDispatcher: MCPBridgeClient already connected\n")

        sys.stderr.write("[sidecar.boot] TriggerDispatcher initialized\n")
    except Exception as exc:
        sys.stderr.write(f"[sidecar.boot] TriggerDispatcher init failed: {exc!r}\n")
    sys.stderr.flush()


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
    # ── 注入 artifex_nexus_sdk 路径（单一源：packages/dcc/shared/）──
    _inject_sdk_path()

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

    # ── 启动期清理残留 sidecar 进程（防御性深度保护） ──
    # Rust 端 preflight::kill_python_sidecars() 也会做同样操作，但 Python 端
    # 再加一层确保万无一失。对于 dev.bat 反复重启、Tauri 异常退出等场景，
    # 旧 sidecar 可能还在跑，必须先清掉再继续。
    try:
        killed = _runtime.kill_existing_sidecars()
        if killed:
            sys.stderr.write(
                f"[sidecar.boot] killed {killed} stale sidecar(s)\n"
            )
        else:
            sys.stderr.write("[sidecar.boot] no stale sidecars found\n")
        sys.stderr.flush()
    except Exception as exc:
        sys.stderr.write(f"[sidecar.boot] sidecar cleanup failed (non-fatal): {exc!r}\n")
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

    # ── 启动期验证和刷新 tool-sources.json ──
    try:
        from . import tool_sources as _ts
    except ImportError:
        import tool_sources as _ts  # type: ignore[no-redef]
    try:
        result = _ts.verify_and_refresh()
        if result["missing"] > 0:
            sys.stderr.write(
                f"[sidecar.boot] tool-sources: {result['valid']}/{result['total']} valid, "
                f"{result['missing']} missing\n"
            )
        else:
            sys.stderr.write(
                f"[sidecar.boot] tool-sources verified: {result['total']} source(s) OK\n"
            )
        sys.stderr.flush()
    except Exception as exc:
        sys.stderr.write(f"[sidecar.boot] tool-sources verify failed (non-fatal): {exc!r}\n")
        sys.stderr.flush()

    # ── 确保 sdk_path 已写入（已有安装可能缺此字段，sidecar 启动时自动补齐）──
    try:
        if _ts.get_sdk_path() is None:
            project_root = _find_project_root()
            sdk_parent = project_root / "packages" / "dcc" / "shared"
            if sdk_parent.is_dir():
                _ts.set_sdk_path(str(sdk_parent))
                sys.stderr.write(f"[sidecar.boot] sdk_path auto-populated: {sdk_parent}\n")
            else:
                sys.stderr.write(f"[sidecar.boot] sdk_path not set (dir missing: {sdk_parent})\n")
            sys.stderr.flush()
    except Exception as exc:
        sys.stderr.write(f"[sidecar.boot] sdk_path auto-populate failed (non-fatal): {exc!r}\n")
        sys.stderr.flush()

    # ── 确保用户实例工具目录已注册（已有安装可能缺此源，启动时自动补齐）──
    try:
        user_tools_dir = Path.home() / ".artifexnexus" / "nexus-tools"
        if user_tools_dir.is_dir():
            _ts.register_source(str(user_tools_dir), "user", "startup")
            sys.stderr.write(
                f"[sidecar.boot] user nexus-tools source ensured: {user_tools_dir}\n"
            )
            sys.stderr.flush()
    except Exception as exc:
        sys.stderr.write(
            f"[sidecar.boot] user nexus-tools source ensure failed (non-fatal): {exc!r}\n"
        )
        sys.stderr.flush()

    # ─────────────────────────────────────────────────────────────────
    # 启动期主动拉起 gateway（2026-05-14 简化）
    # ─────────────────────────────────────────────────────────────────
    # 设计：sidecar 是 gateway 的"父亲"，负责把它拉起来；前端只读 status。
    # 这避免了"前端 → Rust manager.call(start) → Mutex 持锁阻塞 30s"的复杂链路。
    #
    # 同步执行（非线程）原因：
    #   - 此时 stdin loop 还没开始，Tauri 第一个 RPC 还没发，不会超时
    #   - subprocess.Popen 本身是异步 fork，5-10s 是 OpenClaw CLI 自己的初始化
    #
    # 失败也不阻塞：异常被吞掉，主循环照常进入。
    try:
        sys.stderr.write("[sidecar.boot] ensuring gateway is running...\n")
        sys.stderr.flush()
        _home = _get_openclaw_home()
        if _runtime.is_running():
            sys.stderr.write("[sidecar.boot] gateway already running, skip\n")
            sys.stderr.flush()
        else:
            try:
                _port = _bootstrap.get_gateway_port(_home)
            except Exception:
                _port = 19789
            try:
                _result = _runtime.start_gateway(_home, _port)
                sys.stderr.write(
                    f"[sidecar.boot] gateway started pid={_result.pid} port={_result.port}\n"
                )
                sys.stderr.flush()
            except Exception as _exc:
                sys.stderr.write(f"[sidecar.boot] gateway start failed: {_exc!r}\n")
                sys.stderr.flush()
    except Exception as _exc:
        sys.stderr.write(f"[sidecar.boot] ensure-gateway top-level exception: {_exc!r}\n")
        sys.stderr.flush()

    # 启动调试打点：标记主循环已进入；用于排查 Tauri spawn 模式下
    # stdin 是否被 buffer 卡住、Python 是否真到达读取阶段。
    sys.stderr.write("[sidecar.main] entering stdin loop\n")
    sys.stderr.flush()

    # 初始化触发器调度引擎（注册到 MCPBridgeClient 的 trigger_event 回调）
    _init_trigger_dispatcher()

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
        # 调试打点：每条 RPC 入口（轮询方法静默，减少噪声）
        method_name = None
        try:
            request_preview = json.loads(line)
            method_name = request_preview.get("method", "")
        except json.JSONDecodeError:
            pass
        _is_poll = method_name in _POLL_METHODS
        if not _is_poll:
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
        # 调试打点：每条 RPC 出口（轮询方法静默）
        if not _is_poll:
            try:
                method = request.get("method", "?")
            except Exception:
                method = "?"
            sys.stderr.write(f"[sidecar.rpc] out: {method}\n")
            sys.stderr.flush()


if __name__ == "__main__":
    main()
