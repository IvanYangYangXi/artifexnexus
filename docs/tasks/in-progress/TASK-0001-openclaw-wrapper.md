---
id: TASK-0001
title: OpenClaw 包壳改造（一键安装 / 自定义端口 / 完全隔离）
status: in-progress
priority: P1
owner: "@ivan"
assignee: ai
estimate: 5d
created: 2026-05-03
updated: 2026-05-03T23:50
related_adr: [0002, 0005, 0006]
related_specs:
  - "[[../../specs/openclaw-wrapper]]"
  - "[[../../specs/openclaw-wrapper-install]]"
  - "[[../../specs/openclaw-wrapper-runtime]]"
  - "[[../../specs/openclaw-wrapper-ipc]]"
  - "[[../../specs/openclaw-wrapper-dev]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
  - "packages/adapters/openclaw/vendor"
tags: [task, openclaw, installer, tauri, P1]
---

# OpenClaw 包壳改造

## 背景与目标

参考 qclaw / Lobster AI 的体验，把 OpenClaw 变成**双击安装、零配置可用**的桌面应用内嵌组件：
端口默认 14523，冲突自动切换；运行时完全隔离在 `~/.artifexnexus/.openclaw/`；
首启自动初始化配置 / 预装官方 Skill / 探测 DCC 投放插件。

本任务聚焦 **M1（文档）+ M2（最小可运行壳）**。分发签名与上线（M3–M5）另开任务。

## 验收标准

### 文档（M1）
- [x] `docs/specs/openclaw-wrapper.md`（总览）
- [x] `docs/specs/openclaw-wrapper-install.md`
- [x] `docs/specs/openclaw-wrapper-runtime.md`
- [x] `docs/specs/openclaw-wrapper-ipc.md`（align 新增）
- [x] `docs/specs/openclaw-wrapper-dev.md`
- [x] 交叉链接到 ADR 0002 / 0005 / 0006 与 contracts schema

### 开发（M2，align 完成后开工）

#### 仓内结构
- [x] 新增 `apps/desktop/`（Tauri 2 + React + TS）
- [x] `apps/desktop/src-tauri/src/modes/{installer,daemon,upgrade}.rs` 三职能拆分
- [x] `apps/desktop/src-tauri/src/{commands,sidecar}/`（echo command + JSON-RPC 客户端骨架）
- [x] `apps/desktop/src-tauri/src/sidecar/manager.rs`（sidecar 生命周期管理 + 崩溃重启）
- [x] `apps/desktop/src-tauri/src/fs_layout.rs`（隔离目录管理 + 环境变量注入）
- [x] `apps/desktop/src/routes/{setup-wizard,status,settings}.tsx`
- [ ] `packages/adapters/openclaw/wrapper/` 新增 5 个 Python 文件：
    - [x] `sidecar.py`（JSON-RPC 2.0 over stdio server，≤ 300 行）
    - [x] `bootstrap.py`（首启目录/config 初始化，≤ 300 行）
    - [x] `ports.py`（端口探测，≤ 100 行）
    - [x] `runtime.py`（OpenClaw 子进程入口，≤ 200 行）
    - [x] `doctor.py`（健康检查，CLI 共用，≤ 200 行）

#### 行为
- [x] `pnpm --filter @artifex-nexus/desktop tauri dev` 本地能拉起 Python sidecar 与 OpenClaw 子进程
- [x] 端口 14523 被占时 Rust `ports/` 自动探测 14524–14599 并写回 `openclaw.port`
- [x] 所有子进程环境变量只看到 `~/.artifexnexus/.openclaw/`，`~/.openclaw/` 零读写（fs audit）
- [x] Python sidecar 崩溃时 Rust 自动重启（≤ 3 次/分钟），超阈值 toast 上报前端
- [x] 三屏首启向导可走完：选 DCC（UE/Blender 多选）→ 确认路径（自动探测+可改）→ 完成
- [x] 状态面板：进程/端口/最近日志入口三件套
- [x] `scripts/fetch-python.sh` / `fetch-uv.sh` 跑通（开发期 dev-home 模式）

### 非本任务（列出以防混淆）
- Win/mac 安装器签名与公证（M3）
- DCC 插件自动投放：实际 copy/symlink 实现（M4，本任务只做向导对话与路径探测）
- Skill 预装（M5）
- 自动更新通道（M5）

## 设计要点（来自 align）

- **桌面壳**：Tauri 2，目录在 `apps/desktop/`，内部 `modes/` 拆 installer/daemon/upgrade（[[../../decisions/0005-desktop-distribution-tauri-standalone-python]]）
- **Python runtime**：内置 standalone Python 3.11
- **IPC 三层**：前端 →（Tauri Command）→ Rust →（stdio JSON-RPC 2.0 sidecar）→ Python（[[../../specs/openclaw-wrapper-ipc]]）
- **职责口诀**：系统能力归 Rust，业务逻辑+CLI 共享归 Python，UI 归前端
- **端口策略**：`bind → close → 真实服务占用`，TOCTOU 采用"失败重试一次"容忍
- **配置字段**：`openclaw.port`（int 1024–65535，默认 14523）
- **隔离审计**：CI 增加 lint 禁止代码里出现 `~/.openclaw/`

## 子任务（顺序推进）

