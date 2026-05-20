"""
manifest/models.py — Skill Manifest pydantic v2 模型
======================================================

基于 ``contracts/schemas/manifest.schema.json`` 定义的 JSON Schema，
转为 pydantic v2 模型以提供类型安全与校验。

枚举（Software）从 ``categories.json`` 唯一数据源读取，
不由本模块自行定义，杜绝多源漂移。

模型：
    - ``SkillManifest`` — Skill 包完整元数据
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from ..categories import ALL_SOFTWARE, DCCEntry


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


# ── 主模型 ──────────────────────────────────────────────────────────────────

class SkillManifest(BaseModel):
    """Skill 包完整元数据模型。

    基于 ``contracts/schemas/manifest.schema.json`` 定义，
    所有字段均对应 manifest.json 中的键。

    验证规则：
    - name: 匹配 ^[a-z][a-z0-9_]{0,63}$
    - version: semver 格式
    - software: DCCEntry 列表（每个 DCC 可独立指定版本约束）
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
    software: List[DCCEntry] = Field(
        default_factory=lambda: [DCCEntry(dcc="universal")],
        description="目标 DCC 软件列表，每项支持独立版本约束",
    )

    # ── 可选元数据 ──────────────────────────────────────────────────────
    display_name: Optional[str] = Field(default=None, description="显示名称")
    description: Optional[str] = Field(default=None, description="Skill 描述")
    author: Optional[str] = Field(default=None, description="作者")
    license: Optional[str] = Field(default=None, description="许可证")

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

    @field_validator("software", mode="before")
    @classmethod
    def _coerce_software(cls, v: Any) -> List[DCCEntry]:
        """向后兼容：旧格式 string → DCCEntry[]；也处理 dict 格式。"""
        if v is None:
            return [DCCEntry(dcc="universal")]
        if isinstance(v, str):
            return [DCCEntry(dcc=v)]
        if isinstance(v, list):
            result: List[DCCEntry] = []
            for item in v:
                if isinstance(item, str):
                    result.append(DCCEntry(dcc=item))
                elif isinstance(item, dict):
                    result.append(DCCEntry.from_dict(item))
                elif isinstance(item, DCCEntry):
                    result.append(item)
            return result if result else [DCCEntry(dcc="universal")]
        return [DCCEntry(dcc="universal")]

    @model_validator(mode="before")
    @classmethod
    def _migrate_software_version(cls, data: Any) -> Any:
        """向后兼容：旧 software_version 合并到第一个 DCCEntry。"""
        if not isinstance(data, dict):
            return data
        sw_ver = data.pop("software_version", None)
        if sw_ver and isinstance(sw_ver, dict):
            sw_list = data.get("software", [])
            # 如果是旧格式 string，先转为 list
            if isinstance(sw_list, str):
                sw_list = [DCCEntry(dcc=sw_list)]
                data["software"] = sw_list
            # 合并版本约束到第一个 DCC
            if sw_list:
                first = sw_list[0]
                if isinstance(first, dict):
                    if sw_ver.get("min") and not first.get("minVersion"):
                        first["minVersion"] = str(sw_ver["min"])
                    if sw_ver.get("max") and not first.get("maxVersion"):
                        first["maxVersion"] = str(sw_ver["max"])
                elif isinstance(first, DCCEntry):
                    if sw_ver.get("min") and not first.min_version:
                        first.min_version = str(sw_ver["min"])
                    if sw_ver.get("max") and not first.max_version:
                        first.max_version = str(sw_ver["max"])
        return data

    # ── 便捷方法 ────────────────────────────────────────────────────────

    @property
    def software_dccs(self) -> List[str]:
        """获取所有目标 DCC 标识列表（不含版本约束）。"""
        return [e.dcc for e in self.software]

    @property
    def primary_dcc(self) -> str:
        """获取首要目标 DCC 标识。"""
        return self.software[0].dcc if self.software else "universal"

    def get_version_constraint(self, dcc: str) -> Dict[str, str]:
        """获取指定 DCC 的版本约束。

        :param dcc: DCC 标识，如 'blender'。
        :return: {'min': ..., 'max': ...} 或空 dict。
        """
        for entry in self.software:
            if entry.dcc == dcc:
                result: Dict[str, str] = {}
                if entry.min_version:
                    result["min"] = entry.min_version
                if entry.max_version:
                    result["max"] = entry.max_version
                return result
        return {}

    def to_dict(self) -> Dict[str, Any]:
        """转为 dict（用于 JSON 序列化）。software 转为 camelCase。"""
        data = self.model_dump(exclude_none=True, mode="python")
        # 将 software 列表中的 DCCEntry 转为 camelCase dict
        if "software" in data:
            data["software"] = [
                e.to_dict() if isinstance(e, DCCEntry) else e
                for e in self.software
            ]
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SkillManifest":
        """从 dict 创建模型实例（含校验）。"""
        return cls.model_validate(data)
