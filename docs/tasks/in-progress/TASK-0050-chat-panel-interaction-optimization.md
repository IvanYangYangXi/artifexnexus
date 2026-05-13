---
id: TASK-0050
kind: task
title: Chat 面板交互优化 — 新对话/停止/配置状态显示/对话删除
status: completed
priority: P1
owner: "@ivan"
assignee: pair
estimate: 4h
created: 2026-05-13
parent: "[[../ready/STORY-0039-m3-func-chat-api]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/web-chat-structure]]"
related_packages:
  - "packages/apps/web"
tags: [task, chat, ui, interaction, M3]
---

# TASK-0050 · Chat 面板交互优化

## 用户故事
聊天面板的交互细节需要对齐 ArtClawToolManager 的行为：新对话按钮能用、停止/恢复正常工作、Agent/Model/思考模式在对话中不可更改、对话列表支持删除。

## 验收标准

- [x] 输入区"新对话"按钮可点击 → 弹出配置面板选择 Agent/Model/思考模式
- [x] 控制栏 [+] 按钮触发相同弹窗
- [x] 控制栏 Agent/Model/Thinking 改为只读标签（对话中不可更改，绑定到对话创建时）
- [x] 新建对话弹出面板含 3 个选择器 + 取消/创建按钮
- [x] 停止按钮：仅在流式生成中显示（红色 destructive），停止后 canResume=true
- [x] 恢复按钮：停止后可恢复，发送"请继续"
- [x] 对话列表支持删除（X 按钮 → 从列表移除 + 从内存缓存清除）
- [x] pnpm tsc --noEmit 零错误

---

## ArtClawToolManager 参考分析

### 参考来源

