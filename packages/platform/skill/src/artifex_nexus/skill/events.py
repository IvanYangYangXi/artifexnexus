"""
events.py — Skill 事件枚举
===========================

定义 Skill 生命周期事件，当前通过 log + callback 方式传播，
后续 M6+ 可迁移到 ``core.event_bus``。
"""

from __future__ import annotations

from enum import Enum


class SkillEvent(str, Enum):
    """Skill 生命周期事件枚举。

    事件在 Skill 状态变更时触发，当前实现为 log + 可选 callback，
    不依赖 core.event_bus（尚未实现）。
    """

    # 安装相关
    INSTALLED = "installed"
    UNINSTALLED = "uninstalled"

    # 状态变更
    ENABLED = "enabled"
    DISABLED = "disabled"

    # 更新相关
    UPDATED = "updated"
    SYNCED = "synced"

    # 发布相关
    PUBLISHED = "published"

    # 加载相关
    LOADED = "loaded"
    RELOADED = "reloaded"

    # 配置相关
    PINNED = "pinned"
    UNPINNED = "unpinned"
    FAVORITED = "favorited"
    UNFAVORITED = "unfavorited"

    # 错误
    ERROR = "error"
