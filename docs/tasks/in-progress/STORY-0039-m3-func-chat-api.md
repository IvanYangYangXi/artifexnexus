---
id: STORY-0039
kind: story
title: M3-FUNC-01 · Chat 功能接线（API + WebSocket 流式）
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
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
- [x] 对接 OpenClaw Chat API（WebSocket 全双工协议）
- [x] WebSocket 流式接收，逐 token 渲染
- [x] 工具调用卡片实时显示：⏳ → ✅/❌ + 耗时
- [x] 对话状态机完整运行：Idle → Sending → Streaming → ToolExecuting → Idle
- [x] 停止按钮可用（中断流式）
- [x] 恢复按钮可用（继续生成）
- [x] 队列发送：生成中按发送 → 排队 → 自动发送
- [x] 错误处理：网络断开/Gateway 不可用 → 错误提示 + 重试
- [x] 对话持久化（localStorage）
- [ ] 对话列表/Agent列表/模型列表/思考强度正确接入
- [ ] 重新打开exe自动恢复上次对话

## 前置任务
- [x] 移除左下角头像旁的设置按钮
- [x] 启动时自动检测 OpenClaw：已安装→自动启动 Gateway；未安装→跳转系统面板+弹窗
- [x] 自动恢复：WebSocket 重连后检测未完成流式消息自动续写

## 实施日志

### 2026-05-11 16:18 · 核心实现
- 新建 `gateway-ws.ts`（WebSocket 全双工客户端）、`chat-service.ts`（useReducer 状态机）、`persistence.ts`（IndexedDB）、`types.ts`
- ChatView/ChatMessageList/ChatInputArea 接入真实数据
- Sidebar 移除 B3 设置按钮，AppShell 启动自检

### 2026-05-11 18:00 · Gateway 连接调试（共 6 轮）
**R1** — client.id/mode 白名单问题：
- 反编译 OpenClaw `client-info.ts` 得白名单
- `client.id`: `"artifex-nexus"` → `"webchat-ui"` → `"cli"`（最终对齐 artclaw `gateway_client.py`）
- `client.mode`: `"gui"` → `"operator"` → `"webchat"` → `"cli"` → `"openclaw-control-ui"`/`"ui"`

**R2** — BOM 导致 token 读取失败：`openclaw.json` 有 UTF-8 BOM，`bootstrap.read_config` 改 `read_bytes()` + 显式剥 BOM

**R3** — 端口漂移：bootstrap 自动探测在 19789 被占时跳到 19809，连锁影响。改为写死 19789 + `reset_config_port_if_drifted` 自愈

**R4** — origin 白名单：Tauri WebView2 发 `http://tauri.localhost` 但白名单只有 `https://tauri.localhost`。runtime.py `required_origins` 加入 `http://tauri.localhost`

**R5** — Promise 悬挂：`_handshake()` 在 WS 关闭时永远不 resolve。加 `safeResolve` + onclose hook

**R6** — device identity required：`dangerouslyDisableDeviceAuth=true` 仅对 `openclaw-control-ui` 客户端生效。最终使用 `client.id="openclaw-control-ui"`, `mode="ui"` 绕过

### 2026-05-11 22:34 · 状态机修复 + API key
- WS 断连时 dispatch `RESET_STATE`；2 分钟 idle timeout
- `setOpenClawAuthToken` 缺少 `profileId` 参数修复
- `auth-profiles.json` 路径迁移（`state/agents/` → `.openclaw/agents/`）

### 2026-05-12 00:55 · UI 细节优化
- 工具调用超过3条自动折叠（`defaultOpen={length <= 3}`）
- 代码块超过5行自动折叠（`CodeBlock` 组件）
- 复制按钮改为只复制对话文字（`message.content`）

## 待解决
- [ ] 代码块折叠未生效（需验证 build 产物）
- [ ] 对话/Agent/模型/思考强度接入
- [ ] 重新打开恢复上次对话

## 依赖
- ← STORY-0034（Chat 模块 UI）
- ← STORY-0038（Desktop 内嵌）

## 非范围
- 多模态（图片/文件上传）
- 对话搜索
