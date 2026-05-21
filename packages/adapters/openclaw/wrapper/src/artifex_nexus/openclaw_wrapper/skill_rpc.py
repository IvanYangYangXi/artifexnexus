"""
JSON-RPC handlers for skill.* methods (STORY-0046).
=======================================================

Each handler accepts ``(req_id, params)`` and returns a JSON-RPC 2.0 response dict.
Delegates to the artifex_nexus.skill SDK modules.
Imports shared helpers from ``_rpc_helpers``.

Methods: list, detail, install, uninstall, enable, disable,
         pin, unpin, favorite, unfavorite, sync, publish,
         batch, search (14 methods)
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List

try:
    from ._rpc_helpers import (
        _get_skill_hub, _get_skill_config, _get_skill_installer, _get_skill_registry,
        _ok, _err, _err_invalid_params,
        _entry_to_dict, _config_prefs_for_skill, _skill_fix_manifest, _skill_read_skill_md,
        _skill_check_sync, _skill_update_manifest, _resolve_skill_install_dir,
    )
except ImportError:
    from _rpc_helpers import (  # type: ignore[no-redef]
        _get_skill_hub, _get_skill_config, _get_skill_installer, _get_skill_registry,
        _ok, _err, _err_invalid_params,
        _entry_to_dict, _config_prefs_for_skill, _skill_fix_manifest, _skill_read_skill_md,
        _skill_check_sync, _skill_update_manifest, _resolve_skill_install_dir,
    )

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════


def _handle_skill_list(req_id: Any, params: dict) -> dict:
    """skill.list(filters) → (items, total)。

    Supported filters: tags, software, layer, page, limit, sort_by, sort_order.
    """
    try:
        hub = _get_skill_hub()
        hub.scan_all_skills()

        category = params.get("category")
        tags = params.get("tags")
        software = params.get("software")
        layer = params.get("layer")
        page = max(1, int(params.get("page", 1)))
        limit = min(max(1, int(params.get("limit", 20))), 200)

        # 兼容旧 category 参数（映射到 tags）
        if category and not tags:
            tags = [category] if isinstance(category, str) else category

        entries = hub.list_entries(tags=tags, software=software, layer=layer)
        total = len(entries)

        # 分页切片
        start = (page - 1) * limit
        end = start + limit
        page_entries = entries[start:end]

        config = _get_skill_config()

        items = []
        for entry in page_entries:
            # 检测是否已安装（使用 resolve 处理目录名 ≠ SKILL.md name 的情况）
            installed = _resolve_skill_install_dir(entry.name).exists()
            item = _entry_to_dict(entry)
            item.update({
                "enabled": not config.is_disabled(entry.name),
                "pinned": config.is_pinned(entry.name),
                "favorited": config.is_favorite(entry.name),
                "installed": installed,
            })
            items.append(item)

        return _ok(req_id, {"items": items, "total": total})
    except Exception as e:
        logger.exception("skill.list failed")
        return _err(req_id, str(e))


def _handle_skill_detail(req_id: Any, params: dict) -> dict:
    """skill.detail(id) → SkillDetail。

    Returns composite: entry metadata + tool list + user preferences + loaded info.
    """
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        hub = _get_skill_hub()
        hub.scan_all_skills()

        entry = hub.get_entry(skill_name)
        if entry is None:
            return _err(req_id, f"Skill 不存在: {skill_name}")

        instance = hub.get_instance(skill_name)

        tools: list[dict] = []
        if instance is not None and instance.tools:
            from artifex_nexus.skill.hub.instance import SkillToolInfo

            # 如果 module 已加载，收集所有 @skill_tool 元信息
            mod = instance.loaded_module
            if mod is not None:
                for attr_name in dir(mod):
                    attr = getattr(mod, attr_name, None)
                    if callable(attr) and getattr(attr, "_artifex_skill_tool", False):
                        ti_name = getattr(attr, "_artifex_skill_tool_name", attr_name)
                        ti_desc = getattr(attr, "_artifex_skill_tool_description", "")
                        ti_risk = getattr(attr, "_artifex_skill_tool_risk_level", "low")
                        ti_schema = getattr(attr, "_artifex_skill_tool_input_schema", {})
                        tools.append({
                            "name": ti_name,
                            "description": ti_desc,
                            "risk_level": ti_risk,
                            "input_schema": ti_schema,
                        })
            else:
                # 未加载时 tools 为空
                pass

        detail = {
            "entry": _entry_to_dict(entry),
            "tools": tools,
            "config": _config_prefs_for_skill(skill_name),
            "loaded": instance is not None,
            "layer": entry.layer,
        }
        if instance is not None:
            detail["source_path"] = str(instance.source_path)
            detail["load_error"] = instance.load_error
            detail["tool_count"] = len(instance.tools)

        # 计算安装路径（已安装的 Skill 在 workspace/skills/ 下）
        install_dir = _resolve_skill_install_dir(skill_name)
        if install_dir.exists():
            detail["install_path"] = str(install_dir)

        # 同步状态检测（已安装 Skill）
        if install_dir.exists() and entry.path and entry.path.exists():
            try:
                detail["sync_state"] = _skill_check_sync(skill_name)
            except Exception:
                pass  # 检测失败不影响详情展示

        return _ok(req_id, detail)
    except Exception as e:
        logger.exception("skill.detail failed")
        return _err(req_id, str(e))


def _handle_skill_install(req_id: Any, params: dict) -> dict:
    """skill.install(id) → {ok, message}。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_skill_installer()
        source_layer = params.get("source_layer")
        if source_layer is None:
            # 自动从 Hub 检测 Skill 所属层级
            hub = _get_skill_hub()
            hub.scan_all_skills()
            entry = hub.get_entry(skill_name)
            source_layer = entry.layer if entry else "00_official"
        target_layer = params.get("target_layer", "02_user")

        result = installer.install(skill_name, source_layer=source_layer, target_layer=target_layer)
        return _ok(req_id, {
            "ok": result.ok,
            "skill_name": result.skill_name,
            "message": result.message,
            "installed_path": str(result.installed_path) if result.installed_path else None,
        })
    except Exception as e:
        logger.exception("skill.install failed")
        return _err(req_id, str(e))


