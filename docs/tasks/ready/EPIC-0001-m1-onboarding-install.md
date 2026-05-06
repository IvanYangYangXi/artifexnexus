---
id: EPIC-0001
kind: epic
title: M1 · 基地改造 · 一键安装
status: ready
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2w
created: 2026-05-04
updated: 2026-05-06
parent: "[[../../vision/roadmap]]"
milestone: M1
related_adr: [0002, 0005, 0006]
related_specs:
  - "[[../../specs/openclaw-wrapper]]"
  - "[[../../specs/openclaw-wrapper-install]]"
  - "[[../../specs/openclaw-wrapper-runtime]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [epic, installer, openclaw, M1]
---

# M1 · 基地改造 · 一键安装

## 背景与目标

把 M0 的安装清单接上真实逻辑：OpenClaw vendor 以**薄壳模式**落位到
`~/.artifexnexus/.openclaw/`（CLI prefix + state + workspace 三栏），自定 gateway 端口
**19789**（与上游官方 multi-gateway 文档 rescue bot 示例对齐，与默认 18789 隔离 +1000），
通过三件套环境变量（`OPENCLAW_HOME` / `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH`）
+ `agents.defaults.workspace` 实现与"用户已装 OpenClaw"零冲突；M1 不注册系统服务，由 Tauri
主进程托管 gateway 子进程，应用退出即停。健康检查经 HTTP/WebSocket bind probe + lock 文件双通道。

## 范围 / 非范围

- 范围：OpenClaw 一键安装 + 启停 + 健康检查 + 真实状态探测
- 非范围：DCC 插件注入（M2）、Web UI（M3）

## 可分发定义（DoD）

- [ ] 新机装完能看到 OpenClaw 运行 + 健康检查通过
- [ ] 安装清单里 OpenClaw 状态为"已安装"

## 出口条件

- [ ] [[../review/TASK-0001-openclaw-wrapper]] 完成
- [ ] 所有 STORY 进入 `done/`

## 设计要点

- 基于 [[../../specs/openclaw-wrapper-install]] 与 [[../../specs/openclaw-wrapper-runtime]]
- 复用已有 `packages/adapters/openclaw/wrapper/`（ports/sidecar/runtime）

## 子节点（STORY 列表）

> S1–S6 实现型 STORY 等 STORY-0007 调研 done 后，由人类启动 align 拆出。
> 候选拆分（pending STORY-0007 校正后，已按薄壳决策刷新）：
> - **S1 薄壳安装器**：调用上游 `install-cli.sh --prefix ~/.artifexnexus/.openclaw/cli/v2026.5.4/`，
>   不入用户 PATH；版本号由 `OPENCLAW_VERSION` env 控制（默认 `v2026.5.4`），CLI 按版本分目录支持灰度回滚
> - **S2 bootstrap 真实初始化** `~/.artifexnexus/.openclaw/{cli/<ver>/,state,workspace,openclaw.json}`，
>   silent 写入 `gateway.port=19789` + `version=v2026.5.4` + 自动生成 token + provider 占位，跳过 `openclaw onboard`
>   （配置字段须按 v2026.5.4 schema 实测，不照搬 artclaw 历史脚本）
> - **S3 runtime 拉起 gateway 子进程**：Tauri 主进程 spawn `cli/v2026.5.4/bin/openclaw gateway start --port 19789`，
>   注入三 env 变量；不注册 systemd / schtasks；stdout/stderr 回传到 desktop 日志面板
> - **S4 健康检查**：HTTP probe `127.0.0.1:19789` + WebSocket bind 探测 + `state/lock/` 锁文件三通道，
>   doctor 4 项（端口可达 / 锁正常 / 配置存在 / token 有效）
> - **S5 端口冲突处理**：检测 19789 被占→提示用户改 19799/19809（仍保 +20 派生隔离），写回 `openclaw.json`
> - **S6 安装清单接入**：sidecar JSON-RPC 暴露 `openclaw.status`，安装清单 OpenClaw 行接真实状态
> - **S7（可选）版本升级通道**：`openclaw upgrade --to v2026.X.Y` 命令，复用 S1 装到新 prefix 子目录，
>   写回 `openclaw.json.version`，旧版本保留 N 个用于回滚（M1 范围内仅留接口，实际升级流到 M2+ 验证）

- [ ] [[../review/STORY-0007-openclaw-spec-realign]] — 上游调研 + spec 校正（前置，待 review）

## 进展日志

- 2026-05-04 created
- 2026-05-06 align 启动：发现上游 OpenClaw 实际为 Node/pnpm monorepo（非 spec 假设的 Python 项目），先拆调研型 STORY-0007 校正 spec，再拆 S1–S6 实现型 STORY；EPIC 从 Backlog 迁 Ready
- 2026-05-06 align 收尾：锁定 4 项关键决策——① 薄壳模式（不 fork、调用上游 install-cli.sh）② gateway.port=19789（避开 18789 默认）③ M1 不注册系统服务，Tauri 主进程托管 ④ CLI 独立 prefix `~/.artifexnexus/.openclaw/cli/` 不入 PATH；候选 S1–S6 描述按决策刷新
- 2026-05-06 align 补充（用户提示）：再加 2 项约束—— ⑤ OpenClaw 版本号一等公民化（默认 v2026.5.4，`OPENCLAW_VERSION` env + CLI 按版本分子目录支持灰度回滚）⑥ artclaw 历史 `setup_openclaw_env.py` 仅作思路参考，所有 `openclaw.json` 字段须按 v2026.5.4 schema 实测；候选 STORY 拆分扩为 S1–S7（新增 S7 版本升级通道，M1 仅留接口）
- 2026-05-06 align 风险前置：调研确认 install-cli.sh 原生支持 `--version` / `--prefix` / `--no-onboard` / `--json`（NDJSON）/ `--node-version` 全部所需 flag，**零 fallback**；S1 复杂度由"中"降为"低"，估时 1d → 0.5d
- 2026-05-06 STORY-0007 implement 完成主体：交付 `[[../../specs/openclaw-upstream-survey]]`（10 节事实底）+ 3 spec patch（install / runtime / dev）+ ADR 0005 增量小节（Node runtime 共存 + M1 不注册服务）+ board.md / STORY-0007 推进至 in-progress；STORY-0007 待 review 后归档，本 EPIC 即可拆 S1–S7 实现型 STORY 进入 implement
