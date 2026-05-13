---
tags: [spec, chat, pipeline, refactor, v4]
created: 2026-05-13
updated: 2026-05-14
status: implemented
version: v4.1.7
---

# Chat 消息收发管道设计 / Chat Message Pipeline

> 范围：定义 Artifex Nexus 聊天消息从用户输入到 Gateway 回复的完整链路。
> 涵盖：发送、排队、重试、状态机、错误恢复。
> 关联文档：[[web-chat-structure]] §4（chat 状态机）、[[openclaw-wrapper]]。

---

## 1. 设计目标

聊天消息管道必须满足以下硬性要求：

1. **可靠**：用户发的每条消息**最终都能到达 Gateway**，即使中途 Gateway 崩溃 / WS 断开 / EventLoop 退化。
2. **不重发**：同一条消息**不允许被发送两次**。
3. **不丢失**：在发送成功（chat.send ACK 收到）之前，消息**永远保留在队列**。
4. **顺序正确**：用户发送顺序 = Gateway 接收顺序。
5. **可感知**：用户能看到队列状态（多少条等待中），但不能被误导（如卡片显示"发送中"但实际已完成）。
6. **状态唯一**：同一条消息**只能在一个地方排队**（消除双队列同步问题）。

---

## 2. 历史教训：为什么需要重构

### 2.1 v1-v3 的"补丁式"演进

v1-v3 采用的是**双队列协作模型**：
- `gateway-ws._pendingSendQueue`：网络层队列（断连/退化期间累积，重连后自动回放）
- `chat-service.pendingQueue`：UI 层队列（仅用于显示"队列中"徽章）
- `chat-service.delegatedToGwRef`：Set 标记，记录已委托给 gateway-ws 的消息（避免双重发送）

每加一个 hotfix 都引入新的状态字段和回调路径：
- v1：发现"消息卡死队列" → 加 `SendResult.queued` 三态
- v2：发现"回放后 UI 不同步" → 加 `onQueueDrain` 回调
- v3：发现"双重发送" → 加 `delegatedToGwRef` Set 跟踪

到 v3 时，**两个队列 + 一个 Set + 4 个驱动器（sendMessage / final / EventLoop recovered / onQueueDrain）**，状态机指数级膨胀，bug 越修越多。

### 2.2 v3 累积的具体 bug

| Bug | 根因 |
|-----|------|
| 队列死循环 | `processQueue → _enqueueChatSend(returns false) → 保留 → retry → enqueue duplicate check returns false → 无限循环` |
| 回放后 UI 不同步 | `gateway-ws._pendingSendQueue` 回放时无法通知 `chat-service.pendingQueue` 出队 |
| onQueueDrain DEQUEUE 误删 | `for (let i = 0; i <= idx; i++) dispatch(DEQUEUE)` — dispatch 是异步的，stateRef 在循环中不更新，会误删前面的无关消息 |
| 委托标记泄漏 | `delegatedToGwRef.add(text)` 后某些路径忘记 `.delete()` → 对应消息被 processQueue 永久跳过 |
| 重启后队列消息不发送 | 双队列状态不一致：`gateway-ws._pendingSendQueue` 在某个 race 中被丢，但 `chat-service.pendingQueue` 仍持有 → 用户看到队列徽章但永远不发出 |
| 重启后跳过队列直接发新消息 | `sendMessage` 走"非队列路径" if-else 分支，不知道队列还有旧消息 → 用户感知"队列乱了" |

### 2.3 根本性缺陷

**双队列设计违反了"单一真实状态源"原则**。任何两个独立状态字段在分布式（异步消息驱动）系统中，都不可能保持完全同步。

### 2.4 重构决策

**v4 决定彻底重构**：单队列 + 单驱动器 + 单发送函数。所有补丁式设计全部丢弃。

---

## 3. v4 架构

### 3.1 三大原则

