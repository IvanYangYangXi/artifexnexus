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
import yaml
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

    安装目标（OpenClaw 要求扁平结构）：
        所有 Skill 直接安装在 ``workspace/skills/<skill_name>/`` 下，
        不再按 official/team/user 分目录。
        ``target_layer`` 参数仅保留用于兼容，不影响实际路径。

    源目录（项目管理用，按层级区分）：
        - ``00_official`` → ``skills/official/``
        - ``01_marketplace`` → ``skills/marketplace/``

    操作约定：
        - install:  源 → 目标（默认 00_official → workspace/skills/）
        - uninstall: 删除 workspace/skills/<name>/
        - sync:     对比源与目标
        - publish:  扁平化后源=目标，改为 metadata 操作（标记已发布）

    使用方式：

    .. code-block:: python

        from artifex_nexus.skill import SkillHub, SkillInstaller

        hub = SkillHub()
        installer = SkillInstaller(hub)
        result = installer.install("my_skill")
        if result.ok:
            hub.reload_skills()
    """

    # 层级定义（源目录管理用，目标安装不分区）
    DEFAULT_LAYERS: Dict[str, str] = {
        "00_official": "官方 Skill（源）",
        "01_marketplace": "技能市场（源）",
        "01_team": "团队共享（仅 publish target，无独立目录）",
        "02_user": "用户安装（仅逻辑区分，安装路径扁平）",
        "99_custom": "自定义/开发（已安装目录扫描）",
    }

    def __init__(
        self,
        hub: "SkillHub",
        skills_root: Optional[Path] = None,
        config_path: Optional[Path] = None,
        layer_sources: Optional[Dict[str, Path]] = None,
    ) -> None:
        """:param hub: SkillHub 运行时实例（install/uninstall 后需调用其 reload）。
        :param skills_root: Skill 安装根目录。None 则使用默认路径。
        :param config_path: 配置文件路径。None 则使用默认路径。
        :param layer_sources: 源码层路径映射（如 {"00_official": Path, ...})。
                             用于 install/sync 时查找源文件。None 则回退到 skills_root。
        """
        self._hub = hub
        self._root = (
            Path(skills_root).expanduser().resolve()
            if skills_root
            else _DEFAULT_SKILLS_ROOT
        )
        self._config = SkillConfig(config_path)
        self._layer_sources = layer_sources or {}

    # ── 路径辅助 ──────────────────────────────────────────────────────────

    @staticmethod
    def _is_skill_dir(dir_path: Path) -> bool:
        """目录是否包含 SKILL.md 或 manifest.json（至少其一即为有效 Skill 目录）。"""
        return dir_path.is_dir() and (
            (dir_path / "SKILL.md").exists() or (dir_path / "manifest.json").exists()
        )

    def _source_skill_dir(self, source_layer: str, skill_name: str) -> Path:
        """获取 Skill 源目录路径。

        查找策略（按优先级）：
        1. naive 拼接：source_base / skill_name（检查 SKILL.md 或 manifest.json）
        2. fallback 扫描：在 source_base 下递归查找 SKILL.md 的 frontmatter name
           或 manifest.json 的 name 字段（处理目录名与声明名不匹配的场景）

        若 source_layer 在 layer_sources 中 → 使用映射目录作为 base；
        否则回退到 install root 下的对应层级。
        """
        # 确定源基础目录
        if source_layer in self._layer_sources:
            base_dir = self._layer_sources[source_layer]
        else:
            # 扁平化目标：不在 layer_sources 中的层级直接查 install root
            base_dir = self._root

        # 策略 1: naive 拼接（SKILL.md 或 manifest.json 均可）
        naive = base_dir / skill_name
        if self._is_skill_dir(naive):
            return naive

        # 策略 2: fallback 扫描（处理目录名 ≠ 声明名的情况）
        try:
            # 2a. 先从 SKILL.md frontmatter 找
            for skill_md in base_dir.rglob("SKILL.md"):
                if "templates" in skill_md.parts:
                    continue
                try:
                    import re as _re
                    text = skill_md.read_text("utf-8")
                    m = _re.match(r"^---\s*\n(.*?)\n---", text, _re.DOTALL)
                    if m:
                        fm = yaml.safe_load(m.group(1)) or {}
                        if fm.get("name") == skill_name:
                            logger.debug(
                                "_source_skill_dir: SKILL.md fallback 命中 '%s': %s",
                                skill_name, skill_md.parent,
                            )
                            return skill_md.parent
                except Exception:
                    continue

            # 2b. 再从 manifest.json name 字段找
            for manifest_path in base_dir.rglob("manifest.json"):
                # 跳过模板目录
                if "templates" in manifest_path.parts:
                    continue
                try:
                    data = json.loads(manifest_path.read_text("utf-8"))
                    if data.get("name") == skill_name:
                        logger.debug(
                            "_source_skill_dir: fallback 扫描命中 '%s': %s",
                            skill_name, manifest_path.parent,
                        )
                        return manifest_path.parent
                except (json.JSONDecodeError, OSError):
                    continue
        except OSError:
            pass

        # 未找到，返回 naive 路径（调用方检查 exists() 会得到清晰错误）
        return naive

    def _target_skill_dir(self, target_layer: str, skill_name: str) -> Path:
        """获取 Skill 安装目标目录路径。

        OpenClaw 要求扁平结构：所有已安装 Skill 直接放在 workspace/skills/ 下，
        不再按 official/team/user 分层。

        :param target_layer: 目标层级（保留参数以兼容调用方，路径中不再使用）。
        :param skill_name: Skill 名称。
        """
        return self._root / skill_name

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
        source_dir = self._source_skill_dir(source_layer, skill_name)
        target_dir = self._target_skill_dir(target_layer, skill_name)

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

        # 确认源目录有效（至少包含 SKILL.md 或 manifest.json）
        if not self._is_skill_dir(source_dir):
            return InstallResult(
                False, skill_name, f"源目录缺少 SKILL.md 或 manifest.json: {source_dir}"
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
        target_dir = self._target_skill_dir(target_layer, skill_name)

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
        source_dir = self._source_skill_dir(source_layer, skill_name)
        target_dir = self._target_skill_dir(target_layer, skill_name)

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
        """批量同步所有已安装的 Skill。

        扁平化目标目录：直接遍历 install root 下每个有效 Skill 目录（包含 SKILL.md 或 manifest.json）。

        :param source_layer: 源层级。
        :param target_layer: 目标层级（保留兼容，扁平化后不使用）。
        :return: SyncResult 列表。
        """
        results: List[SyncResult] = []

        if not self._root.is_dir():
            return results

        for skill_dir in sorted(self._root.iterdir()):
            if not self._is_skill_dir(skill_dir):
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
        """发布 Skill（扁平化后为 metadata 操作）。

        扁平化目标目录下，source 和 target 是同一路径，
        不再做文件复制。此方法验证 Skill 存在、读取版本号并返回成功。

        :param skill_name: Skill 名称。
        :param source_layer: 源层级（保留兼容，扁平化后不使用）。
        :param target_layer: 目标层级（保留兼容，扁平化后不使用）。
        :return: PublishResult。
        """
        skill_dir = self._target_skill_dir(source_layer, skill_name)

        if not skill_dir.exists():
            return PublishResult(
                False, skill_name, "", message="Skill 未安装，请先 install"
            )

        # 读取版本号（优先 manifest.json，回退到 SKILL.md frontmatter）
        version = "unknown"
        manifest_file = skill_dir / "manifest.json"
        if manifest_file.exists():
            try:
                manifest_data = json.loads(manifest_file.read_text("utf-8"))
                version = manifest_data.get("version", "unknown")
            except (json.JSONDecodeError, OSError):
                pass
        elif (skill_dir / "SKILL.md").exists():
            try:
                import re as _re2
                text = (skill_dir / "SKILL.md").read_text("utf-8")
                m = _re2.match(r"^---\s*\n(.*?)\n---", text, _re2.DOTALL)
                if m:
                    fm = yaml.safe_load(m.group(1)) or {}
                    meta = fm.get("metadata", {})
                    if isinstance(meta, dict):
                        afx = meta.get("artifex_nexus", {})
                        if isinstance(afx, dict):
                            version = str(afx.get("version", "unknown"))
            except Exception:
                pass

        logger.info(
            "Skill '%s' v%s 已发布（metadata，扁平目录无需复制）",
            skill_name, version,
        )
        return PublishResult(
            True, skill_name, version, skill_dir,
            "发布成功（扁平目录，无需文件复制）",
        )

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
