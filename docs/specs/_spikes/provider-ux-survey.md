---
tags: [spike, ui, openclaw, settings, research]
created: 2026-05-07
updated: 2026-05-07
status: draft
related_specs:
  - "[[../openclaw-settings-panel]]"
  - "[[../openclaw-upstream-survey]]"
related_story: "[[../../tasks/in-progress/STORY-0015-openclaw-settings-panel]]"
---

# Provider 设置 UX 调研（Roo Code · OpenClaw 上游）

> 目标：在重写 [[../openclaw-settings-panel]] 为 v3（Provider 内联 Auth）前，
> 摸清两条参考实现的形态、利弊与对我们落地的启示。
>
> 触发：用户提示"参考 Roo Code 与 OpenClaw 自身的供应商设置"。
>
> **本文是 spike 产物**，不是最终 spec；结论需回填到 [[../openclaw-settings-panel]] 的 §2 / §4 / §10。

## 0. 调研边界

| 维度 | 含 | 不含 |
|---|---|---|
| 形态对比 | 信息架构、字段分组、内联 vs 独立 Tab、模板填充 | 视觉样式细节、CSS |
| 数据模型 | provider/profile 是否解耦、key 存储位置 | 加密算法 |
| UX 流程 | "新增 provider 即可立即填 Key"路径 | 高级运维（fallback 链路、cooldown） |

## 1. Roo Code（VS Code 扩展，开源）

### 1.1 信息架构

Roo Code 的 Provider Settings 是 **"单 profile = 单 provider 一组"** 的扁平设计，没有"模型表"与"鉴权表"解耦：

```
┌─ Settings · Providers ───────────────────────────────────┐
│  [Profile A: openai-prod  ▾ ]  [+ New]  [Duplicate] [×]  │
│  ─────────────────────────────────────────────────────── │
│  API Provider:        ▾ OpenAI                           │
│  Base URL (override): https://api.openai.com/v1          │
│  API Key:             [********************] [👁]        │
│  Model:               ▾ gpt-4o-mini                      │
│                       (从所选 provider 的内置 catalog 拉) │
│  ─────────────────────────────────────────────────────── │
│  ▽ Advanced                                              │
│    Temperature: [ 0.0 ]  Max tokens: [ 4096 ]             │
│    Reasoning effort: ▾ medium                            │
│    Custom headers: { ... }                               │
└──────────────────────────────────────────────────────────┘
```

### 1.2 关键 UX 决策

1. **每个 profile 自带一个 provider + 一个 model + 一个 key**
   - 解耦在数据层（profile 是顶级），但 UX 层"全合并到一张表"
   - 切换 profile 等价于切换"provider + model + key"三件套
2. **provider 选择即触发 catalog**
   - 选 "OpenAI" → Model 下拉自动填入 `gpt-4o`、`gpt-4o-mini`、`o1` 等内置列表
   - 选 "OpenAI Compatible" → Model 变成纯文本输入（不知道有什么模型）
   - 选 "Anthropic" → 内置 Claude 全家桶
3. **Key 输入框带眼睛切换显隐 + 不脱敏返显**（与 OpenClaw 的安全要求冲突）
4. **没有"模板"概念**
   - "New Profile" → 默认 provider=Anthropic + Claude 3.5 Sonnet，从这个起点改
   - 用户复制 (`Duplicate`) 已有 profile 来快速派生
5. **"Test"按钮就在表单底部**，结果即时显示

### 1.3 与我们当前 v2 的对比

| 维度 | Roo Code | 我们 v2（当前实现） | OpenClaw 数据真相 |
|---|---|---|---|
| 数据模型 | 1 profile = 1 (provider, model, key) | provider 表 + auth 表解耦（Tab 切换） | provider 表 + auth 表解耦（与我们一致） |
| 切换粒度 | 切 profile 一步切 3 件 | 切 provider / 切 auth 两步 | 任意组合（auth.order 数组） |
| 模型来源 | provider 内置 catalog（写死在扩展里） | 用户手填 model id | provider 内置 catalog（`models list`） + 自定义 |
| Key 显示 | 眼睛切换显隐 | 等长 `*` 脱敏，blur 立即变回 | 由 `auth.profiles.<id>.token` 存储；CLI 可 `--ref-source env` |
| 模板 | 无（Duplicate 替代） | 11 个内置模板 | 无 |

### 1.4 启示

