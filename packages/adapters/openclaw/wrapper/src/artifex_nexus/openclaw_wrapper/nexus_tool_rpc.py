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
from typing import Any, Callable, Dict, List

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
    Optional: description, version, source, target_dccs, implementation_type, manifest
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
            target_dccs=params.get("target_dccs"),
            implementation_type=params.get("implementation_type", "script"),
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
                     "target_dccs", "implementation_type", "manifest"):
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


# ── DCC → MCP server name 映射 ─────────────────────────────────────────────

_DCC_TO_MCP_SERVER: dict[str, str] = {
    "blender": "blender-editor",
    "maya": "maya-primary",
    "unreal_engine": "unreal-editor",
    "houdini": "houdini-primary",
    "3ds_max": "max-primary",
    "comfyui": "comfyui-primary",
}


def _handle_nexus_tool_run(req_id: Any, params: dict) -> dict:
    """nexus-tool.run(id, args) → NexusToolResult。

    执行策略：
    - DCC 工具（target_dccs 不含 "general"）→ MCP Bridge → DCC MCP Server run_python
    - 通用工具（含 "general" 或无 DCC）→ subprocess 执行 main.py
    """
    try:
        nexus_tool_id = params.get("id")
        if not nexus_tool_id:
            return _err_invalid_params(req_id, "缺少参数: id")

        run_args = params.get("args") or {}

        registry = _get_nt_registry()
        registry.refresh()

        ntd = registry.get_nexus_tool(nexus_tool_id)
        if ntd is None:
            return _err(req_id, f"Nexus-Tool 不存在: {nexus_tool_id}")

        target_dccs = [d.lower() for d in (ntd.target_dccs or [])]
        is_general = "general" in target_dccs or not target_dccs

        # ── 读取 main.py ──
        from pathlib import Path
        tool_dir = Path(ntd.nexus_tool_path)
        main_py = tool_dir / "main.py"
        if not main_py.is_file():
            return _err(req_id, f"Nexus-Tool main.py 不存在: {main_py}")

        code = main_py.read_text(encoding="utf-8")

        if is_general:
            # ── 通用工具：subprocess ──
            import subprocess
            import json as _json
            try:
                proc = subprocess.run(
                    ["python", str(main_py)],
                    input=_json.dumps(run_args),
                    capture_output=True,
                    text=True,
                    timeout=120,
                    cwd=str(tool_dir),
                )
                data = {
                    "stdout": proc.stdout,
                    "stderr": proc.stderr,
                    "returncode": proc.returncode,
                }
                if proc.returncode == 0:
                    return _ok(req_id, {"success": True, "data": data})
                else:
                    return _ok(req_id, {
                        "success": False,
                        "data": data,
                        "error": proc.stderr.strip() or f"exit code {proc.returncode}",
                    })
            except subprocess.TimeoutExpired:
                return _err(req_id, "Nexus-Tool 执行超时（120s）")
            except FileNotFoundError:
                return _err(req_id, "Python 解释器不可用")
        else:
            # ── DCC 工具：MCP Bridge 路由 ──
            # 选取第一个支持的 DCC
            dcc = target_dccs[0] if target_dccs else "blender"
            server_name = _DCC_TO_MCP_SERVER.get(dcc)
            if server_name is None:
                return _err(req_id, f"不支持的 DCC: {dcc}（已知: {list(_DCC_TO_MCP_SERVER)})")

            mcp_tool_name = f"mcp_{server_name}_run_python"

            # 注入参数到代码
            import json as _json
            injected_code = (
                f"# --- nexus-tool args injected ---\n"
                f"_nexus_tool_args = {_json.dumps(run_args, ensure_ascii=False)}\n"
                f"{code}"
            )

            try:
                try:
                    from .mcp_bridge import MCPBridgeClient
                except ImportError:
                    from mcp_bridge import MCPBridgeClient  # type: ignore[no-redef]
                bridge = MCPBridgeClient.get_instance()
                if not bridge.is_connected:
                    connected = bridge.connect()
                    if not connected:
                        return _err(req_id, f"无法连接到 {dcc} MCP Server（{server_name}），请确认 {dcc} 已启动且 MCP 插件已加载")

                result = bridge.call_tool(
                    mcp_tool_name,
                    {"code": injected_code},
                    timeout=120,
                )
                return _ok(req_id, {
                    "success": not result.get("isError", False),
                    "data": result,
                    "dcc": dcc,
                })
            except ImportError:
                return _err(req_id, "MCP Bridge 模块未加载，无法路由到 DCC")
            except Exception as exc:
                logger.exception("mcp bridge call failed")
                return _err(req_id, f"DCC 执行失败 ({dcc}): {exc}")

    except Exception as e:
        logger.exception("nexus-tool.run failed")
        return _err(req_id, str(e))


def _handle_nexus_tool_fetch_types(req_id: Any, params: dict) -> dict:
    """nexus-tool.fetch_types(dcc) → 实时查询 DCC 对象类型。

    通过 MCP Bridge 向目标 DCC 发送 run_python 查询对象类型。
    """
    dcc = (params.get("dcc") or "").lower()
    if not dcc:
        return _err_invalid_params(req_id, "缺少参数: dcc")

    server_name = _DCC_TO_MCP_SERVER.get(dcc)
    if server_name is None:
        # "general" 类型不需要查询 DCC，返回通用类型列表
        if dcc == "general":
            return _ok(req_id, {"success": True, "data": {"stdout": "file\ndirectory\nproject\n"}})
        return _err(req_id, f"不支持的 DCC: {dcc}")

    mcp_tool_name = f"mcp_{server_name}_run_python"

    # 各 DCC 的对象类型查询脚本
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
        try:
            from .mcp_bridge import MCPBridgeClient
        except ImportError:
            from mcp_bridge import MCPBridgeClient  # type: ignore[no-redef]
        bridge = MCPBridgeClient.get_instance()
        if not bridge.is_connected:
            connected = bridge.connect()
            if not connected:
                return _err(req_id, f"无法连接到 {dcc} MCP Server（{server_name}），请确认 {dcc} 已启动且 MCP 插件已加载")

        result = bridge.call_tool(
            mcp_tool_name,
            {"code": code},
            timeout=30,
        )
        # 从 MCP result 提取 stdout 文本
        if isinstance(result, dict) and not result.get("isError", False):
            content = result.get("content", [])
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    return _ok(req_id, {"success": True, "data": {"stdout": item["text"]}})
        return _ok(req_id, {"success": False, "error": "查询对象类型失败"})
    except ImportError:
        return _err(req_id, "MCP Bridge 模块未加载")
    except Exception as exc:
        logger.exception("fetch_types failed")
        return _err(req_id, f"查询对象类型失败: {exc}")


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
    "nexus-tool.fetch_types": _handle_nexus_tool_fetch_types,
    "nexus-tool.batch": _handle_nexus_tool_batch,
}


