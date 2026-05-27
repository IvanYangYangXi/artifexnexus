"""
skill_manifest.py — manifest.json 解析与验证（全平台统一）
===========================================================

零 DCC 依赖的纯数据模块。供所有 SkillHub（UE/Blender/Maya/Max/Platform）共用。

来源：从 ``packages/dcc/unreal/.../skill_manifest.py`` 提取，
去除 UE 日志依赖，改为标准 logging。
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("artifex_nexus.skill_manifest")


# ============================================================================
# 1. 枚举常量
# ============================================================================

VALID_MANIFEST_VERSIONS = {"1.0"}

VALID_SOFTWARE = {
    "universal",
    "unreal_engine",
    "maya",
    "3ds_max",
    "blender",
}

VALID_CATEGORIES = {
    "scene", "asset", "material", "lighting", "render",
    "blueprint", "animation", "ui",
    "utils", "integration", "workflow",
}

VALID_RISK_LEVELS = {"low", "medium", "high", "critical"}

# name 正则: 小写字母开头，允许小写字母/数字/下划线，最长 64 字符
NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

# semver 简化正则: MAJOR.MINOR.PATCH
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


# ============================================================================
# 2. 数据类
# ============================================================================

@dataclass
class ToolEntry:
    """manifest.json 中 tools 数组的单个条目"""
    name: str
    description: str


@dataclass
class SoftwareVersion:
    """manifest.json 中 software_version 对象"""
    min_version: Optional[str] = None
    max_version: Optional[str] = None


@dataclass
class SkillManifest:
    """Skill manifest.json 的结构化表示。"""

    # 必需字段
    manifest_version: str = "1.0"
    name: str = ""
    display_name: str = ""
    description: str = ""
    version: str = "1.0.0"
    author: str = ""
    software: str = "universal"
    category: str = "utils"
    risk_level: str = "low"
    entry_point: str = "__init__.py"
    tools: List[ToolEntry] = field(default_factory=list)

    # 可选字段
    license: str = "MIT"
    software_version: Optional[SoftwareVersion] = None
    dependencies: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    icon: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

    # 运行时附加信息
    source_dir: Optional[str] = None
    source_layer: Optional[str] = None

    def get_tool_names(self) -> List[str]:
        return [t.name for t in self.tools]

    def to_dict(self) -> dict:
        result = {
            "manifest_version": self.manifest_version,
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "version": self.version,
            "author": self.author,
            "software": self.software,
            "category": self.category,
            "risk_level": self.risk_level,
            "entry_point": self.entry_point,
            "tools": [{"name": t.name, "description": t.description} for t in self.tools],
            "license": self.license,
            "dependencies": self.dependencies,
            "tags": self.tags,
        }
        if self.software_version:
            result["software_version"] = {}
            if self.software_version.min_version:
                result["software_version"]["min"] = self.software_version.min_version
            if self.software_version.max_version:
                result["software_version"]["max"] = self.software_version.max_version
        if self.icon:
            result["icon"] = self.icon
        if self.config:
            result["config"] = self.config
        if self.source_layer:
            result["source_layer"] = self.source_layer
        return result


# ============================================================================
# 3. 验证错误
# ============================================================================

class ManifestValidationError:
    """验证错误条目"""
    def __init__(self, field: str, message: str, severity: str = "error"):
        self.field = field
        self.message = message
        self.severity = severity

    def __str__(self):
        return f"[{self.severity.upper()}] {self.field}: {self.message}"

    def to_dict(self) -> dict:
        return {"field": self.field, "message": self.message, "severity": self.severity}


# ============================================================================
# 4. 解析与验证
# ============================================================================

def parse_manifest(manifest_path: str) -> Tuple[Optional[SkillManifest], List[ManifestValidationError]]:
    """解析并验证 manifest.json 文件。"""
    errors: List[ManifestValidationError] = []
    path = Path(manifest_path)

    if not path.exists():
        errors.append(ManifestValidationError("file", f"manifest.json not found: {manifest_path}"))
        return None, errors

    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except json.JSONDecodeError as e:
        errors.append(ManifestValidationError("file", f"Invalid JSON: {e}"))
        return None, errors
    except Exception as e:
        errors.append(ManifestValidationError("file", f"Failed to read file: {e}"))
        return None, errors

    if not isinstance(raw, dict):
        errors.append(ManifestValidationError("file", "manifest.json root must be a JSON object"))
        return None, errors

    manifest = SkillManifest()
    manifest.source_dir = str(path.parent)

    # manifest_version
    mv = raw.get("manifest_version")
    if mv is None:
        errors.append(ManifestValidationError("manifest_version", "Required field missing"))
    elif mv not in VALID_MANIFEST_VERSIONS:
        errors.append(ManifestValidationError("manifest_version",
            f"Unsupported version: {mv} (expected: {VALID_MANIFEST_VERSIONS})"))
    else:
        manifest.manifest_version = mv

    # name
    name = raw.get("name")
    if name is None:
        errors.append(ManifestValidationError("name", "Required field missing"))
    elif not isinstance(name, str) or not NAME_PATTERN.match(name):
        errors.append(ManifestValidationError("name",
            f"Invalid name '{name}': must match ^[a-z][a-z0-9_]{{0,63}}$"))
    else:
        manifest.name = name

    # display_name
    dn = raw.get("display_name")
    if dn is None:
        errors.append(ManifestValidationError("display_name", "Required field missing"))
    elif not isinstance(dn, str) or not dn.strip():
        errors.append(ManifestValidationError("display_name", "Must be a non-empty string"))
    else:
        manifest.display_name = dn

    # description
    desc = raw.get("description")
    if desc is None:
        errors.append(ManifestValidationError("description", "Required field missing"))
    elif not isinstance(desc, str) or not desc.strip():
        errors.append(ManifestValidationError("description", "Must be a non-empty string"))
    else:
        manifest.description = desc

    # version
    ver = raw.get("version")
    if ver is None:
        errors.append(ManifestValidationError("version", "Required field missing"))
    elif not isinstance(ver, str) or not SEMVER_PATTERN.match(ver):
        errors.append(ManifestValidationError("version",
            f"Invalid semver: '{ver}' (expected MAJOR.MINOR.PATCH)"))
    else:
        manifest.version = ver

    # author
    author = raw.get("author")
    if author is None:
        errors.append(ManifestValidationError("author", "Required field missing"))
    elif not isinstance(author, str) or not author.strip():
        errors.append(ManifestValidationError("author", "Must be a non-empty string"))
    else:
        manifest.author = author

    # software
    sw = raw.get("software")
    if sw is None:
        errors.append(ManifestValidationError("software", "Required field missing"))
    elif sw not in VALID_SOFTWARE:
        errors.append(ManifestValidationError("software",
            f"Invalid value '{sw}' (expected: {sorted(VALID_SOFTWARE)})"))
    else:
        manifest.software = sw

    # category
    cat = raw.get("category")
    if cat is None:
        errors.append(ManifestValidationError("category", "Required field missing"))
    elif cat not in VALID_CATEGORIES:
        errors.append(ManifestValidationError("category",
            f"Invalid value '{cat}' (expected: {sorted(VALID_CATEGORIES)})"))
    else:
        manifest.category = cat

    # risk_level
    rl = raw.get("risk_level")
    if rl is None:
        errors.append(ManifestValidationError("risk_level", "Required field missing"))
    elif rl not in VALID_RISK_LEVELS:
        errors.append(ManifestValidationError("risk_level",
            f"Invalid value '{rl}' (expected: {sorted(VALID_RISK_LEVELS)})"))
    else:
        manifest.risk_level = rl

    # entry_point
    ep = raw.get("entry_point")
    if ep is None:
        errors.append(ManifestValidationError("entry_point", "Required field missing"))
    elif not isinstance(ep, str) or not ep.strip():
        errors.append(ManifestValidationError("entry_point", "Must be a non-empty string"))
    else:
        manifest.entry_point = ep
        entry_path = path.parent / ep
        if not entry_path.exists():
            errors.append(ManifestValidationError(
                "entry_point", f"Entry file not found: {ep}", severity="warning"))

    # tools
    tools_raw = raw.get("tools")
    if tools_raw is None:
        errors.append(ManifestValidationError("tools", "Required field missing"))
    elif not isinstance(tools_raw, list) or len(tools_raw) == 0:
        errors.append(ManifestValidationError("tools", "Must be a non-empty array"))
    else:
        for i, t in enumerate(tools_raw):
            if not isinstance(t, dict):
                errors.append(ManifestValidationError(f"tools[{i}]", "Each tool must be an object"))
                continue
            t_name = t.get("name")
            t_desc = t.get("description")
            if not t_name or not isinstance(t_name, str):
                errors.append(ManifestValidationError(
                    f"tools[{i}].name", "Required and must be a non-empty string"))
            if not t_desc or not isinstance(t_desc, str):
                errors.append(ManifestValidationError(
                    f"tools[{i}].description", "Required and must be a non-empty string"))
            if t_name and t_desc:
                manifest.tools.append(ToolEntry(name=t_name, description=t_desc))

    # --- 可选字段 ---
    lic = raw.get("license")
    if lic is not None:
        manifest.license = str(lic)

    sv = raw.get("software_version")
    if sv is not None:
        if isinstance(sv, dict):
            manifest.software_version = SoftwareVersion(
                min_version=sv.get("min"), max_version=sv.get("max"))
        else:
            errors.append(ManifestValidationError(
                "software_version", "Must be an object", severity="warning"))

    deps = raw.get("dependencies")
    if deps is not None:
        if isinstance(deps, list):
            manifest.dependencies = [str(d) for d in deps]
        else:
            errors.append(ManifestValidationError("dependencies", "Must be an array", severity="warning"))

    tags = raw.get("tags")
    if tags is not None:
        if isinstance(tags, list):
            manifest.tags = [str(t) for t in tags]
        else:
            errors.append(ManifestValidationError("tags", "Must be an array", severity="warning"))

    icon = raw.get("icon")
    if icon is not None:
        manifest.icon = str(icon)

    config = raw.get("config")
    if config is not None:
        if isinstance(config, dict):
            manifest.config = config
        else:
            errors.append(ManifestValidationError("config", "Must be an object", severity="warning"))

    return manifest, errors


def validate_manifest(manifest_path: str) -> Tuple[bool, List[ManifestValidationError]]:
    manifest, errors = parse_manifest(manifest_path)
    has_errors = any(e.severity == "error" for e in errors)
    return not has_errors, errors
