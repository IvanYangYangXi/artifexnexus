"""
trigger_dispatcher.py - 3ds Max 触发器调度器
=============================================

事件钩子：监听 Max 保存/打开事件（#filePostSave / #filePostOpen），
匹配 tool-sources.json 中的触发器配置。

核心调度逻辑由共享 SDK trigger_dispatcher_base.TriggerDispatcher 提供。
本文件仅包含 Max 专属的事件钩子注册/注销。
"""

from __future__ import annotations

import logging

from artifex_nexus_sdk.trigger_dispatcher_base import TriggerDispatcher

logger = logging.getLogger("artifex.max.trigger")

# ── 共享调度器实例 ──
_dispatcher = TriggerDispatcher("3ds_max")

# 钩子注册状态
_HOOK_REGISTERED = False


# ── 事件处理器（委托给共享调度器）──

def handle_post_save(filepath: str = "") -> None:
    _dispatcher.handle_post_save(filepath)


def handle_post_open(filepath: str = "") -> None:
    _dispatcher.handle_post_open(filepath)


# ── Max 事件钩子注册 ──

def register_max_callbacks() -> None:
    """注册 3ds Max 事件钩子（callbacks.addScript）"""
    global _HOOK_REGISTERED
    if _HOOK_REGISTERED:
        return

    try:
        import pymxs
        rt = pymxs.runtime

        # 保存后（扁平部署结构：直接 from trigger_dispatcher import）
        rt.callbacks.addScript(
            rt.Name("filePostSave"),
            'python.execute("from trigger_dispatcher import handle_post_save; handle_post_save()")',
            id=rt.Name("artifex_max_save"),
        )

        # 打开后
        rt.callbacks.addScript(
            rt.Name("filePostOpen"),
            'python.execute("from trigger_dispatcher import handle_post_open; handle_post_open()")',
            id=rt.Name("artifex_max_open"),
        )

        _HOOK_REGISTERED = True
        logger.info("Max 事件钩子已注册")
    except ImportError:
        logger.debug("pymxs 不可用，跳过事件钩子")
    except Exception as e:
        logger.error(f"注册 Max 事件钩子失败: {e}")


def unregister_max_callbacks() -> None:
    """取消 3ds Max 事件钩子"""
    global _HOOK_REGISTERED
    try:
        import pymxs
        rt = pymxs.runtime
        for name in ["artifex_max_save", "artifex_max_open"]:
            try:
                rt.callbacks.removeScripts(id=rt.Name(name))
            except Exception:
                pass
        _HOOK_REGISTERED = False
        logger.info("Max 事件钩子已取消")
    except ImportError:
        pass