1. **唯一队列**：`chat-service.pendingQueue: string[]`。`gateway-ws` **不再持有任何队列**。
2. **唯一发送函数**：`_doSend(text, alreadyShown)`。是**唯一**从 `pendingQueue` 移除消息的地方（成功才 DEQUEUE）。
3. **唯一驱动器**：`processQueue()`。是**唯一**从 `pendingQueue` 取消息发送的地方。

### 3.1.5 v4.1 修订：双路径策略（直发 vs 队列）

**用户期待**：
- 普通对话：发消息立即发送，不出现队列徽章
- 生成中发消息：消息进队列，**可见、可撤回、可删除**
- 队列消息要在前一条接收完后**自动**发出，不需要再点发送

**实现策略**：
- `sendMessage(text)` 检查：`canSendNow = idle && pendingQueue.empty && ws.ready`
  - **canSendNow=true（直发路径）**：`ADD_USER_MESSAGE → _doSend(text, alreadyShown=true)` — 不入队，零延迟
  - **canSendNow=false（队列路径）**：仅 `ENQUEUE`（不 ADD_USER_MESSAGE）→ 队列徽章可见 → 用户可删除/清空 → 由 `processQueue` 拉出时才 ADD_USER_MESSAGE
- 队列徽章 500ms 延迟显示，避免普通消息从入队到发送（< 500ms）的闪烁

**为什么队列消息不立即 ADD_USER_MESSAGE**：
- 如果立即 ADD，消息同时出现在对话框 + 队列徽章 → 重复展示，用户困惑
- 用户点删除时只移除队列条目即可，不需要从对话框中找出消息删除 → 操作简单

### 3.2 状态字段（最小集）

```ts
// chat-service.ts
state.pendingQueue: string[]              // reducer 管理，单一真实状态源
state.chatState: "idle" | "sending" | "streaming" | "tool_executing" | "error"
state.streamingMessageId: string | null   // 当前正在接收 delta 的消息 ID
sendingRef: Ref<boolean>                  // 防重入：同时只能有一次 chat.send 在飞

// gateway-ws.ts
_state: "disconnected" | "connecting" | "handshaking" | "connected"
_eventLoopDegraded: boolean               // health 事件解析（带去抖）
```

**没有了**：`_pendingSendQueue` / `_replaying` / `delegatedToGwRef` / `QueueDrainHandler`。

### 3.3 发送结果三态化（不再四态）

```ts
type SendResult =
  | { ok: true }
  | { ok: false; reason: "not_ready" | "send_error" | "ack_timeout" | "no_ws" };
```

去掉了 v3 的 `queued` 字段。`gateway-ws.sendChat` 不再"代为入队"——能发就发，不能发立刻返回 not_ready，由调用方（chat-service）自己决定如何处理。

### 3.4 完整消息流程

```
┌──────────────────────┐
│ 用户输入 + 点发送      │
└──────────┬───────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ sendMessage(text)                           │
│   1. dispatch ADD_USER_MESSAGE              │
│   2. dispatch ENQUEUE                       │
│   3. queueMicrotask(processQueue)           │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ processQueue()  ← 唯一驱动器                 │
│   守卫：                                     │
│     · sendingRef.current === false          │
│     · pendingQueue.length > 0               │
│     · chatState === "idle"                  │
│     · ws.isSendReady() === true             │
│   全部通过：                                  │
│     sendingRef.current = true               │
│     textToSend = pendingQueue[0]            │
│     _doSend(textToSend)                     │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ _doSend()                                   │
│   await ws.sendChat(...)                    │
│   ok=true:                                  │
│     dispatch DEQUEUE_BY_TEXT(text)          │
│     dispatch START_STREAMING                │
│   ok=false:                                 │
│     消息保留在 pendingQueue                  │
│   finally: sendingRef.current = false       │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│ 接收 chat 事件流                              │
│   delta → APPEND_DELTA                      │
│   final → FINISH_STREAMING                  │
│           queueMicrotask(processQueue) ─────┘
│                                              （处理下一条）
└─────────────────────────────────────────────┘
```

