"""
trigger_dispatcher.py - Maya 触发器调度器
===========================================

事件钩子：监听 Maya 保存/打开事件（MSceneMessage），
匹配 tool-sources.json 中的触发器配置。

核心调度逻辑由共享 SDK trigger_dispatcher_base.TriggerDispatcher 提供。
本文件仅包含 Maya 专属的事件钩子注册/注销。
"""

from __future__ import annotations

import logging
from typing import List

from artifex_nexus_sdk.trigger_dispatcher_base import TriggerDispatcher

logger = logging.getLogger("artifex.maya.trigger")

# ── 共享调度器实例 ──
_dispatcher = TriggerDispatcher("maya")

# ── 事件钩子 ID 列表 ──
_HOOK_IDS: List[int] = []


# ── 事件处理器（委托给共享调度器）──

def handle_post_save(filepath: str = "") -> None:
    _dispatcher.handle_post_save(filepath)


def handle_post_open(filepath: str = "") -> None:
    _dispatcher.handle_post_open(filepath)


# ── Maya 事件钩子注册 ──

def register_maya_callbacks() -> None:
    """注册 Maya 事件钩子（MSceneMessage）"""
    global _HOOK_IDS

    try:
        import maya.OpenMaya as om

        # 保存后
        save_id = om.MSceneMessage.addCallback(
            om.MSceneMessage.kAfterSave,
            lambda _: handle_post_save(),
        )
        _HOOK_IDS.append(save_id)

        # 打开后
        open_id = om.MSceneMessage.addCallback(
            om.MSceneMessage.kAfterOpen,
            lambda _: handle_post_open(),
        )
        _HOOK_IDS.append(open_id)

        logger.info("Maya 事件钩子已注册 (保存/打开)")
    except ImportError:
        logger.debug("Maya OpenMaya 不可用，跳过事件钩子注册")
    except Exception as e:
        logger.error(f"注册 Maya 事件钩子失败: {e}")


def unregister_maya_callbacks() -> None:
    """取消 Maya 事件钩子"""
    global _HOOK_IDS

    try:
        import maya.OpenMaya as om
        for hook_id in _HOOK_IDS:
            try:
                om.MSceneMessage.removeCallback(hook_id)
            except Exception:
                pass
        _HOOK_IDS.clear()
        logger.info("Maya 事件钩子已取消")
    except ImportError:
        pass
