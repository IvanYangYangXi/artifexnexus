"""
nexus_tool — Nexus-Tool 子系统
===============================

从 artclaw ToolManager 复制并适配，拆分为独立子包。

公共 API：
    - ``NexusToolRegistry`` — 发现 / 查询 / 启停 / 运行
    - ``NexusToolInstaller`` — 创建 / 修改 / 删除 / 发布 / pin / favorite
    - ``NexusToolData`` / ``ScannedNexusTool`` / ``NexusToolResult`` — 数据模型
    - ``scan_nexus_tools()`` — 文件系统扫描

命名铁律：所有导出名必须包含 ``nexus_tool``，禁止裸 ``tool``。
"""

from .models import NexusToolData, NexusToolResult, ScannedNexusTool
from .scanner import scan_nexus_tools
from .registry import NexusToolRegistry
from .installer import NexusToolInstaller

__all__ = [
    "NexusToolRegistry",
    "NexusToolInstaller",
    "NexusToolData",
    "NexusToolResult",
    "ScannedNexusTool",
    "scan_nexus_tools",
]
