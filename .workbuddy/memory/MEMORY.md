# Artifex Nexus 项目记忆

## 设计原则（重要）

- **配置覆盖原则**：sidecar 只在**安装时**写入默认配置（`bootstrap.py` 的 default config），运行时**不强制重写**用户已存在的配置。
  - 用户在 `~/.artifexnexus/.openclaw/openclaw.json` 的修改应被尊重
  - 如发现某个默认配置有 bug（如 `memory-core.dreaming.enabled=true` 导致崩溃），**正确做法**是注释掉 bootstrap.py 的写入代码，让 OpenClaw 用其自身默认值，**不要**在 sidecar 启动时强制改写用户配置
  - 旧版本残留的有问题配置需要用户手动改或重装

## 关键架构

- **Tauri Desktop App**：嵌入 Next.js `out/` 产物作为前端
  - 配置：`apps/desktop/src-tauri/tauri.conf.json`
  - `frontendDist`: `../../../packages/apps/web/out`（生产模式）
  - `devUrl`: `http://localhost:18790`（开发模式）
  - `beforeBuildCommand`: `pnpm --filter @artifex-nexus/web build`
  - `beforeDevCommand`: `pnpm --filter @artifex-nexus/web dev`
  - **关键**：Web 前端只能在 Tauri WebView 中使用，浏览器直连 `invoke()` 失败（`@tauri-apps/api`）
  - `apps/desktop/src/`（App.tsx 等）只是安装向导壳，主 UI 是 Next.js 的 ChatView
  - 编译命令：`pnpm -C apps/desktop tauri build`（**必须跑这个，不能只跑 `pnpm build`**）

- **OpenClaw Gateway**：Node.js 进程，监听 127.0.0.1:19789（WebSocket Control UI）
  - 入口：`cli/v2026.5.4/node_modules/openclaw/openclaw.mjs`
  - 启动命令：`openclaw.cmd` → `node openclaw.mjs gateway run --port 19789 --force`
  - 插件目录：`cli/v2026.5.4/node_modules/openclaw/dist/extensions/`

- **MCP Bridge 插件**：在 gateway 内运行，桥接外部 MCP servers
  - 源码：`packages/adapters/openclaw/gateway-plugin/src/index.ts`
  - 编译：`packages/adapters/openclaw/gateway-plugin/dist/index.js`（esbuild bundle）
  - **实际加载路径**：`~/.artifexnexus/.openclaw/cli/v2026.5.4/node_modules/openclaw/dist/extensions/mcp-bridge/index.js`
  - **关键**：Gateway 从 bundled extensions 加载插件，NOT 从 `plugins/` 符号链接！修改 src 后必须同步更新 bundled extension + 刷新注册表
  - 配置路径：必须用 `process.env.OPENCLAW_CONFIG_PATH` 或 `process.env.OPENCLAW_HOME`
  - 工具注册：同步预注册（KNOWN_TOOLS 硬编码 → api.registerTool()，不依赖 WS 连接）
  - 构建命令：`esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --external:ws --outfile=<target>`
  - 注册表刷新：`openclaw plugins registry --refresh`

- **Python Sidecar**：JSON-RPC over stdio，管理 gateway 生命周期
  - 位于：`packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/`
  - 关键模块：sidecar.py, runtime.py, bootstrap.py, mcp_bridge.py

- **隔离目录**：`~/.artifexnexus/.openclaw/`
  - 配置：`openclaw.json`（含 gateway.port, plugins.entries.mcp-bridge 等）
  - PID 锁：`run/gateway.pid`
  - 端口状态：`run/ports.json`

## 前端预输入机制

- **预输入事件**：`artifex:prefillInput` CustomEvent，由 `ChatInputArea` 监听
  - 触发方式：`window.dispatchEvent(new CustomEvent("artifex:prefillInput", { detail: { text: "..." } }))`
  - 现有用法：Tool 运行 → Chat 预填（`AppShell.RunToolContext`）

