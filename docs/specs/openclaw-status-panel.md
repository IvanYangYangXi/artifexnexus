---
tags: [spec, ui, openclaw, gateway, status, M1]
created: 2026-05-07
updated: 2026-05-07
status: draft
version: v1
related_story: "[[../tasks/in-progress/STORY-0018-openclaw-gateway-status-panel]]"
related_specs:
  - "[[openclaw-wrapper-runtime]]"
  - "[[openclaw-wrapper-ipc]]"
  - "[[openclaw-upstream-survey]]"
  - "[[ui/installer-structure]]"
related_decisions: [0007]
---

# OpenClaw 状态控制面板（v1）

> 面向：STORY-0018 implement。状态页（首页）从"几乎空白"升级为
> **Gateway 控制中心**：可视化运行状态 + 启停按钮 + 实时日志 tail + 入口按钮。
>
> **诞生背景**：2026-05-07 用户反馈"状态页几乎没什么作用，只显示一个 Sidecar：
> 运行中"，且当前 Web UI 入口实现绕了 5 秒大弯（spawn dashboard → 流式读 stdout
> → 前端 open）；本 spec 把 Gateway 控制 + 日志 + Web UI 简化合在一处。

## 0. 现状对照

| 当前 (v0) | v1 改动 |
|---|---|
| 状态页只有一行 "Sidecar：运行中" | 状态页升级为完整 Gateway 控制中心 |
| Web UI 入口经"sidecar 解析 URL → 前端 open"两跳，~5s 延迟 | sidecar 直接 `openclaw dashboard`（带 open）让 OpenClaw 自己开浏览器，~0.3s |
| Gateway 日志只能去文件系统看 | 状态页内嵌实时 tail 面板（200 行窗口，1s 轮询） |
| Gateway 起停只能命令行操作 | 状态页"启动/重启 Gateway"按钮 |

## 1. 信息架构（线框）

