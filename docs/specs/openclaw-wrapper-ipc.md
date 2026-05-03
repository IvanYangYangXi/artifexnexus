---
tags: [spec, openclaw, ipc, architecture]
created: 2026-05-03
status: draft
---

# OpenClaw Wrapper — IPC 边界（Front ↔ Rust ↔ Python）

> 总览：[[openclaw-wrapper]]。本文只讲三层之间**谁干什么、用什么协议**。

## 1. 拓扑

```
┌──────────────────────────────────────────┐
│  前端 React（apps/desktop/src/）          │
│  · 三屏首启向导 / 状态面板 / 设置          │
└────────────────┬─────────────────────────┘
                 │ Tauri Command (typed)
┌────────────────▼─────────────────────────┐
│  Rust（apps/desktop/src-tauri/）          │
│  · 子进程 spawn / kill / 重启             │
│  · 端口探测（bind→close）                 │
│  · UE plugin copy / Blender symlink       │
│  · 单实例锁、原生通知                     │
└────────────────┬─────────────────────────┘
                 │ stdio JSON-RPC 2.0（常驻 sidecar）
┌────────────────▼─────────────────────────┐
│  Python sidecar                           │
│  packages/adapters/openclaw/wrapper/sidecar.py │
│  · 配置读写（contracts schema 校验）      │
│  · Skill 安装 / 列表 / enable             │
│  · doctor 健康检查（CLI 也调它）           │
│  · OpenClaw 子进程 bootstrap              │
└──────────────────────────────────────────┘
```

## 2. 职责边界口诀

- 凡是 **系统能力** → Rust（不可替代）
- 凡是 **业务逻辑 + 与 CLI 共享** → Python sidecar
- 凡是 **UI / 用户交互** → 前端

## 3. 边界明细表

| 职能 | 谁干 | 备注 |
|---|---|---|
| 子进程 spawn / kill / 重启 | **Rust** | Tauri 强项，跨平台稳 |
| 端口绑定探测（bind→close） | **Rust** | 系统调用，必须 Rust |
| UE plugin copy / Blender symlink | **Rust** | 跨平台 fs 行为差异大 |
| 单实例锁 (`run/app.lock`) | **Rust** | 同上 |
| 原生通知（toast / SmartScreen 等） | **Rust** | 必须原生 API |
| 配置读写、schema 校验 | **Python** | 与 CLI 复用 |
| Skill 安装 / 列表 / enable | **Python** | Skill 是 Python 包 |
| 健康检查 doctor | **Python** | CLI 与桌面共用 |
| OpenClaw vendor 启停参数组装 | **Python** | 业务逻辑 |
| 首启向导（3 屏）UI | **前端** | React + Tauri Command |
| 状态面板 UI | **前端** | 同上 |

## 4. sidecar 协议

- **传输**：stdio
- **帧**：JSON-RPC 2.0，**每行一个 JSON 对象**（NDJSON），无 Content-Length 头
- **启动**：Rust `daemon.rs` 在主壳启动时 spawn 一次，常驻
- **崩溃**：Rust 监听子进程退出，自动重启；阈值 3 次/分钟，超阈值通过 Tauri 事件上报前端
- **调试**：dev 模式下 Rust 把 sidecar stderr 转给 Tauri devtools 控制台
- **关停**：Rust 收到 quit 时先发 JSON-RPC `shutdown` 通知，5s 超时 SIGTERM，再 5s SIGKILL

## 5. 错误传播

- Python sidecar 抛异常 → JSON-RPC `error: { code, message, data }`
- Rust 把 error 转成 `Result<T, AppError>` → Tauri Command 返回 reject
- 前端 `try { await invoke(...) } catch (e) { ... }`

## 6. 不允许做的事

- 前端**不允许**直接 spawn Python 子进程
- 前端**不允许**直接读 / 写 fs（统一走 Rust Command）
- Python sidecar **不允许**做 UI 决策（弹窗等），它只回数据
- Rust **不允许**写业务逻辑（配置校验、Skill 操作等都让 sidecar 做）

## 7. 文件归属

| 层 | 文件位置 | 行数硬上限 |
|---|---|---|
| 前端 IPC 调用封装 | `apps/desktop/src/ipc/*.ts` | 300 |
| Rust Command 注册 | `apps/desktop/src-tauri/src/commands/*.rs` | 300 |
| Rust ↔ sidecar client | `apps/desktop/src-tauri/src/sidecar/*.rs` | 300 |
| Python sidecar server | `packages/adapters/openclaw/wrapper/src/.../sidecar.py` | 300 |
| Python 业务模块 | `packages/adapters/openclaw/wrapper/src/.../{bootstrap,ports,doctor,runtime}.py` | 300 each |

## 相关

- [[openclaw-wrapper]] · [[openclaw-wrapper-install]] · [[openclaw-wrapper-runtime]] · [[openclaw-wrapper-dev]]
- [[../decisions/0005-desktop-distribution-tauri-standalone-python]]
- [[../tasks/ready/TASK-0001-openclaw-wrapper]]
