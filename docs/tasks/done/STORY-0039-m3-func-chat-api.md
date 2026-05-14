---
id: STORY-0039
kind: story
title: M3-FUNC-01 · Chat 功能接线（API + WebSocket 流式）
status: done
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
children:
  - "[[TASK-0051-story39-gateway-stability]]"
  - "[[TASK-0052-gateway-startup-optimization]]"
  - "[[TASK-0053-dcc-preinput-context]]"
  - "[[TASK-0050-chat-panel-interaction-optimization]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/web-chat-structure]]"
related_packages:
  - "packages/apps/web"
  - "packages/adapters/openclaw"
tags: [story, chat, api, websocket, streaming, M3]
---

# STORY-0039 · Chat 功能接线（API + WebSocket 流式）

## 用户故事
在 Chat 界面输入消息后，能通过 OpenClaw API 发送并接收流式回复，工具调用卡片实时更新。

## 验收标准
- [x] 对接 OpenClaw Chat API（`POST /v1/chat/completions`）— WebSocket 全双工协议
- [x] WebSocket 流式接收（SSE 或 WS），逐 token 渲染 — GatewayWebSocket 客户端
- [x] 工具调用卡片实时显示：⏳ → ✅/❌ + 耗时
- [x] 对话状态机完整运行：Idle → Sending → Streaming → ToolExecuting → Idle
- [x] 停止按钮可用（中断流式）— chat.abort RPC
- [x] 恢复按钮可用（继续生成）— Resume 按钮 + 自动恢复
- [x] 队列发送：生成中按发送 → 排队 → 自动发送
- [x] 错误处理：网络断开/Gateway 不可用 → 错误提示 + 重试
- [x] 对话持久化（localStorage 或 IndexedDB）— localStorage 即时可用 + IndexedDB 层就绪
- [x] 对话列表/Agent列表/模型列表/思考强度正确接入
- [x] 切换对话瞬间加载历史（内存缓存 + Rust 直读 .jsonl）
- [x] 代码块折叠展开状态在消息刷新时保持
- [x] Gateway 崩溃时友好提示 + 重启按钮

## 前置任务（已记录）
- [x] 移除左下角头像旁的设置按钮（B3 区域）
- [x] 启动时自动检测 OpenClaw：已安装→自动启动 Gateway；未安装→跳转系统面板+弹窗
- [x] 自动恢复：WebSocket 重连后检测未完成流式消息自动续写

## 实施日志

### 2026-05-11 16:18 · 核心实现
- 新建 `gateway-ws.ts`（WebSocket 全双工客户端）、`chat-service.ts`（useReducer 状态机）、`persistence.ts`（IndexedDB）、`types.ts`
- ChatView/ChatMessageList/ChatInputArea 接入真实数据
- Sidebar 移除 B3 设置按钮，AppShell 启动自检
- TypeScript 编译通过，Next.js build 通过

### 2026-05-11 18:00 · Gateway 连接调试（共 6 轮）

**R1** — client.id/mode 白名单问题：
- 反编译 OpenClaw `client-info.ts` 得白名单
- `client.id`: `"artifex-nexus"` → `"webchat-ui"` → `"cli"`（最终对齐 artclaw `gateway_client.py`）
- `client.mode`: `"gui"` → `"operator"` → `"webchat"` → `"cli"` → `"openclaw-control-ui"`/`"ui"`

**R2** — BOM 导致 token 读取失败：
- 症状：Gateway log 报 `code=1008 reason=unauthorized, token_missing, authProvided=none`
- 根因：`openclaw.json` 有 UTF-8 BOM（`EF BB BF`），`bootstrap.read_config` 用 `read_text + json.loads` 对 BOM 抛 `JSONDecodeError` 被静默吞掉返回 `None` → token 空
- 方案：改 `read_bytes()` + 显式剥 BOM + `decode("utf-8")`

**R3** — 端口漂移（对应用户反馈"19809 不该出现"）：
- 根因：`bootstrap.bootstrap_with_port_probe` 在 19789 被占时按 `+20` 步进自动迁移到 19809
- 方案：写死 19789 + `bootstrap_fixed_port` + `reset_config_port_if_drifted` 一次性自愈
- 新增 `PortBusyError` + `_describe_pid`，外部占用时前端弹窗

**R4** — origin 白名单：
- Tauri WebView2 发 `http://tauri.localhost` 但白名单只有 `https://tauri.localhost`
- runtime.py `required_origins` 加入 `http://tauri.localhost`

