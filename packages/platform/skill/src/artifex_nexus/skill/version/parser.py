"""
version/parser.py — 语义版本解析与比较
========================================

从 artclaw_bridge ``core/version_manager.py`` 复制版本解析部分，
去掉了 SyncStatus/SyncState/InstallResult 等数据类（留给 registry 模块）。

函数清单：
    - ``parse_version(v)`` — 解析 semver 字符串为 int 元组
    - ``compare_versions(v1, v2)`` — 比较两个版本（返回 -1/0/1）
    - ``version_gt / version_lt / version_gte / version_lte / version_eq`` — 便捷比较
"""

from __future__ import annotations

import re
from typing import Tuple


def parse_version(version_str: str) -> Tuple[int, ...]:
    """
    解析语义版本字符串为整数元组。

    支持格式：
      "1.2.3"          → (1, 2, 3)
      "v5.4.1"         → (5, 4, 1)
      "5.4.1-preview"  → (5, 4, 1)  # 预发布后缀被忽略
      "5.4.1+build.1"  → (5, 4, 1)  # build metadata 被忽略
      "5.4"            → (5, 4)
      ""               → (0, 0, 0)
    """
    if not version_str:
        return (0, 0, 0)
    # 去掉 v 前缀，去掉 -prerelease 和 +build 后缀
    clean = version_str.strip().lstrip("v").split("-")[0].split("+")[0]
    try:
        parts = clean.split(".")
        return tuple(int(re.match(r"\d+", p).group()) for p in parts if re.match(r"\d+", p))
    except Exception:
        return (0, 0, 0)


def compare_versions(v1: str, v2: str) -> int:
    """
    比较两个版本字符串。

    :return: 1 (v1 > v2), -1 (v1 < v2), 0 (相等)
    """
    t1, t2 = parse_version(v1), parse_version(v2)
    # 对齐长度
    max_len = max(len(t1), len(t2))
    t1 = t1 + (0,) * (max_len - len(t1))
    t2 = t2 + (0,) * (max_len - len(t2))
    if t1 > t2:
        return 1
    if t1 < t2:
        return -1
    return 0


def version_gte(v1: str, v2: str) -> bool:
    """v1 >= v2"""
    return compare_versions(v1, v2) >= 0


def version_lte(v1: str, v2: str) -> bool:
    """v1 <= v2"""
    return compare_versions(v1, v2) <= 0


def version_eq(v1: str, v2: str) -> bool:
    """v1 == v2"""
    return compare_versions(v1, v2) == 0


def version_gt(v1: str, v2: str) -> bool:
    """v1 > v2"""
    return compare_versions(v1, v2) > 0


def version_lt(v1: str, v2: str) -> bool:
    """v1 < v2"""
    return compare_versions(v1, v2) < 0
