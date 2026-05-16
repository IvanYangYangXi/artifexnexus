"""
JSON-RPC handlers for nexus-tool.* methods (STORY-0046).
============================================================

Each handler accepts ``(req_id, params)`` and returns a JSON-RPC 2.0 response dict.
Delegates to the artifex_nexus.skill.nexus_tool SDK modules.
Imports shared helpers from ``_rpc_helpers``.

Methods: list, detail, create, update, delete, enable, disable,
         pin, unpin, favorite, unfavorite, publish, batch
         (13 methods; nexus-tool.run excluded per PM 标注)
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List

from ._rpc_helpers import (
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
        for key in ("name", "description", "version", "target_dccs", "implementation_type", "manifest"):
            if key in params:
                kwargs[key] = params[key]

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
    "nexus-tool.batch": _handle_nexus_tool_batch,
}


