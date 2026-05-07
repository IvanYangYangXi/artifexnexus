---
id: STORY-0015
kind: story
title: OpenClaw 设置面板 — 9 大主流 LLM provider 多预设管理
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-07
updated: 2026-05-07
started: 2026-05-07
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: [0002, 0005]
related_specs:
  - "[[../../specs/openclaw-settings-panel]]"
  - "[[../../specs/openclaw-upstream-survey]]"
  - "[[../../specs/openclaw-wrapper-ipc]]"
  - "[[../../specs/ui/installer-structure]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, settings, llm, ui, M1]
---

# OpenClaw 设置面板 — 9 大主流 LLM provider 多预设管理

## 背景与目标

EPIC-0001 第二批需求 #1：安装向导 OpenClaw 行的"设置"按钮当前被刻意隐藏
（`InstallItemRow.tsx:234-244` 显式 `item.id !== "openclaw"` 守卫）。本 STORY 解锁该
按钮，新建 M3 风格 modal 设置面板，让用户能配置大模型的 provider / API 协议 / 接口地址 /
API Key / 模型名 / 高级配置（视觉输入、推理模式、maxTokens 等），数据回写
`openclaw.json` 的 `models.<provider_id>.*` 节点，与 OpenClaw 自身配置联动。

完整 UI 设计 / 字段表 / 状态机：[[../../specs/openclaw-settings-panel]]。

## 范围 / 非范围

- 范围
  - **TBD T6 spike**（0.5d）：实测 OpenClaw v2026.5.4 `models.<provider>.*` 真实 schema，
    回填 [[../../specs/openclaw-upstream-survey]] §13 + [[../../specs/openclaw-settings-panel]] §4
  - 解除 `InstallItemRow.tsx` OpenClaw 行的设置按钮屏蔽
  - 新建 `apps/desktop/src/features/openclaw/SettingsPanel.tsx`（M3 风格 modal）
  - 9 个固定 provider 卡片（OpenAI / Anthropic / Google Gemini / Azure OpenAI / Ollama /
    DeepSeek / 火山豆包 / 阿里千问 / 自定义 OpenAI 兼容）+ 表单 + 高级配置折叠
  - 新增 sidecar JSON-RPC：`openclaw.config.read_models` / `openclaw.config.write_models` /
    `openclaw.config.test_provider`
  - openclaw.json read-modify-write（深合并 + atomic rename + 失败回滚）
  - apiKey 脱敏机制（前端永远拿不到明文，仅展示等长 `*` 串）
- 非范围
  - Web UI 入口按钮（→ STORY-0016）
  - agent 预设注入（→ STORY-0017）
  - i18n 切换 UI（M1 仅中文）
  - 多用户 / 团队配置同步（M5+）

## 验收标准

- [ ] OpenClaw 行右侧出现"设置"按钮，`installed / update-available` 时可点，其它状态置灰 + 正确 tooltip
- [ ] 点击后弹出 modal，左侧 9 个 provider 列表，右侧字段表单完整渲染
- [ ] 9 个 provider 默认 baseUrl 与 [[../../specs/openclaw-settings-panel]] §3 表一致
- [ ] 切换 provider 不丢已填字段；切到"自定义 OpenAI 兼容"baseUrl 必填校验生效
- [ ] 高级配置折叠区可独立展开，所有字段（vision / reasoning / maxTokens / temperature /
      topP / systemPromptOverride / requestTimeoutMs / customHeadersJSON）渲染并可编辑
- [ ] "测试连接"按钮调 `openclaw.config.test_provider` RPC，返回延时 + 错误信息
- [ ] "保存"按钮调 `openclaw.config.write_models` RPC，写入 `openclaw.json` 后 modal 关闭，
      下次打开 modal 字段被正确回填
- [ ] apiKey 字段：保存后再打开显示等长 `*` 串；用户未改时 `write_models` 不传该字段
      （sidecar 保留旧值）；用户改了则正常透传
- [ ] modal 关闭时若有未保存修改弹二次确认 "丢弃修改？"
- [ ] 上游不存在的字段（spike 后确认）降级落 `state/artifex-nexus-extras.json` 的
      `providerExtras.<id>.*` 节点
- [ ] 单测：`config_io.py` 深合并 + atomic write + apiKey 脱敏（≥ 8 个用例）
- [ ] 前端单测：`SettingsPanel` reducer 切 provider / 改字段 / 校验（≥ 6 个用例）

## 设计要点

详见 [[../../specs/openclaw-settings-panel]]，关键决策摘录：

- **写入策略**：read-modify-write 深合并，绝不覆盖未知顶层字段（保留 OpenClaw 自身或
  其它工具加的配置）
- **API Key 保护**：apiKey 不出 `openclaw.json` 之外（不进 Tauri event payload、不进日志、
  不进崩溃报告）；前端只在内存里短暂持有
- **9 provider 矩阵**：OpenAI / Anthropic / Google / Azure OpenAI / Ollama / DeepSeek /
  火山豆包 / 阿里千问 / 自定义 OpenAI 兼容
