---
tags: [sdk, dcc, mcp, chat, preinput]
created: 2026-05-13
status: accepted
---

# DCC 预输入 SDK

> 新对话创建时，自动检测已连接的 DCC MCP Server，向 AI 发送上下文消息或向用户弹出指引。

## 接口

`DCCPreInputProvider` —— 每个 DCC 实现一个 provider，注册到 `ALL_PROVIDERS` 即可。

```typescript
interface DCCPreInputProvider {
  /** MCP server key（对齐 Gateway plugin KNOWN_TOOLS 的 key） */
  serverKey: string;
  /** 人类可读名称，如 "Blender" */
  displayName: string;

  /** 从 MCPBridgeStatus 判断当前 DCC 是否已连接 */
  checkConnected(status: MCPBridgeStatus): boolean;

  /** 已连接时：构建告知 AI 的上下文消息（自动发送到对话） */
  buildConnectedMessage(): string;

  /** 未连接时：构建用户指引文案（右下角 toast 非阻塞提示） */
  buildDisconnectedToast(): string;
}
```

## 工具函数

| 函数 | 用途 |
|------|------|
| `buildPreInputMessage(status)` | 遍历 providers，收集所有已连接 DCC 的消息，合并返回。无连接返回 `null` |
| `buildDisconnectedToasts(status)` | 遍历 providers，收集所有未连接 DCC 的指引文案 |

## 使用方式

```typescript
import { buildPreInputMessage, buildDisconnectedToasts } from "@/lib/chat/dcc-preinput";

// 新对话创建后
const status = await ipc.getMCPBridgeStatus();

// 已连接 → 自动发送
const message = buildPreInputMessage(status);
if (message) chat.sendMessage(message);

// 未连接 → toast 指引
const toasts = buildDisconnectedToasts(status);
toasts.forEach((t) => toast.info(t, { duration: 8000 }));
```

## 扩容

新增 DCC 三步：

1. 实现 `DCCPreInputProvider`
2. 在 `ALL_PROVIDERS` 注册
3. 确保 `MCPBridgeStatus` 中有对应的连接字段（如需新增，需同步 sidecar `mcp_bridge_status` RPC）

```typescript
// 示例：未来接入 Unreal
const unrealProvider: DCCPreInputProvider = {
  serverKey: "unreal-editor",
  displayName: "Unreal Engine",
  checkConnected: (s) => s.unrealConnected,
  buildConnectedMessage: () => "已连接 Unreal MCP Server...",
  buildDisconnectedToast: () => "未检测到 Unreal Engine MCP...",
};
```

## 已有 Providers

| DCC | serverKey | 代码 |
|-----|-----------|------|
| Blender | `blender-editor` | `packages/apps/web/src/lib/chat/dcc-preinput.ts` |

## 相关

- `[[mcp-bridge]]` — Gateway MCP Bridge SDK
- `[[../specs/blender-mcp]]` — Blender MCP 协议
- `[[../development/agent-onboarding]]` — §6 SDK/API 索引
