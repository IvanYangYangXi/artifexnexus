"""
registry.py — SkillRegistry 查询/匹配
========================================

从 artclaw_bridge ``core/version_manager.py`` 复制并适配：

- ``matches_software_version`` — 检查当前软件版本是否满足 manifest 的版本约束
- ``matches_skill`` — 检查 Skill manifest 是否与 DCC 软件+版本匹配
- ``version_distance`` — 计算版本匹配"距离"，用于从多个候选中选最优
- ``select_best_match`` — 从候选列表中选最佳匹配的 Skill

SkillRegistry 类组合 SkillHub 实例，提供更高层次的版本感知查询：
- 按软件+版本筛选
- 模糊搜索
- 最佳匹配选择
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from .categories import DCCEntry, software_value
from .conflict import LAYER_PRIORITY
from .hub.core import SkillEntry, SkillHub
from .manifest import SkillManifest
from .version.parser import compare_versions as _compare_versions, parse_version as _parse_version_tuple


# ═══════════════════════════════════════════════════════════════════════════════
# Skill 匹配函数（纯函数，无副作用）
# ═══════════════════════════════════════════════════════════════════════════════

def _extract_version_constraint(manifest: Any, dcc: str = "") -> Dict[str, str]:
    """从 manifest（dict 或 SkillManifest 实例）提取指定 DCC 的版本约束。

    :param manifest: manifest 字典或 SkillManifest 实例。
    :param dcc: 目标 DCC 标识，如 'blender'。空字符串表示取第一个 DCC 的约束。
    :return: {"min": "5.3", "max": "5.5"} 或 {}。
    """
    if isinstance(manifest, SkillManifest):
        if dcc:
            return manifest.get_version_constraint(dcc)
        # 无指定 DCC → 取第一个
        sw = manifest.software
        if sw:
            result: Dict[str, str] = {}
            if sw[0].min_version:
                result["min"] = sw[0].min_version
            if sw[0].max_version:
                result["max"] = sw[0].max_version
            return result
        return {}
    if isinstance(manifest, dict):
        # 新格式：software 是 DCCEntry 列表
        sw_list = manifest.get("software", [])
        if isinstance(sw_list, str):
            # 旧格式：software 是纯字符串（无版本约束）
            return {}
        if isinstance(sw_list, list) and sw_list:
            target = None
            if dcc:
                for item in sw_list:
                    if isinstance(item, dict) and item.get("dcc") == dcc:
                        target = item
                        break
            if target is None:
                target = sw_list[0] if isinstance(sw_list[0], dict) else {}
            r: Dict[str, str] = {}
            if target.get("minVersion"):
                r["min"] = str(target["minVersion"])
            if target.get("maxVersion"):
                r["max"] = str(target["maxVersion"])
            return r
        # 兼容旧 software_version 字段
        old_ver = manifest.get("software_version", {}) or {}
        return dict(old_ver)
    return {}


def _extract_software(manifest: Any) -> List[str]:
    """从 manifest 提取 software 字段（DCC 标识列表）。

    :return: DCC 标识字符串列表（如 ['blender', 'unreal_engine']）。
    """
    if isinstance(manifest, SkillManifest):
        return manifest.software_dccs
    if isinstance(manifest, dict):
        sw = manifest.get("software", [])
        if isinstance(sw, str):
            return [sw]
        if isinstance(sw, list):
            return [
                item.get("dcc", item) if isinstance(item, dict) else item
                for item in sw
            ]
        return []
    return []


def matches_software_version(
    constraint: Dict[str, str],
    current_version: str,
) -> bool:
    """检查当前软件版本是否满足 manifest.software_version 约束。

    约束格式：
        - ``{}``                               → 无约束，永远匹配
        - ``{"min": "5.3"}``                   → 版本 >= 5.3
        - ``{"max": "5.5"}``                   → 版本 <= 5.5
        - ``{"min": "5.3", "max": "5.5"}``     → 5.3 <= 版本 <= 5.5

    :param constraint: software_version 约束字典。
    :param current_version: 当前 DCC 版本字符串，如 ``"5.4.1"``。
    :return: True 表示满足约束。
    """
    if not constraint:
        return True
    min_v = constraint.get("min", "")
    max_v = constraint.get("max", "")
    if min_v and _compare_versions(current_version, min_v) < 0:
        return False
    if max_v and _compare_versions(current_version, max_v) > 0:
        return False
    return True


def matches_skill(
    manifest: Any,
    current_software: str,
    current_version: str,
) -> bool:
    """检查 Skill manifest 是否与当前 DCC 软件 + 版本匹配。

    匹配规则：
        1. ``manifest.software`` 中包含 "universal"，或者包含 ``current_software``
        2. 如果对应 DCC 有版本约束，当前版本必须在范围内

    :param manifest: SkillManifest 实例或 dict。
    :param current_software: 当前 DCC 软件标识，如 ``"unreal_engine"``。
    :param current_version: 当前软件版本字符串，如 ``"5.4.1"``。
    :return: True 表示匹配。
    """
    skill_software = _extract_software(manifest)
    # universal 匹配所有，或者当前 DCC 在列表中
    if "universal" not in skill_software and current_software not in skill_software:
        return False
    sw_ver = _extract_version_constraint(manifest, current_software)
    if sw_ver and not matches_software_version(sw_ver, current_version):
        return False
    return True


def version_distance(
    constraint: Dict[str, str],
    current_version: str,
) -> float:
    """计算版本"距离"，用于从多个候选 Skill 中选最精确匹配的。

    距离越小 = 版本范围越精确/越接近：
        - 无约束 ``{}``                      → ``1000.0``（最低优先级，最不精确）
        - 有范围 ``{min, max}``               → min 到 max 的分量差值之和
        - min == max（精确匹配）              → ``0.0``（最高优先级）
        - 只有 min 或只有 max               → 当前版本到该边界的距离

    :param constraint: software_version 约束字典。
    :param current_version: 当前 DCC 版本字符串。
    :return: 非负浮点数，越小匹配度越高。
    """
    if not constraint:
        return 1000.0

    min_v = constraint.get("min", "")
    max_v = constraint.get("max", "")

    if not min_v and not max_v:
        return 1000.0

    if min_v and max_v:
        # min 和 max 之间的"范围宽度"
        t_min = _parse_version_tuple(min_v)
        t_max = _parse_version_tuple(max_v)
        max_len = max(len(t_min), len(t_max))
        t_min = t_min + (0,) * (max_len - len(t_min))
        t_max = t_max + (0,) * (max_len - len(t_max))
        return float(sum(abs(a - b) for a, b in zip(t_min, t_max)))

    # 只有 min 或只有 max：当前版本到该边界的距离
    t_cur = _parse_version_tuple(current_version)
    t_ref = _parse_version_tuple(min_v or max_v)
    max_len = max(len(t_cur), len(t_ref))
    t_cur = t_cur + (0,) * (max_len - len(t_cur))
    t_ref = t_ref + (0,) * (max_len - len(t_ref))
    return float(sum(abs(a - b) for a, b in zip(t_cur, t_ref)))


def select_best_match(
    candidates: List[Any],
    current_software: str,
    current_version: str,
    manifest_key: Optional[Callable[[Any], Any]] = None,
) -> Optional[Tuple[int, Any]]:
    """从多个候选中选择最佳匹配（版本距离最小）。

    常用于：同名 Skill 有多个版本安装在不同目录时，选最匹配当前 DCC 版本的那个。

    选择策略：
        1. 先按 ``matches_skill`` 过滤（software + version 约束）
        2. 再按 ``version_distance`` 选距离最小的
        3. 完全匹配失败 → 返回 None

    :param candidates: 候选列表（manifest 字典或包含 manifest 的对象）。
    :param current_software: 当前 DCC 软件标识。
    :param current_version: 当前 DCC 版本字符串。
    :param manifest_key: 从候选元素提取 manifest 的函数，默认 ``lambda x: x``。
    :return: ``(index, best_candidate)``，未找到返回 None。
    """
    key = manifest_key or (lambda x: x)
    best_idx: Optional[int] = None
    best_item: Any = None
    best_dist: float = float("inf")

    for i, item in enumerate(candidates):
        m = key(item)
        if not matches_skill(m, current_software, current_version):
            continue
        dist = version_distance(_extract_version_constraint(m), current_version)
        if dist < best_dist:
            best_dist = dist
            best_idx = i
            best_item = item

    if best_idx is None:
        return None

    return best_idx, best_item


# ═══════════════════════════════════════════════════════════════════════════════
# SkillRegistry 类
# ═══════════════════════════════════════════════════════════════════════════════

class SkillRegistry:
    """Skill 注册表查询类。

    组合 SkillHub 实例，提供更高层次的版本感知查询功能。

    使用示例::

        registry = SkillRegistry(hub)
        matches = registry.find_matching("material_editor", "unreal_engine", "5.4.1")
        results = registry.search("material")
        best = registry.get_best_for_software("my_skill", "unreal_engine", "5.4.1")
    """

    def __init__(self, hub: SkillHub) -> None:
        """初始化 SkillRegistry。

        :param hub: 已初始化的 SkillHub 实例（需先 scan_all_skills()）。
        """
        self._hub = hub

    @property
    def hub(self) -> SkillHub:
        """关联的 SkillHub 实例。"""
        return self._hub

    def find_matching(
        self,
        name: str,
        current_software: str,
        current_version: str,
    ) -> Optional[SkillEntry]:
        """按名称查找最匹配当前软件版本的 Skill。

        在所有同名 Skill 候选中：
        1. 先按 ``matches_skill`` 过滤（software + 版本约束）
        2. 再按 ``version_distance`` 选版本距离最小的
        3. 距离相同时按 ``LAYER_PRIORITY`` 选层级优先级最高的

        :param name: Skill 名称。
        :param current_software: 当前 DCC 软件标识。
        :param current_version: 当前 DCC 版本字符串。
        :return: 最佳匹配的 SkillEntry，未找到返回 None。
        """
        entries = self._hub._entries.get(name)
        if not entries:
            return None

        # 先过滤版本匹配的
        matched = [
            e for e in entries
            if matches_skill(e.manifest, current_software, current_version)
        ]
        if not matched:
            return None

        # 按优先级 + 版本距离排序
        matched.sort(
            key=lambda e: (
                e.priority,
                version_distance(
                    _extract_version_constraint(e.manifest),
                    current_version,
                ),
            )
        )
        return matched[0]

    def list_by_software(
        self,
        current_software: str,
        current_version: str,
        tags: Optional[List[str]] = None,
    ) -> List[SkillEntry]:
        """列出当前 DCC 软件+版本下所有可用的 Skill。

        :param current_software: 当前 DCC 软件标识。
        :param current_version: 当前 DCC 版本字符串。
        :param tags: 可选，按标签进一步筛选（OR 匹配）。
        :return: 可用的 SkillEntry 列表。
        """
        result: List[SkillEntry] = []

        for entries in self._hub._entries.values():
            if not entries:
                continue
            entry = entries[0]  # 取优先级最高的
            if not matches_skill(entry.manifest, current_software, current_version):
                continue
            if tags is not None:
                entry_tags = set(entry.manifest.tags or [])
                if not any(t in entry_tags for t in tags):
                    continue
            result.append(entry)

        result.sort(key=lambda e: e.name)
        return result

    def search(
        self,
        query: str,
        current_software: Optional[str] = None,
        current_version: Optional[str] = None,
    ) -> List[SkillEntry]:
        """模糊搜索 Skill。

        搜索范围：
        - Skill 名称（name）
        - 显示名称（display_name）
        - 描述（description）
        - 标签（tags）

        :param query: 搜索关键词。
        :param current_software: 可选，按 DCC 软件过滤。
        :param current_version: 可选，按 DCC 版本过滤（需同时提供 software）。
        :return: 匹配的 SkillEntry 列表。
        """
        query_lower = query.lower()
        result: List[SkillEntry] = []

        for entries in self._hub._entries.values():
            if not entries:
                continue
            entry = entries[0]  # 取优先级最高的

            # 软件+版本过滤
            if current_software is not None and current_version is not None:
                if not matches_skill(entry.manifest, current_software, current_version):
                    continue

            # 文本搜索
            searchable = [
                entry.name,
                entry.display_name,
                entry.manifest.description or "",
                " ".join(entry.manifest.tags),
            ]
            if any(query_lower in text.lower() for text in searchable):
                result.append(entry)

        result.sort(key=lambda e: e.name)
        return result

    def get_best_for_software(
        self,
        name: str,
        current_software: str,
        current_version: str,
    ) -> Optional[SkillEntry]:
        """get_skill_for_software 的别名（语义更清晰）。

        :param name: Skill 名称。
        :param current_software: 当前 DCC 软件标识。
        :param current_version: 当前 DCC 版本字符串。
        :return: 最佳匹配的 SkillEntry，未找到返回 None。
        """
        return self.find_matching(name, current_software, current_version)

    def has_skill(self, name: str) -> bool:
        """检查指定名称的 Skill 是否存在。

        :param name: Skill 名称。
        :return: True 表示存在。
        """
        return self._hub.get_entry(name) is not None

    def list_all(self) -> List[SkillEntry]:
        """列出所有 Skill（每个名称取最高优先级）。"""
        return self._hub.list_entries()
