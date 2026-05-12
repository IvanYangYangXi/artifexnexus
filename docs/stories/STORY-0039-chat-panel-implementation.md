# STORY-0039 实现记录：Chat 面板对话管理

## 日期：2026-05-12
## 状态：核心流程已通 ✅，剩余增强项待推进

---

## 一、已解决的问题与最终成功路径

### 1. Gateway WS 握手（device 字段）

**问题**：WS 连接被 Gateway 以 `1008 invalid connect params` 拒绝。

**尝试过的方案**：
- ❌ `device: null` → schema 要求 object
- ❌ `device: {}` → 缺少 required property 'id', 'publicKey'
- ❌ `device: { id, publicKey }` → 缺少 'signature', 'signedAt', 'nonce'
- ✅ **不传 device 字段** — 与 ArtClawToolManager 在无 device identity 时一致，配合 `dangerouslyDisableDeviceAuth=true` 允许无 device 连接

**关键文件**：`packages/apps/web/src/lib/chat/gateway-ws.ts` → `_sendConnectInternal()`

---

### 2. Agent/Model 列表获取

**问题**：`/v1/agents` 和 `/v1/models` HTTP 端点不存在（被 Gateway SPA fallback 吃掉返回 HTML）。

**尝试过的方案**：
- ❌ `fetch /v1/agents` → 返回 HTML（SPA fallback）
- ❌ `fetch /v1/models` → 同上
- ✅ **从 sidecar `openclaw.config.dump` RPC 读取配置文件**

**数据格式**：
```typescript
const config = await ipc.dumpOpenClawConfig();
// agents: (config as any).agentList → Array<{id, name, ...}>
// models: (config as any).providers → { [providerId]: { models: [{id, name}] } }
```

**关键文件**：`packages/apps/web/src/components/chat/ChatControlBar.tsx`

---

### 3. 对话列表获取

**问题**：Gateway 无"列出所有对话"的 HTTP/WS API。

**最终方案**：新增 sidecar RPC `openclaw.sessions.list`，直接读 `sessions.json`。

**数据源**：`~/.artifexnexus/.openclaw/state/agents/<agentId>/sessions/sessions.json`

**关键文件**：
- Python: `sidecar_sessions.py` → `handle_sessions_list()`
- Rust: `openclaw_sessions.rs` → `openclaw_sessions_list`
- TS IPC: `ipc/openclaw.ts` → `getSessionsList()`

---

### 4. 对话历史消息加载

**问题**：WS RPC `chat.history` 需要 operator scope 且格式不确定。

**尝试过的方案**：
- ❌ HTTP `GET /sessions/<key>/history` → 返回 403 "missing scope: operator.read"
- ❌ WS RPC `chat.history` → 格式/参数不确定，不稳定
- ✅ **新增 sidecar RPC `openclaw.sessions.history`，直接读 `.jsonl` transcript 文件**

**数据源**：`~/.artifexnexus/.openclaw/state/agents/<agentId>/sessions/<sessionId>.jsonl`

**格式**：NDJSON，每行 `{ type: "message", message: { role, content: [{type:"text", text}] } }`

**关键文件**：
- Python: `sidecar_sessions.py` → `handle_sessions_history()`
- Rust: `openclaw_sessions.rs` → `openclaw_sessions_history`
- TS IPC: `ipc/openclaw.ts` → `getSessionsHistory()`
- 调用方: `ChatView.tsx` → `handleSwitchSession()` + `useEffect([activeSessionKey])`

---

### 5. 消息发送（chat.send RPC）

**问题**：`sendChat` 的 ACK 检查 `status === "started"` 不匹配实际 Gateway 响应。

**修复**：
- ACK resolve 改为收到非 error 响应即 `resolve(true)`
- RPC 响应 `_handleMessage` 中传整个 msg 对象（去掉 type/id），而非只传 `msg.payload`
- `sessionKeyRef` 初始为空，必须先选中对话才能发消息

**关键文件**：`gateway-ws.ts` → `sendChat()` + `_handleMessage()`

