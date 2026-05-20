"""
nexus_tool/models.py — Nexus-Tool 数据模型
=============================================

从 artclaw ToolManager ``models/data.py`` + ``services/tool_scanner.py`` 复制并适配。

命名铁律：所有类名/函数名/变量名必须包含 ``nexus_tool``，禁止裸 ``tool``。

DCC 版本约束模型（v2）:
    ``target_dccs`` 从 ``List[str]`` 升级为 ``List[DCCEntry]``，支持每种 DCC
    独立指定版本范围。向后兼容旧的 ``string[]`` 格式。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class DCCEntry:
    """单个目标 DCC 软件的条目，支持版本约束。

    字段：
        - ``dcc``: 软件标识符（来自 categories.json 的 ALL_SOFTWARE）
        - ``min_version``: 最低版本要求，如 "3.0"（可选）
        - ``max_version``: 最高版本上限，如 "5.0"（可选）
    """
    dcc: str
    min_version: str = ""
    max_version: str = ""


@dataclass
class ScannedNexusTool:
    """从 nexus-tool 的 manifest.json 解析出的原始信息。

    这是扫描中间结果，尚未合并用户偏好（pin/favorite/disabled）。
    """
    name: str
    description: str = ""
    version: str = "1.0.0"
    source: str = "user"  # official / marketplace / user
    target_dccs: List[DCCEntry] = field(default_factory=list)
    nexus_tool_path: str = ""
    manifest: Dict[str, Any] = field(default_factory=dict)
    author: str = ""
    created_at: str = ""
    updated_at: str = ""


@dataclass
class NexusToolData:
    """运行时 Nexus-Tool 完整数据（扫描 + 用户偏好合并）。"""
    id: str  # "{source}/{name}"
    name: str
    description: str = ""
    version: str = "0.0.0"
    source: str = "user"
    target_dccs: List[DCCEntry] = field(default_factory=list)
    status: str = "installed"  # installed / disabled
    nexus_tool_path: str = ""
    manifest: Dict[str, Any] = field(default_factory=dict)
    is_enabled: bool = True
    is_pinned: bool = False
    is_favorited: bool = False
    use_count: int = 0
    author: str = ""
    created_at: str = ""
    updated_at: str = ""


@dataclass
class NexusToolResult:
    """Nexus-Tool 执行结果。

    与 SkillToolResult 语义独立，结构相同：
    - ``ok(data)`` — 执行成功
    - ``fail(error)`` — 执行失败
    """
    success: bool
    data: Any = None
    error: str = ""

    @classmethod
    def ok(cls, data: Any = None) -> "NexusToolResult":
        return cls(success=True, data=data)

    @classmethod
    def fail(cls, error: str) -> "NexusToolResult":
        return cls(success=False, error=error)
