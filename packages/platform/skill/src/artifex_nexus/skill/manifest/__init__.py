"""manifest 子包 — Skill Manifest 模型与加载器。

导出：
    - ``SkillManifest`` — pydantic v2 模型
    - ``SoftwareVersionConstraint`` — DCC 版本约束
    - ``Software`` — 枚举（数据源：categories.json）
    - ``load_manifest_model`` — 加载并校验 manifest.json，返回 pydantic 模型实例
    - ``fix_manifest`` — 从 SKILL.md 自动生成 manifest.json
    - ``generate_manifest_from_skill_dir`` — 生成 manifest dict（不写入磁盘）
"""

from __future__ import annotations

from .loader import load_manifest, load_manifest_model
from .manifest_fixer import (
    fix_manifest,
    generate_manifest_from_skill_dir,
)
from .models import (
    SkillManifest,
    SoftwareVersionConstraint,
)

# 枚举从 categories.json 唯一数据源读取，expose 给外部使用
from ..categories import Software

__all__ = [
    "SkillManifest",
    "SoftwareVersionConstraint",
    "Software",
    "load_manifest_model",
    "load_manifest",  # deprecated，保留向后兼容
    "fix_manifest",
    "generate_manifest_from_skill_dir",
]
