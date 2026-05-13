---
id: TASK-0052
kind: task
title: Gateway 启动延迟优化 · 插件裁剪 + MCP Bridge 异步化 + 端口隔离
status: review
priority: P0
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-13
updated: 2026-05-13
parent: "[[../in-progress/STORY-0039-m3-func-chat-api]]"
milestone: M3
related_specs: []
related_packages:
  - "packages/apps/web"
  - "packages/adapters/openclaw"
tags: [task, gateway, startup, performance, plugin, M3]
---

# TASK-0052 · Gateway 启动延迟优化 · 插件裁剪 + MCP Bridge 异步化

## 背景与目标

2026-05-13 实测：启动 Artifex Nexus → 发送首条消息 → 收到回复，端到端延迟 **~50s ~ 109s**。
根因分析发现 Gateway 启动时加载了 **93 个插件**（其中 66 个 `enabledByDefault=true`），
14 个在启动期执行初始化工作（`onStartup=true`），导致 Node.js event loop 饱和在
CPU=100%、delayMaxMs 峰值达 **13.7 秒**，Gateway 需要约 **120 秒**才能稳定。

本 Task 通过**插件裁剪 + MCP Bridge 异步化 + 端口隔离**三管齐下，目标将启动→首条消息延迟
从 120s 降至 **< 5s**。

## 验收标准

### P0 · 阻塞（AI Provider 插件裁剪）

- [ ] **P0-1 禁用 AI Provider 插件启动加载** （✅ 已完成 2026-05-13）\
  在 `openclaw.json` 的 `plugins.entries` 中显式 `enabled: false` 禁用 **49 个 AI Provider** 插件。
  Artifex Nexus 的模型配置由设置面板 `models.providers` 管理，不需要 Gateway 内置的 Provider 插件。
  禁用后 `require()` 直接跳过，不在启动路径中出现。
  **其他 40 个非 Provider 插件全部保留**（`enabledByDefault=true`），用户可能用到。
  **配置已写入 `bootstrap.py` → `_generate_default_config()`，确保重装和跨设备一致。**

- [x] **P0-2 验证启动后 plugin loaded list**\
  Gateway health 事件的 `plugins.loaded` 应不再包含 49 个 AI Provider 插件
  （预期加载 ~44 个：4 核心 + ~40 个默认启用的非 Provider 插件）。

- [ ] **P0-3 验证首条消息延迟**\
  启动 → 发送首条消息 → 收到回复 ≤ **5s**（含 Gateway 冷启动 + Agent 首 token）。

### P1 · 高（MCP Bridge 异步化）

- [ ] **P1-1 MCP Bridge connect() 非阻塞**\
  将 mcp-bridge 插件的 `readFileSync` 改为 `readFile`（异步），WebSocket connect 中
  的 `new WS(url)` 显式设 `handshakeTimeout: 5000`，连接失败后不阻塞 event loop。

- [ ] **P1-2 MCP Bridge 连接失败不阻断工具注册**\
  当前设计已是 fire-and-forget（工具预先注册），但 connect 失败时可能打印过多 error
  日志 → console 噪音需收敛为 warn 级别。

- [ ] **P1-3 超时后停止重试**\
  MCP Bridge 初始连接失败后，最多重试 3 次（每次 delay 3s→4.5s→6.75s），
  之后标记为 `BLENDER_DOWN` 不再尝试，直到显式 reconnect 触发。

### P2 · 中（启动渐进重试）

- [ ] **P2-1 前端 connect 指数退避**\
  收到 `startup-sidecars` 拒绝后，前端从固定 2s 退改为 3s→6s→12s→24s 上限。
  降低无效重试对 event loop 的压力。

- [ ] **P2-2 加启动进度 UI 反馈**\
  遮罩层文案从 "正在连接 Gateway..." → "Gateway 正在启动 (插件初始化中...)"，
  带上健康事件中的 `plugins.loaded` 进度。

### P3 · 低（MCP Server 可用性探测 + 426 错误消除）

- [ ] **P3-1 保留 HTTP 端口探测用于 MCP Server 可用性检测**\
  **决策确认**：Artifex Nexus 需要通过 HTTP 探测判断 MCP Server 是否可用
  （例如确认 Blender MCP Server 在 18083 端口是否监听）。这是有效的健康检查，
  不应移除。探测应该由 sidecar/Tauri 后端主动发起（非浏览器 WebView），
  避免触发 CORS/426 报错。

- [ ] **P3-2 Blender MCP Server 只响应 WebSocket**\
  修改 `mcp_server.py`，对非 WebSocket Upgrade 请求直接 `conn.close()`（不发 426），
  避免浏览器 HTTP 探测触发 Console 报错。同时保留由 sidecar 发起的 TCP 端口探测
  作为可用性判断（TCP connect + disconnect，不发 HTTP）。