### 3.5 驱动 processQueue 的事件

只有 5 个：

| 事件 | 触发时机 | 用途 |
|------|---------|------|
| sendMessage 入队后 | 用户发新消息（队列路径） | 立即尝试发送 |
| chat 事件 final | 一条对话完成 | 处理下一条 |
| onReadyChange ready=true | WS 重连成功 / EventLoop recovered | 队列消息恢复发送 |
| healthInterval 检测到 EventLoop recovered | 兜底（onReadyChange 没触发的极端情况） | 同上 |
| **useEffect 监听 chatState=idle + pendingQueue 非空（v4.1 新增）** | **状态机层兜底** | **任何路径让队列卡住时都能自愈** |

### 3.5.1 v4.1 状态机驱动器（最强兜底）

```ts
React.useEffect(() => {
  if (state.chatState === "idle" && state.pendingQueue.length > 0 && !sendingRef.current) {
    setTimeout(() => processQueue(), 0);
  }
}, [state.chatState, state.pendingQueue.length]);
```

这个 effect 是**最终防线**：无论 final/onReadyChange 有没有失效，只要 `chatState === "idle"` 且队列非空，processQueue 就会被触发。React 的 reducer commit 后，依赖数组变化会触发 effect，setTimeout(0) 让 commit 完成后再执行。

### 3.5.2 v4.1 sendingRef 安全网

```ts
React.useEffect(() => {
  if (!sendingRef.current) return;
  const timer = setTimeout(() => {
    if (sendingRef.current) {
      console.warn("[chat] sendingRef stuck at true for 90s → force reset");
      sendingRef.current = false;
      if (stateRef.current.pendingQueue.length > 0) processQueue();
    }
  }, 90_000);
  return () => clearTimeout(timer);
}, [state.chatState]);
```

如果 `_doSend` 异常路径让 `sendingRef = true` 永久残留（理论上有 finally 兜底，但防御为先），90 秒后强制重置 + 驱动队列。

### 3.6 chat 事件协议处理（v4.1.2 完整版）

OpenClaw Gateway 的 chat 事件协议（来自 `node_modules/openclaw/dist/server-chat-DLVI2zfh.js`）：

| 事件 state | message 字段 | 何时发生 |
|----------|-------------|---------|
| `delta` | 累积式（含到此刻为止的全部文本） | 流式过程，每 token/chunk 一次 |
| `final` | **可能** 含完整最终文本 | 流式结束时；某些场景（极快回复 / 协议变种）会**直接发 final 不发 delta** |

**所有 chat 事件都带 `runId`**，标识所属的 model_call run。多个用户消息会有不同的 runId。

### 3.6.1 关键 bug 历史与设计

**v3 及之前**：用单一 `state.streamingMessageId` 关联所有事件。

**v4.1.0 bug**：原 final 事件处理只 `dispatch FINISH_STREAMING`，**完全忽略 final.message**。如果 Gateway 直接发 final 含完整文本（跳过 delta），用户看到**空回复**。修复：final 也读 message。

**v4.1.1 bug（仍存在）**：当用户连发多条消息（队列），Gateway 多个 runId 的事件会**交错**：
1. 消息 A 的 delta 流到 → 写入占位 #A
2. 消息 B 的 _doSend 完成 → START_STREAMING 创建占位 #B → streamingMessageId = #B
3. 消息 A 的 final 到达（runId_A）→ 旧逻辑无脑 dispatch FINISH_STREAMING → **finish 了占位 #B**（错位）→ 用户看到 B 是"空回复"
4. 消息 B 的 delta 到达（runId_B）→ streamingMessageId 是 null → 走防御性 START_STREAMING 创建新占位 #C → 真实回复写入 #C
5. 用户看到 B 空回复 + 一条新消息含真实回复 → "队列空回复但后面收到正确回复"

