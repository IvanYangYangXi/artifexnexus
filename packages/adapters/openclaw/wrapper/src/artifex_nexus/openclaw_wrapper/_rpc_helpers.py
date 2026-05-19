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
_BUNDLED_NEXUS_TOOLS_PATH: Optional[Path] = None


def _get_bundled_nexus_tools_path() -> Optional[Path]:
    """通过 importlib.resources 定位内嵌的 nexus-tools 目录。

    nexus-tools (official + marketplace) 随 ``artifex_nexus.openclaw_wrapper``
    包分发，位于 ``_bundled_nexus_tools/`` 子目录。

    三种启动场景均覆盖：
      - Dev / 绿色包：pip editable install → 返回源码路径
      - NSIS 安装包：随包安装 → 返回 site-packages / 安装路径
    """
    global _BUNDLED_NEXUS_TOOLS_PATH
    if _BUNDLED_NEXUS_TOOLS_PATH is None:
        try:
            from importlib.resources import files as _resources_files
            _BUNDLED_NEXUS_TOOLS_PATH = (
                Path(str(_resources_files("artifex_nexus.openclaw_wrapper")))
                / "_bundled_nexus_tools"
            )
            if not _BUNDLED_NEXUS_TOOLS_PATH.is_dir():
                logger.warning(
                    "Bundled nexus-tools directory not found at %s",
                    _BUNDLED_NEXUS_TOOLS_PATH,
                )
                _BUNDLED_NEXUS_TOOLS_PATH = None
        except Exception as exc:
            logger.warning("Failed to locate bundled nexus-tools: %s", exc)
            _BUNDLED_NEXUS_TOOLS_PATH = None
    return _BUNDLED_NEXUS_TOOLS_PATH

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
        _skill_hub = SkillHub(
            skills_root=_DEFAULT_SKILLS_ROOT,
            layer_sources=_find_skill_layer_sources(),
        )
    return _skill_hub


def _find_skill_layer_sources() -> Dict[str, Path]:
    """查找项目 skills/ 目录下的 official / marketplace 源码层。
    
    探测策略（按优先级）：
    1. 从 sidecar 所在包向上查找 pnpm-workspace.yaml（项目根）
    2. 在项目根下查找 skills/official/ 和 skills/marketplace/
    
    Returns dict like {"00_official": Path, "01_marketplace": Path}
    """
    sources: Dict[str, Path] = {}
    project_root = _find_project_root()
    if project_root:
        skills_root = project_root / "skills"
        for layer_name, dir_name in [("00_official", "official"), ("01_marketplace", "marketplace")]:
            layer_dir = skills_root / dir_name
            if layer_dir.is_dir():
                sources[layer_name] = layer_dir
                logger.info("Skill layer source: %s → %s", layer_name, layer_dir)
    return sources


def _find_project_root() -> Optional[Path]:
    """探测项目根目录（向上查找 pnpm-workspace.yaml）。"""
    try:
        current = Path(__file__).resolve().parent
        for _ in range(10):
            if (current / "pnpm-workspace.yaml").exists():
                return current
            current = current.parent
    except Exception:
        pass
    return None


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
        hub = _get_skill_hub()
        _skill_installer = SkillInstaller(
            hub=hub,
            config_path=_DEFAULT_CONFIG_PATH,
            layer_sources=getattr(hub, "_layer_sources", None),
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
            bundled_nexus_tools_path=_get_bundled_nexus_tools_path(),
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
            bundled_nexus_tools_path=_get_bundled_nexus_tools_path(),
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
    """将 SkillEntry 转为可序列化的 dict。

    数据源规则（与 artclaw 格式标准对齐）：
    - name / description → 来自 SKILL.md（entry.manifest 中已覆盖）
    - 其他所有字段 → 来自 manifest.json
    - manifest.json 缺失时除 name/description 外全部留空/默认值
    """
    from artifex_nexus.skill import software_value
    manifest = entry.manifest
    has_manifest = (entry.path / "manifest.json").exists() if entry.path else False
    return {
        "name": entry.name,
        "display_name": manifest.display_name or entry.name,
        "description": getattr(entry, "description", "") or "",
        "layer": entry.layer,
        "category": manifest.category,
        "software": software_value(manifest.software),
        "version": manifest.version,
        "priority": entry.priority,
        "path": str(entry.path) if entry.path else "",
        "validation_error": getattr(entry, "validation_error", None),
        # manifest.json 独有字段（不存在时为空/默认值）
        "author": manifest.author or "",
        "tags": manifest.tags or [],
        "risk_level": str(manifest.risk_level) if hasattr(manifest, "risk_level") else "low",
        "dependencies": manifest.dependencies or [],
        "entry_point": manifest.entry_point or "__init__.py",
        "license": manifest.license or "",
        "has_manifest": has_manifest,
        "skill_tools": [t.model_dump() if hasattr(t, "model_dump") else {"name": t.name, "description": t.description}
                        for t in (manifest.skill_tools or [])],
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
        # 工具实例元数据（另存为实例时填充）
        "instance_of": manifest.get("instanceOf", ""),
        "parent_name": manifest.get("parentName", ""),
        "parent_path": manifest.get("parentPath", ""),
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


def _skill_fix_manifest(skill_name: str) -> dict:
    """一键修复：从 SKILL.md 生成 manifest.json。

    :param skill_name: Skill 名称。
    :return: {"ok": bool, "path": str, "warnings": [...]}
    """
    hub = _get_skill_hub()
    entry = hub.get_entry(skill_name)
    if entry is None:
        return {"ok": False, "path": "", "warnings": [f"Skill '{skill_name}' 未找到"]}

    from artifex_nexus.skill.manifest import fix_manifest
    return fix_manifest(entry.path)


# ═══════════════════════════════════════════════════════════════════════════════
