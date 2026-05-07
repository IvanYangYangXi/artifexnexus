---
tags: [spec, ui, openclaw, settings, M1]
created: 2026-05-07
updated: 2026-05-07
status: draft
version: v3-inline-auth
related_story: "[[../tasks/backlog/STORY-0015-openclaw-settings-panel]]"
related_specs:
  - "[[openclaw-upstream-survey]]"
  - "[[openclaw-wrapper]]"
  - "[[openclaw-wrapper-ipc]]"
  - "[[ui/installer-structure]]"
  - "[[_spikes/provider-ux-survey]]"
---

# OpenClaw 设置面板（v3 · Provider 内联 Auth 版）

> 面向：STORY-0015 implement。本文是面板的"设计契约"——UI 状态机、字段表、与
> `openclaw.json` 的映射关系都在这里。变更 UI 字段必须先改本文。
>
> **版本说明**：
> - v1（2026-05-07 09:00）基于"9 provider 卡片各自一张大表（含 apiKey）"的假设；
> - v2（2026-05-07 T6 spike 后）改为"模型与鉴权解耦的 3 Tab"对齐 OpenClaw 真相；
> - v3（2026-05-07 联调反馈 + UX 调研）：实现后用户反馈"双 Tab 反人类"，
>   再调研 Roo Code + OpenClaw 上游 Control UI（[[_spikes/provider-ux-survey]]），
>   发现上游自身就是把 auth profiles **内联进 provider 详情**——故合并为
>   **2 Tab + Provider 内联 Auth 折叠区**。底层 OpenClaw 双表数据契约不变，
>   仅前端组合方式调整，sidecar JSON-RPC 协议 / patch 路径完全不动。
> 详细 spike 产物见 [[openclaw-upstream-survey]] §13 + [[_spikes/provider-ux-survey]]。

## 1. 触发与定位

- 入口：安装向导 `OpenClaw` 行右侧"设置"按钮（与 `检测 / Web UI / 安装` 并列）
- 仅在 `state in {installed, update-available}` 时可点；其它状态置灰 + tooltip "请先安装 OpenClaw"
- 视觉：M3 Dialog（modal），宽 880px（v1 是 720px，v2/v3 因双栏布局加宽），高度自适应
- 标题：`OpenClaw · 模型设置`

## 2. 信息架构（线框 v3）

OpenClaw 数据层把"模型连接"与"鉴权凭据"分两张表存（`models.providers` + `auth.profiles`）。
但 OpenClaw 上游 Control UI 的 UX 是把 auth profiles **内联到 provider 详情下方**——
我们的面板对齐上游 UX 心智，而不是机械对齐 schema 拓扑：

```
┌──────────────────────────────────────────────────────────────────────┐
│ OpenClaw · 模型设置                          [□ 高级模式]        [×] │
├──────────────────────────────────────────────────────────────────────┤
│ [ Providers (3) ]  [ Default Agent ]                                 │ ← Tabs（v3 = 2 个）
├──────────────────────────────────────────────────────────────────────┤
│ ┌──── 列表（左 280px） ───────┐  ┌──── 详情（右 600px） ──────────┐ │
│ │ ◉ openai          [内置]    │  │ Provider ID:  openai            │ │
│ │ ○ deepseek        [自定义] │  │ Display Name: OpenAI             │ │
│ │ ○ ollama-local    [自定义] │  │ Protocol:     ▼ openai           │ │
│ │                            │  │ Base URL:     https://...        │ │
│ │ [+ 新增] [模板...]         │  │                                  │ │
│ │   ↑ 选模板自动填默认值      │  │ ▽ 模型列表 (1)                  │ │
│ │     + 默认 model（UX-B）    │  │   - gpt-4o-mini  [默认]   [×]   │ │
│ │                            │  │   [+ 添加 model id]              │ │
│ │                            │  │                                  │ │
│ │                            │  │ ▽ 鉴权凭据 (1)  ← 内联 v3       │ │
│ │                            │  │   ▾ openai-default · api-key · ✅│ │
│ │                            │  │     Mode:    ▼ api-key           │ │
│ │                            │  │     API Key: [********]          │ │
│ │                            │  │     Email:   [...]               │ │
│ │                            │  │     [测试此 profile]   [删除]    │ │
│ │                            │  │   [+ 新增 profile]               │ │
│ │                            │  │                                  │ │
│ │                            │  │ ▷ 高级配置                       │ │
│ │                            │  │ [测试连接(默认 profile)] [删除]  │ │
│ │                            │  └──────────────────────────────────┘ │
│ └────────────────────────────┘                                       │
├──────────────────────────────────────────────────────────────────────┤
│ [重置 Artifex Nexus 默认 agent 预设]              [取消]   [保存]    │
└──────────────────────────────────────────────────────────────────────┘
```

