---
id: STORY-0017
kind: story
title: Artifex Nexus 默认 agent 预设自动注入
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1.5d
created: 2026-05-07
updated: 2026-05-07
started: 2026-05-07
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: [0002, 0005]
related_specs:
  - "[[../../specs/openclaw-agent-preset]]"
  - "[[../../specs/openclaw-upstream-survey]]"
  - "[[../../specs/openclaw-wrapper-install]]"
  - "[[../../specs/skill-system]]"
related_packages:
  - "packages/adapters/openclaw/wrapper"
  - "apps/desktop"
tags: [story, openclaw, agent, preset, M1]
---

# Artifex Nexus 默认 agent 预设自动注入

## 背景与目标

EPIC-0001 第二批需求 #3：OpenClaw 装完即开箱可用——bootstrap 完成后自动注入一份
"Artifex Nexus 默认 agent" 预设，让用户首启进 OpenClaw Web UI 或 DCC chat 框时
能直接看到一个**已经知道 Artifex Nexus 是什么、能调什么 MCP 工具、要遵守什么调用约定**
的 agent，无需自己写 system prompt。

由于 OpenClaw v2026.5.4 注册 agent 预设的官方机制未知（[[../../specs/openclaw-upstream-survey]]
§11 T8），本 STORY **必须先 spike 实测**，再实现。

预设内容、注入位置候选、幂等规则：详见 [[../../specs/openclaw-agent-preset]]。

## 范围 / 非范围

- 范围
  - **TBD T8 spike**（0.5d）：实测 v2026.5.4 上游 agent 预设注册机制（YAML 文件 /
    `openclaw.json` 的 `agents.presets[]` / `openclaw agents create` CLI 三选一），
    回填 [[../../specs/openclaw-agent-preset]] §3 + [[../../specs/openclaw-upstream-survey]]
    §11 T8
  - 实现 preset 模板：`packages/adapters/openclaw/wrapper/src/.../assets/agents/artifex-nexus.yaml.tpl`
  - bootstrap.py 末尾追加 `_install_artifex_nexus_agent_preset()`，幂等（lock 文件）
  - 新增 sidecar JSON-RPC：`openclaw.agent_preset.status` / `openclaw.agent_preset.reset_default`
  - 模板内容：定位 / 支持 DCC / MCP 工具 / Skill 体系 / 调用约定 / 安全边界 / 沟通风格
    （详见 [[../../specs/openclaw-agent-preset]] §2.2）
  - 工具白名单仅启用 `run_python`，禁用 `browser`
  - 模型绑定不写死，引用 `agents.defaults.*`（与 STORY-0015 联动）
- 非范围
  - "重置 agent 预设"按钮的 UI（→ STORY-0015 SettingsPanel 底部按钮，调本 STORY 的 RPC）
  - 多语言版本 preset（M2+）
  - 用户自定义 preset 编辑器（M5+）

## 验收标准

- [ ] OpenClaw 安装 + bootstrap 后，目标位置出现 `artifex-nexus` agent 预设文件 / 配置项
- [ ] OpenClaw Web UI（如有，依赖 STORY-0016）的 agent 列表能看到 `artifex-nexus`
- [ ] preset 内容与 [[../../specs/openclaw-agent-preset]] §2.2 system prompt 完全一致
- [ ] 工具白名单仅含 `run_python`，禁用 `browser`
- [ ] 模型绑定字段引用 `agents.defaults.*` 而非硬编码
- [ ] 幂等性：重复 bootstrap 不覆盖用户对预设的修改（lock 文件 checksum 校验）
- [ ] lock 文件 `<workspace>/agents/.artifex-nexus-preset.lock` 含 `version` / `installedAt` /
      `checksum` 字段
- [ ] 用户改过预设后，重复 bootstrap 日志 warn "用户已自定义 Artifex Nexus preset，跳过更新"
- [ ] sidecar `openclaw.agent_preset.status` 正确返回 `{installed, version, modifiedByUser, path}`
- [ ] sidecar `openclaw.agent_preset.reset_default({force: true})` 强制覆盖用户改动
- [ ] 单测：`agent_preset.py` 三场景（首次 / 重复未改 / 重复已改）+ checksum + lock
      格式 ≥ 8 个用例

## 设计要点

详见 [[../../specs/openclaw-agent-preset]]。关键决策：

- **Preset 内容是 v1**：本 STORY 落 v1.0.0，未来内容变更必须先改 spec 再升 version 字段
- **模板变量**：`{{OPENCLAW_VERSION}}` / `{{ARTIFEX_NEXUS_VERSION}}` / `{{SUPPORTED_DCC_LIST}}`
  bootstrap 时渲染，不写死字符串
- **幂等三态**：首次写入 → 重复未改（跳过）→ 重复已改（warn 不覆盖）
- **强制重置**：仅 `reset_default({force: true})` 允许覆盖用户改动，需 UI 二次确认
- **与 STORY-0015 联动**：模型 / provider 切换由设置面板控制，preset 不直接绑定具体模型，
  通过 `agents.defaults.*` 间接生效

## 子任务