- [ ] **P3-3 Tauri 端屏蔽 18083 浏览器访问**\
  在 Tauri 的 CSP 或 fetch 配置中禁止 frontend 对 `127.0.0.1:18083` 的非 WebSocket 请求。

### P4 · UX（连接状态提示优化）

- [x] **P4-1 修复 "Gateway 未连接" 误报** （✅ 已完成 2026-05-13）\
  当 Gateway 进程在运行但 WebSocket 未建连时，错误提示从 "Gateway 未连接" 改为
  **"WebSocket 未连接，Gateway 正在运行中"**，避免用户误以为 Gateway 挂了。
  修改文件：`chat-service.ts` → `sendMessage()`。

- [x] **P4-2 Topbar 新增 WebSocket 状态指示器** （✅ 已完成 2026-05-13）\
  顶栏状态区新增 WS 连接状态：
  - 绿点 "WS"：已连接
  - 黄点闪烁 "WS"：Gateway 在运行但 WS 未连接（连接中…）
  - 灰点 "WS"：Gateway 未运行
  修改文件：`AppShell.tsx`（GatewayContext 新增 wsConnected）、`Topbar.tsx`（渲染 WS 指示）。

- [x] **P4-3 WebSocket 未连接时禁用发送按钮** （✅ 已完成 2026-05-13）\
  发送按钮的 `disabled` 条件从 `!text.trim()` 扩展为 `!text.trim() || !isWsConnected`。
  未连接时按钮灰显 + tooltip "WebSocket 未连接"。
  修改文件：`ChatInputArea.tsx`（新增 isWsConnected prop）、`ChatView.tsx`（传递 wsState）。

## 根因详解

见下方「插件调研结果」章节，以及上一轮分析报告。

### 关键数据

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| Gateway 启动至事件循环稳定 | ~120s | < 3s |
| 加载的插件数 | 93（66 个 DEFAULT_ON） | ~44（禁用 49 个 AI Provider） |
| 首条消息端到端延迟 | ~50s ~ 109s | < 5s |
| Event loop 延迟峰值 | 13.7s | < 50ms |
| 启动 CPU 峰值 | 100% | < 30% |

## 涉及文件

| 文件 | 改动内容 |
|------|---------|
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/bootstrap.py` | ✅ P0-1: `_generate_default_config` 新增 49 个 AI Provider 禁用配置 |
| `~/.artifexnexus/.openclaw/openclaw.json` | P0-1: 生成时自动写入 AI Provider 禁用条目 |
| `packages/apps/web/src/lib/chat/chat-service.ts` | ✅ P4-1: sendMessage 错误提示区分 Gateway 运行态 vs 未启动 |
| `packages/apps/web/src/components/shell/AppShell.tsx` | ✅ P4-2: GatewayContext 新增 wsConnected + setWsConnected |
| `packages/apps/web/src/components/shell/Topbar.tsx` | ✅ P4-2: 顶栏新增 WS 连接状态指示器 |
| `packages/apps/web/src/components/chat/ChatInputArea.tsx` | ✅ P4-3: 发送按钮 WS 未连接时禁用 |
| `packages/apps/web/src/components/chat/ChatView.tsx` | ✅ P4-2/3: 同步 wsState 到 GatewayContext + 传递 isWsConnected |
| `cli/v2026.5.4/node_modules/openclaw/dist/extensions/mcp-bridge/index.js` | P1-1: readFileSync→readFile, handshakeTimeout |
| `packages/apps/web/src/lib/chat/gateway-ws.ts` | P2-1: startup 指数退避 |
| `packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/mcp_server.py` | P3-2: 拒绝非 WS 请求 |

## 构建验证

- [ ] `pnpm typecheck` → 0 errors
- [ ] `pnpm build` → 成功
- [ ] 启动 Artifex Nexus → 首条消息 < 5s
- [ ] Gateway health 日志 `degraded: false` 在 T+3s 内出现

## 进展日志

- 2026-05-13 10:49 创建 TASK-0052，三档优先级（P0 插件裁剪 / P1 异步化 / P2 渐进重试 / P3 端口隔离）
- 2026-05-13 11:10 用户评审反馈：
  - P0 调整为仅禁用 AI Provider（49 个），其余 40 个插件保留
  - P3 保留 HTTP 端口探测（需要确认 MCP Server 可用性），改为 TCP 探测由 sidecar 发起
  - 新增 P4 UX 优化：修复误报 / WS 状态指示 / 发送按钮禁用
- 2026-05-13 11:10 P0-1 完成：bootstrap.py `_generate_default_config` 已添加 49 个 AI Provider 禁用配置
- 2026-05-13 11:10 P4-1/2/3 完成：已修复误报 + 添加 Topbar WS 状态 + 禁用发送按钮
