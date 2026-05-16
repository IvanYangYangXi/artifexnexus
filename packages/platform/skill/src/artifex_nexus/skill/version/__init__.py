"""version 子包 — 语义版本解析与比较。

导出：
    - ``parse_version`` — 解析 semver 字符串为 int 元组
    - ``compare_versions`` — 比较两个版本
    - ``version_gt / version_lt / version_gte / version_lte / version_eq`` — 便捷比较
"""

from __future__ import annotations

from .parser import (
    compare_versions,
    parse_version,
    version_eq,
    version_gt,
    version_gte,
    version_lt,
    version_lte,
)

__all__ = [
    "parse_version",
    "compare_versions",
    "version_eq",
    "version_gt",
    "version_gte",
    "version_lt",
    "version_lte",
]
