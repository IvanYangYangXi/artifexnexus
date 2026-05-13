# Artifex Nexus SDK / API 索引

> 统一 SDK 入口。所有可复用的接口、类型、注册表均在此登记。

## SDK 目录

| SDK | 文档 | 代码 | 用途 |
|-----|------|------|------|
| DCC 插件安装 | [[dcc-installer]] | `packages/sdk/dcc-installer/` | DCC 版本检测 / 插件安装卸载 / 版本兼容 |
| Gateway MCP Bridge | [[mcp-bridge]] | `packages/sdk/mcp-bridge/` | WebSocket→OpenClaw MCP 桥接 |
| DCC Adapter | [[dcc-adapter]] | `packages/sdk/dcc-adapter/` | DCC 适配层抽象接口 |
| DCC Registry | [[dcc-registry]] | `apps/desktop/src/features/installer/dccRegistry.ts` | 前端 DCC 操作注册表 |
| DCC 预输入 | [[dcc-preinput]] | `packages/apps/web/src/lib/chat/dcc-preinput.ts` | 新对话自动发送 DCC 上下文 / 弹出指引 |

## 注册表速查

| 注册表 | 位置 | 用途 |
|--------|------|------|
| `dccRegistry` | `apps/desktop/src/features/installer/dccRegistry.ts` | DCC 检测/安装/卸载 |
| `METHOD_TABLE` | `packages/adapters/openclaw/wrapper/src/.../sidecar.py` | Sidecar JSON-RPC 方法路由 |
| `invoke_handler` | `apps/desktop/src-tauri/src/lib.rs` | Tauri command 注册 |
| `_tools` | `packages/dcc/blender/src/.../mcp_server.py` | MCP 工具注册 |
| `mcp-bridge servers` | `openclaw.json` → `plugins.entries.mcp-bridge.config.servers` | Gateway 侧 MCP 服务器连接 |

## 使用指南

- **接入新 DCC**：先读 [[dcc-installer]] → 注册到 `dccRegistry` → 注册到 `METHOD_TABLE`
- **接入新 MCP 工具**：先读 [[mcp-bridge]] → 在 `mcp_server.py` 中 `register_tool()`
- **实现新 Adapter**：先读 [[dcc-adapter]] → 继承 `BaseDCCAdapter`

## 相关

- `[[../development/agent-onboarding]]` — 新人上手文档
- `[[../specs/dcc-plugin-management]]` — DCC 插件管理规范