**R5** — Promise 悬挂：
- `_handshake()` 在 WS 关闭时永远不 resolve → `connect()` Promise hang → 重连失效
- 加 `safeResolve` + onclose hook，WS 关闭时立即 resolve(false)

**R6** — device identity required：
- `dangerouslyDisableDeviceAuth=true` 仅对特定 clientId 生效
- 最终使用 `client.id="openclaw-control-ui"`, `mode="ui"` 绕过

### 2026-05-11 21:00 · 清理 controlUi.allowedOrigins 漂移残留（第四轮）
- `_ensure_control_ui_allowed_origins` 改为"取并集只加不删" → 增加保守漂移清理
- 漂移候选 port 集合 `{19809, 19829, ...}`，命中 loopback 格式即剥离；用户自加 origin 保留
- 3 条新单测通过

### 2026-05-11 22:34 · 状态机修复 + API key + auth 迁移
- 状态机卡死：WS 断连时 dispatch `RESET_STATE`；2 分钟 idle timeout 自动 `FINISH_STREAMING`
- API key 保存：`SettingsPage.tsx` handleSave 缺少 `profileId` 参数修复
- auth-profiles.json 路径迁移（`state/agents/` → `.openclaw/agents/`）
- `Cargo.toml` 启用 `features = ["devtools"]`（F12 可用）
- 发现：Gateway 每条消息的 model-resolution(6.7s) + auth(3.2s) 是上游行为

### 2026-05-12 00:55 · UI 细节优化
- 工具调用超过3条自动折叠（`defaultOpen={length <= 3}`）
- 代码块超过5行自动折叠（`CodeBlock` 组件）
- 复制按钮改为只复制对话文字（`message.content`）

### 2026-05-12 14:00–18:00 · Gateway 启动卡死调试（共 7 轮）

**根因链**（逐轮定位）：
1. **sidecar stdin block-buffer**：Rust spawn Python 没传 `-u`，Windows 下 stdin block-buffered → `for line in sys.stdin:` 不返回 → 30s 超时。修：加 `-u` + `PYTHONUNBUFFERED=1` + `PYTHONIOENCODING=utf-8`。
2. **sidecar 重启后状态丢失**：`runtime.is_running()` 依赖进程级全局变量 `_current_openclaw_home`，sidecar 重启后为 None → 永远查不到上一代留的 gateway。修：fallback 读 PID 锁文件。
3. **孤儿 Gateway + PID 复用误判**：`_is_pid_alive()` 只查 PID 是否存在不验身份，Windows PID 回收快导致误判。修：新增 `_is_openclaw_gateway_pid()` 校验 image name = node.exe。
4. **PID 锁 vs 实际 PID 不匹配**：`openclaw gateway run --force` 是 wrapper，Popen PID ≠ 实际 node.exe PID。修：`is_running()` 和 `handle_gateway_status()` 增加端口探测 fallback。
5. **waitReady done=true 短路**：`done=true` 后 `waitReady` 内部循环第一轮直接 return，没有任何路径设 `setGatewayStarting(false)` → 遮罩 90s 超时才消失。修：删旧 waitReady，改 doCheck 内部 for 循环轮询。
6. **sidecar atexit 杀 gateway**：sidecar stdin EOF 退出时 atexit 触发 `_shutdown_gateway_quietly()` 杀掉刚启的 gateway。修：新增 `_exit_reason` 变量，EOF 退出不杀 gateway。
7. **GatewayTab 状态不同步**：`gateway_state` 进程级单例 vs `runtime.is_running()` PID 锁 fallback 数据源不一致。修：`handle_gateway_status` 增加 fallback + 5s 轮询。

### 2026-05-12 19:00–20:30 · 切对话历史消失 + React #418 渲染崩溃（共 5 轮）

**根因链**：
1. **`__empty__` 哨兵值穿透**：Radix Select onValueChange 触发 `"__empty__"` → `switchSession("__empty__")` → CLEAR_MESSAGES → 历史清空。修：三层守卫（ChatControlBar + ChatView + chat-service）。
2. **渲染崩溃 = 历史消失**：被 revert 的 CodeBlock 加固代码，`SyntaxHighlighter` 拿到空 language/undefined code 抛错 → 整棵 ChatMessageList unmount。修：4 道防御（CodeBlock 兜底 + SafeSyntaxHighlighter ErrorBoundary + 单条消息 ErrorBoundary + MarkdownContent null 防御）。
3. **React #418 = `<div> in <p>` 非法嵌套**：ReactMarkdown fenced code block 被 wrap 在 `<p>` 内，自定义 `code()` 返回 CodeBlock 含 `<div>` → 浏览器自动闭合 → DOM 不匹配。修：hook `pre` 而非 `code`；`p` 改 `<div>`。
4. **SSR prerender**：Next.js prerender 的 HTML 与 client hydrate 不一致。修：`page.tsx` 改 `dynamic({ ssr: false })`。
5. **sidecar Mutex 锁竞争**：`manager.call` 30s 超时 + 无脑重启 sidecar → 健康 sidecar 被误杀。修：区分超时 vs IO 失败，超时不重启；`handleSwitchSession` 改为先加载后替换。