```
┌───────────────── Artifex Nexus — 运行状态 ─────────────────┐
│                                                            │
│  Sidecar          ● 运行中                                 │
│                                                            │
│  ┌─ OpenClaw Gateway ──────────────────────────────────┐   │
│  │  ● 运行中     PID 12345    端口 19789               │   │
│  │  启动于 18:09:15                                    │   │
│  │  ┌────────────┬───────────────┬──────────────────┐  │   │
│  │  │ ↻ 重启     │ 🌐 OpenClaw   │ 🚀 Artifex Nexus │  │   │
│  │  │  Gateway   │   Web UI      │   Web UI（占位） │  │   │
│  │  └────────────┴───────────────┴──────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  ┌─ Gateway 日志 ────────────────────  [▾] [⛶] [⊟] ─┐   │
│  │ 18:09:15 INFO  Gateway listening on :19789         │   │
│  │ 18:09:16 INFO  Loaded 3 providers                  │   │
│  │ 18:09:18 WARN  plugin not installed: codex         │   │
│  │ 18:10:01 INFO  Request /infer ok 202ms             │   │
│  │ ...（最近 200 行，自动滚动）                       │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

3 个状态：
- **● 运行中** — 绿点，显示 PID / port / 启动时间
- **○ 未运行** — 灰点，仅显"启动 Gateway"按钮
- **● 异常** — 红点（PID 还在但端口探活失败 / 进程刚退出），显示最后错误日志摘要

3 个按钮：
- `↻ 启动/重启 Gateway`：未运行→显示"启动"；运行→显示"重启"；点击调用对应 RPC
- `🌐 OpenClaw Web UI`：调 `openclaw.web.open` RPC（**v1 新签名**：直接 spawn `openclaw dashboard` 让 OpenClaw 自己开浏览器，不返回 URL）
- `🚀 Artifex Nexus Web UI`：v1 占位置灰，tooltip "M3 milestone 实装"，实装后 STORY 另开

## 2. Sidecar 协议变更

### 2.1 新增 RPC

#### `openclaw.gateway.status` — 状态查询（前端 1s 轮询）

**Request**：无参数

**Response**：
```json
{
  "state": "running" | "stopped" | "errored",
  "pid": 12345,           // 仅 running，否则 null
  "port": 19789,          // 仅 running，否则 null
  "started_at": 1746602955.0,  // unix ts，仅 running
  "last_error": "...",    // 仅 errored
  "last_log_id": 4521     // 当前内存 buffer 的最大 id（前端拉日志用 since_id 时初始化）
}
```

#### `openclaw.gateway.start` — 启动（幂等）

**Request**：`{ "force_restart": false }`（可选）

**Response**：
```json
{
  "success": true,
  "restarted": false,         // 经历了 stop+start 重启路径时为 true；幂等复用为 false
  "pid": 12345,
  "port": 19789,
  "message": "gateway 已启动 (pid=12345)"
}
```

行为：
- `force_restart=false` + 已运行 → 立即返回 `restarted=false` + 复用现有 pid，不重启
- `force_restart=true` 或未运行 → 调用 `runtime.start_gateway()`；若已运行先 stop 再 start，返回 `restarted=true`
- 失败 → JSON-RPC error 通道（`{ error: { code: -32000, message } }`），不走 result.success=false

#### `openclaw.gateway.restart` — 重启（语法糖）

等价于 `start({ force_restart: true })`。单独提供让前端按钮语义清晰。

#### `openclaw.gateway.tail_log` — 拉日志（增量）

**Request**：
```json
{
  "n": 200,              // 返回最新 N 条；与 since_id 互斥
  "since_id": 4521       // 仅返回 id > since_id 的；增量轮询用
}
```

**Response**：
```json
{
  "entries": [
    { "id": 4522, "ts": 1746603001.123, "level": "INFO", "stream": "stdout", "text": "..." },
    ...
  ],
  "max_id": 4530,        // 本批次最大 id，前端下次 since_id 用
  "buffer_size": 8000,   // 当前 buffer 容量上限（常量）
  "dropped": 12          // 因 buffer 满被丢弃的旧条数（提示用户用 openclaw logs tail 取更长历史）
}
```

### 2.2 修改 RPC：`openclaw.web.open`（替换 v0 的 get_url）

**v0**（要废弃）：`openclaw.web.get_url` → 返回 `{available, url, reason}`，前端再 open

**v1**（新）：`openclaw.web.open` → 直接让 OpenClaw 自己打开浏览器
```json
// Request: 无参数
// Response:
{
  "success": true,
  "method": "openclaw_dashboard"  // 标识用了哪种方式（未来可能加 "tauri_shell_url" 兜底）
}
```

实现：sidecar `subprocess.Popen(["openclaw", "dashboard"], env=isolated_env, ...)`
**不带** `--no-open`，让 OpenClaw 自己打开默认浏览器。spawn 后立即返回，不阻塞。

> v0 的 `openclaw.web.get_url` 标记 `@deprecated`，保留一个 release 周期；
> 不删（兼容老前端）。

## 3. Gateway 日志缓冲区设计

### 3.1 数据结构

```python
# packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/gateway_log.py

@dataclass
class LogEntry:
    id: int           # 单调递增（同一 sidecar 进程生命期内唯一）
    ts: float         # unix timestamp
    level: str        # INFO / WARN / ERROR / DEBUG（从行内推断；推断失败=INFO）
    stream: str       # stdout / stderr
    text: str         # 单行原文（已 strip newline）

class GatewayLogBuffer:
    """线程安全的环形日志缓冲。"""
    maxlen: int = 8000

    def append(self, level: str, stream: str, text: str) -> None: ...
    def tail(self, n: int = 200) -> list[LogEntry]: ...
    def since(self, since_id: int) -> list[LogEntry]: ...
    def stats(self) -> dict: ...   # max_id / dropped / size
