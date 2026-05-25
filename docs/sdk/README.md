# Artifex Nexus SDK / API 索引

> 统一 SDK 入口。所有可复用的接口、类型、注册表均在此登记。

## SDK 目录

| SDK | 文档 | 代码 | 用途 |
|-----|------|------|------|
| DCC 插件管理 | [[../specs/dcc-plugin-management]] | 见下表 | **DCC 扩展总文档，新 DCC 接入主入口** |
| DCC 插件安装器 | [[dcc-installer]] | `packages/adapters/openclaw/wrapper/src/.../dcc_installer.py` | DCC 版本检测 / 插件安装卸载 / 版本兼容 |
| Gateway MCP Bridge | [[mcp-bridge]] | `packages/adapters/openclaw/gateway-plugin/` | WebSocket → OpenClaw MCP 桥接 |
| DCC Adapter | [[dcc-adapter]] | `packages/dcc/shared/artifex_nexus_sdk/base_adapter.py` | DCC 适配层抽象接口（BaseDCCAdapter） |
| DCC MCPServer | — | `packages/dcc/shared/artifex_nexus_sdk/mcp_server.py` | 参数化 MCP WebSocket 服务器 |
| Trigger Dispatcher | — | `packages/dcc/shared/artifex_nexus_sdk/trigger_dispatcher_base.py` | 触发器调度器基类 |
| DCC Registry | [[dcc-registry]] | `apps/desktop/src/features/installer/dccRegistry.ts` | 前端 DCC 操作注册表 |
| DCC 预输入 | [[dcc-preinput]] | `packages/apps/web/src/lib/chat/dcc-preinput.ts` | 新对话自动发送 DCC 上下文 |

## 共享 SDK 代码

```
packages/dcc/shared/artifex_nexus_sdk/
├── base_adapter.py              # BaseDCCAdapter 抽象基类
├── mcp_server.py                # MCPServer 参数化 WebSocket 服务器
└── trigger_dispatcher_base.py   # TriggerDispatcher 触发器调度器基类
```

## 注册表速查

| 注册表 | 位置 | 用途 |
|--------|------|------|
| `dccRegistry` | `apps/desktop/src/features/installer/dccRegistry.ts` | DCC 检测/安装/卸载 |
| `METHODS` | `sidecar.py` | Sidecar JSON-RPC 方法路由 |
| `invoke_handler` | `apps/desktop/src-tauri/src/lib.rs` | Tauri command 注册 |
| `SERVERS` + `TOOL_DEFINITIONS` | `gateway-plugin/src/index.ts` | Gateway MCP Server 与工具注册 |
| `contracts.tools` | `gateway-plugin/openclaw.plugin.json` | Gateway 插件工具声明 |

## 使用指南

- **接入新 DCC**：先读 `[[../specs/dcc-plugin-management]]` §2 模块清单 → 逐项实施
- **接入新 MCP 工具**：先读 `[[mcp-bridge]]` → 在 `mcp_server.py` 中注册 → 更新 Gateway `TOOL_DEFINITIONS` + `contracts.tools`
- **实现新 Adapter**：先读 `[[dcc-adapter]]` → 继承 `BaseDCCAdapter`

## 相关

- `[[../specs/dcc-plugin-management]]` — DCC 插件扩展总文档
- `[[../development/agent-onboarding]]` — 新人上手文档
