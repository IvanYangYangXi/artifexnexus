# Artifex Nexus 项目记忆

## 关键架构

- **Tauri Desktop App**：嵌入 Next.js `out/` 产物作为前端
  - 配置：`apps/desktop/src-tauri/tauri.conf.json`
  - `frontendDist`: `../../../packages/apps/web/out`（生产模式）
  - `devUrl`: `http://localhost:18790`（开发模式）
  - `beforeBuildCommand`: `pnpm --filter @artifex-nexus/web build`
  - `beforeDevCommand`: `pnpm --filter @artifex-nexus/web dev`
  - **关键**：Web 前端只能在 Tauri WebView 中使用，浏览器直连 `invoke()` 失败（`@tauri-apps/api`）
  - `apps/desktop/src/`（App.tsx 等）只是安装向导壳，主 UI 是 Next.js 的 ChatView
  - 编译命令：`pnpm -C apps/desktop tauri build`（**必须跑这个，不能只跑 `pnpm build`**）

- **OpenClaw Gateway**：Node.js 进程，监听 127.0.0.1:19789（WebSocket Control UI）
  - 入口：`cli/v2026.5.4/node_modules/openclaw/openclaw.mjs`
  - 启动命令：`openclaw.cmd` → `node openclaw.mjs gateway run --port 19789 --force`
  - 插件目录：`cli/v2026.5.4/node_modules/openclaw/dist/extensions/`

- **MCP Bridge 插件**：在 gateway 内运行，桥接外部 MCP servers
  - 源码：`packages/adapters/openclaw/gateway-plugin/src/index.ts`
  - 编译：`packages/adapters/openclaw/gateway-plugin/dist/index.js`（esbuild bundle）
  - **实际加载路径**：`~/.artifexnexus/.openclaw/cli/v2026.5.4/node_modules/openclaw/dist/extensions/mcp-bridge/index.js`
  - **关键**：Gateway 从 bundled extensions 加载插件，NOT 从 `plugins/` 符号链接！修改 src 后必须同步更新 bundled extension + 刷新注册表
  - 配置路径：必须用 `process.env.OPENCLAW_CONFIG_PATH` 或 `process.env.OPENCLAW_HOME`
  - 工具注册：同步预注册（KNOWN_TOOLS 硬编码 → api.registerTool()，不依赖 WS 连接）
  - 构建命令：`esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --external:ws --outfile=<target>`
  - 注册表刷新：`openclaw plugins registry --refresh`

- **Python Sidecar**：JSON-RPC over stdio，管理 gateway 生命周期
  - 位于：`packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/`
  - 关键模块：sidecar.py, runtime.py, bootstrap.py, mcp_bridge.py

- **隔离目录**：`~/.artifexnexus/.openclaw/`
  - 配置：`openclaw.json`（含 gateway.port, plugins.entries.mcp-bridge 等）
  - PID 锁：`run/gateway.pid`
  - 端口状态：`run/ports.json`

## 前端预输入机制

- **预输入事件**：`artifex:prefillInput` CustomEvent，由 `ChatInputArea` 监听
  - 触发方式：`window.dispatchEvent(new CustomEvent("artifex:prefillInput", { detail: { text: "..." } }))`
  - 现有用法：Tool 运行 → Chat 预填（`AppShell.RunToolContext`）

- **DCC 预输入 SDK**（`packages/apps/web/src/lib/chat/dcc-preinput.ts`）：
  - `DCCPreInputProvider` 接口：`checkConnected()` / `buildConnectedMessage()` / `buildDisconnectedToast()`
  - `ALL_PROVIDERS` 注册表 — 新增 DCC 只需实现接口 + 注册
  - 已连接 DCC → `chat.sendMessage()` 自动发送上下文到对话
  - 未连接 DCC → `toast.info()` 右下角非阻塞指引（检查插件安装 + 软件打开）
  - 多 DCC 合并为一条消息
  - SDK 文档：`[[docs/sdk/dcc-preinput]]`，已注册到 `docs/sdk/README.md`

## 构建系统