- **协议枚举**：`openai` / `openai-compatible` / `anthropic` / `google` / `azure-openai`
- **当前默认 provider**：单选，落 `agents.defaults.model`（或 spike 实测的等价字段）
- **联动 STORY-0017**：modal 底部"重置 Artifex Nexus 默认 agent 预设"按钮，调
  `openclaw.agent_preset.reset_default`（依赖 STORY-0017 实现）

## 子任务

- [x] **T6 spike**（2026-05-07）：sidecar 跑 `openclaw config schema` 等命令，把
      schema 全文落 `docs/specs/_spikes/openclaw-v2026.5.4-config-schema.json`（1.8MB）；
      关键发现：**模型与鉴权解耦**（`models.providers.<id>` + `auth.profiles.<id>` 两张表）；
      回填 [[../../specs/openclaw-upstream-survey]] §13；驱动重写 [[../../specs/openclaw-settings-panel]] 为 v2
- [ ] **P1/P2 深挖** implement 启动时立刻做：用 `node` 抽 `models.providers.<id>` 与
      `auth.profiles.<id>` 的 additionalProperties 子树，确认 `protocol` / `baseUrl` / `token`
      等字段的真实命名 *(联调期补；当前实现按 spec §4 假设字段名通过 patch strict-json 验证)*
- [ ] **P3 深挖**：`openclaw infer --help` 实测，确认能否用作"测试连接" *(联调期补；当前 spawn `openclaw infer` 失败时返回 error 让前端提示，不阻塞主链)*
- [x] `wrapper/config_io.py` 实现 `dump_config()`（聚合 `config get models / auth / agents.defaults`
      4 次输出 + apiKey 脱敏 + extras 合并）
- [x] `wrapper/config_io.py` 实现 `patch_config(patch_json, extras_patch)`
      （strip_unchanged_secrets 剔除 `*` 占位 + spawn `openclaw config patch --stdin --strict-json` + extras 深合并）
