---
id: TASK-0051
kind: task
title: Gateway 稳定性修复 · Clawket 架构对标
status: review
priority: P0
owner: "@ivan"
assignee: pair
estimate: 1.5d
created: 2026-05-13
updated: 2026-05-13
parent: "[[../in-progress/STORY-0039-m3-func-chat-api]]"
milestone: M3
related_specs: []
related_packages:
  - "packages/apps/web"
  - "packages/adapters/openclaw"
tags: [task, gateway, stability, clawket, M3, hotfix]
---

# TASK-0051 · Gateway 稳定性修复 · Clawket 架构对标

## 背景与目标

STORY-0039 Chat 功能接线上线后暴露出多类稳定性问题：断连消息丢失、
心跳超时无检测、Gateway 崩溃无感知、重连后事件循环退化（delayMaxMs 可达 30s）、
会话刷新丢失等。通过分析开源项目 [p697/clawket](https://github.com/p697/clawket)
的 `BridgeRuntime` 架构，对标识别出 **3 处 P0 + 3 处 P1 + 2 处 P2 差距**，
系统性修复。

横向对比结论与详细分析见 copilot/ 下会话记录。

## 验收标准

### P0 · 阻塞（3 项）—— 对标 clawket BridgeRuntime 存活态

- [x] **P0-1 断连消息队列**（gateway-ws.ts）\
  `sendChat` 在断连/退化/冷却期不返回 false，改为入队（`MAX_PENDING_SENDS=64`，
  FIFO + 去重）。重连成功后延迟回放（等冷却期 + Event Loop 恢复），
  回放前去重（每 sessionKey 只保留最后一条），超 120s 过期丢弃。

- [x] **P0-2 心跳超时检测**（gateway-ws.ts）\
  新增 `HEARTBEAT_TIMEOUT_MS=60_000`。`_lastActivityTime` 在每次 onmessage
  更新；`_startPing` 每 30s 检查：超 60s 无任何消息/pong → force close +
  scheduleReconnect。

- [x] **P0-3 Gateway 崩溃主动检测**（runtime.py）\
  新增 `_start_health_monitor()` daemon 线程，每 5s `poll()` gateway 子进程。
  进程退出 → 自动重启（限流：60s 内最多 3 次）；超限 → `set_errored` +
  停止监控。`stop_gateway()` 时自动停 monitor。

### P1 · 高（3 项）—— 对标 clawket 持久化 + 可观测性

- [x] **P1-4 会话 localStorage 持久化**（chat-service.ts）\
  新增 `LS_PREFIX="artifex_chat:"`，`MAX_PERSISTED_MESSAGES=200`。
  debounced（500ms）写入，避免流式高频写。`switchSession` 优先从
  localStorage 恢复 → 内存缓存 → 空。页面刷新/崩溃后消息不丢失。

- [x] **P1-5 慢请求日志**（gateway-ws.ts）\
  `SLOW_RPC_LOG_THRESHOLD_MS=500`，超阈值记录 `console.warn`，含
  `method`/`elapsedMs`/`error`。覆盖 `sendRpc` 和 `_doSendChat`。

- [x] **P1-6 握手追踪**（gateway-ws.ts）\
  `HANDSHAKE_TRACK_WARN_MS=8_000`，慢握手记录 warn 含
  `challengeReceived`/`connectSent` 状态。`_setState` 记录
  `_handshakeStartedAt`，connected 时 log 耗时。

### P2 · 中（2 项）—— 对标 clawket 按需连接 + 降级

- [x] **P2-7a 前端空闲断开**（gateway-ws.ts）\
  `IDLE_DISCONNECT_MS=10min`，无交互 → 软断开（`_idleDisconnected=true`，
  不设 `_disposed`）。sendChat 检测 → 自动唤醒重连 + 入队回放。

- [x] **P2-7b Gateway 进程空闲关闭**（runtime.py + sidecar.py）\
  `_GATEWAY_IDLE_SHUTDOWN_SECS=1800`（30min），`report_gateway_activity()` 供
  sidecar status RPC 调用重置计时。health_monitor 检测超时 → `stop_gateway()`。

- [x] **P2-8 MCP Bridge 降级**（gateway-ws.ts + chat-service.ts + ChatView.tsx）\
  连续 3 次工具调用失败（status 含 "error" 或 exitCode≠0）→
  `_mcpBridgeAvailable=false`。成功一次即恢复。降级时 ChatView 显示 amber
  警告横幅："工具/命令已禁用，纯文本聊天仍可正常使用"。

## 设计要点

### Clawket 对标结论

| 维度 | clawket | Artifex Nexus（修复后） |
|------|---------|------------------------|
| 消息队列 | 256-msg buffer + FIFO + dedup | 64-msg + FIFO + dedup |
| 心跳 | 10s ping / 35s timeout | 30s ping / 60s heartbeat |
| 健康检测 | Hermes 每 10s probe | daemon 每 5s poll |
| 持久化 | 磁盘 JSON + debounced flush | localStorage + debounced 500ms |
| 退避 | 1.2s→15s (gw), 1s→15s (relay) | 3s→30s (gw) |
| 空闲管理 | BridgeRuntime demand-driven | 前端 10min + 进程 30min 两级 |
| 降级 | — | MCP Bridge 连续失败计数 ≥3 |

### 关键决策

1. **消息队列上限 64**（非 clawket 256）—— chat.send 场景足够且内存友好
2. **心跳超时 60s**（非 clawket 35s）—— 容忍网络波动，避免误判
3. **空闲断开分层**（前端 10min + 进程 30min）—— 前端先断节省 WS 资源，
   网关进程再断节省 CPU/内存
4. **降级用失败计数**（≥3 连续失败 = unavailable，成功 1 次 = 恢复）——
   简单可靠，无需依赖 Gateway 自定义事件

## 涉及文件

| 文件 | 改动内容 |
|------|---------|
| `packages/apps/web/src/lib/chat/gateway-ws.ts` | P0-1, P0-2, P1-5, P1-6, P2-7a, P2-8 |
| `packages/apps/web/src/lib/chat/chat-service.ts` | P1-4, P2-8 |
| `packages/apps/web/src/components/chat/ChatView.tsx` | P2-8 |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/runtime.py` | P0-3, P2-7b |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py` | P2-7b |

## 构建验证

- [x] `pnpm typecheck` → 2 successful, 0 errors
- [x] `pnpm build` → 构建成功（34.97s）
- [x] `pnpm py:test` → 55/56 pass（1 pre-existing 不相关）

## 进展日志

- 2026-05-13 09:00 完成 clawket 源码对比分析，识别 P0/P1/P2 差距
- 2026-05-13 09:50 P0-1 ~ P0-3 + P1-4 ~ P1-6 实施完成，构建验证通过
- 2026-05-13 10:22 P2-7a / P2-7b / P2-8 实施完成，按 SDD 规范创建 TASK-0051 → review