**v4.1.2 修复（runId 关联）**：
- 引入 `runIdToMsgIdRef: Map<runId, messageId>`
- 引入 `runIdToLastTextRef: Map<runId, lastAccumulatedText>`
- ChatMessage 加 `runId?: string` 字段
- 新 reducer action：`BIND_RUN_ID`（首次见到 runId 时绑到当前 streaming）+ `APPEND_DELTA targetMessageId` + `FINISH_STREAMING targetMessageId`
- `_resolveTargetMessage(runId, hasContent)` 函数：
  - 有 runId + map 命中 → 返回该消息
  - 有 runId + map 未命中 → 绑定到当前 streaming（如果该 streaming 没绑过 runId）
  - 当前 streaming 已绑别的 runId → 为该 runId 新建占位
- final 处理：只 finish targetMessageId，不影响其他 runId 的 streaming
- `FINISH_STREAMING` reducer：只在 finish 当前 streaming 时才把 chatState 置 idle

这样**多个 runId 的事件交错也能正确分发到对应消息**。

### 3.7 Gateway 崩溃恢复（v4.1.3 新增）

OpenClaw Gateway 进程会偶发崩溃（已观察到 EventLoop 高延迟、agent 进程退出等），需要前端有恢复机制。

**RESET_STATE 智能恢复**（在 WS disconnected 时触发）：
```ts
case "RESET_STATE": {
  // 1. 内容空 + 无 toolCalls 的 streaming 占位 → 从 messages 移除（不留空白回复）
  // 2. 同时找到对应"前面那条 user 消息" → 重新入队
  // 3. 有内容/有 toolCalls 的 streaming 占位 → 仅置 isStreaming=false（保留已收到部分）
  // 4. 重连后 onReadyChange 自动驱动 processQueue → 消息自动重发
}
```

**streaming 60s 超时检测**（即使 WS 没断 / Gateway 假死也能恢复）：
```ts
React.useEffect(() => {
  const sid = state.streamingMessageId;
  if (!sid) return;
  setTimeout(() => {
    const cur = stateRef.current.messages.find(m => m.id === sid);
    if (cur && cur.isStreaming && !cur.content && (!cur.toolCalls || cur.toolCalls.length === 0)) {
      dispatch({ type: "RESET_STATE" }); // 触发智能恢复
    }
  }, 60_000);
  return () => clearTimeout(timer);
}, [state.streamingMessageId]);
```

**Gateway 进程探活 + 自动重启**（sidecar 端）：
- `runtime.py` 的 `_health_monitor_loop()` 每 5s `proc.poll()` 检测 Gateway 进程
- 进程死亡 → `force_kill` + `start_gateway` 重新拉起
- 速率限制：60s 内最多重启 5 次，超出则 set_errored

**Gateway 日志持久化**（v4.1 新增）：
- `runtime.py._pump_stream_to_log_buffer` 同时写到 `~/.artifexnexus/logs/gateway.log`
- 每次启动写入 `========== Gateway started PID=... ==========` 分隔符
- Gateway 崩溃后可事后追查（内存 buffer 在进程死亡后丢失）

### 3.8 gateway-ws → chat-service 的回调（精简）

```ts
ws.onStateChange((state) => ...)
// WS 连接状态：disconnected → connecting → handshaking → connected

ws.onReadyChange(({ready, reason}) => ...)
// 综合 ready 状态变化（ready = isSendReady() 的当前值）
// reason: "ws_connected" | "ws_disconnected" | "event_loop_degraded" | "event_loop_recovered"

ws.onMessage((event) => ...)
// chat / agent / health 事件流（业务消息）
```

**不再有** `onQueueDrain`（v3 设计的产物，v4 不需要）。

### 3.8 关键防御

