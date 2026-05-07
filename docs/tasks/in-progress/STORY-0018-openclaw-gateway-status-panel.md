---
id: STORY-0018
kind: story
title: OpenClaw Gateway 状态控制面板（含日志 tail + 启停 + Web UI 简化）
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1d
created: 2026-05-07
updated: 2026-05-07
started: 2026-05-07
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: [0007]
related_specs:
  - "[[../../specs/openclaw-status-panel]]"
  - "[[../../specs/openclaw-wrapper-runtime]]"
  - "[[../../specs/openclaw-wrapper-ipc]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, gateway, status, log, M1]
---

# OpenClaw Gateway 状态控制面板

## 背景与目标

用户反馈（2026-05-07）：

> "状态页几乎没什么作用，只显示了一个 Sidecar：运行中。OpenClaw gateway 运行状态
> 也请显示在这里，然后下面加 log 显示 gateway 的 log。启动/重启 gateway 和打开
> web ui 的按钮也在状态页加一下。"

> "为啥启动 web ui 要这么复杂，OpenClaw 默认只需要一个终端命令 `openclaw dashboard`
> 就直接能在默认浏览器里打开页面了。"

合并为一个 STORY：把状态页升级为 **Gateway 控制中心**，同时简化 Web UI 入口。

## 范围 / 非范围

**范围**：

1. sidecar 新增 `openclaw.gateway.{status,start,restart,tail_log}` 4 个 RPC
2. sidecar `runtime.start_gateway` 改造：起两个守护线程读 stdout/stderr 进入 `GatewayLogBuffer(maxlen=8000)`
3. sidecar `web_ui` 简化：新 RPC `openclaw.web.open` 直接 spawn `openclaw dashboard`（带 open）让 OpenClaw 自己开浏览器；旧 `get_url` 标 `@deprecated` 保留一个 release
4. 前端状态页升级：GatewayStatusCard + GatewayLogPanel 两个新组件
5. 前端 1s 轮询 status + 增量拉 tail_log（since_id），200 行窗口

**非范围**：

- Artifex Nexus 自有 Web UI（M3 才做，本卡只放占位置灰按钮）
- log 持久化到磁盘（OpenClaw 自己有 `state/logs/`，本卡不复刻）
- log 行级 ANSI color 解析（v1 只按关键字推断 level）
- gateway 健康主动探测（端口 ping / HTTP /health）

## 任务拆分

### T1 · sidecar 基础设施

- [x] 新建 `gateway_log.py`：`LogEntry` + `GatewayLogBuffer`（线程安全 deque maxlen=8000，append/tail/since/stats）
- [x] ~~改造 `runtime.start_gateway`：`stdout=PIPE, stderr=PIPE, bufsize=1`，启 2 个 daemon 线程灌 buffer~~ → 移到 T2（与 RPC 一起改 runtime，避免 T1 引入未被消费的副作用）
- [x] `runtime` 暴露全局单例 `get_log_buffer()`（sidecar 进程级） → 实际放在 `gateway_log.py` 自身（更内聚）
- [x] level 推断函数：行首/含 `error|fail` → ERROR；`warn` → WARN；否则 INFO（扩展为 ERROR/WARN/DEBUG/INFO 4 级 + stream 兜底）
- [x] 单测 ≥ 8 条：append / tail / since_id / dropped 计数 / 多线程并发 / level 推断（**实际 41 条**）

### T2 · sidecar 4 个 RPC

- [x] `openclaw.gateway.status`：返回 state + pid + port + started_at + last_log_id
- [x] `openclaw.gateway.start({force_restart})`：幂等，已运行不重启除非 force
- [x] `openclaw.gateway.restart`：等价 start({force_restart:true})
- [x] `openclaw.gateway.tail_log({n, since_id})`：since_id 互斥；返回 entries + max_id + dropped
- [x] `openclaw.web.open`：spawn `openclaw dashboard` + 隔离 env，立即返回，不阻塞、不解析 stdout
- [x] 旧 `openclaw.web.get_url` 加 `@deprecated` 注释，保留实现
- [x] sidecar 测试 ≥ 6 条覆盖新 RPC（**实际 18 条**）

### T3 · 前端 IPC 包装

- [ ] `apps/desktop/src/ipc/openclaw.ts` 增加 `getGatewayStatus / startGateway / restartGateway / tailGatewayLog / openOpenClawWebUi` 5 个函数
- [ ] Tauri command 转发（src-tauri/src/lib.rs 或 commands.rs）

### T4 · 前端 UI

- [ ] 拆 StatusPage 现有逻辑到 `SidecarHealth.tsx`
- [ ] 新建 `GatewayStatusCard.tsx`：状态点 + 元数据行 + 3 按钮
- [ ] 新建 `GatewayLogPanel.tsx`：折叠/全屏/清屏，行虚拟列表（slice + max-height + auto-scroll）
- [ ] 新建 `useGatewayPolling` hook：1s 轮询 status；status=running 时同时增量拉 tail_log
- [ ] 文案 / 颜色 / disabled 态遵循现有 SettingsPanel 的 M3 风格

### T5 · 文档 + 编译 + 验收

- [ ] 进展日志 + 任务卡 status 同步
- [ ] 同步 [[../../specs/openclaw-wrapper-ipc]]（新增 4 RPC + 1 deprecated）
- [ ] `pnpm typecheck` / `pnpm vitest run` / **`pnpm tauri build`**（按 [[../../../.ai/rules/40-build-and-release]]，必须出 .exe，汇报时给大小+时间戳）
- [ ] python wrapper 全量回归 ≥ 132 + 新增 14（gateway_log + 4 RPC）

