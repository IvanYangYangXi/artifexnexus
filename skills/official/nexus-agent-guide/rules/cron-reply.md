# Cron 任务回复配置规则

cron 任务触发后，Agent 的回复需要投递到用户会话。本规则说明在 Artifex Nexus 环境下的正确配置方式。

---

## 背景

Artifex Nexus 当前环境**没有配置外部消息渠道**（Signal/Telegram/Discord 等），只有 Control UI 的 webchat。

---

## 模式对比

| 模式 | 投递机制 | 环境可用 |
|------|----------|:---:|
| `main + systemEvent` | 注入主会话，回复留在历史 | ✅ |
| `isolated + agentTurn` | 依赖 `delivery.channel` 推送到消息渠道 | ❌ 无渠道 |
| `current + agentTurn` | 注入当前 webchat 会话 | ✅ 推荐 |

---

## 推荐配置：`current + agentTurn`

将 cron 的 `sessionTarget` 设为 `"current"`，让系统事件注入到**正在聊天的 webchat 会话**。

### Step 1：在 webchat 中拉取配置

在 Artifex Nexus 的 webchat 会话中让 Agent 读取当前 cron 配置。

### Step 2：修改为 current + agentTurn

```json
{
  "cron": [
    {
      "schedule": "*/30 * * * *",
      "prompt": "运行工具合规检查",
      "sessionTarget": "current",
      "mode": "agentTurn"
    }
  ]
}
```

### Step 3：Agent 重载 cron

Agent 修改配置文件后自动重载 cron，后续触发的事件注入当前 webchat 会话。

---

## 工作原理

```
Cron 触发 → 系统事件注入当前 webchat 会话
         → Agent 处理事件
         → 回复出现在当前会话历史
         → 用户看到完整 触发→处理→回复 链路
```

---

## 注意事项

- **必须在 webchat 中操作** — CLI 会话关闭后 `current` 指向失效
- **不要用 `isolated`** — 无外部消息渠道，isolated 会话无法投递
- cron 的 `prompt` 需包含完整指令（Agent 无对话上下文）
- 如需通知，可在 prompt 中要求 Agent 调用通知 API
