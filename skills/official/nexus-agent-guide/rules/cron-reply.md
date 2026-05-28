# Cron 任务回复配置规则

cron 任务触发后，Agent 的回复如何投递到用户在 Control UI webchat 中看到。
本规则说明在 Artifex Nexus 环境（无外部消息渠道）下的正确配置方式。

---

## 背景

Artifex Nexus 当前环境**没有配置外部消息渠道**（Signal/Telegram/Discord 等），只有 Control UI 的 webchat。

cron 的 `delivery.mode: "announce"` 依赖消息渠道推送 → **不可用**。

---

## 模式对比

| 模式 | 投递机制 | 环境可用 |
|------|----------|:---:|
| `main + systemEvent` | 注入主会话为系统事件，Agent 不会处理 | ❌ |
| `isolated + announce` | 依赖 `delivery.channel` 推送到消息渠道 | ❌ 无渠道 |
| `isolated + none + sessions_send` | Isolated 会话通过 `sessions_send` 推送到 webchat 主会话 | ✅ 推荐 |
| `current + agentTurn` | 注入当前 webchat 会话（会话需存活） | ⚠️ 有限 |

---

## 推荐方案：`isolated + none + sessions_send`

### 原理

```
Cron 触发 → 创建 isolated 会话运行 agentTurn
         → Agent 执行任务、生成结果
         → Agent 调用 sessions_send 推送到主会话 sessionKey
         → 主会话收到消息，用户在 webchat 看到
```

### 前提条件：`tools.sessions.visibility` 为 `"agent"` 或 `"all"`

**只需检查，无需修改。** 环境预设此值为 `"agent"` 或 `"all"`，默认 `"tree"` 不允许跨树通信。

```json
// openclaw.json 顶层应已包含
"tools": { "sessions": { "visibility": "agent" } }
```

执行任务时用 `gateway config.get tools.sessions.visibility` 快速确认即可。
```

可用值：

| 值 | 含义 |
|---|---|
| `"self"` | 只能看到当前会话 |
| `"tree"`（默认） | 当前会话 + 它 spawn 的子会话 |
| **`"agent"`** ✅ | 同一 agent id 的所有会话（可跨 session tree） |
| **`"all"`** ✅ | 所有会话，最宽松（跨 agent 通信还需 `tools.agentToAgent`） |

> `"agent"` 和 `"all"` 都能解决 cron 跨树推送问题。`"agent"` 更安全（限同 agent），`"all"` 更宽松。按需选择。

> ⚠️ **`tools.sessions.visibility` 是受保护路径，SIGUSR1 热重载不会加载其变更。**
> 修改后必须执行完整进程重启：
> ```powershell
> openclaw gateway restart
> ```
> 或分步：`openclaw gateway stop` → `openclaw gateway start`

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
    "message": "⏰ 定时任务触发。\n\n步骤：\n1. 执行检查/操作...\n2. 汇总结果\n3. 【关键】用 sessions_send sessionKey=\"agent:artifex-nexus:session-<主会话ID>\" 把完整结果推送到主会话，主人才能在 webchat 里看到！\n\n如果全部通过简要说通过，不通过列出具体问题。",
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

### Prompt 中的 sessions_send

在 `payload.message` 中必须包含 `sessions_send` 指令：

```
sessions_send sessionKey="agent:artifex-nexus:session-<主会话ID>" 把结果推送到主会话
```

**如何获取主会话 sessionKey**：
- 在 webchat 中让 Agent 执行 `session_status` 查看当前 sessionKey
- 或通过 `sessions_list` 查找

---

## 备选方案：`current + agentTurn`

将 cron 的 `sessionTarget` 设为 `"current"`，让 Agent Turn 注入到**当前活跃的 webchat 会话**。

### 限制

- **必须在 webchat 中操作** — CLI 会话关闭后 `current` 指向可能失效
- **webchat 会话需存活** — 如果用户关闭了 webchat 标签页，注入可能失败
- 不适合长期无人值守的定时任务

### 配置

```json
{
  "sessionTarget": "current",
  "payload": {
    "kind": "agentTurn",
    "message": "⏰ 定时任务触发..."
  },
  "delivery": {
    "mode": "none"
  }
}
```

---

## 执行流程（isolated + sessions_send）

### Step 1：确认主会话 sessionKey

用 `session_status` 获取当前会话的 sessionKey（如 `agent:artifex-nexus:session-1779833274638`）。

### Step 2：快速检查配置

```
gateway config.get tools.sessions.visibility
```

确认返回 `"agent"` 或 `"all"`。不是则报给用户，由用户决定是否修改。

### Step 3：创建/更新 Cron Job

关键参数：
- `sessionTarget: "isolated"`
- `payload.kind: "agentTurn"`
- `delivery.mode: "none"`
- `agentId` 与主会话相同
- prompt 中包含 `sessions_send` 指令 + 目标 sessionKey

### Step 4：触发验证

手动 run 一次，确认 webchat 收到结果。

---

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| "跨会话树通信受限" | `tools.sessions.visibility` 还是 `tree` | 检查配置值，确认不是 `"agent"`/`"all"` 则反馈用户 |
| "Channel is required" | delivery.mode 用了 announce | 改为 `"none"` |
| 主会话收到空消息 | prompt 中未明确要求 sessions_send | 在 prompt 中加入明确指令 |
| sessions_send 无权限 | agentId 不匹配 | 确认 cron job 的 agentId 与主会话一致 |