def _handle_skill_uninstall(req_id: Any, params: dict) -> dict:
    """skill.uninstall(id) → {ok, message}。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_skill_installer()
        target_layer = params.get("target_layer", "02_user")

        result = installer.uninstall(skill_name, target_layer=target_layer)
        return _ok(req_id, {
            "ok": result.ok,
            "skill_name": result.skill_name,
            "message": result.message,
        })
    except Exception as e:
        logger.exception("skill.uninstall failed")
        return _err(req_id, str(e))


def _handle_skill_enable(req_id: Any, params: dict) -> dict:
    """skill.enable(id) → SkillInfo。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_skill_installer()
        hub = _get_skill_hub()
        hub.scan_all_skills()

        ok = installer.enable(skill_name)
        entry = hub.get_entry(skill_name)
        item = _entry_to_dict(entry) if entry else {"name": skill_name}
        item.update(_config_prefs_for_skill(skill_name))
        item["enabled"] = True
        return _ok(req_id, item)
    except Exception as e:
        logger.exception("skill.enable failed")
        return _err(req_id, str(e))


def _handle_skill_disable(req_id: Any, params: dict) -> dict:
    """skill.disable(id) → SkillInfo。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_skill_installer()
        hub = _get_skill_hub()
        hub.scan_all_skills()

        ok = installer.disable(skill_name)
        entry = hub.get_entry(skill_name)
        item = _entry_to_dict(entry) if entry else {"name": skill_name}
        item.update(_config_prefs_for_skill(skill_name))
        item["enabled"] = False
        return _ok(req_id, item)
    except Exception as e:
        logger.exception("skill.disable failed")
        return _err(req_id, str(e))


def _handle_skill_pin(req_id: Any, params: dict) -> dict:
    """skill.pin(id) → SkillInfo。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        cfg = _get_skill_config()
        cfg.pin(skill_name)

        hub = _get_skill_hub()
        hub.scan_all_skills()
        entry = hub.get_entry(skill_name)
        item = _entry_to_dict(entry) if entry else {"name": skill_name}
        item.update(_config_prefs_for_skill(skill_name))
        return _ok(req_id, item)
    except Exception as e:
        logger.exception("skill.pin failed")
        return _err(req_id, str(e))


def _handle_skill_unpin(req_id: Any, params: dict) -> dict:
    """skill.unpin(id) → SkillInfo。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        cfg = _get_skill_config()
        cfg.unpin(skill_name)

        hub = _get_skill_hub()
        hub.scan_all_skills()
        entry = hub.get_entry(skill_name)
        item = _entry_to_dict(entry) if entry else {"name": skill_name}
        item.update(_config_prefs_for_skill(skill_name))
        return _ok(req_id, item)
    except Exception as e:
        logger.exception("skill.unpin failed")
        return _err(req_id, str(e))


def _handle_skill_favorite(req_id: Any, params: dict) -> dict:
    """skill.favorite(id) → SkillInfo。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        cfg = _get_skill_config()
        cfg.favorite(skill_name)

        hub = _get_skill_hub()
        hub.scan_all_skills()
        entry = hub.get_entry(skill_name)
        item = _entry_to_dict(entry) if entry else {"name": skill_name}
        item.update(_config_prefs_for_skill(skill_name))
        return _ok(req_id, item)
    except Exception as e:
        logger.exception("skill.favorite failed")
        return _err(req_id, str(e))