- **Roo 的扁平 profile**对入门友好，但**不能表达"一个 provider 多个 key 轮转"**这种 OpenClaw 一等公民场景；
- 我们 v2 的 Tab 切换**符合 OpenClaw 数据模型**，但**典型场景（一个 provider 一个 key）需要两次跳转**——这是 v3 要解决的痛点；
- Roo 的"provider 选完即出 model 下拉"是 STORY-0015 UX-B（模板带默认 model）的天然形态，应当抄过来。

## 2. OpenClaw 上游（CLI + Control UI）

### 2.1 CLI 设置流（`openclaw models auth` 子命令族）

来自 [[../openclaw-upstream-survey]] §13.1：

```
openclaw models auth add        # 交互式新增 profile：选 provider → 选 mode → 输 token
openclaw models auth list       # 列出所有 profile
openclaw models auth login      # OAuth 流（GitHub Copilot / Anthropic Claude.ai）
openclaw models auth login-github-copilot
openclaw models auth order      # 改 auth.order.<provider> 的失败转移顺序
openclaw models auth paste-token
openclaw models auth setup-token
```

**关键观察**：CLI 把"创建 provider"与"配 auth"**视作同一动作的两步**——`models auth add` 必须先选已有 provider。

### 2.2 Control UI（dashboard）的 Provider/Auth 形态

> 实测受限：本机 OpenClaw 全局安装已损坏（`Cannot find module openclaw.mjs`），且 wrapper 隔离目录尚未 install。
> 本节基于 [[../openclaw-upstream-survey]] §14（T7 spike 已确认 dashboard 入口与 gateway.port 复用）+ schema 分析推断。

OpenClaw Control UI 的 Models 页是**两栏布局**（来自 schema `ui.dashboard.layout`）：

```
┌─── Providers (left) ────┐ ┌── Profile Detail (right) ────┐
│ ◉ openai                │ │ Provider: openai (read-only)  │
│ ○ anthropic             │ │                                │
│ ○ google                │ │ Active profiles (auth.order):  │
│ [+ Add provider]        │ │  1. openai-personal  [×]       │
│                         │ │  2. openai-team      [×]       │
│                         │ │  [+ Add profile to provider]   │
│                         │ │                                │
│                         │ │ Models from this provider:     │
│                         │ │  • gpt-4o-mini  [default]      │
│                         │ │  • gpt-4o                      │
│                         │ └────────────────────────────────┘
└─────────────────────────┘
```

也就是上游**自己**就把 auth profiles **内联进了 provider 详情**——只是把 `auth.order.<provider>` 当成 provider 的"子表"渲染，而不是另开一个 Tab。

### 2.3 启示

- 上游 UI 形态≈"Provider 详情里嵌一个 profile 列表 + 各种 add/remove"，与 v3 候选完全吻合；
- 我们独立的 "Auth Profiles Tab" 在 v2 里其实是**对 schema 的字面映射**，不是对 UX 的最佳映射——上游用户的心智里 profile 是**属于** provider 的；
- "Add profile to provider" 这个动作应该**就在 provider 详情里**触发，而不是要求用户先切 Tab、再选 provider 下拉。

## 3. v3 候选形态（提案）

```
┌─────────────────── Providers Tab ───────────────────┐
│ ┌── 列表 ──┐ ┌─────────── 详情 ───────────────────┐ │
│ │ ◉ openai │ │ Provider ID:  openai (固定)         │ │
│ │ ○ deepseek│ │ Display Name: [ OpenAI         ]   │ │
│ │ ...      │ │ Protocol:     ▾ openai             │ │
│ │ [+模板▾] │ │ Base URL:     [...]                 │ │
│ └──────────┘ │                                     │ │
│              │ ▽ Models（已自动从模板填充 1 行）    │ │
│              │   • gpt-4o-mini [默认] [×]          │ │
│              │   • gpt-4o            [×]          │ │
│              │   [+ 添加 model id]                  │ │
│              │                                     │ │
│              │ ▽ Auth Profiles（内联，本 provider）│ │
│              │   ▸ openai-default  · api-key  · ✅ │ │ ← 折叠/展开，展开是表单
│              │      Mode:    ▾ api-key             │ │
│              │      API Key: [********]            │ │
│              │      Email:   [...]                 │ │
│              │      [测试] [删除此 profile]         │ │
│              │   [+ 新增 profile]                   │ │
│              │                                     │ │
│              │ ▽ 高级配置                          │ │
│              │   maxTokens / temperature / headers │ │
│              │                                     │ │
│              │ [测试连接] ……  [删除 provider]      │ │
└──────────────┴─────────────────────────────────────┘

[Default Agent] Tab 保留，[Auth Profiles] Tab 删除（保留路由作为 deep link，仍可工作）
```

