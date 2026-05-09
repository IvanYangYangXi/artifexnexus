---
id: STORY-0028
kind: story
title: Gateway MCP Bridge 插件 — WebSocket→OpenClaw 桥接
status: review
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1d
created: 2026-05-08
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "packages/adapters/openclaw/gateway-plugin"
tags: [story, mcp, gateway, bridge, blender, M2]
---

# STORY-0028 · Gateway MCP Bridge 插件

## 用户故事
作为 AI Agent，我能在 OpenClaw 对话中调用 `mcp_blender-editor_run_python` 工具，Gateway 通过 mcp-bridge 插件将请求转发到 Blender MCP Server。

## 验收标准
- [x] 复刻 artclaw `platforms/openclaw/gateway/index.ts` 的 mcp-bridge 插件
- [x] 支持 WebSocket 连接 Blender MCP Server
- [x] 自动 tools/list → 注册到 OpenClaw agent tools
- [x] 支持 late discovery（Blender 后启动也能自动发现）
- [x] 工具命名：`mcp_{server-name}_{tool-name}`（如 `mcp_blender-editor_run_python`）
- [x] bootstrap 时自动写入 `plugins.entries.mcp-bridge` 配置
- [x] Agent preset 的 `tools.allow` 添加 `mcp_blender-editor_*`
- [x] 安装 Blender 插件时自动写入 `mcp-bridge.config.servers.blender-editor`

## 技术要点
- 复刻 `artclaw_bridge/platforms/openclaw/gateway/index.ts`
- 精简：去掉多 DCC 支持（只保留 Blender），去掉 RetryTracker
- 插件目录：`packages/adapters/openclaw/gateway-plugin/`
- 部署方式：物理拷贝到 `<OPENCLAW_HOME>/cli/<version>/node_modules/openclaw/dist/extensions/mcp-bridge/`

## 部署实录（2026-05-09 跑通）

### 根因排查
OpenClaw v2026.5.4 Gateway 无法发现 mcp-bridge 插件，排查确认为三个叠加问题：

1. **NTFS Junction 导致路径逃逸**：`dist/extensions/mcp-bridge/` 是 junction 指向 D 盘源码目录。OpenClaw discovery 的 `fs.realpathSync` 解析出跨卷路径后，`installs.json` 注册表中 `rootDir` 记录为 D 盘路径，Gateway 可能因信任边界检查而拒绝加载。
2. **manifest 缺少 `activation` 字段**：v2026.5.4 Gateway 需要 `openclaw.plugin.json` 中声明 `"activation": {"onStartup": true}` 才会在 HTTP server 启动阶段加载插件。
3. **配置路径硬编码**：`index.js` 中用 `os.homedir() + "/.openclaw/"` 读配置，在隔离环境 (`~/.artifexnexus/.openclaw/`) 下命中空文件。

### 修复措施
| 文件 | 修改 |
|------|------|
| `dist/extensions/mcp-bridge/` | 删除 junction → xcopy 物理拷贝 |
| `openclaw.plugin.json` | 添加 `"activation": {"onStartup": true}`, `"contracts": {"tools": []}` |
| `index.js` (L274) | `os.homedir()/.openclaw/` → `process.env.OPENCLAW_CONFIG_PATH \|\| OPENCLAW_HOME` |
| `~/.artifexnexus/.openclaw/extensions/mcp-bridge` | 删除多余 junction |

### 验证结果
```
[gateway] http server listening (4 plugins: browser, file-transfer, mcp-bridge, memory-core; 4.7s)
[mcp-bridge] Connected to MCP server "blender-editor" at ws://127.0.0.1:18083
[mcp-bridge] Initialized "blender-editor": artifex-nexus-blender v0.1.0
[mcp-bridge] Discovered 1 tools from "blender-editor"
[mcp-bridge] Registered 1 new tool(s) from "blender-editor" (total: 1)
```

### 后续 deploy 三步曲（给其他开发者）
1. `xcopy /E /I /Y packages\adapters\openclaw\gateway-plugin C:\Users\<user>\.artifexnexus\.openclaw\cli\v2026.5.4\node_modules\openclaw\dist\extensions\mcp-bridge\`
2. `set OPENCLAW_HOME=.../.openclaw && openclaw plugins registry --refresh`
3. 重启 Gateway（或 Tauri 桌面 app）

