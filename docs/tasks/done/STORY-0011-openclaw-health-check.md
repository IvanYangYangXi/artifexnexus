---
id: STORY-0011
kind: story
title: 健康检查 — HTTP/WS probe + lock 文件 + doctor 三通道
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
tags: [story, openclaw, health, doctor, M1]
depends_on:
  - "[[STORY-0010-openclaw-runtime-spawn]]"
---

# 健康检查 — HTTP/WS probe + lock 文件 + doctor 三通道

## 背景与目标

EPIC-0001 DoD 要求"健康检查通过"。上游 `gateway-lock` 文档定义了 lock 文件 + bind probe
机制（详见 [[../../specs/openclaw-upstream-survey]] §4），本 STORY 实现**三通道健康检查**：
TCP probe + lock 文件存在性 + 上游 `openclaw doctor`，并解决 TBD T2（实测有无 `/healthz`
HTTP 端点）。

## 范围 / 非范围

- 范围
  - `doctor.py` 实现 `check_openclaw_health() -> HealthReport`，返回三通道结果聚合
  - 通道 A：TCP `bind(127.0.0.1, gateway.port)` 占用探测
  - 通道 B：`<state>/lock/` 锁文件存在性 + 文件内 pid 存活验证
  - 通道 C：spawn `<cli>/bin/openclaw doctor --non-interactive`，解析退出码与输出
  - **TBD T2 解决**：实测 v2026.5.4 是否有 `/healthz` / `/api/version` HTTP 端点；
    若有则升级为通道 D（首选），TCP probe 降为 fallback
  - 4 项 doctor 检查（详见 [[../../specs/openclaw-wrapper-runtime]] §7）：
    端口可达 / 锁文件正常 / openclaw.json 解析通过 / token 有效
  - sidecar `openclaw.doctor()` RPC + Tauri 命令 + 前端 UI（"一键修复"按钮）
- 非范围
  - 端口冲突处理（S5）
  - 修复手段（M2 增量，M1 仅显示问题）

## 验收标准

- [ ] gateway 健康时三通道全绿，UI 显示"运行中"绿点
- [ ] gateway 未启动时通道 A B C 都明确返回"未运行"，UI 显示灰点
- [ ] gateway 进程被外部强杀（kill -9）后，doctor 能在 ≤ 5s 内反映"异常"
- [ ] openclaw.json 损坏时 doctor 报"配置无效"，并指出具体字段
- [ ] token 缺失 / 长度异常时报"认证失败"
- [ ] TBD T2 实测结果回填 survey §4
- [ ] CLI 入口 `artifex doctor` 能跑通同样的检查（脚本化场景）

## 设计要点

- **三通道并行**：用 asyncio gather 并发三种探测，整体超时 3s
- **lock 文件解析**：上游 lock 文件格式 TBD，implement 时读源码或用 strace 抓
- **报告 schema**：`{ channels: { tcp, lock, doctor, http? }, overall: "healthy"|"degraded"|"down", problems: [...] }`
- **doctor 退出码语义**：上游 `openclaw doctor` 的退出码定义需实测（0=ok, 1=warn, 2=fail?）

## 子任务

- [ ] 实测 v2026.5.4 是否暴露 `/healthz` / `/api/version` HTTP 端点
- [ ] `doctor.py` 实现 `check_openclaw_health` 三通道聚合
- [ ] sidecar 注册 `openclaw.doctor` RPC
- [ ] Rust 命令 + 前端 UI（status 面板 + doctor 按钮）
- [ ] CLI `artifex doctor` 入口（用 click / typer，与桌面共用 doctor.py）
- [ ] 三平台 manual smoke test

## 进展日志

- 2026-05-06 created（S4 of 7，依赖 S3 done）