def _handle_skill_unfavorite(req_id: Any, params: dict) -> dict:
    """skill.unfavorite(id) → SkillInfo。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        cfg = _get_skill_config()
        cfg.unfavorite(skill_name)

        hub = _get_skill_hub()
        hub.scan_all_skills()
        entry = hub.get_entry(skill_name)
        item = _entry_to_dict(entry) if entry else {"name": skill_name}
        item.update(_config_prefs_for_skill(skill_name))
        return _ok(req_id, item)
    except Exception as e:
        logger.exception("skill.unfavorite failed")
        return _err(req_id, str(e))


def _handle_skill_sync(req_id: Any, params: dict) -> dict:
    """skill.sync(id) → {ok, synced_files}。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_skill_installer()
        source_layer = params.get("source_layer")
        if source_layer is None:
            # 自动从 Hub 检测 Skill 所属层级
            hub = _get_skill_hub()
            hub.scan_all_skills()
            entry = hub.get_entry(skill_name)
            source_layer = entry.layer if entry else "00_official"
        target_layer = params.get("target_layer", "02_user")

        result = installer.sync(skill_name, source_layer=source_layer, target_layer=target_layer)
        return _ok(req_id, {
            "ok": result.ok,
            "skill_name": result.skill_name,
            "synced_files": result.synced_files,
            "state": str(result.state),
            "message": result.message,
        })
    except Exception as e:
        logger.exception("skill.sync failed")
        return _err(req_id, str(e))


def _handle_skill_publish(req_id: Any, params: dict) -> dict:
    """skill.publish(id, opts) → {ok, version}。"""
    try:
        skill_name = params.get("id") or params.get("name")
        if not skill_name:
            return _err_invalid_params(req_id, "缺少参数: id")

        installer = _get_skill_installer()
        source_layer = params.get("source_layer", "02_user")
        target_layer = params.get("target_layer", "01_team")

        result = installer.publish(skill_name, source_layer=source_layer, target_layer=target_layer)
        return _ok(req_id, {
            "ok": result.ok,
            "skill_name": result.skill_name,
            "version": result.version,
            "published_path": str(result.published_path) if result.published_path else None,
        })
    except Exception as e:
        logger.exception("skill.publish failed")
        return _err(req_id, str(e))


def _handle_skill_batch(req_id: Any, params: dict) -> dict:
    """skill.batch(operation, ids) → {succeeded, failed, errors}。

    Supported operations: install, uninstall, enable, disable, pin, unpin,
    favorite, unfavorite, sync, publish.
    """
    try:
        operation = params.get("operation", "")
        ids: list[str] = params.get("ids", [])
        if not operation:
            return _err_invalid_params(req_id, "缺少参数: operation")
        if not isinstance(ids, list) or not ids:
            return _err_invalid_params(req_id, "ids 必须是非空数组")

        # 查找对应的 handler
        handlers: dict[str, Callable[[str], dict]] = {
            "enable":     lambda n: _handle_skill_enable(req_id, {"name": n})["result"],
            "disable":    lambda n: _handle_skill_disable(req_id, {"name": n})["result"],
            "pin":        lambda n: _handle_skill_pin(req_id, {"name": n})["result"],
            "unpin":      lambda n: _handle_skill_unpin(req_id, {"name": n})["result"],
            "favorite":   lambda n: _handle_skill_favorite(req_id, {"name": n})["result"],
            "unfavorite": lambda n: _handle_skill_unfavorite(req_id, {"name": n})["result"],
            "install":    lambda n: _handle_skill_install(req_id, {"name": n})["result"],
            "uninstall":  lambda n: _handle_skill_uninstall(req_id, {"name": n})["result"],
            "sync":       lambda n: _handle_skill_sync(req_id, {"name": n})["result"],
            "publish":    lambda n: _handle_skill_publish(req_id, {"name": n})["result"],
        }

        handler = handlers.get(operation)
        if handler is None:
            return _err_invalid_params(req_id, f"不支持的 batch 操作: {operation}")

        succeeded: list[str] = []
        failed: list[str] = []
        errors: list[dict] = []

        for sid in ids:
            try:
                handler(sid)
                succeeded.append(sid)
            except Exception as exc:
                failed.append(sid)
                errors.append({"id": sid, "error": str(exc)})

        return _ok(req_id, {
            "succeeded": succeeded,
            "failed": failed,
            "errors": errors,
            "total": len(ids),
        })
    except Exception as e:
        logger.exception("skill.batch failed")
        return _err(req_id, str(e))


