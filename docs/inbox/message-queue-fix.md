---
tags: [spec, bugfix, chat, websocket]
created: 2026-05-13
status: draft
related_specs: [[../specs/ui/web-chat-structure]]
related_stories: [[../tasks/in-progress/STORY-0039-m3-func-chat-api]]
related_packages: [packages/apps/web]
---

# 信息队列功能修复与增强

## 1. 问题描述

用户报告信息队列存在三个缺陷，影响多消息场景下的可靠性和用户体验：

1. **多条消息丢失**：队列积累多条消息后，agent 只能接收一条，其余丢失
2. **WS 断连时消息被吞**：发送前未充分校验 WebSocket 连接状态，断连时消息无法到达 Gateway
3. **队列残留**：已处理（或无法处理）的消息不会从队列中清除

## 2. 根因分析

### 2.1 多条消息丢失

**位置**：`packages/apps/web/src/lib/chat/gateway-ws.ts:1121-1124`

```typescript
// _replayQueuedSends() 中的去重逻辑
for (const item of this._pendingSendQueue) {
  seen.set(item.params.sessionKey, item);  // 只保留最后一条！
}
const toReplay = Array.from(seen.values());
```

重连回放时对同一 sessionKey 只保留队列中**最后一条消息**。例如：WS 断连期间用户发送了 A、B、C 三条消息 → 重连后仅回放 C，A 和 B 静默丢弃。

**补充影响**：`chat-service.ts` 的 `pendingQueue`（应用层队列）通过 `processQueue()` 逐条发送，当这些消息到达 gateway-ws 的 `sendChat()` 时，如果 WS 仍处于连接恢复的冷却期，会全部进入 `_pendingSendQueue`。此时去重逻辑再次将所有消息压缩为最后一条。

### 2.2 WS 断连时消息被吞

**位置**：`packages/apps/web/src/lib/chat/chat-service.ts:318-331`

```typescript
if (!ws || !ws.isSendReady()) {
  if (ws && ws.eventLoopDegraded) {
    // 仅 degraded 放行 --- 其他状态全部 return，不调用 sendChat()
  } else if (ws && ws.state === "connected") {
    dispatch({ type: "SET_ERROR", ... });
    return;  // ← 消息从未到达 gateway-ws 排队机制
  } else if (gatewayRunning) {
    dispatch({ type: "SET_ERROR", ... });
    return;  // ← 同上
  }
}
```

`sendMessage()` 用 `isSendReady()` 做前置检查。当 WS 处于 disconnected（gateway running）时，显示错误消息并 `return`，**从未调用 `ws.sendChat()`**。gateway-ws 的 `sendChat()` 内部已有完善的入队排队机制（`_enqueueChatSend` + `_replayQueuedSends`），但 chat-service 的前置阻断使消息永远到达不了这一层。

### 2.3 队列残留

**应用层残留**：`chat-service.ts:121-124` — `RESET_STATE` reducer

```typescript
case "RESET_STATE":
  return { ...state, messages: ..., chatState: "idle", ... };
  // pendingQueue 未被清理！
```

WS 断连触发 `RESET_STATE` 后，`pendingQueue` 中原有的排队消息未清除，也永远不会被处理（`processQueue()` 仅在 Gateway final 事件回调中触发）。

**传输层残留**：`gateway-ws.ts:1117-1147` — `_replayQueuedSends()` 仅在重连恢复时执行清空。若重连持续失败，`_pendingSendQueue` 中消息永远驻留。

### 2.4 反复排队 + 空假回复（WS 绿色但消息不到达）

**症状**：WS 状态显示绿色（connected），但发送消息后反复提示"Gateway 繁忙，消息已排队"，消息不到达 Gateway，有时产生空的假回复。

**根因链** — 三个阶段叠加：

**阶段 1 — 假连接状态（gateway-ws.ts:1059-1063）**：

```typescript
// _setState("connected") 中
if (state === "connected") {
  this._reconnectionTime = Date.now();    // line 1060
  this._connectionEstablishedAt = Date.now();
  this._eventLoopDegraded = false;       // line 1063 — 乐观重置！
}
```

WS TCP 握手完成后立即将 `_eventLoopDegraded` 重置为 `false`，但此时 Gateway EventLoop 实际状态未知。Health 事件通过 `healthInterval` 轮询（2s 间隔），首条 health 事件延迟最多 2s。Chat-service 行 191 将 `GatewayWebSocket.state` 直接映射为 wsState="connected"，UI 显示绿色。

