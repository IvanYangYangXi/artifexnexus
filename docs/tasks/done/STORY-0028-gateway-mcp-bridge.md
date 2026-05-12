---
id: STORY-0028
kind: story
title: Gateway MCP Bridge 插件 �?WebSocket→OpenClaw 桥接
status: done
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
作为 AI Agent，我能在 OpenClaw 对话中调�?`mcp_blender-editor_run_python` 工具，Gateway 通过 mcp-bridge 插件将请求转发到 Blender MCP Server�?
## 验收标准
- [x] 复刻 artclaw `platforms/openclaw/gateway/index.ts` �?mcp-bridge 插件
- [x] 支持 WebSocket 连接 Blender MCP Server
- [x] 同步预注册工具定�?+ 后台异步连接（适配 v2026.5.4 同步约束�?- [x] 支持 late discovery（Blender 后启�?�?重连�?execute 可用�?- [x] 工具命名：`mcp_{server-name}_{tool-name}`（如 `mcp_blender-editor_run_python`�?- [x] bootstrap 时自动写�?`plugins.entries.mcp-bridge` 配置
- [x] `contracts.tools` 精确声明工具名（v2026.5.4 强制要求�?- [x] 安装 Blender 插件时自动写�?`mcp-bridge.config.servers.blender-editor`
- [x] ~~Agent preset �?`tools.allow`~~ �?已移除（排他性过滤导致竞态阻断）

## 技术要�?- 复刻 `artclaw_bridge/platforms/openclaw/gateway/index.ts`
- 精简：去掉多 DCC 支持（只保留 Blender），去掉 RetryTracker
- 插件目录：`packages/adapters/openclaw/gateway-plugin/`
- 部署方式：物理拷贝到 `<OPENCLAW_HOME>/cli/<version>/node_modules/openclaw/dist/extensions/mcp-bridge/`

## 部署实录�?026-05-09 跑通）

### 根因排查
OpenClaw v2026.5.4 Gateway 无法发现 mcp-bridge 插件，排查确认为三个叠加问题�?
1. **NTFS Junction 导致路径逃�?*：`dist/extensions/mcp-bridge/` �?junction 指向 D 盘源码目录。OpenClaw discovery �?`fs.realpathSync` 解析出跨卷路径后，`installs.json` 注册表中 `rootDir` 记录�?D 盘路径，Gateway 可能因信任边界检查而拒绝加载�?2. **manifest 缺少 `activation` 字段**：v2026.5.4 Gateway 需�?`openclaw.plugin.json` 中声�?`"activation": {"onStartup": true}` 才会�?HTTP server 启动阶段加载插件�?3. **配置路径硬编�?*：`index.js` 中用 `os.homedir() + "/.openclaw/"` 读配置，在隔离环�?(`~/.artifexnexus/.openclaw/`) 下命中空文件�?
### 修复措施
| 文件 | 修改 |
|------|------|
| `dist/extensions/mcp-bridge/` | 删除 junction �?xcopy 物理拷贝 |
| `openclaw.plugin.json` | 添加 `"activation": {"onStartup": true}`, `"contracts": {"tools": []}` |
| `index.js` (L274) | `os.homedir()/.openclaw/` �?`process.env.OPENCLAW_CONFIG_PATH \|\| OPENCLAW_HOME` |
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
3. 重启 Gateway（或 Tauri 桌面 app�?

## Bug 修复：2026-05-12 — 通信延迟根因修复

### 问题表现
信息发送到 Gateway 响应速度极慢，实际测试 WS 延迟 max=2384ms。

### 根因分析（共 3 个 Bug）

**Bug #1 (P0): dist/index.js 忽略 OPENCLAW_HOME 环境变量**
- 原代码: `const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");`
- 修复: 改为 `process.env.OPENCLAW_CONFIG_PATH || process.env.OPENCLAW_HOME || ...`
- 影响: 隔离目录 `~/.artifexnexus/.openclaw/` 被忽略，插件每次读到错误配置

**Bug #2 (P0): dist/index.js 丢失同步工具预注册**
- 源码 `src/index.ts` 有 `KNOWN_TOOLS` 和 `serverClients` 预注册逻辑
- 编译产物 `dist/index.js` 完全删除了这段代码
- OpenClaw v2026.5.4 plugin loader 使用 `runPluginRegisterSync()`，要求同步声明工具
- 修复: 在 dist/index.js 中添加 KNOWN_TOOLS 常量 + serverClients Map 同步预注册

**Bug #3 (P1): WebSocket 连接超时过长**
- connect() timeout 从 10000 → 5000（src/index.ts + dist/index.js）

### 根因总结
之前慢不是"连接慢"，而是插件工作于异常状态——读错配置 + 缺少工具注册，
每次请求都在走错误恢复路径。

### 修复文件
| 文件 | 修改 |
|------|------|
| `dist/index.js` | Bug #1/#2/#3 全部修复 |
| `src/index.ts` | Bug #3: 超时 10s → 5s |
| `scripts/test_gateway_perf.py` | 新建: Gateway 性能诊断脚本 |
| `scripts/artifex_gateway_mcp_bridge.py` | 新建: MCP stdio bridge |

### 待完成
- `dist/index.js` 的 Bug #1/#2 修复需回移植到 `src/index.ts`
- `src/index.ts` 缺少 KNOWN_TOOLS/serverClients，下次 build 会覆盖 dist 修复