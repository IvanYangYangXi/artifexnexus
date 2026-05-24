"""
JSON-RPC handlers for nexus-tool.* methods (STORY-0046).
============================================================

Each handler accepts ``(req_id, params)`` and returns a JSON-RPC 2.0 response dict.
Delegates to the artifex_nexus.skill.nexus_tool SDK modules.
Imports shared helpers from ``_rpc_helpers``.

Methods: list, detail, create, update, delete, enable, disable,
         pin, unpin, favorite, unfavorite, publish, run, batch
         (14 methods; nexus-tool.run routes via MCP Bridge for DCC tools,
          subprocess for general tools)
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
import sys
from typing import Any, Callable, Dict, List, Optional

# ── 日志 ──
# 独立 handler + propagate=False，不依赖 root logger 级别
# （sidecar 用 sys.stderr.write() 而非 logging 模块）

try:
    from ._rpc_helpers import (
        _get_nt_registry, _get_nt_installer,
        _ok, _err, _err_invalid_params,
        _nt_data_to_dict,
    )
except ImportError:
    from _rpc_helpers import (  # type: ignore[no-redef]
        _get_nt_registry, _get_nt_installer,
        _ok, _err, _err_invalid_params,
        _nt_data_to_dict,
    )

logger = logging.getLogger(__name__)
# 确保 stderr 可见：sidecar 用 sys.stderr.write() 直写，不走 logging 模块，
# root logger 默认 WARNING → 所有子 logger INFO 消息被过滤。
# 为当前模块创建独立 handler + propagate=False 解决。
logger.propagate = False
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("[sidecar.nt] %(message)s"))
    _h.setLevel(logging.INFO)
    logger.addHandler(_h)

# ── 异步任务状态 ───────────────────────────────────────────────────────
# nexus-tool.run 在后台线程执行，主线程立即返回 task_id。
# 前端通过 nexus-tool.result 轮询，nexus-tool.cancel 终止，nexus-tool.ack 清理。

MAX_CONCURRENT_TASKS = 3  # 最多允许同时运行的直接执行任务
TASK_TTL = 300  # 已完成/已取消的任务在 _task_store 中保留的秒数

_task_store: Dict[str, Dict[str, Any]] = {}  # task_id → task 字典

# ── 依赖检查工具函数 ──────────────────────────────────────────────────

_DEP_CHECK_TIMEOUT = 30  # subprocess 依赖检查超时（秒）
_DEP_INSTALL_TIMEOUT = 300  # 单个包 pip install 超时（秒）


def _parse_dep_pkg_name(dep: str) -> str:
    """从 PEP 508 格式的依赖声明中提取包名。"""
    for sep in (">=", "==", "<=", ">", "<", "!="):
        if sep in dep:
            return dep.split(sep)[0].strip()
    return dep.strip()


def _check_dependencies_subprocess(
    target_python: str,
    dependencies: List[str],
) -> tuple[bool, List[str]]:
    """通过 subprocess 在目标 Python 中批量检查依赖（含版本约束）。

    Returns:
        (all_ok, missing): all_ok 为 True 表示全部满足；missing 为缺失/不满足的 dep 列表。
    """
    import json as _json
    import subprocess

    deps_json = _json.dumps(dependencies)
    check_script = (
        "import importlib, json, sys;"
        "deps = json.loads(sys.argv[1]);"
        "missing = [];"
        "for dep in deps:"
        "  pkg = dep.split('>=')[0].split('==')[0].split('<=')[0]"
        "          .split('>')[0].split('<')[0].split('!=')[0].strip();"
        "  try:"
        "    mod = importlib.import_module(pkg);"
        "    if '>=' in dep:"
        "      ver = dep.split('>=')[1].strip();"
        "      inst = getattr(mod, '__version__', None) or '0';"
        "      if not (inst >= ver): missing.append(dep + ' (installed: ' + inst + ')')"
        "    elif '==' in dep:"
        "      ver = dep.split('==')[1].strip();"
        "      inst = getattr(mod, '__version__', None) or '0';"
        "      if inst != ver: missing.append(dep + ' (installed: ' + inst + ')')"
        "  except ImportError:"
        "    missing.append(dep);"
        "print(json.dumps({'ok': len(missing)==0, 'missing': missing}))"
    )
    try:
        result = subprocess.run(
            [target_python, "-c", check_script, deps_json],
            capture_output=True, text=True, timeout=_DEP_CHECK_TIMEOUT,
        )
        if result.returncode != 0:
            logger.warning(
                "[nt-deps] subprocess check failed rc=%d stderr=%s",
                result.returncode, result.stderr[:200],
            )
            return False, dependencies  # 失败保守：全部标记缺失
        data = _json.loads(result.stdout.splitlines()[-1])
        return data.get("ok", False), data.get("missing", [])
    except subprocess.TimeoutExpired:
        logger.warning("[nt-deps] subprocess check timed out after %ss", _DEP_CHECK_TIMEOUT)
        return False, dependencies
    except Exception as e:
        logger.warning("[nt-deps] subprocess check exception: %s", e)
        return False, dependencies


def _install_deps_subprocess(
    target_python: str,
    dependencies: List[str],
) -> tuple[List[str], List[str]]:
    """通过 subprocess 在目标 Python 中 pip install。

    Returns:
        (installed, failed): 成功安装和失败的包名列表。
    """
    import subprocess

    installed: List[str] = []
    failed: List[str] = []
    mirror = _read_pip_mirror_from_settings()

    for dep in dependencies:
        cmd = [target_python, "-m", "pip", "install", dep, "--quiet"]
        if mirror:
            cmd.extend(["-i", mirror])
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True,
                timeout=_DEP_INSTALL_TIMEOUT,
            )
            if result.returncode == 0:
                installed.append(dep)
                logger.info("[nt-deps] installed: %s", dep)
            elif "permission" in (result.stderr or "").lower():
                # --user fallback
                logger.info("[nt-deps] permission error, retrying with --user: %s", dep)
                cmd_user = cmd + ["--user"]
                result2 = subprocess.run(
                    cmd_user, capture_output=True, text=True,
                    timeout=_DEP_INSTALL_TIMEOUT,
                )
                if result2.returncode == 0:
                    installed.append(dep)
                    logger.info("[nt-deps] installed (--user): %s", dep)
                else:
                    failed.append(dep)
                    logger.error("[nt-deps] install failed (even --user): %s stderr=%s", dep, result2.stderr[:200])
            else:
                failed.append(dep)
                logger.error("[nt-deps] install failed: %s stderr=%s", dep, result.stderr[:200])
        except subprocess.TimeoutExpired:
            failed.append(dep)
            logger.error("[nt-deps] install timed out: %s", dep)
        except Exception as e:
            failed.append(dep)
            logger.error("[nt-deps] install exception: %s %s", dep, e)

    return installed, failed


def _read_pip_mirror_from_settings() -> str:
    """读取 app.settings 中的 pip mirror URL。"""
    try:
        from artifex_nexus.openclaw_wrapper import app_settings
        settings = app_settings.get_runtime_settings()
        return settings.get("nexusToolPipMirror", "") or ""
    except Exception:
        return ""


def _dependency_missing_result(task_id: str, missing: List[str]) -> dict:
    """构建 nexus-tool.result 的 dependency_missing 返回结构。"""
    return {
        "task_id": task_id,
        "status": "dependency_missing",
        "missing_deps": missing,
        "message": f"发现 {len(missing)} 个 Python 依赖缺失，请在工具面板中修复",
    }
_task_lock = threading.Lock()


def _cleanup_expired_tasks() -> None:
    """删除超过 TASK_TTL 的已完成/已取消任务。

    线程安全：由调用方在 ``_task_lock`` 外层调用，本函数自取锁。
    在 ``nexus-tool.run`` 与 ``nexus-tool.result`` 入口处触发（O(N)，N 通常 < 20）。
    """
    now = time.time()
    with _task_lock:
        expired: List[str] = []
        for tid, t in _task_store.items():
            if t.get("status") in ("done", "error", "cancelled"):
                created = t.get("created_at", 0)
                if now - created > TASK_TTL:
                    expired.append(tid)
        for tid in expired:
            _task_store.pop(tid, None)
    if expired:
        logger.info("[task-gc] 清理 %d 个过期任务: %s", len(expired), expired[:5])


# ── SDK 路径辅助 ───────────────────────────────────────────────────────

def _get_sdk_path() -> str:
    """返回 artifex_nexus_sdk 可导入的父目录路径。

    复用 sidecar._find_project_root 逻辑：
    1. 检查 sys.path 中是否已有包含 artifex_nexus_sdk 的路径
    2. 基于项目根目录 (packages/dcc/shared/)
    """
    import os, sys
    from pathlib import Path

    for p in sys.path:
        sdk_dir = Path(p) / "artifex_nexus_sdk"
        if sdk_dir.is_dir():
            return str(p)

    env_path = os.environ.get("ARTIFEX_NEXUS_SDK_PATH")
    if env_path:
        return env_path

    # 向上查找项目根目录
    current = Path(__file__).resolve().parent
    for _ in range(10):
        if (current / "pnpm-workspace.yaml").exists():
            sdk_parent = current / "packages" / "dcc" / "shared"
            if sdk_parent.is_dir():
                return str(sdk_parent)
            break
        current = current.parent

    # fallback
    return str(Path(__file__).resolve().parents[7] / "packages" / "dcc" / "shared")


def _get_project_root() -> Path:
    """探测项目根目录（向上查找 pnpm-workspace.yaml）。"""
    from pathlib import Path
    current = Path(__file__).resolve().parent
    for _ in range(10):
        if (current / "pnpm-workspace.yaml").exists():
            return current
        current = current.parent
    return Path(__file__).resolve().parents[7]


# Nexus-Tool RPC handlers
# ═══════════════════════════════════════════════════════════════════════════════


def _handle_nexus_tool_list(req_id: Any, params: dict) -> dict:
    """nexus-tool.list(filters) → (items, total)。

    Supported filters: source, search, page, limit, sort_by, sort_order.
    """
    try:
        registry = _get_nt_registry()
        registry.refresh()

        source = params.get("source")
        search = params.get("search")
        page = max(1, int(params.get("page", 1)))
        limit = min(max(1, int(params.get("limit", 20))), 200)
        sort_by = params.get("sort_by", "name")
        sort_order = params.get("sort_order", "asc")

        items_raw, total = registry.list_nexus_tools(
            source=source,
            search=search,
            page=page,
            limit=limit,
            sort_by=sort_by,
            sort_order=sort_order,
        )

        items = [_nt_data_to_dict(ntd) for ntd in items_raw]
        return _ok(req_id, {"items": items, "total": total})
    except Exception as e:
        logger.exception("nexus-tool.list failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_detail(req_id: Any, params: dict) -> dict:
    """nexus-tool.detail(id) → NexusToolDetail。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        registry = _get_nt_registry()
        registry.refresh()

        ntd = registry.get_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        return _ok(req_id, _nt_data_to_dict(ntd))
    except Exception as e:
        logger.exception("nexus-tool.detail failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_create(req_id: Any, params: dict) -> dict:
    """nexus-tool.create(...) → NexusToolInfo。

    Required: name
    Optional: description, version, source, software, manifest
    """
    try:
        name = params.get("name", "").strip()
        if not name:
            return _err_invalid_params(req_id, "缺少参数: name")

        installer = _get_nt_installer()
        ntd = installer.create_nexus_tool(
            name=name,
            description=params.get("description", ""),
            version=params.get("version", "1.0.0"),
            source=params.get("source", "user"),
            software=params.get("software"),
            manifest=params.get("manifest"),
        )
        return _ok(req_id, _nt_data_to_dict(ntd))
    except Exception as e:
        logger.exception("nexus-tool.create failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_update(req_id: Any, params: dict) -> dict:
    """nexus-tool.update(id, ...) → NexusToolInfo。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_nt_installer()
        kwargs: dict[str, Any] = {}
        for key in ("name", "description", "version", "author", "source",
                     "software", "manifest"):
            if key in params:
                kwargs[key] = params[key]

        # presets / triggers 快捷字段 → 包装进 manifest
        # 前端 savePresets/saveTriggers 仅传快捷 key，不传完整 manifest。
        # 两个字段可以独立发送或同时发送；先处理 presets 后处理 triggers，
        # 确保同时发送时两者都合并到 manifest 中。
        if "presets" in params:
            if "manifest" not in kwargs:
                kwargs["manifest"] = {}
            kwargs["manifest"]["presets"] = params["presets"]
        if "triggers" in params:
            if "manifest" not in kwargs:
                kwargs["manifest"] = {}
            kwargs["manifest"]["triggers"] = params["triggers"]

        ntd = installer.update_nexus_tool(nexus_tool_id, **kwargs)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在或更新失败: {nexus_tool_id}")

        return _ok(req_id, _nt_data_to_dict(ntd))
    except Exception as e:
        logger.exception("nexus-tool.update failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_delete(req_id: Any, params: dict) -> dict:
    """nexus-tool.delete(id) → {ok}。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_nt_installer()
        ok = installer.delete_nexus_tool(nexus_tool_id)
        return _ok(req_id, {"ok": ok})
    except Exception as e:
        logger.exception("nexus-tool.delete failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_enable(req_id: Any, params: dict) -> dict:
    """nexus-tool.enable(id) → NexusToolInfo。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        registry = _get_nt_registry()
        registry.refresh()

        ntd = registry.enable_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        return _ok(req_id, _nt_data_to_dict(ntd))
    except Exception as e:
        logger.exception("nexus-tool.enable failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_disable(req_id: Any, params: dict) -> dict:
    """nexus-tool.disable(id) → NexusToolInfo。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        registry = _get_nt_registry()
        registry.refresh()

        ntd = registry.disable_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        return _ok(req_id, _nt_data_to_dict(ntd))
    except Exception as e:
        logger.exception("nexus-tool.disable failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_pin(req_id: Any, params: dict) -> dict:
    """nexus-tool.pin(id) → NexusToolInfo。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_nt_installer()
        ntd = installer.pin_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        return _ok(req_id, _nt_data_to_dict(ntd))
    except Exception as e:
        logger.exception("nexus-tool.pin failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_unpin(req_id: Any, params: dict) -> dict:
    """nexus-tool.unpin(id) → NexusToolInfo。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_nt_installer()
        ntd = installer.unpin_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        return _ok(req_id, _nt_data_to_dict(ntd))
    except Exception as e:
        logger.exception("nexus-tool.unpin failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_favorite(req_id: Any, params: dict) -> dict:
    """nexus-tool.favorite(id) → NexusToolInfo。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_nt_installer()
        ntd = installer.favorite_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        return _ok(req_id, _nt_data_to_dict(ntd))
    except Exception as e:
        logger.exception("nexus-tool.favorite failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_unfavorite(req_id: Any, params: dict) -> dict:
    """nexus-tool.unfavorite(id) → NexusToolInfo。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_nt_installer()
        ntd = installer.unfavorite_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        return _ok(req_id, _nt_data_to_dict(ntd))
    except Exception as e:
        logger.exception("nexus-tool.unfavorite failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_publish(req_id: Any, params: dict) -> dict:
    """nexus-tool.publish(id, opts) → {ok, version}。"""
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_nt_installer()
        target = params.get("target", "marketplace")
        version = params.get("version")
        description = params.get("description")

        result = installer.publish_nexus_tool(
            nexus_tool_id,
            target=target,
            version=version,
            description=description,
        )
        return _ok(req_id, result)
    except Exception as e:
        logger.exception("nexus-tool.publish failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_batch(req_id: Any, params: dict) -> dict:
    """nexus-tool.batch(operation, ids) → {succeeded, failed, errors}。

    Supported operations: enable, disable, pin, unpin, favorite, unfavorite,
    create, update, delete, publish.
    """
    try:
        operation = params.get("operation", "")
        ids: list[str] = params.get("ids", [])
        if not operation:
            return _err_invalid_params(req_id, "缺少参数: operation")
        if not isinstance(ids, list) or not ids:
            return _err_invalid_params(req_id, "ids 必须是非空数组")

        handlers: dict[str, Callable[[str], dict]] = {
            "enable":     lambda n: _handle_nexus_tool_enable(req_id, {"id": n})["result"],
            "disable":    lambda n: _handle_nexus_tool_disable(req_id, {"id": n})["result"],
            "pin":        lambda n: _handle_nexus_tool_pin(req_id, {"id": n})["result"],
            "unpin":      lambda n: _handle_nexus_tool_unpin(req_id, {"id": n})["result"],
            "favorite":   lambda n: _handle_nexus_tool_favorite(req_id, {"id": n})["result"],
            "unfavorite": lambda n: _handle_nexus_tool_unfavorite(req_id, {"id": n})["result"],
        }

        handler = handlers.get(operation)
        if handler is None:
            return _err_invalid_params(req_id, f"不支持的 nexus-tool batch 操作: {operation}")

        succeeded: list[str] = []
        failed: list[str] = []
        errors: list[dict] = []

        for nid in ids:
            try:
                handler(nid)
                succeeded.append(nid)
            except Exception as exc:
                failed.append(nid)
                errors.append({"id": nid, "error": str(exc)})

        return _ok(req_id, {
            "succeeded": succeeded,
            "failed": failed,
            "errors": errors,
            "total": len(ids),
        })
    except Exception as e:
        logger.exception("nexus-tool.batch failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_check_deps(req_id: Any, params: dict) -> dict:
    """nexus-tool.check-deps(id) → {all_ok, missing, message}。

    仅检查依赖，不运行工具。
    """
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        registry = _get_nt_registry()
        ntd = registry.get_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        manifest = ntd.manifest or {}
        dependencies: List[str] = manifest.get("dependencies", [])

        if not dependencies:
            return _ok(req_id, {"all_ok": True, "missing": [], "message": "无依赖声明"})

        # 通用工具和 DCC 工具都用 sidecar Python 做近似检查
        ok, missing = _check_dependencies_subprocess(sys.executable, dependencies)

        return _ok(req_id, {
            "all_ok": ok,
            "missing": missing,
            "message": f"发现 {len(missing)} 个依赖缺失" if missing else "所有依赖已就绪",
        })
    except Exception as e:
        logger.exception("nexus-tool.check-deps failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_install_deps(req_id: Any, params: dict) -> dict:
    """nexus-tool.install-deps(id) → {success, installed, failed, errors?}。

    安装 manifest.dependencies 中声明的所有 Python 包。
    """
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        registry = _get_nt_registry()
        ntd = registry.get_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        manifest = ntd.manifest or {}
        dependencies: List[str] = manifest.get("dependencies", [])

        if not dependencies:
            return _ok(req_id, {"success": True, "installed": [], "failed": [], "message": "无依赖声明"})

        installed, failed = _install_deps_subprocess(sys.executable, dependencies)

        errors: List[str] = []
        if failed:
            errors = [f"安装失败: {', '.join(failed)}"]

        return _ok(req_id, {
            "success": len(failed) == 0,
            "installed": installed,
            "failed": failed,
            "errors": errors,
        })
    except Exception as e:
        logger.exception("nexus-tool.install-deps failed")
        return _err(req_id, str(e))


# ── DCC → MCP server name 映射 ─────────────────────────────────────────────

_DCC_TO_MCP_SERVER: dict[str, str] = {
    "blender": "blender-editor",
    "maya": "maya-primary",
    "unreal_engine": "unreal-editor",
    "houdini": "houdini-primary",
    "3ds_max": "max-primary",
    "comfyui": "comfyui-primary",
}

# DCC 特化连接失败指引（显示给用户）
_DCC_CONNECTION_HINT: dict[str, str] = {
    "unreal_engine": (
        "可能原因：MCP Server 崩溃（面板可能仍显示 Running，但端口未监听）。"
        "请在 UE 插件面板先点 Stop Server 再点 Start Server 重新启动。"
    ),
    "blender": (
        "请确认 Blender 仍在运行且 Artifex Nexus 插件已加载。"
        "如已加载，尝试在 Blender 中重新启用插件。"
    ),
}


def _handle_nexus_tool_run(req_id: Any, params: dict) -> dict:
    """nexus-tool.run(id, args, install_deps?, force?) → {task_id, status}。

    异步执行，立即返回 task_id。后台线程执行工具，前端通过 nexus-tool.result 轮询。

    参数：
      id:                 工具 ID
      args:               运行参数（可选）
      install_deps (new): true 时先安装依赖再执行
      force (new):        true 时跳过依赖检查，强制执行

    执行策略：
    - DCC 工具（software 不含 "general"）→ MCP Bridge → DCC MCP Server run_python
    - 通用工具（含 "general" 或无 DCC）→ subprocess + importlib wrapper
    """
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        run_args = params.get("args") or {}
        install_deps = params.get("install_deps", False)
        force = params.get("force", False)

        registry = _get_nt_registry()
        registry.refresh()

        ntd = registry.get_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        manifest = ntd.manifest or {}
        dependencies: List[str] = manifest.get("dependencies", [])

        # ── 依赖检查（force=false 时执行）──
        if dependencies and not force:
            target_dccs_pre = [e.dcc.lower() for e in (ntd.software or [])]
            is_general_pre = "general" in target_dccs_pre or not target_dccs_pre
            if is_general_pre:
                target_py = sys.executable
                ok, missing = _check_dependencies_subprocess(target_py, dependencies)
            else:
                # DCC 工具：暂用 subprocess 方式（MCP Bridge 路径在后续 _execute_dcc_tool 中处理）
                # 这里先用 sidecar Python 做近似检查（同平台、常见包行为一致）
                target_py = sys.executable
                ok, missing = _check_dependencies_subprocess(target_py, dependencies)
                logger.info("[nt-run] DCC tool dep check via sidecar py: ok=%s missing=%s", ok, missing)

            if not ok and not install_deps:
                # 返回 dependency_missing 状态
                task_id = str(uuid.uuid4())[:12]
                with _task_lock:
                    _task_store[task_id] = {
                        "task_id": task_id,
                        "status": "dependency_missing",
                        "missing_deps": missing,
                        "message": f"发现 {len(missing)} 个 Python 依赖缺失",
                        "created_at": time.time(),
                    }
                logger.info("[nt-run] task=%s status=dependency_missing deps=%s", task_id, missing)
                return _ok(req_id, {"task_id": task_id, "status": "dependency_missing"})

            if not ok and install_deps:
                # auto-install 模式：先安装
                task_id = str(uuid.uuid4())[:12]
                with _task_lock:
                    _task_store[task_id] = {
                        "task_id": task_id,
                        "status": "installing_deps",
                        "missing_deps": missing,
                        "created_at": time.time(),
                    }
                # 后台安装
                def _install_and_run():
                    try:
                        installed, failed = _install_deps_subprocess(sys.executable, dependencies)
                        if failed:
                            with _task_lock:
                                _task_store[task_id] = {
                                    "task_id": task_id, "status": "error",
                                    "error": f"依赖安装失败: {', '.join(failed)}",
                                    "missing_deps": missing, "failed_deps": failed,
                                    "created_at": time.time(),
                                }
                            return
                        # 安装成功，继续执行
                        with _task_lock:
                            _task_store[task_id] = {
                                "task_id": task_id, "status": "running",
                                "created_at": time.time(),
                                "cancel_event": threading.Event(),
                            }
                        run_result = _execute_tool_sync(
                            ntd, run_args, func_name, threading.Event(), task_id=task_id,
                        )
                        with _task_lock:
                            t = _task_store.get(task_id)
                            if t:
                                t["status"] = "done"
                                t["result"] = run_result
                    except Exception as e:
                        logger.exception("install_and_run task %s failed", task_id)
                        with _task_lock:
                            _task_store[task_id] = {
                                "task_id": task_id,
                                "status": "error",
                                "error": repr(e),
                                "created_at": time.time(),
                            }

                func_name = manifest.get("implementation", {}).get("function", "")
                threading.Thread(
                    target=_install_and_run, daemon=True,
                    name=f"nexus-tool-install-{task_id}",
                ).start()
                return _ok(req_id, {"task_id": task_id, "status": "installing_deps"})

        # ── 并发限制 + 过期任务 GC ──
        max_concurrent = _resolve_max_concurrent()
        _cleanup_expired_tasks()
        with _task_lock:
            running_count = sum(1 for t in _task_store.values() if t.get("status") == "running")
            if running_count >= max_concurrent:
                return _err(
                    req_id,
                    f"并发任务数已达上限 ({max_concurrent})，请等待当前任务完成",
                )

        # ── 读取实现信息 ──
        impl = manifest.get("implementation", {})
        func_name = impl.get("function", "")
        if not func_name:
            return _err(req_id, "manifest 未定义 implementation.function，无法确定入口函数")

        target_dccs = [e.dcc.lower() for e in (ntd.software or [])]
        is_general = "general" in target_dccs or not target_dccs

        # 多 DCC 标记警告（保守策略：只发到第一个）
        non_general_dccs = [d for d in target_dccs if d != "general"]
        warn_multi_dcc: Optional[str] = None
        if len(non_general_dccs) > 1:
            warn_multi_dcc = (
                f"该工具标记了多个 DCC ({', '.join(non_general_dccs)})，"
                f"默认将仅在 {non_general_dccs[0]} 中运行"
            )
            logger.warning("[nt-run] multi-dcc tool: dccs=%s, using %s",
                           non_general_dccs, non_general_dccs[0])

        task_id = str(uuid.uuid4())[:12]
        cancel_event = threading.Event()

        def _run() -> None:
            try:
                logger.info("[nt-run] task=%s starting dccs=%s func=%s general=%s",
                            task_id, target_dccs, func_name, is_general)
                sys.stderr.flush()
                result = _execute_tool_sync(ntd, run_args, func_name, cancel_event, task_id=task_id)
                logger.info("[nt-run] task=%s completed result_keys=%s",
                            task_id, list(result.keys()) if isinstance(result, dict) else type(result).__name__)
                with _task_lock:
                    t = _task_store.get(task_id)
                    # 检查是否在执行期间被取消
                    if t and t.get("cancel_event") and t["cancel_event"].is_set():
                        _task_store[task_id] = {
                            "task_id": task_id,
                            "status": "cancelled",
                            "created_at": time.time(),
                        }
                        logger.info("[nt-run] task=%s marked cancelled", task_id)
                    else:
                        _task_store[task_id] = {
                            "task_id": task_id,
                            "status": "done",
                            "result": result,
                            "created_at": time.time(),
                        }
            except Exception as e:
                logger.exception("_run task %s failed", task_id)
                with _task_lock:
                    _task_store[task_id] = {
                        "task_id": task_id,
                        "status": "error",
                        "error": repr(e),  # repr 保留异常类型信息
                        "created_at": time.time(),
                    }
            except BaseException as e:
                # 非 Exception 异常（SystemExit, KeyboardInterrupt 等）——
                # 工具可能调用了 sys.exit()，必须捕获，否则线程静默死亡
                # 导致 task 永远停留在 "running"
                logger.error("[nt-run] task=%s died with non-Exception: %s %s",
                             task_id, type(e).__name__, e)
                with _task_lock:
                    _task_store[task_id] = {
                        "task_id": task_id,
                        "status": "error",
                        "error": f"{type(e).__name__}: {e}",
                        "created_at": time.time(),
                    }

        with _task_lock:
            _task_store[task_id] = {
                "task_id": task_id,
                "status": "running",
                "created_at": time.time(),
                "cancel_event": cancel_event,
            }

        threading.Thread(target=_run, daemon=True, name=f"nexus-tool-run-{task_id}").start()

        result: Dict[str, Any] = {"task_id": task_id, "status": "started"}
        if warn_multi_dcc is not None:
            result["warning"] = warn_multi_dcc
        return _ok(req_id, result)

    except Exception as e:
        logger.exception("nexus-tool.run failed")
        return _err(req_id, str(e))


# ── 统一执行入口 ────────────────────────────────────────────────────────

def _execute_tool_sync(
    ntd: Any,
    run_args: Dict[str, Any],
    func_name: str,
    cancel_event: threading.Event,
    task_id: str = "",
) -> Dict[str, Any]:
    """在后台线程中执行工具。

    - DCC 工具 → MCP Bridge → DCC MCP Server run_python
    - 通用工具 → subprocess + importlib wrapper

    task_id 用于通用工具的 cancel（注册子进程句柄）。
    """
    target_dccs = [e.dcc.lower() for e in (ntd.software or [])]
    is_general = "general" in target_dccs or not target_dccs

    if is_general:
        logger.info("[nt-exec] task=%s → general tool", task_id)
        sys.stderr.flush()
        return _execute_general_tool(ntd, run_args, func_name, task_id=task_id)
    else:
        logger.info("[nt-exec] task=%s → DCC tool dccs=%s", task_id, target_dccs)
        sys.stderr.flush()
        return _execute_dcc_tool(ntd, run_args, func_name)


def _execute_dcc_tool(
    ntd: Any,
    run_args: Dict[str, Any],
    func_name: str,
) -> Dict[str, Any]:
    """DCC 工具执行：MCP Bridge → DCC MCP Server run_python。

    工具代码通过 exec(code, ns) 在 DCC 预填充命名空间中执行
    （含 bpy/S/C/D/L/W 等上下文变量），因此不能使用 importlib
    （importlib 会让模块在隔离命名空间中运行，丢失上下文变量）。

    通过显式设置 __name__ = '__nexus_dcc_tool__' 避免
    if __name__ == "__main__" 守卫被意外触发。
    所有 DCC（Blender/Maya/UE/Houdini/Max/ComfyUI）统一流程。
    """
    import json as _json
    from pathlib import Path

    target_dccs = [e.dcc.lower() for e in (ntd.software or []) if e.dcc.lower() != "general"]
    dcc = target_dccs[0] if target_dccs else "blender"
    server_name = _DCC_TO_MCP_SERVER.get(dcc)
    if server_name is None:
        raise RuntimeError(f"不支持的 DCC: {dcc}（未知: {list(_DCC_TO_MCP_SERVER)})")

    manifest = ntd.manifest or {}
    impl = manifest.get("implementation", {})
    entry_file = impl.get("entry", "main.py")
    tool_dir = Path(ntd.nexus_tool_path)
    main_py = tool_dir / entry_file
    if not main_py.is_file():
        raise RuntimeError(f"入口文件不存在: {main_py}")

    code = main_py.read_text(encoding="utf-8")
    logger.info("[nt-exec:dcc] dcc=%s tool=%s func=%s code_len=%d",
                dcc, ntd.id, func_name, len(code))
    sys.stderr.flush()

    # ── Blender 端 sys.path 准备 ─────────────────────────────────────────
    # 工具脚本经常 `import artifex_nexus_sdk` 或 import 本地模块。
    # DCC 进程的 Python 默认不包含 sdk 路径，需要在 exec 前显式注入：
    #   * sdk_parent: artifex_nexus_sdk 所在父目录（与通用工具走的 _get_sdk_path 一致）
    #   * tool_dir:   工具自己的目录（便于 `from helpers import ...`）
    # 用 sidecar 进程自己的解析结果——前提是 dev 模式下 sidecar 与 Blender 在
    # 同一台机器（这正是当前 dev/prod 的唯一拓扑）。
    sdk_parent = _get_sdk_path()
    extra_paths = [str(tool_dir), sdk_parent]
    path_prep = (
        "# --- ensure sdk + tool_dir on sys.path ---\n"
        "import sys as _sys\n"
        f"for _p in {_json.dumps(extra_paths)}:\n"
        "    if _p and _p not in _sys.path:\n"
        "        _sys.path.insert(0, _p)\n"
    )

    # 注入参数 + 显式 __name__ / __file__ + 自动调用入口函数。
    # __name__ 显式设置防止 if __name__ == "__main__" 被触发；
    # __file__ 显式设置以支持工具脚本 `os.path.dirname(__file__)` 找同目录资源
    # （Blender 的 run_python 走 exec(code, ns)，默认 __file__ 不存在）。
    # ─────────────────────────────────────────────────────────────────────
    # 参数序列化为 Python 字面量必须用 repr()，不能用 json.dumps()！
    # JSON: false/true/null  →  Python: False/True/None
    # 历史 bug：曾用 json.dumps 注入，传 boolean 参数（如 skip_default_names=false）
    # 直接在 exec 时炸出 `NameError: name 'false' is not defined`。
    # repr() 对 dict/list/str/int/float/bool/None 是 Python 字面量的正确序列化方式，
    # 且 repr() 对常规结构的输出本身又是合法 Python——可直接被 exec 反序列化。
    # 保留 raw code 拼接方式确保在 DCC exec() 的预填充命名空间中运行。
    # ─────────────────────────────────────────────────────────────────────
    args_literal = _python_literal(run_args)
    injected_code = (
        f"# --- nexus-tool context injected ---\n"
        f"{path_prep}"
        f"__name__ = '__nexus_dcc_tool__'\n"
        f"__file__ = {_json.dumps(str(main_py))}\n"
        f"_nexus_tool_args = {args_literal}\n"
        f"{code}\n"
        f"# --- auto-call entry function ---\n"
        f"import json as _json\n"
        f"try:\n"
        f"    _nexus_tool_result = {func_name}(**_nexus_tool_args)\n"
        f"    print(_json.dumps(_nexus_tool_result, ensure_ascii=False, default=str))\n"
        f"except Exception as _nexus_tool_err:\n"
        f"    import traceback as _tb\n"
        f"    print(_json.dumps({{'success': False, 'error': str(_nexus_tool_err), 'error_type': type(_nexus_tool_err).__name__, 'traceback': _tb.format_exc()}}, ensure_ascii=False))\n"
    )

    # MCP Bridge 直连（不经过 Gateway），按 DCC 选择正确的端口
    try:
        from .mcp_bridge import MCPBridgeClient
    except ImportError:
        from mcp_bridge import MCPBridgeClient  # type: ignore[no-redef]

    bridge = MCPBridgeClient.get_instance_for_dcc(dcc)
    logger.info("[nt-exec:dcc] dcc=%s bridge.is_connected=%s ws=%s",
                dcc, bridge.is_connected, bridge._ws is not None)
    sys.stderr.flush()

    if not bridge.is_connected:
        logger.info("[nt-exec:dcc] dcc=%s → bridge.connect()...", dcc)
        sys.stderr.flush()
        connected = bridge.connect()
        logger.info("[nt-exec:dcc] dcc=%s → bridge.connect()=%s", dcc, connected)
        sys.stderr.flush()
        if not connected:
            hint = _DCC_CONNECTION_HINT.get(dcc, "")
            raise RuntimeError(
                f"无法连接到 {dcc} MCP Server（{server_name}）。"
                f"{hint}"
            )

    logger.info("[nt-exec:dcc] dcc=%s → bridge.call_tool(timeout=120)... code_len=%d", dcc, len(injected_code))
    sys.stderr.flush()
    result = bridge.call_tool("run_python", {"code": injected_code}, timeout=120)
    logger.info("[nt-exec:dcc] dcc=%s ← bridge.call_tool returned isError=%s", dcc, result.get("isError"))
    sys.stderr.flush()
    return {"success": not result.get("isError", False), "data": result, "dcc": dcc}


def _execute_general_tool(
    ntd: Any,
    run_args: Dict[str, Any],
    func_name: str,
    task_id: str = "",
) -> Dict[str, Any]:
    """通用工具执行：subprocess + importlib 包装器。

    特性 / 修复：
      1. SDK 路径注入（artifex_nexus_sdk 可 import）
      2. 用 importlib 加载工具模块，绕过 ``if __name__ == "__main__"`` 守卫
      3. 参数通过 stdin (UTF-8 bytes) 传给入口函数 ``**kwargs``
      4. **Windows 编码兜底**：父进程用 bytes 管道，子进程强制 UTF-8
         （PYTHONIOENCODING/PYTHONUTF8/-X utf8 三重保险）
      5. **Marker 协议**：约定 stdout 中的
         ``===NEXUS_RESULT_BEGIN===\\n<json>\\n===NEXUS_RESULT_END===``
         作为结果包裹，工具自身可自由 print 日志而不污染 JSON 解析。
         向后兼容：未带 marker 时退回"取最后一行 JSON"。
      6. **tempdir wrapper**：临时 wrapper 写到 ``tempfile.mkdtemp`` 而非工具源码目录，
         避免污染只读官方工具目录、并发同名工具互相覆盖。
      7. **进程树管理**：Windows 下用 ``CREATE_NEW_PROCESS_GROUP`` 启动；
         cancel 时调用 :func:`_kill_process_tree` 递归杀子进程（taskkill /F /T）。
      8. **超时来源**：优先 manifest.implementation.timeout，其次 app.settings
         ``nexusToolDefaultTimeoutSec``，最后 fallback 120s。

    task_id 用于将 subprocess.Popen 句柄注册到 _task_store，
    供 _handle_nexus_tool_cancel 终止子进程。
    """
    import json as _json
    import os as _os
    import shutil as _shutil
    import subprocess
    import tempfile
    from pathlib import Path

    # ── 解析 manifest / 路径 ──
    manifest = ntd.manifest or {}
    impl = manifest.get("implementation", {})
    entry_file = impl.get("entry", "main.py")
    tool_dir = Path(ntd.nexus_tool_path)
    main_py = tool_dir / entry_file
    if not main_py.is_file():
        raise RuntimeError(f"入口文件不存在: {main_py}")

    sdk_parent = _get_sdk_path()

    # ── 解析超时（manifest > app settings > fallback 120）──
    timeout_sec = _resolve_timeout(impl)

    logger.info(
        "[nt-exec:general] task=%s tool_dir=%s main_py=%s sdk=%s func=%s timeout=%ds",
        task_id, tool_dir, main_py.name, sdk_parent, func_name, timeout_sec,
    )

    # ── 生成临时 wrapper.py（写到独立 tempdir，避免污染工具目录）──
    # 父进程使用 bytes 管道 + UTF-8，子进程通过 PYTHONIOENCODING/PYTHONUTF8/-X utf8
    # 三重保险确保 stdout/stderr 全程 UTF-8。
    # MARKER 协议：工具任意 print 日志，最终 JSON 结果由 wrapper 包裹在 BEGIN/END
    # 之间，父进程严格按 marker 解析，避免日志污染 JSON。
    wrapper_code = f'''\
import sys, json, os, io, traceback

_BEGIN = "===NEXUS_RESULT_BEGIN==="
_END   = "===NEXUS_RESULT_END==="

# ══ 强制 stdout/stderr 使用 UTF-8（即便父进程没设环境变量也兜底）══
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ══ SDK 路径 + 工具目录注入 ══
sys.path.insert(0, {_json.dumps(sdk_parent)})
sys.path.insert(0, {_json.dumps(str(tool_dir))})

# ══ importlib 导入主模块（绕过 __name__ 问题）══
import importlib.util
spec = importlib.util.spec_from_file_location("_nexus_tool", {_json.dumps(str(main_py))})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

# ══ 从 stdin 读取参数（父进程以 UTF-8 bytes 写入）══
try:
    args_raw = sys.stdin.buffer.read().decode("utf-8")
except Exception:
    args_raw = sys.stdin.read()
args = json.loads(args_raw) if args_raw else {{}}

def _emit(payload):
    """把结果用 BEGIN/END marker 包裹写到 stdout。"""
    sys.stdout.write("\\n" + _BEGIN + "\\n")
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str))
    sys.stdout.write("\\n" + _END + "\\n")
    sys.stdout.flush()

# ══ 调用入口函数 ══
func = getattr(mod, {_json.dumps(func_name)})
try:
    result = func(**args)
    _emit(result)
except SystemExit as se:
    # 工具调用 sys.exit() —— 拦截并以 JSON 形式上报
    _emit({{"success": False, "error": "tool sys.exit({{}})".format(se.code), "error_type": "SystemExit"}})
    sys.exit(0)
except Exception as e:
    sys.stderr.write(traceback.format_exc())
    _emit({{"success": False, "error": str(e), "error_type": type(e).__name__}})
'''

    workdir = Path(tempfile.mkdtemp(prefix=f"nexus-tool-{task_id or 'anon'}-"))
    wrapper_py = workdir / "_nexus_wrapper.py"
    wrapper_py.write_text(wrapper_code, encoding="utf-8")
    logger.info("[nt-exec:general] task=%s wrapper=%s size=%d", task_id, wrapper_py, len(wrapper_code))

    # ── 子进程环境：强制 UTF-8 输入输出，避免 Windows GBK 解码失败 ──
    child_env = {**_os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}

    # Windows 下创建新进程组，cancel 时方便用 taskkill /T 递归杀
    popen_kwargs: Dict[str, Any] = dict(
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(tool_dir),  # 工具自己的相对路径仍然可用
        env=child_env,
    )
    if _os.name == "nt":
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]

    proc: Optional[subprocess.Popen] = None
    try:
        proc = subprocess.Popen(
            [sys.executable, "-X", "utf8", str(wrapper_py)],
            **popen_kwargs,
        )
        logger.info("[nt-exec:general] task=%s subprocess pid=%d", task_id, proc.pid)

        # 注册子进程句柄到 _task_store，供 cancel 时 kill
        if task_id:
            with _task_lock:
                t = _task_store.get(task_id)
                if t:
                    t["subprocess_handle"] = proc

        logger.info("[nt-exec:general] task=%s communicating (timeout=%ds)...", task_id, timeout_sec)
        stdin_bytes = _json.dumps(run_args, ensure_ascii=False).encode("utf-8")
        stdout_b, stderr_b = proc.communicate(input=stdin_bytes, timeout=timeout_sec)

        # 兜底防 None
        stdout = (stdout_b or b"").decode("utf-8", errors="replace")
        stderr = (stderr_b or b"").decode("utf-8", errors="replace")

        logger.info(
            "[nt-exec:general] task=%s subprocess exited rc=%s stdout_len=%d stderr_len=%d",
            task_id, proc.returncode, len(stdout), len(stderr),
        )

        result_obj = _parse_tool_stdout(stdout)

        if proc.returncode == 0 and result_obj is not None:
            return result_obj

        # 异常路径：rc != 0 或 stdout 没拿到合法 JSON
        logger.warning(
            "[nt-exec:general] task=%s non-zero/invalid rc=%s stderr=%s",
            task_id, proc.returncode, stderr[:200],
        )
        return {
            "success": False,
            "data": {
                "stdout": stdout,
                "stderr": stderr,
                "returncode": proc.returncode,
            },
            "error": (
                stderr.strip()
                or (f"工具输出未找到合法结果（exit {proc.returncode}）"
                    if result_obj is None else f"exit code {proc.returncode}")
            ),
        }
    except subprocess.TimeoutExpired:
        if proc is not None:
            _kill_process_tree(proc.pid)
            try:
                proc.communicate(timeout=5)  # 回收僵尸进程
            except Exception:
                pass
        _clear_subprocess_handle(task_id)
        raise RuntimeError(f"Nexus-Tool 执行超时（{timeout_sec}s）")
    except FileNotFoundError:
        _clear_subprocess_handle(task_id)
        raise RuntimeError("Python 解释器不可用")
    finally:
        _clear_subprocess_handle(task_id)
        # 清理 tempdir（含 wrapper）
        try:
            _shutil.rmtree(workdir, ignore_errors=True)
        except Exception:
            pass


# ── 结果解析 / 进程树管理 / 超时解析 ───────────────────────────────────

_RESULT_BEGIN_MARKER = "===NEXUS_RESULT_BEGIN==="
_RESULT_END_MARKER = "===NEXUS_RESULT_END==="


def _parse_tool_stdout(stdout: str) -> Optional[Dict[str, Any]]:
    """从工具子进程的 stdout 中解析结果 dict。

    顺序：
      1. 优先按 BEGIN/END marker 抠出中间 JSON（新协议，强健）。
      2. 退回"整个 stdout 是 JSON"（兼容旧工具）。
      3. 退回"最后一行是 JSON"（兼容工具自带 print 日志）。
    任一失败都会返回 None，让调用方走异常分支。
    """
    import json as _json

    if not stdout:
        return None

    # 1) marker 协议
    if _RESULT_BEGIN_MARKER in stdout and _RESULT_END_MARKER in stdout:
        try:
            after_begin = stdout.split(_RESULT_BEGIN_MARKER, 1)[1]
            payload = after_begin.split(_RESULT_END_MARKER, 1)[0].strip()
            if payload:
                return _json.loads(payload)
        except (ValueError, _json.JSONDecodeError) as e:
            logger.warning("[nt-exec:general] marker JSON 解析失败: %s", e)

    # 2) 整个 stdout 是 JSON
    s = stdout.strip()
    if s:
        try:
            return _json.loads(s)
        except _json.JSONDecodeError:
            pass

        # 3) 最后一行
        last_line = s.splitlines()[-1] if s else ""
        try:
            return _json.loads(last_line)
        except _json.JSONDecodeError:
            return None

    return None


def _resolve_timeout(impl: Dict[str, Any]) -> int:
    """决定本次执行的超时（秒）。

    优先级：manifest.implementation.timeout > app.settings.nexusToolDefaultTimeoutSec > 120
    """
    # manifest 级
    raw = impl.get("timeout") if isinstance(impl, dict) else None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        v = int(raw)
        if 1 <= v <= 24 * 60 * 60:
            return v
    # app settings 级
    try:
        try:
            from . import app_settings as _as_mod
        except ImportError:
            import app_settings as _as_mod  # type: ignore[no-redef]
        s = _as_mod.get_runtime_settings()
        v = s.get("nexusToolDefaultTimeoutSec")
        if isinstance(v, int) and 1 <= v <= 24 * 60 * 60:
            return v
    except Exception as e:
        logger.debug("[nt-exec:general] 读取 app settings 失败，回 fallback: %s", e)
    return 120


def _resolve_max_concurrent() -> int:
    """读取 app.settings 里的并发上限，fallback 到模块常量。"""
    try:
        try:
            from . import app_settings as _as_mod
        except ImportError:
            import app_settings as _as_mod  # type: ignore[no-redef]
        s = _as_mod.get_runtime_settings()
        v = s.get("nexusToolMaxConcurrent")
        if isinstance(v, int) and 1 <= v <= 64:
            return v
    except Exception:
        pass
    return MAX_CONCURRENT_TASKS


def _python_literal(obj: Any) -> str:
    """把 Python 对象序列化为可被 ``exec`` 安全解析的 Python 字面量字符串。

    专门给 :func:`_execute_dcc_tool` 注入 ``_nexus_tool_args`` 时用——
    必须使用 Python 字面量（True/False/None），不能用 JSON 字面量
    （true/false/null），否则在 Blender exec 时会抛
    ``NameError: name 'false' is not defined``。

    实现：优先 :func:`repr`（dict/list/str/int/float/bool/None 都已是合法 Python
    字面量；嵌套结构也由 ``repr`` 递归处理）。对极少数 ``repr`` 无法表达的对象
    （如 ``datetime``、自定义类实例），用 ``json.dumps`` 序列化后再替换
    ``true/false/null`` 兜底——前端能传过来的 args 99.9% 是基础类型，
    fallback 路径很少走到。
    """
    try:
        text = repr(obj)
        # 双向校验：repr 出来的能被 ast.literal_eval 反向解析才算合法 Python 字面量
        import ast as _ast
        _ast.literal_eval(text)
        return text
    except Exception:
        # fallback：JSON 序列化 + token 替换。注意只替换裸 token（前后是边界）
        import json as _json2
        import re as _re
        text = _json2.dumps(obj, ensure_ascii=False, default=str)
        text = _re.sub(r"\btrue\b", "True", text)
        text = _re.sub(r"\bfalse\b", "False", text)
        text = _re.sub(r"\bnull\b", "None", text)
        return text


def _kill_process_tree(pid: int) -> None:
    """递归终止进程及其所有子进程（Windows 用 taskkill /F /T；POSIX 用 process group）。

    设计：尽力而为，所有异常被吞——cancel 只承诺"发起终止"。
    优先级：psutil（如果用户装了）→ 平台原生命令。
    """
    import os as _os
    import subprocess as _sp

    if pid <= 0:
        return

    # 优先 psutil（最干净）
    try:
        import psutil  # type: ignore
        try:
            proc = psutil.Process(pid)
            children = proc.children(recursive=True)
            for c in children:
                try:
                    c.kill()
                except Exception:
                    pass
            try:
                proc.kill()
            except Exception:
                pass
            return
        except psutil.NoSuchProcess:
            return
    except ImportError:
        pass

    # 回退到平台命令
    try:
        if _os.name == "nt":
            # /T 递归；/F 强制；CREATE_NO_WINDOW 避免弹黑框
            CREATE_NO_WINDOW = 0x08000000
            _sp.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                check=False,
                stdout=_sp.DEVNULL,
                stderr=_sp.DEVNULL,
                creationflags=CREATE_NO_WINDOW,
            )
        else:
            # POSIX：用 SIGKILL 进程组
            try:
                _os.killpg(_os.getpgid(pid), 9)  # SIGKILL
            except Exception:
                _os.kill(pid, 9)
    except Exception as e:
        logger.warning("[nt-cancel] kill_process_tree pid=%s 失败: %s", pid, e)


def _clear_subprocess_handle(task_id: str) -> None:
    """从 _task_store 中移除子进程句柄。"""
    if not task_id:
        return
    with _task_lock:
        t = _task_store.get(task_id)
        if t:
            t.pop("subprocess_handle", None)


# ── 轮询 / 取消 / 确认 ─────────────────────────────────────────────────

def _handle_nexus_tool_result(req_id: Any, params: dict) -> dict:
    """nexus-tool.result(task_id) → {task_id, status, result?, error?, ...}。

    轮询任务状态。status: "running" | "done" | "error" | "cancelled"
         | "dependency_missing" | "installing_deps"。
    顺便触发过期任务 GC（成本 O(N)，N 通常 < 20）。
    """
    task_id = params.get("task_id")
    if not task_id:
        return _err_invalid_params(req_id, "缺少参数: task_id")

    _cleanup_expired_tasks()

    with _task_lock:
        t = _task_store.get(task_id)

    if t is None:
        logger.warning("[nt-result] task=%s NOT_FOUND (expired?)", task_id)
        return _err(req_id, f"task 不存在或已过期: {task_id}")

    result: dict = {
        "task_id": task_id,
        "status": t.get("status"),
        "result": t.get("result"),
        "error": t.get("error"),
    }
    # 透传依赖相关附加字段
    if t.get("missing_deps"):
        result["missing_deps"] = t["missing_deps"]
    if t.get("message"):
        result["message"] = t["message"]
    if t.get("failed_deps"):
        result["failed_deps"] = t["failed_deps"]
    return _ok(req_id, result)


def _handle_nexus_tool_cancel(req_id: Any, params: dict) -> dict:
    """nexus-tool.cancel(task_id) → {task_id, status: "cancelling"}。

    取消运行中的任务：设置 cancel_event + kill 子进程（如适用）。
    """
    task_id = params.get("task_id")
    if not task_id:
        return _err_invalid_params(req_id, "缺少参数: task_id")

    with _task_lock:
        t = _task_store.get(task_id)

    if t is None:
        return _err(req_id, f"task 不存在: {task_id}")

    if t.get("status") == "done":
        return _err(req_id, "任务已完成，无需取消")
    if t.get("status") in ("error", "cancelled", "dependency_missing"):
        return _err(req_id, f"任务已结束（{t.get('status')}），无需取消")
    if t.get("status") != "running" and t.get("status") != "installing_deps":
        return _err(req_id, f"无法取消状态为 {t.get('status')} 的任务")

    t["cancel_event"].set()

    # 如果有子进程句柄，递归杀进程树（Windows 下 proc.kill() 只能杀 wrapper 进程，
    # 工具自己 spawn 的孙子进程会成为孤儿）。
    subp = t.get("subprocess_handle")
    if subp is not None:
        try:
            _kill_process_tree(subp.pid)
        except Exception as e:
            logger.warning("[nt-cancel] task=%s kill_process_tree 失败: %s", task_id, e)
            try:
                subp.kill()
            except Exception:
                pass

    return _ok(req_id, {"task_id": task_id, "status": "cancelling"})


def _handle_nexus_tool_ack(req_id: Any, params: dict) -> dict:
    """nexus-tool.ack(task_id) → {task_id, acked: true}。

    前端确认已收到结果，立即从 _task_store 清理。
    """
    task_id = params.get("task_id")
    if not task_id:
        return _err_invalid_params(req_id, "缺少参数: task_id")

    with _task_lock:
        _task_store.pop(task_id, None)

    return _ok(req_id, {"task_id": task_id, "acked": True})


# fetch_types 缓存：避免每次调用都阻塞 sidecar 30s 查询 DCC
# 结构: {dcc: (timestamp, result_dict)}
_fetch_types_cache: dict[str, tuple[float, dict]] = {}
_FETCH_TYPES_CACHE_TTL = 60.0  # 缓存 60 秒
_FETCH_TYPES_MCP_TIMEOUT = 5    # MCP 调用超时 5 秒（原来 30s，阻塞 sidecar 导致连锁超时）


def _handle_nexus_tool_fetch_types(req_id: Any, params: dict) -> dict:
    """nexus-tool.fetch_types(dcc) → 实时查询 DCC 对象类型。

    通过 MCP Bridge 向目标 DCC 发送 run_python 查询对象类型。
    结果缓存 60s，避免重复阻塞 sidecar。
    """
    dcc = (params.get("dcc") or "").lower()
    logger.info("[fetch_types] called dcc=%s req_id=%s", dcc, req_id)
    if not dcc:
        return _err_invalid_params(req_id, "缺少参数: dcc")

    # ── 缓存命中 ──
    cached = _fetch_types_cache.get(dcc)
    if cached is not None:
        ts, result = cached
        if time.time() - ts < _FETCH_TYPES_CACHE_TTL:
            logger.info("[fetch_types] cache HIT dcc=%s age=%.1fs", dcc, time.time() - ts)
            return result

    server_name = _DCC_TO_MCP_SERVER.get(dcc)
    if server_name is None:
        # "general" 类型不需要查询 DCC，返回通用类型列表
        if dcc == "general":
            result = _ok(req_id, {"success": True, "data": {"stdout": "file\ndirectory\nproject\n"}})
            _fetch_types_cache[dcc] = (time.time(), result)
            return result
        return _err(req_id, f"不支持的 DCC: {dcc}")

    # Bridge 直连 DCC MCP Server（非 Gateway），用 raw tool name

    # ── 查询脚本 ──
    _TYPE_QUERY_SCRIPTS: dict[str, str] = {
        "blender": (
            "import bpy\n"
            "# 收集所有 bpy.types 下的对象类型\n"
            "types = sorted(set(\n"
            "    t.__name__ for t in bpy.types.Object.__subclasses__()\n"
            ")) + sorted(set(\n"
            "    t.__name__ for t in bpy.types.ID.__subclasses__()\n"
            "))\n"
            "for t in types:\n"
            "    print(t)\n"
        ),
        "unreal_engine": (
            "import unreal\n"
            "# 常见 UE 资源类型\n"
            "types = [\n"
            "    'StaticMesh', 'SkeletalMesh', 'Material', 'Texture2D',\n"
            "    'Blueprint', 'Level', 'ParticleSystem', 'SoundCue',\n"
            "    'AnimationSequence', 'MaterialInstance', 'NiagaraSystem',\n"
            "    'World', 'Actor', 'Pawn', 'Character',\n"
            "    'MaterialInstanceConstant', 'MaterialFunction',\n"
            "    'AnimBlueprint', 'WidgetBlueprint',\n"
            "]\n"
            "for t in types:\n"
            "    print(t)\n"
        ),
        "maya": (
            "import maya.cmds as cmds\n"
            "types = sorted(set(cmds.ls(type='nodeType')))\n"
            "for t in types:\n"
            "    print(t)\n"
        ),
        "3ds_max": (
            "# 3ds Max: 通过 pymxs\n"
            "from pymxs import runtime as rt\n"
            "types = rt.ClassIDs\n"
            "# 返回预设列表（pymxs 的实时查询需要更复杂处理）\n"
            "for t in ['Editable_Mesh','Camera','Light','Bone','Helper','Shape',"
            "'SplineShape','Editable_Poly','Editable_Spline','Dummy']:\n"
            "    print(t)\n"
        ),
        "houdini": (
            "import hou\n"
            "types = sorted(set(t.name() for t in hou.nodeTypeCategories().values()))\n"
            "for t in types:\n"
            "    print(t)\n"
        ),
    }

    code = _TYPE_QUERY_SCRIPTS.get(dcc, f"# no type query for {dcc}\nprint('# no types')\n")

    try:
        # 使用 asyncio.run() 直连 Blender MCP Server，避免 MCPBridgeClient 线程模型
        # 的潜在死锁问题（bridge 在独立线程 + event loop 中运行，与 RPC 主线程交互
        # 可能因锁竞争或事件循环调度导致 hang）
        result = _fetch_types_via_direct_ws(dcc, code)
        if result.get("success"):
            ok_result = _ok(req_id, {"success": True, "data": {"stdout": result["stdout"]}})
            _fetch_types_cache[dcc] = (time.time(), ok_result)
            return ok_result
        else:
            err_result = _ok(req_id, {"success": False, "error": result.get("error", "查询对象类型失败")})
            _fetch_types_cache[dcc] = (time.time(), err_result)
            return err_result
    except ImportError:
        return _err(req_id, "MCP Bridge 模块未加载")
    except Exception as exc:
        logger.exception("fetch_types failed")
        return _err(req_id, f"查询对象类型失败: {exc}")


def _fetch_types_via_direct_ws(dcc: str, code: str) -> dict:
    """通过 asyncio.run() 直连 DCC MCP Server 执行 run_python 查询类型。

    不使用 MCPBridgeClient（其线程+事件循环模型可能导致死锁），
    而是创建隔离的 asyncio event loop 完成整个 MCP 握手 + 工具调用。
    """
    import asyncio as _asyncio
    import json as _json

    async def _do_fetch() -> dict:
        try:
            import websockets
        except ImportError:
            return {"success": False, "error": "websockets 库未安装"}

        # 根据 dcc 选择目标地址（目前仅支持 Blender）
        if dcc != "blender":
            return {"success": False, "error": f"直连仅支持 blender，不支持: {dcc}"}

        uri = "ws://127.0.0.1:18083"
        try:
            ws = await _asyncio.wait_for(websockets.connect(uri), timeout=3.0)
        except _asyncio.TimeoutError:
            return {"success": False, "error": f"连接 {uri} 超时，请确认 Blender 已运行且 MCP 插件已启用"}
        except Exception as e:
            return {"success": False, "error": f"连接失败: {e}"}

        try:
            # MCP initialize 握手
            init_msg = {
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "clientInfo": {"name": "artifex-fetch-types", "version": "0.1"},
                },
            }
            await _asyncio.wait_for(ws.send(_json.dumps(init_msg)), timeout=3.0)
            resp = _json.loads(await _asyncio.wait_for(ws.recv(), timeout=3.0))
            if "error" in resp:
                return {"success": False, "error": f"MCP 握手失败: {resp['error']}"}

            # MCP 协议：发送 initialized 通知
            await _asyncio.wait_for(
                ws.send(_json.dumps({"jsonrpc": "2.0", "method": "initialized"})),
                timeout=3.0,
            )

            # 发送 tools/call run_python
            call_msg = {
                "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {"name": "run_python", "arguments": {"code": code}},
            }
            await _asyncio.wait_for(ws.send(_json.dumps(call_msg)), timeout=3.0)
            call_resp = _json.loads(await _asyncio.wait_for(ws.recv(), timeout=8.0))

            result = call_resp.get("result", {})
            if result.get("isError", False):
                content = result.get("content", [])
                err_text = ""
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        err_text += item.get("text", "")
                return {"success": False, "error": err_text or "run_python 返回错误"}

            # 提取 stdout 文本
            content = result.get("content", [])
            stdout = ""
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    stdout += item.get("text", "")

            return {"success": True, "stdout": stdout}
        finally:
            try:
                await _asyncio.wait_for(ws.close(), timeout=1.0)
            except Exception:
                pass

    try:
        return _asyncio.run(_do_fetch())
    except _asyncio.TimeoutError:
        return {"success": False, "error": "查询超时"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
NEXUS_TOOL_METHODS = {
    "nexus-tool.list": _handle_nexus_tool_list,
    "nexus-tool.detail": _handle_nexus_tool_detail,
    "nexus-tool.create": _handle_nexus_tool_create,
    "nexus-tool.update": _handle_nexus_tool_update,
    "nexus-tool.delete": _handle_nexus_tool_delete,
    "nexus-tool.enable": _handle_nexus_tool_enable,
    "nexus-tool.disable": _handle_nexus_tool_disable,
    "nexus-tool.pin": _handle_nexus_tool_pin,
    "nexus-tool.unpin": _handle_nexus_tool_unpin,
    "nexus-tool.favorite": _handle_nexus_tool_favorite,
    "nexus-tool.unfavorite": _handle_nexus_tool_unfavorite,
    "nexus-tool.publish": _handle_nexus_tool_publish,
    "nexus-tool.run": _handle_nexus_tool_run,
    "nexus-tool.result": _handle_nexus_tool_result,
    "nexus-tool.cancel": _handle_nexus_tool_cancel,
    "nexus-tool.ack": _handle_nexus_tool_ack,
    "nexus-tool.fetch_types": _handle_nexus_tool_fetch_types,
    "nexus-tool.batch": _handle_nexus_tool_batch,
    "nexus-tool.check-deps": _handle_nexus_tool_check_deps,
    "nexus-tool.install-deps": _handle_nexus_tool_install_deps,
}