**阶段 2 — 冷却期 + 宽限期盲区**：
- **冷却期**（5s）：`_reconnectionTime` 设置后 `isSendReady()` 返回 false → 消息入 `_pendingSendQueue`
- **宽限期**（15s，gateway-ws.ts:748-753）：health 事件报告的退化被忽略。即使 EventLoop 严重退化（delayMaxMs 30s+），`_eventLoopDegraded` 保持 `false` → `isSendReady()` 返回 true → `_doSendChat()` 直接发送 → Gateway 处理极慢 → ACK 超时 60s 后返回 false

在这 15s 窗口内用户可能重试多次，每次都超时/入队，触发反复"Gateway 繁忙"提示。

**阶段 3 — 空假回复（chat-service.ts:333）**：

```typescript
dispatch({ type: "START_STREAMING", messageId: streamMsgId }); // line 333 — 先建气泡！
...
const ok = await ws.sendChat({ ... });  // line 336 — 后发送
if (!ok) {
  dispatch({ type: "SET_ERROR", error: ... });
}
```

`START_STREAMING` 在 `sendChat()` **之前**被 dispatch，创建了占位 assistant 消息 + "streaming" 状态。当 `sendChat()` 返回 false（入队/超时）时：
- 占位消息已存在于消息列表中，但永远不会有数据到达
- FINISH_STREAMING 仅由 Gateway final 事件触发 → 此消息永远不会结束
- 后续用户消息全部进入 `pendingQueue`（因状态为 streaming）→ 死锁

**出口**：WS 断连触发 `RESET_STATE` 打破死锁，或宽限期过后新一轮 health 事件将 `_eventLoopDegraded` 设为 true，`sendChat()` 将后续消息入队等待回放。

## 3. 修复方案

### 3.1 合并发送功能（解决 §2.1 + 新增功能）

在 `ChatInputArea` 增加一个 checkbox（默认勾选"合并发送"），控制应用层队列的发送策略。

| 勾选状态 | 行为 | 实现位置 |
|---------|------|---------|
| 勾选（默认） | `pendingQueue` 中消息用 `\n` 拼接为一条，一次性 `sendChat()` | `chat-service.ts` `processQueue()` |
| 不勾选 | 逐条发送，每条等待上一轮 FINISH_STREAMING 后再发下一条 | `chat-service.ts` `processQueue()`（现行为） |

**同时修复**：`gateway-ws.ts` `_replayQueuedSends()` 去重策略改为**基于内容+时间窗口的轻量去重**：

| 去重点 | 策略 | 目的 |
|--------|------|------|
| 入队 `_enqueueChatSend` | 保留现有去重（line 401-408：连续相同内容阻止），确保不重复压栈 | 防止用户重复点击发送 |
| 回放 `_replayQueuedSends` | 同一 sessionKey + 完全相同的 message 内容（纯字符串比对，不做语义判断）→ 5s 时间窗口内保留最新一条 | 防止重连时的消息风暴，但不误杀不同内容的消息 |
| 合并模式 | 同 sessionKey 的不同内容消息按时间序用 `\n` 拼接为一条 | 解决原去重"只保留最后一条"的丢消息 bug |
| 顺序模式 | 按时间序逐条回放，等待上一条 FINISH_STREAMING 后自动发下一条 | 确保每条消息有完整回复后再发下一条 |

**合并发送条数限制**：单次合并最多拼接 **10 条**消息。若队列超过 10 条，分批发送：第一批 10 条合并 → 等待上一批 FINISH_STREAMING 回复后发送下一批。防止单帧超过 WebSocket 协议长度上限。

**合并发送字符上限**：单次合并后总长度 ≤ **4096 字符**。拼接时贪心打包：逐条累加直到加入下一条会超过 4096 字符 → 当前批次发送 → 剩余消息作为下一批。每批内的消息用 `\n` 分隔，最后一条不追加分隔符。

**toggle 切换行为**：`mergeEnabled` 在 `pendingQueue` 不为空时切换，行为如下：
- `processQueue()` 读取到的 `mergeEnabled` 值即为当前批次使用的策略
- 若队列中已有 3 条消息时用户切换 toggle → 下一轮 `processQueue()` 使用新策略
- 例如：队列 [A,B,C]、mergeEnabled=false → 用户切换为 true → 下一轮 processQueue 会将 A+B+C 合并为一条发送