- **DCC 预输入 SDK**（`packages/apps/web/src/lib/chat/dcc-preinput.ts`）：
  - `DCCPreInputProvider` 接口：`checkConnected()` / `buildConnectedMessage()` / `buildDisconnectedToast()`
  - `ALL_PROVIDERS` 注册表 — 新增 DCC 只需实现接口 + 注册
  - 已连接 DCC → `chat.sendMessage()` 自动发送上下文到对话
  - 未连接 DCC → `toast.info()` 右下角非阻塞指引（检查插件安装 + 软件打开）
  - 多 DCC 合并为一条消息
  - SDK 文档：`[[docs/sdk/dcc-preinput]]`，已注册到 `docs/sdk/README.md`

## session-key SDK（`lib/chat/session-key.ts`）

- **sessionKey 格式**：`agent:{agentId}:{subKey}`（如 `agent:artifex-nexus:session-1715699200000`）
- **统一解析入口**：所有涉及 sessionKey 解析/构建的代码必须使用 `lib/chat/session-key.ts`，禁止手动 `.split(":")[1]`
- 核心 API：`parseSessionKey()` / `buildSessionKey()` / `createSessionKey()` / `isSentinel()` / `getCustomTitle()`
- 哨兵常量：`PENDING_NEW_KEY` / `EMPTY_KEY` / `NEW_KEY`

## 构建系统

- **Web 前端**：Next.js (`packages/apps/web`)，dev 模式用 `next dev -p 18790 --turbopack`，HMR 自动更新
- **Tauri Desktop**：`apps/desktop/src-tauri/`，dev 模式加载 `http://localhost:18790`
  - 生产 EXE：`pnpm --filter @artifex-nexus/web build` → `tauri build`
  - 仅有前端代码变更时 dev 模式无需 rebuild
  - **关键约束**：apps/desktop 改动后**必须** `pnpm -C apps/desktop tauri build`，不能只跑 `pnpm build`（`.ai/rules/40-build-and-release.md`）

## 端口分配

| 端口 | 用途 | 协议 |
|------|------|------|
| 18083 | Blender MCP WebSocket Server | 纯 WS，HTTP 会报 426 |
| 18790 | Next.js dev server（Artifex Nexus 前端） | HTTP |
| 19789 | OpenClaw Gateway + 原生 Control UI | HTTP + WS |

- **Web 前端只能在 Tauri WebView 中使用**，浏览器直连 `http://127.0.0.1:18790/` 会卡 "等待 sidecar 就绪"，因为 `@tauri-apps/api invoke()` 不可用
- 原生 OpenClaw Control UI（`http://127.0.0.1:19789/`）是所有 OpenClaw 自带的 Vite 仪表盘，不是 Artifex Nexus 前端

## 已知陷阱

1. **dist/index.js 可能丢失 src 的功能**：发布前必须验证 dist 包含所有 src 逻辑
2. **bin/ 可能是空目录**：入口在 `node_modules/openclaw/openclaw.mjs`
3. **Gateway 端口固定 19789**：不使用自动迁移（STORY-0039 决策）
4. **MCP Bridge WebSocket 超时**：连接超时 5s（已修），工具调用超时 30s
5. **Gateway 内进程重启导致 sidecar 断连**（2026-05-14 发现）：
   - 现象：Gateway 收到 SIGUSR1 内进程重启后，Python sidecar 与 Tauri 的 stdio 连接断裂，报 "sidecar 不可用"
   - 修复：kill 所有 sidecar + gateway 进程，手动重启 gateway，重启 Tauri app
   - sidecar 僵尸进程累积是已知问题（单日可达 56 个日志文件），需定期清理
6. **OpenClaw `agents.list` 是保护配置**（2026-05-14 发现）：
   - 不能通过 `config.patch` 修改 `list[].agentRuntime.id, list[].default, list[].id, list[].name, list[].skills, list[].systemPromptOverride` 等
   - 添加 agent 需直接修改 `openclaw.json` 文件
