"""
skill_config.py — Skill 用户偏好持久化
==========================================

从 artclaw ToolManager ``services/config_manager.py`` 复制并适配。

职责：
    - 用户偏好（pin / favorite / disabled）的 JSON 持久化
    - 原子写入（tmp + rename），单进程场景无需文件锁
    - 不依赖任何框架（FastAPI / HTTP 等）

路径：``~/.artifexnexus/config/skills.json``

.. code-block:: json

    {
        "disabled": ["skill_a"],
        "pinned": ["skill_b"],
        "favorites": ["skill_c"]
    }
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List, Set

logger = logging.getLogger("artifex_nexus.core.skill_config")

_DEFAULT_CONFIG_DIR = Path.home() / ".artifexnexus" / "config"
_DEFAULT_CONFIG_PATH = _DEFAULT_CONFIG_DIR / "skills.json"


class SkillConfig:
    """Skill 用户偏好配置，单例友好（可多实例，共享同一文件）。

    使用方式：

    .. code-block:: python

        from artifex_nexus.core.skill_config import SkillConfig

        config = SkillConfig()
        config.disable("old_skill")
        config.pin("my_favorite")
        config.favorite("useful_tool")
        print(config.get_pinned())  # {"my_favorite"}
    """

    def __init__(self, config_path: Path | None = None):
        self._path = config_path or _DEFAULT_CONFIG_PATH
        self._data: Dict[str, List[str]] = {
            "disabled": [],
            "pinned": [],
            "favorites": [],
        }
        self._load()

    # ═══════════════════════════════════════════════════════════════════════
    # 文件读写（原子 rename，单进程场景无需文件锁）
    # ═══════════════════════════════════════════════════════════════════════

    def _load(self) -> None:
        """从 JSON 文件加载已有配置（保留未知 key）。"""
        if not self._path.exists():
            return
        try:
            loaded = json.loads(self._path.read_text("utf-8"))
            for key in ("disabled", "pinned", "favorites", "nexus_tools"):
                if key in loaded:
                    self._data[key] = loaded[key]
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("技能配置加载失败 (%s): %s", self._path, exc)

    def _save(self) -> None:
        """原子写入：先写 tmp 再 rename。"""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(self._data, indent=2, ensure_ascii=False), "utf-8"
        )
        tmp.replace(self._path)  # 原子操作

    # ═══════════════════════════════════════════════════════════════════════
    # enable / disable
    # ═══════════════════════════════════════════════════════════════════════

    def is_disabled(self, skill_name: str) -> bool:
        """检查 Skill 是否被禁用。"""
        return skill_name in self._data.get("disabled", [])

    def enable(self, skill_name: str) -> None:
        """启用 Skill（从禁用列表移除）。"""
        disabled = self._data.setdefault("disabled", [])
        if skill_name in disabled:
            disabled.remove(skill_name)
            self._save()

    def disable(self, skill_name: str) -> None:
        """禁用 Skill（添加到禁用列表）。"""
        disabled = self._data.setdefault("disabled", [])
        if skill_name not in disabled:
            disabled.append(skill_name)
            self._save()

    def get_disabled(self) -> Set[str]:
        """获取所有被禁用的 Skill 名称集合。"""
        return set(self._data.get("disabled", []))

    # ═══════════════════════════════════════════════════════════════════════
    # pin / unpin
    # ═══════════════════════════════════════════════════════════════════════

    def is_pinned(self, skill_name: str) -> bool:
        """检查 Skill 是否已置顶。"""
        return skill_name in self._data.get("pinned", [])

    def pin(self, skill_name: str) -> None:
        """置顶 Skill。"""
        pinned = self._data.setdefault("pinned", [])
        if skill_name not in pinned:
            pinned.append(skill_name)
            self._save()

    def unpin(self, skill_name: str) -> None:
        """取消置顶 Skill。"""
        pinned = self._data.setdefault("pinned", [])
        if skill_name in pinned:
            pinned.remove(skill_name)
            self._save()

    def get_pinned(self) -> Set[str]:
        """获取所有置顶 Skill 名称集合。"""
        return set(self._data.get("pinned", []))

    # ═══════════════════════════════════════════════════════════════════════
    # favorite / unfavorite
    # ═══════════════════════════════════════════════════════════════════════

    def is_favorite(self, skill_name: str) -> bool:
        """检查 Skill 是否已收藏。"""
        return skill_name in self._data.get("favorites", [])

    def favorite(self, skill_name: str) -> None:
        """收藏 Skill。"""
        favorites = self._data.setdefault("favorites", [])
        if skill_name not in favorites:
            favorites.append(skill_name)
            self._save()

    def unfavorite(self, skill_name: str) -> None:
        """取消收藏 Skill。"""
        favorites = self._data.setdefault("favorites", [])
        if skill_name in favorites:
            favorites.remove(skill_name)
            self._save()

    def get_favorites(self) -> Set[str]:
        """获取所有收藏 Skill 名称集合。"""
        return set(self._data.get("favorites", []))

    # ═══════════════════════════════════════════════════════════════════════
    # Nexus-Tool: enable / disable
    # ═══════════════════════════════════════════════════════════════════════

    def _nexus_tools_data(self) -> Dict[str, List[str]]:
        """获取 nexus_tools 段（懒初始化）。"""
        return self._data.setdefault("nexus_tools", {})

    def is_nexus_tool_disabled(self, nexus_tool_id: str) -> bool:
        """检查 Nexus-Tool 是否被禁用。"""
        return nexus_tool_id in self._nexus_tools_data().get("disabled", [])

    def enable_nexus_tool(self, nexus_tool_id: str) -> None:
        """启用 Nexus-Tool（从禁用列表移除）。"""
        nt = self._nexus_tools_data()
        disabled = nt.setdefault("disabled", [])
        if nexus_tool_id in disabled:
            disabled.remove(nexus_tool_id)
            self._save()

    def disable_nexus_tool(self, nexus_tool_id: str) -> None:
        """禁用 Nexus-Tool（添加到禁用列表）。"""
        nt = self._nexus_tools_data()
        disabled = nt.setdefault("disabled", [])
        if nexus_tool_id not in disabled:
            disabled.append(nexus_tool_id)
            self._save()

    def get_disabled_nexus_tools(self) -> Set[str]:
        """获取所有被禁用的 Nexus-Tool ID 集合。"""
        return set(self._nexus_tools_data().get("disabled", []))

    # ═══════════════════════════════════════════════════════════════════════
    # Nexus-Tool: pin / unpin
    # ═══════════════════════════════════════════════════════════════════════

    def is_nexus_tool_pinned(self, nexus_tool_id: str) -> bool:
        """检查 Nexus-Tool 是否已置顶。"""
        return nexus_tool_id in self._nexus_tools_data().get("pinned", [])

    def pin_nexus_tool(self, nexus_tool_id: str) -> None:
        """置顶 Nexus-Tool。"""
        nt = self._nexus_tools_data()
        pinned = nt.setdefault("pinned", [])
        if nexus_tool_id not in pinned:
            pinned.append(nexus_tool_id)
            self._save()

    def unpin_nexus_tool(self, nexus_tool_id: str) -> None:
        """取消置顶 Nexus-Tool。"""
        nt = self._nexus_tools_data()
        pinned = nt.setdefault("pinned", [])
        if nexus_tool_id in pinned:
            pinned.remove(nexus_tool_id)
            self._save()

    def get_pinned_nexus_tools(self) -> Set[str]:
        """获取所有置顶 Nexus-Tool ID 集合。"""
        return set(self._nexus_tools_data().get("pinned", []))

    # ═══════════════════════════════════════════════════════════════════════
    # Nexus-Tool: favorite / unfavorite
    # ═══════════════════════════════════════════════════════════════════════

    def is_nexus_tool_favorite(self, nexus_tool_id: str) -> bool:
        """检查 Nexus-Tool 是否已收藏。"""
        return nexus_tool_id in self._nexus_tools_data().get("favorites", [])

    def favorite_nexus_tool(self, nexus_tool_id: str) -> None:
        """收藏 Nexus-Tool。"""
        nt = self._nexus_tools_data()
        favorites = nt.setdefault("favorites", [])
        if nexus_tool_id not in favorites:
            favorites.append(nexus_tool_id)
            self._save()

    def unfavorite_nexus_tool(self, nexus_tool_id: str) -> None:
        """取消收藏 Nexus-Tool。"""
        nt = self._nexus_tools_data()
        favorites = nt.setdefault("favorites", [])
        if nexus_tool_id in favorites:
            favorites.remove(nexus_tool_id)
            self._save()

    def get_favorite_nexus_tools(self) -> Set[str]:
        """获取所有收藏 Nexus-Tool ID 集合。"""
        return set(self._nexus_tools_data().get("favorites", []))
