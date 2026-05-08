"""
dcc_installer.py — DCC 插件安装/卸载/检测（Blender 首发）
=========================================================

复刻自 artclaw_bridge/install_dcc_ext.py，精简：
  - 只保留 Blender 相关逻辑
  - 去掉 Houdini / SP / SD / ComfyUI
  - 去掉 Skill 安装 / Python 依赖安装（M4 再做）
  - 保留 junction/symlink 优先 + fallback 复制

设计：
  - find_blender_versions() → 扫描本机已安装版本
  - install_blender_addon(version) → junction/symlink 安装
  - uninstall_blender_addon(version) → 删除链接
  - get_addon_info() → 读取 bl_info 获取兼容版本范围
"""

from __future__ import annotations

import json
import logging
import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── 常量 ────────────────────────────────────────────────────────────────

# 插件源路径（相对于项目根目录）
# 运行时由 sidecar 注入 _ADDON_SRC_DIR
_ADDON_SRC_DIR: Optional[Path] = None

# Blender addons 基础路径
_BLENDER_ADDONS_BASE = os.path.join(
    os.environ.get("APPDATA", os.path.expanduser("~/AppData/Roaming")),
    "Blender Foundation", "Blender",
)

# 插件在 Blender addons 中的目录名前缀
_ADDON_DIR_PREFIX = "artifex_nexus"


def _get_addon_dir_name() -> str:
    """获取插件目录名（含版本号），如 artfex_nexus_v0.1.0"""
    info = get_addon_info()
    ver = ".".join(str(x) for x in info.get("version", (0, 1, 0)))
    return f"{_ADDON_DIR_PREFIX}_v{ver}"


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
                logger.info(f"DCC 安装器: 通过相对路径定位插件源目录 = {entry}")
                return entry

    raise RuntimeError(
        "无法定位插件源目录。请设置环境变量 ARTIFEX_NEXUS_ROOT 或调用 set_addon_src_dir()。"
        f"\n  已尝试路径: {base}"
    )


# ── 版本检测 ────────────────────────────────────────────────────────────

def find_blender_versions() -> List[str]:
    """
    扫描本机已安装的 Blender 版本。

    扫描 %APPDATA%/Blender Foundation/Blender/ 下的版本目录。
    返回降序排列的版本号列表（如 ["4.2", "4.0", "3.6"]）。
    """
    if not os.path.isdir(_BLENDER_ADDONS_BASE):
        return []

    versions = []
    try:
        for entry in os.scandir(_BLENDER_ADDONS_BASE):
            if entry.is_dir() and entry.name and entry.name[0].isdigit():
                versions.append(entry.name)
    except OSError:
        pass

    # 降序排列
    return sorted(versions, reverse=True)


def _get_blender_addons_dir(version: str) -> str:
    """获取指定 Blender 版本的 addons 目录"""
    return os.path.join(_BLENDER_ADDONS_BASE, version, "scripts", "addons")


def _get_addon_target_dir(version: str) -> str:
    """获取插件在 Blender addons 中的目标路径（含插件版本号）"""
    return os.path.join(_get_blender_addons_dir(version), _get_addon_dir_name())


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


# ── 安装 / 卸载 ─────────────────────────────────────────────────────────

def install_blender_addon(blender_version: str, force: bool = False) -> Dict:
    """
    安装 Blender 插件到指定版本。

    使用 junction（Windows）/ symlink（macOS/Linux）优先，
    失败时 fallback 到复制。

    Args:
        blender_version: Blender 版本号，如 "4.2"
        force: 是否跳过覆盖确认

    Returns:
        {"success": bool, "method": "junction"|"symlink"|"copy", "target": str, "error": str|None}
    """
    src_dir = str(_get_addon_src_dir())
    target_dir = _get_addon_target_dir(blender_version)
    addons_dir = _get_blender_addons_dir(blender_version)

    logger.info(f"安装 Blender 插件: {src_dir} → {target_dir}")

    # 检查源目录
    if not os.path.isdir(src_dir):
        return {
            "success": False,
            "method": None,
            "target": target_dir,
            "error": f"插件源目录不存在: {src_dir}",
        }

    # 检查版本兼容性
    compatible, reason = check_version_compatibility(blender_version)
    if not compatible and not force:
        return {
            "success": False,
            "method": None,
            "target": target_dir,
            "error": reason,
        }

    # 确保 addons 目录存在
    os.makedirs(addons_dir, exist_ok=True)

    # 清理已有安装
    if os.path.exists(target_dir) or _is_junction_or_symlink(target_dir):
        _remove_link_or_dir(target_dir)

    # 尝试 junction/symlink/copy
    method, err_detail = _link_or_copy_dir(src_dir, target_dir)

    if method is None:
        return {
            "success": False,
            "method": None,
            "target": target_dir,
            "error": f"无法创建链接或复制目录: {err_detail}",
        }

    logger.info(f"Blender {blender_version} 插件安装成功 ({method})")
    return {
        "success": True,
        "method": method,
        "target": target_dir,
        "error": None,
    }


def uninstall_blender_addon(blender_version: str) -> Dict:
    """
    卸载 Blender 插件。

    Args:
        blender_version: Blender 版本号

    Returns:
        {"success": bool, "target": str, "error": str|None}
    """
    target_dir = _get_addon_target_dir(blender_version)

    logger.info(f"卸载 Blender 插件: {target_dir}")

    if not os.path.exists(target_dir) and not _is_junction_or_symlink(target_dir):
        return {
            "success": True,
            "target": target_dir,
            "error": None,
            "message": "插件未安装",
        }

    try:
        _remove_link_or_dir(target_dir)
        logger.info(f"Blender {blender_version} 插件卸载成功")
        return {
            "success": True,
            "target": target_dir,
            "error": None,
            "message": "卸载成功",
        }
    except Exception as e:
        return {
            "success": False,
            "target": target_dir,
            "error": str(e),
        }


