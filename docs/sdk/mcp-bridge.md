# Gateway MCP Bridge SDK

> WebSocket → OpenClaw MCP 桥接层。所有 DCC 的 MCP Server 通过此插件接入 OpenClaw。

## 架构

```
OpenClaw Agent
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
| `src/index.ts` | 插件主逻辑：WebSocket 连接 + MCP 协议 + 工具注册 |
| `openclaw.plugin.json` | 插件清单：id/name/version/activation/contracts/configSchema |
| `index.js` | 编译产物（esbuild CJS bundle） |

## 部署

```python
from artifex_nexus.openclaw_wrapper.dcc_installer import install_gateway_mcp_bridge

result = install_gateway_mcp_bridge()
# → {"success": True, "method": "copy", "target": "..."}
```

自动完成：
1. **物理拷贝** `gateway-plugin/` → `OPENCLAW_HOME/cli/{version}/node_modules/openclaw/dist/extensions/mcp-bridge/`
   - 不能用 junction/symlink：OpenClaw v2026.5.4 discovery 会 `fs.realpathSync`，跨卷 junction 导致路径逃逸被 trusted-root 拒绝
2. patch `openclaw.json`：`plugins.allow += "mcp-bridge"` + `plugins.entries.mcp-bridge`
3. 执行 `openclaw plugins registry --refresh` 更新注册表缓存

## OpenClaw v2026.5.4 插件开发关键约束

> **以下约束适用于所有 OpenClaw Gateway 自定义插件（包括未来的 Maya/UE 桥接器）。**
> 不遵守会导致插件静默加载失败或工具不可见。

### 1. `register()` 入口必须同步

OpenClaw 通过 `runPluginRegisterSync(register, api)` 调用插件入口：

```javascript
// 源码位置：loader-CBUR8YGF.js line 3373
function runPluginRegisterSync(register, api) {
    const guarded = createGuardedPluginRegistrationApi(api);
    try {
        const result = register(guarded.api);
        if (isPromiseLike(result)) {
            Promise.resolve(result).catch(() => {});
            throw new Error("plugin register must be synchronous"); // ← async 入口直接 throw
        }
    } finally {
        guarded.close(); // ← 返回后 registerTool() 等注册 API 全部失效
    }
}
```

**结论**：
- ❌ `export default async function(api)` — 会被检测到 Promise 返回值并 throw
- ❌ 在 `register()` 返回后异步调用 `api.registerTool()` — `guarded.close()` 后无效
- ✅ `export default function(api)` — 同步入口，所有 `registerTool()` 在同步返回前完成

### 2. `contracts.tools` 必须预声明工具名

```javascript
// 源码位置：loader-CBUR8YGF.js line 1447
const declaredNames = normalizePluginToolContractNames(record.contracts);
if (declaredNames.length === 0) {
    pushDiagnostic({ level: "error", message: "plugin must declare contracts.tools before registering agent tools" });
    return; // ← registerTool 被静默拒绝
}
```

**结论**：`openclaw.plugin.json` 中 `contracts.tools` 必须**精确列出**所有工具名：

```json
{
  "contracts": {
    "tools": [
      "mcp_blender-editor_run_python",
      "mcp_blender-editor_get_context"
    ]
  }
}
```

- 不支持通配符（`Set.has()` 精确匹配）
- 空数组 `[]` = 拒绝所有 `registerTool()` 调用

### 3. 注册表缓存必须刷新

Gateway 使用 `state/plugins/installs.json` 作为 manifest 缓存（含 `manifestHash` + `manifestFile.size`）。修改 `openclaw.plugin.json` 后：

```bash
openclaw plugins registry --refresh
```

不刷新 → Gateway 用旧 manifest 中的 `contracts.tools`（可能为空）→ 工具注册被拒绝。

### 4. 推荐的插件入口模式（"同步预注册 + 异步连接"）

```typescript
// ✅ 正确模式：解决 OpenClaw 同步约束 + DCC 可能未运行的场景
export default function (api: PluginAPI) {
  // 1. 同步读配置
  const servers = readConfig();

  // 2. 同步创建 client 引用（尚未连接）
  const clients = new Map<string, McpWebSocketClient>();
  for (const [name, def] of Object.entries(servers)) {
    clients.set(name, new McpWebSocketClient(name, def.url, ...));
  }

  // 3. 同步 registerTool —— 基于静态定义表
  //    execute handler 内部检查连接状态
  for (const toolDef of TOOL_DEFINITIONS) {
    api.registerTool({
      name: toolDef.openclawName,
      parameters: toolDef.parameters,
      async execute(_id, params) {
        const client = clients.get(toolDef.serverName);
        if (!client?.connected) {
          return { content: [...], isError: true };
        }
        return await client.callTool(toolDef.mcpToolName, params);
      },
    });
  }

  // 4. 后台异步连接（fire-and-forget）
  void (async () => {
    for (const [name, client] of clients) {
      try { await client.connect(); } catch { /* 自动重连 */ }
    }
  })();

  return { async dispose() { /* cleanup */ } };
}
```

### 5. 不要使用 `agents.tools.allow` 排他性过滤

OpenClaw Agent 的 `tools.allow` 是**排他性白名单**：只有匹配的工具可用，0 匹配时直接报错 `No callable tools remain`。

由于 mcp-bridge 工具注册时序可能晚于 Agent session 创建，不要在 agent preset 中设置 `tools.allow`。

- ❌ `"tools": { "allow": ["mcp_blender-editor_*"] }` — 排他性通配符，匹配失败则阻断
- ✅ 不设置 `tools` 字段 — Agent 可使用所有已注册工具

### 6. 新增 DCC 工具的开发清单

添加新 DCC（如 Maya）时：

1. **manifest 声明**：在 `openclaw.plugin.json` → `contracts.tools` 中添加精确工具名：
   ```json
   "mcp_maya-primary_run_python"
   ```
2. **工具定义表**：在 `index.ts` 的 `TOOL_DEFINITIONS` 数组中添加条目
3. **服务器配置**：在 `_patch_openclaw_config_for_mcp_bridge()` 中添加 server 条目
4. **刷新注册表**：部署后执行 `openclaw plugins registry --refresh`
5. **更新本文档**

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
  mcp_blender-editor_get_context
  mcp_maya-primary_run_python
```

> 注意：不再使用 `tools.allow` 通配符过滤（见上方约束 §5）。

## 新增 DCC Server

> 参见上方 "新增 DCC 工具的开发清单"（约束 §6）。

1. 在 `openclaw.plugin.json` → `contracts.tools` 中添加精确工具名
2. 在 `index.ts` 的 `TOOL_DEFINITIONS` 中添加工具条目
3. 在 `_patch_openclaw_config_for_mcp_bridge()` 的 `servers` 中添加条目
4. 编译部署 + `openclaw plugins registry --refresh`
5. 更新本文档

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

插件通过 OpenClaw Plugin SDK 同步注册工具（见上方约束 §4 推荐模式）。
工具命名：`mcp_{server-name}_{tool-name}`。

**编译**：
```bash
# 从仓库根目录
node_modules/.pnpm/esbuild@0.21.5/node_modules/@esbuild/win32-x64/esbuild.exe \
  packages/adapters/openclaw/gateway-plugin/src/index.ts \
  --bundle --platform=node --format=cjs \
  --outfile=packages/adapters/openclaw/gateway-plugin/index.js
```