### 两个 Tab + 一个高级开关

1. **Providers**：管理 `models.providers.<id>` + 内联 `auth.profiles.<id>`（典型场景：1 provider 1 key）
2. **Default Agent**：管理 `agents.defaults.*`（与 STORY-0017 联动）

**高级模式开关**（标题栏右上）：
- 开启后，Tab 条额外显示 "Auth Profiles"（v2 的形态），用于"30 个 OpenAI key 轮转"等高级场景
- 关闭（默认）：只有 2 Tab，Auth 一律走 provider 详情内联编辑
- 状态持久化到 `localStorage` `openclaw.settings.advancedMode`
- URL/state 仍可 `tab=auth` deep link，自动开启高级模式

## 3. Provider 模板矩阵（11 个，仅作"新增"时一键填充默认值）

> **重要**：模板只是 UX 糖，**不创建固定 11 个 slot**。用户可任意命名 provider ID，
> 也可不用模板从空开始。
>
> **v3 新增**：`defaultModels` 列——选模板时自动插入 1 行 model（解决 v2 用户反馈
> "新建立刻保存就报至少 1 个 model"的痛点，UX-B）。

| 模板名 | 默认 ID | protocol | 默认 baseUrl | 默认 model（UX-B v3） | 备注 |
|---|---|---|---|---|---|
| OpenAI | `openai` | openai | https://api.openai.com/v1 | `gpt-4o-mini` | 官方 |
| Anthropic | `anthropic` | anthropic | https://api.anthropic.com | `claude-3-5-sonnet-20241022` | 官方 |
| Google Gemini | `google` | google | https://generativelanguage.googleapis.com | `gemini-2.0-flash-exp` | Gemini API |
| Azure OpenAI | `azure-openai` | azure-openai | （用户填） | （留空，deployment 名用户决定） | 需 deployment + apiVersion |
| Ollama (本地) | `ollama-local` | openai-compatible | http://127.0.0.1:11434/v1 | `llama3.2:latest` | apiKey 可空 |
| DeepSeek | `deepseek` | openai-compatible | https://api.deepseek.com/v1 | `deepseek-chat` | |
| 火山豆包 | `volcengine-doubao` | openai-compatible | https://ark.cn-beijing.volces.com/api/v3 | `doubao-pro-32k` | |
| 阿里千问 | `aliyun-qwen` | openai-compatible | https://dashscope.aliyuncs.com/compatible-mode/v1 | `qwen-plus` | |
| OpenRouter | `openrouter` | openai-compatible | https://openrouter.ai/api/v1 | `anthropic/claude-3.5-sonnet` | 多模型聚合 |
| LM Studio | `lmstudio` | openai-compatible | http://127.0.0.1:1234/v1 | （留空） | 本地 |
| 自定义 | `custom` | openai-compatible | （空） | （留空） | 全空白 |

> 默认插入的 model 自动 `isDefault=true`。用户随时可改 / 删 / 加。
> `protocol` 枚举的具体合法值见 [[openclaw-upstream-survey]] §13.5。

## 4. 字段表

### 4.1 Providers Tab — 单条 provider 表单（v3 含内联 Auth）

