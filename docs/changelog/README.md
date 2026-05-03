---
tags: [changelog, index]
created: 2026-05-02
---

# Changelog

> 与 git tag 对齐的用户可见 changelog。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

## [Unreleased]

### Added
- Monorepo 脚手架：pnpm + Turbo + uv workspace
- 包分层：`packages/{platform,adapters,dcc,apps}/...`
- Obsidian Vault：`docs/{vision,specs,decisions,development,inbox,templates,changelog,assets,tasks}`
- ADR 0001~0006（Monorepo / Vendor OpenClaw / MCP 最小化 / Contracts 真相源 / 桌面 Tauri / 单平台收敛）
- `.ai/` Vibe Coding 工作台（rules / context / prompts），新增 `rules/30-agent-behavior.md`
- 配置中心 schema 与 Skill manifest schema（在 `packages/platform/contracts/schemas/`）
- DCC 插件命名统一：`Artifex Nexus for Unreal` / `Artifex Nexus for Blender`
- 用户数据目录布局：`~/.artifexnexus/.openclaw/` 隔离 vendor
- **任务管理方案**：`docs/tasks/` + Obsidian Kanban + Dataview 全量/多维视图
- **SDD 工作流**：`docs/development/sdd-workflow.md` + 4 个口令（triage/align/implement/done）
- **Agent onboarding**：`.github/copilot-instructions.md`、`docs/development/agent-onboarding.md`
- **OpenClaw 包壳设计文档**（M1）：`docs/specs/openclaw-wrapper{,-install,-runtime,-dev}.md`
- TASK-0001：OpenClaw 包壳改造（M1 文档完成，进 ready）

### Changed
- MCP 工具统一为 `run_python`（不再区分 `run_ue_python`）
- Skill 装饰器统一为 `@tool`（区分 Skill = 包，Tool = 函数）
- **配置 schema 去抽象化**：删除 `platform.*` 节点；所有字段平铺到 `openclaw.*`；
  vendor 写入坐标加 `vendor_` 前缀（[[../tasks/done/TASK-0002-schema-de-abstraction]]）

### Removed
- `config.schema.json` 中的 `platform.{type,gateway_url,auth_token_env,config_path,config_key}`
  （已被 `openclaw.{gateway_url,auth_token_env,vendor_config_path,vendor_config_key}` 替代）