def is_addon_installed(blender_version: str) -> bool:
    """检查插件是否已安装到指定 Blender 版本"""
    target_dir = _get_addon_target_dir(blender_version)
    return os.path.exists(target_dir) or _is_junction_or_symlink(target_dir)


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


def _try_junction(src: str, dst: str) -> Tuple[bool, str]:
    """尝试创建 Windows junction（目录）。不需要管理员权限。

    Returns:
        (success, error_message)
    """
    if platform.system() != "Windows":
        return False, "非 Windows 平台"
    try:
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", dst, src],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0 and os.path.isdir(dst):
            return True, ""
        err = result.stderr.strip() or result.stdout.strip() or f"返回码 {result.returncode}"
        return False, err
    except subprocess.TimeoutExpired:
        return False, "junction 创建超时"
    except FileNotFoundError:
        return False, "cmd.exe 不可用"
    except Exception as e:
        return False, str(e)


def _try_symlink_dir(src: str, dst: str) -> Tuple[bool, str]:
    """尝试创建目录 symlink。

    Returns:
        (success, error_message)
    """
    try:
        os.symlink(src, dst, target_is_directory=True)
        return True, ""
    except OSError as e:
        return False, f"symlink 创建失败: {e}"
    except NotImplementedError:
        return False, "当前平台不支持 symlink"


def _link_or_copy_dir(src: str, dst: str) -> Tuple[Optional[str], str]:
    """
    创建目录引用（优先 junction/symlink，fallback 复制）。

    Returns:
        (method, error_message)
        method: "junction" | "symlink" | "copy" | None（失败）
        error_message: 失败时的详细错误信息
    """
    src = os.path.abspath(src)
    dst = os.path.abspath(dst)

    # 清理已有目标
    if os.path.exists(dst) or _is_junction_or_symlink(dst):
        _remove_link_or_dir(dst)

    # 确保父目录存在
    os.makedirs(os.path.dirname(dst), exist_ok=True)

    # 优先 junction (Windows, 无权限要求)
    ok, err = _try_junction(src, dst)
    if ok:
        return "junction", ""
    junction_err = err

    # 其次 symlink
    ok, err = _try_symlink_dir(src, dst)
    if ok:
        return "symlink", ""
    symlink_err = err

    # fallback: 复制
    try:
        shutil.copytree(src, dst)
        return "copy", ""
    except Exception as e:
        copy_err = str(e)

    # 全部失败：汇总错误信息
    detail = (
        f"junction 失败: {junction_err}; "
        f"symlink 失败: {symlink_err}; "
        f"copy 失败: {copy_err}"
    )
    logger.error(f"安装 Blender 插件失败: {detail}")
    return None, detail


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
    """获取 OpenClaw plugins 目录"""
    openclaw_home = os.environ.get(
        "OPENCLAW_HOME",
        os.path.join(os.path.expanduser("~"), ".openclaw"),
    )
    return Path(openclaw_home) / "plugins"


def install_gateway_mcp_bridge() -> Dict:
    """
    部署 mcp-bridge 插件到 OpenClaw plugins 目录 + patch openclaw.json 配置。

    1. junction/symlink gateway-plugin/ → OPENCLAW_HOME/plugins/mcp-bridge/
    2. 确保 openclaw.json 中 plugins.entries.mcp-bridge 已配置
    3. 确保 openclaw.json 中 plugins.allow 包含 "mcp-bridge"

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

    # 确保 plugins 目录存在
    os.makedirs(str(plugins_dir), exist_ok=True)

    # 清理已有安装
    if os.path.exists(target_dir) or _is_junction_or_symlink(target_dir):
        _remove_link_or_dir(target_dir)

    method, err_detail = _link_or_copy_dir(src_dir, target_dir)

    if method is None:
        return {
            "success": False,
            "method": None,
            "target": target_dir,
            "error": f"无法部署插件: {err_detail}",
        }

    logger.info(f"mcp-bridge 插件部署成功 ({method}): {target_dir}")

    # Patch openclaw.json：确保 plugins.entries.mcp-bridge 和 plugins.allow 已配置
    _patch_openclaw_config_for_mcp_bridge()

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
    openclaw_home = os.environ.get(
        "OPENCLAW_HOME",
        os.path.join(os.path.expanduser("~"), ".openclaw"),
    )
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

    # 确保 plugins.allow 包含 "mcp-bridge"
    allow: list = config["plugins"].get("allow", [])
    if "mcp-bridge" not in allow:
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
                        "url": "ws://127.0.0.1:8083",
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
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            logger.info(f"openclaw.json 已更新: {config_path}")
        except Exception as e:
            logger.error(f"写入 openclaw.json 失败: {e}")


def is_gateway_mcp_bridge_installed() -> bool:
    """检查 mcp-bridge 插件是否已部署"""
    target_dir = str(_get_openclaw_plugins_dir() / "mcp-bridge")
    return os.path.exists(target_dir) or _is_junction_or_symlink(target_dir)


def uninstall_gateway_mcp_bridge() -> Dict:
    """卸载 mcp-bridge 插件"""
    target_dir = str(_get_openclaw_plugins_dir() / "mcp-bridge")

    if not os.path.exists(target_dir) and not _is_junction_or_symlink(target_dir):
        return {"success": True, "target": target_dir, "error": None, "message": "插件未安装"}

    try:
        _remove_link_or_dir(target_dir)
        return {"success": True, "target": target_dir, "error": None, "message": "卸载成功"}
    except Exception as e:
        return {"success": False, "target": target_dir, "error": str(e)}
