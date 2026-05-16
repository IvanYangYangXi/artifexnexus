"""
manifest/loader.py — manifest.json 加载与验证
==============================================

从 artclaw_bridge ``cli/artclaw_bridge/manifest.py`` 复制 ``load_manifest()``
逻辑并适配到 pydantic v2 + Artifex Nexus 路径。

推荐使用 ``load_manifest_model()``（返回 pydantic 模型实例，类型安全）。
``load_manifest()`` 保留向后兼容但标记为 deprecated。
"""

from __future__ import annotations

import json
import logging
import warnings
from pathlib import Path
from typing import Any, Dict, Optional

from .models import SkillManifest

logger = logging.getLogger("artifex_nexus.skill.manifest")


# ══════════════════════════════════════════════════════════════════════════════
# 推荐 API
# ══════════════════════════════════════════════════════════════════════════════

def load_manifest_model(path: Path) -> Optional[SkillManifest]:
    """加载并校验 manifest.json，返回 pydantic 模型实例。

    推荐新代码使用，类型安全 + 可访问 property 方法。

    Args:
        path: manifest.json 文件路径。

    Returns:
        SkillManifest 模型实例，或 None（加载/校验失败时）。
    """
    path = Path(path).expanduser()

    if not path.exists():
        logger.warning("manifest 文件不存在: %s", path)
        return None

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.error("manifest 读取/解析失败 (%s): %s", path, exc)
        return None

    if not isinstance(data, dict):
        logger.error("manifest 顶层必须是 JSON 对象 (%s)", path)
        return None

    try:
        return SkillManifest.model_validate(data)
    except Exception as exc:
        logger.error("manifest 校验失败 (%s): %s", path, exc)
        return None


# ══════════════════════════════════════════════════════════════════════════════
# Deprecated API（向后兼容，新代码请用 load_manifest_model）
# ══════════════════════════════════════════════════════════════════════════════

def load_manifest(path: Path) -> Optional[Dict[str, Any]]:
    """（Deprecated）加载并验证 manifest.json，返回字典。

    内部会先校验为 pydantic 模型再 dump 为 dict，存在 double conversion 开销。
    推荐新代码使用 ``load_manifest_model()`` 直接获取模型实例。

    Args:
        path: manifest.json 文件路径。

    Returns:
        验证通过的 manifest 字典，或 None。
    """
    warnings.warn(
        "load_manifest() is deprecated; use load_manifest_model() instead, "
        "which returns a typed SkillManifest instance.",
        DeprecationWarning,
        stacklevel=2,
    )
    model = load_manifest_model(path)
    if model is None:
        return None
    return model.model_dump()