---

### 6. Gateway 启动遮罩

**问题**：`/v1/agents` 健康检查永远返回 200（SPA HTML）。

**最终方案**：轮询 `tailGatewayLog`，匹配 `[gateway] ready` 日志；5s 后加 `getOpenClawStatus().gateway_running` fallback。

**启动阶段显示**：
- `正在检测环境…`
- `正在启动 OpenClaw Gateway…`
- `加载配置文件…`（匹配 `resolving authentication`）
- `HTTP 服务已启动，等待 sidecar…`（匹配 `starting HTTP`）
- `正在初始化 sidecars 和通道…`（匹配 `starting channels`）
- `Gateway 就绪`（匹配 `[gateway] ready`）

**超时处理**：30s 超时 → 跳转系统状态页

---

### 7. 系统日志面板

**修复**：
- 增量拉取（首次 `{n:50}`，后续 `{sinceId: lastMaxId}`）
- 时间过滤（`ts >= status.started_at`）只显示当次 Gateway 启动后的日志

---

### 8. Gateway 启动期间 WS 重连

**修复**：close code 1013 时不走指数退避，改为固定 2s 间隔重试（最多 10 次），`console.log` 静默输出。

---

### 9. Python sidecar 兼容性

**修复**：
- `_list_pids_on_port()` 的 `netstat` 在中文 Windows 上输出 GBK 编码 → 加 `encoding="utf-8", errors="replace"`
- `sidecar_sessions.py` 错误引用 `bootstrap.get_default_home()` → 改为内部实现 `_get_openclaw_home()`

---

## 二、未完成/待增强项

### 高优先级

1. **思考强度（effort）关联发送** — 当前 ChatControlBar 选择了 effort 但没传给 `chat.send` RPC
2. **Agent/Model 关联对话** — 对话列表显示了 model 信息，但切换 Agent/Model 后发消息没有指定 agent/model（Gateway 会用 session 绑定的默认值）
3. **新消息后对话列表标题更新** — 首条用户消息应更新对话标题
4. **发送消息后对话列表刷新** — 新建对话发送首条消息后，对话列表应该出现新条目

### 中优先级

5. **代码块 >5 行自动折叠** — 已实现（CodeBlock 组件），需验证
6. **工具调用 >3 条自动折叠** — 已实现（ToolCallGroup defaultOpen=length<=3），需验证
7. **复制只复制文字不复制工具调用** — 已实现（`navigator.clipboard.writeText(message.content)`），需验证
8. **Gateway 启动概率超时** — 当 Gateway 冷启动时间 >15s 时可能超时，可考虑增大超时或使用渐进式提示
9. **第二次启动概率失败** — 可能是 `_cleanup_orphan_gateways` 的 netstat 编码问题残留（已修 utf-8 replace 但可能需要进一步验证）

### 低优先级

10. **对话历史滚动加载更多** — 当前固定 limit=50，用户滚动到顶部时应加载更早的消息
11. **对话删除功能** — 前端有按钮但后端未实现
12. **WS 断开重连后恢复对话状态** — 当前重连后需要手动刷新
13. **OpenClaw 内置 Control UI 的 WARN 日志** — 来自 `origin=http://127.0.0.1:19789` 的 `startup-sidecars-pending` 是正常行为，不影响功能

---

## 三、架构决策记录

| 决策 | 理由 |
|------|------|
| 对话列表/历史从 sidecar 读文件 | Gateway 无 REST API，WS RPC scope 限制大，文件是唯一稳定数据源 |
| Agent/Model 从 config dump 读 | Gateway 无 `/v1/agents` HTTP API |
| 不传 device 字段 | 与 ArtClawToolManager 一致，dangerouslyDisableDeviceAuth=true 允许 |
| 启动检测用日志匹配 | `/v1/agents` 是 SPA fallback，sidecar status 在 spawn 后立即变 true |
| 前端不做 localStorage 持久化 | 对话数据源已迁移到 Gateway sessions.json + .jsonl |
