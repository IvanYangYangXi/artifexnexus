"""
installer.py — SkillInstaller 安装 / 卸载 / 同步 / 发布
============================================================

从 artclaw_bridge ``core/skill_sync.py`` + ToolManager ``services/skill_service.py``
复制并适配。

职责：
    - install   — 从源层拷贝 Skill 到目标层
    - uninstall — 从目标层移除 Skill
    - sync      — 对比源层与目标层，按需更新文件
    - publish   — 将 Skill 发布到团队/官方层
    - enable / disable — Skill 启用/禁用管理
    - toggle / is_enabled / get_disabled_skills

与 Phase 2 的 ``compare_skill_dirs()`` 配合：
    - sync 操作内部调用 ``compare_skill_dirs()`` 获取 SyncStatus
    - 仅当 SOURCE_NEWER 时自动触发文件复制
    - MODIFIED / INSTALLED_NEWER → 提示用户手动发布
    - CONFLICT → 返回冲突文件列表，不自动覆盖
"""

from __future__ import annotations

import json
import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Dict, List, Optional, Set

from artifex_nexus.core.skill_config import SkillConfig

from .conflict import SyncState, SyncStatus, compare_skill_dirs

if TYPE_CHECKING:
    from .hub import SkillHub

logger = logging.getLogger("artifex_nexus.skill.installer")

# ═══════════════════════════════════════════════════════════════════════════════
# 默认路径
# ═══════════════════════════════════════════════════════════════════════════════

_DEFAULT_SKILLS_ROOT = Path.home() / ".artifexnexus" / ".openclaw" / "workspace" / "skills"

# ═══════════════════════════════════════════════════════════════════════════════
# 结果数据类
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class InstallResult:
    """安装/卸载操作结果。"""

    ok: bool
    skill_name: str
    message: str
    installed_path: Optional[Path] = None


@dataclass
class SyncResult:
    """同步操作结果。"""

    ok: bool
    skill_name: str
    synced_files: List[str] = field(default_factory=list)
    state: SyncState = SyncState.NOT_INSTALLED
    message: str = ""


@dataclass
class PublishResult:
    """发布操作结果。"""

    ok: bool
    skill_name: str
    version: str
    published_path: Optional[Path] = None
    message: str = ""


# ═══════════════════════════════════════════════════════════════════════════════
# SkillInstaller
# ═══════════════════════════════════════════════════════════════════════════════