| 字段 | 类型 | 必填 | openclaw.json 路径 | 说明 |
|---|---|---|---|---|
| `id` | string(kebab-case) | ✅ | `models.providers` 的 key | 不可重命名（删旧建新） |
| `displayName` | string | ⚠ | `models.providers.<id>.displayName`（待深挖） | UI 标签；OpenClaw 上游可能没这字段，降级落 wrapper extras |
| `protocol` | enum | ✅ | `models.providers.<id>.protocol`（待深挖） | openai / openai-compatible / anthropic / google / azure-openai |
| `baseUrl` | string(url) | ✅ | `models.providers.<id>.baseUrl`（待深挖） | 末尾不带 `/` |
| `models[]` | array | ✅ ≥1 | `models.providers.<id>.models[]`（待深挖） | 模型 ID 列表；模板新建自动 1 行（UX-B） |
| `models[].isDefault` | bool | | 同上 .isDefault | 单 provider 内单选；新建第 1 行默认 true |
| `inlineAuthProfiles[]` | 见 §4.2 | ⚠ ≥1 推荐 | `auth.profiles.<id>` where `provider==<this id>` | **v3 内联**：详情下方折叠区原地编辑 |
| `authProfileId` | string(ref) | | `auth.order.<provider_id>[0]` | 默认 profile（"测试连接"用此条） |
| 高级 - maxTokens | int(>0) | | `models.providers.<id>.models[].maxTokens` | per-model |
| 高级 - temperature | float(0–2) | | 同上 | per-model |
| 高级 - timeoutMs | int(>0) | | 同上 | per-model |
| 高级 - capabilities.vision | bool | | `models.providers.<id>.models[].capabilities.vision` | 视觉输入 |
| 高级 - capabilities.reasoning | bool | | 同上 .reasoning | 推理 |
| 高级 - customHeaders | json | | `models.providers.<id>.headers`（待深挖） | 走代理 |

### 4.2 内联 Auth Profile（v3 = Provider 详情内嵌折叠区）

> v3 改动：v2 的"Auth Profiles Tab"内容**整段下沉**到 provider 详情下方，
> 自动按 `auth.profiles.<id>.provider` 过滤当前 provider 的 profiles。
> 高级模式下顶部 Auth Tab 仍可独立访问全部 profiles（包括跨 provider）。

| 字段 | 类型 | 必填 | openclaw.json 路径 | 说明 |
|---|---|---|---|---|
| `id` | string(kebab-case) | ✅ | `auth.profiles` 的 key | 模板新建自动取 `<provider_id>-default` |
| `provider` | string(ref) | ✅ | `auth.profiles.<id>.provider` | **v3 内联模式下不可改**（自动绑定当前 provider）；高级模式可改 |
| `mode` | enum | ✅ | `auth.profiles.<id>.mode` | api-key / oauth / token / paste |
| `apiKey` | string(secret) | 视 mode | `auth.profiles.<id>.token`（待深挖具体字段名） | 仅 mode=api-key/paste 显示 |
| `email` | string | | `auth.profiles.<id>.email` | 可选 |
| `notes` | string | | wrapper extras | 用户备注，OpenClaw 不存 |

**API Key 输入框**特殊行为（不变）：
- 显示态：等长 `*` 串（`********`）
- 编辑态：明文，blur 后立即变 `*`
- 复制按钮：禁用（避免泄漏）

**v3 折叠/展开规则**：
- 默认：profile 个数 ≤ 1 时自动展开；> 1 时全部折叠（手风琴展开 1 条）
- 折叠态显示一行摘要：`▾ <id> · <mode> · <Key 状态 ✅/❌/⚠>`
- 展开态显示完整字段表 + `[测试此 profile]` + `[删除]`

### 4.3 Default Agent Tab — Artifex Nexus 默认 agent 用哪个模型（不变）

| 字段 | 类型 | openclaw.json 路径 | 说明 |
|---|---|---|---|
| `defaultModel` | string `<provider>/<model>` | `agents.defaults.model`（string 形式） | 主模型 |
| `fallbackModels[]` | array | `agents.defaults.model.fallbacks`（object 形式） | 主模型失败的兜底链 |
| `imageModel` | string | `agents.defaults.imageModel` | 图片输入模型 |
| `imageGenerationModel` | string | `agents.defaults.imageGenerationModel` | 图片生成模型 |
| `thinkingDefault` | enum | `agents.defaults.thinkingDefault` | off/minimal/low/medium/high/xhigh/adaptive/max |
| `reasoningDefault` | enum | `agents.defaults.reasoningDefault` | on/off/stream |