- [x] `wrapper/config_io.py` 实现 `test_provider(provider_id, model_id, auth_profile_id)`
      （spawn `openclaw infer`，含超时 / 非零退出 / 必填 三态）
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.config.dump`
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.config.patch`
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.config.test_provider`
- [x] 单测 ≥ 10 个用例（实测 25 用例：脱敏 6 / strip 4 / extras 3 / dump 3 / patch 5 / test 4）
- [x] `apps/desktop/src-tauri/src/commands/openclaw_config.rs`（透传 sidecar，含 `serde(rename)` camelCase 适配）+ mod.rs / lib.rs 注册
- [x] `apps/desktop/src/ipc/openclaw.ts` 加 3 个 invoke 包装 + 3 个返回类型
- [x] `apps/desktop/src/features/openclaw/settings.types.ts` — 11 个 PROVIDER_TEMPLATES + 全部表单类型
- [x] `apps/desktop/src/features/openclaw/SettingsPanel.tsx`（M3 modal，**3 个 Tab**：Providers / Auth Profiles / Default Agent）
- [x] `SettingsPanel.module.css`
- [x] `settings.i18n.ts`
- [x] `settings.reducer.ts` — dumpToState + buildPatchFromState + validateState + reducer
- [x] `tabs/ProvidersTab.tsx`（左列表 + 右详情 + 模板 picker + 高级折叠 + 测试连接）
- [x] `tabs/AuthProfilesTab.tsx`（API Key 脱敏占位行为：聚焦清空 + password type）
- [x] `tabs/DefaultAgentTab.tsx`（provider×model 笛卡尔积下拉 + thinking/reasoning 默认）
- [x] 高级配置折叠区（customHeaders JSON）
- [x] "新增 provider 时同时新建 auth profile" 复选框 + 联动逻辑
- [x] "测试连接"按钮接 `test_provider` RPC（自动取 isDefault 或第一个 model）
- [x] modal 关闭时未保存修改弹二次确认（dirty 状态机）
- [x] `InstallItemRow.tsx` 解除 OpenClaw 设置按钮屏蔽（去掉 `item.id !== "openclaw"` 守卫，加 not-installed/update-available 门禁）
- [x] InstallItemRow 挂 `<SettingsPanel open={...} onClose={...}/>`
- [x] 设置面板底部"重置 Artifex Nexus 默认 agent 预设"按钮接 STORY-0017 RPC（含二次确认 dialog）
- [x] 前端单测 ≥ 8 个用例（实测 20 用例：dumpToState 3 / reducer 7 / buildPatch 3 / validate 3 / parseHeaders 4）
- [ ] [[../../specs/openclaw-settings-panel]] §10 P1/P2/P3/P4 全部置 ✅ 后才能 close STORY *(联调期闭环)*

## 进展日志

- 2026-05-07 created（EPIC-0001 第二批需求 #1，docs-first 阶段产出 spec + STORY 卡）
- 2026-05-07 T6 spike 完成：实测 OpenClaw v2026.5.4 schema（1.8MB JSON），发现**模型与鉴权解耦**（`models.providers` + `auth.profiles`）、**写入必须走 `config patch --stdin`**、**Default Agent 模型在 `agents.defaults.model`**；驱动 [[../../specs/openclaw-settings-panel]] 重写为 v2（3 Tab：Providers / Auth Profiles / Default Agent）；STORY-0015 子任务按真相重新拆分
- 2026-05-07 进入 in-progress：开始按 v2 spec 推进 implement
- 2026-05-07 后端完成：`config_io.py`（dump 脱敏 / patch 剔星 / test_provider）+ sidecar 三 RPC + extras 文件 io；单测 25 用例全绿；wrapper 总 117 通过 / 2 跳过 / 0 失败
- 2026-05-07 前端完成：Tauri 三 command + IPC 三包装 + 11 templates + reducer + 3 Tab 子组件 + M3 modal + InstallItemRow 解锁设置按钮 + 二次确认 dialog + 接 STORY-0017 reset 预设按钮；vitest 20 用例全绿；`pnpm typecheck` 通过
- 2026-05-07 联调期反馈（Win11 用户）：
  - **A1 阻塞** — "测试连接" 与 "保存" 都报 `[WinError 193] %1 不是有效的 Win32 应用程序` ⇒ 与 STORY-0010 R1 同根因，由 ADR 0007 + `_subprocess.py` helper 解决（本卡仅迁移 `config_io.py` 的调用点）
  - **B 校验 UX** — 模板新建 `deepseek` 后立即点保存，被 `validateState` 卡 "deepseek.models 至少需要一个模型"，提示在底部隐蔽且无法定位字段 ⇒ 修：① 模板新建时若 protocol 是已知 OpenAI 兼容厂商，自动追加一个空白 model row（id 由用户填）； ② 错误提示自动切到出问题的 Tab 并高亮该 provider； ③ 字段 inline 红框
  - **C 设计变更** — 用户反馈 "鉴权与提供商分两个 Tab 非常混乱"，绝大多数场景一个 provider 配一个 key，分两 Tab 反人类 ⇒ 升 spec 至 v3：Provider 详情内联鉴权字段（API Key / mode / email / notes）+ 自动维护 1:1 单 profile；保留 "Auth Profiles" 高级折叠区供共享 key / 多 profile 高级用户使用。底层 OpenClaw 双表数据模型不变，仅 UI 合并。**待 A 修完后启动**
  - **D 暂挂** — "默认 agent 模型功能看起来有些问题"，待用户补充具体复现路径再处理
- 2026-05-07 v3 调研落地：用户提示参考 Roo Code + OpenClaw 上游 Control UI；spike 笔记落 [[../../specs/_spikes/provider-ux-survey]]，提出 v3 候选形态（2 Tab，Auth 内联到 Provider 详情，模板带默认 model）；本机 OpenClaw 全局安装异常（`Cannot find module openclaw.mjs`）暂未实测 dashboard 截图，用 schema + CLI 子命令族推断；spec [[../../specs/openclaw-settings-panel]] §10 追加 P5（v3 拍板项）；UX-B / v3 实施待 product 拍板
- 2026-05-07 v3 + UX-B 实施完成（product 拍板按 spike §3 提案落地）：
  - Spec [[../../specs/openclaw-settings-panel]] 升 v3-inline-auth：§1/§2/§3/§4 重写为"2 Tab + Provider 内联 Auth 折叠区 + 高级模式开关"，§3 模板矩阵补"默认 model"列（UX-B），§10 P5 ✅
  - **UX-B**：`settings.types.ts` 的 `ProviderTemplate` 加 `defaultModels`，11 模板补默认值（OpenAI=gpt-4o-mini / Anthropic=claude-3-5-sonnet-20241022 / DeepSeek=deepseek-chat / 火山=doubao-pro-32k 等；azure/lmstudio/custom 留空）；reducer `ADD_PROVIDER_FROM_TEMPLATE` 用 seedModels 自动插，首行 isDefault=true；新增 2 条 reducer 测试覆盖（22/22 全绿）
  - **v3 内联 Auth**：新建 `tabs/AuthInlineSection.tsx`（手风琴折叠卡片，按 `auth.profiles.<id>.provider` 过滤当前 provider）；ProvidersTab 详情区在 model 列表与高级配置之间嵌入；Auth Tab 默认隐藏，仅"高级模式"开启或 deep-link 时显示
  - **高级模式开关**：SettingsPanel 标题栏右上 checkbox，状态持久化到 `localStorage` `openclaw.settings.advancedMode`；advancedMode=true 时 Provider 详情还显示"指向已有 profile"下拉，便于跨 provider 共享 key
  - 新增 CSS class：`.inlineAuthSection / .inlineAuthCard / .inlineAuthHeader / .inlineAuthBody / .advancedModeToggle` 等 5 组
  - i18n 补 `sectionAuthInline / btnAddAuthInline / inlineAuthEmpty / advancedModeLabel / advancedModeHint` 等 7 条文案
  - 数据契约不变：仍 dump 三表 + patch via `openclaw config patch --stdin`，sidecar 不动；wrapper 132/2skip/0fail 全绿
  - 验证：`pnpm typecheck` ✅ ／ `pnpm vitest run` 22/22 ✅ ／ `pnpm build` 通过（dist/index 235.94kB，按用户规则 apps 改动必编译）
