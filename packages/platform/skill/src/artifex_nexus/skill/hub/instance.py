"""
hub/instance.py — SkillInstance 数据类
=========================================

描述一个已加载到运行时的 Skill 实例。
与 SkillEntry（扫描阶段轻量记录）不同，SkillInstance 包含
已导入的 Python 模块和从模块中收集的 Skill-Tool handler 映射。

设计：
- tools dict: {tool_name → callable handler}
- handler 从模块 __dict__ 中通过 _artifex_skill_tool 标记自动收集
- 不使用全局注册表（避免多 Skill 间的 Skill-Tool 混淆）
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Dict, Optional

from ..categories import software_value
from ..manifest import SkillManifest


@dataclass
class SkillToolInfo:
    """@skill_tool 装饰器产出的 Skill-Tool 元信息。

    不同于 SkillInstance.tools（存 callable handler），SkillToolInfo 是
    轻量级公共 API 类型，面向用户和前端查询。

    Attributes:
        name: Skill-Tool 名称。
        description: AI 可读的描述文本。
        category: 分类标签。
        risk_level: 风险级别。
        input_schema: JSON Schema dict（从 type hints 自动推断）。
    """

    name: str
    description: str = ""
    category: str = "general"
    risk_level: str = "low"
    input_schema: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SkillInstance:
    """已加载的 Skill 运行时实例。

    Attributes:
        name: Skill 唯一标识符（来自 manifest.name）。
        manifest: pydantic 校验后的 SkillManifest 实例。
        source_path: Skill 源码目录绝对路径。
        layer: 所属层级（'00_official' / '01_team' / '02_user' / '99_custom'）。
        tools: {tool_name → callable handler}，从 __init__.py 中 @skill_tool 函数收集。
        loaded_module: importlib 导入的 Python 模块对象。
        load_error: 导入失败时的异常信息（None 表示加载成功）。
    """

    name: str
    manifest: SkillManifest
    source_path: Path
    layer: str
    tools: Dict[str, Callable[..., Any]] = field(default_factory=dict)
    loaded_module: Optional[ModuleType] = None
    load_error: Optional[str] = None

    @property
    def version(self) -> str:
        """Skill 版本号（来自 manifest.version）。"""
        return self.manifest.version

    @property
    def software(self) -> str:
        """适用 DCC 软件（来自 manifest.software）。"""
        return software_value(self.manifest.software)

    @property
    def category(self) -> Optional[str]:
        """分类标签（来自 manifest.category）。"""
        return self.manifest.category

    @property
    def skill_tool_names(self) -> list:
        """已加载的 Skill-Tool 名称列表。"""
        return list(self.tools.keys())

    @property
    def is_loaded(self) -> bool:
        """Python 模块是否已成功导入。"""
        return self.loaded_module is not None and self.load_error is None

    def has_tool(self, tool_name: str) -> bool:
        """检查是否包含指定名称的 Skill-Tool。"""
        return tool_name in self.tools

    def get_tool_handler(self, tool_name: str) -> Optional[Callable[..., Any]]:
        """获取 Skill-Tool 的执行函数，不存在返回 None。"""
        return self.tools.get(tool_name)
