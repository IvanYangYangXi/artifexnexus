"""
dcc_event_intercept.py — DCC 事件拦截本地检查器
================================================

在 UE Python 环境中直接运行，委托 trigger_dispatcher.UETriggerDispatcher
进行 manifest 驱动的触发器匹配与工具执行。

支持的事件类型：
- asset.save.pre / asset.save.post: 资产保存前/后
- asset.delete.pre / asset.delete.post: 资产删除前/后
- asset.import.post: 资产导入后
- asset.place.post: 资产放置到场景后

C++ 调用方式:
    from dcc_event_intercept import check_pre_save, check_pre_delete
    from dcc_event_intercept import handle_post_save, handle_post_delete
    from dcc_event_intercept import handle_post_import, handle_actor_placed

    所有 Pre 事件返回格式: {"blocked": bool, "reason": str}
    所有 Post 事件返回格式: {"executed": int, "issues": list}
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List

# ── 去重保护 ───────────────────────────────────────────────────────
_recent_events: Dict[str, float] = {}
_DEDUP_WINDOW_SEC = 0.5

def _dedup_event(key: str) -> bool:
    """返回 True 表示重复（应跳过），False 表示首次（应处理）。"""
    now = time.monotonic()
    if key in _recent_events and (now - _recent_events[key]) < _DEDUP_WINDOW_SEC:
        return True
    _recent_events[key] = now
    return False

# 自动切换到 UE 日志后端
try:
    from artifex_nexus_sdk import logger as _sdk_logger
    _sdk_logger.configure_for_dcc("ue")
except Exception:
    pass

import logging as _logging
logger = _logging.getLogger("dcc_event_intercept")

# UE Output Log 可见的调试输出
def _ue_log(msg: str) -> None:
    try:
        import unreal
        unreal.log(f"[ArtifexNexus|Intercept] {msg}")
    except Exception:
        pass

# ── 延迟导入 trigger_dispatcher（避免在非 UE 环境 import 失败）─────

_dispatcher = None

def _get_dispatcher():
    """延迟加载 UETriggerDispatcher 单例，并同步 C++ 全局开关状态。"""
    global _dispatcher
    if _dispatcher is None:
        from trigger_dispatcher import UETriggerDispatcher
        _dispatcher = UETriggerDispatcher.get_instance()
    # 每次调用都同步 C++ 全局开关（面板按钮可能被用户切换）
    try:
        import unreal
        subsystem = unreal.get_editor_subsystem(unreal.ArtifexNexusSubsystem)
        if subsystem:
            _dispatcher.enabled = subsystem.are_triggers_enabled()
    except Exception:
        pass
    return _dispatcher


# ── 资产类型查询 ───────────────────────────────────────────────────

def _get_asset_class(asset_path: str) -> str:
    """查询资产类型。使用 AssetRegistry 获取 asset_class。"""
    try:
        import unreal
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        asset_data = registry.get_asset_by_object_path(asset_path)
        if asset_data.is_valid():
            return str(asset_data.asset_class_path.asset_name)
    except Exception:
        pass
    return ""


# ── C++ 接口：Pre 事件检查 ─────────────────────────────────────────
# 保持函数签名完全不变（C++ 侧通过 ExecPythonCommand 调用）

def check_pre_save(asset_path: str, asset_name: str, file_name: str = "") -> Dict[str, Any]:
    """保存前检查入口。

    C++ 侧通过 IsPackageOKToSave delegate → ExecPythonCommand 调用。
    返回 {"blocked": bool, "reason": str}，blocked=True 时阻止保存。
    """
    full_asset_path = asset_path
    if "." not in asset_path.rsplit("/", 1)[-1]:
        full_asset_path = f"{asset_path}.{asset_name}"

    asset_class = _get_asset_class(full_asset_path)

    try:
        dispatcher = _get_dispatcher()
        _ue_log(f"check_pre_save path={full_asset_path} class={asset_class}")
        result = dispatcher.on_trigger_event(
            "asset.save.pre",
            filepath=full_asset_path,
            data={
                "asset_path": full_asset_path,
                "asset_name": asset_name,
                "asset_class": asset_class,
                "file_name": file_name,
                "package_path": asset_path,
            },
        )
        return {"blocked": result.get("blocked", False),
                "reason": result.get("reason", "")}
    except Exception as e:
        logger.error("check_pre_save error: %s", e)
        return {"blocked": False, "reason": ""}


def check_pre_delete(asset_paths: List[str]) -> Dict[str, Any]:
    """删除前检查入口。

    C++ 侧通过 OnAssetsPreDelete delegate → ExecPythonCommand 调用。
    """
    if not asset_paths:
        return {"blocked": False, "reason": ""}

    first_path = asset_paths[0]
    asset_name = first_path.rsplit("/", 1)[-1].split(".")[0] if "." in first_path else first_path.rsplit("/", 1)[-1]
    asset_class = _get_asset_class(first_path)

    try:
        dispatcher = _get_dispatcher()
        result = dispatcher.on_trigger_event(
            "asset.delete.pre",
            filepath=first_path,
            data={
                "asset_paths": asset_paths,
                "asset_path": first_path,
                "asset_name": asset_name,
                "asset_class": asset_class,
            },
        )
        return {"blocked": result.get("blocked", False),
                "reason": result.get("reason", "")}
    except Exception as e:
        logger.error("check_pre_delete error: %s", e)
        return {"blocked": False, "reason": ""}


# ── C++ 接口：Post 事件处理 ────────────────────────────────────────

def handle_post_save(asset_path: str, asset_name: str) -> Dict[str, Any]:
    """保存后执行检查工具。

    C++ 侧通过 HandlePackageSaved delegate → ExecPythonCommand 调用。
    不拦截，仅用于检查 + 通知。
    """
    full_asset_path = asset_path
    if "." not in asset_path.rsplit("/", 1)[-1]:
        full_asset_path = f"{asset_path}.{asset_name}"

    asset_class = _get_asset_class(full_asset_path)

    try:
        dispatcher = _get_dispatcher()
        _ue_log(f"handle_post_save path={full_asset_path}")
        result = dispatcher.on_trigger_event(
            "asset.save.post",
            filepath=full_asset_path,
            data={
                "asset_path": full_asset_path,
                "asset_name": asset_name,
                "asset_class": asset_class,
                "package_path": asset_path,
            },
        )

        # 写 pending 文件供 C++ FlushPendingNotify 消费
        issues = result.get("issues", [])
        if issues:
            reason = issues[0].get("reason", "Issue found")
            _notify_ue(reason, "silent", full_asset_path)

        return {"executed": result.get("executed", 0),
                "issues": result.get("issues", [])}
    except Exception as e:
        logger.error("handle_post_save error: %s", e)
        return {"executed": 0, "issues": []}


def handle_post_delete(asset_path: str, asset_name: str) -> Dict[str, Any]:
    """删除后执行检查工具。"""
    try:
        dispatcher = _get_dispatcher()
        result = dispatcher.on_trigger_event(
            "asset.delete.post",
            filepath=asset_path,
            data={
                "asset_path": asset_path,
                "asset_name": asset_name,
            },
        )
        return {"executed": result.get("executed", 0),
                "issues": result.get("issues", [])}
    except Exception as e:
        logger.error("handle_post_delete error: %s", e)
        return {"executed": 0, "issues": []}


def handle_actor_placed(actor_path: str, actor_name: str, actor_class: str) -> Dict[str, Any]:
    """Actor 放置到场景后执行检查工具。

    去重保护：UE OnNewActorsDropped delegate 在单次拖入操作时可能触发多次，
    用 actor_path 做 key，500ms 内只处理一次。
    """
    dedup_key = f"asset.place.post::{actor_path}"
    if _dedup_event(dedup_key):
        return {"executed": 0, "issues": []}

    try:
        dispatcher = _get_dispatcher()
        _ue_log(f"handle_actor_placed path={actor_path} class={actor_class}")
        result = dispatcher.on_trigger_event(
            "asset.place.post",
            filepath=actor_path,
            data={
                "asset_path": actor_path,
                "asset_name": actor_name,
                "asset_class": actor_class,
            },
        )
        return {"executed": result.get("executed", 0),
                "issues": result.get("issues", [])}
    except Exception as e:
        logger.error("handle_actor_placed error: %s", e)
        return {"executed": 0, "issues": []}


def handle_post_import(asset_path: str, asset_class: str) -> Dict[str, Any]:
    """导入后执行检查工具。"""
    asset_name = asset_path.rsplit("/", 1)[-1].split(".")[0] if asset_path else ""
    try:
        dispatcher = _get_dispatcher()
        _ue_log(f"handle_post_import path={asset_path} class={asset_class}")
        result = dispatcher.on_trigger_event(
            "asset.import.post",
            filepath=asset_path,
            data={
                "asset_path": asset_path,
                "asset_name": asset_name,
                "asset_class": asset_class,
            },
        )
        return {"executed": result.get("executed", 0),
                "issues": result.get("issues", [])}
    except Exception as e:
        logger.error("handle_post_import error: %s", e)
        return {"executed": 0, "issues": []}


# ── UE 通知系统（C++ FlushPendingNotify 桥接）──────────────────────

_PENDING_NOTIFY_PATH = str(Path.home() / ".artifexnexus" / "_pending_notify.json")


def _notify_ue(reason: str, exec_mode: str, asset_path: str = "") -> None:
    """根据 execution_mode 向 UE 发送通知。

    - silent : log_warning + 写 pending 文件（C++ FlushPendingNotify 消费）
    - notify : EditorDialog 弹窗，失败时回退到 pending 文件
    """
    try:
        import unreal
        label = asset_path.rsplit("/", 1)[-1] if asset_path else "Asset"
        unreal.log_warning(f"[Artifex Nexus] {label}: {reason}")

        mode = exec_mode.lower() if exec_mode else "silent"

        if mode == "notify":
            try:
                unreal.EditorDialog.show_message(
                    unreal.Text("Artifex Nexus — 触发器检查"),
                    unreal.Text(reason),
                    unreal.AppMsgType.OK,
                )
                _write_pending({"mode": "handled", "message": reason, "asset_path": asset_path})
                return
            except Exception:
                pass  # 回退到 pending 文件

        # silent 或 notify 回退
        _write_pending({"mode": mode, "message": reason, "asset_path": asset_path})

    except Exception:
        pass


def _write_pending(payload: dict) -> None:
    """写 pending 通知文件，供 C++ FlushPendingNotify 消费。"""
    try:
        with open(_PENDING_NOTIFY_PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception as ex:
        logger.warning("_write_pending failed: %s", ex)
