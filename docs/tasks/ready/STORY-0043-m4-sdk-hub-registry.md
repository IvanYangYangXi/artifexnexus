---
id: STORY-0043
kind: story
title: M4-SDK-02 · SkillHub + Registry + Conflict
status: ready
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-15
updated: 2026-05-16
parent: "[[../ready/EPIC-0004-m4-skill-system]]"
milestone: M4
related_adr: [0003, 0004]
related_docs:
  - "[[../../../docs/research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/platform/skill"
tags: [story, skill, sdk, hub, registry, conflict, M4]
---

# STORY-0043 · SkillHub + Registry + Conflict

## 用户故事
Skill 运行时能扫描工作区中的 Skill 目录，加载为 `SkillInstance`，并按优先级（official > marketplace）、版本约束进行最佳匹配。

## 验收标准

### SkillHub 运行时
- [ ] `SkillHub` 类复制自 `cli/artclaw_bridge/skill_hub.py`（去 artclaw_bridge.config 依赖）
- [ ] `scan_all_skills()` 扫描 `~/.artifexnexus/.openclaw/workspace/skills/` 下所有 SKILL.md
- [ ] `load_skill(path)` 解析 SKILL.md + 导入 `__init__.py` → `SkillInstance`
- [ ] `SkillInstance` dataclass（manifest + skill_tools dict + source_path + layer）
- [ ] `list_skills()` 返回所有已加载 Skill 列表
- [ ] `get_skill(name)` 按名称精确查询
- [ ] `execute_skill_tool(tool_name, args)` 调用 Skill 内 `@skill_tool` 函数并返回 `SkillToolResult`
- [ ] `reload_skills()` 清空缓存重新扫描

### SkillRegistry 查询/匹配
- [ ] `SkillRegistry` 类：组合 VersionManager 查询 + SkillHub 查询
- [ ] `matches_skill(request_name, available_skills)` 按名称+版本约束匹配
- [ ] `select_best_match(matches)` 按 LAYER_PRIORITY 选最优（official > marketplace）
- [ ] `search_skills(query)` 模糊搜索
- [ ] `LAYER_PRIORITY` 常量：`{"official": 0, "marketplace": 1, "user": 2}`

### 冲突检测
- [ ] `detect_layer_conflicts(skills)` 检测同层同名冲突
- [ ] `compare_skill_dirs(dir1, dir2)` 按版本+layer 比较优先级

## 源文件对照

| 目标文件 | 源文件 (artclaw_bridge) | 适配量 |
|----------|------------------------|--------|
| `packages/platform/skill/src/artifex_nexus/skill/hub/core.py` | `cli/artclaw_bridge/skill_hub.py` (400行) | **高** |
| `packages/platform/skill/src/artifex_nexus/skill/hub/instance.py` | 新写 | 全写 |
| `packages/platform/skill/src/artifex_nexus/skill/hub/executor.py` | `core/mcp_server.py` (§SkillToolCall / format_skill_tool_result) | **低** |
| `packages/platform/skill/src/artifex_nexus/skill/hub/__init__.py` | 新写 | 全写 |
| `packages/platform/skill/src/artifex_nexus/skill/registry.py` | `core/version_manager.py` + `cli/artclaw_bridge/skill_hub.py` | **高** |
| `packages/platform/skill/src/artifex_nexus/skill/conflict/detector.py` | `core/version_manager.py` (§冲突检测) | **低** |
| `packages/platform/skill/src/artifex_nexus/skill/conflict/__init__.py` | 新写 | 全写 |

## 关键适配

- `SkillHub` 去 `artclaw_bridge.config` 依赖 → 用 `SkillConfig`（→ STORY-0044）
- `VersionManager` 拆分为 `SkillRegistry` + `version.parser`
- `SkillData` → `SkillInfo`
- executor 去 MCP WebSocket 依赖，改为纯函数 `execute(tool_name, arguments) -> SkillToolResult`

## 依赖
- → EPIC-0004（父）
- ← STORY-0042（装饰器 + Manifest 模型必须可用）

## 非范围
- Skill 安装/卸载/同步（→ STORY-0044）
- Sidecar RPC 注册（→ STORY-0046）
- Memory 管理

## PM 决策（2026-05-16）

1. **版本函数去重**：`_parse_version_tuple` + `_compare_versions` 原在三处重复定义（`version/parser.py`、`registry.py`、`conflict/detector.py`）。
   经确认 `version/parser.py` 无任何 skill 子模块依赖 → 不存在循环导入。已统一为从 `version/parser.py` 导入，`registry.py`（-43 行）、`conflict/detector.py`（-56 行）。

2. **load_skill / execute_skill_tool 保留**：这些方法是给 DCC 内 AI 代码使用的 SDK 便利 API（OpenClaw AI 生成 `run_python` 代码后可在 DCC Python 环境内调用），
   Sidecar 管理路径只走 `scan_all_skills()`（manifest.json 扫描）。当前无外部调用者但设计合理，保留。

3. **下游 `nexus-tool.run` RPC 风险标注**：发现 STORY-0045（`run_nexus_tool` 验收标准）→ STORY-0046（`nexus-tool.run` RPC）→ STORY-0047（[▶ 运行] 按钮）
   构成了 Nexus-Tool 执行通过 sidecar RPC 的错误链路。已在 3 个下游 STORY 文件中添加 PM 标注，建议从 Sidecar RPC 中移除 `nexus-tool.run`。