5. **WS 延迟可能出现极端方差**（1ms ~ 2384ms），EOF 退出时不杀 gateway
6. **Gateway 重连后 Event Loop 退化**（2026-05-13 修复）：
   - 现象：重连后 delayMaxMs 可达 30s，heartbeat 需 73s
   - 修复：ACK_TIMEOUT 15s→60s，新增重连冷却 5s + health 事件解析检测退化
   - 影响文件：`gateway-ws.ts`, `chat-service.ts`, `ChatView.tsx`
7. **EXE 冷启动 WS 连接慢 / 放弃重连**（2026-05-13 修复）：
   - 现象：重新打开 EXE 后 Gateway 未就绪，WS 走指数退避（3→4.5→6.75→10→15s = ~40s），5 次后彻底放弃
   - 修复：三阶段渐进式重连（启动快速 2s×15 → 指数退避 → 持久化 30s，永不放弃）
   - 影响文件：`gateway-ws.ts`（常量 + `connect()` + `_scheduleReconnect()` + `_scheduleStartupRetry()`）
8. **degraded 状态误判为"未连接"**（2026-05-13 修复）：
   - 现象：Gateway Event Loop 退化时，ChatView 把 wsState="degraded" 映射为 wsConnected=false，Topbar 显示"连接中"、发送按钮禁用
   - 根因：`setWsConnected(wsState === "connected")` 和 `isWsConnected={wsState === "connected"}` 未包含 "degraded"
   - 修复：两处都改为 `wsState === "connected" || wsState === "degraded"`；新增 degraded→恢复时的队列自动回放
   - 影响文件：`ChatView.tsx`（2 处）、`gateway-ws.ts`（health 事件恢复回放）
9. **degraded → keepalive 停止 → heartbeat timeout → 周期性重连死循环**（2026-05-13 修复）：
   - 现象：WS 周期性变黄（"连接中"），每 ~60s 一轮，此时发送按钮禁用
   - 根因：keepalive 只在 "connected" 运行；degraded 时停止 → 60s 无活动 → heartbeat timeout 强制重连 → 亮黄灯 → 重连后又 degraded → 死循环
   - 修复：keepalive 条件放宽为 `"connected" || "degraded"`；`sendMessage` 在 degraded 时不阻断，让 `sendChat` 内部排队
   - 影响文件：`ChatView.tsx`（keepalive）、`chat-service.ts`（sendMessage 放行 + 错误文案）
10. **双队列死循环 — processQueue 重试 + gateway-ws duplicate check**（2026-05-13 修复）：
   - 现象：消息卡在 chat-service pendingQueue 永远发不出去，后续消息全部积压
   - 根因：processQueue → sendChat → _enqueueChatSend 入队 gateway-ws → 返回 false → chat-service 保留 → 下次 processQueue 重试 → _enqueueChatSend duplicate check → 再返回 false → 无限循环
   - 修复：sendChat 改为三态返回 `SendResult = {ok:true} | {ok:false, queued:true} | {ok:false, queued:false}`；queued=true 时 chat-service DEQUEUE（信任 gateway-ws 回放）
   - 影响文件：`gateway-ws.ts`（SendResult 类型 + _enqueueChatSend/doSendChat 返回值）、`chat-service.ts`（_sendToGateway + _sendQueuedText 三态处理 + handleGatewayEvent auto-START_STREAMING）
11. **Gateway 队列回放时 chat-service 无感知**（2026-05-13 修复）：
   - 现象：gateway-ws 回放 queued 消息 → chat 事件到达 → handleGatewayEvent 无 streamingMessageId → delta 文本丢失
   - 修复：handleGatewayEvent delta 分支自动检测无活跃 stream → dispatch START_STREAMING（自动创建占位）
   - 影响文件：`chat-service.ts`（handleGatewayEvent）