本地副本：`D:\MyProject_D\artclaw_bridge\subprojects\DCCClawBridge\artclaw_ui\`

| 文件 | 作用 |
|------|------|
| `chat_panel.py` | 主组装器：消息发送/接收、会话切换、Bridge 生命周期 |
| `chat_panel_actions.py` | 操作处理器：停止/恢复/新对话/Agent 切换等 |
| `chat_session.py` | 多会话管理器：SessionEntry + SessionManager + SessionMenuWidget |
| `chat_toolbar.py` | 工具栏：发送/停止/新对话/恢复/附件按钮 |

### 功能对比矩阵

| 功能 | ArtClawToolManager (Python/Qt) | ArtifexNexus (React/TS) | 差异与复用 |
|------|-------------------------------|------------------------|-----------|
| **停止 AI 回复** | `_on_stop()`: bridge.cancel() → 设 `_is_waiting=false` → 移除 streaming/thinking 消息 → 添加"已停止"系统消息 | `stop()`: ws.abortChat() → dispatch STOP → dispatch RESET_STATE → **Bug: RESET_STATE 清 cancelledMessageId，canResume 永远 false** | 🔴 需修复 |
| **恢复 AI 回复** | `_on_resume()`: 从 Gateway `fetch_history` 拉完整历史 → 替换消息列表 | `resume()`: check cancelledMessageId → RESET_STATE → `sendMessage("请继续")` | 🟢 当前方案正确（发送"请继续"由 Gateway 自然恢复），但 bug 阻塞 |
| **新建对话** | `_on_new_chat()`: 保存当前 session key → 清屏 → `bridge.reset_session()` → `session_mgr.new_session_local()` | `handleNewSession()`: 硬编码 `agent:artifex-nexus:session-{ts}` → `chat.createNewSession()` | 🟡 需改为弹窗选择配置后再创建 |
| **对话切换** | `_on_session_selected()`: 先 `_cache_current_messages()` → `switch_session()` → 优先 Gateway 历史，fallback 到 `cached_messages` | `switchSession()`: `messageCache.set(current)` → 同步读 Map → LOAD_HISTORY 或 CLEAR | 🟢 已对齐（Rust 直读 .jsonl 更快） |
| **对话删除** | `_on_session_deleted()`: `delete_session(index)` → pop + recalc active_index → 如为空则 init_first_session | `deleteSession()`: **空实现，仅 CLEAR_MESSAGES** | 🔴 缺失，需实现 |
| **Agent 切换与会话隔离** | `cache_for_agent_switch()` / `restore_from_agent_switch()`: 每个 Agent 独立的会话列表缓存 | Agent 编码在 sessionKey 内：`agent:{id}:session-{ts}` | 🟢 无需改动（结构化 key 已实现隔离） |
| **配置绑定** | Agent/Model/Thinking 在 SettingsDialog 配置，**非对话级**（切换 Agent → 缓存当前 Agent 的所有会话） | Agent/Model/Thinking 通过 Select 下拉可随时更改 → **与对话列表绑定** | 🟡 需改为只读标签 + 创建时选择 |

### 可复用模式

1. **`SessionManager.cached_messages` → `chat-service.ts messageCache`**  
   已复用为模块级 `Map<string, ChatMessage[]>`，同步切换零延迟。

2. **`cache_for_agent_switch` → sessionKey 前缀 `agent:{id}:`**  
   已通过结构化 sessionKey 实现 Agent 隔离，无需额外缓存层。

3. **`_on_new_chat` 流程：保存 → 清屏 → reset → new entry**  
   可参考其"先保存当前状态，再创建新会话"的顺序，确保不丢数据。

4. **`SessionMenuWidget` 每行 `[标签] [X]` 模式**  
   在 ChatControlBar 的 Select 中加入删除按钮。

5. **`_on_stop` 的"移除 streaming/thinking 消息"思路**  
   ArtClawToolManager 用 Qt 直接操作 widget 列表，我们用 reducer 的 STOP action。

### 不适用 / 需重新设计

| 模式 | 原因 |
|------|------|
| `bridge.reset_session()` | ArtifexNexus 不直接操作 Bridge，由 Gateway 管理会话 |
| Qt Signal/Slot 模式 | ArtifexNexus 使用 React hooks + useReducer |
| `SettingsDialog` 配置 Agent | ArtifexNexus 改为"新建对话时弹窗选择"，Agent 绑定到对话而非全局 |
| `_last_session.json` 持久化 | ArtifexNexus 的会话由 Gateway sessions.json 管理，前端不独立持久化会话列表 |

---

## 实施计划

### 改动清单

| # | 文件 | 改动类型 | 描述 |
|---|------|---------|------|
| 1 | `NewSessionDialog.tsx` | **新建** | 模态面板，含 Agent/Model/Thinking 三个 Select |
| 2 | `ChatControlBar.tsx` | **修改** | 三个 Select → 只读标签 + [+] 按钮；新增 `onOpenNewSessionDialog` prop |
| 3 | `ChatView.tsx` | **修改** | 新增 `newSessionDialogOpen` 状态；`handleNewSession` 接受 config 参数；渲染 NewSessionDialog |
| 4 | `chat-service.ts` | **修改** | 修复 `stop()` 清除 cancelledMessageId 的 bug；实现 `deleteSession()` |
| 5 | `ChatInputArea.tsx` | **修改** | 新增 `onNewSession` prop；按钮绑定 onClick；停止按钮条件显示 |

### 改动 1：`NewSessionDialog.tsx`（新建 ~130 行）

**路径**：`packages/apps/web/src/components/chat/NewSessionDialog.tsx`

```
Props:
  - open: boolean          — 面板是否打开
  - onClose: () => void    — 取消/关闭
  - onConfirm: (cfg) => void — 确认创建
  - gatewayPort: number    — Gateway 端口（用于拉取 Agent/Model 列表）
  - gatewayRunning: boolean

内部状态:
  - agent (localStorage fallback)
  - model (localStorage fallback)
  - thinking (localStorage fallback "adaptive")
  - agents[] / models[] (从 Gateway 配置拉取)

UI:
  - Dialog + DialogHeader("新建对话") + DialogContent
  - 3 个 Select: Agent / Model / Thinking
  - DialogFooter: 取消 + 创建按钮
  - 数据加载中显示 Skeleton