class SkillInstaller:
    """Skill 安装/卸载/同步/发布管理。

    操作目标层级约定：
        - 安装目标：``02_user``（用户层）
        - 卸载目标：``02_user``（用户层）
        - 同步源：``00_official``（官方），目标：``02_user``
        - 发布源：``02_user``，目标：``01_team``（团队）或 ``00_official``

    使用方式：

    .. code-block:: python

        from artifex_nexus.skill import SkillHub, SkillInstaller

        hub = SkillHub()
        installer = SkillInstaller(hub)
        result = installer.install("my_skill")
        if result.ok:
            hub.reload_skills()
    """

    # 默认 Skill 安装层级结构
    DEFAULT_LAYERS: Dict[str, str] = {
        "00_official": "官方 Skill",
        "01_team": "团队共享",
        "02_user": "用户安装",
        "99_custom": "自定义/开发",
    }

    def __init__(
        self,
        hub: "SkillHub",
        skills_root: Optional[Path] = None,
        config_path: Optional[Path] = None,
    ) -> None:
        """:param hub: SkillHub 运行时实例（install/uninstall 后需调用其 reload）。
        :param skills_root: Skill 安装根目录。None 则使用默认路径。
        :param config_path: 配置文件路径。None 则使用默认路径。
        """
        self._hub = hub
        self._root = (
            Path(skills_root).expanduser().resolve()
            if skills_root
            else _DEFAULT_SKILLS_ROOT
        )
        self._config = SkillConfig(config_path)

    # ── 路径辅助 ──────────────────────────────────────────────────────────

    def _layer_dir(self, layer: str) -> Path:
        """获取层级目录路径。"""
        return self._root / layer

    def _skill_dir(self, layer: str, skill_name: str) -> Path:
        """获取指定层级下 Skill 目录路径。"""
        return self._layer_dir(layer) / skill_name

    # ── install ───────────────────────────────────────────────────────────

    def install(
        self,
        skill_name: str,
        source_layer: str = "00_official",
        target_layer: str = "02_user",
    ) -> InstallResult:
        """从源层安装 Skill 到目标层。

        若目标已存在 → 自动走 sync 更新而非覆盖。

        :param skill_name: Skill 名称。
        :param source_layer: 源层级（默认官方层）。
        :param target_layer: 目标层级（默认用户层）。
        :return: InstallResult。
        """
        source_dir = self._skill_dir(source_layer, skill_name)
        target_dir = self._skill_dir(target_layer, skill_name)

        if not source_dir.exists():
            return InstallResult(
                False, skill_name, f"源 Skill 不存在: {source_dir}"
            )

        # 目标已存在 → 走 sync
        if target_dir.exists():
            sync_result = self.sync(skill_name, source_layer, target_layer)
            return InstallResult(
                ok=sync_result.ok,
                skill_name=skill_name,
                message=f"已安装，同步结果: {sync_result.message}",
                installed_path=target_dir,
            )

        # 确认 manifest 有效
        manifest_path = source_dir / "manifest.json"
        if not manifest_path.exists():
            return InstallResult(
                False, skill_name, f"源目录缺少 manifest.json: {source_dir}"
            )

        try:
            shutil.copytree(source_dir, target_dir)
            logger.info(
                "Skill '%s' 已安装: %s → %s", skill_name, source_dir, target_dir
            )
            return InstallResult(True, skill_name, "安装成功", target_dir)
        except OSError as exc:
            logger.error("Skill '%s' 安装失败: %s", skill_name, exc)
            return InstallResult(False, skill_name, str(exc))

    # ── uninstall ─────────────────────────────────────────────────────────

    def uninstall(
        self,
        skill_name: str,
        target_layer: str = "02_user",
    ) -> InstallResult:
        """从目标层卸载 Skill。

        :param skill_name: Skill 名称。
        :param target_layer: 目标层级（默认用户层）。
        :return: InstallResult。
        """
        target_dir = self._skill_dir(target_layer, skill_name)

        if not target_dir.exists():
            return InstallResult(
                False, skill_name, f"Skill 未安装: {target_dir}"
            )

        try:
            shutil.rmtree(target_dir)
            logger.info("Skill '%s' 已卸载: %s", skill_name, target_dir)
            return InstallResult(True, skill_name, "卸载成功")
        except OSError as exc:
            logger.error("Skill '%s' 卸载失败: %s", skill_name, exc)
            return InstallResult(False, skill_name, str(exc))

    # ── sync ──────────────────────────────────────────────────────────────

    def sync(
        self,
        skill_name: str,
        source_layer: str = "00_official",
        target_layer: str = "02_user",
    ) -> SyncResult:
        """同步 Skill：对比源与目标，按需更新文件。

        内部调用 ``compare_skill_dirs()`` 获取 SyncStatus：
            - SYNCED → 无需操作
            - SOURCE_NEWER → 自动复制更新文件
            - INSTALLED_NEWER → 提示发布
            - MODIFIED → 提示本地未发布改动
            - CONFLICT → 返回冲突文件列表
            - NO_SOURCE / NOT_INSTALLED → 返回错误

        :param skill_name: Skill 名称。
        :param source_layer: 源层级。
        :param target_layer: 目标层级。
        :return: SyncResult。
        """
        source_dir = self._skill_dir(source_layer, skill_name)
        target_dir = self._skill_dir(target_layer, skill_name)

        if not source_dir.exists():
            return SyncResult(
                False, skill_name,
                state=SyncState.NO_SOURCE,
                message="源目录不存在",
            )

        if not target_dir.exists():
            return SyncResult(
                False, skill_name,
                state=SyncState.NOT_INSTALLED,
                message="未安装，请先 install",
            )

        status = compare_skill_dirs(source_dir, target_dir)

        if status.state == SyncState.SYNCED:
            return SyncResult(True, skill_name, state=status.state, message="已是最新")

        if status.state == SyncState.SOURCE_NEWER:
            return self._do_sync_copy(skill_name, source_dir, target_dir, status)

        if status.state == SyncState.INSTALLED_NEWER:
            return SyncResult(
                True, skill_name, state=status.state,
                message="已安装版本较新，如需分享请执行 publish",
            )

        if status.state == SyncState.MODIFIED:
            return SyncResult(
                True, skill_name, state=status.state,
                message="本地有未发布的修改",
            )

        if status.state == SyncState.CONFLICT:
            return SyncResult(
                False, skill_name,
                synced_files=list(status.changed_files),
                state=status.state,
                message=f"冲突文件 ({len(status.changed_files)}): "
                        f"{', '.join(list(status.changed_files)[:5])}"
                        f"{'...' if len(status.changed_files) > 5 else ''}",
            )

        if status.state == SyncState.NO_SOURCE:
            return SyncResult(
                False, skill_name,
                state=status.state,
                message="源码目录不存在",
            )

        return SyncResult(
            False, skill_name, state=status.state,
            message=f"未知同步状态: {status.state}",
        )

    def _do_sync_copy(
        self,
        skill_name: str,
        source_dir: Path,
        target_dir: Path,
        status: SyncStatus,
    ) -> SyncResult:
        """执行源 → 目标的文件复制同步。

        保守策略：不主动删除目标侧多余文件。
        """
        synced: List[str] = []
        errors: List[str] = []

        for rel_path in status.changed_files:
            src_file = source_dir / rel_path
            dst_file = target_dir / rel_path

            if not src_file.exists():
                logger.debug(
                    "sync '%s': 跳过已删除的源文件 %s", skill_name, rel_path
                )
                continue

            try:
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_file, dst_file)
                synced.append(rel_path)
            except OSError as exc:
                errors.append(f"{rel_path}: {exc}")

        if errors:
            return SyncResult(
                False, skill_name,
                synced_files=synced,
                state=status.state,
                message=f"部分文件同步失败 ({len(errors)}): {'; '.join(errors[:3])}",
            )

        return SyncResult(
            True, skill_name,
            synced_files=synced,
            state=status.state,
            message=f"已同步 {len(synced)} 个文件",
        )

    def sync_all(
        self,
        source_layer: str = "00_official",
        target_layer: str = "02_user",
    ) -> List[SyncResult]:
        """批量同步目标层中所有已安装的 Skill。

        :param source_layer: 源层级。
        :param target_layer: 目标层级（会遍历其下所有子目录作为 Skill）。
        :return: SyncResult 列表。
        """
        results: List[SyncResult] = []
        target_layer_dir = self._layer_dir(target_layer)

        if not target_layer_dir.exists():
            return results

        for skill_dir in sorted(target_layer_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_name = skill_dir.name
            result = self.sync(skill_name, source_layer, target_layer)
            results.append(result)

        return results

    # ── publish ───────────────────────────────────────────────────────────

    def publish(
        self,
        skill_name: str,
        source_layer: str = "02_user",
        target_layer: str = "01_team",
    ) -> PublishResult:
        """发布 Skill 到目标层（团队/官方）。

        读取 manifest.json 获取版本号用于结果报告。

        :param skill_name: Skill 名称。
        :param source_layer: 源层级（默认用户层）。
        :param target_layer: 目标层级（默认团队层）。
        :return: PublishResult。
        """
        source_dir = self._skill_dir(source_layer, skill_name)
        target_dir = self._skill_dir(target_layer, skill_name)

        if not source_dir.exists():
            return PublishResult(
                False, skill_name, "", message="源 Skill 不存在"
            )

        # 读取版本号
        version = "unknown"
        manifest_file = source_dir / "manifest.json"
        if manifest_file.exists():
            try:
                manifest_data = json.loads(manifest_file.read_text("utf-8"))
                version = manifest_data.get("version", "unknown")
            except (json.JSONDecodeError, OSError):
                pass

        try:
            if target_dir.exists():
                shutil.rmtree(target_dir)
            target_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source_dir, target_dir)
            logger.info(
                "Skill '%s' v%s 已发布到 %s", skill_name, version, target_layer
            )
            return PublishResult(
                True, skill_name, version, target_dir, "发布成功"
            )
        except OSError as exc:
            logger.error("Skill '%s' 发布失败: %s", skill_name, exc)
            return PublishResult(False, skill_name, version, message=str(exc))

    # ── enable / disable ──────────────────────────────────────────────────

    def enable(self, skill_name: str) -> bool:
        """启用 Skill（从禁用列表中移除）。

        :param skill_name: Skill 名称。
        :return: 始终返回 True。
        """
        self._config.enable(skill_name)
        return True

    def disable(self, skill_name: str) -> bool:
        """禁用 Skill（添加到禁用列表）。

        :param skill_name: Skill 名称。
        :return: 始终返回 True。
        """
        self._config.disable(skill_name)
        return True

    def is_enabled(self, skill_name: str) -> bool:
        """检查 Skill 是否已启用。

        :param skill_name: Skill 名称。
        :return: True = 已启用（未被禁用）。
        """
        return not self._config.is_disabled(skill_name)

    def toggle(self, skill_name: str) -> bool:
        """切换 Skill 启用/禁用状态。

        :param skill_name: Skill 名称。
        :return: 切换后的状态（True = 启用，False = 禁用）。
        """
        if self.is_enabled(skill_name):
            self.disable(skill_name)
            return False
        else:
            self.enable(skill_name)
            return True

    def get_disabled_skills(self) -> Set[str]:
        """获取所有被禁用的 Skill 名称集合。

        :return: 禁用 Skill 名称集合。
        """
        return self._config.get_disabled()