12. **WS 状态三态可视化**（2026-05-13 新增）：
   - GatewayContext 新增 `wsDegraded: boolean` 字段
   - Topbar：degraded → 琥珀色脉冲 "繁忙"；正常 → 绿色 "已连接"
   - WsStatusBanner：degraded → 持久琥珀色横幅 "Gateway 繁忙 — 消息将排队等待"
   - ChatInputArea 发送按钮：degraded 时可用（琥珀色），仅完全断连时禁用
   - Toast 日志埋点：所有 toast 调用前加 `[toast]` console.log
13. **重启卡片永驻无法关闭 — duration:Infinity + 默认 dismissible:false**（2026-05-13 修复）：
   - 现象：Gateway 重启成功后 toast "Gateway 连接已断开，可能崩溃，点击重启恢复连接" 永远在屏幕上无法关闭
   - 根因：`toast.error(..., {duration: Infinity, action: {...}})` — sonner 带 action 的 toast 默认 dismissible=false；重连成功 → degraded 分支没清 toast id
   - 修复：duration 60s + dismissible:true + closeButton:true + cancel 关闭按钮；`(connected || degraded)` 都强制 toast.dismiss + 2.5s setTimeout 防御性 dismiss
   - 影响文件：`ChatView.tsx`
14. **gateway-ws 回放后 chat-service UI 队列不同步**（2026-05-13 修复）：
   - 现象：gateway-ws 回放消息后 chat-service.pendingQueue 不出队，UI 永远显示"队列中"
   - 根因：双队列协作但回放完后 gateway-ws 无回调通知 chat-service
   - 修复：gateway-ws 新增 `onQueueDrain(handler)` API + `_replayQueuedSends` 每条发送完触发；chat-service 监听 → DEQUEUE + START_STREAMING
   - 影响文件：`gateway-ws.ts`（QueueDrainHandler 类型 + _queueDrainHandlers + onQueueDrain + _replayQueuedSends 调用）、`chat-service.ts`（ws.onQueueDrain 监听）
15. **healthInterval stale closure**（2026-05-13 修复）：
   - 现象：EventLoop 由 degraded 恢复后，pendingQueue 中的消息不会自动 retry
   - 根因：`prevDegraded = eventLoopDegraded`（state）但 useEffect 没把 eventLoopDegraded 加 deps → 闭包捕获首次 mount 的 false → 永远 prevDegraded === degraded === false → "EventLoop recovered" 分支永不触发
   - 修复：用 `prevDegradedRef` 替代 state 读取，状态变化时同步 ref
   - 影响文件：`chat-service.ts`
16. **重连后 _eventLoopDegraded=true 悲观初始化导致消息全入队**（2026-05-13 修复）：
   - 现象：Gateway 重启成功后用户发消息全部进入队列，等数十秒才发送
   - 根因：`_setState("connected")` 设 `_eventLoopDegraded=true`（悲观），需等真实 health 事件（可能 30s+）才变 false → `isSendReady()` 返回 false → 消息入队
   - 修复：改为乐观初始化 false（如真退化，health 事件会立即标记）；`RECONNECT_COOLDOWN_MS` 5s→1.5s
   - 影响文件：`gateway-ws.ts`（_eventLoopDegraded 初始 + _setState("connected")）
17. **processQueue + onQueueDrain 双重发送死循环**（2026-05-13 修复）：
   - 现象：消息已委托给 gateway-ws 队列，processQueue（EventLoop recovered 触发）会再次发送同一条 → 重复消息 + 队列永不清空
   - 根因：onQueueDrain 出队 + processQueue 重发是两条独立路径
   - 修复：新增 `delegatedToGwRef: Set<string>` 标记已委托消息；processQueue filter 跳过；onQueueDrain 后 delete
   - 附加修复：RESET_STATE 不清 pendingQueue（gateway-ws 仍持有要回放）；SET_SESSION/CLEAR_MESSAGES/LOAD_HISTORY 清空 pendingQueue
   - 影响文件：`chat-service.ts`

