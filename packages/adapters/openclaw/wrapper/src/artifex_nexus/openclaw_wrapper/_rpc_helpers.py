"""
JSON-RPC handlers for skill.* and nexus-tool.* methods (STORY-0046).
======================================================================

Each handler accepts ``(req_id, params)`` and returns a JSON-RPC 2.0 response dict.
Delegates to the artifex_nexus.skill / nexus_tool SDK modules.

Methods registered:
  Skill       (14): list, detail, install, uninstall, enable, disable,
                      pin, unpin, favorite, unfavorite, sync, publish,
                      batch, search
  Nexus-Tool  (13): list, detail, create, update, delete, enable, disable,
                      pin, unpin, favorite, unfavorite, publish, batch

PM 标注：nexus-tool.run 不暴露为 RPC（需在 DCC 环境运行）。
                   NexusToolRegistry.run_nexus_tool() 保留为 SDK 方法。
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── 默认路径 ──────────────────────────────────────────────────────────────────

_DEFAULT_SKILLS_ROOT = Path.home() / ".artifexnexus" / ".openclaw" / "workspace" / "skills"
_DEFAULT_CONFIG_PATH = Path.home() / ".artifexnexus" / "config" / "skills.json"
_DEFAULT_NEXUS_TOOLS_ROOT = Path.home() / ".artifexnexus" / "nexus-tools"

# ── 懒初始化单例 ──────────────────────────────────────────────────────────────

_skill_hub: Any = None          # SkillHub
_skill_installer: Any = None    # SkillInstaller
_skill_registry: Any = None     # SkillRegistry
_skill_config: Any = None       # SkillConfig
_nt_registry: Any = None        # NexusToolRegistry
_nt_installer: Any = None       # NexusToolInstaller


def _get_skill_hub() -> Any:
    global _skill_hub
    if _skill_hub is None:
        from artifex_nexus.skill import SkillHub
        _skill_hub = SkillHub(skills_root=_DEFAULT_SKILLS_ROOT)
    return _skill_hub


def _get_skill_config() -> Any:
    global _skill_config
    if _skill_config is None:
        from artifex_nexus.skill import SkillConfig
        _skill_config = SkillConfig(config_path=_DEFAULT_CONFIG_PATH)
    return _skill_config


def _get_skill_installer() -> Any:
    global _skill_installer
    if _skill_installer is None:
        from artifex_nexus.skill import SkillInstaller
        _skill_installer = SkillInstaller(
            hub=_get_skill_hub(),
            config=_get_skill_config(),
        )
    return _skill_installer


def _get_skill_registry() -> Any:
    global _skill_registry
    if _skill_registry is None:
        from artifex_nexus.skill import SkillRegistry
        _skill_registry = SkillRegistry(hub=_get_skill_hub())
    return _skill_registry


def _get_nt_registry() -> Any:
    global _nt_registry
    if _nt_registry is None:
        from artifex_nexus.skill.nexus_tool import NexusToolRegistry
        _nt_registry = NexusToolRegistry(
            config=_get_skill_config(),
            nexus_tools_root=_DEFAULT_NEXUS_TOOLS_ROOT,
        )
    return _nt_registry


def _get_nt_installer() -> Any:
    global _nt_installer
    if _nt_installer is None:
        from artifex_nexus.skill.nexus_tool import NexusToolInstaller
        _nt_installer = NexusToolInstaller(
            registry=_get_nt_registry(),
            config=_get_skill_config(),
            nexus_tools_root=_DEFAULT_NEXUS_TOOLS_ROOT,
        )
    return _nt_installer


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _ok(req_id: Any, result: Any) -> dict:
    """构建 JSON-RPC 成功响应。"""
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _err(req_id: Any, message: str, code: int = -32000) -> dict:
    """构建 JSON-RPC 错误响应。"""
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    }


def _err_invalid_params(req_id: Any, message: str) -> dict:
    """构建 JSON-RPC Invalid Params 错误（-32602）。"""
    return _err(req_id, message, code=-32602)


def _entry_to_dict(entry: Any) -> dict:
    """将 SkillEntry 转为可序列化的 dict。"""
    from artifex_nexus.skill import software_value
    return {
        "name": entry.name,
        "display_name": entry.display_name,
        "layer": entry.layer,
        "category": entry.category,
        "software": software_value(entry.software),
        "version": entry.version,
        "priority": entry.priority,
        "path": str(entry.path) if entry.path else "",
    }


def _nt_data_to_dict(ntd: Any) -> dict:
    """将 NexusToolData 转为可序列化的 dict。

    包含 manifest 中的 inputs / outputs / presets / triggers / defaultFilters，
    供前端 ToolDetailPanel 的 参数/预设/触发器 标签页使用。
    """
    manifest: dict = getattr(ntd, "manifest", None) or {}
    result = {
        "id": ntd.id,
        "name": ntd.name,
        "description": ntd.description,
        "version": ntd.version,
        "source": ntd.source,
        "target_dccs": ntd.target_dccs,
        "status": ntd.status,
        "nexus_tool_path": ntd.nexus_tool_path,
        "implementation_type": ntd.implementation_type,
        "is_enabled": ntd.is_enabled,
        "is_pinned": ntd.is_pinned,
        "is_favorited": ntd.is_favorited,
        "use_count": getattr(ntd, "use_count", 0),
        "author": getattr(ntd, "author", ""),
        "created_at": getattr(ntd, "created_at", ""),
        "updated_at": getattr(ntd, "updated_at", ""),
        # manifest 详情字段（ToolDetailPanel 需要）
        "inputs": manifest.get("inputs", []),
        "outputs": manifest.get("outputs", []),
        "presets": manifest.get("presets", []),
        "triggers": manifest.get("triggers", []),
        "default_filters": manifest.get("defaultFilters", {}),
        "implementation": manifest.get("implementation", {}),
    }
    return result


def _skill_tool_info_to_dict(sti: Any) -> dict:
    """将 SkillToolInfo 转为可序列化的 dict。"""
    return {
        "name": sti.name,
        "description": sti.description,
        "category": sti.category,
        "risk_level": sti.risk_level,
        "input_schema": sti.input_schema,
    }


def _config_prefs_for_skill(skill_name: str) -> dict:
    """获取某个 Skill 的用户偏好。"""
    cfg = _get_skill_config()
    return {
        "enabled": not cfg.is_disabled(skill_name),
        "pinned": cfg.is_pinned(skill_name),
        "favorited": cfg.is_favorite(skill_name),
    }


# ═══════════════════════════════════════════════════════════════════════════════
