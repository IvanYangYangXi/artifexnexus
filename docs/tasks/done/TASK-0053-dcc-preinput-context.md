---
id: TASK-0053
kind: task
title: 新对话预输入 · DCC MCP 上下文
status: done
priority: P2
owner: "@ivan"
assignee: ai
estimate: 0.5d
created: 2026-05-13
updated: 2026-05-13
parent: "[[STORY-0039-m3-func-chat-api]]"
milestone: M3
related_specs:
  - "[[../../sdk/dcc-preinput]]"
related_packages:
  - "packages/apps/web"
tags: [task, chat, dcc, mcp, ux, preinput, sdk, M3]
---

# TASK-0053 · 新对话预输入：DCC MCP 上下文

## 背景与目标

用户点击「新对话」按钮创建对话后，AI 对当前 DCC 连接状态、可用工具一无所知，
需要用户先手动描述环境。大多数场景下用户会使用已连接的 DCC（Blender 等）MCP 工具。

**目标**：新建对话后自动检测 DCC MCP 连接状态，差异化处理：
- **已连接** → 自动发送上下文消息到对话（AI 立刻知道可用工具 + 场景状态）
- **未连接** → 右下角 toast 非阻塞提示（指引用户检查插件安装和软件状态）

## 验收标准

- [x] **已连接 DCC → 自动发送消息**\
  调用 `getMCPBridgeStatus()` IPC，若 Blender 已连接，通过 `chat.sendMessage()` 自动发送
  包含工具名称和功能描述的上下文消息。AI 立刻知道当前可用工具。

- [x] **未连接 DCC → toast 指引**\
  若 Blender 未连接，在右下角弹出 `toast.info()`（8s 自动消失），
  引导用户检查：插件是否安装、软件是否打开、端口是否配置。
  不阻塞操作、不预填输入框。

- [x] **多 DCC 合并为一条消息**\
  `buildPreInputMessage()` 遍历所有已注册 provider，有连接的全量合并；
  `buildDisconnectedToasts()` 收集所有未连接 DCC 的独立 toast。

- [x] **标准化 Provider 接口（SDK）**\
  提取 `DCCPreInputProvider` 接口到独立模块 `packages/apps/web/src/lib/chat/dcc-preinput.ts`；
  创建 SDK 文档 `docs/sdk/dcc-preinput.md` 并注册到 `docs/sdk/README.md`。
  后续新增 DCC 只需实现接口 + 注册到 `ALL_PROVIDERS`。

- [x] **不影响现有流程**\
  `sendDCCContextOnNewSession()` 在 `handleNewSession` 末尾 fire-and-forget 调用；
  不阻塞 UI、会话创建失败不影响、不覆盖用户输入。

## 设计要点

### 标准化接口

`DCCPreInputProvider`（`packages/apps/web/src/lib/chat/dcc-preinput.ts`）：

```typescript
interface DCCPreInputProvider {
  serverKey: string;                  // MCP server key
  displayName: string;                // 如 "Blender"
  checkConnected(status): boolean;    // 判断是否已连接
  buildConnectedMessage(): string;    // 已连接 → AI 上下文消息
  buildDisconnectedToast(): string;   // 未连接 → 用户指引文案
}
```

现有实现：`blenderProvider`，注册在 `ALL_PROVIDERS`。

### 流程

```
handleNewSession(config)
  ↓ 创建会话
  ↓ sendDCCContextOnNewSession(agentId)  ← fire-and-forget
      ↓ getIpc().getMCPBridgeStatus()
      ↓ buildPreInputMessage(status)
      │   └─ 有已连接 DCC → chat.sendMessage(message)  自动发送
      ↓ buildDisconnectedToasts(status)
          └─ 有未连接 DCC → toast.info(guidance, 8s)   右下角提示
```

### 消息示例

**Blender 已连接**（自动发送到对话）：
```
已连接 Blender MCP Server，可用工具：
- mcp_blender-editor_run_python — 在 Blender 中执行 Python 代码。可设 get_context=true 获取当前场景状态...

请描述你的需求，我会通过 MCP 工具来操作。
```

**Blender 未连接**（右下角 toast）：
```
未检测到 Blender MCP Server 连接。请确认：
1. 已在 Blender 中安装 Artifex Nexus 插件
2. Blender 软件已打开
3. 「系统」面板中 MCP Server 端口已配置
```

### 扩容方式

```typescript
// 新增 DCC 三步完成
const unrealProvider: DCCPreInputProvider = {
  serverKey: "unreal-editor",
  displayName: "Unreal Engine",
  checkConnected: (s) => s.unrealConnected,  // MCPBridgeStatus 需扩展字段
  buildConnectedMessage: () => "已连接 Unreal MCP Server...",
  buildDisconnectedToast: () => "未检测到 Unreal Engine MCP...",
};
// ALL_PROVIDERS.push(unrealProvider)  ← 即插即用
```

## 进展日志

- 2026-05-13 v1 实现（已废弃）\
  ChatView.tsx 新增 `DCC_TOOL_INFO` + `prefillDCCContext()`，仅预填输入框。

- 2026-05-13 v2 重新对齐（当前版本）\
  按用户反馈重设计：
  1. 提取 `DCCPreInputProvider` 接口到独立模块 `dcc-preinput.ts`
  2. 已连接 → `chat.sendMessage()` 自动发送（而非预填输入框）
  3. 未连接 → `toast.info()` 右下角非阻塞提示
  4. 多 DCC 合并为一条消息
  5. 创建 SDK 文档 `docs/sdk/dcc-preinput.md` + 注册到 SDK README
  6. 更新 `MEMORY.md` 前端预输入机制章节

  验证：`npx tsc --noEmit` → 零错误。