## 验收标准（与 spec §6 一致）

- [ ] 状态页能看到 Gateway 4 元组（state / pid / port / 启动时间）
- [ ] [启动 Gateway] 按钮在 stopped 时可点，运行后变 [重启 Gateway]
- [ ] [OpenClaw Web UI] 按钮点击 ~1s 内浏览器打开 `http://127.0.0.1:19789/`
- [ ] [Artifex Nexus Web UI] 按钮可见但 disabled
- [ ] 日志面板实时滚动 ≤2s 见新行
- [ ] 1s 轮询不卡（主线程 idle ≥ 90%）
- [ ] sidecar 内存增长 < 10 MB / 24h
- [ ] **`pnpm tauri build` 产出新 .exe + setup.exe，汇报含大小/时间戳**

## 进展日志

- 2026-05-07 created：基于用户两条反馈（状态页太空 + Web UI 入口绕远路）合并为一个 STORY；Q1-Q9 9 问全部确认；spec [[../../specs/openclaw-status-panel]] v1 落地；本卡进入 in-progress
- 2026-05-07 用户微调：状态页元数据"运行时长"字段去掉，只保留"启动时间"（spec §1/§2.1/§4.1/§6 同步；STORY 卡 T2/§验收同步）
- 2026-05-07 **T1 完成**：
  - 新建 `gateway_log.py`（246 行）：`LogEntry`(frozen dataclass) + `GatewayLogBuffer`(线程安全 deque maxlen=8000) + `infer_level`(ERROR/WARN/DEBUG/INFO 4 级，stream 兜底) + `get_log_buffer`/`reset_log_buffer_for_test` 单例
  - 单测 `test_gateway_log.py`：**41/41 全绿**（远超规划 ≥8 条），覆盖 append/tail/since/dropped/stats/clear/边界/8 线程并发/单例
  - 全包回归：**173 passed, 2 skipped, 0 failed**（基线 132 → +41 新增）
  - 微调：原 T1 计划"改造 runtime.start_gateway"挪到 T2 一起做（与 RPC 同步引入，避免 T1 引入未被消费的副作用）；`get_log_buffer` 放在 `gateway_log.py` 自身（比放 `runtime` 更内聚）
- 2026-05-07 **T2 完成**：
  - 新建 `gateway_state.py`（153 行）：`GatewayInfo`(frozen dataclass) + `set_running/set_stopped/set_errored/get_info/reset_for_test` 进程级单例（线程安全）；与 `gateway_log` 同生命周期
  - 新建 `sidecar_gateway.py`（~250 行）：5 个新 handler（`gateway.status/start/restart/tail_log` + `web.open`）；`web.open` spawn 用 `DEVNULL` 防 stdio 污染、不带 `--no-open` 让 CLI 自开浏览器、仅捕 OSError/FileNotFoundError 即时失败
  - 改造 `runtime.start_gateway`：`stdout=PIPE, stderr=PIPE, bufsize=1`；spawn 后启 2 个 daemon 线程 `_pump_stream_to_log_buffer` 灌 `gateway_log` 单例；同步写 `gateway_state.set_running/set_errored`；签名/返回值兼容（doctor / 既有 `openclaw.start` RPC 无感知）
  - 改造 `runtime.stop_gateway`：清理后写 `gateway_state.set_stopped()`
  - `sidecar.py` 注册 5 RPC + 给 `_handle_openclaw_web_get_url` 与 `web_ui.get_web_url` 加 `.. deprecated:: STORY-0018-T2` docstring 标记（实现保留一个 release 周期，2026-Q3 移除）
  - 4 个 JSON Schema 新增到 `packages/platform/contracts/schemas/`：`openclaw-gateway-status` / `openclaw-gateway-start-result` / `openclaw-gateway-log-batch` / `openclaw-web-open-result`（与 `openclaw-status.schema.json` 同风格，draft 2020-12，为 T3 前端 TS 类型生成铺路）
  - 同步 spec [[../../specs/openclaw-wrapper-ipc]] §8 RPC 列表清单（含 5 新增 + 1 deprecated）
  - 单测：`test_gateway_state.py` 23/23 + `test_sidecar_gateway.py` 18/18 = **+41 条全绿**
  - 全包回归：**214 passed, 2 skipped, 0 failed**（基线 173 → +41）
  - 微调：sidecar.py 已 556 行，新 5 handler 单独放 `sidecar_gateway.py`（薄包装风格）；`_GatewayInfo` 单独放 `gateway_state.py` 而非 runtime.py 内（runtime.py 已 577 行接近上限，分文件更内聚，与 `gateway_log.py` 风格对齐）
  - 范围内：未动 `apps/desktop`，T2 不需要 `pnpm tauri build`

## 相关

- [[../../specs/openclaw-status-panel]]（v1 设计契约）
- [[../../specs/openclaw-wrapper-runtime]]（start_gateway 现状）
- [[../../specs/openclaw-wrapper-ipc]]（RPC 列表）
- [[STORY-0016-openclaw-web-ui-entry]]（v0 Web UI 入口，本卡 simplify 它）
- [[../../decisions/0007-windows-subprocess-helper]]（spawn 标准）
- [[../../../.ai/rules/40-build-and-release]]（apps 改动必跑 tauri build）