## 收发逻辑核心设计（2026-05-13 v4 重构）

### 单队列单驱动器架构（v4 重构后的最终方案）

**核心原则**：
1. **唯一队列**：`chat-service.pendingQueue`。`gateway-ws` 不再持有任何队列。
2. **唯一发送函数**：`_doSend(text)`。唯一从队列移除消息的地方。
3. **唯一驱动器**：`processQueue()`。
4. **防重入**：`sendingRef: boolean` 保证同时只有一次 chat.send 在飞。

**状态字段**：
- `chat-service.pendingQueue: string[]`（reducer 管理）
- `chat-service.chatState: "idle" | "sending" | "streaming" | "tool_executing" | "error"`（reducer 管理）
- `chat-service.sendingRef: React.Ref<boolean>`（防重入）
- `gateway-ws._eventLoopDegraded: boolean`（health 事件解析）
- `gateway-ws._state: "disconnected" | "connecting" | "handshaking" | "connected"`

### 消息流程

```
用户输入
  ↓
sendMessage(text)
  → ADD_USER_MESSAGE（UI 立即显示）
  → ENQUEUE 到 pendingQueue
  → queueMicrotask(processQueue)
       ↓
processQueue()  ← 唯一驱动器
  检查：sendingRef.current === false
  检查：pendingQueue.length > 0
  检查：chatState === "idle"
  检查：ws.isSendReady() === true
  ↓ 全部通过
  sendingRef.current = true
  textToSend = pendingQueue[0]（或合并模式 join 多条）
  _doSend(textToSend)
       ↓
_doSend()
  await ws.sendChat(...)
  成功 → DEQUEUE_BY_TEXT(text) + START_STREAMING
  失败 → 保留在 pendingQueue（reason 入日志）
  finally → sendingRef.current = false
       ↓
   接收 chat 事件流（delta → APPEND_DELTA → final → FINISH_STREAMING）
       ↓
   final 事件 → queueMicrotask(processQueue) → 处理下一条
```

### 驱动 processQueue 的事件
1. **sendMessage 入队后**（用户主动发新消息）
2. **chat 事件 final**（一条对话完成 → FINISH_STREAMING → 触发 processQueue 处理下一条）
3. **gateway-ws onReadyChange ready=true**（重连成功 / EventLoop recovered）
4. **healthInterval 检测到 EventLoop recovered**（额外保险）

### gateway-ws → chat-service 的回调
- `onStateChange(s)`：WS 状态（disconnected/connecting/handshaking/connected）
- `onReadyChange({ready, reason})`：综合 ready 状态变化（包含 ws_connected/ws_disconnected/event_loop_degraded/event_loop_recovered）
- `onMessage(event)`：chat / agent / health 事件流

### SendResult 简化
```ts
type SendResult =
  | { ok: true }
  | { ok: false; reason: "not_ready" | "send_error" | "ack_timeout" | "no_ws" };
```
- 不再有 `queued` 三态
- 调用方（chat-service）拿到 `ok:false` → 消息保留在 pendingQueue，等下次 processQueue 驱动重试

### 关键防御
- 所有触发 processQueue 的回调都用 `queueMicrotask` 异步包装，避免读 stale state
- RESET_STATE（disconnected）**不清** pendingQueue（崩溃后重连仍能继续发）
- SET_SESSION/CLEAR_MESSAGES/LOAD_HISTORY **清空** pendingQueue（切换会话时）
- _setState("connected") 乐观初始化 _eventLoopDegraded=false（让消息能立即发送）

### 已验证修复的历史 bug（v1-v3 → v4 不再可能复现）
- ❌ 双队列状态不同步（v4 单队列）
- ❌ delegatedToGwRef 与 pendingQueue 死锁（v4 删除 delegatedToGwRef）
- ❌ onQueueDrain 循环 DEQUEUE 误删（v4 删除 onQueueDrain，用 DEQUEUE_BY_TEXT）
- ❌ 消息发送后队列卡住（v4 sendingRef 防重入 + 单驱动器）
- ❌ 重启后队列消息不发送（v4 onReadyChange 触发 processQueue）
- ❌ 重启后跳过队列直接发新消息（v4 sendMessage 强制走 ENQUEUE 路径）

