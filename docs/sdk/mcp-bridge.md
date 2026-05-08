# Gateway MCP Bridge SDK

> WebSocket → OpenClaw MCP 桥接层。所有 DCC 的 MCP Server 通过此插件接入 OpenClaw。

## 架构

```
OpenClaw Agent
  │ tools.allow: ["mcp_{server}_*"]
  ▼
mcp-bridge (Gateway Plugin)
  │ plugins.entries.mcp-bridge.config.servers
  ▼
DCC MCP Server (WebSocket)
  │ tools: [run_python, ...]
  ▼
DCC Adapter → DCC API
```

## 插件源码

**位置**：`packages/adapters/openclaw/gateway-plugin/`

| 文件 | 用途 |
|------|------|
| `index.ts` | 插件主逻辑：WebSocket 连接 + MCP 协议 + 工具注册 |
| `openclaw.plugin.json` | 插件清单：id/name/version/configSchema |

## 部署

```python
from artifex_nexus.openclaw_wrapper.dcc_installer import install_gateway_mcp_bridge

result = install_gateway_mcp_bridge()
# → {"success": True, "method": "junction", "target": "..."}
```

自动完成：
1. junction/symlink `gateway-plugin/` → `OPENCLAW_HOME/plugins/mcp-bridge/`
2. patch `openclaw.json`：`plugins.allow += "mcp-bridge"` + `plugins.entries.mcp-bridge`

## 配置格式

```json
{
  "plugins": {
    "allow": ["mcp-bridge"],
    "entries": {
      "mcp-bridge": {
        "enabled": true,
        "config": {
          "servers": {
            "blender-editor": {
              "type": "websocket",
              "url": "ws://127.0.0.1:8083",
              "enabled": true
            }
          }
        }
      }
    }
  }
}
```

## 工具命名规则

```
mcp_{server-name}_{tool-name}

示例：
  mcp_blender-editor_run_python
  mcp_maya-primary_run_python
```

Agent 通过通配符允许：`tools.allow: ["mcp_blender-editor_*"]`

## 新增 DCC Server

1. 在 `_patch_openclaw_config_for_mcp_bridge()` 的 `servers` 中添加条目
2. 在 agent preset 的 `tools.allow` 中添加 `mcp_{server}_*`
3. 更新本文档

## 相关

- `[[dcc-installer]]` — DCC 插件安装 SDK（自动触发 mcp-bridge 部署）
- `[[../specs/dcc-plugin-management]]` §7 — 完整规范
