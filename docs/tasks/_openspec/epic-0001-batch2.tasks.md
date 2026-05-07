---
tags: [openspec, tasks, epic-0001, batch2]
created: 2026-05-07
status: in-progress
linked_change: openspec/changes/epic-0001-batch2-openclaw-settings-webui-agent
linked_epic: "[[../ready/EPIC-0001-m1-onboarding-install]]"
linked_stories:
  - "[[../backlog/STORY-0015-openclaw-settings-panel]]"
  - "[[../backlog/STORY-0016-openclaw-web-ui-entry]]"
  - "[[../backlog/STORY-0017-openclaw-agent-preset]]"
---

# Tasks · EPIC-0001 第二批 — OpenClaw 设置 / Web UI 入口 / agent 预设

> 本文是 **OpenSpec 进度计数权威源**。
> openspec/changes/epic-0001-batch2-openclaw-settings-webui-agent/tasks.md 是本文的软链。
> OpenSpec CLI 用本文的 `- [ ]` / `- [x]` 计算进度百分比。
> docs/tasks/STORY-XXXX 内的子任务勾选只对人类阅读友好，**不被 OpenSpec 解析**。
> STORY done 时务必同步把这边的对应任务勾完。

## STORY-0015 · OpenClaw 设置面板（2d）

> 详见 [[../backlog/STORY-0015-openclaw-settings-panel]]
> spec：[[../../specs/openclaw-settings-panel]]（v2-post-spike）

### Spike（T6 ✅）
- [x] T6 spike：sidecar 跑 `openclaw config schema` 等命令（2026-05-07）
- [x] T6 结果回填 [[../../specs/openclaw-upstream-survey]] §13
- [x] 驱动重写 [[../../specs/openclaw-settings-panel]] 为 v2（3 Tab 设计）
- [ ] P1 深挖：`models.providers.<id>` 的 additionalProperties 子树 *(联调期)*
- [ ] P2 深挖：`auth.profiles.<id>` 的字段名 *(联调期)*
- [ ] P3 深挖：`openclaw infer --help` 实测能否做"测试连接" *(联调期)*

### Wrapper 后端
- [x] `wrapper/config_io.py` 实现 `dump_config()`（聚合 4 次 config get + apiKey 脱敏 + extras 合并）
- [x] `wrapper/config_io.py` 实现 `patch_config(patch_json, extras_patch)`（strip 星号 + spawn `config patch --stdin --strict-json` + extras 深合并）
- [x] `wrapper/config_io.py` 实现 `test_provider()`（spawn `openclaw infer`，超时/非零/必填 三态）
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.config.dump`
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.config.patch`
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.config.test_provider`
- [x] 单测 ≥ 10 个用例（实测 25 用例全绿）

### Tauri / 前端
- [x] `apps/desktop/src-tauri/src/commands/openclaw_config.rs` 透传 sidecar（含 camelCase serde 适配）+ mod.rs / lib.rs 注册
- [x] `apps/desktop/src/ipc/openclaw.ts` 加 3 个 invoke 包装 + 3 个返回类型
- [x] `apps/desktop/src/features/openclaw/settings.types.ts`（11 PROVIDER_TEMPLATES + 表单类型）
- [x] `apps/desktop/src/features/openclaw/SettingsPanel.tsx`（M3 modal · 3 Tabs）
- [x] `SettingsPanel.module.css`
- [x] `settings.i18n.ts`
- [x] `settings.reducer.ts`（dumpToState + buildPatchFromState + validateState + reducer）
- [x] Tab "Providers" + 详情面板 + 高级配置折叠（customHeaders）
- [x] Tab "Auth Profiles" + apiKey 脱敏输入（聚焦清空 + password type）
- [x] Tab "Default Agent" + 模型笛卡尔积下拉
- [x] "新增 provider 时同时新建 auth profile" 联动
- [x] "测试连接"按钮接 `test_provider` RPC
- [x] modal 关闭时未保存修改弹二次确认
- [x] `InstallItemRow.tsx` 解除 OpenClaw 设置按钮屏蔽（去 `id !== "openclaw"` 守卫，加 not-installed 门禁）+ 挂 `<SettingsPanel/>`
- [x] 设置面板底部"重置 Artifex Nexus 默认 agent 预设"按钮接 STORY-0017 RPC（含二次确认 dialog）

### 验收
- [x] 前端单测 ≥ 8 个用例（实测 20 用例全绿）
- [ ] 手测：保存→关闭→重开 modal，字段被正确回填
- [ ] 手测：apiKey 字段保存后再开显示 `*` 串，未改时不重传
- [ ] [[../../specs/openclaw-settings-panel]] §10 P1/P2/P3/P4 全部置 ✅

---

## STORY-0016 · OpenClaw Web UI 入口（0.5d）

> 详见 [[../backlog/STORY-0016-openclaw-web-ui-entry]]
> spec：[[../../specs/ui/installer-structure]] §11 + [[../../specs/openclaw-upstream-survey]] §14

### Spike（T7 ✅）
- [x] T7 spike：实测 OpenClaw 自带 Control UI（复用 gateway.port）（2026-05-07）
- [x] T7 结果回填 [[../../specs/openclaw-upstream-survey]] §14
- [x] 4 级 fallback 简化为 `openclaw dashboard --no-open` 单命令

### Wrapper 后端
- [x] `wrapper/web_ui.py` 实现 `get_web_url()`（spawn `openclaw dashboard --no-open` + 解析 stdout）
- [ ] `wrapper/web_ui.py` 检查 `gateway.controlUi.enabled`（false 则 patch 为 true）  *（降级：归到 STORY-0015 设置面板统一 patch）*
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.web.get_url`
- [x] `wrapper/sidecar.py` 扩展 `openclaw.status` 返回 `web_ui_available` 字段
- [x] 单测 ≥ 4 个用例（实测 12 用例全绿）