## 团队结构（2026-05-13）

- **Team**: `artifex-nexus-team`（位于 `~/.workbuddy/teams/artifex-nexus-team/`）
- **任务列表**: `~/.workbuddy/tasks/artifex-nexus-team/`

### 团队成员

| 角色 | Agent Name | 职责 |
|------|-----------|------|
| 产品经理 | `产品经理` | 产品规划、方案/计划/开发文档、任务管理、需求推进落地 |
| 开发工程师 | `程序` | 功能开发、问题定位、修 bug、构建验证，完成后通知 PM + QA |
| 质量保障 | `QA` | 文档 review、代码 review、功能测试，验收报告输出 |

### 协作流程
1. 用户提需求 → 产品经理拆解任务 → 创建任务到共享任务列表
2. 产品经理分配开发任务给"程序"，分配测试任务给"QA"
3. 程序完成后 → SendMessage 通知产品经理 + QA
4. QA 审查/测试 → 结论（通过/不通过）→ 通知程序 + 产品经理
5. 产品经理跟踪闭环

## OpenClaw 重装备份恢复关键规则（STORY-0041 补充，2026-05-14）

### 实测目录结构（~/.artifexnexus/.openclaw/）
- `openclaw.json` 含：models.providers（baseUrl/apiKey/models）、auth.profiles/order、agents.list[]（id/name/workspace/runtime/skills/prompt）、plugins.entries（全部插件）、plugins.entries.mcp-bridge.config.servers
- Agent 独立工作空间：`workspace/`（默认 agent）+ `workspace-<agent名>/`（额外 agent），含 AGENTS.md / IDENTITY.md / SOUL.md / USER.md / TOOLS.md / HEARTBEAT.md
- Skills：`workspace/skills/` 整个目录（扁平结构，源码端的 official/team/user 分类在安装后不存在）
- Auth 双路径：`.openclaw/agents/<id>/agent/auth-profiles.json`（新，CLI 读）+ `state/agents/<id>/agent/auth-profiles.json`（旧，Gateway embedded agent 读）
- Memory：`state/memory/<agent>.sqlite` + `workspace/memory/`（梦境数据）

### 备份决策
| 数据 | 备份？ | 原因 |
|------|--------|------|
| `plugins/installs.json` | ❌ | OpenClaw `registry --refresh` 自动重建 |
| `plugin-skills/` | ❌ | 全是 symlink → bundled plugin skills |
| `cli/` | ❌ | 体积 ~200MB+，安装脚本负责 |
| `.git/`（workspace 下） | ❌ | 非必要 |
| `workspace/skills/`（全部） | ✅ | 用户 skill 可能在任意子目录 |
| `workspace-<agent>/`（人格文件） | ✅ | 不可丢失 |
| `auth-profiles.json`（双路径） | ✅ | 备份+恢复同时写两个路径 |
| `models.providers` + `auth.profiles/order` | ✅ | 合并为一条 UI 勾选项 |

### 实现状态（2026-05-14）
- ✅ **bootstrap.py**：`_backup_for_reinstall()` / `_clean_install()` / `_restore_from_backup()` + 5 个子恢复函数
- ✅ **sidecar.py**：4 个 RPC（backup/restore/backups.list/backups.delete）
- ✅ **Tauri**：4 个命令 + invoke_handler 注册
- ✅ **IPC**：TypeScript 接口 + 函数
- ✅ **前端**：5 项重装勾选项 + 数据管理 tab
- ✅ **文档**：3 张映射表（勾选项→文件、勾选项→openclaw.json 字段、恢复冲突规则）
- ⏳ Rust cargo check（后台运行中）
