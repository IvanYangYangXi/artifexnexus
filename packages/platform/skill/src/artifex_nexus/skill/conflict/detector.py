"""
conflict/detector.py — Skill 冲突检测与版本同步对比
=======================================================

从 artclaw_bridge ``core/version_manager.py`` 原样复制并适配：

- ``compare_skill_dirs`` — 文件级 MD5 哈希对比，精确判断同步状态
- ``detect_layer_conflicts`` — 分层 Skill 库中的命名冲突检测

版本管理策略（已验证）：
    **第一层判断：文件哈希**
    计算已安装目录和源码目录中所有 .py/.md/.json 文件的 MD5 哈希：
    - 哈希完全一致 → ``SYNCED``（内容相同，包括元数据）
    - 哈希有差异 → 进入第二层判断

    **第二层判断：mtime 变更方向**
    对每个哈希不同的文件，用 mtime 判断哪侧更新：
    - 只有源码侧更新 → ``SOURCE_NEWER``（建议安装/更新）
    - 只有安装侧更新 → 结合第三层版本号判断
    - 两侧都更新 → ``CONFLICT``（需人工处理）

    **第三层判断：manifest.version 辅助确认**
    当 mtime 显示安装侧更新时：
    - 安装侧版本号 > 源码侧 → ``INSTALLED_NEWER``（建议发布）
    - 否则 → ``MODIFIED``（本地有未发布的改动）

    边缘情况：
    - 源码目录不存在 → ``NO_SOURCE``
    - 文件既有增加又有删除，只看方向 → 两侧都有则 CONFLICT
    - pycache/.pyc 自动排除，不计入哈希
    - JSON 解码失败 / I/O 异常 → 防御性返回空字符串，不崩溃

冲突检测策略：
    - 分层库：同一 Skill 名出现在多个 layer → 按 LAYER_PRIORITY 自动选生效层
    - 低优先级层被"覆盖"（shadowed），仍然记录但不会被使用
    - 这是**暴力策略**：不询问用户，自动选最高优先级
    - compare_skill_dirs 对比的"覆盖安装"决策由上层（SkillInstaller）调用方负责
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..version.parser import compare_versions as _compare_versions, parse_version as _parse_version_tuple


# ═══════════════════════════════════════════════════════════════════════════════
# 层级优先级常量
# ═══════════════════════════════════════════════════════════════════════════════

LAYER_PRIORITY: Dict[str, int] = {
    "00_official": 0,
    "01_team": 1,
    "02_user": 2,
    "99_custom": 99,
}
"""层级名 → 优先级数值，数值越小优先级越高。

层级说明：
- ``00_official`` — 官方维护的 Skill，随 Artifex Nexus 发布
- ``01_team`` — 团队共享的 Skill，存储在项目仓库中
- ``02_user`` — 用户个人安装/创建的 Skill
- ``99_custom`` — 运行时临时/实验性 Skill