```

数据拉取逻辑复用 ChatControlBar 现有 `ipc.dumpOpenClawConfig()` 的 agents/models 提取代码。

### 改动 2：`ChatControlBar.tsx`

#### 2a. 新增 `onOpenNewSessionDialog` prop

```ts
export interface ChatControlBarProps {
  // ... 现有 props ...
  onOpenNewSessionDialog: () => void;
}
```

#### 2b. Agent/Model/Thinking 改为只读标签

替换 L237-269 的三个 `<Select>`：

```tsx
{/* Agent — 只读标签 */}
<span className="inline-flex items-center gap-1 bg-muted/30 rounded px-1.5 py-0.5 text-xs text-muted-foreground">
  Agent: {agents.find(a => a.id === agent)?.name ?? agent}
</span>

{/* Model — 只读标签 */}
<span className="inline-flex items-center gap-1 bg-muted/30 rounded px-1.5 py-0.5 text-xs text-muted-foreground">
  Model: {models.find(m => m.id === model)?.name ?? model}
</span>

{/* Thinking — 只读标签 */}
<span className="inline-flex items-center gap-1 bg-muted/30 rounded px-1.5 py-0.5 text-xs text-muted-foreground">
  {THINKING_OPTIONS.find(e => e.id === effort)?.label ?? ""}
</span>

{/* [+] 按钮 — 打开新建对话面板 */}
<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onOpenNewSessionDialog}>
  <Plus className="h-3 w-3" />
</Button>
```

#### 2c. 对话选择改为支持删除

在 SelectContent 的每个 session item 中加 X 删除按钮，类似 ArtClawToolManager 的 `SessionMenuWidget._make_row()` 的 `[标签] [X]` 模式。

需要新增 prop: `onDeleteSession: (sessionKey: string) => void`

### 改动 3：`ChatView.tsx`

#### 3a. 新增状态

```tsx
const [newSessionDialogOpen, setNewSessionDialogOpen] = React.useState(false);
```

#### 3b. 重写 `handleNewSession`

```tsx
function handleNewSession(config: { agentId: string; model: string; thinking: string }) {
  const newKey = `agent:${config.agentId}:session-${Date.now()}`;
  setActiveSessionKey(newKey);
  chat.createNewSession();
  chat.setSelectedConfig(config);
  // 持久化到 localStorage
  try { localStorage.setItem("artifex.chat.agent", config.agentId); } catch {}
  try { localStorage.setItem("artifex.chat.model", config.model); } catch {}
  try { localStorage.setItem("artifex.chat.effort", config.thinking); } catch {}
  setNewSessionDialogOpen(false);
}
```

#### 3c. 渲染 NewSessionDialog

```tsx
<NewSessionDialog
  open={newSessionDialogOpen}
  onClose={() => setNewSessionDialogOpen(false)}
  onConfirm={handleNewSession}
  gatewayPort={port}
  gatewayRunning={gatewayRunning}
/>
```

#### 3d. 传递 props

```tsx
<ChatControlBar
  onOpenNewSessionDialog={() => setNewSessionDialogOpen(true)}
  onDeleteSession={handleDeleteSession}
  ...
/>
<ChatInputArea
  onNewSession={() => setNewSessionDialogOpen(true)}
  ...
/>
```

#### 3e. 新增 `handleDeleteSession`

```tsx
function handleDeleteSession(sessionKey: string) {
  chat.deleteSession(sessionKey);
  // 如果删除的是当前对话，切换到下一个或创建新对话
  if (sessionKey === activeSessionKey) {
    const remaining = sessions.filter(s => s.sessionKey !== sessionKey);
    if (remaining.length > 0) {
      handleSwitchSession(remaining[0].sessionKey);
    } else {
      handleNewSession({ agentId: "artifex-nexus", model: "deepseek-v4", thinking: "adaptive" });
    }
  }
}
```

### 改动 4：`chat-service.ts`

#### 4a. 修复 `RESET_STATE` 不清 `cancelledMessageId`

```diff
case "RESET_STATE":
  return { ...state,
    messages: state.messages.map(m => m.isStreaming ? { ...m, isStreaming: false } : m),
    chatState: "idle", streamingMessageId: null, error: null,
-   cancelledMessageId: null,
+   cancelledMessageId: state.cancelledMessageId,
  };