**模型下拉**：列出所有 provider × models 笛卡尔积（如 `openai/gpt-4o-mini`、`deepseek/deepseek-chat`），
用户选一个即可。

### 4.4 数据流：Provider 详情内联 Auth（v3 重写）

**新建 provider（用模板）**：
1. 选模板 → 自动建 1 个 provider + 1 行 model（UX-B）+ 1 个 auth profile（id=`<provider_id>-default`，mode=api-key）
2. `auth.order.<provider_id> = [<that profile id>]` 自动维护
3. 焦点直接落到内联 Auth 区的 API Key 输入框

**新建 provider（空白 / 自定义）**：
- 不自动建 auth profile（用户可能想关联已有 profile）
- 内联 Auth 区显示 `[+ 新增 profile]` 与 `[关联已有 profile ▾]`（高级模式才显示后者）

**多 profile（高级用例）**：
- 在内联区点 `[+ 新增 profile]` → 自动 id=`<provider>-2`、`<provider>-3` 递增
- 第一条作为 `auth.order.<provider>[0]`（"默认 profile"），其余追加
- 拖拽改顺序（v3.1 再做，v3.0 用上下箭头）

**删除 profile**：
- 内联区点 `[删除]` → 二次确认（"此 provider 将无可用凭据，确定？" 当只剩 1 个时）
- 删除后从 `auth.order.<provider>` 数组里同步剔除

## 5. 状态机

```
[关闭] ──按"设置"──→ [加载中] ──RPC openclaw.config.dump──→ [就绪]
                        │ 失败                                  │
                        ▼                                       │
                     [错误屏]                                   │
                                                                │
[就绪] ──切 tab/选条目──→ [浏览] ──编辑字段──→ [脏]           │
                                                  │             │
                                              按"测试连接"      │
                                                  ▼             │
                                              [测试中] ──→ [脏] │
                                                                │
[脏] ──按"保存"──→ [构建 patch] ──RPC openclaw.config.patch──→ [就绪]
   │                  │ schema 不通过                            │
   │                  ▼                                          │
   │              [错误 toast]，回 [脏]                          │
   │                                                             │
   └ 按"取消" + 有未保存 → [二次确认 dialog]                   │
                              │ 丢弃                             │
                              ▼                                  │
                           [关闭]                                │
```

## 6. 与 sidecar / openclaw.json 的对接（v2 重写）

### 6.1 新增 sidecar JSON-RPC 方法

| 方法 | 入参 | 返回 | 实现要点 |
|---|---|---|---|
| `openclaw.config.dump` | `{}` | `{providers, authProfiles, agentDefaults}`（apiKey 脱敏） | 内部 spawn `openclaw config get models / auth / agents.defaults` 三次合并；apiKey 字段全替成 `***` |
| `openclaw.config.patch` | `{patch: <json>}` | `{success, validateError?}` | 内部 spawn `openclaw config patch --stdin --strict-json`，把 patch JSON 喂进去；OpenClaw 自带 schema validate |
| `openclaw.config.test_provider` | `{providerId, modelId, authProfileId}` | `{success, latencyMs?, modelEcho?, error?}` | 内部 spawn `openclaw infer --provider <id> --model <m> --prompt "ping"`（待深挖 `infer` 子命令；fallback HTTP 直 ping baseUrl） |

### 6.2 写入策略（核心变更：不再 read-modify-write，全部走官方 patch）

**v1 错误做法**（已废弃）：sidecar 直接 read/write `openclaw.json`，手工深合并。
**v2 正确做法**：所有写入走 `openclaw config patch --stdin`，由 OpenClaw 自身做 schema validate + atomic write。