- 所有触发 `processQueue` 的回调都用 `queueMicrotask` 异步包装，避免读 stale state
- `RESET_STATE`（disconnected）**不清** pendingQueue（崩溃后重连仍能继续发）
- `SET_SESSION` / `CLEAR_MESSAGES` / `LOAD_HISTORY` **清空** pendingQueue（切换会话时）
- `_setState("connected")` 乐观初始化 `_eventLoopDegraded = false`（让消息能立即发送，等 health 事件确认真实状态）
- `_setState("connected")` 后延迟 `RECONNECT_COOLDOWN_MS + 200ms` 才触发 `_notifyReadyChange("ws_connected")`，避免冷却期内发送

### 3.9 stale runId 错绑修复（v4.1.5 关键 bug）

**症状**：用户连续发消息时偶发空回复 + 回复内容显示在新增的"漂浮"消息里。

**根因**：Gateway 偶发会发出**上一条对话延迟到达的 final 事件**（runId 已从 `runIdToMsgIdRef` 清除）。原代码 `_resolveTargetMessage` 在 runId 不在 map 中时会 fallback 绑到当前 streaming 占位 → 错把 stale final **finish 当前消息** → 用户消息变空 + 真实回复创建新占位。

**修复**：`_resolveTargetMessage(runId, hasContent, eventState)` 新增 `eventState` 参数：
- `final`/`aborted`/`error` 事件 + runId 不在 map 中 → **直接返回 null**（视为 stale 事件，忽略）
- 只有 `delta` 事件才允许首次绑定到当前 streaming（`final` 含 message 时仍传 `"delta"`）
- `final.targetMsgId === null` 时 **不 dispatch FINISH_STREAMING**，不影响当前消息

证据来源：用户提供的 console.log（776 行）第 187-220 行精确暴露此 bug，是 v4 整个排查链的"金牌证据"。

### 3.10 Sidecar 主动操作 Gateway 的审计日志（v4.1.6 新增）

之前 sidecar 用 `logging.getLogger(__name__)` 但**没有配置 handler**，所有 `logger.info/warning` **静默丢失**，无法判断 Gateway 是被主动杀的还是自己崩的。

**修复**：新增 `_audit_log(reason, detail)` 函数（runtime.py），双重写入：
- `sys.stderr.write()` → `~/.artifexnexus/logs/sidecar-stderr-*.log`
- 直接 append 到 `~/.artifexnexus/logs/gateway.log` → **与 Gateway 自身日志同文件**，时间线对齐
- 自动抓取最后 3 层调用栈

**覆盖 sidecar 关闭/强杀 Gateway 的所有 9 条路径**：

| # | 场景 | audit 标签 |
|---|---|---|
| 1 | idle 30 分钟超时 | `STOP_GATEWAY:idle_timeout` |
| 2 | 进程崩溃自动重启 | `GATEWAY_EXITED:detected` + `AUTO_RESTART:starting` |
| 3 | 复用旧 sidecar 实例 | `FORCE_KILL:stale_sidecar_instance` |
| 4 | 端口占用孤儿清理 | `FORCE_KILL:orphan_cleanup` |
| 5 | 手动重启 | `STOP_GATEWAY:rpc_force_restart` |
| 6 | 手动停止 | `STOP_GATEWAY:rpc_called` |
| 7 | sidecar 信号退出 | `signal_handler: signum=...` |
| 8 | sidecar atexit 退出 | `_shutdown_gateway_quietly: KILLING` |
| 9 | stdin EOF（不杀） | `_shutdown_gateway_quietly: SKIP` |

**事后排查方法**：Gateway 莫名死亡时 `tail -50 ~/.artifexnexus/logs/gateway.log` —
- 看到 `[sidecar.audit]` → sidecar 主动杀的（看 reason）
- 没有 audit 但 Gateway 输出突然停止 → Gateway 进程内部 panic（OpenClaw 自身问题）

### 3.11 Keep-alive 移除（v4.1.7）

之前 ChatView 每 2 分钟发 `agent.turn` RPC 保活会话。**实测发现 Gateway 不接受该方法**，每次都返回：
```
[ws] ⇄ res ✗ agent.turn 0ms errorCode=INVALID_REQUEST errorMessage=unknown method: agent.turn
```

