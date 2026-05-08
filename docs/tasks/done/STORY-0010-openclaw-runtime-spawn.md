---
id: STORY-0010
kind: story
title: runtime 拉起 OpenClaw gateway 子进程 + 日志回传
status: done
priority: P1
owner: "@ivan"
assignee: ai
estimate: 1d
created: 2026-05-06
updated: 2026-05-06
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: [0005]
related_specs:
  - "[[../../specs/openclaw-upstream-survey]]"
  - "[[../../specs/openclaw-wrapper-runtime]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, runtime, process, M1]
depends_on:
  - "[[STORY-0008-thin-wrapper-installer]]"
  - "[[STORY-0009-openclaw-bootstrap-config]]"
---

# runtime 拉起 OpenClaw gateway 子进程 + 日志回传

## 背景与目标

S1 + S2 完成后，`~/.artifexnexus/.openclaw/` 已具备完整 CLI + openclaw.json。本 STORY 实现
**Tauri 主进程托管 gateway 子进程**（M1 不注册系统服务，详见 ADR 0005 增量小节）：spawn
`<cli>/bin/openclaw gateway start --port 19789` + 注入隔离 env + 双向日志回传。

## 范围 / 非范围

- 范围
  - `runtime.py` 实现 `start_gateway(home, port) -> Process`、`stop_gateway()`、`is_running()`
  - Tauri Rust 端 spawn 管理：进程句柄、stdout/stderr 读取协程、退出码回调
  - 注入 env：`OPENCLAW_HOME` / `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` /
    `OPENCLAW_NO_ONBOARD=1`
  - 子进程日志落 `~/.artifexnexus/logs/openclaw-YYYYMMDD.log`，滚动 7 天
  - Tauri 壳退出 → SIGTERM → 5s 超时 SIGKILL
  - **不调用 `openclaw gateway install`**，不注册任何系统级服务
- 非范围
  - 健康检查（S4）
  - 端口冲突处理（S5）
  - 升级 / 重启策略（S7）

## 验收标准

- [ ] dev home 下 sidecar `openclaw.start` RPC 能成功拉起 gateway，pid 写入 `run/gateway.pid`
- [ ] gateway 进程的 env 包含全部三件套 + `NO_ONBOARD=1`，用 `procexp` / `lsof` 可验证
- [ ] stdout/stderr 实时落日志文件，UI 日志面板能流式查看（≤ 1s 延迟）
- [ ] 关闭 Tauri 壳后 5s 内 gateway 进程消失（`tasklist` / `ps` 验证）
- [ ] 系统级 service 列表（systemctl / schtasks）**未出现** `openclaw-gateway` 名
- [ ] 异常退出（gateway crash）时 UI 收到 toast 提示，日志保留崩溃栈
- [ ] 重复调 `start_gateway` 是幂等的（已运行直接返回当前 pid，不二次 spawn）

## 设计要点

- **Rust 端进程管理**：用 `tokio::process::Command` + `kill_on_drop(true)`，确保壳进程
  panic / 强杀也能带走子进程
- **Win 兼容**：`taskkill /T /F /PID <pid>` 而非 SIGTERM；用 `JobObject` 绑定生命周期更稳
- **日志双写**：sidecar 收到子进程 stdout 时同时写文件 + 转发给 Tauri event
- **PID 锁文件**：`~/.artifexnexus/run/gateway.pid` 防止重复 spawn；启动时若文件存在则
  先 probe 该 pid 是否真活，活则复用、死则清锁

## 子任务

- [ ] `runtime.py` 实现 `start_gateway` / `stop_gateway` / `is_running` 三方法
- [ ] Rust `commands/openclaw_gateway.rs` 包装 sidecar RPC
- [ ] Win JobObject / Unix process group 绑定生命周期
- [ ] 日志滚动（7 天）实现
- [ ] PID 锁文件 + 复活探测
- [ ] 三平台 manual smoke test

## 联调期发现 / 修订（2026-05-07）

> 状态：本卡 review 期内被上层 STORY-0015/0016/0017 联调暴露关键缺陷，**回退到
> review-with-issues**，等本节子任务全闭再走 done。

### Issue R1 — Windows 选错 wrapper：`[WinError 193]`

**症状**：Win11 上点"安装 OpenClaw"，三步执行到"正在启动 Gateway"报
`启动 gateway 失败: [WinError 193] %1 不是有效的 Win32 应用程序`；同时设置面板内
"测试连接"、"保存"、"打开 Web UI" 全部回同一错误。

**根因**：`_find_openclaw_bin` 候选顺序未区分平台，Windows 上命中
`<vdir>/openclaw`（POSIX sh 脚本），而真正可用的是 `<vdir>/openclaw.cmd`。npm
`install --prefix` 在 Win 上把 wrapper 落在 vdir 根目录而非 `bin/` 子目录。

**修复（驱动产出 ADR 0007）**：
- [x] 新建 `openclaw_wrapper/_subprocess.py` helper（统一 `find_openclaw_bin` /
      `build_openclaw_env` / `popen_kwargs` / `run_openclaw`）
- [x] `runtime.py` / `config_io.py` / `web_ui.py` / `agent_preset.py` 全部改走 helper
- [x] Win 上 `creationflags |= CREATE_NO_WINDOW`（避免每次 spawn 弹黑窗）
- [x] helper 单测 ≥ 6 用例（平台分支 / 候选优先级 / env 三件套 / NO_WINDOW flag）
- [ ] 三平台 smoke：Win11 装到底跑 gateway / 设置面板"测试连接" / Web UI 按钮

### 进展日志

- 2026-05-06 created（S3 of 7，依赖 S1 + S2 done）
- 2026-05-07 联调期发现 Win wrapper 选错（R1），回退 review-with-issues；驱动产出
  ADR 0007 + spec §3.1；helper + 调用方迁移见本卡 R1 子任务勾选状态