### 3.1 与 v2 的差异 diff

| 区域 | v2 | v3 提案 |
|---|---|---|
| Tab 数 | 3 个：Providers / Auth / Default Agent | 2 个：Providers（含内联 Auth）/ Default Agent |
| 新建 provider | 模板填 baseUrl + protocol，**模型空** | 模板填 baseUrl + protocol + **默认 1 个 model** |
| 创建 auth | 勾选"同时新建"才会自动建 1 个 | 默认勾选 + 在 provider 详情里直接编辑 |
| 编辑 auth | 切到 Auth Tab，从下拉选 profile | provider 详情下方折叠区，原地编辑 |
| 多 profile / 一 provider | 切到 Auth Tab 加 | provider 详情区点 "+ 新增 profile"，不切 Tab |
| auth.order 顺序 | UI 不可见（数组 [0] 即默认） | 在内联区按拖拽改顺序（v3.1 再做） |

### 3.2 与 OpenClaw 数据契约

**全部不变**：v3 仍然 dump → `models.providers` + `auth.profiles` + `auth.order`，
patch 仍然走 `openclaw config patch --stdin`（[[../openclaw-upstream-survey]] §13.6）。
v3 是纯前端组合方式调整，**不影响 sidecar JSON-RPC 协议**，不需要后端 PR。

### 3.3 留存的 Auth Tab？

- **保留路由**：URL/state 里 `tab=auth` 仍可访问，作为"高级模式"展示全局 profile 总览
  - 适合"我有 30 个 OpenAI key 要轮转"的高级用户
- **默认隐藏入口**：顶部 Tab 条只显示 Providers + Default Agent
- **入口**：点 provider 详情里"全部 profiles 总览"链接 → 跳到 Auth Tab，并 deep-link 到当前 provider 过滤

## 4. UX-B（模板带默认 model）落地点

| 模板 key | 建议默认 model | 备注 |
|---|---|---|
| openai | `gpt-4o-mini` | 性价比 + 高 capability |
| anthropic | `claude-3-5-sonnet-20241022` | 通用首选 |
| google | `gemini-2.0-flash-exp` | 速度快 |
| azure-openai | `(用户填 deployment 名)` | 留空，因为 deployment 名用户决定 |
| ollama-local | `llama3.2:latest` | 大多数本地用户起手 |
| deepseek | `deepseek-chat` | |
| volcengine-doubao | `doubao-pro-32k` | |
| aliyun-qwen | `qwen-plus` | |
| openrouter | `anthropic/claude-3.5-sonnet` | OpenRouter 路由格式 |
| lmstudio | `(留空)` | 本地用户决定 |
| custom | `(留空)` | 全空白 |

> 标"留空"的模板**不**塞 default model（避免出错），其它都默认插 1 行 + isDefault=true。
> 用户随时可改 / 删 / 加。

## 5. 决策建议（待 product 拍板）

1. **是否上 v3（Tab 合并 + 内联 Auth）**？
   - ✅ 推荐：UX 与 OpenClaw 上游 Control UI / 用户心智一致；
   - 风险：reducer 已稳定，需要拆 `ProvidersTab` 拆出 `AuthInlineSection`；测试要补 ~6 条；
   - 工作量：~0.5d 实施 + 0.5d 测试。

2. **是否做 UX-B（模板带默认 model）**？
   - ✅ 推荐：纯增益，无破坏性，低风险；
   - 工作量：~0.5h（types + reducer + test）。

3. **顺序**？
   - 推荐先做 UX-B（半小时见效，不阻塞 v3）→ 再上 v3（与 §3 决策一起拍）。

## 6. 后续工作

- [ ] 待 product 确认 v3 形态后，回填 [[../openclaw-settings-panel]] 为 v3，标 `version: v3-inline-auth`
- [ ] [[../openclaw-settings-panel]] §10 P1/P2 字段名持续深挖（与 v3 解耦，不阻塞）
- [ ] 修复本机 OpenClaw 全局安装并实测 Control UI 截图回填本文 §2.2

## 相关

- [[../openclaw-settings-panel]]（待重写为 v3）
- [[../openclaw-upstream-survey]] §13/14（schema 真相）
- [[../../tasks/in-progress/STORY-0015-openclaw-settings-panel]]
- Roo Code 仓库：https://github.com/RooVetGit/Roo-Code （`webview-ui/src/components/settings/providers/`）
