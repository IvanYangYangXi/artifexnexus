# Cron 任务回复配置规则

cron 任务触发后，Agent 的回复如何投递到用户在 Control UI webchat 中看到。
本规则说明在 Artifex Nexus 环境（无外部消息渠道）下的两种正确配置方式，
以及如何根据任务频率选择合适的投递策略。

---

## 背景

Artifex Nexus 当前环境**没有配置外部消息渠道**（Signal/Telegram/Discord 等），只有 Control UI 的 webchat。

cron 的 `delivery.mode: "announce"` 依赖消息渠道推送 → **不可用**。

---

## 两种投递方式总览

| 方法 | 投递机制 | 用户在哪里看到 | 推荐场景 |
|------|----------|:---:|------|
| **方法一：sessions_send** | Isolated 会话执行 → `sessions_send` 推送到指定会话 | **指定会话内**显示为跨会话消息 | 高频任务（每小时/每天） |
| **方法二：新会话** | Isolated 会话执行 → 结果留在独立会话中 | **会话列表**出现新对话项 | 低频任务（每周/每月/一次性） |

---

## 方法一：sessions_send 推送到指定会话（推荐高频）

### 原理

```
Cron 触发 → 创建 isolated 会话运行 agentTurn
         → Agent 执行任务、生成结果
         → Agent 调用 sessions_send 推送到目标会话 sessionKey
         → 目标会话收到消息，显示为 [跨会话消息]
         → 用户在 webchat 中该会话里直接看到
```

**优点：**
- 结果直接出现在创建任务的对话中（用户无需切换会话即可查看）
- 不产生额外会话，保持会话列表整洁
- 历史结果集中在同一会话，方便回溯

**限制：**
- 用户必须打开目标会话才能看到实时消息
- 如果用户在浏览其他会话，消息会在后台写入（切换回来后可看到）

### 前提条件：`tools.sessions.visibility` 为 `"agent"` 或 `"all"`

```json
// openclaw.json 顶层必须包含
"tools": { "sessions": { "visibility": "all" } }
```

执行任务时用 `gateway config.get tools.sessions.visibility` 快速确认。当前环境已配置为 `"all"`。

可用值：

| 值 | 含义 |
|---|---|
| `"self"` | 只能看到当前会话 |
| `"tree"`（默认） | 当前会话 + 它 spawn 的子会话 |
| **`"agent"`** ✅ | 同一 agent id 的所有会话（可跨 session tree） |
| **`"all"`** ✅ | 所有会话，最宽松 |

> `"agent"` 和 `"all"` 都能解决 cron 跨树推送问题。`"agent"` 更安全（限同 agent），`"all"` 更宽松。

> ⚠️ **`tools.sessions.visibility` 是受保护路径，SIGUSR1 热重载不会加载其变更。**
> 修改后必须执行完整进程重启：`openclaw gateway restart`

### Cron Job 配置

```json
{
  "id": "job-uuid",
  "agentId": "artifex-nexus",
  "name": "任务名称",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 * * * *",
    "tz": "Asia/Shanghai"
  },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "⏰ 定时任务触发。\n\n步骤：\n1. 执行检查/操作...\n2. 汇总结果\n3. 【关键】调用 sessions_send 把结果推送到目标会话\n   - sessionKey: agent:artifex-nexus:session-<主会话ID>\n   - 发送完整的检查报告（包含通过/失败状态、具体问题列表）\n\n如果全部通过简要说通过，不通过列出具体问题。",
    "timeoutSeconds": 300
  },
  "delivery": {
    "mode": "none"
  }
}
```

### 关键参数说明

| 参数 | 值 | 说明 |
|------|-----|------|
| `sessionTarget` | `"isolated"` | 在独立会话中运行，不污染主会话 |
| `payload.kind` | `"agentTurn"` | Agent 处理任务 |
| `delivery.mode` | `"none"` | 不依赖渠道推送，改用 sessions_send |
| `agentId` | `"artifex-nexus"` | 与主 webchat 会话相同的 agent id |
| `delivery.channel` | **不设置** | 避免生成额外会话 |

### Prompt 中的 sessions_send 指令

在 `payload.message` 中必须明确要求 Agent 调用 `sessions_send`：

```
任务完成后，必须调用：
sessions_send sessionKey="agent:artifex-nexus:session-<主会话ID>"
发送完整的执行结果。格式：简洁报告，不要冗长。
```

**如何获取目标 sessionKey**：
- 在 webchat 中让 Agent 执行 `session_status` 查看当前 sessionKey
- 或通过 `sessions_list` 查找

---

## 方法二：新会话（推荐低频）

### 原理

```
Cron 触发 → 创建 isolated 会话运行 agentTurn
         → Agent 执行任务、生成结果
         → 结果保留在独立会话中（不推送到其他会话）
         → 用户的会话列表中出现一条新对话
         → 用户点击进入查看结果
```