```

### 3.2 后台读线程

`runtime.start_gateway()` 改造：
- 旧：`subprocess.Popen([...], stdout=DEVNULL, stderr=DEVNULL)`
- 新：`stdout=PIPE, stderr=PIPE, bufsize=1`，spawn 后**起两个守护线程**
  - 线程 A：`for line in proc.stdout: buffer.append("INFO", "stdout", line)`
  - 线程 B：同上但 stderr，level 推断为 WARN 或 ERROR（行首含 `error|fail` → ERROR；含 `warn` → WARN；否则 INFO）

线程是 daemon，sidecar 退出自动收。Gateway 退出时两个线程自然 EOF 退出。

### 3.3 性能保证

| 维度 | 数值 | 备注 |
|---|---|---|
| 内存 | 8000 行 × ~200 B ≈ 1.6 MB | sidecar 进程级别完全可接受 |
| 写入 | O(1) per line（deque） | 数百 KB/s 量级也跟不掉 |
| RPC 序列化 | 1s 轮询拉 ~10 条新日志 ≈ 2 KB JSON | 可忽略 |
| 前端渲染 | 永远只渲染最近 200 行（CSS 高度限定 + slice） | DOM 节点数 ≤ 200 |

> "log 数量过多会造成卡顿吗？" 答：只要遵守 §3.3 的 200 行窗口 + 增量推送，
> 前端 DOM 始终 ≤ 200 节点，**不会卡**。后台 buffer 8000 行也只是 1.6 MB 内存。
> 想看更多历史 → 提示用户跑 `openclaw logs tail -n 5000`。

## 4. 前端

### 4.1 状态页组件树（v1）

```
StatusPage
├── SidecarHealth                    （已有，不改）
├── GatewayStatusCard (新建)
│   ├── StateBadge (●/○/●)
│   ├── MetadataLine (PID / port / 启动时间)
│   └── ActionButtons
│       ├── StartOrRestartButton
│       ├── OpenOpenClawWebUiButton
│       └── OpenArtifexWebUiButton (disabled, "M3 实装")
└── GatewayLogPanel (新建)
    ├── LogPanelHeader (折叠 / 全屏 / 清屏 / 提示"取更长历史")
    └── LogList (虚拟列表，最近 200 行，颜色按 level)
```

### 4.2 IPC 包装

```ts
// apps/desktop/src/ipc/openclaw.ts 新增
export async function getGatewayStatus(): Promise<GatewayStatus>
export async function startGateway(forceRestart?: boolean): Promise<GatewayStartResult>
export async function restartGateway(): Promise<GatewayStartResult>
export async function tailGatewayLog(opts: { n?: number; sinceId?: number }): Promise<GatewayLogBatch>
export async function openOpenClawWebUi(): Promise<{ success: boolean; method: string }>
```

### 4.3 轮询节奏

| 数据 | 节奏 | 何时停 |
|---|---|---|
| Gateway status | 1s（开页时） | 关页 / 打开 modal 时暂停 |
| Gateway log tail | 1s（仅 status=running 时） | 同上；error 状态时降到 5s |

## 5. 数据契约（与 OpenClaw 不变）

本 STORY 不改 `~/.artifexnexus/.openclaw/openclaw.json`，
不改任何 OpenClaw schema 字段，**纯 wrapper / 前端层改动**。

## 6. 验收标准

- [ ] 状态页能看到 Gateway 4 元组（state / pid / port / 启动时间）
- [ ] [启动 Gateway] 按钮在 stopped 时可点，运行后变 [重启 Gateway]
- [ ] [OpenClaw Web UI] 按钮点击 ~1s 内浏览器打开 `http://127.0.0.1:19789/`
- [ ] [Artifex Nexus Web UI] 按钮可见但 disabled，tooltip "M3 milestone 实装"
- [ ] 状态页下方日志面板实时滚动（启动 gateway 后 ≤2s 出现新行）
- [ ] 日志面板可折叠/全屏/清屏（清屏只清前端视图，不清 sidecar buffer）
- [ ] 1s 轮询不卡 UI（DevTools Performance 看主线程 idle ≥ 90%）
- [ ] sidecar 内存增长 < 10 MB / 24h（buffer 上限 8000 行）

## 7. TBD / 风险

| # | 项 | 何时解 |
|---|---|---|
| R1 | OpenClaw v2026.5.4 在 Windows 下 `openclaw dashboard` 是否真的会自动调系统默认浏览器？ | implement 时实测 + 兜底：若 5s 内未检测到浏览器进程，回退到 `tauri-plugin-shell.open(url)`（仍走旧的 URL 探测路径） |
| R2 | stderr 日志分级推断策略足够吗？ | implement 时按实际 OpenClaw 输出再调；可后续支持 ANSI color → level 推断 |
| R3 | 内存 buffer 跨 sidecar 重启会清零，用户可能看不到历史 | 文档提示用 `openclaw logs tail -n N` 取磁盘日志 |

## 相关

- [[../tasks/in-progress/STORY-0018-openclaw-gateway-status-panel]]
- [[openclaw-wrapper-runtime]]（start_gateway / stop_gateway 现状）
- [[openclaw-wrapper-ipc]]（RPC 列表）
- [[../decisions/0007-windows-subprocess-helper]]（subprocess 标准）
- [[ui/installer-structure]]（OpenClaw 行的 Web UI 按钮，本 STORY 后该按钮职责降级）
