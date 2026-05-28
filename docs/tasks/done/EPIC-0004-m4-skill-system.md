---
id: EPIC-0004
kind: epic
title: M4 · Skill 系统
status: done
priority: P1
owner: "@ivan"
assignee: pair
estimate: 3w
created: 2026-05-04
updated: 2026-05-28
completed: 2026-05-28
parent: "[[../../vision/roadmap]]"
milestone: M4
related_adr: [0003, 0004]
related_specs:
  - "[[../../specs/skill-system]]"
related_packages:
  - "packages/platform/skill"
  - "packages/platform/core"
  - "packages/dcc/shared/artifex_nexus_sdk"
  - "packages/apps/web"
  - "packages/adapters/openclaw/wrapper"
tags: [epic, skill, M4, done]
---

# M4 · Skill 系统 ✅ DONE

## 背景与目标

落地 `packages/platform/skill/`（hub / registry / loader / installer / conflict / version / manifest / decorator）
并在 Web UI 里提供安装 / 启停 / 调用面板。

## 实际交付（超出原计划）

### 核心 Skill 子系统（packages/platform/skill/）

| 模块 | 功能 | 状态 |
|------|------|------|
| `decorator/` | `@skill_tool` 装饰器（唯一源）、`@artclaw_tool`（兼容别名）、参数 Schema 推断、SkillToolResult | ✅ |
| `manifest/` | `SkillManifest`（Pydantic v2）、`load_manifest_model`、manifest_fixer、双格式支持（manifest.json + SKILL.md frontmatter） | ✅ |
| `loader/` | 分层加载器（`00_official > 01_team > 02_user > 99_custom`） | ✅ |
| `version/` | `parse_version`、`compare_versions`、Semver 版本比较 | ✅ |
| `hub/` | `SkillHub`、`SkillEntry`、`SkillInstance`、`SkillToolInfo`、运行时发现+执行 | ✅ |
| `conflict/` | `LayerConflict`、`SyncState`、多层命名冲突检测 | ✅ |
| `registry/` | `SkillRegistry`：查询/匹配/最佳版本选择 | ✅ |
| `installer/` | `SkillInstaller`：全生命周期（install/publish/sync/uninstall/enable/disable）、InstallResult/SyncResult/PublishResult | ✅ |
| `nexus_tool/` | `NexusToolRegistry`、`NexusToolInstaller`、`NexusToolData`、`scan_nexus_tools`、DCCEntry | ✅ |
| `events/` | `SkillEvent` 枚举（14 个生命周期事件） | ✅ |
| `categories/` | `Software`、`RiskLevel` 枚举，从 `categories.json` 单源读取 | ✅ |

### DCC 共享 SDK SkillHub

- 共享核心：`packages/dcc/shared/artifex_nexus_sdk/skill_hub.py` + `skill_manifest.py`
- UE 独立实现（因需 `unreal.DirectoryWatcher`）
- 启动流程：MCP Server 启动 → `_init_skill_hub()` → `scan_and_register()` → `start_watching()`
- AI 调用入口：`get_skill_hub().execute_skill(name, params)`

### Sidecar RPC 层

- `skill_rpc.py`：Skill 管理 RPC（安装/卸载/启用/禁用/查询/执行）
- `nexus_tool_rpc.py`：Nexus-Tool 执行 RPC
- `trigger_dispatcher.py`：触发规则分发

### Skills 内容覆盖（66 个）

| 分类 | 数量 | 软件 |
|------|------|------|
| 官方 Skills | 5 个 | 通用（agent-guide/skill-manage/tool-creator/tool-executor/node-graph） |
| UE Skills | 18 个 | Unreal Engine 5 + 5.7 |
| ComfyUI Skills | 14 个 | txt2img/img2img/inpainting/controlnet/workflow 全流程 |
| SD Skills | 9 个 | Substance Designer |
| SP Skills | 4 个 | Substance Painter |
| Blender Skills | 5 个 | Blender 上下文/材质/操作 |
| Houdini Skills | 4 个 | Houdini 节点/模拟 |
| Unity Skills | 5 个 | Unity 资产/组件/场景 |
| Maya/Max Skills | 各 1 个 | 操作规则 |

### Web UI 集成

- SkillsPage：完整浏览/过滤/安装/发布界面
- FiltersTab / ItemCard / TagEditor / PublishConfirmDialog / RunPanel
- SkillDetailPanel：详情查看
- 与 @artifex-nexus/ui 完全集成

## 子节点（STORY 列表，全部完成）

| # | STORY | 状态 |
|---|-------|------|
| S1 | STORY-0042 — @skill_tool 装饰器 + Manifest + Version | ✅ done |
| S2 | STORY-0043 — SkillHub + Registry + Conflict | ✅ done |
| S3 | STORY-0044 — SkillInstaller + Loader + Config | ✅ done |
| S4 | STORY-0045 — NexusToolRegistry + NexusToolInstaller | ✅ done |
| S5 | STORY-0046 — Sidecar RPC（Skill/Nexus-Tool 方法） | ✅ done |
| S6 | STORY-0047 — Web UI 接线 | ✅ done |
| S7 | STORY-0048 — Skill/Nexus-Tool 内容迁移 | ✅ done |

## 进展日志

- 2026-05-28 **标记完成**：全量对照代码确认，Skill 子系统完整，66 个 Skills 跨 11 种软件
- 2026-05-15 align 完成
- 2026-05-04 created
