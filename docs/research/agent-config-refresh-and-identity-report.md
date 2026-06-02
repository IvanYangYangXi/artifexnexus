# systemPromptOverride vs IDENTITY/SOUL/USER.md 深度分析

> 第三轮调研补充 v2.0：基于 OpenClaw 官方设计哲学的重新评估
> 日期：2026-06-01

---

## 1. 决策反转：之前的"删除三个 md 文件"建议是错的

第一版报告（v1）建议删除 `IDENTITY.md / SOUL.md / USER.md` 预置，但用户的质疑非常关键："agent 缺失了一些信息"。

**经过深入调研 OpenClaw 官方文档后确认：v1 建议必须否定。**

---

## 2. OpenClaw 官方设计哲学（关键事实）

### 2.1 BOOTSTRAP → 三大 .md 是 OpenClaw 的**核心设计**，不是可选附件

OpenClaw `BOOTSTRAP.md` 模板原文：
> "你刚刚醒来。该弄清楚你是谁了。"
> "你的名字 / 你的性质 / 你的风格 / 你的 emoji"
> "用你了解到的内容更新这些文件：
> - `IDENTITY.md` - 你的名字、生物、风格、emoji
> - `USER.md` - 他们的名字、如何称呼他们、时区、备注
> - `SOUL.md` - 对他们来说重要的事 / 他们希望你如何表现 / 边界或偏好"

这是 OpenClaw **「智能体醒来 - 认识用户 - 形成人格」** 的核心叙事，不是技术细节。

### 2.2 systemPromptOverride **会丢失大量自动注入内容**（关键发现）

官方文档明确：使用 `systemPromptOverride` 时，**整个 OpenClaw 组装的系统提示被完全替换**，意味着同时丢失：

