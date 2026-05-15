---
id: STORY-0042
kind: story
title: M4-SDK-01 · @tool 装饰器 + Manifest + Version
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-15
updated: 2026-05-15
parent: "[[../backlog/EPIC-0004-m4-skill-system]]"
milestone: M4
related_adr: [0003, 0004]
related_docs:
  - "[[../../../docs/research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/platform/skill"
tags: [story, skill, sdk, decorator, manifest, version, M4]
---

# STORY-0042 · @tool 装饰器 + Manifest + Version

## 用户故事
开发者可以通过 `from artifex_nexus.skill import tool` 使用 `@tool` 装饰器声明 Skill 内的工具函数；系统能解析 SKILL.md frontmatter 为 pydantic v2 模型做校验。

## 验收标准

### @tool 装饰器
- [ ] `@tool(name=..., description=..., ...)` 装饰器可正常标记函数，生成 `ToolInfo`
- [ ] `ToolResult.success(data)` / `ToolResult.error(msg)` 返回类型可用
- [ ] 兼容别名 `@artclaw_tool` → `@tool`
- [ ] 类型标注自动转为 JSON Schema（基于 type hints）
- [ ] 无 UE skill_hub 回退逻辑（已移除）

### Manifest 模型
- [ ] `SkillManifest` pydantic v2 模型：name / version / description / author / tools / dependencies / min_software_version
- [ ] `ToolRef` pydantic v2 模型：声明 Skill 内包含的工具引用
- [ ] `SoftwareVersionConstraint` 模型：约束最小 DCC 版本
- [ ] `load_manifest(path)` 从 SKILL.md 解析 frontmatter → `SkillManifest`

### Version 解析
- [ ] `parse_version(v)` 解析 semver 字符串
- [ ] `version_compare(v1, v2)` 比较两个版本
- [ ] `version_gt / version_lt / version_eq` 便捷比较函数

### Events + Categories
- [ ] `SkillEvent` 枚举定义（INSTALLED / UNINSTALLED / ENABLED / DISABLED / UPDATED / ERROR）
- [ ] `categories.py` 复制自 artclaw_bridge，补充 Artifex Nexus 软件枚举

## 源文件对照

| 目标文件 | 源文件 (artclaw_bridge) | 适配量 |
|----------|------------------------|--------|
| `packages/platform/skill/src/artifex_nexus/skill/__init__.py` | 新写（门面） | 全写 |
| `packages/platform/skill/src/artifex_nexus/skill/decorator/core.py` | `core/skill_decorator.py` (192行) | **低** |
| `packages/platform/skill/src/artifex_nexus/skill/decorator/__init__.py` | 新写 | 全写 |
| `packages/platform/skill/src/artifex_nexus/skill/manifest/models.py` | `cli/artclaw_bridge/manifest.py` + `contracts/schemas/manifest.schema.json` | **中** |
| `packages/platform/skill/src/artifex_nexus/skill/manifest/loader.py` | `cli/artclaw_bridge/manifest.py` (§load_manifest) | **低** |
| `packages/platform/skill/src/artifex_nexus/skill/manifest/__init__.py` | 新写 | 全写 |
| `packages/platform/skill/src/artifex_nexus/skill/version/parser.py` | `core/version_manager.py` (§版本解析) | **低** |
| `packages/platform/skill/src/artifex_nexus/skill/version/__init__.py` | 新写 | 全写 |
| `packages/platform/skill/src/artifex_nexus/skill/categories.py` | `skills/categories.py` | **低** |
| `packages/platform/skill/src/artifex_nexus/skill/events.py` | 新写 | 全写 |

## 关键适配

- `@artclaw_tool` → `@tool`，同时保留 `@artclaw_tool` 别名
- `_artclaw_tool_standalone` → `tool`
- 路径：`~/.artclaw/` → `~/.artifexnexus/`
- 去 UE skill_hub 回退
- 加 `ToolResult` 类（success/error 工厂方法）

## 依赖
- → EPIC-0004（父）
- ← 无前置 STORY

## 非范围
- SkillHub 运行时加载/执行（→ STORY-0043）
- Registry 查询/匹配（→ STORY-0043）
- Memory 管理
