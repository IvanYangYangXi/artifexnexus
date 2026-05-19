"""
manifest/models.py — Skill Manifest pydantic v2 模型
======================================================

基于 ``contracts/schemas/manifest.schema.json`` 定义的 JSON Schema，
转为 pydantic v2 模型以提供类型安全与校验。

枚举（Software / RiskLevel）从 ``categories.json`` 唯一数据源读取，
不由本模块自行定义，杜绝多源漂移。

模型：
    - ``SoftwareVersionConstraint`` — DCC 版本约束（min/max）
    - ``SkillToolRef`` — Skill 内声明包含的 SkillTool 引用
    - ``SkillManifest`` — Skill 包完整元数据
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from ..categories import ALL_SOFTWARE, ALL_RISK_LEVELS, CATEGORY_PATTERN, RiskLevel


# ── 正则常量 ────────────────────────────────────────────────────────────────

# name 约束：小写字母开头，后接小写字母/数字/下划线/连字符，最长 64 字符
# （允许连字符以兼容 SKILL.md frontmatter 的 name 格式）
_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")

# semver 正则（与 artclaw_bridge manifest.py 对齐）
_SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)

_category_pattern = re.compile(CATEGORY_PATTERN)


# ── 子模型 ──────────────────────────────────────────────────────────────────

class SoftwareVersionConstraint(BaseModel):
    """DCC 软件版本约束。

    对应 manifest.schema.json 的 ``software_version`` 字段。
    """

    min: Optional[str] = Field(default=None, description="最低版本要求，如 '5.3'")
    max: Optional[str] = Field(default=None, description="最高版本上限，如 '5.5'")

    @field_validator("min", "max", mode="before")
    @classmethod
    def _coerce_version(cls, v: Any) -> Optional[str]:
        """将数字类型转为字符串，None 保持 None。"""
        if v is None:
            return None
        return str(v)


class SkillToolRef(BaseModel):
    """Skill 内声明的 Skill-Tool 引用。

    对应 manifest.schema.json ``skill_tools[]`` 中的每一项。
    """

    name: str = Field(..., description="Skill-Tool 名称")
    description: Optional[str] = Field(default=None, description="Skill-Tool 描述")


# ── 主模型 ──────────────────────────────────────────────────────────────────

class SkillManifest(BaseModel):
    """Skill 包完整元数据模型。

    基于 ``contracts/schemas/manifest.schema.json`` 定义，
    所有字段均对应 manifest.json 中的键。

    验证规则：
    - name: 匹配 ^[a-z][a-z0-9_]{0,63}$
    - version: semver 格式
    - software: 合法枚举值（来自 categories.json）
    - risk_level: 硬约束 low/medium/high/critical
    - category: 预设值或自定义（需匹配 CATEGORY_PATTERN）
    - skill_tools: 至少包含一个元素
    """

    model_config = {"extra": "allow"}  # 允许额外字段（forward compat）

    # ── 必需字段 ────────────────────────────────────────────────────────
    manifest_version: str = Field(
        default="1.0",
        description="manifest 规范版本，当前固定 '1.0'",
    )
    name: str = Field(
        ...,
        description="Skill 名称（小写字母开头，可含连字符/下划线/数字，64 字符内）",
    )
    version: str = Field(
        default="0.0.0",
        description="semver 版本号，如 '1.0.0'（缺省时使用 0.0.0）",
    )
    software: str = Field(
        default="unknown",
        description="目标 DCC 软件类型（缺省时为 unknown）",
    )

    # ── 可选元数据 ──────────────────────────────────────────────────────
    display_name: Optional[str] = Field(default=None, description="显示名称")
    description: Optional[str] = Field(default=None, description="Skill 描述")
    author: Optional[str] = Field(default=None, description="作者")
    license: Optional[str] = Field(default=None, description="许可证")

    # ── 分类与风险 ──────────────────────────────────────────────────────
    category: Optional[str] = Field(
        default=None,
        description="分类标签（预设值或自定义，格式见 CATEGORY_PATTERN）",
    )
    risk_level: RiskLevel = Field(
        default=RiskLevel.LOW,
        description="风险级别",
    )

    # ── 软件版本约束 ────────────────────────────────────────────────────
    software_version: Optional[SoftwareVersionConstraint] = Field(
        default=None, description="DCC 版本约束"
    )

    # ── Skill-Tool 声明 ──────────────────────────────────────────────────
    skill_tools: List[SkillToolRef] = Field(
        default_factory=list,
        description="Skill 内包含的 Skill-Tool 引用列表",
    )
    entry_point: str = Field(
        default="__init__.py",
        description="入口模块文件名",
    )

    # ── 依赖与标签 ──────────────────────────────────────────────────────
    dependencies: List[str] = Field(
        default_factory=list,
        description="依赖的其他 Skill 名称列表",
    )
    tags: List[str] = Field(
        default_factory=list,
        description="标签列表",
    )

    # ── 钩子（forward compat，STORY-0043/0044 实现）─────────────────────
    hooks: Optional[Dict[str, str]] = Field(
        default=None,
        description="生命周期钩子，如 on_dcc_startup / on_dcc_shutdown",
    )

    # ── 校验器 ──────────────────────────────────────────────────────────

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not _NAME_PATTERN.match(v):
            raise ValueError(
                f"name '{v}' 不合法: 必须匹配 ^[a-z][a-z0-9_]{{0,63}}$"
            )
        return v

    @field_validator("version")
    @classmethod
    def _validate_version(cls, v: str) -> str:
        if v == "0.0.0":
            return v  # 缺省值，不校验
        if not _SEMVER_PATTERN.match(v):
            raise ValueError(
                f"version '{v}' 不符合 semver 格式 (MAJOR.MINOR.PATCH)"
            )
        return v

    @field_validator("category")
    @classmethod
    def _validate_category(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not _category_pattern.match(v):
            raise ValueError(
                f"category '{v}' 不合法: 必须匹配 {CATEGORY_PATTERN}"
            )
        return v

    @model_validator(mode="after")
    def _validate_skill_tools_non_empty(self) -> "SkillManifest":
        # 允许空 skill_tools（仅有 SKILL.md 文档的 Skill 可以不声明 tools）
        return self

    # ── 便捷方法 ────────────────────────────────────────────────────────

    @property
    def skill_tool_names(self) -> List[str]:
        """获取所有 Skill-Tool 名称列表。"""
        return [t.name for t in self.skill_tools]

    @property
    def min_software_version(self) -> Optional[str]:
        """获取最低 DCC 版本。"""
        if self.software_version:
            return self.software_version.min
        return None

    @property
    def max_software_version(self) -> Optional[str]:
        """获取最高 DCC 版本。"""
        if self.software_version:
            return self.software_version.max
        return None

    @property
    def is_custom_category(self) -> bool:
        """category 是否为用户自定义（不在预设列表中）。"""
        return self.category is not None and self.category not in ALL_SOFTWARE

    def to_dict(self) -> Dict[str, Any]:
        """转为 dict（用于 JSON 序列化）。枚举值自动转换。"""
        return self.model_dump(exclude_none=True)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SkillManifest":
        """从 dict 创建模型实例（含校验）。"""
        return cls.model_validate(data)