**修复**：删除应用层 keep-alive。改为依赖：
- `gateway-ws._startPing()` — 每 30 秒发 WS `type:"ping"` 帧
- Gateway 自身 `event=heartbeat` — 约每 10 秒一次
- Agent 会话进程的常驻由 Gateway 内部生命周期管理

`sendAgentTurn` 保留为空函数 noop，避免外部引用报错。

---

## 4. EventLoop 退化检测（degraded 状态）

### 4.1 触发逻辑

`gateway-ws` 收到 health 事件 → 解析 `el.degraded` 和 `el.delayMaxMs` → 决定是否标记 degraded。

**双重去抖**：
1. **阈值去抖**：只有 `delayMaxMs >= DEGRADED_DELAY_THRESHOLD_MS (2000ms)` 才算真退化
2. **次数去抖**：连续 `DEGRADED_CONFIRM_THRESHOLD (3)` 次都报 degraded 才确认；任意一次 false 立即重置计数

### 4.2 启动宽限期

`STARTUP_GRACE_MS = 30s`：连接建立后 30 秒内忽略 EventLoop degraded 事件。原因：Gateway 冷启动加载插件 / MCP bridge 初始化期间 EventLoop 必然抖动，不应该误报。

### 4.3 UI 反馈层级

| 状态 | Topbar 指示灯 | WsStatusBanner | 发送按钮 |
|------|------|------|------|
| connected + 不退化 | 🟢 绿色 已连接 | 不显示 | 主色，可用 |
| connected + degraded | 🟡 琥珀脉动 繁忙 | 持久琥珀横幅 | 琥珀色，可用（消息排队） |
| connecting/handshaking | 🟡 琥珀脉动 连接中 | 信息条 | 禁用 |
| disconnected + Gateway running | 🟡 琥珀脉动 连接中 | 信息条 | 禁用 |
| disconnected + Gateway down | ⚪ 灰 未连接 | 红色横幅 + 启动按钮 | 禁用 |

### 4.4 toast 去抖

`DEGRADED_DEBOUNCE_MS = 30s`：状态变 degraded 后等 30 秒才弹 toast；30 秒内恢复则取消。3 分钟内不重复弹。

---

## 5. UI 层细节

### 5.1 队列徽章

- **位置**：ChatInputArea 顶部
- **触发**：`pendingCount > 0`
- **去抖**：500ms 延迟显示（避免闪烁）—— 一条普通消息从入队到发送只需 microtask，不应该看到队列徽章
- **内容**：
  - 顶部：数量 `(N)` + "清空"按钮（pendingCount > 1 显示）+ 合并发送 toggle
  - 列表：每条消息显示 `#编号` + 内容（truncate）+ ✕ 删除按钮（hover 显示）
- **可操作性**：用户可单独删除（onRemoveFromQueue(index)）/ 清空整个队列（onClearQueue）

### 5.1.1 队列消息为什么不立即出现在对话框

进队列的消息**不**立即 ADD_USER_MESSAGE 显示在对话框，原因：
1. 避免重复展示（队列徽章 + 对话框同时显示同一条消息）
2. 用户删除队列消息时只需操作徽章，不需要去对话框找
3. 对话框的语义是"已发出的消息"，队列徽章的语义是"等待发送的消息"

直到 processQueue 真正把消息从队列拉出准备发送时，才 ADD_USER_MESSAGE 显示在对话框。

### 5.2 重启 Gateway 卡片

- `duration: 60_000`（不是 Infinity）
- `dismissible: true` + `closeButton: true` + cancel 按钮
- 重连成功（含 degraded）→ 强制 `toast.dismiss` + 2.5s 防御性 setTimeout dismiss

### 5.3 合并发送 toggle

- 切换合并 toggle 时 → 立即 `queueMicrotask(processQueue)`，避免队列卡住

---

## 6. 设计约束（不要再违反）