def _handle_skill_search(req_id: Any, params: dict) -> dict:
    """skill.search(query) → list[SkillInfo]。

    Full-text search over skill names, display names, and descriptions.
    """
    try:
        query = params.get("query", "").strip().lower()
        if not query:
            return _ok(req_id, [])

        hub = _get_skill_hub()
        hub.scan_all_skills()

        all_entries = hub.list_entries()
        cfg = _get_skill_config()
        installer = _get_skill_installer()

        items: list[dict] = []
        for entry in all_entries:
            searchable = " ".join([
                entry.name.lower(),
                (entry.display_name or "").lower(),
                " ".join(entry.manifest.tags or []).lower(),
            ])
            if query in searchable:
                installed = _resolve_skill_install_dir(entry.name).exists()
                item = _entry_to_dict(entry)
                item.update({
                    "enabled": not cfg.is_disabled(entry.name),
                    "pinned": cfg.is_pinned(entry.name),
                    "favorited": cfg.is_favorite(entry.name),
                    "installed": installed,
                })
                items.append(item)

        return _ok(req_id, items)
    except Exception as e:
        logger.exception("skill.search failed")
        return _err(req_id, str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# Handler registry for sidecar METHOD_TABLE
# ═══════════════════════════════════════════════════════════════════════════════

def _handle_skill_fix_manifest(req_id: Any, params: dict) -> dict:
    """skill.fix_manifest — 从 SKILL.md 自动生成 manifest.json。"""
    try:
        skill_name = str(params.get("id", "")).strip()
        if not skill_name:
            return _err_invalid_params(req_id, "缺少 id 参数")
        result = _skill_fix_manifest(skill_name)
        return _ok(req_id, result)
    except Exception as exc:
        logger.exception("skill.fix_manifest failed")
        return _err(req_id, str(exc))


def _handle_skill_read_skill_md(req_id: Any, params: dict) -> dict:
    """skill.read_skill_md — 读取 SKILL.md 原始内容。"""
    try:
        skill_name = str(params.get("id", "")).strip()
        if not skill_name:
            return _err_invalid_params(req_id, "缺少 id 参数")
        result = _skill_read_skill_md(skill_name)
        return _ok(req_id, result)
    except Exception as exc:
        logger.exception("skill.read_skill_md failed")
        return _err(req_id, str(exc))


def _handle_skill_check_sync(req_id: Any, params: dict) -> dict:
    """skill.check_sync — 检测 Skill 同步状态。"""
    try:
        skill_name = str(params.get("id", "")).strip()
        if not skill_name:
            return _err_invalid_params(req_id, "缺少 id 参数")
        result = _skill_check_sync(skill_name)
        return _ok(req_id, result)
    except Exception as exc:
        logger.exception("skill.check_sync failed")
        return _err(req_id, str(exc))


def _handle_skill_update_manifest(req_id: Any, params: dict) -> dict:
    """skill.update_manifest — 更新已安装 Skill 的 manifest.json 字段。"""
    try:
        skill_name = str(params.get("id", "")).strip()
        if not skill_name:
            return _err_invalid_params(req_id, "缺少 id 参数")
        fields = params.get("fields", {})
        if not isinstance(fields, dict):
            return _err_invalid_params(req_id, "fields 必须是字典")
        result = _skill_update_manifest(skill_name, fields)
        return _ok(req_id, result)
    except Exception as exc:
        logger.exception("skill.update_manifest failed")
        return _err(req_id, str(exc))


SKILL_METHODS = {
    "skill.list": _handle_skill_list,
    "skill.detail": _handle_skill_detail,
    "skill.install": _handle_skill_install,
    "skill.uninstall": _handle_skill_uninstall,
    "skill.enable": _handle_skill_enable,
    "skill.disable": _handle_skill_disable,
    "skill.pin": _handle_skill_pin,
    "skill.unpin": _handle_skill_unpin,
    "skill.favorite": _handle_skill_favorite,
    "skill.unfavorite": _handle_skill_unfavorite,
    "skill.sync": _handle_skill_sync,
    "skill.publish": _handle_skill_publish,
    "skill.batch": _handle_skill_batch,
    "skill.search": _handle_skill_search,
    "skill.fix_manifest": _handle_skill_fix_manifest,
    "skill.read_skill_md": _handle_skill_read_skill_md,
    "skill.check_sync": _handle_skill_check_sync,
    "skill.update_manifest": _handle_skill_update_manifest,
}


