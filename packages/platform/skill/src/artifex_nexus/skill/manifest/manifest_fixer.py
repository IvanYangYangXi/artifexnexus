"""
manifest_fixer.py — 从 SKILL.md 自动生成 manifest.json
===========================================================

以 ``template.json`` 为唯一格式源，从 SKILL.md frontmatter 提取字段，
按 ArtClaw manifest.schema.json 规范生成 manifest.json。

使用示例::

    from artifex_nexus.skill.manifest.manifest_fixer import generate_manifest_from_skill_dir

    result = generate_manifest_from_skill_dir(Path("/path/to/skill"))
    # result: {"ok": True, "path": "...", "warnings": [...]}
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

logger = logging.getLogger("artifex_nexus.skill.manifest.fixer")

# ── 模板路径 ──────────────────────────────────────────────────────────────────

_TEMPLATE_PATH = Path(__file__).parent / "template.json"


def _load_template() -> dict:
    """加载 manifest.json 模板（唯一格式源）。"""
    try:
        return json.loads(_TEMPLATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("无法加载模板 %s: %s", _TEMPLATE_PATH, exc)
        # 兜底：最简模板
        return {
            "manifest_version": "1.0",
            "name": "",
            "version": "0.1.0",
            "software": "universal",
            "entry_point": "__init__.py",
        }


# ── SKILL.md frontmatter 解析 ──────────────────────────────────────────────────

def _parse_skill_md(skill_dir: Path) -> Optional[dict]:
    """解析 SKILL.md 的 YAML frontmatter，返回 dict 或 None。"""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return None

    try:
        text = skill_md.read_text(encoding="utf-8")
    except OSError:
        return None

    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return None

    try:
        return yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return None


# ── 字段映射 ───────────────────────────────────────────────────────────────────

def _extract_name(frontmatter: dict) -> str:
    """从 SKILL.md frontmatter 提取 name，转为 manifest 规范的 snake_case。"""
    raw = str(frontmatter.get("name", "")).strip()
    if not raw:
        return ""
    # 将连字符转为下划线，符合 manifest name 规范：^[a-z0-9_]+$
    return raw.replace("-", "_")


def _extract_description(frontmatter: dict) -> str:
    """从 SKILL.md frontmatter 提取 description，压缩多行文本。"""
    raw = frontmatter.get("description", "")
    if isinstance(raw, str):
        return " ".join(line.strip() for line in raw.splitlines() if line.strip())
    return str(raw).strip()


def _get_artclaw_meta(frontmatter: dict) -> dict:
    """提取 metadata.artclaw 子字典。"""
    metadata = frontmatter.get("metadata", {})
    if not isinstance(metadata, dict):
        return {}
    artclaw = metadata.get("artclaw", {})
    if not isinstance(artclaw, dict):
        return {}
    return artclaw


# ── 软件名规范化 ───────────────────────────────────────────────────────────────

# SKILL.md 可能使用的软件名 → manifest 规范值
_SOFTWARE_NORMALIZE: Dict[str, str] = {
    "blender": "blender",
    "unreal_engine": "unreal_engine",
    "unreal": "unreal_engine",
    "ue": "unreal_engine",
    "ue5": "unreal_engine",
    "maya": "maya",
    "max": "max",
    "3ds_max": "max",
    "3dsmax": "max",
    "houdini": "houdini",
    "substance_painter": "substance_painter",
    "substance": "substance_painter",
    "sp": "substance_painter",
    "substance_designer": "substance_designer",
    "sd": "substance_designer",
    "comfyui": "comfyui",
    "unity": "unity",
    "universal": "universal",
}


def _normalize_software(raw: str) -> str:
    """将 SKILL.md 中的软件名映射到 manifest 规范值。"""
    return _SOFTWARE_NORMALIZE.get(raw.strip().lower(), raw.strip())


# ── 标签规范化 ───────────────────────────────────────────────────────────────

def _normalize_category(raw: str) -> str:
    """将 SKILL.md 中的分类词映射到 tag 规范值（category 已合并入 tags）。"""
    _CATEGORY_NORMALIZE: Dict[str, str] = {
        "scene": "scene",
        "asset": "asset",
        "material": "material",
        "lighting": "lighting",
        "render": "render",
        "blueprint": "blueprint",
        "animation": "animation",
        "ui": "ui",
        "utils": "utils",
        "integration": "integration",
        "workflow": "workflow",
        "mesh": "mesh",
        "rendering": "rendering",
        "rigging": "rigging",
        "vfx": "vfx",
        "utility": "utility",
        "knowledge": "knowledge",
        "memory": "memory",
        "debug": "debug",
    }
    return _CATEGORY_NORMALIZE.get(raw.strip().lower(), raw.strip())


# ── 主入口 ─────────────────────────────────────────────────────────────────────

def generate_manifest_from_skill_dir(skill_dir: Path) -> Dict[str, Any]:
    """从 Skill 目录的 SKILL.md 自动生成 manifest.json 内容。

    数据映射规则：
    - name: SKILL.md name（连字符 → 下划线）
    - description: SKILL.md description（多行压缩为单行）
    - display_name: metadata.artclaw.display_name → 回退到 frontmatter name
    - version: metadata.artclaw.version → 回退到 "0.1.0"
    - author: metadata.artclaw.author → 回退到 ""
    - software: metadata.artclaw.software（规范化映射）
    - category: metadata.artclaw.category（规范化后合并入 tags）
    - tags: metadata.artclaw.tags → 回退到 []

    :param skill_dir: Skill 源码目录（包含 SKILL.md）。
    :return: {"ok": True/False, "manifest": dict, "path": str, "warnings": [...]}
    """
    result: Dict[str, Any] = {
        "ok": False,
        "manifest": None,
        "path": str(skill_dir / "manifest.json"),
        "warnings": [],
    }

    frontmatter = _parse_skill_md(skill_dir)
    if frontmatter is None:
        result["ok"] = False
        result["warnings"].append("无法解析 SKILL.md")
        return result

    artclaw = _get_artclaw_meta(frontmatter)

    # 加载模板
    manifest = _load_template()

    # name（必需）
    manifest_name = _extract_name(frontmatter)
    if not manifest_name:
        result["warnings"].append("SKILL.md frontmatter 缺少 name 字段")
        return result
    manifest["name"] = manifest_name

    # description
    manifest["description"] = _extract_description(frontmatter)

    # display_name
    manifest["display_name"] = str(artclaw.get("display_name", "") or frontmatter.get("name", ""))
    if not manifest["display_name"]:
        manifest["display_name"] = manifest_name.replace("_", " ").title()

    # version
    version = artclaw.get("version")
    if not version:
        version = frontmatter.get("version")
    if not version:
        version = "0.1.0"
        result["warnings"].append("version 未指定，使用默认值 0.1.0")
    manifest["version"] = str(version)

    # author
    author = str(artclaw.get("author", ""))
    if not author:
        author = str(frontmatter.get("author", ""))
    manifest["author"] = author

    # license
    lic = str(frontmatter.get("license", ""))
    if not lic:
        lic = artclaw.get("license", "")
    if not lic:
        lic = "MIT"
    manifest["license"] = str(lic)

    # software
    sw_raw = str(artclaw.get("software", "") or artclaw.get("dcc", ""))
    if not sw_raw:
        result["warnings"].append("software 未指定，使用默认值 universal")
    manifest["software"] = _normalize_software(sw_raw) if sw_raw else "universal"

    # category → 合并入 tags（category 字段已废弃）
    cat_raw = str(artclaw.get("category", ""))
    normalized_cat = _normalize_category(cat_raw) if cat_raw else ""
    if not cat_raw:
        result["warnings"].append("category 未指定，将不会添加标签分类")

    # tags: 从 metadata.artclaw.tags 提取，同时合并 category 值
    tags = artclaw.get("tags", [])
    if isinstance(tags, list):
        manifest["tags"] = [str(t) for t in tags]
    elif isinstance(tags, str):
        manifest["tags"] = [t.strip() for t in tags.split(",") if t.strip()]
    else:
        manifest["tags"] = []
    # 将 category 加入 tags 首部（去重）
    if normalized_cat and normalized_cat not in manifest["tags"]:
        manifest["tags"] = [normalized_cat] + manifest["tags"]

    # dependencies
    deps = artclaw.get("dependencies", [])
    if isinstance(deps, list):
        manifest["dependencies"] = [str(d) for d in deps]

    result["ok"] = True
    result["manifest"] = manifest
    return result


def write_manifest(skill_dir: Path, manifest: dict) -> bool:
    """将 manifest dict 写入 skill_dir/manifest.json。

    :param skill_dir: Skill 目录。
    :param manifest: 序列化就绪的 manifest dict。
    :return: 写入成功返回 True。
    """
    manifest_path = skill_dir / "manifest.json"
    try:
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info("manifest.json 已生成: %s", manifest_path)
        return True
    except OSError as exc:
        logger.error("写入 manifest.json 失败 (%s): %s", manifest_path, exc)
        return False


def fix_manifest(skill_dir: Path) -> Dict[str, Any]:
    """一站式修复：解析 SKILL.md → 生成 manifest.json → 写入磁盘。

    :param skill_dir: Skill 目录路径。
    :return: {"ok": bool, "path": str, "warnings": [...]}
    """
    result = generate_manifest_from_skill_dir(skill_dir)
    if result["ok"]:
        written = write_manifest(skill_dir, result["manifest"])
        if not written:
            result["ok"] = False
            result["warnings"].append("写入 manifest.json 失败")
    return result
