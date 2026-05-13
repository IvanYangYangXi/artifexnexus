# Artifex Nexus 项目记忆

## 关键架构

- **OpenClaw Gateway**：Node.js 进程，监听 127.0.0.1:19789（WebSocket Control UI）
  - 入口：`cli/v2026.5.4/node_modules/openclaw/openclaw.mjs`
  - 启动命令：`openclaw.cmd` → `node openclaw.mjs gateway run --port 19789 --force`
  - 插件目录：`cli/v2026.5.4/node_modules/openclaw/dist/extensions/`

- **MCP Bridge 插件**：在 gateway 内运行，桥接外部 MCP servers
  - 源码：`packages/adapters/openclaw/gateway-plugin/src/index.ts`
  - 编译：`packages/adapters/openclaw/gateway-plugin/dist/index.js`
  - **重要**：dist 和 src 可能不一致！dist 是实际部署版本
  - 配置路径：必须用 `process.env.OPENCLAW_CONFIG_PATH` 或 `process.env.OPENCLAW_HOME`
  - 工具注册：必须同步（OpenClaw plugin loader 用 runPluginRegisterSync()）

- **Python Sidecar**：JSON-RPC over stdio，管理 gateway 生命周期
  - 位于：`packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/`
  - 关键模块：sidecar.py, runtime.py, bootstrap.py, mcp_bridge.py

- **隔离目录**：`~/.artifexnexus/.openclaw/`
  - 配置：`openclaw.json`（含 gateway.port, plugins.entries.mcp-bridge 等）
  - PID 锁：`run/gateway.pid`
  - 端口状态：`run/ports.json`

## 已知陷阱

1. **dist/index.js 可能丢失 src 的功能**：发布前必须验证 dist 包含所有 src 逻辑
2. **bin/ 可能是空目录**：入口在 `node_modules/openclaw/openclaw.mjs`
3. **Gateway 端口固定 19789**：不使用自动迁移（STORY-0039 决策）
4. **MCP Bridge WebSocket 超时**：连接超时 5s（已修），工具调用超时 30s
5. **WS 延迟可能出现极端方差**（1ms ~ 2384ms），EOF 退出时不杀 gateway
6. **Gateway 重连后 Event Loop 退化**（2026-05-13 修复）：
   - 现象：重连后 delayMaxMs 可达 30s，heartbeat 需 73s
   - 修复：ACK_TIMEOUT 15s→60s，新增重连冷却 5s + health 事件解析检测退化
   - 影响文件：`gateway-ws.ts`, `chat-service.ts`, `ChatView.tsx`
