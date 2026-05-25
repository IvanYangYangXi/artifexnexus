"""
dcc_installer.py — DCC 插件安装/卸载/检测（Blender 首发）
=========================================================

    复刻自 artclaw_bridge/install_dcc_ext.py，精简：
  - 保留 Blender 相关逻辑
  - 去掉 Houdini / SP / SD / ComfyUI / Unreal（UE 插件直接安装到 UE 项目目录，不走引擎扫描）
  - 去掉 Skill 安装 / Python 依赖安装（M4 再做）
  - 统一使用物理拷贝（copy），弃用 junction/symlink（2026-05-09 决策变更）

设计：
  - find_blender_versions() → 扫描本机已安装版本
  - install_dcc_addon(dcc, version) → 物理拷贝安装
  - uninstall_dcc_addon(dcc, version) → 删除目录
  - get_addon_info() → 读取 bl_info / plugin_info 获取兼容版本范围
  - install_gateway_mcp_bridge() → 部署 mcp-bridge 插件到 OpenClaw extensions
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import logging
import os
import platform
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── 常量 ────────────────────────────────────────────────────────────────

# 插件源路径（相对于项目根目录）
# 运行时由 sidecar 注入 _ADDON_SRC_DIR
_ADDON_SRC_DIR: Optional[Path] = None

# 插件在 Blender addons 中的目录名前缀
_ADDON_DIR_PREFIX = "artifex_nexus"

# ── Deploy Manifest 常量 ─────────────────────────────────────────────────

_MANIFEST_FILENAME = "deploy-manifest.json"
"""部署清单文件名（位于 OPENCLAW_HOME/state/ 下）。"""

_MANIFEST_VERSION = 1
"""部署清单 schema 版本。"""

# 扫描/校验时排除的 glob 模式（生成文件、系统文件不应参与校验）
_SCAN_IGNORE_PATTERNS = [
    "__pycache__/",
    "*.pyc",
    "*.pyo",
    ".DS_Store",
    "Thumbs.db",
    "*.egg-info/",
]


def _get_openclaw_home_dir() -> str:
    """获取 OPENCLAW_HOME 路径（统一入口）。

    所有 dcc_installer 内部函数均通过此函数获取隔离目录路径，
    确保与 sidecar.py / fs_layout.rs 保持一致：~/.artifexnexus/.openclaw/。

    Returns the OPENCLAW_HOME directory path.
    """
    return os.environ.get(
        "OPENCLAW_HOME",
        os.path.join(os.path.expanduser("~"), ".artifexnexus", ".openclaw"),
    )


def _get_manifest_path() -> Path:
    """获取部署清单文件路径。

    Returns the path to deploy-manifest.json.
    """
    return Path(_get_openclaw_home_dir()) / "state" / _MANIFEST_FILENAME


def _get_addon_dir_name() -> str:
    """获取插件目录名（固定名，不含版本号以避免 Python import 点号问题）"""
    return _ADDON_DIR_PREFIX


def set_addon_src_dir(path: str) -> None:
    """设置插件源目录（由 sidecar 在启动时调用）"""
    global _ADDON_SRC_DIR
    _ADDON_SRC_DIR = Path(path)
    logger.info(f"DCC 安装器: 插件源目录 = {_ADDON_SRC_DIR}")


def _get_addon_src_dir(dcc: str = "blender") -> Path:
    """获取插件源目录（版本化路径）。

    Args:
        dcc: DCC 标识，如 "blender" / "maya" / "3ds_max"

    优先级：
      1. 环境变量 ARTIFEX_NEXUS_PROJECT_ROOT（sidecar 启动时注入）
      2. 显式调用 set_addon_src_dir()
      3. 基于 __file__ 的相对路径（开发模式）
    """
    if _ADDON_SRC_DIR is not None and dcc == "blender":
        return _ADDON_SRC_DIR

    # DCC 对应的 addon 子目录名
    _ADDON_DIR_NAMES = {
        "blender": "blender_addon",
        "maya": "maya_addon",
        "3ds_max": "max_addon",
    }
    addon_dir_name = _ADDON_DIR_NAMES.get(dcc, f"{dcc}_addon")

    # DCC key → 实际 packages/dcc/ 目录名映射
    # dcc_installer 内部使用 "3ds_max" 作 key，但目录名为 "max"
    _DCC_PKG_DIR = {
        "blender": "blender",
        "maya": "maya",
        "3ds_max": "max",
    }
    dcc_pkg_dir = _DCC_PKG_DIR.get(dcc, dcc)

    # 环境变量注入（生产模式：sidecar 由 Tauri 启动）
    env_root = os.environ.get("ARTIFEX_NEXUS_PROJECT_ROOT")
    if env_root:
        base = Path(env_root) / "packages" / "dcc" / dcc_pkg_dir / "src" / "artifex_nexus"
        if base.exists():
            for entry in sorted(base.iterdir(), reverse=True):
                if entry.is_dir() and entry.name.startswith("v"):
                    addon_dir = entry / addon_dir_name
                    if addon_dir.exists():
                        logger.info(f"DCC 安装器({dcc}): 通过 ARTIFEX_NEXUS_PROJECT_ROOT 定位插件源目录 = {addon_dir}")
                        return addon_dir
            # 所有版本目录都找不到 addon 子目录
            raise RuntimeError(
                f"在 {base} 下找到版本目录，但未找到子目录 '{addon_dir_name}'。"
                f"请检查 {dcc_pkg_dir} 插件源目录结构。"
            )
        raise RuntimeError(
            f"环境变量 ARTIFEX_NEXUS_PROJECT_ROOT={env_root}，"
            f"但未找到插件源目录: {base}"
        )

    # 基于 __file__ 的相对路径（开发模式）
    _here = Path(__file__).resolve().parent
    # artifex_nexus/openclaw_wrapper/dcc_installer.py
    # → ../../../../dcc/{dcc_pkg_dir}/src/artifex_nexus
    base = (_here / ".." / ".." / ".." / ".." / "dcc" / dcc_pkg_dir / "src" / "artifex_nexus").resolve()
    if base.exists():
        for entry in sorted(base.iterdir(), reverse=True):
            if entry.is_dir() and entry.name.startswith("v"):
                addon_dir = entry / addon_dir_name
                if addon_dir.exists():
                    logger.info(f"DCC 安装器({dcc}): 通过相对路径定位插件源目录 = {addon_dir}")
                    return addon_dir
        # 所有版本目录都找不到 addon 子目录
        raise RuntimeError(
            f"在 {base} 下找到版本目录，但未找到子目录 '{addon_dir_name}'。"
            f"请检查 {dcc_pkg_dir} 插件源目录结构。"
        )

    raise RuntimeError(
        f"无法定位 {dcc} 插件源目录。请设置环境变量 ARTIFEX_NEXUS_PROJECT_ROOT 或调用 set_addon_src_dir()。"
        f"\n  已尝试路径: {base}"
    )


# ── UE 插件版本常量 ──────────────────────────────────────────────────────

# UE 插件多版本通过目录后缀区分（如 ArtifexNexusForUnreal_57/）。
# 以下常量声明兼容范围，供 check_ue_version_compatibility() 使用。
_UE_PLUGIN_DEFAULTS = {
    "name": "Artifex Nexus for Unreal",
    "version": (0, 1, 0),
    "ue_min": (5, 7, 0),
    "ue_max": (5, 7, 9),
}

# UE 插件源目录在 monorepo 中的相对路径
_UE_PLUGIN_SRC_BASE = "packages/dcc/unreal"
# 目录命名格式：ArtifexNexusForUnreal_<major><minor>（如 ArtifexNexusForUnreal_57）
_UE_PLUGIN_DIR_PREFIX = "ArtifexNexusForUnreal_"


def _parse_ue_version_suffix(ue_version: str) -> str:
    """解析 UE 版本号为目录后缀。

    只取 major.minor，忽略 patch 版本号。
    "5.7"   → "57"
    "5.7.4" → "57"
    "5.6"   → "56"

    Raises:
        ValueError: 版本号格式无效
    """
    parts = ue_version.strip().split(".")
    if len(parts) < 2:
        raise ValueError(
            f"无效的 UE 版本号: '{ue_version}'，"
            f"需要格式如 5.7 或 5.7.4（最后一位可忽略）"
        )
    major = parts[0]
    minor = parts[1]
    if not (major.isdigit() and minor.isdigit()):
        raise ValueError(f"无效的 UE 版本号: '{ue_version}'，主次版本号必须为数字")
    return f"{major}{minor}"


def _reverse_ue_version_suffix(suffix: str) -> str:
    """将目录后缀反转为 UE 版本号。

    "57" → "5.7"
    "56" → "5.6"
    """
    if len(suffix) >= 2 and suffix.isdigit():
        major = suffix[0]
        minor = suffix[1:]
        return f"{major}.{minor}"
    return suffix


def _parse_ue_plugin_descriptor(uplugin_path: Path) -> dict:
    """解析 .uplugin 文件，提取插件元信息。

    Returns:
        {"name": str, "version": tuple, "dcc_min": tuple, "dcc_max": None}
    """
    import json
    with open(uplugin_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    engine_ver = data.get("EngineVersion", "5.0.0")
    parts = tuple(int(x) for x in engine_ver.split("."))
    if len(parts) < 2:
        parts = parts + (0,) * (3 - len(parts))
    while len(parts) < 3:
        parts = parts + (0,)

    return {
        "name": data.get("FriendlyName", "Artifex Nexus for Unreal"),
        "version": parts,
        "dcc_min": parts,
        "dcc_max": None,  # UE 插件只兼容指定引擎版本
    }


def _resolve_ue_src_base() -> Path:
    """解析 packages/dcc/unreal/ 的绝对路径。

    优先级：环境变量 > __file__ 相对路径 > parents 回退
    """
    env_root = os.environ.get("ARTIFEX_NEXUS_PROJECT_ROOT")
    if env_root:
        return Path(env_root) / _UE_PLUGIN_SRC_BASE

    # __file__ 位于 packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/
    # 需要上溯 6 级到项目根，再下到 packages/dcc/unreal/
    _here = Path(__file__).resolve().parent
    for depth in (6, 7, 8):  # 尝试多个深度
        candidate = (_here.parents[depth] / _UE_PLUGIN_SRC_BASE)
        if candidate.is_dir():
            return candidate

    raise FileNotFoundError(
        f"无法定位 UE 插件源目录 ({_UE_PLUGIN_SRC_BASE})。"
        f"请设置环境变量 ARTIFEX_NEXUS_PROJECT_ROOT。"
    )


def _get_ue_plugin_src_dir(ue_version: str) -> Path:
    """根据 UE 版本号查找对应的插件源目录。

    Args:
        ue_version: 如 "5.7" 或 "5.7.4"

    Returns:
        packages/dcc/unreal/ArtifexNexusForUnreal_57/ 的 Path

    Raises:
        FileNotFoundError: 没有匹配的插件目录
    """
    suffix = _parse_ue_version_suffix(ue_version)
    dir_name = f"{_UE_PLUGIN_DIR_PREFIX}{suffix}"
    target = _resolve_ue_src_base() / dir_name

    if target.is_dir():
        logger.info(f"DCC 安装器: UE {ue_version} → {target}")
        return target

    raise FileNotFoundError(
        f"未找到 UE {ue_version} 对应的插件目录: {target}\n"
        f"支持的目录格式: {_UE_PLUGIN_SRC_BASE}/{dir_name}/"
    )


# ── 通用 DCC 接口 ────────────────────────────────────────────────────────

# DCC 版本扫描路径映射（key = dcc_id）
# 注意：unreal 不在此表中 —— UE 插件直接安装到项目目录，不扫描引擎目录
_DCC_VERSION_SCAN_PATHS: Dict[str, str] = {
    "blender": os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~/AppData/Roaming")),
        "Blender Foundation", "Blender",
    ),
    "maya": os.path.join(os.path.expanduser("~"), "Documents", "maya"),
    "3ds_max": os.path.join(os.environ.get("LOCALAPPDATA", ""), "Autodesk", "3dsMax"),
}

# DCC 插件安装路径模板（key = dcc_id）
# 注意：unreal 不在此表中 —— UE 插件由用户手动放入 UE 项目 Plugins/ 目录
_DCC_ADDON_PATH_TEMPLATES: Dict[str, str] = {
    "blender": "{base}/{version}/scripts/addons/",
    "maya": "{base}/{version}/scripts/",
    "3ds_max": "{base}/{version}/ENU/scripts/",
}


def find_dcc_versions(dcc: str) -> List[str]:
    """扫描本机已安装的 DCC 版本（通用接口）。

    Args:
        dcc: DCC 标识，如 "blender" / "maya" / "3ds_max"

    Returns:
        降序排列的版本号列表
    """
    base = _DCC_VERSION_SCAN_PATHS.get(dcc)
    if not base or not os.path.isdir(base):
        return []

    versions = []
    try:
        for entry in os.scandir(base):
            if not entry.is_dir():
                continue
            name = entry.name
            if name and name[0].isdigit():
                versions.append(name)
    except OSError:
        pass

    return sorted(versions, reverse=True)


def get_dcc_addon_target_dir(dcc: str, dcc_version: str) -> str:
    """获取插件在 DCC 中的目标安装路径（通用接口）。

    Args:
        dcc: DCC 标识
        dcc_version: DCC 版本号

    Returns:
        目标目录路径
    """
    template = _DCC_ADDON_PATH_TEMPLATES.get(dcc)
    if not template:
        raise ValueError(f"不支持的 DCC: {dcc}")

    base = _DCC_VERSION_SCAN_PATHS.get(dcc, "")
    return os.path.join(
        template.format(base=base, version=dcc_version),
        _get_addon_dir_name(),
    )


def install_dcc_addon(dcc: str, dcc_version: str, force: bool = False) -> Dict:
    """安装插件到指定 DCC 版本（通用接口）。

    Args:
        dcc: DCC 标识
        dcc_version: DCC 版本号
        force: 跳过兼容性检查

    Returns:
        {"success": bool, "method": str|None, "target": str, "error": str|None}
    """
    src_dir = str(_get_addon_src_dir(dcc))
    target_dir = get_dcc_addon_target_dir(dcc, dcc_version)

    logger.info(f"安装 {dcc} 插件: {src_dir} → {target_dir}")

    if not os.path.isdir(src_dir):
        return {"success": False, "method": None, "target": target_dir, "error": f"插件源目录不存在: {src_dir}"}

    compatible, reason = check_dcc_version_compatibility(dcc, dcc_version) if dcc in ("maya", "3ds_max", "blender", "unreal_engine") else (
        True, ""
    )
    if not compatible and not force:
        # 返回可用插件版本供前端提示
        available = get_available_plugin_versions(dcc)
        return {
            "success": False, "method": None, "target": target_dir,
            "error": reason,
            "available_versions": [v["version"] for v in available],
        }

    os.makedirs(os.path.dirname(target_dir), exist_ok=True)

    if os.path.exists(target_dir) or _is_junction_or_symlink(target_dir):
        _remove_link_or_dir(target_dir)

    # 强制使用物理拷贝（不用 junction/symlink）。
    # 原因：OpenClaw v2026.5.4 的 discovery 会 fs.realpathSync 解析路径，
    # 跨卷 junction 导致 rootDir 指向源码盘，被 trusted-root 安全检查拒绝。
    # 物理拷贝更稳健且避免跨卷问题。（决策变更 2026-05-09）
    try:
        shutil.copytree(src_dir, target_dir, ignore=_get_ignore_patterns_for_shutil())
        method = "copy"
    except Exception as e:
        err_detail = str(e)
        logger.error(f"安装 {dcc} 插件失败: copy 失败: {err_detail}")
        return {"success": False, "method": None, "target": target_dir, "error": f"复制目录失败: {err_detail}"}

    # 记录部署清单
    source_version = _get_source_version(Path(src_dir))
    deployment_id = f"{dcc}-addon-{dcc_version}"
    try:
        _record_deployment(deployment_id, src_dir, target_dir, source_version)
    except Exception as e:
        logger.warning(f"部署清单记录失败（不阻断安装）: {e}")

    logger.info(f"{dcc} {dcc_version} 插件安装成功 ({method})")

    # 注册工具源码目录到 tool-sources.json（供 Blender/DCC 触发器系统使用）
    _try_register_tool_source(src_dir)

    return {"success": True, "method": method, "target": target_dir, "error": None}


def uninstall_dcc_addon(dcc: str, dcc_version: str) -> Dict:
    """卸载插件（通用接口）。"""
    target_dir = get_dcc_addon_target_dir(dcc, dcc_version)
    logger.info(f"卸载 {dcc} 插件: {target_dir}")

    deployment_id = f"{dcc}-addon-{dcc_version}"
    # ⚠️ 无论目录是否存在，都先清理 manifest（避免卸载后校验误报"缺失"）
    try:
        _remove_from_manifest(deployment_id)
    except Exception as e:
        logger.warning(f"部署清单清理失败（不阻断卸载）: {e}")

    if not os.path.exists(target_dir) and not _is_junction_or_symlink(target_dir):
        return {"success": True, "target": target_dir, "error": None, "message": "插件未安装"}

    try:
        _remove_link_or_dir(target_dir)
        return {"success": True, "target": target_dir, "error": None, "message": "卸载成功"}
    except Exception as e:
        return {"success": False, "target": target_dir, "error": str(e)}


# ── DCC 端口管理 ──────────────────────────────────────────────────────────

# DCC 默认端口映射（key = dcc_id）
_DCC_DEFAULT_PORTS: Dict[str, int] = {
    "blender": 18083,
    "unreal": 18080,
    "maya": 18081,
    "3ds_max": 18082,
}

# UE MCP Server 默认端口
UE_MCP_DEFAULT_PORT = 18080


def get_dcc_port(dcc: str) -> Dict:
    """获取 DCC 的 MCP Server 端口配置。

    从 openclaw.json 的 mcp-bridge 配置中读取。

    Returns:
        {"port": int, "url": str, "server_name": str}
    """
    server_name = f"{dcc}-editor" if dcc in ("blender", "unreal") else f"{dcc}-primary"
    default_port = _DCC_DEFAULT_PORTS.get(dcc, 18083)

    # 从 openclaw.json 读取当前配置
    openclaw_home = _get_openclaw_home_dir()
    config_path = os.path.join(openclaw_home, "openclaw.json")

    port = default_port
    url = f"ws://127.0.0.1:{default_port}"

    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            servers = (
                config.get("plugins", {})
                .get("entries", {})
                .get("mcp-bridge", {})
                .get("config", {})
                .get("servers", {})
            )
            server_def = servers.get(server_name, {})
            if server_def.get("url"):
                url = server_def["url"]
                # 从 url 中提取端口
                parts = url.rsplit(":", 1)
                if len(parts) == 2:
                    try:
                        port = int(parts[1])
                    except ValueError:
                        pass
        except Exception:
            logger.debug("get_dcc_port: failed to read config for %s, using default port %d",
                        server_name, default_port, exc_info=True)

    return {"port": port, "url": url, "server_name": server_name}


def set_dcc_port(dcc: str, port: int) -> Dict:
    """设置 DCC 的 MCP Server 端口。

    同步更新 openclaw.json 中 mcp-bridge 配置的 url。
    如果 DCC 有多个插件版本，全部同步更新。

    Returns:
        {"success": bool, "port": int, "url": str, "error": str|None}
    """
    server_name = f"{dcc}-editor" if dcc in ("blender", "unreal") else f"{dcc}-primary"
    new_url = f"ws://127.0.0.1:{port}"

    openclaw_home = _get_openclaw_home_dir()
    config_path = os.path.join(openclaw_home, "openclaw.json")

    if not os.path.exists(config_path):
        return {
            "success": False,
            "port": port,
            "url": new_url,
            "error": f"openclaw.json 不存在: {config_path}",
        }

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        return {"success": False, "port": port, "url": new_url, "error": f"读取配置失败: {e}"}

    # 更新 mcp-bridge 配置
    servers = (
        config
        .setdefault("plugins", {})
        .setdefault("entries", {})
        .setdefault("mcp-bridge", {"enabled": True})
        .setdefault("config", {})
        .setdefault("servers", {})
    )

    # 更新当前 server
    if server_name not in servers:
        servers[server_name] = {"type": "websocket", "enabled": True}
    servers[server_name]["url"] = new_url

    # 同步更新同一 DCC 的其他 server（多插件版本场景）
    # 如 blender-editor-v2、blender-editor-v3 等
    updated_servers = [server_name]
    for key in list(servers.keys()):
        if key.startswith(f"{dcc}-") and key != server_name:
            servers[key]["url"] = new_url
            updated_servers.append(key)

    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        logger.info(
            f"DCC 端口已更新: {dcc} → {port} "
            f"(servers: {', '.join(updated_servers)})"
        )
        return {
            "success": True,
            "port": port,
            "url": new_url,
            "error": None,
            "updated_servers": updated_servers,
        }
    except Exception as e:
        return {"success": False, "port": port, "url": new_url, "error": f"写入配置失败: {e}"}


def is_dcc_addon_installed(dcc: str, dcc_version: str) -> bool:
    """检查插件是否已安装（通用接口）。"""
    target_dir = get_dcc_addon_target_dir(dcc, dcc_version)
    return os.path.exists(target_dir) or _is_junction_or_symlink(target_dir)


# ── Blender 便捷别名（向后兼容）───────────────────────────────────────────

def find_blender_versions() -> List[str]:
    return find_dcc_versions("blender")


def install_blender_addon(blender_version: str, force: bool = False) -> Dict:
    return install_dcc_addon("blender", blender_version, force)


def uninstall_blender_addon(blender_version: str) -> Dict:
    return uninstall_dcc_addon("blender", blender_version)


def is_addon_installed(blender_version: str) -> bool:
    return is_dcc_addon_installed("blender", blender_version)


# ── Maya 便捷别名 ─────────────────────────────────────────────────────────

def find_maya_versions() -> List[str]:
    """扫描本机已安装的 Maya 版本。

    三层检测策略（按优先级递减）：
      1. Windows 注册表 (HKLM/SOFTWARE/Autodesk/Maya/{version})
      2. Program Files 目录扫描 (C:/Program Files/Autodesk/Maya{version})
      3. 用户偏好目录回退 (~/Documents/maya/)
    """
    versions = set()

    # ── 策略 1: Windows 注册表 ──────────────────────────────────
    try:
        import winreg
        for root_key in [winreg.HKEY_LOCAL_MACHINE]:
            try:
                key = winreg.OpenKey(root_key, r"SOFTWARE\Autodesk\Maya")
                i = 0
                while True:
                    try:
                        sub_name = winreg.EnumKey(key, i)
                        # 子键名如 "2023", "2024", "2025"
                        if sub_name.isdigit():
                            versions.add(sub_name)
                        i += 1
                    except OSError:
                        break
                winreg.CloseKey(key)
            except OSError:
                pass
    except ImportError:
        pass

    # ── 策略 2: Program Files 目录扫描 ──────────────────────────
    program_files_dirs = [
        os.environ.get("ProgramFiles", r"C:\Program Files"),
    ]
    if os.environ.get("ProgramFiles(x86)"):
        program_files_dirs.append(os.environ["ProgramFiles(x86)"])

    for pf in program_files_dirs:
        autodesk_dir = os.path.join(pf, "Autodesk")
        if not os.path.isdir(autodesk_dir):
            continue
        try:
            for entry in os.scandir(autodesk_dir):
                if not entry.is_dir():
                    continue
                # 匹配目录名: "Maya2023", "Maya 2023", "Maya2024" 等
                name = entry.name
                # 提取纯数字版本号
                digits = "".join(c for c in name.split("Maya")[-1] if c.isdigit())
                if digits and len(digits) == 4:  # Maya 版本号均为 4 位年份
                    # 验证: 该目录下有 bin/maya.exe
                    maya_exe = os.path.join(entry.path, "bin", "maya.exe")
                    if os.path.isfile(maya_exe):
                        versions.add(digits)
        except OSError:
            pass

    # ── 策略 3: 用户偏好目录回退 ────────────────────────────────
    maya_user_dir = os.path.join(os.path.expanduser("~"), "Documents", "maya")
    if os.path.isdir(maya_user_dir):
        try:
            for entry in os.scandir(maya_user_dir):
                if entry.is_dir() and entry.name.isdigit():
                    versions.add(entry.name)
        except OSError:
            pass

    return sorted(versions, reverse=True)


def install_maya_addon(maya_version: str, force: bool = False) -> Dict:
    """安装 Maya 插件 + locale 同步。

    Maya 安装策略：
      1. 安装主目录到 ~/Documents/maya/{ver}/scripts/artifex_nexus/
      2. 扫描 locale 子目录（xx_XX 格式），物理复制到各 locale
    """
    result = install_dcc_addon("maya", maya_version, force)
    if not result.get("success"):
        return result

    # locale 同步
    locale_synced = _sync_maya_locales(maya_version)
    if locale_synced:
        result["locale_synced"] = locale_synced

    return result


def uninstall_maya_addon(maya_version: str) -> Dict:
    """卸载 Maya 插件（含 locale 目录清理）"""
    # 清理 locale 目录中的副本
    _cleanup_maya_locales(maya_version)
    return uninstall_dcc_addon("maya", maya_version)


def _get_maya_locale_dirs(maya_version: str) -> List[str]:
    """扫描 Maya 版本的 locale 子目录（xx_XX/scripts/ 格式）"""
    base = _DCC_VERSION_SCAN_PATHS.get("maya", "")
    version_dir = os.path.join(base, maya_version)
    locales = []
    if os.path.isdir(version_dir):
        for entry in os.scandir(version_dir):
            if entry.is_dir() and "_" in entry.name:
                scripts_dir = os.path.join(entry.path, "scripts")
                if os.path.isdir(scripts_dir):
                    locales.append(scripts_dir)
    return locales


def _sync_maya_locales(maya_version: str) -> List[str]:
    """同步 Maya locale 目录：物理复制到各 locale 的 scripts/artifex_nexus/"""
    base = _DCC_VERSION_SCAN_PATHS.get("maya", "")
    main_target = os.path.join(base, maya_version, "scripts", "artifex_nexus")
    synced = []
    for locale_dir in _get_maya_locale_dirs(maya_version):
        locale_target = os.path.join(locale_dir, "artifex_nexus")
        if not os.path.exists(locale_target):
            try:
                shutil.copytree(main_target, locale_target, ignore=_get_ignore_patterns_for_shutil())
                synced.append(os.path.basename(os.path.dirname(locale_dir)))
            except OSError:
                pass
    return synced


def _cleanup_maya_locales(maya_version: str) -> None:
    """清理 Maya locale 目录中的副本"""
    for locale_dir in _get_maya_locale_dirs(maya_version):
        locale_target = os.path.join(locale_dir, "artifex_nexus")
        if os.path.exists(locale_target):
            _remove_link_or_dir(locale_target)


# ── 3ds Max 便捷别名 ──────────────────────────────────────────────────────

def _max_registry_key_to_year(sub_name: str) -> Optional[int]:
    """将 3ds Max 注册表子键名转换为年份版本号。

    Autodesk 注册表的两种格式：
      - "major.minor" 内部版本号：25.0 -> 2023 （公式: 1998 + major）
      - "YYYY" 纯年份：2023 -> 2023

    返回 None 表示不是有效的版本键。
    """
    # 格式 1: "major.minor"（如 "25.0", "23.0"）
    if "." in sub_name:
        parts = sub_name.split(".")
        if len(parts) == 2 and parts[0].isdigit():
            return 1998 + int(parts[0])
        return None
    # 格式 2: 纯数字年份（如 "2023"）
    if sub_name.isdigit() and len(sub_name) == 4:
        return int(sub_name)
    return None


def find_max_versions() -> List[str]:
    """扫描本机已安装的 3ds Max 版本。

    四层检测策略（按优先级递减）：
      1. Windows 注册表 (HKLM/SOFTWARE/Autodesk/3dsMax/{version})
         - 支持 "25.0"（Autodesk 内部版本号 -> 2023）和 "2023" 两种格式
         - 通过 Installdir/Location 值验证是否真装
      2. Windows 卸载列表 (HKLM/.../Uninstall) 回退扫描
      3. Program Files 目录扫描 (C:/Program Files/Autodesk/3ds Max {version})
      4. 用户偏好目录回退 (%LOCALAPPDATA%/Autodesk/3dsMax/)
    """
    versions = set()

    # ── 策略 1: Windows 注册表 (Autodesk 专用) ───────────────────
    try:
        import winreg
        for root_key, access in [
            (winreg.HKEY_LOCAL_MACHINE, winreg.KEY_READ | winreg.KEY_WOW64_64KEY),
        ]:
            try:
                key = winreg.OpenKey(root_key, r"SOFTWARE\Autodesk\3dsMax", 0, access)
                i = 0
                while True:
                    try:
                        sub_name = winreg.EnumKey(key, i)
                        year = _max_registry_key_to_year(sub_name)
                        if year is not None:
                            # 验证实际安装：子键下必须有 Installdir 或 Location
                            try:
                                ver_key = winreg.OpenKey(key, sub_name)
                                instdir = None
                                for val_name in ("Installdir", "Location"):
                                    try:
                                        instdir, _ = winreg.QueryValueEx(ver_key, val_name)
                                        break
                                    except OSError:
                                        continue
                                winreg.CloseKey(ver_key)
                                if instdir and os.path.isdir(instdir):
                                    versions.add(str(year))
                            except OSError:
                                pass
                        i += 1
                    except OSError:
                        break
                winreg.CloseKey(key)
            except OSError:
                pass
    except ImportError:
        pass

    # ── 策略 2: Windows 卸载列表回退 ─────────────────────────────
    if not versions:
        try:
            import winreg
            uninstall_roots = [
                (winreg.HKEY_LOCAL_MACHINE,
                 r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                (winreg.HKEY_LOCAL_MACHINE,
                 r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            ]
            import re
            _MAX_UNINSTALL_RE = re.compile(r"3ds\s*Max\s*(\d{4})", re.IGNORECASE)
            for root_key, sub_path in uninstall_roots:
                try:
                    key = winreg.OpenKey(root_key, sub_path)
                    i = 0
                    while True:
                        try:
                            sub_name = winreg.EnumKey(key, i)
                            try:
                                prod_key = winreg.OpenKey(key, sub_name)
                                try:
                                    display, _ = winreg.QueryValueEx(prod_key, "DisplayName")
                                except OSError:
                                    display = ""
                                winreg.CloseKey(prod_key)
                                m = _MAX_UNINSTALL_RE.search(display)
                                if m:
                                    versions.add(m.group(1))
                            except OSError:
                                pass
                            i += 1
                        except OSError:
                            break
                    winreg.CloseKey(key)
                except OSError:
                    pass
        except ImportError:
            pass

    # ── 策略 3: Program Files 目录扫描 ──────────────────────────
    program_files_dirs = []
    for env_key in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"):
        val = os.environ.get(env_key)
        if val and os.path.isdir(val):
            program_files_dirs.append(val)
    if not program_files_dirs:
        program_files_dirs = [r"C:\Program Files"]

    for pf in program_files_dirs:
        autodesk_dir = os.path.join(pf, "Autodesk")
        if not os.path.isdir(autodesk_dir):
            continue
        try:
            for entry in os.scandir(autodesk_dir):
                if not entry.is_dir():
                    continue
                # 匹配: "3ds Max 2024", "3ds Max 2023", "3dsMax 2024" 等
                name = entry.name.lower().replace(" ", "")
                if "3dsmax" in name and name != "3dsmax":
                    digits = "".join(c for c in name if c.isdigit())
                    if digits and len(digits) == 4:
                        # 验证: 该目录下有 3dsmax.exe
                        max_exe = os.path.join(entry.path, "3dsmax.exe")
                        if os.path.isfile(max_exe):
                            versions.add(digits)
        except OSError:
            pass

    # ── 策略 4: 用户偏好目录回退 ────────────────────────────────
    base = _DCC_VERSION_SCAN_PATHS.get("3ds_max", "")
    if os.path.isdir(base):
        try:
            for entry in os.scandir(base):
                if not entry.is_dir():
                    continue
                name = entry.name
                ver = name.split(" ")[0] if " " in name else name
                if ver and ver[0].isdigit():
                    versions.add(ver)
        except OSError:
            pass

    return sorted(versions, reverse=True)


def install_max_addon(max_version: str, force: bool = False) -> Dict:
    """安装 3ds Max 插件 + locale 同步 + 启动脚本。

    Max 安装策略：
      1. 安装主目录到 %LOCALAPPDATA%/Autodesk/3dsMax/{ver}/ENU/scripts/artifex_nexus/
      2. 部署 startup/artifex_startup.py + artifex_startup.ms
      3. 扫描所有 locale 目录，同步 artifex_nexus/ + 启动脚本
    """
    result = install_dcc_addon("3ds_max", max_version, force)
    if not result.get("success"):
        return result

    # 部署启动脚本
    scripts_deployed = _deploy_max_startup_scripts(max_version)
    if scripts_deployed:
        result["startup_scripts"] = scripts_deployed

    # locale 同步
    locale_synced = _sync_max_locales(max_version)
    if locale_synced:
        result["locale_synced"] = locale_synced

    return result


def uninstall_max_addon(max_version: str) -> Dict:
    """卸载 3ds Max 插件（含 locale 清理和启动脚本清理）"""
    _cleanup_max_locales(max_version)
    _cleanup_max_startup_scripts(max_version)
    return uninstall_dcc_addon("3ds_max", max_version)


def _get_max_real_dirs(max_version: str) -> List[str]:
    """获取 3ds Max 版本的所有实际目录（含 '2024 - 64bit' 等变体）"""
    base = _DCC_VERSION_SCAN_PATHS.get("3ds_max", "")
    dirs = []
    if os.path.isdir(base):
        for entry in os.scandir(base):
            if entry.is_dir():
                name = entry.name
                ver = name.split(" ")[0] if " " in name else name
                if ver == max_version:
                    dirs.append(entry.path)
    return dirs


def _get_max_locale_dirs(max_version: str) -> List[Dict[str, str]]:
    """扫描 3ds Max 所有 locale 脚本目录。

    Returns:
        [{version_dir, locale, scripts_dir}, ...]
    """
    results = []
    for version_dir in _get_max_real_dirs(max_version):
        if not os.path.isdir(version_dir):
            continue
        for entry in os.scandir(version_dir):
            if entry.is_dir():
                scripts_dir = os.path.join(entry.path, "scripts")
                if os.path.isdir(scripts_dir) or not os.path.exists(scripts_dir):
                    results.append({
                        "version_dir": version_dir,
                        "locale": entry.name,
                        "scripts_dir": scripts_dir,
                    })
    return results


def _deploy_max_startup_scripts(max_version: str) -> List[str]:
    """部署 3ds Max 启动脚本到所有 locale 的 startup/ 目录"""
    addon_src = _get_addon_src_dir("3ds_max")
    deployed = []
    startup_files = ["artifex_startup.ms"]

    for locale_info in _get_max_locale_dirs(max_version):
        scripts_dir = locale_info["scripts_dir"]
        os.makedirs(scripts_dir, exist_ok=True)
        startup_dir = os.path.join(scripts_dir, "startup")
        os.makedirs(startup_dir, exist_ok=True)

        for fname in startup_files:
            src = os.path.join(addon_src, fname)
            dst = os.path.join(startup_dir, fname)
            if os.path.exists(src):
                shutil.copy2(src, dst)
                deployed.append(f"{locale_info['locale']}/{fname}")

        # 也复制 startup.py
        src_py = os.path.join(addon_src, "startup.py")
        dst_py = os.path.join(startup_dir, "startup.py")
        if os.path.exists(src_py):
            shutil.copy2(src_py, dst_py)
            deployed.append(f"{locale_info['locale']}/startup.py")

    return deployed


def _sync_max_locales(max_version: str) -> List[str]:
    """同步 3ds Max locale 目录：物理复制 artifex_nexus/ + 启动脚本"""
    synced = []
    main_locale_info = None

    # 先找到 ENU 主目录
    for info in _get_max_locale_dirs(max_version):
        if info["locale"].upper() == "ENU":
            main_locale_info = info
            break
    if not main_locale_info:
        # 取第一个 locale 作主目录
        all_locales = _get_max_locale_dirs(max_version)
        if all_locales:
            main_locale_info = all_locales[0]

    if not main_locale_info:
        return synced

    main_target = os.path.join(main_locale_info["scripts_dir"], "artifex_nexus")

    for info in _get_max_locale_dirs(max_version):
        if info["locale"] == main_locale_info["locale"]:
            continue
        locale_target = os.path.join(info["scripts_dir"], "artifex_nexus")
        if not os.path.exists(locale_target):
            try:
                os.makedirs(info["scripts_dir"], exist_ok=True)
                shutil.copytree(main_target, locale_target, ignore=_get_ignore_patterns_for_shutil())
                synced.append(info["locale"])
            except OSError:
                pass

        # 同步 startup 脚本
        main_startup = os.path.join(main_locale_info["scripts_dir"], "startup")
        locale_startup = os.path.join(info["scripts_dir"], "startup")
        if os.path.isdir(main_startup) and not os.path.isdir(locale_startup):
            try:
                shutil.copytree(main_startup, locale_startup)
            except OSError:
                pass

    return synced


def _cleanup_max_locales(max_version: str) -> None:
    """清理 3ds Max locale 目录中的副本"""
    for info in _get_max_locale_dirs(max_version):
        target = os.path.join(info["scripts_dir"], "artifex_nexus")
        if os.path.exists(target):
            _remove_link_or_dir(target)


def _cleanup_max_startup_scripts(max_version: str) -> None:
    """清理 3ds Max 启动脚本"""
    for info in _get_max_locale_dirs(max_version):
        startup_dir = os.path.join(info["scripts_dir"], "startup")
        for fname in ["artifex_startup.ms", "startup.py", "artifex_startup.py"]:
            fp = os.path.join(startup_dir, fname)
            if os.path.isfile(fp):
                try:
                    os.remove(fp)
                except OSError:
                    pass


# ── Unreal 便捷别名 ──────────────────────────────────────────────────────

def find_ue_versions() -> List[str]:
    """扫描 packages/dcc/unreal/ 下可用的 UE 插件版本。

    扫描 ArtifexNexusForUnreal_XX/ 目录，提取 UE 版本号。
    如 ArtifexNexusForUnreal_57 → "5.7"

    Returns:
        降序排列的 UE 版本号列表，如 ["5.7", "5.6", "5.5"]
    """
    base = _resolve_ue_src_base()
    if not base.is_dir():
        return []

    versions = []
    try:
        for entry in base.iterdir():
            if not entry.is_dir():
                continue
            name = entry.name
            if name.startswith(_UE_PLUGIN_DIR_PREFIX):
                suffix = name[len(_UE_PLUGIN_DIR_PREFIX):]
                if suffix.isdigit() and len(suffix) >= 2:
                    # "57" → "5.7"
                    major = suffix[0]
                    minor = suffix[1:]
                    versions.append(f"{major}.{minor}")
    except OSError:
        pass

    return sorted(versions, reverse=True)


def _diagnose_ue_python_readiness(target_dir: Path):
    """安装后诊断：检查 UE 插件 Python 运行时依赖的就绪状态。

    不执行实际的 pip install（UE 未启动），仅做目录结构 + 文件验证。
    输出诊断信息到日志，帮助用户在首次启动前了解依赖状态。
    """
    python_dir = target_dir / "Content" / "Python"
    lib_dir = python_dir / "Lib"
    init_script = python_dir / "init_unreal.py"

    diagnostics = []
    status_ok = True

    # 1. 检查 init_unreal.py
    if init_script.is_file():
        diagnostics.append(f"  init_unreal.py: OK ({init_script.stat().st_size} bytes)")
    else:
        diagnostics.append(f"  init_unreal.py: MISSING (插件启动入口缺失！)")
        status_ok = False

    # 2. 检查 ue_mcp_server.py
    mcp_script = python_dir / "ue_mcp_server.py"
    if mcp_script.is_file():
        diagnostics.append(f"  ue_mcp_server.py: OK")
    else:
        diagnostics.append(f"  ue_mcp_server.py: MISSING")
        status_ok = False

    # 3. 检查 Lib/ 目录
    if lib_dir.is_dir():
        # 统计已安装的包
        installed_pkgs = []
        for item in lib_dir.iterdir():
            if item.is_dir() and item.name not in ("__pycache__",):
                # dist-info 目录格式: package-version.dist-info
                if item.name.endswith(".dist-info"):
                    pkg_name = item.name.rsplit("-", 1)[0]
                    installed_pkgs.append(pkg_name)
                elif not item.name.endswith(".dist-info"):
                    installed_pkgs.append(item.name)

        if installed_pkgs:
            diagnostics.append(f"  Lib/ 已安装: {', '.join(installed_pkgs)}")
        else:
            diagnostics.append(f"  Lib/: 空（首次启动时自动安装依赖）")
    else:
        diagnostics.append(f"  Lib/: 不存在（首次启动时自动创建并安装依赖）")

    # 4. 检查 Lib_bundle/（离线包）
    bundle_dir = python_dir / "Lib_bundle"
    if bundle_dir.is_dir():
        whl_count = len(list(bundle_dir.glob("*.whl")))
        diagnostics.append(f"  Lib_bundle/: {whl_count} 个离线包")
    else:
        diagnostics.append(f"  Lib_bundle/: 不存在（依赖将通过联网安装）")

    logger.info("UE 插件 Python 依赖诊断:")
    for line in diagnostics:
        logger.info(line)

    if not status_ok:
        logger.warning("UE 插件 Python 脚本不完整，首次启动将无法正常工作！")
    else:
        logger.info(
            "诊断通过。首次启动 UE 时，init_unreal.py 会自动检测并安装缺失的 Python 依赖 "
            "(websockets, pydantic, cryptography, PyYAML)。"
            "需要联网。如果 UE Python 找不到 pip，会自动通过 ensurepip 引导。"
        )


def install_ue_plugin(ue_version: str, project_path: str = "", force: bool = False) -> Dict:
    """安装 UE 插件到指定项目目录。

    根据 UE 版本号自动匹配插件源目录，复制到项目 Plugins/ 下。

    Args:
        ue_version: UE 版本号，如 "5.7" 或 "5.7.4"（patch 忽略）
        project_path: UE 项目根目录（包含 .uproject 的目录）
        force: 是否覆盖已有安装

    Returns:
        {"success": bool, "source_dir": str, "target": str, "error": str|None}
    """
    # 1. 检查项目路径
    if not project_path or not project_path.strip():
        return {
            "success": False,
            "source_dir": "",
            "target": "",
            "error": "请指定 UE 项目根目录（包含 .uproject 的目录）",
        }

    project_root = Path(project_path.strip())
    if not project_root.is_dir():
        return {
            "success": False,
            "source_dir": "",
            "target": str(project_root),
            "error": f"项目目录不存在: {project_root}",
        }

    # 验证 .uproject 存在
    uproject_files = list(project_root.glob("*.uproject"))
    if not uproject_files:
        return {
            "success": False,
            "source_dir": "",
            "target": str(project_root),
            "error": f"目录中未找到 .uproject 文件: {project_root}",
        }

    # 2. 查找插件源目录
    try:
        src_dir = _get_ue_plugin_src_dir(ue_version)
    except (ValueError, FileNotFoundError) as e:
        return {
            "success": False,
            "source_dir": "",
            "target": str(project_root),
            "error": str(e),
        }

    # 3. 目标路径
    target_dir = project_root / "Plugins" / "ArtifexNexusForUnreal"

    # 4. 重装检查
    if target_dir.exists() and not force:
        # 保留 Lib/ 目录
        return {
            "success": False,
            "source_dir": str(src_dir),
            "target": str(target_dir),
            "error": (
                "目标已存在，如需重装请使用 force=True。"
                "注意：重装时会保留 Content/Python/Lib/ 目录。"
            ),
        }

    # 5. 执行安装
    try:
        _install_ue_plugin_files(src_dir, target_dir)

        # 记录部署清单
        source_version = _get_source_version(src_dir)
        deployment_id = f"ue-plugin-{ue_version}"
        try:
            _record_deployment(deployment_id, str(src_dir), str(target_dir), source_version)
        except Exception as e:
            logger.warning("UE 部署清单记录失败（不阻断安装）: %s", e)

        # 注册工具源码目录
        tools_src = str(src_dir / "Content" / "Python")
        _try_register_tool_source(tools_src)

        # 确保 MCP Bridge 配置中包含 unreal-editor server 条目
        # （bootstrap 已默认创建，但安装/重装时显式确保，防止用户手动删除后缺失）
        try:
            set_dcc_port("unreal", UE_MCP_DEFAULT_PORT)
        except Exception as e:
            logger.warning("UE MCP Bridge 端口配置更新失败（不阻断安装）: %s", e)

        # 部署 Gateway MCP Bridge 插件文件到 OpenClaw extensions 目录
        # （确保 index.js / openclaw.plugin.json 为最新版本）
        try:
            install_gateway_mcp_bridge()
        except Exception as e:
            logger.warning("Gateway MCP Bridge 插件部署失败（不阻断安装）: %s", e)

        # 安装后诊断：检查 Python 运行时依赖就绪状态
        _diagnose_ue_python_readiness(target_dir)

        return {
            "success": True,
            "source_dir": str(src_dir),
            "target": str(target_dir),
            "error": None,
        }
    except Exception as e:
        logger.exception("UE 插件安装失败")
        return {
            "success": False,
            "source_dir": str(src_dir),
            "target": str(target_dir),
            "error": f"安装失败: {e}",
        }


def _install_ue_plugin_files(src_dir: Path, target_dir: Path) -> None:
    """将 UE 插件文件从源目录复制到目标目录。

    排除规则：
      - Binaries/ Intermediate/ Saved/ — 编译产物
      - Content/Python/__pycache__/ — Python 缓存
      - Content/Python/tests/ — 测试代码
    保留规则：
      - Content/Python/Lib/ — 已安装的 pip 依赖（如果存在）
    """
    import shutil

    # 保存旧 Lib/ 目录
    old_lib = target_dir / "Content" / "Python" / "Lib"
    saved_lib = None
    if old_lib.is_dir():
        import tempfile
        saved_lib = Path(tempfile.mkdtemp(prefix="ue_lib_backup_"))
        shutil.copytree(old_lib, saved_lib / "Lib")
        logger.info(f"DCC 安装器: 备份旧 Lib/ → {saved_lib}")

    # 清理并复制
    if target_dir.exists():
        shutil.rmtree(target_dir)

    _EXCLUDE_PATTERNS = [
        "Binaries", "Intermediate", "Saved",
        "__pycache__", "*.pyc", "tests",
    ]

    def _ignore(path, names):
        ignored = set()
        for name in names:
            for pat in _EXCLUDE_PATTERNS:
                if fnmatch.fnmatch(name, pat):
                    ignored.add(name)
                    break
        return ignored

    shutil.copytree(src_dir, target_dir, ignore=_ignore)

    # 恢复旧 Lib/（合并而非覆盖）
    if saved_lib:
        lib_src = saved_lib / "Lib"
        lib_dst = target_dir / "Content" / "Python" / "Lib"
        lib_dst.mkdir(parents=True, exist_ok=True)
        for item in lib_src.iterdir():
            item_dst = lib_dst / item.name
            if not item_dst.exists():
                if item.is_dir():
                    shutil.copytree(item, item_dst)
                else:
                    shutil.copy2(item, item_dst)
        shutil.rmtree(saved_lib)
        logger.info("DCC 安装器: Lib/ 已合并恢复")


def uninstall_ue_plugin(ue_version: str, project_path: str = "", keep_lib: bool = False) -> Dict:
    """卸载 UE 插件。

    Args:
        ue_version: UE 版本号（用于部署清单清理）
        project_path: UE 项目根目录
        keep_lib: True=重装场景，保留 Content/Python/Lib/；False=UI 删除，完全移除

    Returns:
        {"success": bool, "target": str, "error": str|None, "message": str|None}
    """
    if not project_path:
        return {
            "success": False,
            "target": "",
            "error": "请指定 UE 项目根目录",
        }

    target_dir = Path(project_path.strip()) / "Plugins" / "ArtifexNexusForUnreal"
    if not target_dir.exists():
        return {
            "success": True,
            "target": str(target_dir),
            "error": None,
            "message": "插件未安装，无需卸载",
        }

    try:
        import shutil

        if keep_lib:
            # 重装场景：删除除 Lib/ 外的所有内容
            for item in target_dir.iterdir():
                if item.name == "Content":
                    # Content/ 下只保留 Python/Lib/，删除其他
                    content_dir = item
                    for content_item in content_dir.iterdir():
                        if content_item.name == "Python":
                            python_dir = content_item
                            for py_item in python_dir.iterdir():
                                if py_item.name == "Lib":
                                    logger.info("DCC 安装器: 卸载时保留 %s", py_item)
                                    continue
                                if py_item.is_dir():
                                    shutil.rmtree(py_item)
                                else:
                                    py_item.unlink()
                        elif content_item.is_dir():
                            shutil.rmtree(content_item)
                        else:
                            content_item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
            logger.info("DCC 安装器: UE 插件文件已清理（Lib/ 已保留）")
        else:
            # UI 删除：完全移除
            shutil.rmtree(target_dir)
            # 清理部署清单
            deployment_id = f"ue-plugin-{ue_version}"
            try:
                _remove_from_manifest(deployment_id)
            except Exception as e:
                logger.warning("UE 部署清单清理失败（不阻断卸载）: %s", e)
            logger.info("DCC 安装器: UE 插件已完全移除")

        return {
            "success": True,
            "target": str(target_dir),
            "error": None,
            "message": "Lib/ 已保留" if keep_lib else "已完全卸载",
        }
    except Exception as e:
        return {
            "success": False,
            "target": str(target_dir),
            "error": str(e),
        }


# ── 插件信息 ────────────────────────────────────────────────────────────

def get_addon_info() -> Dict:
    """
    读取插件的 bl_info 元信息。

    Returns:
        {
            "name": str,
            "version": (major, minor, patch),
            "blender_min": (major, minor, patch),  # 最低兼容 Blender 版本
            "source_dir": str,
        }
    """
    src_dir = _get_addon_src_dir("blender")
    # _get_addon_src_dir 已返回 addon 子目录（含 blender_addon），
    # 此处直接取 __init__.py，避免双重拼接
    init_file = src_dir / "__init__.py"

    if not init_file.exists():
        raise FileNotFoundError(
            f"Blender 插件 __init__.py 不存在: {init_file}。"
            f"请检查插件源目录结构是否完整。"
        )

    # 解析 bl_info（简单 AST 解析，不执行代码）
    content = init_file.read_text(encoding="utf-8")
    info = _parse_bl_info(content)
    info["source_dir"] = str(src_dir)
    return info


def _parse_bl_info(content: str) -> Dict:
    """从 Python 源码中解析 bl_info 字典（简单 AST）"""
    import ast

    tree = ast.parse(content)
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "bl_info":
                    info = ast.literal_eval(node.value)
                    return {
                        "name": info.get("name", "Artifex Nexus Bridge"),
                        "version": info.get("version", (0, 50, 0)),
                        "blender_min": info.get("blender", (5, 0, 0)),
                        "blender_max": info.get("blender_max", None),
                    }
    raise ValueError(
        "无法从 Blender 插件 __init__.py 中解析 bl_info 字典。"
        "请确认 bl_info = {...} 是否存在且格式正确。"
    )


def check_version_compatibility(blender_version: str) -> Tuple[bool, str]:
    """
    检查 Blender 版本是否与插件兼容。

    兼容规则：blender_min <= blender_version <= blender_max（如果设置了 blender_max）

    Args:
        blender_version: Blender 版本号，如 "5.1"

    Returns:
        (compatible, reason)
    """
    info = get_addon_info()
    blender_min = info["blender_min"]
    blender_max = info.get("blender_max")

    try:
        bv_parts = tuple(int(x) for x in blender_version.split("."))
    except (ValueError, AttributeError):
        return False, f"无法解析 Blender 版本号: {blender_version}"

    # 补齐到 3 位
    while len(bv_parts) < 3:
        bv_parts = bv_parts + (0,)

    min_str = ".".join(str(x) for x in blender_min)

    if bv_parts < blender_min:
        return False, f"Blender {blender_version} 低于最低要求 {min_str}"

    if blender_max is not None and bv_parts > blender_max:
        max_str = ".".join(str(x) for x in blender_max)
        return False, f"Blender {blender_version} 高于最高支持 {max_str}"

    if blender_max is not None:
        max_str = ".".join(str(x) for x in blender_max)
        return True, f"兼容 ({min_str} ~ {max_str})"
    else:
        return True, f"兼容 (≥ {min_str})"


def get_ue_plugin_info(ue_version: str = "") -> Dict:
    """获取 UE 插件版本元信息。

    Args:
        ue_version: 可选，指定版本号以获取对应目录路径

    Returns:
        {
            "name": str,
            "version": (major, minor, patch),
            "ue_min": (major, minor, patch),
            "ue_max": (major, minor, patch),
            "source_dir": str,   # 如果指定了 ue_version
        }
    """
    result = dict(_UE_PLUGIN_DEFAULTS)
    if ue_version:
        try:
            result["source_dir"] = str(_get_ue_plugin_src_dir(ue_version))
        except (ValueError, FileNotFoundError):
            pass
    return result


def check_ue_version_compatibility(ue_version: str) -> Tuple[bool, str]:
    """
    检查 UE 引擎版本是否与插件兼容。

    兼容规则：ue_min <= ue_version <= ue_max
    同时检查是否存在匹配的插件源目录。

    Args:
        ue_version: UE 版本号，如 "5.7" 或 "5.7.4"

    Returns:
        (compatible, reason)
    """
    info = get_ue_plugin_info()
    ue_min = info["ue_min"]
    ue_max = info.get("ue_max")

    try:
        uv_parts = tuple(int(x) for x in ue_version.split("."))
    except (ValueError, AttributeError):
        return False, f"无法解析 UE 版本号: {ue_version}"

    # 补齐到 3 位
    while len(uv_parts) < 3:
        uv_parts = uv_parts + (0,)

    min_str = ".".join(str(x) for x in ue_min)

    if uv_parts < ue_min:
        return False, f"UE {ue_version} 低于最低要求 {min_str}"

    if ue_max is not None and uv_parts > ue_max:
        max_str = ".".join(str(x) for x in ue_max)
        return False, f"UE {ue_version} 高于最高支持 {max_str}"

    # 检查是否有匹配的插件源目录
    try:
        _get_ue_plugin_src_dir(ue_version)
    except FileNotFoundError:
        return False, (
            f"UE {ue_version} 版本兼容，但未找到对应的插件目录。"
            f"支持的版本: {find_ue_versions()}"
        )
    except ValueError:
        pass  # 版本号解析失败，前面已经验证过了

    if ue_max is not None:
        max_str = ".".join(str(x) for x in ue_max)
        return True, f"兼容 ({min_str} ~ {max_str})"
    else:
        return True, f"兼容 (≥ {min_str})"


# ── 插件兼容范围用户覆盖配置 ──────────────────────────────────────────

_PLUGIN_COMPAT_CONFIG_PATH = os.path.join(
    os.path.expandvars(r"%USERPROFILE%\.artifexnexus\config"),
    "plugin_compat.json",
)


def _load_plugin_compat_overrides() -> dict:
    """读取用户自定义插件兼容范围覆盖。"""
    try:
        if os.path.isfile(_PLUGIN_COMPAT_CONFIG_PATH):
            with open(_PLUGIN_COMPAT_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {"overrides": {}}


def _save_plugin_compat_overrides(data: dict) -> None:
    """保存用户自定义插件兼容范围覆盖。"""
    os.makedirs(os.path.dirname(_PLUGIN_COMPAT_CONFIG_PATH), exist_ok=True)
    with open(_PLUGIN_COMPAT_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_all_plugins_with_compat() -> List[Dict]:
    """获取所有 DCC 的所有插件版本及其兼容范围（合并用户覆盖）。

    Returns:
        [{dcc, dcc_name, version, dcc_min, dcc_max, path, overridden}, ...]
    """
    overrides = _load_plugin_compat_overrides().get("overrides", {})
    all_plugins = []
    DCC_LIST = ["blender", "maya", "3ds_max", "unreal_engine"]
    DCC_DISPLAY = {"blender": "Blender", "maya": "Maya", "3ds_max": "3ds Max", "unreal_engine": "Unreal Engine"}

    for dcc in DCC_LIST:
        builtin = get_available_plugin_versions(dcc)
        for v in builtin:
            override_key = f"{dcc}/{v['version']}"
            override = overrides.get(override_key, {})
            all_plugins.append({
                "dcc": dcc,
                "dcc_name": DCC_DISPLAY.get(dcc, dcc),
                "version": v["version"],
                "dcc_min": override.get("dcc_min", v["dcc_min"]),
                "dcc_max": override.get("dcc_max", v.get("dcc_max")),
                "path": v["path"],
                "overridden": bool(override),
                "builtin_dcc_min": v["dcc_min"],
                "builtin_dcc_max": v.get("dcc_max"),
            })
    return all_plugins


def update_plugin_compatibility(dcc: str, version: str, dcc_min: str, dcc_max: Optional[str]) -> dict:
    """更新指定插件的兼容范围覆盖。

    Args:
        dcc: "blender" | "maya" | "3ds_max"
        version: 插件版本号（如 "2023", "5.0.0"）
        dcc_min: 新的最低兼容 DCC 版本
        dcc_max: 新的最高兼容 DCC 版本（None 表示严格匹配 dcc_min）

    Returns:
        {"ok": bool, "message": str}
    """
    override_key = f"{dcc}/{version}"
    data = _load_plugin_compat_overrides()
    overrides = data.setdefault("overrides", {})

    if dcc_max is None or dcc_max.strip() == "":
        overrides[override_key] = {"dcc_min": dcc_min, "dcc_max": None}
    else:
        overrides[override_key] = {"dcc_min": dcc_min, "dcc_max": dcc_max}

    _save_plugin_compat_overrides(data)
    return {"ok": True, "message": f"已更新 {override_key} 兼容范围: {dcc_min}~{dcc_max or '仅'}"}


def reset_plugin_compatibility(dcc: str, version: str) -> dict:
    """重置指定插件的兼容范围为内置默认值。

    Returns:
        {"ok": bool, "message": str}
    """
    override_key = f"{dcc}/{version}"
    data = _load_plugin_compat_overrides()
    overrides = data.get("overrides", {})
    if override_key in overrides:
        del overrides[override_key]
        _save_plugin_compat_overrides(data)
        return {"ok": True, "message": f"已重置 {override_key} 为内置默认值"}
    return {"ok": True, "message": f"{override_key} 无覆盖，无需重置"}


# ── 通用 DCC plugin_info 解析（Maya / 3ds Max）───────────────────────────

def _parse_plugin_info(content: str, dcc: str) -> Dict:
    """从 Python 源码中解析 plugin_info / bl_info 字典（简单 AST）。

    Maya:   plugin_info = {"name": "...", "version": (2023,), "maya_min": ..., "maya_max": None}
    Max:    plugin_info = {"name": "...", "version": (2023,), "max_min": (2023,), "max_max": None}
    Blender: bl_info = {"name": "...", "version": (5,0,0), "blender": (5,0,0), "blender_max": (5,1,9)}
    """
    import ast

    tree = ast.parse(content)
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                # 匹配 plugin_info = {...} 或 bl_info = {...}
                if isinstance(target, ast.Name) and target.id in ("plugin_info", "bl_info"):
                    info: dict = ast.literal_eval(node.value)
                    version = info.get("version", (0, 0, 0))

                    if dcc == "blender":
                        dcc_min = info.get("blender", version)
                        dcc_max = info.get("blender_max")
                    elif dcc == "maya":
                        dcc_min = info.get("maya_min", version)
                        dcc_max = info.get("maya_max")
                    elif dcc == "unreal_engine":
                        dcc_min = info.get("ue_min", version)
                        dcc_max = info.get("ue_max")
                    else:
                        dcc_min = info.get("max_min", version)
                        dcc_max = info.get("max_max")

                    return {
                        "name": info.get("name", "Artifex Nexus Bridge"),
                        "version": version,
                        "dcc_min": dcc_min,
                        "dcc_max": dcc_max,
                    }
    raise ValueError(
        f"无法从 {dcc.upper()} 插件 __init__.py 中解析 plugin_info/bl_info。"
        f"请确认 plugin_info = {{...}} 或 bl_info = {{...}} 是否存在且格式正确。"
    )


def get_dcc_plugin_info(dcc: str) -> Dict:
    """读取 DCC 插件的 plugin_info / bl_info 元信息。

    Args:
        dcc: "blender" | "maya" | "3ds_max" | "unreal_engine"

    Returns:
        {"name": str, "version": tuple, "dcc_min": tuple, "dcc_max": tuple|None}
    """
    # ── UE 特殊分支 ─────────────────────────────────────────────
    if dcc == "unreal_engine":
        versions = get_available_plugin_versions("unreal_engine")
        if not versions:
            raise FileNotFoundError("未找到任何 UE 插件版本目录")
        # 返回最新版本
        latest = versions[0]
        return {
            "name": "Artifex Nexus for Unreal",
            "version": tuple(int(x) for x in latest["version"].split(".")),
            "dcc_min": tuple(int(x) for x in latest["dcc_min"].split(".")),
            "dcc_max": None,
        }

    src_dir = _get_addon_src_dir(dcc)
    # _get_addon_src_dir 已返回 addon 子目录（如 v2023/maya_addon），
    # 此处直接取 __init__.py，避免双重拼接
    init_file = src_dir / "__init__.py"

    if not init_file.exists():
        raise FileNotFoundError(
            f"{dcc.upper()} 插件 __init__.py 不存在: {init_file}。"
            f"请检查插件源目录结构是否完整。"
        )

    content = init_file.read_text(encoding="utf-8")
    return _parse_plugin_info(content, dcc)


def _get_plugin_version_from_info(info: dict) -> str:
    """从 plugin_info 字典提取版本号字符串（如 (2023,) -> "2023", (5,0,0) -> "5.0.0"）"""
    ver = info.get("version", (0,))
    return ".".join(str(x) for x in ver)


def get_available_plugin_versions(dcc: str) -> List[Dict]:
    """获取 DCC 所有可用插件版本及其兼容范围。

    Blender / Maya / Max: 扫描 packages/dcc/{dcc}/src/artifex_nexus/v*/ 目录，
    读取每个版本 __init__.py 中的 plugin_info。

    UE: 扫描 packages/dcc/unreal/ArtifexNexusForUnreal_*/ 目录，
    解析每个版本的 .uplugin JSON。

    Returns:
        [{"version": "2023", "dcc_min": "2023", "dcc_max": None, "path": str}, ...]
        按 version 降序排列。
    """
    # ── UE 特殊分支 ─────────────────────────────────────────────
    if dcc == "unreal_engine":
        versions = []
        try:
            base = _resolve_ue_src_base()
            if base.is_dir():
                for entry in sorted(base.iterdir(), reverse=True):
                    if not entry.is_dir() or not entry.name.startswith(_UE_PLUGIN_DIR_PREFIX):
                        continue
                    uplugin_file = entry / f"{_UE_PLUGIN_DIR_PREFIX.rstrip('_')}.uplugin"
                    if not uplugin_file.exists():
                        continue
                    try:
                        suffix = entry.name[len(_UE_PLUGIN_DIR_PREFIX):]
                        ver_name = _reverse_ue_version_suffix(suffix)
                        info = _parse_ue_plugin_descriptor(uplugin_file)
                        versions.append({
                            "version": ver_name,
                            "dcc_min": ".".join(str(x) for x in info["dcc_min"]),
                            "dcc_max": None,
                            "path": str(entry),
                        })
                    except Exception:
                        continue
        except Exception:
            pass
        return versions

    _DCC_PKG_DIR = {
        "blender": "blender",
        "maya": "maya",
        "3ds_max": "max",
    }
    dcc_pkg_dir = _DCC_PKG_DIR.get(dcc, dcc)
    _ADDON_DIR_NAMES = {
        "blender": "blender_addon",
        "maya": "maya_addon",
        "3ds_max": "max_addon",
    }
    addon_dir_name = _ADDON_DIR_NAMES.get(dcc, f"{dcc}_addon")

    # 按优先级查找 base 目录
    env_root = os.environ.get("ARTIFEX_NEXUS_PROJECT_ROOT")
    if env_root:
        base = Path(env_root) / "packages" / "dcc" / dcc_pkg_dir / "src" / "artifex_nexus"
    else:
        _here = Path(__file__).resolve().parent
        base = (_here / ".." / ".." / ".." / ".." / "dcc" / dcc_pkg_dir / "src" / "artifex_nexus").resolve()

    if not base.exists():
        return []

    versions = []
    for entry in sorted(base.iterdir(), reverse=True):
        if entry.is_dir() and entry.name.startswith("v"):
            addon_dir = entry / addon_dir_name
            if not addon_dir.exists():
                continue
            init_file = addon_dir / "__init__.py"
            if not init_file.exists():
                continue
            try:
                ver_name = entry.name[1:]  # strip "v" prefix
                info = _parse_plugin_info(init_file.read_text(encoding="utf-8"), dcc)
                versions.append({
                    "version": ver_name,
                    "dcc_min": ".".join(str(x) for x in info["dcc_min"]),
                    "dcc_max": ".".join(str(x) for x in info["dcc_max"]) if info["dcc_max"] else None,
                    "path": str(addon_dir),
                })
            except Exception:
                continue

    # 合并用户覆盖
    overrides = _load_plugin_compat_overrides().get("overrides", {})
    for v in versions:
        override_key = f"{dcc}/{v['version']}"
        if override_key in overrides:
            ov = overrides[override_key]
            v["dcc_min"] = ov["dcc_min"]
            v["dcc_max"] = ov.get("dcc_max")

    return versions


def find_best_plugin_for_dcc(dcc: str, dcc_version: str) -> Optional[Dict]:
    """为指定 DCC 版本查找最佳匹配的插件版本。

    优先精确匹配，其次兼容范围匹配，返回最佳结果。
    无匹配时返回 None。

    Returns:
        {version, dcc_min, dcc_max, path} 或 None
    """
    available = get_available_plugin_versions(dcc)
    if not available:
        return None

    try:
        dv_parts = tuple(int(x) for x in dcc_version.split("."))
    except ValueError:
        return None
    while len(dv_parts) < 2:
        dv_parts = dv_parts + (0,)

    # 1. 精确匹配
    for v in available:
        try:
            vp = tuple(int(x) for x in v["version"].split("."))
            if len(vp) >= 2 and vp[:2] == dv_parts[:2]:
                return v
        except ValueError:
            continue

    # 2. 兼容范围匹配（dcc_min <= version <= dcc_max）
    for v in available:
        try:
            dcc_min = tuple(int(x) for x in v["dcc_min"].split("."))
            if dv_parts >= dcc_min:
                if v["dcc_max"] is None:
                    return v
                dcc_max = tuple(int(x) for x in v["dcc_max"].split("."))
                if dv_parts <= dcc_max:
                    return v
        except (ValueError, KeyError):
            continue

    return None


def check_dcc_version_compatibility(dcc: str, dcc_version: str) -> Tuple[bool, str]:
    """检查 DCC 版本是否与插件兼容（通用，用于 Blender / Maya / 3ds Max）。

    兼容规则：dcc_min <= dcc_version <= dcc_max（dcc_max=None 则严格匹配 dcc_min）
    用户可通过 plugin_compat.json 覆盖兼容范围。

    Args:
        dcc: DCC 标识 "blender" | "maya" | "3ds_max"
        dcc_version: 版本号，如 "2023" 或 "5.1"

    Returns:
        (compatible, reason)
    """
    info = get_dcc_plugin_info(dcc)
    dcc_min = info["dcc_min"]
    dcc_max = info.get("dcc_max")

    # 合并用户覆盖
    overrides = _load_plugin_compat_overrides().get("overrides", {})
    override_key = f"{dcc}/{_get_plugin_version_from_info(info)}"
    if override_key in overrides:
        ov = overrides[override_key]
        dcc_min = tuple(int(x) for x in ov["dcc_min"].split("."))
        dcc_max_raw = ov.get("dcc_max")
        dcc_max = tuple(int(x) for x in dcc_max_raw.split(".")) if dcc_max_raw else None

    try:
        dv_parts = tuple(int(x) for x in dcc_version.split("."))
    except (ValueError, AttributeError):
        return False, f"无法解析版本号: {dcc_version}"

    # 补齐到 3 位
    while len(dv_parts) < 3:
        dv_parts = dv_parts + (0,)

    min_str = ".".join(str(x) for x in dcc_min)

    if dv_parts < dcc_min:
        return False, f"版本 {dcc_version} 低于最低要求 {min_str}"

    if dcc_max is not None:
        if dv_parts > dcc_max:
            max_str = ".".join(str(x) for x in dcc_max)
            return False, f"版本 {dcc_version} 高于最高支持 {max_str}"
        max_str = ".".join(str(x) for x in dcc_max)
        return True, f"兼容 ({min_str} ~ {max_str})"

    # dcc_max=None：严格匹配 dcc_min 指定版本（不视为"无上限"）
    if dv_parts != dcc_min:
        return False, f"插件 v{'.'.join(str(x) for x in dcc_min)} 仅兼容 {dcc_version}，当前 DCC 版本为 {dcc_version}"

    return True, f"兼容 (v{min_str})"


# ── Junction / Symlink 工具 ─────────────────────────────────────────────

def _is_junction_or_symlink(path: str) -> bool:
    """检查路径是否为 junction 或 symlink"""
    p = Path(path)
    if p.is_symlink():
        return True
    # Windows junction: reparse point
    if platform.system() == "Windows" and p.exists():
        try:
            import ctypes
            FILE_ATTRIBUTE_REPARSE_POINT = 0x0400
            attrs = ctypes.windll.kernel32.GetFileAttributesW(str(p))
            if attrs != -1 and (attrs & FILE_ATTRIBUTE_REPARSE_POINT):
                return True
        except Exception:
            pass
    return False


def _remove_link_or_dir(path: str) -> None:
    """安全移除 junction/symlink 或普通目录"""
    if _is_junction_or_symlink(path):
        p = Path(path)
        if p.is_dir():
            os.rmdir(path)
        else:
            os.remove(path)
    elif os.path.isdir(path):
        shutil.rmtree(path)
    elif os.path.isfile(path):
        os.remove(path)


# ── 部署清单（Deploy Manifest）管理 ────────────────────────────────────────
#
# 每次安装时生成 deploy-manifest.json，记录每个部署项的文件校验和与版本。
# 全局检测时对比 manifest 与磁盘文件，返回 ok / outdated / missing / corrupted。
#
# Schema 见 docs/inbox/context-handoff-copy-model-and-validation.md §3.2


def _compute_file_sha256(filepath: Path) -> str:
    """计算单个文件的 SHA-256 哈希（hex 字符串）。

    Compute SHA-256 hash of a single file.
    """
    sha = hashlib.sha256()
    with open(filepath, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            sha.update(chunk)
    return sha.hexdigest()


def _scan_dir_files(src_dir: Path) -> List[dict]:
    """扫描目录下所有文件的相对路径、sha256、大小。

    Scan all files under src_dir and return list of {path, sha256, size}.
    排除 `__pycache__/`、`*.pyc`、`.DS_Store` 等生成文件。
    """
    files = []
    for entry in sorted(src_dir.rglob("*")):
        if not entry.is_file():
            continue
        # 检查是否命中排除模式
        rel = entry.relative_to(src_dir).as_posix()
        if _is_ignored_path(rel):
            continue
        files.append({
            "path": rel,
            "sha256": _compute_file_sha256(entry),
            "size": entry.stat().st_size,
        })
    return files


def _is_ignored_path(rel_path: str) -> bool:
    """判断相对路径是否命中排除模式。

    Check if a relative path matches any ignore pattern.
    """
    for pattern in _SCAN_IGNORE_PATTERNS:
        # 匹配完整路径或路径的任意组成部分
        parts = rel_path.replace("\\", "/").split("/")
        for part in parts:
            if fnmatch.fnmatch(part, pattern.rstrip("/")):
                return True
        if fnmatch.fnmatch(rel_path, pattern):
            return True
    return False


def _get_ignore_patterns_for_shutil():
    """返回 shutil.copytree 的 ignore 函数。

    Returns a callable suitable for shutil.copytree(ignore=...).
    """
    def _ignore(directory: str, files: list) -> set:
        ignored = set()
        for f in files:
            if _is_ignored_path(f):
                ignored.add(f)
        return ignored

    return _ignore


def _read_deploy_manifest() -> dict:
    """读取部署清单文件，不存在则返回空结构。

    Read deploy-manifest.json, return empty structure if missing.
    """
    manifest_path = _get_manifest_path()
    if not manifest_path.exists():
        return {"version": _MANIFEST_VERSION, "deployments": []}
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"部署清单损坏，重建空清单: {e}")
        return {"version": _MANIFEST_VERSION, "deployments": []}


def _write_deploy_manifest(manifest: dict) -> None:
    """原子写入部署清单文件。

    Write deploy-manifest.json atomically (tmp + rename).
    """
    manifest_path = _get_manifest_path()
    os.makedirs(manifest_path.parent, exist_ok=True)

    tmp_path = manifest_path.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, manifest_path)


def _record_deployment(
    deployment_id: str,
    source: str,
    target: str,
    source_version: str,
    *,
    scan_dir: Optional[str] = None,
) -> None:
    """安装后记录部署项到 manifest。

    Record a deployment entry in deploy-manifest.json after install.

    scan_dir 用于指定文件扫描目录。默认为 source（源码路径），但
    gateway-mcp-bridge 等只拷贝部分文件的场景应设为 target（目标路径），
    避免 manifest 记录源码目录中未拷贝到目标的 toolchain 文件（如
    node_modules、src、dist 等）。"""
    scan_path = Path(scan_dir) if scan_dir else Path(source)
    files = _scan_dir_files(scan_path)

    manifest = _read_deploy_manifest()

    # 移除同 id 的旧记录
    manifest["deployments"] = [
        d for d in manifest.get("deployments", [])
        if d.get("id") != deployment_id
    ]

    entry = {
        "id": deployment_id,
        "source": str(Path(source).resolve()),
        "target": str(Path(target).resolve()),
        "method": "copy",
        "files": files,
        "deployedAt": datetime.now(timezone.utc).isoformat(),
        "sourceVersion": source_version,
    }
    manifest["deployments"].append(entry)
    _write_deploy_manifest(manifest)
    logger.info(
        f"部署清单已更新: {deployment_id} → {target} "
        f"({len(files)} 个文件, v{source_version})"
    )


def _remove_from_manifest(deployment_id: str) -> None:
    """卸载后从 manifest 移除部署项。

    Remove a deployment entry from manifest after uninstall.
    """
    manifest = _read_deploy_manifest()
    before = len(manifest.get("deployments", []))
    manifest["deployments"] = [
        d for d in manifest.get("deployments", [])
        if d.get("id") != deployment_id
    ]
    if len(manifest["deployments"]) < before:
        _write_deploy_manifest(manifest)
        logger.info(f"部署清单已移除: {deployment_id}")


def _get_source_version(source_dir: Path) -> str:
    """从源码目录获取版本号。

    优先级：
    1. Blender addon: 解析 __init__.py 中的 bl_info.version
    2. Gateway plugin: 解析 package.json 中的 version
    3. 兜底: "0.0.0"

    Get version string from source directory.
    """
    # 尝试 Blender addon bl_info
    init_py = source_dir / "__init__.py"
    if init_py.exists():
        try:
            info = _parse_bl_info(init_py.read_text(encoding="utf-8"))
            v = info.get("version")
            if isinstance(v, (tuple, list)) and len(v) >= 2:
                return ".".join(str(x) for x in v)
        except Exception:
            pass

    # 尝试 package.json
    pkg_json = source_dir / "package.json"
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
            if "version" in pkg:
                return str(pkg["version"])
        except Exception:
            pass

    return "0.0.0"


def validate_all_deployments() -> List[dict]:
    """全局校验所有部署项。

    遍历 manifest 中每个 deployment，对比 target 文件的 sha256 与 manifest。
    返回每个部署项的校验结果列表。

    Validate all deployments against deploy-manifest.json.
    Returns list of {id, status: "ok"|"outdated"|"missing"|"corrupted", ...}.

    校验规则：
      - 目录不存在 → missing
      - 文件缺失或 sha256 不匹配 → corrupted
      - sourceVersion 与当前源码版本不一致 → outdated
      - 全部匹配 → ok
    """
    manifest = _read_deploy_manifest()
    results: List[dict] = []
    stale_ids: List[str] = []  # 目标目录已不存在的过期部署项

    for dep in manifest.get("deployments", []):
        dep_id = dep.get("id", "unknown")
        target_dir = Path(dep.get("target", ""))
        expected_files = dep.get("files", [])

        # 检查目标目录是否存在
        if not target_dir.exists():
            # 静默清理：过期部署项不生成 missing 结果，直接从 manifest 移除
            stale_ids.append(dep_id)
            logger.info(f"清理过期部署项: {dep_id} ({target_dir} 不存在)")
            continue

        # 逐文件校验
        mismatched: List[str] = []
        missing_files: List[str] = []
        for f_info in expected_files:
            f_path = target_dir / f_info["path"]
            if not f_path.exists():
                missing_files.append(f_info["path"])
                continue
            actual_sha = _compute_file_sha256(f_path)
            if actual_sha != f_info["sha256"]:
                mismatched.append(f_info["path"])

        if missing_files:
            results.append({
                "id": dep_id,
                "status": "corrupted",
                "target": str(target_dir),
                "sourceVersion": dep.get("sourceVersion"),
                "deployedAt": dep.get("deployedAt"),
                "details": f"缺失 {len(missing_files)} 个文件: {', '.join(missing_files[:5])}",
                "missing_files": missing_files,
            })
            continue

        if mismatched:
            results.append({
                "id": dep_id,
                "status": "corrupted",
                "target": str(target_dir),
                "sourceVersion": dep.get("sourceVersion"),
                "deployedAt": dep.get("deployedAt"),
                "details": f"{len(mismatched)} 个文件校验和不匹配: {', '.join(mismatched[:5])}",
                "corrupted_files": mismatched,
            })
            continue

        # 检查版本是否过时
        source_path = dep.get("source", "")
        if source_path and Path(source_path).exists():
            current_version = _get_source_version(Path(source_path))
            deployed_version = dep.get("sourceVersion", "0.0.0")
            if current_version != deployed_version:
                results.append({
                    "id": dep_id,
                    "status": "outdated",
                    "target": str(target_dir),
                    "sourceVersion": deployed_version,
                    "currentVersion": current_version,
                    "deployedAt": dep.get("deployedAt"),
                    "details": f"已部署版本 {deployed_version}，当前源码版本 {current_version}",
                })
                continue

        results.append({
            "id": dep_id,
            "status": "ok",
            "target": str(target_dir),
            "sourceVersion": dep.get("sourceVersion"),
            "deployedAt": dep.get("deployedAt"),
            "details": f"全部 {len(expected_files)} 个文件校验通过",
        })

    # ── 静默清理过期条目 ──────────────────────────────────────
    if stale_ids:
        manifest["deployments"] = [
            d for d in manifest.get("deployments", [])
            if d.get("id") not in stale_ids
        ]
        _write_deploy_manifest(manifest)
        logger.info(f"已清理 {len(stale_ids)} 条过期部署记录: {', '.join(stale_ids)}")

    return results


def repair_deployment(dep_id: str) -> dict:
    """修复指定部署项（重新部署以同步 manifest 与磁盘文件）。

    Repair a single deployment entry — re-deploy to sync manifest with disk.
    当前支持: gateway-mcp-bridge（重新拷贝 + 以 target 目录重录 manifest）。
    """
    if dep_id == "gateway-mcp-bridge":
        return install_gateway_mcp_bridge()

    manifest = _read_deploy_manifest()
    dep = next((d for d in manifest.get("deployments", []) if d.get("id") == dep_id), None)
    if dep is None:
        return {"success": False, "error": f"未找到部署项: {dep_id}"}

    target_dir = Path(dep.get("target", ""))
    source_dir = Path(dep.get("source", ""))
    if not source_dir.exists():
        return {"success": False, "error": f"源目录不存在: {source_dir}"}

    method = dep.get("method", "copy")
    if method == "copy":
        try:
            # 清理目标后重新拷贝
            if target_dir.exists():
                if os.path.isdir(str(target_dir)):
                    shutil.rmtree(str(target_dir))
                else:
                    os.unlink(str(target_dir))
            shutil.copytree(str(source_dir), str(target_dir), ignore=_get_ignore_patterns_for_shutil())
        except Exception as e:
            return {"success": False, "error": f"复制失败: {e}"}
        _record_deployment(dep_id, str(source_dir), str(target_dir), _get_source_version(source_dir), scan_dir=str(target_dir))
        return {"success": True, "message": f"{dep_id} 已修复（{method}）", "target": str(target_dir)}

    return {"success": False, "error": f"不支持的部署方法: {method}"}


# ── Gateway MCP Bridge 插件部署 ──────────────────────────────────────────

def _get_gateway_plugin_src_dir() -> Path:
    """获取 Gateway 插件源码目录"""
    env_root = os.environ.get("ARTIFEX_NEXUS_PROJECT_ROOT")
    if env_root:
        base = Path(env_root) / "packages" / "adapters" / "openclaw" / "gateway-plugin"
        if base.exists():
            return base

    _here = Path(__file__).resolve().parent
    base = (_here / ".." / ".." / ".." / ".." / "adapters" / "openclaw" / "gateway-plugin").resolve()
    if base.exists():
        return base

    raise RuntimeError("无法定位 Gateway 插件源码目录")


def _get_openclaw_plugins_dir() -> Path:
    """获取 OpenClaw 内置 extensions 目录（OpenClaw 扫描此目录加载插件）"""
    openclaw_home = _get_openclaw_home_dir()
    # OpenClaw 内置插件在 cli/{version}/node_modules/openclaw/dist/extensions/
    # 需要找到当前使用的版本目录
    cli_dir = Path(openclaw_home) / "cli"
    if cli_dir.exists():
        for entry in sorted(cli_dir.iterdir(), reverse=True):
            if entry.is_dir() and entry.name.startswith("v"):
                bundled = entry / "node_modules" / "openclaw" / "dist" / "extensions"
                if bundled.exists():
                    return bundled
    # fallback
    return Path(openclaw_home) / "extensions"


# Gateway 实际需要的文件（只拷贝这两份，不整树拷贝）
_GATEWAY_MCP_BRIDGE_REQUIRED_FILES = ["index.js", "openclaw.plugin.json"]


def install_gateway_mcp_bridge() -> Dict:
    """
    部署 mcp-bridge 插件到 OpenClaw bundled extensions 目录 + patch 配置 + 刷注册表。

    Deploy mcp-bridge plugin to OpenClaw's bundled extensions directory,
    patch openclaw.json config, and refresh the plugin registry.

    安装步骤：
    1. 校验 index.js 已构建（A2：拷贝前检查）
    2. 只拷贝 Gateway 实际需要的文件：index.js + openclaw.plugin.json（A1：不用 copytree）
    3. 确保 openclaw.json 中 plugins.entries.mcp-bridge 已配置
    4. 确保 openclaw.json 中 plugins.allow 包含 "mcp-bridge"
    5. 执行 `openclaw plugins registry --refresh` 更新注册表缓存

    为什么不用 copytree：
      - Gateway 只加载 index.js + openclaw.plugin.json，拷贝 src/ / node_modules/ 无用
      - copytree 会把未重新编译的旧 index.js 也拷过去，掩盖过时问题
      - 物理拷贝（不用 junction/symlink）：OpenClaw discovery 会 realpath 解析，
        跨卷 junction 导致 rootDir 指向源码盘，被 trusted-root 安全检查拒绝

    Returns:
        {"success": bool, "method": str, "target": str, "error": str|None}
    """
    src_dir = str(_get_gateway_plugin_src_dir())
    plugins_dir = _get_openclaw_plugins_dir()
    target_dir = str(plugins_dir / "mcp-bridge")

    logger.info(f"部署 mcp-bridge 插件: {src_dir} → {target_dir}")

    if not os.path.isdir(src_dir):
        return {
            "success": False,
            "method": None,
            "target": target_dir,
            "error": f"插件源码目录不存在: {src_dir}",
        }

    # A2: 拷贝前校验 index.js 存在（防止部署未构建的插件）
    index_js_src = os.path.join(src_dir, "index.js")
    if not os.path.isfile(index_js_src):
        return {
            "success": False,
            "method": None,
            "target": target_dir,
            "error": "index.js 未构建，请先编译 gateway-plugin（如 `pnpm build`）",
        }

    # 确保 plugins 目录存在
    os.makedirs(str(plugins_dir), exist_ok=True)

    # 清理已有安装（junction/symlink/旧目录）
    if os.path.exists(target_dir) or _is_junction_or_symlink(target_dir):
        _remove_link_or_dir(target_dir)

    # A1: 只拷贝 Gateway 实际需要的文件（不用 copytree）
    os.makedirs(target_dir, exist_ok=True)
    try:
        for fname in _GATEWAY_MCP_BRIDGE_REQUIRED_FILES:
            src = os.path.join(src_dir, fname)
            tgt = os.path.join(target_dir, fname)
            if os.path.isfile(src):
                shutil.copy2(src, tgt)
                logger.debug(f"  已拷贝: {fname} ({os.path.getsize(tgt)} bytes)")
            else:
                logger.warning(f"  {fname} 不存在于源码目录，跳过")
        method = "copy"
    except Exception as e:
        return {
            "success": False,
            "method": None,
            "target": target_dir,
            "error": f"复制插件文件失败: {e}",
        }

    logger.info(f"mcp-bridge 插件部署成功 ({method}): {target_dir}")

    # 记录部署清单 —— scan_dir=target_dir 只记录实际拷贝到目标的文件
    # （不记录源码中的 node_modules / src / dist 等 toolchain 文件）
    source_version = _get_source_version(Path(src_dir))
    try:
        _record_deployment("gateway-mcp-bridge", src_dir, target_dir, source_version, scan_dir=target_dir)
    except Exception as e:
        logger.warning(f"部署清单记录失败（不阻断安装）: {e}")

    # Patch openclaw.json：确保 plugins.entries.mcp-bridge 和 plugins.allow 已配置
    _patch_openclaw_config_for_mcp_bridge()

    # 刷新注册表缓存：让 Gateway 下次启动时能正确发现 mcp-bridge
    _refresh_plugin_registry()

    return {
        "success": True,
        "method": method,
        "target": target_dir,
        "error": None,
    }


def _patch_openclaw_config_for_mcp_bridge() -> None:
    """Patch openclaw.json：添加 mcp-bridge 插件配置。

    幂等：如果配置已存在则跳过。
    """
    openclaw_home = _get_openclaw_home_dir()
    config_path = os.path.join(openclaw_home, "openclaw.json")

    if not os.path.exists(config_path):
        logger.warning(f"openclaw.json 不存在: {config_path}，跳过 mcp-bridge 配置 patch")
        return

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        logger.warning(f"读取 openclaw.json 失败: {e}")
        return

    changed = False

    # 确保 plugins 结构
    if "plugins" not in config:
        config["plugins"] = {}
        changed = True

    # 确保 plugins.allow 包含 "mcp-bridge"（仅当 allow 列表已存在时追加，
    # 避免凭空创建一个只含 mcp-bridge 的 allow 列表导致其他插件被排除）
    allow = config["plugins"].get("allow")
    if isinstance(allow, list) and "mcp-bridge" not in allow:
        allow.append("mcp-bridge")
        config["plugins"]["allow"] = allow
        changed = True
        logger.info("openclaw.json: plugins.allow 已添加 mcp-bridge")

    # 确保 plugins.entries.mcp-bridge 已配置
    entries = config["plugins"].get("entries", {})
    if "mcp-bridge" not in entries:
        entries["mcp-bridge"] = {
            "enabled": True,
            "config": {
                "servers": {
                    "blender-editor": {
                        "type": "websocket",
                        "url": "ws://127.0.0.1:18083",
                        "enabled": True,
                    }
                }
            },
        }
        config["plugins"]["entries"] = entries
        changed = True
        logger.info("openclaw.json: plugins.entries.mcp-bridge 已添加")

    if changed:
        try:
            # 原子写入：先写临时文件，再 rename
            tmp_path = config_path + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, config_path)
            logger.info(f"openclaw.json 已更新: {config_path}")
        except Exception as e:
            logger.error(f"写入 openclaw.json 失败: {e}")


def _refresh_plugin_registry() -> None:
    """执行 `openclaw plugins registry --refresh` 更新注册表缓存。

    Run `openclaw plugins registry --refresh` to update the installs.json
    cache so Gateway can discover newly deployed plugins on next start.

    Best-effort：失败不阻断安装流程。
    """
    openclaw_home = _get_openclaw_home_dir()
    # 查找 openclaw CLI
    cli_dir = Path(openclaw_home) / "cli"
    openclaw_bin = None
    if cli_dir.exists():
        for entry in sorted(cli_dir.iterdir(), reverse=True):
            if entry.is_dir() and entry.name.startswith("v"):
                candidate = entry / "openclaw.cmd"
                if candidate.exists():
                    openclaw_bin = str(candidate)
                    break

    if not openclaw_bin:
        logger.warning("未找到 openclaw CLI，跳过 registry refresh")
        return

    env = os.environ.copy()
    env["OPENCLAW_HOME"] = openclaw_home
    env["OPENCLAW_STATE_DIR"] = str(Path(openclaw_home) / "state")
    env["OPENCLAW_CONFIG_PATH"] = str(Path(openclaw_home) / "openclaw.json")
    env["OPENCLAW_NO_ONBOARD"] = "1"

    try:
        result = subprocess.run(
            [openclaw_bin, "plugins", "registry", "--refresh"],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            logger.info(f"registry refresh 成功: {result.stdout.strip()}")
        else:
            logger.warning(f"registry refresh 非零退出 ({result.returncode}): {result.stderr.strip()}")
    except Exception as e:
        logger.warning(f"registry refresh 失败: {e}")


def is_gateway_mcp_bridge_installed() -> bool:
    """检查 mcp-bridge 插件是否已正确部署。

    B2 加强：不仅检查 openclaw.plugin.json，还检查 index.js 存在且非空。
    """
    target_dir = _get_openclaw_plugins_dir() / "mcp-bridge"
    manifest = target_dir / "openclaw.plugin.json"
    index_js = target_dir / "index.js"
    return manifest.exists() and index_js.exists() and index_js.stat().st_size > 0


def check_mcp_bridge_freshness() -> Dict:
    """对比源码 index.js 与部署 index.js 的 SHA-256，判断插件是否过时。

    B1 新增：以 SHA-256 为过时判断依据（不用 package.json version，因为 bug fix
    不一定会 bump 版本号）。

    Returns:
        {
            "upToDate": bool,           # True 表示已部署最新版本
            "sourceHash": str | None,   # 源码 index.js 的 SHA-256
            "deployedHash": str | None, # 部署 index.js 的 SHA-256
            "error": str | None,        # 错误信息（如有）
        }
    """
    result: Dict = {
        "upToDate": False,
        "sourceHash": None,
        "deployedHash": None,
        "error": None,
    }

    # 获取源码 index.js 路径
    try:
        src_dir = _get_gateway_plugin_src_dir()
    except RuntimeError as e:
        result["error"] = f"无法定位源码目录: {e}"
        return result

    src_index_js = src_dir / "index.js"
    if not src_index_js.is_file():
        result["error"] = f"源码 index.js 不存在或未构建: {src_index_js}"
        return result

    # 计算源码 SHA-256
    try:
        source_hash = _compute_file_sha256(src_index_js)
        result["sourceHash"] = source_hash
    except OSError as e:
        result["error"] = f"无法读取源码 index.js: {e}"
        return result

    # 获取部署 index.js 路径
    target_dir = _get_openclaw_plugins_dir() / "mcp-bridge"
    deployed_index_js = target_dir / "index.js"

    if not deployed_index_js.is_file():
        result["error"] = f"部署目标 index.js 不存在: {deployed_index_js}"
        result["upToDate"] = False
        return result

    # 计算部署 SHA-256
    try:
        deployed_hash = _compute_file_sha256(deployed_index_js)
        result["deployedHash"] = deployed_hash
    except OSError as e:
        result["error"] = f"无法读取部署 index.js: {e}"
        return result

    result["upToDate"] = (source_hash == deployed_hash)
    return result


def uninstall_gateway_mcp_bridge() -> Dict:
    """卸载 mcp-bridge 插件"""
    target_dir = str(_get_openclaw_plugins_dir() / "mcp-bridge")

    if not os.path.exists(target_dir) and not _is_junction_or_symlink(target_dir):
        return {"success": True, "target": target_dir, "error": None, "message": "插件未安装"}

    try:
        _remove_link_or_dir(target_dir)
        # 从部署清单移除
        try:
            _remove_from_manifest("gateway-mcp-bridge")
        except Exception as e:
            logger.warning(f"部署清单清理失败（不阻断卸载）: {e}")
        return {"success": True, "target": target_dir, "error": None, "message": "卸载成功"}
    except Exception as e:
        return {"success": False, "target": target_dir, "error": str(e)}


def _try_register_tool_source(src_dir: str) -> None:
    """安装 DCC 插件后自动注册工具源码目录到 tool-sources.json。"""
    try:
        try:
            from . import tool_sources as _ts
        except ImportError:
            import tool_sources as _ts
        p = Path(src_dir).resolve()
        for _ in range(10):
            if (p / "packages").is_dir() and (p / "skills").is_dir():
                break
            p = p.parent
        # 统一工具根目录 tools/（其下 official/ 和 marketplace/）
        tools_dir = p / "tools"
        if tools_dir.is_dir():
            _ts.register_source(str(tools_dir), "tools", "installer")
        skills = p / "skills"
        if skills.is_dir():
            _ts.register_source(str(skills), "skills", "installer")
    except Exception:
        pass