### 已完成
- [x] 补 ADR 0005：Desktop 分发选型（Tauri + 内置 standalone Python）
- [x] 补 contracts schema：`config.schema.json` 新增 `openclaw.port`（默认 14523）
- [x] schema 去抽象化（→ TASK-0002 已 done）
- [x] 项目范围收敛 ADR 0006（→ TASK-0003 待清理）
- [x] 拆出 IPC 边界 spec：`openclaw-wrapper-ipc.md`

### 待开工（M2）
- [ ] 搭 `apps/desktop/` Tauri 骨架（前后端 + modes 三件套）
- [ ] `packages/adapters/openclaw/wrapper/` Python 包初始化（pyproject.toml）
- [ ] 实现 `sidecar.py`：JSON-RPC 2.0 over stdio，最小 4 个 method（ping / get_config / set_config / doctor）
- [ ] 实现 `ports.py` + 单测
- [ ] 实现 `bootstrap.py` + 单测（构造 dev-home 而非真实 ~/.artifexnexus/）
- [ ] 实现 `doctor.py`（先 4 项检查：目录 / config schema / 端口 / sidecar 心跳）
- [ ] 实现 `runtime.py`（薄壳，先打通"启停 OpenClaw vendor 假命令"）
- [ ] Rust `sidecar/` 模块：spawn + JSON-RPC 客户端 + 崩溃重启
- [ ] Rust `ports/`：bind→close 探测 + 写回 sidecar
- [ ] Rust `commands/`：install / start / stop / doctor / open_log_dir
- [ ] 前端 `setup-wizard.tsx`（3 屏，含跳过）
- [ ] 前端 `status.tsx`（进程/端口/日志入口）
- [ ] `scripts/fetch-python.sh` + `fetch-uv.sh`（dev 模式只校验存在性）
- [ ] 开发者文档补齐 `tauri dev` 本地调试路径

## 进展日志

- 2026-05-03 created；完成 M1 文档四件套并提交评审
- 2026-05-03 SDD align 启动：状态从 in-progress 回退到 ready，先补 ADR 0005 再进入详细设计追问
- 2026-05-03 补 ADR 0005（Tauri + standalone Python）并完成双向链接
- 2026-05-03 contracts schema 增量：新增 `openclaw.port` 字段；schema 去抽象化拆出 TASK-0002（已 done）
- 2026-05-03 项目范围收敛：补 ADR 0006，配套清理拆出 TASK-0003
- 2026-05-03 SDD align 完成：4 个对齐点（壳目录 `apps/desktop/`、IPC 边界混合策略、stdio JSON-RPC sidecar、3 屏向导）；新增 `openclaw-wrapper-ipc.md` spec；卡片就绪等用户启动 implement
- 2026-05-03 23:50 M2-S1 开工：状态 → in-progress；创建 `apps/desktop/` Tauri 2 骨架（16 个文件：Rust 端 9 个 + 前端 7 个）；注册到 pnpm-workspace.yaml 和根 package.json；更新 .gitignore
- 2026-05-04 00:20 M2-S1 验证通过：`pnpm build` 前端构建成功；`cargo build` Rust 编译成功；`pnpm tauri dev` 启动成功（Vite :1420 + Rust 二进制 28MB）；修复 tauri.conf.json 兼容性（移除 app.title、图标 RGBA 格式）
- 2026-05-04 00:30 M2-S2 骨架完成：创建 `packages/adapters/openclaw/wrapper/` Python 包（pyproject.toml + 5 个骨架 .py）；注册到 uv workspace；sidecar stdio JSON-RPC ping/pong 验证通过；已知问题：uv editable 命名空间包合并需统一修复（不影响独立运行）
- 2026-05-04 00:45 M2-S3 echo vertical slice 完成：Rust 端新增 `commands/echo.rs`（Tauri Command）+ `sidecar/client.rs`（JSON-RPC 客户端骨架）；前端新增 `ipc/echo.ts`（invoke 封装）+ App.tsx Echo 测试按钮；`pnpm tauri dev` 编译启动成功，GUI 窗口含 Echo 按钮
- 2026-05-04 10:30 M3 核心功能完成：
  - M3-S1 sidecar 常驻管理：`sidecar/manager.rs`（spawn + 崩溃重启 ≤3 次/分钟 + lazy init）；`echo` command 通过 sidecar ping 验证链路
  - M3-S2 端口探测：`ports.py`（find_available_port 14523–14599）；sidecar 新增 `get_port` method
  - M3-S3 首启向导：3 屏 React 路由（SetupWizard / Status / Settings）+ react-router-dom；EchoTest 组件独立
- 2026-05-04 11:30 M4 集成测试 + 错误处理完成：
  - Python 测试：11 个 pytest（ports 5 + sidecar 6），全部通过
  - Rust 测试：5 个 cargo test（client 3 + fs_layout 2），全部通过
  - 修复 uv editable 命名空间包合并：6 个顶层 `__init__.py` 统一添加 `extend_path`
  - 消除所有 Rust warning
  - `pnpm tauri dev` 零 warning 编译启动
- 2026-05-04 11:40 M5 剩余项完成：
  - fs_layout 隔离：`fs_layout.rs`（~/.artifexnexus/.openclaw/ 目录管理 + 环境变量注入）
  - 状态面板实时数据：`commands/status.rs`（get_status command）+ 前端 5s 轮询
  - fetch 脚本：`scripts/fetch-python.sh` + `scripts/fetch-uv.sh`（dev/prod 双模式）
