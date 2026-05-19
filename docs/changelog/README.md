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
- **开发路线图 M0–M9**：`docs/vision/roadmap.md`，每阶段强制可分发
- **三级任务体系 EPIC / STORY / TASK**：升级 `docs/development/task-management.md`、新增 `docs/templates/{epic,story}.md`、新增 `docs/tasks/tree.md` 层级树视图
- **EPIC 卡 9 张**（M0–M9）+ M0 细化 STORY 5 张
- **UI 先行约束** 写入 `.ai/rules/30-agent-behavior.md` §4.2 与 `task-management.md` §9
- **STORY-0001 安装向导 UI 结构 spec**：`docs/specs/ui/installer-structure.md`（done）
- **应用级设置 `app.settings.*` RPC**（get/set/reset）+ 桌面端"设置 → 常规" Tab，
  含默认超时 / 最大并发 / 进程树终止 / 日志等级 4 个字段；持久化到
  `<openclaw_home>/state/artifex/app-settings.json`（[[2026-05-19-nexus-tool-run-fixes]]）
- **Nexus-Tool 运行流程 spec**：[[../specs/nexus-tool-runtime]]，沉淀通用/DCC 两条路径
  的执行模型、注入头不变量、超时/取消/编码约束
- **诊断脚本** `tools/diagnose_dcc_tool_run.py`：绕过 Tauri 直接走 sidecar RPC，
  端到端复现 nexus-tool 运行

### Changed
- MCP 工具统一为 `run_python`（不再区分 `run_ue_python`）
- Skill 装饰器统一为 `@tool`（区分 Skill = 包，Tool = 函数）
- **配置 schema 去抽象化**：删除 `platform.*` 节点；所有字段平铺到 `openclaw.*`；
  vendor 写入坐标加 `vendor_` 前缀（[[../tasks/done/TASK-0002-schema-de-abstraction]]）

### Fixed
- **Nexus-Tool 运行流程 6 个独立 bug**（[[2026-05-19-nexus-tool-run-fixes]]）：
  通用工具 Windows GBK 解码崩 / DCC 工具"received 1001"网络层不重连 /
  DCC 工具"一直转圈"（MCP reader 启动时序）/ DCC 工具 SDK 路径未注入 /
  DCC 工具 `__file__` 缺失 / DCC 工具 `json.dumps` 拼 Python 代码导致 boolean 参数炸
- **Nexus-Tool 附带优化**：tempdir wrapper / 结果 BEGIN-END marker 协议 /
  超时三级回退（manifest > 设置 > 120s）/ 任务存储 5 分钟 TTL GC /
  cancel 走进程树（Windows taskkill /T）/ DCC 工具异常带 traceback 透传

### Removed
- `config.schema.json` 中的 `platform.{type,gateway_url,auth_token_env,config_path,config_key}`
  （已被 `openclaw.{gateway_url,auth_token_env,vendor_config_path,vendor_config_key}` 替代）
