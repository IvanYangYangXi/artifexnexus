"""
hub/core.py — SkillHub 运行中心
=================================

从 artclaw_bridge ``cli/artclaw_bridge/skill_hub.py`` 复制并适配：

- 去掉 ``artclaw_bridge.config`` → 改为直接接受路径参数
- ``scan_all_skills()`` 只读 manifest.json（延迟加载，不 import Python 模块）
- ``load_skill(name)`` 才做 ``importlib.import_module`` 并收集 @skill_tool 函数
- Skill-Tool 收集通过 walk module ``__dict__`` 查找 ``_artifex_skill_tool`` 标记
  （不使用全局注册表，避免多 Skill 的 Skill-Tool 混淆）
- 层级冲突自动按 ``LAYER_PRIORITY`` 选最优

Skill 加载生命周期：
    1. ``scan_all_skills()``        → 扫描各层目录 → 生成 SkillEntry 列表（轻量）
    2. ``load_skill(name)``         → 导入 Python 模块 → 构建 SkillInstance（含 Skill-Tool handlers）
    3. ``execute_skill_tool(...)``  → 从 SkillInstance.tools 找到 handler → 调用 → 返回 SkillToolResult
    4. ``reload_skills()``          → 清空缓存 + 重新扫描 + 重新加载
"""

from __future__ import annotations

import importlib.util
import json
import logging
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Dict, List, Optional

import yaml

from ..categories import DCCEntry, software_value
from ..conflict import LAYER_PRIORITY
from ..decorator import SkillToolResult
from ..manifest import SkillManifest, load_manifest_model
from .instance import SkillInstance

logger = logging.getLogger("artifex_nexus.skill.hub")


# ── 安装根路径 ────────────────────────────────────────────────────────────────

_DEFAULT_SKILLS_ROOT = Path.home() / ".artifexnexus" / ".openclaw" / "workspace" / "skills"
"""默认 Skill 安装根目录。与 OpenClaw workspace 规范对齐。"""


# ── 扫描阶段轻量记录 ────────────────────────────────────────────────────────────

@dataclass
class SkillEntry:
    """扫描阶段（未加载 Python 模块）的 Skill 记录。

    名称和描述以 SKILL.md frontmatter 为唯一源。
    其他属性从 manifest.json 补充（不存在时使用默认值）。

    Attributes:
        name: Skill 名称（SKILL.md frontmatter name）。
        layer: 所属层级（'00_official' / '01_team' / '02_user' / '99_custom'）。
        path: Skill 源码目录绝对路径。
        manifest: 加载并校验后的 SkillManifest 实例。
        validation_error: 校验错误信息（None 表示无误）。
    """

    name: str
    layer: str
    path: Path
    manifest: SkillManifest
    validation_error: Optional[str] = None

    @property
    def priority(self) -> int:
        """层级优先级数值（数值越小优先级越高）。"""
        return LAYER_PRIORITY.get(self.layer, 999)

    @property
    def software(self) -> List[str]:
        """适用 DCC 软件标识列表。"""
        return self.manifest.software_dccs

    @property
    def primary_software(self) -> str:
        """首要适用 DCC 软件标识。"""
        return self.manifest.primary_dcc

    @property
    def version(self) -> str:
        """Skill 版本号。"""
        return self.manifest.version

    @property
    def display_name(self) -> str:
        """显示名称。"""
        return self.manifest.display_name or self.name

    @property
    def description(self) -> str:
        """Skill 描述（来自 SKILL.md frontmatter）。"""
        return self.manifest.description or ""


# ── SkillHub ──────────────────────────────────────────────────────────────────

