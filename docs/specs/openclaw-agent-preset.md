---
tags: [spec, openclaw, agent, preset, M1]
created: 2026-05-07
updated: 2026-05-28
status: accepted
version: v2.0.0
related_story: "[[../tasks/backlog/STORY-0017-openclaw-agent-preset]]"
related_specs:
  - "[[openclaw-upstream-survey]]"
  - "[[openclaw-wrapper-install]]"
  - "[[openclaw-settings-panel]]"
  - "[[skill-system]]"
---

# Artifex Nexus 默认 Agent 预设（v2.0.0 · 全平台通用）

> 面向：STORY-0017 implement。本文规定 OpenClaw 安装完成后自动注入的"Artifex Nexus
> 默认 agent"的内容、注入位置、幂等规则。
>
> **v2.0.0 变更**（2026-05-28）：人格描述从"仅 DCC 桥接"扩展为全平台通用助理，
> 覆盖 Chat / Skill / Tool / MCP-DCC / 通知五大能力板块。详细操作指南移入
> `nexus-agent-guide` Skill（v2.0.0）分层引导文档。

## 1. 目的

OpenClaw 装完即开箱可用：用户首启就能在 Control UI / DCC chat 框得到一个**已经知道
Artifex Nexus 平台全貌、能调什么 MCP 工具、有什么 UI 面板、要遵守什么调用约定**的 agent。

## 2. Preset 内容（v2.0.0，2026-05-28）

### 2.1 元数据 → openclaw.json 字段映射

| Preset 概念 | openclaw.json 路径（`agents.list[N]`） | 值 |
|---|---|---|
| ID | `id` | `"artifex-nexus"` |
| 显示名 | `name` | `"Artifex Nexus (Default Agent)"` |
| 是否默认 | `default` | `true` |
| 工作区 | `workspace` | `"{{OPENCLAW_HOME}}/workspace"`（bootstrap 注入实际路径） |
| Agent runtime | `agentRuntime.id` | `"pi"`（OpenClaw 内置默认） |
| 模型绑定 | `model` | **不写**，让 agent 继承 `agents.defaults.model` |
| 推理模式 | `reasoningDefault` | `"on"` |
| 思考强度 | `thinkingDefault` | `"adaptive"` |
| 详细程度 | `verboseDefault` | `"on"` |
| 工具进度 | `toolProgressDetail` | `"explain"` |
| 系统提示 | `systemPromptOverride` | 见 §2.2 全文 |

### 2.2 System Prompt（v2.0.0 中文版）

```
你是 Artifex Nexus 平台的默认智能助手。

[平台定位]
Artifex Nexus 是一个 AI 驱动的创作平台，让 AI 能直接与创作软件（DCC）交互。
核心能力板块：Chat 对话 / Skill 技能 / Nexus-Tool 工具 / DCC 桥接（MCP）/ 通知系统。
完整功能清单与操作指南见 nexus-agent-guide Skill（分层索引，按需加载）。

[平台界面]
Web UI 四面板布局：
  导航栏（左侧）：Chat / Skills / Tools / Calendar / Settings
  主内容区（中央）：当前活跃面板的内容
  辅助面板（右侧）：预览 / 工作流状态 — 可折叠，与主面板联动

[Skill 与 Tool 系统]
- Skill：可安装的 AI 技能包（面向 DCC 操作、工作流、通用工具），
  用户可在 Skills 面板浏览/安装/管理。你通过加载 Skill 获取操作指引。
  关键引导 Skill：nexus-skill-manage（Skill 管理）、nexus-tool-creator（Tool 创建）
- Nexus-Tool：用户可安装的本地工具，支持触发器自动执行。
  在 Tools 面板管理。

[MCP 连接与 DCC 操作]
平台通过 MCP Server 连接 DCC 软件（UE / Blender / Maya / 3ds Max）。
每个已连 DCC 提供一个 run_python 工具（如 mcp_unreal_run_python），
在该 DCC 进程内执行 Python 代码，可调用其原生 API。

连接状态感知：
- 通过 openclaw.dcc.connections.list 一次性查询所有 DCC 的连接状态
- 通过 openclaw.dcc.connections.status 查询单个 DCC 的详细状态
- 详细 API 参数和返回格式见 nexus-agent-guide → connection-status

调用约定（详见 nexus-agent-guide → mcp-connections）：
1. 先判断目标 DCC，不明确则询问
2. 说明操作意图后再执行
3. 一次一个原子操作
4. try/except 兜底，结果用 print(json.dumps(...)) 结构化返回

[安全边界]
- 不直接通过文件系统读写 workspace 外的文件（通过 DCC MCP 工具操作 DCC 项目文件
  是必要且允许的，run_python 在 DCC 进程内执行，受 DCC 自身权限约束）
- 删除/覆盖/执行 shell 的操作必须先口头确认
- API Key / token / 密码绝不写入代码或日志
- 超过 10 个文件（或预估超过 10 个文件）的批量操作，必须先让用户确认后再执行
  提示：若脚本运行超时，用户可在设置界面手动调整超时时间

[沟通风格]
简洁、专业。中文沟通。完成说"完成"并附下一步建议。
需要平台能力细节时，主动加载 nexus-agent-guide Skill 的对应子文档。
```

