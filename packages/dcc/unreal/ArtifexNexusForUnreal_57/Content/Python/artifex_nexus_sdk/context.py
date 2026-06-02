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
        # 使用 get_selected_asset_data() 而非 get_selected_assets()
        # get_selected_assets() 要求资产已加载到内存，未加载的返回空
        # get_selected_asset_data() 返回轻量 AssetData，无需加载资产
        selected_asset_data = unreal.EditorUtilityLibrary.get_selected_asset_data()
        result = []
        for ad in selected_asset_data:
            asset_info = {
                "name": str(ad.asset_name),
                "path": str(ad.package_name),
            }
            try:
                cls = ad.find_asset_native_class()
                asset_info["class"] = cls.get_name() if cls else str(ad.asset_class_path.asset_name)
            except Exception:
                asset_info["class"] = str(ad.asset_class_path.asset_name)
            asset_info["type"] = asset_info["class"]
            result.append(asset_info)
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
        # 使用 get_selected_asset_data() — 不要求资产加载到内存
        selected_asset_data = unreal.EditorUtilityLibrary.get_selected_asset_data()
        result = []
        for ad in selected_asset_data:
            asset_info = {
                "name": str(ad.asset_name),
                "path": str(ad.package_name),
            }
            try:
                cls = ad.find_asset_native_class()
                asset_info["class"] = cls.get_name() if cls else str(ad.asset_class_path.asset_name)
            except Exception:
                asset_info["class"] = str(ad.asset_class_path.asset_name)
            asset_info["type"] = asset_info["class"]
            result.append(asset_info)
        return result
    except (ImportError, AttributeError):
        pass

    # ── 其他 DCC 回退到 get_selected_objects ──
    return get_selected_objects()
