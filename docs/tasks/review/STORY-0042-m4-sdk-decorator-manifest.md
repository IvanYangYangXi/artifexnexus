---
id: STORY-0042
kind: story
title: M4-SDK-01 · @skill_tool 装饰器 + Manifest + Version
status: review
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
tags: [story, skill, sdk, decorator, manifest, version, M4]
---

# STORY-0042 · @skill_tool 装饰器 + Manifest + Version

## 用户故事
开发者可以通过 `from artifex_nexus.skill import skill_tool` 使用 `@skill_tool` 装饰器声明 Skill 内的工具函数；系统能解析 SKILL.md frontmatter 为 pydantic v2 模型做校验。

## 验收标准

### @skill_tool 装饰器
- [ ] `@skill_tool(name=..., description=..., ...)` 装饰器可正常标记函数，生成 `SkillToolInfo`
- [ ] `SkillToolResult.success(data)` / `SkillToolResult.error(msg)` 返回类型可用
- [ ] 兼容别名 `@artclaw_tool` → `@skill_tool`
- [ ] 类型标注自动转为 JSON Schema（基于 type hints）
- [ ] 无 UE skill_hub 回退逻辑（已移除）

### Manifest 模型
- [ ] `SkillManifest` pydantic v2 模型：name / version / description / author / skill_tools / dependencies / min_software_version
- [ ] `SkillToolRef` pydantic v2 模型：声明 Skill 内包含的工具引用
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

- `@artclaw_tool` → `@skill_tool`，同时保留 `@artclaw_tool` 别名
- `_artclaw_tool_standalone` → `skill_tool`
- 路径：`~/.artclaw/` → `~/.artifexnexus/`
- 去 UE skill_hub 回退
- 加 `SkillToolResult` 类（success/error 工厂方法）

## 依赖
- → EPIC-0004（父）
- ← 无前置 STORY

## 非范围
- SkillHub 运行时加载/执行（→ STORY-0043）
- Registry 查询/匹配（→ STORY-0043）
- Memory 管理

## PM 决策（2026-05-16）

1. **namespace 隔离**：OpenClaw 只看到 ``run_python``（MCP bridge 工具名为 ``mcp_{server}_run_python``），看不到 Skill 内部 skill_tool 名。
   Hub 已通过 ``_collect_tools_from_module()`` 逐 Skill 模块 walk 属性实现了 per-Skill skill_tools dict 隔离，全局 ``_TOOL_REGISTRY`` 是死代码——已移除。

2. **SkillToolInfo 定义**：作为公共 API 类型在 ``hub/instance.py`` 定义轻量 dataclass（name / description / category / risk_level / input_schema）。
   与 ``SkillInstance.skill_tools``（存 callable handler）分工：SkillToolInfo 面向用户/Frontend 查询，handler 是运行内部细节。

3. **死代码清理**：移除 ``_TOOL_REGISTRY`` 全局 dict、``get_registered_tools()``、``is_tool()``、``get_tool_name()``、``_ue_agent_tool/``_ue_agent_tool_name`` 标记。
   仅保留 Hub 实际使用的 ``_artifex_tool`` / ``_artifex_tool_name`` 标记。

## PM 决策（2026-05-27）— 双轨装饰器

4. **双轨装饰器体系（不可统一）**：
   - **Platform SkillHub** 扫描 ``_artifex_skill_tool`` 标记 → 使用 `@skill_tool`
   - **UE SkillHub**（``skill_hub.py``）扫描 ``_ue_agent_tool`` 标记 → 使用 `@ue_tool`
   - 两个 Hub 发现机制互相隔离，`@skill_tool` 在 UE 中不可用，反之亦然
   - **Blender/Maya/Max 等 DCC** 无 SkillHub（仅 MCP Server），面向这些 DCC 的 Skill 应为纯知识型（无 `__init__.py`）

5. **合规检查器同步更新**：
   - Skill 合规检查器的 `_check_init_py` 增加 DCC 装饰器白名单（`@ue_tool` / `@tool` / `@artclaw_tool`）
   - 新增 software-装饰器一致性检查：UE + `@skill_tool` → error；非 UE + `@ue_tool` → warning；无 SkillHub DCC + `@skill_tool` → warning

6. **文档同步**：`docs/specs/skill-system.md` §2-3、`docs/development/skill-authoring/README.md`、`nexus-skill-manage SKILL.md` 均已更新为双轨描述