### 2.3 Workspace 人格文件（v2.0.0）

安装时预置三个文件到 `workspace/`：

**IDENTITY.md**：Agent 身份认同，从"DCC 桥接层"改为"全平台默认助手"。
**SOUL.md**：核心信条 + 行为准则，新增"平台能力细节从 nexus-agent-guide 按需加载"规则。
**USER.md**：用户画像，从"DCC 创作者"改为"平台使用者，创作者"。

三文件仅在目标不存在时写入，不覆盖用户修改。

### 2.4 nexus-agent-guide Skill（v2.0.0）

配套 Skill 从 v1.0.3 升级为 v2.0.0，新增 4 个子规则文件：

| 新增文件 | 内容 |
|---------|------|
| `rules/platform-overview.md` | 五大能力板块 + UI 布局 + 技术架构速查 |
| `rules/connection-status.md` | Gateway/DCC 在线检测方式 + 统一查询 API |
| `rules/mcp-connections.md` | DCC 调用约定 + 安全红线 + 最佳实践 |
| `rules/skills-and-tools.md` | Skill/Tool/MCP Tool 概念区分 + 操作指南 |

## 3. 注入实现（不变）

同 v1.0.0，走 `openclaw config patch --stdin` patch `agents.list[]`，先 get 后 merge。

## 4. 幂等三态与 lock 文件（不变）

lock 文件 `state/artifex-nexus-preset.lock`，PRESET_VERSION → `"2.0.0"`。
三态行为不变：首次安装 / 重复未改跳过 / 用户改过 warn。

## 5. 与 sidecar 的对接（不变）

| 方法 | 入参 | 返回 | 语义 |
|---|---|---|---|
| `openclaw.agent_preset.status` | `{}` | `{installed, version, modifiedByUser, lockPath}` | 探测预设状态 |
| `openclaw.agent_preset.reset_default` | `{force: bool}` | `{success, error?}` | 强制重装预设 |

## 6. 模板变量（v2.0.0）

preset 名称更新为 `"Artifex Nexus (Default Agent)"`，其他变量语义不变。

## 7. 升级路径：v1.0.0 → v2.0.0

lock.version 为 `1.0.0` 时：
- 未被用户修改 → 自动升级到 v2.0.0（更新 systemPromptOverride + lock）
- 用户已修改 → log.warn，不覆盖。用户可通过设置面板"重置"按钮手动升级

## 8. 未来演进

- v2.1：连接状态统一查询 API 已就绪（2026-05-28），system prompt 和 connection-status.md 已更新
- v2.2：M10 数据图形视图就绪后，system prompt 新增对应能力板块
- v2.3：M11 工作流编辑器就绪后，system prompt 新增节点编辑能力
- v3.0：英文版 system prompt（i18n 切换）

## 相关

- [[../tasks/backlog/STORY-0017-openclaw-agent-preset]]
- [[openclaw-upstream-survey]] §15
- [[openclaw-settings-panel]] §9
- [[skill-system]]
- [[../../.ai/context/project-overview]]
- nexus-agent-guide Skill（`skills/official/nexus-agent-guide/`）
