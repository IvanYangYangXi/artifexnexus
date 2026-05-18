"""context — DCC 上下文查询模块

提供跨 DCC 的选中对象/资产查询接口。
与 artclaw_sdk.context 兼容。
"""

from typing import Any, Dict, List


def get_selected_objects() -> List[Dict[str, Any]]:
    """获取当前 DCC 中选中的对象列表。

    自动检测当前 DCC 环境（Blender / UE / Maya / 3ds Max）。

    Returns:
        [{"name": str, "type": str, ...}, ...]
    """
    # ── Blender ──
    try:
        import bpy
        result = []
        for obj in bpy.context.selected_objects:
            result.append({
                "name": obj.name,
                "type": obj.type,
                "class": obj.type,
            })
        return result
    except ImportError:
        pass

    # ── Unreal Engine ──
    try:
        import unreal
        editor_util = unreal.EditorUtilityLibrary()
        selected = editor_util.get_selected_assets()
        result = []
        for asset in selected:
            result.append({
                "name": asset.get_name(),
                "path": asset.get_path_name(),
                "class": str(asset.get_class().get_name()),
                "type": str(asset.get_class().get_name()),
            })
        return result
    except (ImportError, AttributeError):
        pass

    # ── Maya ──
    try:
        import maya.cmds as cmds
        result = []
        for obj in cmds.ls(selection=True, long=True) or []:
            result.append({
                "name": obj.split("|")[-1],
                "path": obj,
                "type": cmds.objectType(obj),
            })
        return result
    except ImportError:
        pass

    # ── 3ds Max ──
    try:
        import pymxs
        rt = pymxs.runtime
        result = []
        for obj in rt.selection:
            result.append({
                "name": obj.name,
                "type": str(rt.classOf(obj)),
            })
        return result
    except ImportError:
        pass

    # ── 无 DCC ──
    return []


def get_selected_assets() -> List[Dict[str, Any]]:
    """获取当前 DCC Content Browser 中选中的资产列表。

    主要用于 Unreal Engine，Blender 无 Content Browser 概念。

    Returns:
        [{"name": str, "path": str, "class": str, "type": str}, ...]
    """
    # ── Unreal Engine ──
    try:
        import unreal
        editor_util = unreal.EditorUtilityLibrary()
        selected = editor_util.get_selected_assets()
        result = []
        for asset in selected:
            result.append({
                "name": asset.get_name(),
                "path": asset.get_path_name(),
                "class": str(asset.get_class().get_name()),
                "type": str(asset.get_class().get_name()),
            })
        return result
    except (ImportError, AttributeError):
        pass

    # ── 其他 DCC 回退到 get_selected_objects ──
    return get_selected_objects()