**空消息处理**：`pendingQueue` 中仅含空白字符的消息在合并/顺序发送前被跳过，不加入拼接或发送。纯空消息不计入 `pendingQueue`（在 ENQUEUE 阶段即过滤）。

### 3.2 发送前 WS 检查修复（解决 §2.2）

**保留** `ws === null` 的空值守卫（致命错误，无法调用任何方法）。**移除** `isSendReady()` 的全部阻断逻辑。

变更后 `sendMessage()` 流程：

```typescript
if (!ws) {
  // 致命错误：Gateway 未启动或 auth 未就绪（无法调用任何 WS 方法）
  dispatch(ERROR, gatewayRunning ? "连接未建立，请稍等重试" : "Gateway 未启动");
  return;
}
// 不再调用 isSendReady()，直接委托给 sendChat()
const ok = await ws.sendChat({ sessionKey, message, thinking });
if (!ok) {
  dispatch(ERROR, "发送失败，请检查 Gateway 状态");
}
```

**`sendChat()` 返回值语义修正**：同时修改 `gateway-ws.ts` `_enqueueChatSend()` 的返回值，使其可区分"入队成功"与"重复丢弃"：

| 场景 | `sendChat()` 返回值 | `_enqueueChatSend()` 变更 | 说明 |
|------|---------------------|--------------------------|------|
| 正常发送到 Gateway | `true` | 无变更 | `_doSendChat()` 返回 true |
| 入队 `_pendingSendQueue` 成功 | `true` | 由 `false` 改为 `true` | WS 断连/退化时消息安全入队 |
| 重复消息被丢弃 | `false` | 保持 `false` | 连续相同内容阻止重复压栈 |
| 发送失败/超时 | `false` | 无变更 | `_doSendChat()` 返回 false |

UI 反馈根据 `ok` 值：
- `true`：不提示（正常流程）
- `false`：提示"发送失败或消息重复，请重试"

### 3.3 队列清理（解决 §2.3）

| 队列 | 清理时机 | 变更 |
|------|---------|------|
| `pendingQueue` (chat-service) | `RESET_STATE` 时 | 新增 `pendingQueue: []` |
| `pendingQueue` (chat-service) | 消息合并发送后 | `processQueue()` 发送后清空全部 |
| `_pendingSendQueue` (gateway-ws) | 队列项过期（>120s） | 已存在，无需额外变更 |
| `_pendingSendQueue` (gateway-ws) | 回放完成后 | 已在 `_replayQueuedSends:1146` 清空，确认无误 |
| `_pendingSendQueue` (gateway-ws) | `disconnect()` 时 | 已在 line 279 清空，确认无误 |

`mergeEnabled` 不在 `RESET_STATE` 中重置 —— 它持久化在 localStorage 中，属于用户偏好设置，跨重连/刷新保留。

### 3.4 UI 变更

- `ChatInputArea` 组件：在发送按钮旁增加 checkbox `合并发送`（默认勾选）
- Props 新增：`mergeEnabled: boolean`、`onMergeToggle: () => void`
- 状态由 `chat-service` 管理（新增 `mergeEnabled` state），通过 `ChatView` 传递给 `ChatInputArea`

> **UI spec 同步**：需同步更新 `docs/specs/ui/web-chat-structure.md` 的 C3 输入区布局，在发送按钮旁增加合并发送 checkbox 的描述。

### 3.5 并发回放竞争处理（解决 §3.1+§3.2 重叠态）

移除 `isSendReady()` 后，以下场景可能导致回放竞争：
1. WS 重连成功触发回放（`_setState("connected")` → line 1072）
2. EventLoop 恢复也触发回放（`_handleMessage` health → line 766）

两类事件可能在短时间内并发触发，但**现有 `_replaying` 互斥标志已安全处理**：

- 首次回放开始 → `_replaying = true`（line 1099）
- 第二次回放触发 → `if (this._replaying) return`（line 1098）→ 跳过
- 首次回放完成 → `_replaying = false` + `_pendingSendQueue = []`（line 1112 + 1146）
- 若此时再有回放触发 → 队列已空，`_replayQueuedSends()` 直接 return（line 1118）

**无需额外同步机制**，现有实现已安全。

### 3.6 假连接 + 空回复修复（解决 §2.4）

**修复 A：延迟 `START_STREAMING`，消除空回复**

`chat-service.ts` `sendMessage()`：将 `START_STREAMING` 从第 333 行移至 `sendChat()` 成功返回之后：