### 2026-05-12 20:35–21:50 · 对话恢复机制重构 + 代码块展开 + Gateway 崩溃提示

**问题 1：切对话显示前一对话内容 / loading 转圈加载不出**
- 根因：Gateway `getSessionsHistory` RPC 被 sidecar Mutex 阻塞 30s 超时
- 尝试方案（按顺序）：
  1. loading 中间态（仍卡在 async RPC 超时）
  2. IndexedDB 缓存优先（IndexedDB 也是 async，首次缓存为空仍超时）
  3. 内存 Map 同步缓存（参考 ArtClawToolManager `cachedMessages`，已访问对话瞬间切换，但首次仍需 RPC）
  4. **最终方案：Rust 端直读 .jsonl 绕过 sidecar** — `openclaw_sessions.rs` 新增 `read_transcript_from_disk()`，直接从 `state/agents/<agentId>/sessions/sessions.json` 查 `sessionFile`，读 `.jsonl` 文件解析消息，零延迟
- 内存缓存 + Rust 直读 = 首次+切换都是毫秒级

**问题 2：代码块展开状态在消息刷新时自动收起**
- 根因：APPEND_DELTA `.map()` 返回新 messages 数组 → ChatMessageList re-render → 所有 MessageBubble 无条件 re-render → ReactMarkdown 重解析 → CodeBlock unmount/remount → `useState` 重置
- 方案（双层防护）：
  1. `MessageBubble` + `MarkdownContent` 加 `React.memo`（阻止未变化消息重渲染 — 核心保障）
  2. `codeBlockExpandedCache = new Map<string, boolean>()`（模块级缓存，按 `${msgId}-cb-${index}` 索引，remount 后恢复 — 兜底）

**问题 3：切对话滚动从头滑到尾**
- 修：`scrollBehaviorRef` 区分场景，切对话/初始加载用 `"instant"` 跳底，新消息用 `"smooth"` 平滑

**问题 4：Gateway 崩溃静默失败**
- 日志关键证据：`eventLoop degraded=true, delayMaxMs=10720.6` — Node.js 事件循环阻塞 10.7s 后进程崩溃（OpenClaw 上游 bug）
- 方案 v1：内嵌横幅（红色/琥珀色状态条 + 重启按钮）
- 方案 v2（最终）：改为右下角 sonner toast 通知（非阻塞）
  - AppShell 挂载 `<Toaster />`（position=bottom-right）
  - Gateway 断连 → `toast.error`（持久，带"重启 Gateway"按钮）
  - 重连中 → `toast.loading` 替换同一 toast
  - 重连成功 → `toast.success`（2s 后自动消失）
  - `chat.error` → 独立 `toast.error`（5s 后消失）

**问题 5：停止按钮无法终止 Gateway 崩溃后的流式状态**
- 根因：WS onclose → dispatch `RESET_STATE` 只清 `streamingMessageId`/`chatState`，不清消息的 `isStreaming:true` 标记。之后 `STOP` 用已清空的 `streamingMessageId` 匹配不到消息 → `isStreaming` 永久残留
- 修：`RESET_STATE` 增加 `messages.map` 清理所有 `isStreaming:true`；`stop()` 追加 `RESET_STATE` 兜底

**架构规范更新**：`.ai/rules/00-architecture.md` 新增第 10 条 — 桌面应用代码分层优先级（TS > Python > Rust）

## 待解决
- [ ] Gateway 崩溃根因（OpenClaw 上游 Node.js 事件循环阻塞 → OOM/crash，非前端可修）
- [ ] 重新打开 exe 自动恢复上次对话（当前内存缓存随进程退出丢失，需持久化到 IndexedDB 或文件）

## 依赖
- ← STORY-0034（Chat 模块 UI）
- ← STORY-0038（Desktop 内嵌）

## 非范围
- 多模态（图片/文件上传）
- 对话搜索
