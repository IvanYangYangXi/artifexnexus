"""tool_sources.py — Nexus Tool / Skill 源码目录注册表

管理 ~/.artifexnexus/config/tool-sources.json，记录所有 Nexus Tool 和 Skill
的源码目录路径。

写入点：
  - bootstrap.py : 首次安装 Artifex 时
  - dcc_installer.py : 安装 Blender/Maya 等 DCC 插件时
  - sidecar.py main() : 每次启动时验证和刷新

读取点：
  - Blender addon trigger 系统
  - Sidecar trigger_dispatcher
  - 未来其他 DCC 插件
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

TOOL_SOURCES_PATH = Path.home() / ".artifexnexus" / "config" / "tool-sources.json"


# ── 公共 API ────────────────────────────────────────────────────────────

def _normalize_path(p: str) -> str:
    """规范化路径：resolve + 移除 Windows \\?\ 前缀（如有）。

    确保同一目录无论以何种前缀传入都映射到相同字符串，
    避免去重失效导致 tool-sources.json 中出现重复条目。
    """
    resolved = str(Path(p).resolve())
    # 移除 Windows NT 长路径前缀（\\?\D:\... → D:\...）
    if resolved.startswith("\\\\?\\"):
        resolved = resolved[4:]
    return resolved


def register_source(path: str, source_type: str = "bundled",
                    updated_by: str = "manual") -> bool:
    """注册一个工具源码目录。

    如果路径已存在（按 path 去重），则更新 last_verified。
    如果路径不存在，添加到 sources 列表。
    自动扫描目录统计 tool_count / skill_count。

    Args:
        path: 绝对路径
        source_type: "bundled" | "skills" | "user"
        updated_by: 调用方标识（bootstrap / installer / startup / manual）

    Returns:
        True 如果写入成功
    """
    try:
        config = _read_config()
        sources: List[Dict[str, Any]] = config.get("sources", [])

        now = datetime.now(timezone.utc).isoformat()
        abs_path = _normalize_path(path)
        counts = _count_manifests(abs_path)

        # 按规范化路径查找是否已存在（兼容旧 \\?\ 前缀条目）
        existing = None
        for s in sources:
            if _normalize_path(s.get("path", "")) == abs_path:
                existing = s
                break

        if existing:
            existing["last_verified"] = now
            existing["tool_count"] = counts.get("tool_count", existing.get("tool_count", 0))
            existing["skill_count"] = counts.get("skill_count", existing.get("skill_count", 0))
            if source_type and source_type != existing.get("type"):
                existing["type"] = source_type
        else:
            sources.append({
                "path": abs_path,
                "type": source_type,
                "last_verified": now,
                "tool_count": counts.get("tool_count", 0),
                "skill_count": counts.get("skill_count", 0),
            })

        config["sources"] = sources
        config["updated_by"] = updated_by
        config["updated_at"] = now

        _write_config(config)
        logger.info("Registered tool source: %s (type=%s, tools=%d, skills=%d)",
                     abs_path, source_type,
                     counts.get("tool_count", 0),
                     counts.get("skill_count", 0))
        return True

    except Exception as e:
        logger.error("Failed to register tool source %s: %s", path, e)
        return False


def get_sources(source_type: Optional[str] = None) -> List[Dict[str, Any]]:
    """获取所有已注册的工具源码目录。

    Args:
        source_type: 过滤类型，None 返回全部

    Returns:
        [{"path": str, "type": str, "last_verified": str, ...}, ...]
    """
    try:
        config = _read_config()
        sources = config.get("sources", [])
        if source_type:
            sources = [s for s in sources if s.get("type") == source_type]
        return sources
    except Exception:
        return []


def get_all_manifest_paths(source_type: Optional[str] = None) -> List[str]:
    """获取所有已注册目录中的 manifest.json 绝对路径列表。

    用于触发器系统加载工具清单。

    Args:
        source_type: 过滤类型，None 返回全部

    Returns:
        ["/path/to/tool/manifest.json", ...]
    """
    manifests: List[str] = []
    for src in get_sources(source_type):
        src_path = Path(src["path"])
        if not src_path.is_dir():
            continue
        try:
            for mp in src_path.rglob("manifest.json"):
                manifests.append(str(mp))
        except (OSError, PermissionError):
            continue
    return manifests


def verify_and_refresh() -> Dict[str, Any]:
    """验证所有已注册目录是否存在，刷新统计信息。

    应在 sidecar 启动时调用。

    Returns:
        {"total": int, "valid": int, "missing": int, "details": [...]}
    """
    config = _read_config()
    sources = config.get("sources", [])
    now = datetime.now(timezone.utc).isoformat()

    valid = 0
    missing = 0
    details: List[Dict[str, Any]] = []

    for s in sources:
        src_path = Path(s["path"])
        if src_path.is_dir():
            counts = _count_manifests(str(src_path))
            s["last_verified"] = now
            s["tool_count"] = counts.get("tool_count", s.get("tool_count", 0))
            s["skill_count"] = counts.get("skill_count", s.get("skill_count", 0))
            valid += 1
            details.append({"path": s["path"], "status": "ok", **counts})
        else:
            missing += 1
            details.append({"path": s["path"], "status": "missing"})

    config["updated_by"] = "startup"
    config["updated_at"] = now
    _write_config(config)

    logger.info("Tool sources verified: %d valid, %d missing", valid, missing)
    return {"total": len(sources), "valid": valid, "missing": missing, "details": details}


def set_sdk_path(path: str) -> bool:
    """设置 SDK 父目录路径。

    写入 tool-sources.json 的 sdk_path 字段，
    供 DCC addon（Blender / Maya 等）定位 artifex_nexus_sdk 包。
    SDK 父目录加入 sys.path 后 ``import artifex_nexus_sdk`` 可解析。

    Args:
        path: SDK 父目录绝对路径（e.g. ``<project>/packages/dcc/shared/``）

    Returns:
        True 如果写入成功
    """
    try:
        config = _read_config()
        abs_path = str(Path(path).resolve())
        config["sdk_path"] = abs_path
        config["updated_by"] = "bootstrap"
        config["updated_at"] = datetime.now(timezone.utc).isoformat()
        _write_config(config)
        logger.info("SDK path set: %s", abs_path)
        return True
    except Exception as e:
        logger.error("Failed to set sdk_path %s: %s", path, e)
        return False


def get_sdk_path() -> Optional[str]:
    """读取 SDK 父目录路径。

    Returns:
        SDK 父目录绝对路径，或 None（未设置）
    """
    try:
        config = _read_config()
        return config.get("sdk_path")
    except Exception:
        return None


# ── 内部 ────────────────────────────────────────────────────────────────

def _read_config() -> Dict[str, Any]:
    """读取 tool-sources.json。不存在则返回默认结构。"""
    if TOOL_SOURCES_PATH.exists():
        try:
            return json.loads(TOOL_SOURCES_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to read tool-sources.json: %s", e)

    return {"version": 1, "sdk_path": None, "sources": [], "updated_by": "", "updated_at": ""}


def _write_config(config: Dict[str, Any]) -> None:
    """原子写入 tool-sources.json（tmp → rename）。"""
    TOOL_SOURCES_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = TOOL_SOURCES_PATH.with_suffix(".tmp")
    try:
        tmp_path.write_text(
            json.dumps(config, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(TOOL_SOURCES_PATH)
    except OSError:
        # Windows 上 replace 可能因权限失败，回退到直接写入
        TOOL_SOURCES_PATH.write_text(
            json.dumps(config, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def _count_manifests(root_path: str) -> Dict[str, int]:
    """扫描目录，统计 manifest.json 数量。

    tool_count: _bundled_nexus_tools 下的 Nexus Tool manifest 数
    skill_count: skills 目录下的 Skill manifest（含 SKILL.md）数
    """
    root = Path(root_path)
    result = {"tool_count": 0, "skill_count": 0}

    if not root.is_dir():
        return result

    try:
        for mp in root.rglob("manifest.json"):
            result["tool_count"] += 1

        # 额外统计 SKILL.md（skills 目录特有）
        for sm in root.rglob("SKILL.md"):
            result["skill_count"] += 1
    except (OSError, PermissionError):
        pass

    return result