**优点：**
- 结果独立存放，不会干扰当前活跃对话
- 适合作为"档案"长期保存
- 不需要指定目标 sessionKey，配置更简单
- 用户在任意会话中都能看到新会话出现（侧边栏提示）

**限制：**
- 结果不会在当前活跃对话中实时显示
- 用户需要手动点击进入新会话查看
- 高频任务会产生大量会话，造成列表杂乱

### Cron Job 配置

```json
{
  "id": "job-uuid",
  "agentId": "artifex-nexus",
  "name": "每周项目报告",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 9 * * 1",
    "tz": "Asia/Shanghai"
  },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "📊 每周项目报告时间到。\n\n请汇总本周项目进展、关键变更、待处理事项，生成一份简洁的周报。\n注意：不要调用 sessions_send，结果保留在当前会话中即可。",
    "timeoutSeconds": 300
  },
  "delivery": {
    "mode": "none"
  }
}
```

### 关键参数说明

| 参数 | 值 | 说明 |
|------|-----|------|
| `sessionTarget` | `"isolated"` | 独立会话执行 |
| `delivery.mode` | `"none"` | 不推送渠道 |
| `payload.message` | **不含** `sessions_send` | Agent 不主动推送，结果留在当前会话 |
| 额外会话 | 自动产生 | 用户侧边栏可见 |

---

## 模式对比速查

| 维度 | 方法一（sessions_send） | 方法二（新会话） |
|------|----------------------|-----------------|
| **实时可见性** | 目标会话中直接显示 | 需要用户手动点击新会话 |
| **会话清理** | 不产生额外会话 | 每次运行产生一条新会话 |
| **历史回溯** | 同一会话中连续查看 | 分散在多个独立会话中 |
| **配置复杂度** | 需要提供目标 sessionKey | 无需 sessionKey |
| **会话列表整洁** | ✅ 整洁 | ❌ 高频任务会杂乱 |
| **跨活跃会话可见** | ❌ 仅在目标会话可见 | ✅ 侧边栏可见（需点击进入） |
| **推荐频率** | 每小时 / 每天 | 每周 / 每月 / 一次性 |

---

## 创建 Cron 任务时的决策流程

在为用户创建 cron 任务时，**必须**按以下流程操作：

### Step 1：分析任务频率

| 频率 | 推荐方法 | 理由 |
|------|---------|------|
| 每小时 / 每 N 小时 | 方法一（sessions_send） | 避免每小时产生一个新会话 |
| 每天 | 方法一（sessions_send） | 结果集中在一处，方便每日回顾 |
| 每周 | 方法二（新会话） | 可接受，且有归档价值 |
| 每月 / 一次性 | 方法二（新会话） | 天然适合独立会话存档 |

### Step 2：向用户推荐并确认

向用户说明两种方法的区别，给出推荐，**让用户选择**。例如：

> 这个定时任务建议用「**方法一：推送到当前对话**」，因为它是每小时执行的，如果每次都创建新会话会导致会话列表杂乱。你觉得呢？

### Step 3：按所选方法配置

- 选方法一 → 需要获取目标 sessionKey（用 `session_status`）
- 选方法二 → 无需 sessionKey，直接配置

### Step 4：手动 run 验证

创建后手动触发一次，确认消息出现在正确位置。

---

## 执行流程（方法一：sessions_send）

### 1. 确认目标 sessionKey

用 `session_status` 获取当前会话的 sessionKey（如 `agent:artifex-nexus:session-1779833274638`）。

### 2. 快速检查配置

```
gateway config.get tools.sessions.visibility
```

确认返回 `"agent"` 或 `"all"`。

### 3. 创建/更新 Cron Job

关键参数：
- `sessionTarget: "isolated"`
- `payload.kind: "agentTurn"`
- `delivery.mode: "none"`
- `agentId` 与主会话相同
- prompt 中包含 `sessions_send` 指令 + 目标 sessionKey

### 4. 触发验证

手动 run 一次，确认目标会话收到跨会话消息。

---

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| "跨会话树通信受限" | `tools.sessions.visibility` 还是 `tree` | 检查配置值，确认不是 `"agent"`/`"all"` 则修改 |
| "Channel is required" | delivery.mode 用了 announce | 改为 `"none"` |
| 目标会话收到空消息 | prompt 中未明确要求 sessions_send | 在 prompt 中加入明确指令 |
| sessions_send 无权限 | agentId 不匹配 | 确认 cron job 的 agentId 与主会话一致 |
| 同时出现两种投递 | `delivery.channel` 设为 `"webchat"` 导致额外会话 | 移除 `delivery.channel` 字段 |
| 跨会话消息无反馈 | Agent 调用 sessions_send 后未确认 | prompt 中加"调用后确认成功" |
