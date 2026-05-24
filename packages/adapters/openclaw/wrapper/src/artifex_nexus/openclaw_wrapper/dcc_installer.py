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


def _get_addon_src_dir() -> Path:
    """获取插件源目录（版本化路径）。

    优先级：
      1. 环境变量 ARTIFEX_NEXUS_ROOT（sidecar 启动时注入）
      2. 显式调用 set_addon_src_dir()
      3. 基于 __file__ 的相对路径（开发模式）
    """
    if _ADDON_SRC_DIR is not None:
        return _ADDON_SRC_DIR

    # 环境变量注入（生产模式：sidecar 由 Tauri 启动）
    env_root = os.environ.get("ARTIFEX_NEXUS_PROJECT_ROOT")
    if env_root:
        base = Path(env_root) / "packages" / "dcc" / "blender" / "src" / "artifex_nexus"
        if base.exists():
            for entry in sorted(base.iterdir(), reverse=True):
                if entry.is_dir() and entry.name.startswith("v"):
                    # Blender addon 在 vX.Y.Z/blender_addon/ 子目录中
                    addon_dir = entry / "blender_addon"
                    if addon_dir.exists():
                        logger.info(f"DCC 安装器: 通过 ARTIFEX_NEXUS_PROJECT_ROOT 定位插件源目录 = {addon_dir}")
                        return addon_dir
                    logger.info(f"DCC 安装器: 通过 ARTIFEX_NEXUS_PROJECT_ROOT 定位插件源目录 = {entry}")
                    return entry
        raise RuntimeError(
            f"环境变量 ARTIFEX_NEXUS_PROJECT_ROOT={env_root}，"
            f"但未找到插件源目录: {base}"
        )

    # 基于 __file__ 的相对路径（开发模式）
    _here = Path(__file__).resolve().parent
    # artifex_nexus/openclaw_wrapper/dcc_installer.py
    # → ../../../../dcc/blender/src/artifex_nexus
    base = (_here / ".." / ".." / ".." / ".." / "dcc" / "blender" / "src" / "artifex_nexus").resolve()
    if base.exists():
        for entry in sorted(base.iterdir(), reverse=True):
            if entry.is_dir() and entry.name.startswith("v"):
                # Blender addon 在 vX.Y.Z/blender_addon/ 子目录中
                addon_dir = entry / "blender_addon"
                if addon_dir.exists():
                    logger.info(f"DCC 安装器: 通过相对路径定位插件源目录 = {addon_dir}")
                    return addon_dir
                logger.info(f"DCC 安装器: 通过相对路径定位插件源目录 = {entry}")
                return entry

    raise RuntimeError(
        "无法定位插件源目录。请设置环境变量 ARTIFEX_NEXUS_ROOT 或调用 set_addon_src_dir()。"
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
    # M7 接入：
    # "maya": os.path.join(os.path.expanduser("~"), "Documents", "maya"),
    # "3ds_max": os.path.join(os.environ.get("LOCALAPPDATA", ""), "Autodesk", "3dsMax"),
}

# DCC 插件安装路径模板（key = dcc_id）
# 注意：unreal 不在此表中 —— UE 插件由用户手动放入 UE 项目 Plugins/ 目录
_DCC_ADDON_PATH_TEMPLATES: Dict[str, str] = {
    "blender": "{base}/{version}/scripts/addons/",
    # "maya": "{base}/{version}/scripts/",
    # "3ds_max": "{base}/{version}/ENU/scripts/",
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
    src_dir = str(_get_addon_src_dir())
    target_dir = get_dcc_addon_target_dir(dcc, dcc_version)

    logger.info(f"安装 {dcc} 插件: {src_dir} → {target_dir}")

    if not os.path.isdir(src_dir):
        return {"success": False, "method": None, "target": target_dir, "error": f"插件源目录不存在: {src_dir}"}

    compatible, reason = check_version_compatibility(dcc_version) if dcc == "blender" else (
        True, ""
    )
    if not compatible and not force:
        return {"success": False, "method": None, "target": target_dir, "error": reason}

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

    if not os.path.exists(target_dir) and not _is_junction_or_symlink(target_dir):
        return {"success": True, "target": target_dir, "error": None, "message": "插件未安装"}

    try:
        _remove_link_or_dir(target_dir)
        # 从部署清单移除
        deployment_id = f"{dcc}-addon-{dcc_version}"
        try:
            _remove_from_manifest(deployment_id)
        except Exception as e:
            logger.warning(f"部署清单清理失败（不阻断卸载）: {e}")
        return {"success": True, "target": target_dir, "error": None, "message": "卸载成功"}
    except Exception as e:
        return {"success": False, "target": target_dir, "error": str(e)}


# ── DCC 端口管理 ──────────────────────────────────────────────────────────

# DCC 默认端口映射（key = dcc_id）
_DCC_DEFAULT_PORTS: Dict[str, int] = {
    "blender": 18083,
    "unreal": 18080,
    # "maya": 18084,
    # "3ds_max": 18085,
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
    src_dir = _get_addon_src_dir()
    init_file = src_dir / "blender_addon" / "__init__.py"

    if not init_file.exists():
        return {
            "name": "Artifex Nexus Bridge",
            "version": (5, 0, 0),
            "blender_min": (5, 0, 0),
            "blender_max": (5, 1, 9),
            "source_dir": str(src_dir),
        }

    # 解析 bl_info（简单 AST 解析，不执行代码）
    try:
        content = init_file.read_text(encoding="utf-8")
        info = _parse_bl_info(content)
        info["source_dir"] = str(src_dir)
        return info
    except Exception:
        return {
            "name": "Artifex Nexus Bridge",
            "version": (5, 0, 0),
            "blender_min": (5, 0, 0),
            "blender_max": (5, 1, 9),
            "source_dir": str(src_dir),
        }


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
    return {
        "name": "Artifex Nexus Bridge",
        "version": (0, 50, 0),
        "blender_min": (5, 0, 0),
        "blender_max": None,
    }


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

    for dep in manifest.get("deployments", []):
        dep_id = dep.get("id", "unknown")
        target_dir = Path(dep.get("target", ""))
        expected_files = dep.get("files", [])

        # 检查目标目录是否存在
        if not target_dir.exists():
            results.append({
                "id": dep_id,
                "status": "missing",
                "target": str(target_dir),
                "sourceVersion": dep.get("sourceVersion"),
                "deployedAt": dep.get("deployedAt"),
                "details": "目标目录不存在",
            })
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