同名 Skill 在不同层级出现时，数值最小的层级生效。
"""


# ═══════════════════════════════════════════════════════════════════════════════
# 同步状态枚举
# ═══════════════════════════════════════════════════════════════════════════════

class SyncState(str, Enum):
    """compare_skill_dirs 返回的 7 种同步状态。

    .. list-table:: 状态决策矩阵
       :header-rows: 1

       * - 状态
         - 含义
         - 触发条件
         - 推荐操作
       * - ``SYNCED``
         - 完全一致
         - 所有文件 MD5 哈希完全相同
         - 无需操作
       * - ``SOURCE_NEWER``
         - 源码更新
         - 只有源码侧文件有变化（无冲突）
         - 用源码覆盖安装
       * - ``INSTALLED_NEWER``
         - 安装版本更新
         - 安装侧版本 > 源码侧版本
         - 可发布到源码
       * - ``MODIFIED``
         - 本地有未发布改动
         - 内容不同但版本号相同，且安装侧时间更新
         - 先发布再覆盖，或手动检查
       * - ``CONFLICT``
         - 双向冲突
         - 源码和安装两侧都有各自的修改
         - 必须人工处理
       * - ``NO_SOURCE``
         - 找不到源码
         - 源码目录不存在
         - 无法同步（只读状态）
       * - ``NOT_INSTALLED``
         - 未安装
         - installed_dir 不存在
         - 首次安装
    """

    SYNCED = "synced"
    SOURCE_NEWER = "source_newer"
    INSTALLED_NEWER = "installed_newer"
    MODIFIED = "modified"
    CONFLICT = "conflict"
    NO_SOURCE = "no_source"
    NOT_INSTALLED = "not_installed"


# ═══════════════════════════════════════════════════════════════════════════════
# 对比结果数据类
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class SyncStatus:
    """compare_skill_dirs 的返回值。

    包含同步状态的完整信息，供上层（SkillInstaller、UI）做决策。

    Attributes:
        state: 同步状态的最终判定。
        changed_files: 发生变更的文件相对路径列表（相对于 Skill 目录根）。
            如 ``["__init__.py", "manifest.json"]``。
        source_version: 源码目录的 manifest.version 值（可能为 None）。
        installed_version: 安装目录的 manifest.version 值（可能为 None）。
        skill_name: Skill 名称（来自目录名，非 manifest.name）。
    """

    state: SyncState
    changed_files: List[str] = field(default_factory=list)
    source_version: Optional[str] = None
    installed_version: Optional[str] = None
    skill_name: str = ""

    @property
    def has_changes(self) -> bool:
        """是否有文件变更（非 SYNCED）。"""
        return self.state != SyncState.SYNCED

    @property
    def can_sync(self) -> bool:
        """是否可以通过安装/发布操作解决（非 CONFLICT / NO_SOURCE）。"""
        return self.state not in (SyncState.CONFLICT, SyncState.NO_SOURCE)

    @property
    def needs_manual_resolution(self) -> bool:
        """是否需要人工介入。"""
        return self.state == SyncState.CONFLICT


@dataclass
class LayerConflict:
    """分层 Skill 库中的命名冲突信息。

    Attributes:
        skill_name: 冲突的 Skill 名称。
        layers: 所有包含此 Skill 的层级列表（按 LAYER_PRIORITY 排序）。
        active_layer: 实际生效的层级（优先级最高的那个）。
        shadowed_layers: 被覆盖的层级列表（优先级较低的）。
    """

    skill_name: str
    layers: List[str]
    active_layer: str
    shadowed_layers: List[str]


# ═══════════════════════════════════════════════════════════════════════════════
# 文件哈希工具函数
# ═══════════════════════════════════════════════════════════════════════════════

def _file_hash(path: Path) -> str:
    """计算单个文件的 MD5 哈希值。

    MD5 选型理由：
        - 版本对比场景不需要抗碰撞性（不是安全场景）
        - 速度快（~300MB/s），适合批量文件对比
        - hash 一致 → 内容绝对一致（MD5 碰撞在自然文件中概率可忽略）

    :param path: 文件路径。
    :return: 32 字符的小写十六进制哈希字符串。I/O 异常时返回空字符串。
    """
    try:
        return hashlib.md5(path.read_bytes()).hexdigest()
    except Exception:
        return ""


def _dir_hashes(root: Path) -> Dict[str, str]:
    """计算目录中所有可对比文件的 MD5 哈希。

    只对 ``.py`` / ``.md`` / ``.json`` 后缀的文件计算哈希。
    这涵盖了 Skill 的所有可对比内容：
    - .py  → Skill/Tool 实现代码
    - .md  → SKILL.md / README 等文档
    - .json → manifest.json / 数据文件

    排除项（不参与对比）：
    - 子目录（只哈希文件，目录通过文件间接体现）
    - ``__pycache__/`` 及其内容（编译产物，非源码）
    - ``.pyc`` 文件（同上）
    - 其他后缀（.png/.blend 等资源文件，太大了不哈希）

    :param root: 要扫描的目录根路径。不存在时返回空字典。
    :return: ``{相对路径: md5_hash}``，相对路径使用 ``/`` 分隔符（跨平台一致）。
    """
    result: Dict[str, str] = {}
    if not root.exists():
        return result

    for p in sorted(root.rglob("*")):
        # 跳过目录
        if p.is_dir():
            continue
        # 只对比 .py / .md / .json
        if p.suffix not in {".py", ".md", ".json"}:
            continue
        # 构建相对路径（统一用 /，跨平台一致）
        rel = str(p.relative_to(root)).replace("\\", "/")
        # 排除编译缓存
        if "__pycache__" in rel or rel.endswith(".pyc"):
            continue
        result[rel] = _file_hash(p)

    return result


def _extract_version_from_dir(skill_dir: Path) -> Optional[str]:
    """从 Skill 目录提取版本号。

    提取顺序：
    1. manifest.json 的 ``version`` 字段（优先，这是规范定义的版本号）
    2. SKILL.md frontmatter 的 ``version:`` 行（兜底，兼容旧格式）

    注意：
        - manifest.json 中的版本号是**规范定义的唯一版本号**，优先使用
        - SKILL.md 作为兜底只用于兼容没有 manifest.json 的旧 Skill 包
        - 新旧 Skill 的 transition 期允许两种格式并存，但不推荐

    :param skill_dir: Skill 目录路径。
    :return: 版本号字符串（如 ``"1.2.3"``），提取失败返回 None。
    """
    # 优先 manifest.json（规范路径）
    manifest_path = skill_dir / "manifest.json"
    if manifest_path.exists():
        try:
            v = json.loads(manifest_path.read_text(encoding="utf-8")).get("version", "")
            if v:
                return str(v)
        except Exception:
            pass  # JSON 损坏/权限问题 → 回退到 SKILL.md

    # 兜底 SKILL.md frontmatter（兼容旧格式）
    skill_md = skill_dir / "SKILL.md"
    if skill_md.exists():
        try:
            content = skill_md.read_text(encoding="utf-8")
            # 匹配 frontmatter 中的 version: 字段
            # 格式：version: "1.2.3" 或 version: 1.2.3
            m = re.search(r'^version\s*:\s*(.+)$', content, re.MULTILINE)
            if m:
                return m.group(1).strip().strip("\"'")
        except Exception:
            pass

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# 核心对比函数 — compare_skill_dirs
# ═══════════════════════════════════════════════════════════════════════════════

def compare_skill_dirs(
    installed_dir: Path,
    source_dir: Path,
) -> SyncStatus:
    """比较已安装 Skill 目录与源码目录，返回同步状态。

    这是版本管理系统的核心函数。上层（SkillInstaller / UI）根据返回的
    SyncStatus 决定后续操作。

    **完整判断流程（三层递进）**：

    第 0 层 — 特殊状态快速返回：
        - source_dir 不存在 → ``NO_SOURCE``
        - installed_dir 不存在 → ``NOT_INSTALLED``

    第 1 层 — 文件哈希等值判断：
        计算 installed_dir 和 source_dir 中所有 .py/.md/.json 文件的 MD5 哈希
        → 构建两个 ``{relpath: md5}`` 字典
        → 字典完全相同时 → ``SYNCED``（最快路径，绝大多数情况的常态）

    第 2 层 — 文件级变更方向判断：
        对哈希不同的文件逐文件分析：
        - 文件只在 source 有（installed 无） → src_ahead = True
        - 文件只在 installed 有（source 无） → inst_ahead = True
        - 文件两边都有但哈希不同 → 用 **文件修改时间 (mtime)** 判断：
            * mtime(source) > mtime(installed) → src_ahead = True
            * mtime(installed) > mtime(source) → inst_ahead = True
            * mtime 相等（极罕见）→ 两侧都标记 ahead（退化为 CONFLICT）

    第 3 层 — 版本号辅助确认 + 状态归类：
        - 两侧都 ahead → ``CONFLICT``（双向修改）
        - 只有 source ahead → ``SOURCE_NEWER``（建议安装）
        - 只有 installed ahead：
            * installed.version > source.version → ``INSTALLED_NEWER``（可发布）
            * 否则 → ``MODIFIED``（本地改动但版本号未更新）
        - 两侧都不 ahead（exists 但 hash 不同，极其边缘） → ``MODIFIED``

    边缘情况处理：
        - 文件在两边都不存在？不会发生（从 all_files 的并集生成，必定至少一方存在）
        - I/O 异常 → 该文件的 hash 返回 "" → 与另一侧对比必然不同 → 触发 mtime 判断
        - mtime 不可用 → ``inst_ahead = src_ahead = True`` → 退化为 ``CONFLICT``（安全原则）
        - 所有文件都被 __pycache__/.pyc 过滤掉 → hashes_inst == hashes_src == {} → SYNCED

    :param installed_dir: 已安装 Skill 的目录路径（如 ~/.artifexnexus/.openclaw/workspace/skills/my_skill/）。
    :param source_dir: 源码目录路径（如项目的 skills/official/my_skill/）。
    :return: SyncStatus 实例，包含状态、变更文件列表、版本号。

    使用示例::

        status = compare_skill_dirs(
            installed_dir=Path.home() / ".artifexnexus/.openclaw/workspace/skills/my_skill",
            source_dir=Path("skills/official/my_skill"),
        )
        if status.state == SyncState.SOURCE_NEWER:
            print(f"建议更新：{status.skill_name} {status.installed_version} → {status.source_version}")
        elif status.state == SyncState.CONFLICT:
            print(f"冲突：{status.skill_name} 两端都有修改")
    """
    skill_name = installed_dir.name
    inst_ver = _extract_version_from_dir(installed_dir)

    # ── 第 0 层：特殊状态快速返回 ───────────────────────────────────────
    if not source_dir or not source_dir.exists():
        return SyncStatus(
            state=SyncState.NO_SOURCE,
            skill_name=skill_name,
            installed_version=inst_ver,
        )

    src_ver = _extract_version_from_dir(source_dir)

    # ── 第 1 层：计算文件哈希 ──────────────────────────────────────────
    hashes_inst = _dir_hashes(installed_dir)
    hashes_src = _dir_hashes(source_dir)

    # 哈希字典完全一致 → 内容完全同步
    if hashes_inst == hashes_src:
        return SyncStatus(
            state=SyncState.SYNCED,
            skill_name=skill_name,
            installed_version=inst_ver,
            source_version=src_ver,
        )

    # ── 第 2 层：文件级变更方向判断 ────────────────────────────────────
    # all_files = 两边文件名的并集（确保新增/删除文件都被检测到）
    all_files = set(hashes_inst.keys()) | set(hashes_src.keys())
    changed: List[str] = []
    inst_ahead = False   # 安装侧是否有变更
    src_ahead = False    # 源码侧是否有变更

    for f in sorted(all_files):
        h_inst = hashes_inst.get(f, "")
        h_src = hashes_src.get(f, "")
        # 哈希相同 → 跳过（应是进入第 2 层之前已经排除的）
        if h_inst == h_src:
            continue

        changed.append(f)

        # 文件只存在于一侧 → 该侧有"变更"
        if not h_inst:
            # 安装侧没有 → 源码有新增文件
            src_ahead = True
        elif not h_src:
            # 源码侧没有 → 安装侧有新增文件 / 源码删除了文件
            inst_ahead = True
        else:
            # 两边都有但哈希不同 → 用 mtime 判断谁更新
            try:
                mt_inst = (installed_dir / f).stat().st_mtime
                mt_src = (source_dir / f).stat().st_mtime
                if mt_src > mt_inst:
                    src_ahead = True
                elif mt_inst > mt_src:
                    inst_ahead = True
                else:
                    # mtime 完全相同（极罕见，如 1 秒内两次修改）
                    # 保守处理：标记为双方都有变更 → 退化为 CONFLICT
                    inst_ahead = src_ahead = True
            except Exception:
                # 文件被删除 / 权限不足 / 其他 I/O 错误
                # 保守处理：标记为双方都有变更
                inst_ahead = src_ahead = True

    # ── 第 3 层：版本号辅助确认 + 状态归类 ────────────────────────────
    if inst_ahead and src_ahead:
        # 两侧都有修改 → 冲突，需要人工介入
        state = SyncState.CONFLICT
    elif src_ahead:
        # 只有源码侧更新 → 建议用源码覆盖安装
        state = SyncState.SOURCE_NEWER
    elif inst_ahead:
        # 只有安装侧更新 → 需要版本号辅助判断
        #   - installed.version > source.version → 安装端做了版本递增 → 可发布
        #   - 版本号相同或无法比较 → 本地有未发布的改动 → MODIFIED
        if inst_ver and src_ver and _compare_versions(inst_ver, src_ver) > 0:
            state = SyncState.INSTALLED_NEWER
        else:
            state = SyncState.MODIFIED
    else:
        # 两边都不 ahead：文件存在但哈希不同，但 mtime 也没给出明确方向
        # 极边缘情况：所有文件的 mtime 读取都失败
        state = SyncState.MODIFIED

    return SyncStatus(
        state=state,
        changed_files=changed,
        skill_name=skill_name,
        installed_version=inst_ver,
        source_version=src_ver,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 层冲突检测
# ═══════════════════════════════════════════════════════════════════════════════

def detect_layer_conflicts(
    layer_skills: Dict[str, List[str]],
) -> List[LayerConflict]:
    """检测分层 Skill 库中的命名冲突。

    工作流程：
    1. 遍历每个 layer 的 Skill 名称列表
    2. 构建 ``{skill_name → [出现在哪些 layer]}`` 的映射
    3. 对出现在多个 layer 的 Skill，按 ``LAYER_PRIORITY`` 排序
    4. 最高优先级的 layer 为 ``active_layer``，其余为 ``shadowed_layers``

    注意：
        - 这是全自动检测，不询问用户
        - 覆盖决策由调用方根据冲突信息自行处理
        - 同层冲突（同一 layer 内两个同名 Skill）不在此检测范围内
          （安装时由 SkillInstaller 检查）

    :param layer_skills: ``{layer_name → [skill_name, ...]}`` 的映射。
        例如::

            {
                "00_official": ["material_editor", "batch_rename"],
                "02_user": ["material_editor"],
            }

    :return: LayerConflict 列表，只有在多 layer 出现时才产生条目。

    使用示例::

        conflicts = detect_layer_conflicts({
            "00_official": ["skill_a", "skill_b"],
            "02_user": ["skill_a", "skill_c"],
        })
        # → [LayerConflict(
        #     skill_name="skill_a",
        #     layers=["00_official", "02_user"],
        #     active_layer="00_official",
        #     shadowed_layers=["02_user"],
        # )]
        for c in conflicts:
            print(f"注意：{c.skill_name} 的 {c.active_layer} 版本覆盖了 {c.shadowed_layers}")
    """
    # 构建 skill_name → [layers] 反向索引
    skill_to_layers: Dict[str, List[str]] = {}
    for layer, skills in layer_skills.items():
        for s in skills:
            skill_to_layers.setdefault(s, []).append(layer)

    conflicts: List[LayerConflict] = []
    for skill_name, layers in skill_to_layers.items():
        # 只检测出现在多个层级的情况
        if len(layers) < 2:
            continue

        # 按 LAYER_PRIORITY 排序（数值越小优先级越高）
        sorted_layers = sorted(layers, key=lambda l: LAYER_PRIORITY.get(l, 99))
        active = sorted_layers[0]
        shadowed = sorted_layers[1:]

        conflicts.append(LayerConflict(
            skill_name=skill_name,
            layers=sorted_layers,
            active_layer=active,
            shadowed_layers=shadowed,
        ))

    return conflicts
