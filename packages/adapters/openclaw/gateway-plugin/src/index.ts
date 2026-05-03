/**
 * Artifex Nexus — OpenClaw Gateway plugin (MCP bridge).
 *
 * 对应原项目 `platforms/openclaw/gateway/index.ts`。
 * 安装位置：`~/.artifexnexus/.openclaw/extensions/artifex-nexus-mcp-bridge/`（symlink 到本目录 dist）
 *
 * TODO:
 *  - [ ] 多 MCP Server 并发连接 + 自动重连（指数退避 3s~30s）
 *  - [ ] 工具命名空间隔离：mcp_{server}_run_python
 *  - [ ] 15s ping keepalive
 *  - [ ] tools/list 发现 + 注册到 Gateway（每 DCC 唯一工具：run_python）
 */

export const PLUGIN_NAME = "artifex-nexus-mcp-bridge";
export const PLUGIN_VERSION = "0.0.0";