- **Web 前端**：Next.js (`packages/apps/web`)，dev 模式用 `next dev -p 18790 --turbopack`，HMR 自动更新
- **Tauri Desktop**：`apps/desktop/src-tauri/`，dev 模式加载 `http://localhost:18790`
  - 生产 EXE：`pnpm --filter @artifex-nexus/web build` → `tauri build`
  - 仅有前端代码变更时 dev 模式无需 rebuild
  - **关键约束**：apps/desktop 改动后**必须** `pnpm -C apps/desktop tauri build`，不能只跑 `pnpm build`（`.ai/rules/40-build-and-release.md`）

## 端口分配

| 端口 | 用途 | 协议 |
|------|------|------|
| 18083 | Blender MCP WebSocket Server | 纯 WS，HTTP 会报 426 |
| 18790 | Next.js dev server（Artifex Nexus 前端） | HTTP |
| 19789 | OpenClaw Gateway + 原生 Control UI | HTTP + WS |

- **Web 前端只能在 Tauri WebView 中使用**，浏览器直连 `http://127.0.0.1:18790/` 会卡 "等待 sidecar 就绪"，因为 `@tauri-apps/api invoke()` 不可用
- 原生 OpenClaw Control UI（`http://127.0.0.1:19789/`）是所有 OpenClaw 自带的 Vite 仪表盘，不是 Artifex Nexus 前端

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
7. **EXE 冷启动 WS 连接慢 / 放弃重连**（2026-05-13 修复）：
   - 现象：重新打开 EXE 后 Gateway 未就绪，WS 走指数退避（3→4.5→6.75→10→15s = ~40s），5 次后彻底放弃
   - 修复：三阶段渐进式重连（启动快速 2s×15 → 指数退避 → 持久化 30s，永不放弃）
   - 影响文件：`gateway-ws.ts`（常量 + `connect()` + `_scheduleReconnect()` + `_scheduleStartupRetry()`）
8. **degraded 状态误判为"未连接"**（2026-05-13 修复）：
   - 现象：Gateway Event Loop 退化时，ChatView 把 wsState="degraded" 映射为 wsConnected=false，Topbar 显示"连接中"、发送按钮禁用
   - 根因：`setWsConnected(wsState === "connected")` 和 `isWsConnected={wsState === "connected"}` 未包含 "degraded"
   - 修复：两处都改为 `wsState === "connected" || wsState === "degraded"`；新增 degraded→恢复时的队列自动回放
   - 影响文件：`ChatView.tsx`（2 处）、`gateway-ws.ts`（health 事件恢复回放）
9. **degraded → keepalive 停止 → heartbeat timeout → 周期性重连死循环**（2026-05-13 修复）：
   - 现象：WS 周期性变黄（"连接中"），每 ~60s 一轮，此时发送按钮禁用
   - 根因：keepalive 只在 "connected" 运行；degraded 时停止 → 60s 无活动 → heartbeat timeout 强制重连 → 亮黄灯 → 重连后又 degraded → 死循环
   - 修复：keepalive 条件放宽为 `"connected" || "degraded"`；`sendMessage` 在 degraded 时不阻断，让 `sendChat` 内部排队
   - 影响文件：`ChatView.tsx`（keepalive）、`chat-service.ts`（sendMessage 放行 + 错误文案）

## 团队结构（2026-05-13）

- **Team**: `artifex-nexus-team`（位于 `~/.workbuddy/teams/artifex-nexus-team/`）
- **任务列表**: `~/.workbuddy/tasks/artifex-nexus-team/`

### 团队成员

| 角色 | Agent Name | 职责 |
|------|-----------|------|
| 产品经理 | `产品经理` | 产品规划、方案/计划/开发文档、任务管理、需求推进落地 |
| 开发工程师 | `程序` | 功能开发、问题定位、修 bug、构建验证，完成后通知 PM + QA |
| 质量保障 | `QA` | 文档 review、代码 review、功能测试，验收报告输出 |

### 协作流程
1. 用户提需求 → 产品经理拆解任务 → 创建任务到共享任务列表
2. 产品经理分配开发任务给"程序"，分配测试任务给"QA"
3. 程序完成后 → SendMessage 通知产品经理 + QA
4. QA 审查/测试 → 结论（通过/不通过）→ 通知程序 + 产品经理
5. 产品经理跟踪闭环
