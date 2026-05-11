---
id: STORY-0039
kind: story
title: M3-FUNC-01 · Chat 功能接线（API + WebSocket 流式）
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/web-chat-structure]]"
related_packages:
  - "packages/apps/web"
  - "packages/adapters/openclaw"
tags: [story, chat, api, websocket, streaming, M3]
---

# STORY-0039 · Chat 功能接线（API + WebSocket 流式）

## 用户故事
在 Chat 界面输入消息后，能通过 OpenClaw API 发送并接收流式回复，工具调用卡片实时更新。

## 验收标准
- [x] 对接 OpenClaw Chat API（`POST /v1/chat/completions`）— WebSocket 全双工协议
- [x] WebSocket 流式接收（SSE 或 WS），逐 token 渲染 — GatewayWebSocket 客户端
- [ ] 工具调用卡片实时显示：⏳ → ✅/❌ + 耗时 — 待 Gateway 联调时验证
- [x] 对话状态机完整运行：Idle → Sending → Streaming → ToolExecuting → Idle
- [x] 停止按钮可用（中断流式）— chat.abort RPC
- [x] 恢复按钮可用（继续生成）— Resume 按钮 + 自动恢复
- [x] 队列发送：生成中按发送 → 排队 → 自动发送
- [x] 错误处理：网络断开/Gateway 不可用 → 错误提示 + 重试
- [x] 对话持久化（localStorage 或 IndexedDB）— localStorage 即时可用 + IndexedDB 层就绪

## 前置任务（已记录）
- [x] 移除左下角头像旁的设置按钮（B3 区域）
- [x] 启动时自动检测 OpenClaw：已安装→自动启动 Gateway；未安装→跳转系统面板+弹窗
- [x] 自动恢复：WebSocket 重连后检测未完成流式消息自动续写

## 实施日志
- 2026-05-11 16:18 开始 STORY-0039
- 2026-05-11 前置任务完成：移除 B3 设置按钮 + 启动自动检测
- 2026-05-11 核心实现完成：GatewayWebSocket + ChatService + ChatView 接入
- 2026-05-11 TypeScript 编译通过，Next.js build 通过
- 2026-05-11 19:51 修复 Gateway 无法连接 bug（第一轮）：
  - 根因 1：前端 `GatewayContext.port` 硬编码默认 19789，忽略 `openclaw.json` 端口探测迁移后的真实值（19809 等）。
  - 根因 2：`GatewayContext.token` 硬编码空串，握手时 `auth: { token: "" }` 被 `gateway.auth.mode=token` 的 Gateway 拒绝。
  - 方案（参考 `artclaw_bridge/.../ArtClawToolManager/src/server/services/gateway_client.py` 握手协议）：
    1. sidecar 新增 `openclaw.gateway.auth_info` RPC（`sidecar_gateway.py`），复用 `bootstrap.get_gateway_token/get_gateway_port` + `gateway_state` 运行态 port，仅经本机 stdio 返回明文 token。
    2. Tauri 新增 `openclaw_gateway_auth_info` 命令（`openclaw_gateway.rs`），lib.rs 注册。
    3. 前端 `ipc/openclaw.ts` 新增 `getGatewayAuthInfo()` 封装；`AppShell` 启动检测成功 400ms 后拉一次凭据，轮询内持续同步，注入 `GatewayContext.{port, token, authReady}`。
    4. `ChatView` 在 `authReady=false` 时传 `gatewayPort=0`，`useChatService` 识别 `port<=0` 则不建 WS，避免默认端口空跑。
    5. `gateway-api.ts` 的 `fetchGatewayModels/fetchGatewayAgents` 接受 token 参数，REST 请求带 `Authorization: Bearer`。
- 2026-05-11 20:30 修复 Gateway 无法连接 bug（第二轮 — BOM）：
  - 症状：第一轮修复后重新编译运行，Gateway log 仍报 `code=1008 reason=unauthorized, token_missing, authProvided=none`。写 `scripts/probe-sidecar-auth-info.py` 直接调 `handle_gateway_auth_info` → 返回 `{token: "", auth_mode: ""}`，但 `openclaw.json` 里 token 实际存在。
  - 根因：`openclaw.json` 文件开头有 UTF-8 BOM（`EF BB BF`），`bootstrap.read_config` 用 `read_text(encoding="utf-8") + json.loads` 对 BOM 会抛 `JSONDecodeError` 被静默吞掉返回 `None` → `get_gateway_token` 返 `None` → sidecar 吐空 token → 前端握手 `auth.token=""` → 1008。违反 `.ai/rules/30-agent-behavior.md` §8。
  - 方案：`bootstrap.read_config` 改 `read_bytes()` + 显式剥 BOM + `decode("utf-8")`，新增 `test_read_config_tolerates_utf8_bom` 单测。一次性清理当前用户 `openclaw.json` 的 BOM。