class SkillHub:
    """Skill 运行时管理中心。

    负责扫描、加载、查询 Skill，并提供工具执行功能。

    初始化参数：
        - ``skills_root``: Skill 安装根目录（扁平结构）。
          默认 ``~/.artifexnexus/.openclaw/workspace/skills/``。
        - ``layer_sources``: 额外源码层级目录映射。
          ``{"00_official": Path("/project/skills/official"), "01_team": Path(...)}``。
          这些目录在 scan 时同时扫描。已安装的 Skill 自动归入对应层级。

    Skill 查找优先级：
        1. 先在 layer_sources（源码目录）中查找
        2. 再在 skills_root（已安装目录）中查找（默认归入 ``99_custom``）
        3. 同名 Skill 同一层级出现多个 → 后扫描的覆盖先扫描的（目录顺序）
        4. 同名 Skill 不同层级 → 按 LAYER_PRIORITY 选最高优先级

    使用示例::

        hub = SkillHub(
            skills_root=Path.home() / ".artifexnexus/.openclaw/workspace/skills",
            layer_sources={
                "00_official": Path("skills/official"),
                "02_user": Path.home() / ".artifexnexus/skills",
            },
        )
        hub.scan_all_skills()
        instance = hub.load_skill("my_skill")
        result = hub.execute_skill_tool("my_tool", {"arg1": "hello"})
    """

    def __init__(
        self,
        skills_root: Optional[Path] = None,
        layer_sources: Optional[Dict[str, Path]] = None,
    ) -> None:
        """初始化 SkillHub。

        :param skills_root: Skill 安装根目录。None 则使用默认路径。
        :param layer_sources: 额外源码层级目录映射。None 则只扫描 skills_root。
        """
        self._skills_root = Path(skills_root).expanduser().resolve() if skills_root else _DEFAULT_SKILLS_ROOT
        self._layer_sources: Dict[str, Path] = {}

        # 注册额外源码层级
        if layer_sources:
            for layer, p in layer_sources.items():
                resolved = Path(p).expanduser().resolve()
                if resolved.is_dir():
                    self._layer_sources[layer] = resolved
                else:
                    logger.debug("跳过层级 %s: 目录不存在 %s", layer, resolved)

        # 已安装目录自动归入最高自定义层级
        if self._skills_root.is_dir():
            self._layer_sources["99_custom"] = self._skills_root

        # name → 按优先级排序的 SkillEntry 列表（索引 0 优先级最高）
        self._entries: Dict[str, List[SkillEntry]] = {}

        # name → SkillInstance（已加载 Python 模块的 Skill）
        self._instances: Dict[str, SkillInstance] = {}

    @property
    def skills_root(self) -> Path:
        """Skill 安装根目录（只读）。"""
        return self._skills_root

    @property
    def layer_sources(self) -> Dict[str, Path]:
        """已注册的层级源码目录映射（只读）。"""
        return dict(self._layer_sources)

    # ── 扫描 ──────────────────────────────────────────────────────────────

    def scan_all_skills(self) -> int:
        """扫描所有层级目录，发现 Skill（以 SKILL.md 为识别标志）。

        每次调用会**清空**已有记录并重新扫描。

        扫描流程：
        1. 遍历 ``self._layer_sources`` 中每个层级的源目录
        2. 递归查找 ``SKILL.md``
        3. 跳过 ``templates/`` 目录（模板包含 TODO 占位符）
        4. 解析 SKILL.md YAML frontmatter 获取 name/description
        5. 尝试加载同目录 manifest.json 补充属性
        6. manifest.json 不存在或校验失败 → 构建合成 manifest（使用默认值）
        7. 校验失败不跳过，记录 validation_error 字段

        :return: 发现的 Skill 条目总数（去重前，含所有层级）。
        """
        self._entries.clear()
        self._instances.clear()  # 扫描时清空已加载实例
        total = 0

        for layer, source_dir in self._layer_sources.items():
            if not source_dir.is_dir():
                logger.debug("跳过层级 %s: %s 不存在", layer, source_dir)
                continue

            count = self._scan_layer(layer, source_dir)
            total += count
            logger.info("层级 %s: 发现 %d 个 Skill (%s)", layer, count, source_dir)

        # 对每个 name 按优先级排序（保证索引 0 是最高优先级）
        for name in self._entries:
            self._entries[name].sort(key=lambda e: e.priority)

        logger.info("扫描完成: 共发现 %d 个 Skill 条目（%d 个唯一名称）",
                     total, len(self._entries))
        return total

    # ── 查询 ──────────────────────────────────────────────────────────────

    def get_entry(self, name: str) -> Optional[SkillEntry]:
        """按名称查找 SkillEntry（不加载 Python 模块）。

        :param name: Skill 名称。
        :return: 优先级最高的 SkillEntry，未找到时返回 None。
        """
        entries = self._entries.get(name)
        if not entries:
            return None
        return entries[0]

    def list_entries(
        self,
        tags: Optional[List[str]] = None,
        software: Optional[str] = None,
        layer: Optional[str] = None,
    ) -> List[SkillEntry]:
        """按条件过滤 SkillEntry 列表。

        返回每个名称下优先级最高的 SkillEntry。

        :param tags: 按标签筛选（OR 匹配，任一标签命中即匹配）。
        :param software: 按适用软件筛选。
        :param layer: 按来源层级筛选。
        :return: 符合条件的 SkillEntry 列表（按名称排序）。
        """
        result: List[SkillEntry] = []

        for entries in self._entries.values():
            if not entries:
                continue

            # 指定了 layer → 从该层级取
            if layer is not None:
                candidates = [e for e in entries if e.layer == layer]
            else:
                candidates = [entries[0]]

            for entry in candidates:
                if tags is not None:
                    entry_tags = set(entry.manifest.tags or [])
                    if not any(t in entry_tags for t in tags):
                        continue
                if software is not None and software not in entry.software:
                    continue
                result.append(entry)

        result.sort(key=lambda e: e.name)
        return result

    # ── 加载 ──────────────────────────────────────────────────────────────

    def load_skill(self, name: str) -> Optional[SkillInstance]:
        """加载指定 Skill 的 Python 模块并构建 SkillInstance。

        如果已经加载过，直接返回缓存的 SkillInstance。

        加载流程：
        1. 从 ``_entries`` 查找 SkillEntry（需先 ``scan_all_skills()``）
        2. 检查 ``_instances`` 缓存（已加载直接返回）
        3. 构建模块导入路径（从 skills_root 或 layer_sources 计算）
        4. ``importlib.import_module`` 导入 ``__init__.py``
        5. walk 模块 ``__dict__`` 寻找 ``_artifex_skill_tool = True`` 标记的函数
        6. 构建 SkillInstance 并缓存

        :param name: Skill 名称。
        :return: SkillInstance，加载失败返回 None。
        """
        # 已缓存 → 直接返回
        if name in self._instances:
            return self._instances[name]

        # 查找 SkillEntry
        entry = self.get_entry(name)
        if entry is None:
            logger.warning("load_skill: Skill '%s' 未在扫描结果中找到", name)
            return None

        instance = self._do_load(entry)
        if instance is not None:
            self._instances[name] = instance
        return instance

    def get_instance(self, name: str) -> Optional[SkillInstance]:
        """获取已加载的 SkillInstance（不触发重新加载）。

        :param name: Skill 名称。
        :return: SkillInstance，未加载时返回 None。
        """
        return self._instances.get(name)

    # ── 工具执行 ──────────────────────────────────────────────────────────

    def execute_skill_tool(
        self,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        skill_name: Optional[str] = None,
    ) -> SkillToolResult:
        """执行指定 Tool。

        执行流程：
        1. 如果指定了 skill_name → 只在该 Skill 中查找
        2. 如果未指定 → 遍历所有已加载 Skill 查找第一个匹配
        3. 对每个候选 Skill 确保已加载（自动触发 load_skill）
        4. 找到 handler → 调用 → 返回 SkillToolResult

        :param tool_name: Tool 名称。
        :param arguments: Tool 参数（dict，可选）。
        :param skill_name: 指定 Skill 名称（可选，加速查找）。
        :return: SkillToolResult（成功或失败）。
        """
        args = arguments or {}

        # 指定 Skill → 精确查找
        if skill_name is not None:
            instance = self.load_skill(skill_name)
            if instance is None:
                return SkillToolResult.error(f"Skill '{skill_name}' 未找到")
            return self._invoke_handler(instance, tool_name, args, skill_name)

        # 未指定 Skill → 遍历所有已加载
        for name in self._entries:
            instance = self.load_skill(name)
            if instance is None:
                continue
            if instance.has_tool(tool_name):
                return self._invoke_handler(instance, tool_name, args, name)

        return SkillToolResult.error(
            f"Tool '{tool_name}' 在所有已加载的 Skill 中均未找到"
        )

    # ── 重载 ──────────────────────────────────────────────────────────────

    def reload_skills(self) -> int:
        """清空所有缓存并重新扫描 + 重新加载。

        :return: 重新扫描到的 Skill 总数。
        """
        self._instances.clear()
        return self.scan_all_skills()

    # ── 内部方法 ──────────────────────────────────────────────────────────

    def _scan_layer(self, layer: str, source_dir: Path) -> int:
        """扫描单个层级目录。

        以 ``SKILL.md`` 为发现标志（而非 manifest.json）。
        解析 SKILL.md YAML frontmatter 获取 name/description，
        manifest.json 作为补充属性源（不存在则构建合成 manifest）。

        :param layer: 层级名称。
        :param source_dir: 层级源目录。
        :return: 该层级发现的 Skill 数量。
        """
        count = 0

        try:
            for skill_md_path in source_dir.rglob("SKILL.md"):
                # 跳过模板目录
                if "templates" in skill_md_path.parts:
                    continue

                entry = self._build_skill_entry(layer, skill_md_path)
                if entry is not None:
                    self._entries.setdefault(entry.name, []).append(entry)
                    count += 1
        except OSError as exc:
            logger.error("扫描目录失败 (%s): %s", source_dir, exc)

        return count

    @staticmethod
    def _parse_skill_md_frontmatter(skill_md_path: Path) -> Optional[dict]:
        """解析 SKILL.md 的 YAML frontmatter。

        返回包含 ``name``、``description``、``metadata`` 等字段的 dict。
        解析失败返回 None。
        """
        try:
            text = skill_md_path.read_text(encoding="utf-8")
        except OSError:
            return None

        # 匹配 YAML frontmatter: ---\n...\n---
        m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        if not m:
            return None

        try:
            return yaml.safe_load(m.group(1)) or {}
        except yaml.YAMLError:
            return None

    def _build_skill_entry(
        self, layer: str, skill_md_path: Path
    ) -> Optional[SkillEntry]:
        """从 SKILL.md 构建 SkillEntry。

        流程：
        1. 解析 SKILL.md frontmatter → 获取 name/description
        2. 尝试加载同目录 manifest.json → 补充属性
        3. manifest.json 不存在 → validation_error="缺少 manifest.json"，合成最简 manifest
        4. 始终返回 SkillEntry（校验失败也返回，记录 validation_error）

        **数据源规则**（与 artclaw 格式标准对齐）：
        - name / description → 唯一源为 SKILL.md frontmatter
        - 其他所有字段 → 唯一源为 manifest.json
        - manifest.json 缺失 → 除 name/description 外全部留空/默认值

        :param layer: 所属层级。
        :param skill_md_path: SKILL.md 文件路径。
        :return: SkillEntry，无法解析 name 时返回 None。
        """
        skill_dir = skill_md_path.parent
        frontmatter = self._parse_skill_md_frontmatter(skill_md_path)

        # 必须有 frontmatter 且包含 name
        if not frontmatter or not frontmatter.get("name"):
            logger.warning("SKILL.md 缺少 name 字段: %s", skill_md_path)
            return None

        skill_name = str(frontmatter["name"]).strip()
        skill_description = str(frontmatter.get("description", "")).strip()

        validation_error: Optional[str] = None
        manifest: Optional[SkillManifest] = None

        # 尝试加载 manifest.json
        manifest_path = skill_dir / "manifest.json"
        if manifest_path.exists():
            manifest = load_manifest_model(manifest_path)
            if manifest is None:
                validation_error = "manifest.json 校验失败"
                logger.warning("manifest 校验失败: %s", manifest_path)
        else:
            # manifest.json 不存在 → 标记为格式问题
            validation_error = "缺少 manifest.json"
            logger.warning("缺少 manifest.json: %s", skill_dir)

        # 如果没有 manifest（或校验失败），构建最简合成 manifest
        # 只设置 name/description（来自 SKILL.md），其他字段留空/默认值
        if manifest is None:
            try:
                manifest = SkillManifest(
                    name=skill_name,
                    description=skill_description,
                )
            except Exception as exc:
                validation_error = (validation_error or "") + f"; 合成 manifest 失败: {exc}"
                logger.error("合成 manifest 失败 (%s): %s", skill_name, exc)
                # 用最简模型兜底
                manifest = SkillManifest(
                    name=skill_name,
                    description=skill_description,
                )
        else:
            # manifest 加载成功：用 SKILL.md 的 name/description 覆盖
            # （SKILL.md 是 name/description 的唯一源）
            manifest = manifest.model_copy(update={
                "name": skill_name,
                "description": skill_description,
            })

        return SkillEntry(
            name=skill_name,
            layer=layer,
            path=skill_dir.resolve(),
            manifest=manifest,
            validation_error=validation_error if validation_error else None,
        )

    def _do_load(self, entry: SkillEntry) -> Optional[SkillInstance]:
        """导入 Python 模块并构建 SkillInstance。

        导入策略：
        - 使用 ``importlib.util`` 动态加载（不污染 sys.modules 顶级命名空间）
        - 模块名使用 ``artifex_nexus_skill_{name}`` 格式以避免冲突
        - 加载失败捕获异常，记录到 SkillInstance.load_error

        :param entry: 要加载的 SkillEntry。
        :return: SkillInstance，加载失败时 load_error 字段非空。
        """
        skill_dir = entry.path
        init_file = skill_dir / entry.manifest.entry_point

        if not init_file.exists():
            logger.warning("入口文件不存在: %s", init_file)
            return SkillInstance(
                name=entry.name,
                manifest=entry.manifest,
                source_path=skill_dir,
                layer=entry.layer,
                load_error=f"入口文件不存在: {init_file}",
            )

        module_name = f"artifex_nexus_skill_{entry.name}"

        try:
            # 动态导入
            spec = importlib.util.spec_from_file_location(
                module_name,
                str(init_file),
            )
            if spec is None or spec.loader is None:
                raise ImportError(f"无法为 {init_file} 创建模块规范")

            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module  # 注册到 sys.modules 以支持相对导入
            spec.loader.exec_module(module)

            # 收集 @skill_tool 标记的函数
            tools = self._collect_tools_from_module(module)
            logger.debug(
                "Skill '%s' 加载成功: 发现 %d 个 Tool: %s",
                entry.name, len(tools), list(tools.keys()),
            )

            return SkillInstance(
                name=entry.name,
                manifest=entry.manifest,
                source_path=skill_dir,
                layer=entry.layer,
                tools=tools,
                loaded_module=module,
            )

        except Exception as exc:
            logger.warning("Skill '%s' 加载失败: %s", entry.name, exc)
            # 清理可能部分注册的模块
            sys.modules.pop(module_name, None)
            return SkillInstance(
                name=entry.name,
                manifest=entry.manifest,
                source_path=skill_dir,
                layer=entry.layer,
                load_error=str(exc),
            )

    @staticmethod
    def _collect_tools_from_module(module: ModuleType) -> Dict[str, Callable[..., Any]]:
        """从 Python 模块中收集所有 @skill_tool 标记的函数。

        通过 walk 模块 ``__dict__`` 查找 ``_artifex_skill_tool = True`` 标记。
        不使用全局 ``_TOOL_REGISTRY``，避免多 Skill 间的工具混淆。

        :param module: 已导入的 Python 模块。
        :return: ``{tool_name → callable handler}`` 映射。
        """
        tools: Dict[str, Callable[..., Any]] = {}
        for obj_name, obj in module.__dict__.items():
            if not callable(obj):
                continue
            if getattr(obj, "_artifex_skill_tool", False):
                tool_name = getattr(obj, "_artifex_skill_tool_name", obj_name)
                tools[tool_name] = obj
        return tools

    @staticmethod
    def _invoke_handler(
        instance: SkillInstance,
        tool_name: str,
        arguments: Dict[str, Any],
        skill_name: str,
    ) -> SkillToolResult:
        """调用 Tool handler 并返回 SkillToolResult。

        防御性设计：
        - 检查实例是否加载成功
        - 捕获 handler 执行异常 → SkillToolResult.error
        - handler 返回非 SkillToolResult → 自动包装为 SkillToolResult.success

        :param instance: SkillInstance。
        :param tool_name: Tool 名称。
        :param arguments: Tool 参数。
        :param skill_name: Skill 名称（用于错误消息）。
        :return: SkillToolResult。
        """
        if not instance.is_loaded:
            return SkillToolResult.error(
                f"Skill '{skill_name}' 未成功加载: {instance.load_error}"
            )

        handler = instance.get_tool_handler(tool_name)
        if handler is None:
            return SkillToolResult.error(
                f"Tool '{tool_name}' 在 Skill '{skill_name}' 中未找到"
            )

        try:
            result = handler(**arguments)
        except Exception as exc:
            logger.exception("Tool '%s' 执行异常", tool_name)
            return SkillToolResult.error(f"Tool '{tool_name}' 执行异常: {exc}")

        # handler 返回非 SkillToolResult → 自动包装
        if not isinstance(result, SkillToolResult):
            return SkillToolResult.success(result)
        return result
