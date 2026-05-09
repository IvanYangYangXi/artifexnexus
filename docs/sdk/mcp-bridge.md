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
1. junction/symlink `gateway-plugin/` → `OPENCLAW_HOME/cli/{version}/node_modules/openclaw/dist/extensions/mcp-bridge/`
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
              "url": "ws://127.0.0.1:18083",
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

## API 参考

### Python: `MCPBridgeClient`

**包**：`artifex_nexus.openclaw_wrapper.mcp_bridge`

#### `MCPBridgeClient.get_instance(host="127.0.0.1", port=8083) → MCPBridgeClient`

获取单例客户端。

```python
client = MCPBridgeClient.get_instance(port=8083)
```

#### `client.connect(timeout=5.0) → bool`

连接 Blender MCP Server（含 MCP initialize 握手）。

```python
if client.connect():
    print("已连接")
```

#### `client.call_tool(tool_name: str, arguments: dict, timeout=30.0) → Dict`

调用 MCP 工具。

```python
result = client.call_tool("run_python", {"code": "print('hello')"})
# → {"content": [{"type": "text", "text": "hello"}], "isError": False}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tool_name` | `str` | ✅ | 工具名称，如 `"run_python"` |
| `arguments` | `dict` | ✅ | 工具参数 |
| `timeout` | `float` | ❌ | 超时秒数，默认 30 |

#### `client.disconnect() → None`

断开连接。

#### `call_blender_run_python(code: str, get_context=False, timeout=30.0) → Dict`

便捷函数：调用 Blender `run_python` 工具。

```python
from artifex_nexus.openclaw_wrapper.mcp_bridge import call_blender_run_python

result = call_blender_run_python("result = 'hello from blender'")
# → {"content": [{"type": "text", "text": "返回值: hello from blender"}], "isError": False}

# 获取编辑器上下文
result = call_blender_run_python("", get_context=True)
# → {"content": [{"type": "text", "text": "{...}"}], "isError": False}
```

### TypeScript: Gateway Plugin

**位置**：`packages/adapters/openclaw/gateway-plugin/src/index.ts`

插件通过 OpenClaw Plugin SDK 注册工具，无需手动调用。工具命名：`mcp_{server-name}_{tool-name}`。