- 2026-05-11 20:35 修复 Gateway 端口漂移 + 端口占用报错（第三轮，对应用户反馈"19809 不该出现"）：
  - 用户观察：`openclaw.json.gateway.port` 被写成 19809，但用户没配过该端口。
  - 根因：`bootstrap.bootstrap_with_port_probe` 在 19789 被任何进程占用时按 `+20` 步进自动迁移到 19809/19829，写入 `openclaw.json` + `run/ports.json`。配置漂移后 Control UI allowedOrigins、WS URL、auth_info 全部连锁改变。
  - 方案 A（用户选）：写死 19789、干掉自动迁移；bootstrap 不再 probe；start 写入前检测 19789 ——自家孤儿杀掉，外部占用弹窗报错。
  - 实施：
    1. `bootstrap.py` 新增 `bootstrap_fixed_port` 固定写 19789；把 `bootstrap_with_port_probe` 标 deprecated（测试仍用）。`sidecar._handle_openclaw_bootstrap` 切到 fixed_port 入口。
    2. `bootstrap.py` 新增 `reset_config_port_if_drifted`：一次性自愈，检测 `gateway.port != 19789` → 读 openclaw.json → 只改 port 字段 → 原子写回（附带 `.bak.port-heal-<ts>` 备份）+ 修正 `run/ports.json`。sidecar.main() 启动时调用。
    3. `runtime.py` 新增 `PortBusyError` + `_describe_pid`；`start_gateway` 在 `_cleanup_orphan_gateways` 后调 `_list_pids_on_port` + `_is_openclaw_process`，仍被外部进程占用就 raise `PortBusyError(port, occupants)`。
    4. `sidecar.py` + `sidecar_gateway.py` 的 start handler 捕获 `PortBusyError` → 返回 `error.code=-32020`，`error.data={kind:"port_busy", port, occupants}`。
    5. `sidecar/client.rs` JSON-RPC error 反序列化增加 `data` 字段，错误字符串末尾附加 `__rpcdata__:{…}` 让前端可解析。
    6. `AppShell.tsx` 新增 `parsePortBusyError` 工具 + `portBusyError` state + Port Busy Dialog（显示占用者 PID/name/cmdline，提供"重试启动"按钮）。
  - 为什么自愈直写 openclaw.json（AGENTS §4 例外）：上游 `config patch --stdin` 对 `{"gateway":{"port":19789}}` 实际是按 key 替换整个 gateway 对象（丢掉 controlUi/auth/mode），触发 size-drop 保护 reject（文件从 10108→5026）。一次性只改一个数字字段的场景，直写比 patch 风险更小，且写前做 `.bak` 备份。
  - 验证：
    - 针对性单测 60 通过（`test_bootstrap_fixed_port_writes_19789_even_when_busy`、`test_reset_config_port_if_drifted_heals_legacy_19809`、`test_port_busy_error_carries_occupants`、`test_start_gateway_raises_port_busy_when_external_occupant`）。
    - 手工跑 `reset_config_port_if_drifted` 把当前用户的 `openclaw.json` 从 19809 改回 19789，`token` / `models.providers` / `agents.list` / `plugins` 全部原样保留；`run/ports.json` 同步为 19789。
    - `pnpm typecheck` 通过；`pnpm tauri build` 成功，产物 `artifex-nexus-desktop.exe` 12.29 MB + `Artifex Nexus_0.1.0_x64-setup.exe` 3.12 MB（2026-05-11 20:34）。
