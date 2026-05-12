---
tags: [changelog, bugfix, gateway, sidecar]
created: 2026-05-12
severity: critical
affects: [apps/desktop, packages/adapters/openclaw]
---

# 2026-05-12 Gateway 自动启动失败修复

> 修复 exe 启动时 Gateway 无法自动运行、系统面板状态不一致等一系列关联问题。

## 问题概述

用户打开 `artifex-nexus-desktop.exe` 后，启动遮罩卡住 90 秒才消失，Gateway 未自动运行；
但手动在系统面板点"启动 Gateway"可以正常运行。修复后 Gateway 仍存在系统面板显示
"未运行"但右上角绿灯正常的状态不一致问题。

## 根因分析（共 4 个 bug）

### Bug 1：`waitReady` 内 `if (done) return` 短路（最关键）

**文件**：`packages/apps/web/src/components/shell/AppShell.tsx`

`doCheck()` 在 sidecar 就绪后设 `done = true`，随后调 `startGateway()` 成功后进入
`waitReady()` 轮询。但 `waitReady` 内部循环第一行 `if (done) return` 直接退出（done
此时已是 true），且 **没有任何路径调用 `setGatewayStarting(false)`**。遮罩只能等
90 秒硬超时才关闭。

### Bug 2：sidecar atexit 误杀 gateway

**文件**：`packages/adapters/openclaw/wrapper/.../sidecar.py`

当 Rust `SidecarManager` 因 RPC 超时 drop 旧 client 并 spawn 新 sidecar 时，旧 sidecar
收到 stdin EOF 退出。`atexit` 钩子调用 `_shutdown_gateway_quietly()` → `stop_gateway()`，
**把上一个 sidecar 刚启动的 gateway 杀掉**。新 sidecar 接管后 gateway 已死，但前端
`doCheck` 已完成（`done=true`），不会再尝试启动。

### Bug 3：`gateway_state` 进程级单例在 sidecar 重启后丢失

**文件**：`packages/adapters/openclaw/wrapper/.../sidecar_gateway.py`

`handle_gateway_status()` 读取 `gateway_state.get_info()` 返回状态。该单例是进程级的，
新 sidecar 启动后默认为 `stopped`。而 Topbar 走的 `openclaw.status` → `is_running()`
有 PID 锁 fallback，两套数据源不一致 → 面板显示"未运行"但绿灯正常。

### Bug 4：PID 锁文件中的 PID 与实际 gateway PID 不匹配

**文件**：`packages/adapters/openclaw/wrapper/.../runtime.py`

`openclaw gateway run --force` 是 wrapper 命令，`Popen.pid` 是 wrapper 进程 PID，
实际 gateway（node.exe）是 wrapper spawn 的子进程，PID 不同。wrapper 退出后 PID 锁
失效，`_is_openclaw_gateway_pid()` 在 tasklist 找不到该 PID → `is_running()` 返 false。

## 修复清单

### 1. AppShell.tsx — 重构启动逻辑

- 删除旧 `waitReady`（有 done 短路 bug），改为在 `doCheck` 内直接 for 循环轮询 30 次
- 轮询耗尽后兜底重试 `startGateway({ forceRestart: true })`（应对 atexit 误杀）
- **每条路径**都保证 `setGatewayStarting(false)` 被调用
- "已运行"分支 verify 后等 3s + 再查 status 确认
- 硬超时从 **90s → 60s**

### 2. sidecar.py — EOF 退出不再杀 gateway

- 新增 `_exit_reason` 全局标记：`"eof"` / `"signal"` / `"unknown"`
- stdin EOF 退出时设为 `"eof"` → `_shutdown_gateway_quietly()` 跳过 stop_gateway
- 收到信号（SIGTERM/SIGINT/SIGBREAK）时设为 `"signal"` → 正常杀 gateway
- Tauri 真正退出时已通过 `lib.rs` 发 `openclaw.stop` RPC 优雅关闭，atexit 只是兜底

### 3. sidecar_gateway.py — 端口探测 fallback

- `handle_gateway_status()` 在 `gateway_state` 为 stopped 时：
  1. 先调 `runtime.is_running()`（PID 锁 + tasklist）
  2. 失败再用 socket 连 `127.0.0.1:port` 探测端口
  3. 端口在监听 → 从 `netstat -ano` 获取实际 PID → 更新 `gateway_state`

### 4. runtime.py — `is_running()` 增加端口探测

- PID 锁检查失败后，socket 直连端口探测
- 端口在监听 → `netstat -ano` 获取真实 PID → 更新 PID 锁文件 + `gateway_state`
- 新增 `_get_pid_on_port(port)` 工具函数

### 5. SystemPage.tsx — GatewayTab 状态轮询

- `fetchStatus` 从 mount 拉一次改为 **每 5 秒轮询**

### 6. client.rs — sidecar stderr 日志落地（此前已有）

- 启动打点：`[sidecar.boot]`、`[sidecar.rpc]`、`[sidecar.main]`
- 落地到 `~/.artifexnexus/logs/sidecar-stderr-<pid>.log`
- `-u` 参数 + `PYTHONUNBUFFERED=1` + `PYTHONIOENCODING=utf-8`

## 改动文件

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `apps/desktop/src-tauri/src/sidecar/client.rs` | +55 | stderr 日志落地、`-u` 参数 |
| `packages/adapters/.../runtime.py` | +166 | `is_running()` 自愈 + 端口探测 |
| `packages/adapters/.../sidecar.py` | +77 | 启动打点 + EOF 不杀 gateway |
| `packages/adapters/.../sidecar_gateway.py` | +78 | gateway.status 端口探测 fallback |
| `packages/apps/web/.../AppShell.tsx` | +192/-51 | 启动逻辑重构 + 60s 硬超时 |
| `packages/apps/web/.../SystemPage.tsx` | +4/-1 | GatewayTab 5s 轮询 |

## 辅助工具

- `scripts/reset-and-run.bat`：一键清场脚本（杀残留进程 + 删 PID 锁 + 清旧日志 + 检查端口 + 启动 exe）

## 测试验证

1. 运行 `scripts\reset-and-run.bat`
2. 遮罩显示"正在启动 OpenClaw Gateway…"→ 几秒后消失
3. 右上角 Gateway 绿灯亮
4. 系统 → Gateway 页显示"运行中"、按钮为"重启 Gateway"
5. Gateway 日志正常滚动

## 已知遗留

- **Gateway 崩溃**：node.exe 进程偶尔崩溃，日志在内存 ring buffer 中随进程丢失。
  需下次复现时手动 `openclaw gateway run --port 19789` 看实时 stdout/stderr 诊断。