| 丢失内容 | 影响 |
|---|---|
| **Runtime 行**（时区、时间格式、repoRoot） | LLM 不知道当前时间和工作目录 |
| **工具描述** | （文档未明示是否在系统提示中，但有风险） |
| **Skills 紧凑列表** | LLM 不知道有哪些 Skill 可用 → 影响 `nexus-agent-guide` 等关键 Skill 的发现 |
| **Heartbeat 部分** | 心跳定时任务上下文丢失 |
| **memory/*.md 启动上下文** | `/new` `/reset` 时不会注入最近 2 天的 daily memory |
| **postCompactionSections** | 压缩对话后无法重新注入 `Session Startup` `Red Lines` |
| **Prompt Overlays**（GPT-5 行为契约等） | 跨模型一致性丧失 |
| **沙箱浏览器 noVNC URL** | 启用沙箱时 LLM 不知道浏览器入口 |
| **IDENTITY/SOUL/USER.md** | 人格设定完全无效 |
| **AGENTS.md / TOOLS.md / BOOTSTRAP.md**（必需文件） | 工作流约定、工具调用规范丢失 |

**重要：没有任何官方选项可以"部分保留"——是全有或全无。**

文档原话："**适用于受控的提示实验**" → 这是 A/B 测试用的开关，**不是生产环境的常规配置手段**。

### 2.3 当前 Artifex Nexus 的现状（v1 改后）

```json
"systemPromptOverride": "... 约 1300 字符平台说明 ...",
```

带来的实际后果：
- ✅ 用户能在设置面板编辑这一个字段 — 看似集中
- ❌ Skills 列表不会自动注入 → AI 不知道有哪些 Skill 可加载
- ❌ memory/*.md 不注入 → 跨会话日常记忆失效
- ❌ AGENTS.md 不注入 → 平台约定丢失
- ❌ Heartbeat 不工作（如启用了 cron）
- ❌ Runtime 信息丢失 → AI 不知道当前时间

**当前配置实际上削弱了 OpenClaw 的核心能力，换取了"集中编辑"的便利性，得不偿失。**

---

## 3. 三种可选方案对比

### 方案 A：保留 systemPromptOverride（**现状**）
- ✅ 设置面板可视化编辑（一个字段搞定）
- ❌ 丢失 Skills/memory/Heartbeat/AGENTS.md/Runtime 信息
- ❌ identity 文件预置等于摆设
- 适用场景：**实验性 prompt 调试**，**不适合**生产

### 方案 B：删除 systemPromptOverride，启用 IDENTITY/SOUL/USER.md（**推荐**）
- ✅ 保留 OpenClaw 全部自动注入能力（Skills/memory/Heartbeat/Runtime）
- ✅ 人格信息按 OpenClaw 标准方式组织
- ✅ 平台知识可分流：通用人格放 SOUL.md，平台知识放 AGENTS.md
- ❌ 用户编辑需要打开 workspace 目录（设置面板暂未提供 .md 文件编辑器）
- ❌ 改动较大，需要重新分配内容

### 方案 C：双轨制并存（不可行 → 已排除）
OpenClaw 设计上是互斥的，不存在合并模式。

---

## 4. 推荐方案 B 的具体执行设计

### 4.1 内容分流原则

| 内容类型 | 原 systemPromptOverride 位置 | 新位置 |
|---|---|---|
| 智能体名字 / 性格 / emoji | 整体写在 prompt 里 | **IDENTITY.md** |
| 核心信条、行为准则、边界 | 整体写在 prompt 里 | **SOUL.md** |
| 用户称呼、时区、备注 | 未涉及 | **USER.md** |
| 平台核心知识（DCC/Skill/Tool/MCP） | 整体写在 prompt 里 | **AGENTS.md**（H2/H3 分节） |
| 调用约定、安全边界 | 整体写在 prompt 里 | **AGENTS.md → `## Red Lines`** |
| 沟通风格 | 整体写在 prompt 里 | **SOUL.md** |

### 4.2 新文件草案

#### `IDENTITY.md`
保持现有内容（已经合理）：
```markdown
# IDENTITY

- **名字**：Nex
- **本质**：AI Agent，Artifex Nexus 平台的默认助手...
- **性格**：简洁、专业、不啰嗦...
- **emoji**：🔗
```

#### `SOUL.md`
保持现有内容（已经合理）。

#### `USER.md`
保持现有内容（已经合理）。

#### `AGENTS.md`（**新增** — 把平台知识从 systemPromptOverride 迁过来）
```markdown
# AGENTS - Artifex Nexus 平台约定

## Session Startup
你是 Artifex Nexus 平台的默认智能助手。
平台核心能力板块：Chat / Skill / Nexus-Tool / DCC 桥接（MCP）/ 通知系统。
完整功能清单与操作指南见 nexus-agent-guide Skill（分层索引，按需加载）。

## 平台界面
... (Web UI 四面板布局说明)

## Skill 与 Tool 系统
... (Skill / Nexus-Tool 定义)

## MCP 连接与 DCC 操作
... (MCP 连接说明 + 调用约定)

## Red Lines
- 不直接通过文件系统读写 workspace 外的文件...
- 删除/覆盖/执行 shell 的操作必须先口头确认
- API Key / token / 密码绝不写入代码或日志
- 超过 10 个文件的批量操作必须先确认
```

#### `agents.list[].systemPromptOverride`
**清空（删除字段）** — 让 OpenClaw 自动组装。

#### `agents.list[].identity`（**新增结构化字段**）
```json
"identity": {
  "name": "Nex",
  "theme": "Artifex Nexus 平台助手",
  "emoji": "🔗"
}
```
这个字段驱动渠道功能（mention 匹配、响应前缀、头像）。

### 4.3 实施步骤

| # | 步骤 | 涉及文件 |
|---|---|---|
| 1 | 新增 AGENTS.md 模板资产 | `assets/agents/workspace/AGENTS.md` |
| 2 | 修改 bootstrap.py：预置 AGENTS.md（必需文件） | `bootstrap.py::_WORKSPACE_IDENTITY_FILES` |
| 3 | 修改 agent preset 模板：清空 systemPromptOverride，新增 identity 字段 | `artifex-nexus.preset.json.tpl` |
| 4 | （可选）删除 `system-prompt.txt` 资产（不再使用） | `assets/agents/artifex-nexus.system-prompt.txt` |
| 5 | 升级 PRESET_VERSION（让重装时强制升级） | `agent_preset.py::PRESET_VERSION` |
| 6 | UI 调整：systemPromptOverride 字段加说明"留空使用 OpenClaw 标准组装（推荐）" | `SettingsPage.tsx` |

### 4.4 反向兼容

- 已安装的用户重装时，由于 PRESET_VERSION 升级，会触发 preset 重写
- 旧的 systemPromptOverride 内容已迁移到 AGENTS.md，功能不退化反而增强
- 设置面板的"系统提示词"字段保留可见（用户高级实验时可用）

---

## 5. 关于刷新按钮（保持 R1 计划不变）

R1（设置页加刷新按钮）独立于方案选择，仍按原计划执行：5 分钟即可。

---

## 6. 综合改进计划 v2

| # | 改进项 | 优先级 | 时间 | 备注 |
|---|---|---|---|---|
| **R1** | **设置页加「刷新」按钮** | **P1** | **5 min** | 独立任务，立刻做 |
| **R2'** | **新增 AGENTS.md 模板资产** | **P1** | **15 min** | 把平台知识从 systemPromptOverride 迁移过来 |
| **R3'** | **修改 preset 模板：清空 systemPromptOverride，加 identity 字段** | **P1** | **10 min** | 启用 OpenClaw 标准组装 |
| **R4'** | **bootstrap.py：把 AGENTS.md 加入预置列表** | **P1** | **5 min** | |
| **R5'** | **升级 PRESET_VERSION** | **P1** | **2 min** | 触发已安装用户的重新应用 |
| **R6'** | **UI 文案优化** | **P2** | **3 min** | "留空使用 OpenClaw 标准组装（推荐）" |
| R7 | （可选）资产清理：删旧 system-prompt.txt | P3 | 2 min | 确认无引用后再删 |

**总计 P1+P2：40 min**

---

## 7. 关键决策点（请用户确认）

### 决策 1：是否采用方案 B（推荐）？

| 维度 | 方案 A（现状） | **方案 B（推荐）** |
|---|---|---|
| Skills 自动列表 | ❌ 丢失 | ✅ 保留 |
| memory/*.md 注入 | ❌ 丢失 | ✅ 保留 |
| Heartbeat 系统 | ❌ 丢失 | ✅ 保留 |
| Runtime 信息（时区/时间） | ❌ 丢失 | ✅ 保留 |
| AGENTS.md Session Startup | ❌ 丢失 | ✅ 保留 |
| 设置面板编辑 | ✅ 一处 | ⚠️ 需打开 workspace 目录 |
| 符合 OpenClaw 设计哲学 | ❌ 反向 | ✅ 一致 |
| 升级路径 | 跟随上游 prompt 改动需手动同步 | 跟随上游自动组装 |

### 决策 2：是否需要在设置面板提供 .md 文件编辑器？

- 选项 1：本次不做，用户用任意编辑器打开 workspace 即可（推荐）
- 选项 2：本次新增简单的 .md 编辑器 Tab（额外 30 min）
- 选项 3：增加"打开 workspace 目录"按钮（5 min）

**建议**：选项 3 — 在 Agent Tab 顶部加一个「打开 Workspace 目录」按钮，调用系统文件管理器，无需自己实现编辑器。

---

## 8. 总结

**前一版报告错误地建议"删除 identity 文件"，这是基于"systemPromptOverride 已经够用"的错误假设。**

实际上：
- IDENTITY/SOUL/USER.md 是 OpenClaw 核心设计，不该绕过
- systemPromptOverride 会丢失大量关键自动注入（Skills、memory、Heartbeat、Runtime 等）
- 正确的做法是**反过来**：删除 systemPromptOverride，把内容分流到 OpenClaw 标准的引导文件，启用其全部能力

请确认是否采用方案 B 推进。