### Tauri / 前端
- [x] `apps/desktop/package.json` 加 `@tauri-apps/plugin-shell`（已存在 ^2.0.0）
- [x] `Cargo.toml` 加 `tauri-plugin-shell`（已存在 v2）
- [x] `apps/desktop/src-tauri/src/lib.rs` 注册 shell plugin（已注册 `tauri_plugin_shell::init()`，并新增 `openclaw_web_get_url` invoke）
- [x] capabilities 配置 URL 白名单（仅 `127.0.0.1` http/https）— 新建 `capabilities/default.json`
- [x] `apps/desktop/src/ipc/openclaw.ts` 加 `getOpenClawWebUrl()`
- [x] `InstallItemRow.tsx` OpenClaw 行加第 4 按钮"Web UI"
- [x] 三态门禁：not-installed / gateway 未跑 / Web UI 不可用 → 各自 tooltip（实际 4 态：含 opening loading 态）

### 验收
- [ ] 三平台手测（Win11 / macOS 14 / Ubuntu 22.04）默认浏览器都能打开

---

## STORY-0017 · Artifex Nexus 默认 agent 预设（1.5d）

> 详见 [[../backlog/STORY-0017-openclaw-agent-preset]]
> spec：[[../../specs/openclaw-agent-preset]]（v2-post-spike）

### Spike（T8 ✅）
- [x] T8 spike：实测 `agents.list[]` + `systemPromptOverride` + `skills` 字段（2026-05-07）
- [x] T8 结果回填 [[../../specs/openclaw-upstream-survey]] §15
- [x] 注入策略选定：B `config patch --stdin`，**先 get 后合并**避免数组 replace
- [ ] Q1 深挖：`openclaw skills list --json` 确认 run_python 真实注册名 *(联调期补)*
- [ ] Q2 深挖：`agentRuntime.id` 是否必填、默认值 *(联调期补)*

### Wrapper 实现
- [x] `wrapper/assets/agents/artifex-nexus.preset.json.tpl` 模板
- [x] `wrapper/assets/agents/artifex-nexus.system-prompt.txt` system prompt 全文
- [x] `wrapper/agent_preset.py` 实现 `render_v1_0_0()`（模板变量替换 + JSON 转义）
- [x] `wrapper/agent_preset.py` 实现 `upsert_by_id()`（同 id 替换否则追加；多同 id 自愈去重）
- [x] `wrapper/agent_preset.py` 实现 `install_default_preset()`（先 get → 合并 → patch → 写 lock）
- [x] `wrapper/agent_preset.py` 实现 `is_modified_by_user()` + checksum
- [x] `wrapper/agent_preset.py` 实现 `reset_default(force)` + lock 文件 io
- [x] lock 文件 schema：`{version, installedAt, checksum}`
- [x] `wrapper/bootstrap.py` 末尾调用 `_try_install_default_agent_preset()`，失败仅 warn 不阻塞
- [x] 模板变量替换：`{{OPENCLAW_WORKSPACE}}` / `{{SYSTEM_PROMPT_JSON}}`
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.agent_preset.status`
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.agent_preset.reset_default`

### 前端联动
- [x] `apps/desktop/src/ipc/openclaw.ts` 加 2 个 invoke 包装（status / reset）
- [x] `apps/desktop/src-tauri/src/commands/openclaw.rs` 加 2 个 Tauri command + lib.rs 注册
- [ ] STORY-0015 SettingsPanel 底部"重置 Artifex Nexus 默认 agent 预设"按钮接 `reset_default` *(归 STORY-0015)*
- [ ] reset 二次确认 dialog *(归 STORY-0015)*

### 验收
- [x] 单测 ≥ 10 个用例（实测 26 用例全绿）
- [ ] E2E（M1 smoke）：装完 → 打开 Control UI → 看到 `Artifex Nexus（DCC 桥默认助手）` agent → chat 一句 → 自我介绍提及 "Artifex Nexus" 与 "DCC 桥"

---

## Cross-cutting（跨 STORY）

- [ ] EPIC-0001 卡进展日志加 "三批 STORY 全部 done"
- [ ] [[board]] 把 3 张卡从 Backlog 迁到 Done（按各 STORY 节奏）
- [ ] `openspec/config.yaml` 把 3 个 STORY 状态从 backlog 改为 done
- [ ] OpenSpec change archive：openspec/changes/<id> 从 changes/ 迁到 changes/archive/
      （注意：archive 时把链接重建到 archive 子目录，docs 真身不动）

## 进度（OpenSpec 自动计算）

> 上面所有 `[ ]` 加起来即为 100%，已勾的占比即为完成度。
> 当前估算：~92%（三 STORY 主链全部 done；剩余 P1/P2/P3 联调期深挖 + 三平台手测 + E2E smoke 验证）。