理由：
- OpenClaw 自带 schema validate，自己写有 100% schema 漂移风险
- patch 命令的合并语义是 OpenClaw 钦定的（对象 merge / 数组 replace / null 删字段）
- atomic write、热重载触发都由 OpenClaw 内部处理，不要重发明轮子

### 6.3 删 provider / auth profile 的实现

```bash
# 删 provider
echo '{"models":{"providers":{"deepseek":null}}}' | openclaw config patch --stdin

# 删 auth profile
echo '{"auth":{"profiles":{"openai-default":null}}}' | openclaw config patch --stdin
```

`null` 在 patch 语义里 = 删字段（[[openclaw-upstream-survey]] §13.6）。

### 6.4 API Key 不上 RPC 回前端明文

- `dump` 返回的 apiKey 强制替换为长度等长的 `***...`
- `patch` 收到的 apiKey 若仍是 `***...`（用户未改）→ sidecar 调用前从 patch 中**删掉该字段**，
  让 OpenClaw 保留旧值（patch 缺失字段 = 不变）
- 前端 React state 的明文 apiKey 仅在 modal 生命周期内持有，关闭立即清空

## 7. 安全与隐私

- API Key 不进日志、不进 Tauri event payload、不进崩溃报告
- `test_provider` 请求体不进日志（只记 `provider / model / latency / status`）
- spawn `openclaw config patch` 时 stdin 直传 JSON，**不写临时文件**（避免落盘明文）

## 8. 国际化

- 当前 M1 仅中文；字符串集中在 `apps/desktop/src/features/openclaw/settings.i18n.ts`
- 中文术语统一：
  - "提供商"（Provider）
  - "鉴权凭据"（Auth Profile）
  - "默认 Agent 模型"（Default Agent Model）
  - "接口地址"（Base URL）
  - "模型 ID"（Model ID）
  - "高级配置"（Advanced）

## 9. 与 STORY-0017（agent 预设）的接口

设置面板底部"重置 Artifex Nexus 默认 agent 预设"按钮：
- 触发 sidecar RPC `openclaw.agent_preset.reset_default`（STORY-0017 实现）
- 二次确认 dialog："这会覆盖现有 Artifex Nexus agent 预设，但不影响你创建的其它 agent。继续？"

Tab "Default Agent" 内的"defaultModel"字段会被 STORY-0017 的预设直接消费——
预设里 `agents.list[<artifex-nexus>].model` 不写死，引用 `agents.defaults.model`，
所以本 Tab 的修改自动对 Artifex Nexus 默认 agent 生效。

## 10. 实测约束 / TBD

| # | 项 | 何时解 |
|---|---|---|
| P1 | `models.providers.<id>` 的 additionalProperties 子树（具体字段名 `protocol` / `baseUrl` / `headers` / models[] 内字段） | STORY-0015 implement 时 `node` 抽 slice 文件确认 |
| P2 | `auth.profiles.<id>` 的字段名（`token` / `apiKey` / `secret` 哪个名字） | 同上 |
| P3 | `infer` 子命令是否能用作"测试连接"，还是只能 HTTP 直 ping | implement 时 `openclaw infer --help` 实测 |
| P4 | OpenClaw 上游字段不存在时（如 `displayName` / `notes`），降级落点 | wrapper extras `~/.artifexnexus/.openclaw/state/artifex-nexus-extras.json` 的 `providerExtras.<id>.*` |
| P5 | **Settings Spec v3** — 是否合并 Auth Tab、内联到 Provider 详情；模板是否带默认 model | ✅ 2026-05-07 决议：本文升 v3（2 Tab + Provider 内联 Auth + UX-B 模板默认 model），见 [[_spikes/provider-ux-survey]] §3 / §4 |

## 相关

- [[../tasks/backlog/STORY-0015-openclaw-settings-panel]]
- [[openclaw-upstream-survey]] §13（spike 真相）
- [[_spikes/provider-ux-survey]]（Roo Code / OpenClaw 上游 UX 调研，v3 候选形态）
- [[openclaw-agent-preset]]（联动）
- [[ui/installer-structure]] §11
- [[openclaw-wrapper-ipc]]
