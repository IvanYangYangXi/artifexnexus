"""
nexus_tool/installer.py — NexusToolInstaller 安装器
======================================================

从 artclaw ToolManager ``services/tool_service.py`` §create/update/delete/publish 复制并适配。

职责：
    - 创建 / 修改 / 删除 nexus-tool（文件系统操作）
    - 发布 nexus-tool 到指定 layer
    - Pin / Unpin / Favorite / Unfavorite（委托 SkillConfig）

命名铁律：所有类名/方法名/变量名必须包含 ``nexus_tool``，禁止裸 ``tool``。
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from artifex_nexus.core.skill_config import SkillConfig

from .models import NexusToolData
from .registry import NexusToolRegistry

logger = logging.getLogger("artifex_nexus.skill.nexus_tool.installer")

# 默认 Nexus-Tool 根目录
_DEFAULT_NEXUS_TOOLS_ROOT = Path.home() / ".artifexnexus" / "nexus-tools"

_VALID_SOURCES = ("official", "marketplace", "user")


class NexusToolInstaller:
    """Nexus-Tool 安装器：CRUD + Publish + Pin/Favorite。

    依赖 NexusToolRegistry 获取已有 nexus-tool 列表，
    SkillConfig 持久化 pin/favorite 等用户偏好。
    """

    def __init__(
        self,
        registry: NexusToolRegistry | None = None,
        config: SkillConfig | None = None,
        nexus_tools_root: Path | None = None,
        tools_path: Path | None = None,
    ):
        self.registry = registry or NexusToolRegistry(config=config)
        self.config = config or SkillConfig()
        self._nexus_tools_root = nexus_tools_root or _DEFAULT_NEXUS_TOOLS_ROOT
        self._tools_path = tools_path

    # ═══════════════════════════════════════════════════════════════════════
    # CRUD
    # ═══════════════════════════════════════════════════════════════════════

    def create_nexus_tool(
        self,
        name: str,
        *,
        description: str = "",
        version: str = "1.0.0",
        source: str = "user",
        target_dccs: List[str] | None = None,
        manifest: Dict[str, Any] | None = None,
    ) -> NexusToolData:
        """创建新的 nexus-tool（写入 manifest.json 到磁盘）。

        仅支持 ``source="user"``（官方/市集工具存放在项目源码中，不可直接创建）。
        Nexus-Tool 存储在 ``~/.artifexnexus/nexus-tools/user/{name}/``。
        """
        if source != "user":
            raise ValueError(
                f"Invalid source '{source}'. "
                f"Only 'user' nexus-tools can be created directly. "
                f"Official/marketplace tools live in the project source tree."
            )

        nexus_tool_id = f"{source}/{name}"
        nexus_tool_dir = self._nexus_tools_root / "user" / name

        if nexus_tool_dir.exists():
            raise ValueError(f"Nexus-Tool already exists: {nexus_tool_id}")

        if manifest is None:
            manifest = {}
        manifest.setdefault("name", name)
        manifest.setdefault("description", description)
        manifest.setdefault("version", version)
        manifest["source"] = source
        manifest["id"] = nexus_tool_id
        manifest.setdefault("targetDCCs", target_dccs or [])
        manifest.setdefault("implementation", {"type": "script"})

        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        manifest.setdefault("author", "")
        manifest.setdefault("createdAt", now)
        manifest["updatedAt"] = now

        nexus_tool_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = nexus_tool_dir / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False), "utf-8"
        )

        td = NexusToolData(
            id=nexus_tool_id,
            name=name,
            description=description,
            version=version,
            source=source,
            target_dccs=target_dccs or [],
            status="installed",
            nexus_tool_path=str(nexus_tool_dir),
            manifest=manifest,
            author=manifest.get("author", ""),
            created_at=now,
            updated_at=now,
        )
        self.registry._cache.append(td)
        return td

    def update_nexus_tool(
        self, nexus_tool_id: str, **kwargs: Any
    ) -> Optional[NexusToolData]:
        """部分更新 nexus-tool（修改 manifest.json 的 safe fields）。"""
        td = self.registry.get_nexus_tool(nexus_tool_id)
        if td is None:
            return None

        for key, value in kwargs.items():
            if value is not None and hasattr(td, key):
                setattr(td, key, value)

        if td.nexus_tool_path:
            manifest_path = Path(td.nexus_tool_path) / "manifest.json"
            if manifest_path.exists():
                manifest = json.loads(manifest_path.read_text("utf-8"))
                # Safe fields（不覆盖整个 manifest）
                if "name" in kwargs and kwargs["name"]:
                    manifest["name"] = kwargs["name"]
                if "description" in kwargs and kwargs["description"] is not None:
                    manifest["description"] = kwargs["description"]
                if "version" in kwargs and kwargs["version"]:
                    manifest["version"] = kwargs["version"]
                if "author" in kwargs and kwargs["author"] is not None:
                    manifest["author"] = kwargs["author"]
                    td.author = kwargs["author"]
                if "target_dccs" in kwargs and kwargs["target_dccs"] is not None:
                    manifest["targetDCCs"] = kwargs["target_dccs"]
                # Safe manifest sub-keys
                if "manifest" in kwargs and isinstance(kwargs["manifest"], dict):
                    m = kwargs["manifest"]
                    safe_keys = (
                        "inputs", "outputs", "presets", "triggers", "defaultFilters",
                        "implementation", "agentHint",
                    )
                    for k in safe_keys:
                        if k in m:
                            manifest[k] = m[k]
                now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                manifest["updatedAt"] = now
                td.updated_at = now
                td.manifest = manifest
                manifest_path.write_text(
                    json.dumps(manifest, indent=2, ensure_ascii=False), "utf-8"
                )

        return td

    def delete_nexus_tool(self, nexus_tool_id: str) -> bool:
        """删除 nexus-tool（移除目录 + 清理偏好）。"""
        td = self.registry.get_nexus_tool(nexus_tool_id)
        if td is None:
            return False
        if td.nexus_tool_path and Path(td.nexus_tool_path).is_dir():
            shutil.rmtree(td.nexus_tool_path, ignore_errors=True)
        self.registry._cache = [
            t for t in self.registry._cache if t.id != nexus_tool_id
        ]
        # 清理用户偏好
        self.config.disable_nexus_tool(nexus_tool_id)
        self.config.unpin_nexus_tool(nexus_tool_id)
        self.config.unfavorite_nexus_tool(nexus_tool_id)
        return True

    # ═══════════════════════════════════════════════════════════════════════
    # Publish
    # ═══════════════════════════════════════════════════════════════════════

    def publish_nexus_tool(
        self,
        nexus_tool_id: str,
        target: str,
        *,
        version: str | None = None,
        description: str | None = None,
    ) -> Dict[str, Any]:
        """发布 user nexus-tool 到 official 或 marketplace（内嵌路径）。

        将 nexus-tool 从 ``~/.artifexnexus/nexus-tools/user/`` 移动到
        ``{tools_path}/{target}/``。
        生产环境（site-packages 只读）时拒绝发布并给出清晰错误。
        """
        if self._tools_path is None:
            raise ValueError(
                "Cannot publish: tools_path is not set. "
                "The bundled nexus-tools directory could not be located."
            )
        if target not in ("official", "marketplace"):
            raise ValueError(
                f"Invalid publish target: {target}. "
                f"Must be 'official' or 'marketplace'"
            )

        td = self.registry.get_nexus_tool(nexus_tool_id)
        if td is None:
            raise ValueError(f"Nexus-Tool not found: {nexus_tool_id}")

        if td.source != "user":
            raise ValueError("Only user nexus-tools can be published")

        source_path = Path(td.nexus_tool_path)
        if not source_path.exists():
            raise ValueError(f"Source nexus-tool directory not found: {source_path}")

        # 目标路径：内嵌 nexus-tools/{target}/ 下
        repo_target = self._tools_path / target / td.name

        # 检查目标目录是否可写（生产环境 site-packages 可能只读）
        repo_target.parent.mkdir(parents=True, exist_ok=True)
        if not os.access(str(repo_target.parent), os.W_OK):
            raise RuntimeError(
                f"Cannot publish: target directory '{repo_target.parent}' is not writable. "
                f"Publishing to official/marketplace requires write access to the bundled "
                f"nexus-tools directory, which is only available in development mode."
            )

        if repo_target.exists():
            shutil.rmtree(repo_target)
        shutil.copytree(str(source_path), str(repo_target))

        # 更新目标 manifest.json
        manifest_path = repo_target / "manifest.json"
        if manifest_path.exists():
            manifest_data = json.loads(manifest_path.read_text("utf-8"))
            manifest_data["source"] = target
            manifest_data["id"] = f"{target}/{td.name}"
            if version:
                manifest_data["version"] = version
            if description:
                manifest_data["description"] = description
            manifest_path.write_text(
                json.dumps(manifest_data, indent=2, ensure_ascii=False), "utf-8"
            )

        # 删除 user 副本
        shutil.rmtree(str(source_path), ignore_errors=True)
        # 清除缓存
        self.registry._cache = []

        return {
            "id": f"{target}/{td.name}",
            "message": (
                f"Nexus-Tool '{td.name}' published to {target} successfully"
            ),
            "version": version or td.version,
            "target": target,
            "path": str(repo_target),
        }

    # ═══════════════════════════════════════════════════════════════════════
    # Pin / Unpin（委托 SkillConfig）
    # ═══════════════════════════════════════════════════════════════════════

    def pin_nexus_tool(self, nexus_tool_id: str) -> Optional[NexusToolData]:
        """置顶 nexus-tool。"""
        td = self.registry.get_nexus_tool(nexus_tool_id)
        if td is None:
            return None
        td.is_pinned = True
        self.config.pin_nexus_tool(nexus_tool_id)
        return td

    def unpin_nexus_tool(self, nexus_tool_id: str) -> Optional[NexusToolData]:
        """取消置顶 nexus-tool。"""
        td = self.registry.get_nexus_tool(nexus_tool_id)
        if td is None:
            return None
        td.is_pinned = False
        self.config.unpin_nexus_tool(nexus_tool_id)
        return td

    # ═══════════════════════════════════════════════════════════════════════
    # Favorite / Unfavorite（委托 SkillConfig）
    # ═══════════════════════════════════════════════════════════════════════

    def favorite_nexus_tool(self, nexus_tool_id: str) -> Optional[NexusToolData]:
        """收藏 nexus-tool。"""
        td = self.registry.get_nexus_tool(nexus_tool_id)
        if td is None:
            return None
        td.is_favorited = True
        self.config.favorite_nexus_tool(nexus_tool_id)
        return td

    def unfavorite_nexus_tool(self, nexus_tool_id: str) -> Optional[NexusToolData]:
        """取消收藏 nexus-tool。"""
        td = self.registry.get_nexus_tool(nexus_tool_id)
        if td is None:
            return None
        td.is_favorited = False
        self.config.unfavorite_nexus_tool(nexus_tool_id)
        return td