- [x] **T8 spike**（2026-05-07）：实测 OpenClaw v2026.5.4 agent schema：**`agents.list[]` 数组**
      承载预设，每条含 `id` / `default` / `name` / `systemPromptOverride` / `skills` /
      `agentRuntime.id` / `thinkingDefault` / `reasoningDefault` 等字段；CLI `openclaw agents add`
      **不支持 `--system-prompt`**；最终方案：走 `openclaw config patch --stdin`，**先 get 后合并**
      避免 patch 数组 replace 干掉用户其它 agent；回填 [[../../specs/openclaw-upstream-survey]] §15
- [ ] **Q1 深挖**：`openclaw skills list --json` 实测，确认 run_python 在上游叫什么名字 *(待 implement 期联调；当前按 spec §2.3 暂用字面 `"run_python"`)*
- [ ] **Q2 深挖**：`agentRuntime.id` 是否必填、默认值是什么 *(待联调；当前按 spec §2.1 写 `"pi"`)*
- [x] `wrapper/assets/agents/artifex-nexus.preset.json.tpl` 模板（按 [[../../specs/openclaw-agent-preset]] §6）
- [x] `wrapper/assets/agents/artifex-nexus.system-prompt.txt` system prompt 全文外置
- [x] `wrapper/agent_preset.py` 实现 `render_v1_0_0(openclaw_home) -> dict`（模板变量替换 + JSON 转义）
- [x] `wrapper/agent_preset.py` 实现 `upsert_by_id(existing_list, new_preset) -> list`
      （同 id 替换；多个同 id 时自愈去重；空列表追加）
- [x] `wrapper/agent_preset.py` 实现 `install_default_preset()`（先 get → 合并 → patch → 写 lock；
      含"用户删了 → 重装" / "checksum 命中 → 跳过" / "用户改过 → warn 跳过" 三态）
- [x] `wrapper/agent_preset.py` 实现 `is_modified_by_user()`（checksum 对比）
- [x] `wrapper/agent_preset.py` 实现 `reset_default(force)` + lock 文件 io
- [x] lock 文件 schema：`{version, installedAt, checksum}`（写入 `state/artifex-nexus-preset.lock`）
- [x] `wrapper/bootstrap.py` 末尾调用 `_try_install_default_agent_preset()`，失败仅 warn 不阻塞
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.agent_preset.status`
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.agent_preset.reset_default`
- [x] `apps/desktop/src/ipc/openclaw.ts` 加 2 个 invoke 包装（status / reset）
- [x] `apps/desktop/src-tauri/src/commands/openclaw.rs` 加 2 个 Tauri command
      （含 camelCase ↔ snake_case serde 适配）+ lib.rs 注册
- [ ] STORY-0015 SettingsPanel 底部"重置 Artifex Nexus 默认 agent 预设"按钮接 `reset_default`
      *(归到 STORY-0015 任务集；本 STORY 提供 IPC 已就位)*
- [ ] reset 二次确认 dialog *(同上，STORY-0015 实施)*
- [x] 单测 ≥ 10 个用例（实测 26 用例覆盖：模板 5 / checksum 2 / upsert 6 / lock 3 / install 7 / status 3）
- [ ] E2E（M1 smoke）：装完 → 打开 Control UI → 看到 `Artifex Nexus（DCC 桥默认助手）` agent → chat 一句 → 自我介绍提及 "Artifex Nexus" 与 "DCC 桥" *(M1 smoke 阶段验证)*

## 进展日志

- 2026-05-07 created（EPIC-0001 第二批需求 #3，docs-first 阶段产出 spec + STORY 卡）
- 2026-05-07 T8 spike 完成：实测 `agents.list[]` 数组 + `systemPromptOverride` 字段，CLI 不支持 `--system-prompt`，最终方案走 `config patch --stdin`（先 get 后合并避免数组被 replace 干掉）；模板从 `.yaml.tpl` 改为 `.json.tpl`；驱动 [[../../specs/openclaw-agent-preset]] 重写为 v2，子任务按真相重新拆分
- 2026-05-07 进入 in-progress：开始按 v2 spec 推进 implement
- 2026-05-07 后端完成：`agent_preset.py` + 模板 + system prompt 全文 + bootstrap 末尾自动注入 + sidecar 双 RPC；wrapper pytest 92 通过 2 跳过 0 失败（其中 agent_preset 26 用例全绿，覆盖三态/upsert 4 场景/checksum/lock/转义）
- 2026-05-07 前端完成：IPC `getOpenClawAgentPresetStatus()` / `resetOpenClawAgentPreset(force)` + Tauri 双命令（含 camelCase serde 适配）+ lib.rs 注册；`pnpm typecheck` 通过；SettingsPanel 重置按钮挂接归到 STORY-0015
- 2026-05-07 联调期反馈（Win11 用户）：bootstrap 流程在 "正在启动 Gateway" 报 `[WinError 193]`，**导致 `_try_install_default_agent_preset()` 末尾自动注入也失败**（其内部 `_run_config_get` / `_run_config_patch` 同根因）⇒ 与 STORY-0010 R1、STORY-0015 A1 同根因；修复路径：`agent_preset.py::_run_config_get` / `_run_config_patch` 迁移到 ADR 0007 的 `_subprocess.py` helper，本卡无独立设计变更
