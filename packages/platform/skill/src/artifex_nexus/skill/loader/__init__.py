"""
loader — Skill 分层加载（已合并到 hub）

原 v2 计划 S14 的 loader 功能（scan_all_skills / load_skill）
已合并到 ``hub/core.py`` 的 SkillHub 中，本模块保留作为重导出：

    from artifex_nexus.skill.loader import SkillHub  # → hub.SkillHub
"""

from ..hub import SkillHub  # noqa: F401