- 2026-05-11 21:00 清理 controlUi.allowedOrigins 里漂移残留（第四轮）：
  - 症状：第三轮修好 `gateway.port` 后，用户发现 `controlUi.allowedOrigins` 里仍留着 `http://127.0.0.1:19809` / `http://localhost:19809` 两条死白名单。
  - 根因：`runtime._ensure_control_ui_allowed_origins` 历来是"取并集只加不删"，漂移期间被塞入的旧 port loopback 条目永远不会被清掉。
  - 方案：在 `_ensure_control_ui_allowed_origins` 里增加**保守的漂移清理**——内联常量 `_DRIFT_BASE=19789 / _DRIFT_STEP=20 / _DRIFT_MAX_TRIES=5`（与 `ports.py` 对齐），生成漂移候选 port 集合 `{19809, 19829, 19849, 19869, 19889}`（不含当前 port 19789），命中 `http://{127.0.0.1|localhost}:<drift>` 格式即剥离；用户面板自加的非漂移 origin（如 `http://my-devbox:8080`）一律保留。
  - 验证：
    - 新增 3 条单测：`test_ensure_control_ui_drops_stale_drift_loopback`（漂移条目被清）、`test_ensure_control_ui_preserves_user_added_origins`（用户自加项不误伤）、`test_ensure_control_ui_noop_when_already_clean`（干净 config 不触发多余 patch）。
    - 55 条 runtime/bootstrap/sidecar_gateway 测试全部通过。
    - 手工跑一次 `_ensure_control_ui_allowed_origins` 到当前用户的 `openclaw.json`，`allowedOrigins` 从 7 条变 5 条（19809 相关两条被清），其它保留。
  - 无 Rust/前端改动，不需重跑 `pnpm tauri build`（sidecar.py 按源码路径引用）。
  - 用户观察：`openclaw.json.gateway.port` 被写成 19809，但用户没配过该端口。
  - 根因：`bootstrap.bootstrap_with_port_probe` 在 19789 被任何进程占用时按 `+20` 步进自动迁移到 19809/19829，写入 `openclaw.json` + `run/ports.json`。配置漂移后 Control UI allowedOrigins、WS URL、auth_info 全部连锁改变。
  - 方案 A（用户选）：写死 19789、干掉自动迁移；bootstrap 不再 probe；start 写入前检测 19789 ——自家孤儿杀掉，外部占用弹窗报错。
  - 实施：
    1. `bootstrap.py` 新增 `bootstrap_fixed_port` 固定写 19789；把 `bootstrap_with_port_probe` 标 deprecated（测试仍用）。`sidecar._handle_openclaw_bootstrap` 切到 fixed_port 入口。
    2. `bootstrap.py` 新增 `reset_config_port_if_drifted`：一次性自愈，检测 `gateway.port != 19789` → 读 openclaw.json → 只改 port 字段 → 原子写回（附带 `.bak.port-heal-<ts>` 备份）+ 修正 `run/ports.json`。sidecar.main() 启动时调用。
    3. `runtime.py` 新增 `PortBusyError` + `_describe_pid`；`start_gateway` 在 `_cleanup_orphan_gateways` 后调 `_list_pids_on_port` + `_is_openclaw_process`，仍被外部进程占用就 raise `PortBusyError(port, occupants)`。
    4. `sidecar.py` + `sidecar_gateway.py` 的 start handler 捕获 `PortBusyError` → 返回 `error.code=-32020`，`error.data={kind:"port_busy", port, occupants}`。
    5. `sidecar/client.rs` JSON-RPC error 反序列化增加 `data` 字段，错误字符串末尾附加 `__rpcdata__:{…}` 让前端可解析。
    6. `AppShell.tsx` 新增 `parsePortBusyError` 工具 + `portBusyError` state + Port Busy Dialog（显示占用者 PID/name/cmdline，提供"重试启动"按钮）。
  - 为什么自愈直写 openclaw.json（AGENTS §4 例外）：上游 `config patch --stdin` 对 `{"gateway":{"port":19789}}` 实际是按 key 替换整个 gateway 对象（丢掉 controlUi/auth/mode），触发 size-drop 保护 reject（文件从 10108→5026）。一次性只改一个数字字段的场景，直写比 patch 风险更小，且写前做 `.bak` 备份。
  - 验证：
    - 针对性单测 60 通过（`test_bootstrap_fixed_port_writes_19789_even_when_busy`、`test_reset_config_port_if_drifted_heals_legacy_19809`、`test_port_busy_error_carries_occupants`、`test_start_gateway_raises_port_busy_when_external_occupant`）。
    - 手工跑 `reset_config_port_if_drifted` 把当前用户的 `openclaw.json` 从 19809 改回 19789，`token` / `models.providers` / `agents.list` / `plugins` 全部原样保留；`run/ports.json` 同步为 19789。
    - `pnpm typecheck` 通过；`pnpm tauri build` 成功，产物 `artifex-nexus-desktop.exe` 12.29 MB + `Artifex Nexus_0.1.0_x64-setup.exe` 3.12 MB（2026-05-11 20:34）。

## 依赖
- ← STORY-0034（Chat 模块 UI）
- ← STORY-0038（Desktop 内嵌）

## 非范围
- 多模态（图片/文件上传）
- 对话搜索