```

#### 4b. `stop()` 移除立即的 RESET_STATE

```diff
async function stop(): Promise<void> {
  const ws = wsRef.current;
  if (ws && ws.state === "connected") await ws.abortChat(sessionKeyRef.current);
  dispatch({ type: "STOP" });
- dispatch({ type: "RESET_STATE" });
  lastTextRef.current = "";
}
```

STOP reducer 已经设了 `cancelledMessageId: state.streamingMessageId`，不再被 RESET_STATE 清除后，`canResume` 正确返回 true。

#### 4c. 实现 `deleteSession()`

```ts
function deleteSession(sessionId: string): void {
  // 从内存缓存删除
  const key = sessionId.includes(":") ? sessionId : `agent:${agentId}:${sessionId}`;
  messageCache.delete(key);
  // 如果删除的是当前会话，清空消息
  if (sessionKeyRef.current === key) {
    dispatch({ type: "CLEAR_MESSAGES" });
  }
}
```

### 改动 5：`ChatInputArea.tsx`

#### 5a. 新增 `onNewSession` prop

```ts
interface ChatInputAreaProps {
  // ... 现有 props ...
  onNewSession?: () => void;
}
```

#### 5b. 按钮绑定 onClick

L315-318:
```diff
- <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
+ <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onNewSession}>
```

#### 5c. 停止按钮条件显示

L339-347: 只在 isStreaming 时显示：

```diff
- {/* 停止按钮 — 始终显示 */}
- <Button size="icon" variant="destructive" className="h-9 w-9" onClick={onStop} title="停止生成">
-   <Square className="h-4 w-4 fill-current" />
- </Button>
+ {isStreaming && (
+   <Button size="icon" variant="destructive" className="h-9 w-9" onClick={onStop} title="停止生成">
+     <Square className="h-4 w-4 fill-current" />
+   </Button>
+ )}
```

恢复按钮（`canResume`）独立渲染，不受影响。

---

## 数据流

```
[+] / "新对话" 按钮
  → setNewSessionDialogOpen(true)
  → NewSessionDialog 弹出（从 Gateway 拉 Agent/Model 列表）
  → 用户选择 → 点击"创建"
  → ChatView.handleNewSession({ agentId, model, thinking })
  → chat.createNewSession() + chat.setSelectedConfig()
  → localStorage 持久化
  → ChatControlBar 标签更新
  → 关闭弹窗

停止按钮
  → chat.stop() → ws.abortChat() → dispatch STOP
  → reducer: cancelledMessageId 设值, isStreaming 标记 false
  → canResume = true → 恢复按钮出现
  → 点击恢复 → chat.resume() → sendMessage("请继续")

删除对话
  → ChatControlBar SelectItem X 按钮 → onDeleteSession(key)
  → chat.deleteSession(key) → messageCache 删除 → CLEAR_MESSAGES
  → 如为当前对话 → 切换到剩余第一个或弹新建面板
```

---

## 非范围

- Gateway 断连/重连逻辑（已修）
- 消息渲染/代码块展开（已修）
- 对话历史持久化（由 Gateway sessions.json 管理）
- 多 DCC 切换（M7 范围）
- Settings 面板（全局配置，不在本次范围）

---

## 相关

- `[[../ready/STORY-0039-m3-func-chat-api]]` — 父 STORY
- `[[../../specs/ui/web-chat-structure]]` — Chat UI 结构规格
- `D:\MyProject_D\artclaw_bridge\subprojects\DCCClawBridge\artclaw_ui\chat_session.py` — ArtClawToolManager 会话管理参考
- `D:\MyProject_D\artclaw_bridge\subprojects\DCCClawBridge\artclaw_ui\chat_panel_actions.py` — ArtClawToolManager 操作处理参考