```typescript
dispatch({ type: "ADD_USER_MESSAGE", text });
const ws = wsRef.current;
if (!ws) { dispatch(ERROR, "..."); return; }

const ok = await ws.sendChat({ ... });
if (!ok) {
  dispatch(ERROR, "发送失败或消息已排队，请稍等重试");
  return; // ← 不创建占位气泡
}

// 仅 sendChat 返回 true 时才创建 assistant 流式消息
const streamMsgId = genMsgId();
dispatch({ type: "START_STREAMING", messageId: streamMsgId });
lastTextRef.current = "";
```

**修复 B：悲观初始化 `_eventLoopDegraded`，消除假连接窗口**

`gateway-ws.ts` `_setState("connected")` 默认持保守态度：

| 变更 | 位置 | 旧值 | 新值 | 理由 |
|------|------|------|------|------|
| 重连时 EventLoop 默认状态 | line 1063 | `_eventLoopDegraded = false`（乐观） | `_eventLoopDegraded = true`（悲观） | 未知=不安全，等待 health 确认 |
| 健康宽限期 | line 120 | `STARTUP_GRACE_MS = 15000` | `STARTUP_GRACE_MS = 3000` | 首个 health 事件 2s 内必然到达 |
| health 事件首次确认 | line 748-753 | 宽限期内退化忽略 | 宽限期内退化确认但不出 warn | 首次 health 到达即更新 `_eventLoopDegraded` 为真实值 |

变更后行为：
1. WS 重连 → `_eventLoopDegraded = true` → `isSendReady()` 返回 false
2. Chat-service 将 wsState 从 disconnected 先映射为 connecting（因为没有新的"健康已确认"标志）
3. Health 事件到达（2s 内）→ 根据实际状态更新 `_eventLoopDegraded`
4. 若 EventLoop 正常 → `_eventLoopDegraded = false` → `_scheduleQueueReplay()` 回放
5. 若 EventLoop 退化 → 保持 true → 排队等待恢复

这样消除了"绿色但消息不到达"的假连接窗口。

## 4. 涉及文件

| 文件 | 变更范围 |
|------|---------|
| `packages/apps/web/src/lib/chat/chat-service.ts` | `sendMessage()` 延迟 START_STREAMING、`processQueue()` 增加合并逻辑、`RESET_STATE` 清理 pendingQueue、新增 mergeEnabled state |
| `packages/apps/web/src/lib/chat/gateway-ws.ts` | `_eventLoopDegraded` 悲观初始化、`STARTUP_GRACE_MS` 缩短至 3s、`_replayQueuedSends()` 去重策略优化（轻量去重+拼接/顺序回放）、`_enqueueChatSend()` 返回值修正 |
| `packages/apps/web/src/components/chat/ChatInputArea.tsx` | 新增 checkbox UI |
| `packages/apps/web/src/components/chat/ChatView.tsx` | 透传 mergeEnabled 状态 |

## 5. 验收标准

- [ ] 合并发送勾选时：3 条排队消息被拼接为 `msg1\nmsg2\nmsg3` 一条发送
- [ ] 合并发送不勾选时：3 条消息逐条发送，每条等上一轮回复结束后再发
- [ ] WS 断连（gateway running）时发送消息：消息进入 `_pendingSendQueue`，不丢失
- [ ] WS 重连后：队列中消息按合并/顺序模式正确回放
- [ ] WS 断连触发 `RESET_STATE` 后：`pendingQueue` 被清空
- [ ] `mergeEnabled` 状态持久化到 localStorage（跨页面刷新保留）
- [ ] **去重安全**：重连回放时，完全相同的消息（纯字符串比对，同 sessionKey）在 5s 窗口内去重（只发一条），不同内容的消息全部保留
- [ ] **合并上限**：合并发送超过 10 条时分批发（10条/批，批间等待 FINISH_STREAMING），单批消息不触发协议帧长限制
- [ ] **空回复消除**：`sendChat()` 返回 false 时不创建 assistant 占位消息（无假气泡），同时向用户提示错误（如"发送失败或消息已排队，请稍等重试"）
- [ ] **假连接消除**：WS 重连后首次 health 确认前 wsState 为 connecting（非 connected），不显示绿色
- [ ] **重连恢复**：悲观初始化后，health 确认 EventLoop 正常 → 自动回放排队消息
- [ ] TypeScript 编译零错误
- [ ] 构建通过（`pnpm -C packages/apps/web build`）