1. **永远不要在 `gateway-ws` 中维护任何业务级队列**。它只负责 WS 协议层。
2. **永远不要新增"双队列同步"逻辑**。如果觉得需要双队列，先停下来重新审视设计。
3. **永远不要在 `processQueue` 中跳过队列头部**（如 v3 的 `delegatedToGwRef` filter）。如果消息在队列里，就该按顺序处理。
4. **永远不要从 `pendingQueue` 移除"还没发送成功"的消息**。`DEQUEUE_BY_TEXT` 只能在 `_doSend` ACK 成功后调用。
5. **永远不要在 `dispatch` 之后立即读 `state`**。Reducer 是异步的，用 `queueMicrotask` 或 `stateRef`。

---

## 7. 验收 checklist

每次修改 chat-service / gateway-ws 必须重测以下场景：

- [x] 正常发一条消息 → 立即收到回复，无队列徽章闪烁
- [x] 在生成中发 3 条消息 → 队列徽章显示 3，生成完依次发出
- [x] Gateway 崩溃 → 重启 → 队列消息按顺序发出，不重复不丢失
- [x] EventLoop degraded → 30s 内恢复 → 不弹 toast
- [x] WS 短暂断连（< 5s）→ 不显示黄色
- [x] 切换合并 toggle 后 → 队列消息能继续发出
- [x] 切换会话 → pendingQueue 清空（消息属于上一个会话）
- [x] 队列消息可单独删除（每条 ✕ 按钮 hover 显示）
- [x] 队列消息可一键清空（pendingCount > 1 时显示）
- [x] 队列消息接收完后自动发出下一条（无需手动点发送）
- [x] 多 runId 事件交错 → 各自写到对应消息（无错位）
- [x] Gateway 假死 60s 无回复 → 消息自动重试（无空白回复）
- [x] stale runId 的 final 事件 → 忽略（不错绑当前 streaming）— v4.1.5
- [x] sidecar 主动操作 Gateway → 全部记录到 `~/.artifexnexus/logs/gateway.log`（含调用栈）— v4.1.6
- [x] WS 长时间无交互不会因 INVALID_REQUEST 噪音 → keep-alive 改为 WS ping 帧 — v4.1.7
- [x] UI 用户操作（按钮点击/对话框/导航）有日志埋点 — v4.1.5

---

## 8. 已验证成功路径（v4.1.3）

### 8.1 普通对话路径
```
用户输入 → sendMessage(text)
  ↓ canSendNow=true (idle + 队列空 + ws ready)
ADD_USER_MESSAGE + sendingRef=true → _doSend(alreadyShown=true)
  ↓ ws.sendChat → ACK ok
START_STREAMING (占位 #A, content="")
  ↓ Gateway delta 事件（带 runId_A）
_resolveTargetMessage(runId_A) → 绑定 #A → BIND_RUN_ID + APPEND_DELTA
  ↓ Gateway final 事件（带 runId_A）
APPEND_DELTA(剩余) + FINISH_STREAMING(targetMessageId=#A)
chatState=idle → useEffect 检测 pendingQueue 为空 → noop
```
**用户感知**：发出 → 流式回复 → 完成。无队列徽章闪烁。

### 8.2 队列发送路径
```
用户在生成中发新消息 → sendMessage(text)
  ↓ canSendNow=false (chatState=streaming)
ENQUEUE(text) → 队列徽章 500ms 后显示 (#1 + ✕ 按钮)
  ↓ 等当前消息 final 到达
FINISH_STREAMING(targetMessageId=#A) → chatState=idle
  ↓ useEffect 触发 → setTimeout(0) processQueue
processQueue → sendingRef=true → _doSend(text, alreadyShown=false)
  ↓ ws.sendChat → ACK ok
DEQUEUE_BY_TEXT + ADD_USER_MESSAGE + START_STREAMING (占位 #B)
  ↓ Gateway delta/final（带 runId_B）
_resolveTargetMessage(runId_B) → #B 没绑过 → 绑定 → APPEND_DELTA
... (循环直到队列空)
```
**用户感知**：消息进队列 → 队列徽章可见可删 → 自动按顺序发出 → 流式回复。

### 8.3 多 runId 交错路径（队列 + 异步回复）
```
1. 消息 A 已发出，runId_A 的 delta 流到 → 写入占位 #A（绑定 runId_A→#A）
2. 队列消息 B 触发 _doSend → ACK ok → START_STREAMING 占位 #B
3. ⚠️ runId_A 的 final 到达（A 还没接收完）
   → _resolveTargetMessage(runId_A) → 命中 map → 返回 #A
   → APPEND_DELTA(targetMessageId=#A) + FINISH_STREAMING(targetMessageId=#A)
   → reducer 检测 #A != streamingMessageId(#B) → newStreamingId 保留 #B → chatState 不变
4. runId_B 的 delta 到达
   → _resolveTargetMessage(runId_B) → 没命中 → 绑定到当前 streaming #B
   → APPEND_DELTA(targetMessageId=#B)
5. runId_B 的 final → 同款处理 → finish #B
```
**用户感知**：两条消息回复都正确显示，无错位、无空回复。

### 8.4 Gateway 崩溃恢复路径
```
1. 用户发消息 → ACK ok → START_STREAMING 占位 #X (content="")
2. ⚡ Gateway 进程崩溃，没回任何 chat 事件
3. WS 检测 disconnected → dispatch RESET_STATE
   → reducer：内容空+无 toolCalls 的 #X → 从 messages 移除
   → 找前面的 user 消息 → 重新入队（pendingQueue 头部）
4. WS 重连成功（gateway-ws 三阶段重试 + sidecar health monitor 自动重启）
   → onReadyChange ready=true → processQueue
5. processQueue 取队列头 → _doSend → 重新发送 → 收到回复
```
**用户感知**：崩溃时空白被清掉 → 重连后消息自动重发收到正确回复。

### 8.5 假死超时恢复路径（WS 仍连但 Gateway 不响应）
```
1. 用户发消息 → ACK ok → START_STREAMING 占位 #X (content="")
2. ⚠️ Gateway model_call 卡死（不发 delta/final，但 WS 连接正常）
3. 60 秒后，streaming 超时 useEffect 触发
   → 检测到 #X 仍 isStreaming + content="" + 无 toolCalls
   → dispatch RESET_STATE → 走崩溃恢复同款逻辑
```
**用户感知**：60 秒后空白消息消失 → user 消息回到队列 → 重新发送。

### 8.6 重启 Gateway 后队列回放
```
1. 用户在生成中发了 3 条消息（队列 [B, C, D]）
2. ⚡ Gateway 崩溃 → WS disconnected → RESET_STATE
   → 当前 streaming 占位 #A（已部分接收）→ 仅置 isStreaming=false（保留内容）
   → user 消息 A 已经有部分回复 → 不重新入队
   → 队列 [B, C, D] 保留
3. 用户点重启 Gateway → restart RPC → sidecar force_kill + start_gateway
4. Gateway 启动 → WS 重连 → onReadyChange ready=true
5. processQueue 顺序处理 B → C → D（如开启合并发送，前几条会合并为一条 chat.send）
```
**用户感知**：崩溃前未处理的队列消息 [B, C, D] 在 Gateway 重启后自动按顺序发送。

### 8.7 状态机最终防线（auto-driver useEffect）
即使所有显式驱动事件（final/onReadyChange/sendMessage 入队）都失效，状态机层的 useEffect 兜底：
```ts
React.useEffect(() => {
  if (state.chatState === "idle" && state.pendingQueue.length > 0 && !sendingRef.current) {
    setTimeout(() => processQueue(), 0);
  }
}, [state.chatState, state.pendingQueue.length]);
```
**触发条件**：reducer 让 `chatState` 进入 `idle` 或 `pendingQueue.length` 增加。
**效果**：任何路径让队列卡住时都能自愈，无需手动点发送。

