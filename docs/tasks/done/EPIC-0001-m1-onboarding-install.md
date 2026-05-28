---
id: EPIC-0001
kind: epic
title: M1 · 基地改造 · 一键安装
status: review
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2w
created: 2026-05-04
updated: 2026-05-28
parent: "[[../../vision/roadmap]]"
milestone: M1
related_adr: [0002, 0005, 0006]
related_specs:
  - "[[../../specs/openclaw-wrapper]]"
  - "[[../../specs/openclaw-wrapper-install]]"
  - "[[../../specs/openclaw-wrapper-runtime]]"
  - "[[../../specs/openclaw-settings-panel]]"
  - "[[../../specs/openclaw-agent-preset]]"
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

- [x] 新机装完能看到 OpenClaw 运行 + 健康检查通过
- [x] 安装清单里 OpenClaw 状态为"已安装"

## 出口条件

- [x] [[../done/TASK-0001-openclaw-wrapper]] 完成
- [x] 所有 STORY 进入 `done/`

## 设计要点

- 基于 [[../../specs/openclaw-wrapper-install]] 与 [[../../specs/openclaw-wrapper-runtime]]
- 复用已有 `packages/adapters/openclaw/wrapper/`（ports/sidecar/runtime）

## 子节点（STORY 列表）

> 7 个实现型 STORY 已正式拆分（2026-05-06，STORY-0007 align 完成后产出）。
> 2026-05-07 第二批需求新增 S8/S9/S10（设置面板 / Web UI 入口 / agent 预设）。
> S1 已入 ready，可立即 implement；S2–S7 在 backlog，按依赖顺序 promote。

| # | STORY | 状态 | 估时 | 依赖 |
|---|---|---|---|---|
| S1 | [[../done/STORY-0008-thin-wrapper-installer]] — 薄壳安装器 | Done | 0.5d | — |
| S2 | [[../done/STORY-0009-openclaw-bootstrap-config]] — bootstrap + openclaw.json | Done | 1d | S1 |
| S3 | [[../done/STORY-0010-openclaw-runtime-spawn]] — runtime 拉起 gateway | Done | 1d | S1 + S2 |
| S4 | [[../done/STORY-0011-openclaw-health-check]] — 健康检查三通道 | Done | 1d | S3 |
| S5 | [[../done/STORY-0012-openclaw-port-conflict]] — 端口冲突自愈 | Done | 0.5d | S2 |
| S6 | [[../done/STORY-0013-openclaw-status-ui]] — 安装清单 UI 接真实状态 | Done | 0.5d | S4 |
| S7 | [[../done/STORY-0014-openclaw-upgrade-scaffold]] — 升级通道接口预留 | Done | 0.5d | S3 |
| S8 | [[../done/STORY-0015-openclaw-settings-panel]] — 设置面板 · 9 大 LLM provider | Done | 2d | S2 + S6 |
| S9 | [[../done/STORY-0016-openclaw-web-ui-entry]] — Web UI 入口按钮 + URL 探测 | Done | 0.5d | S3 + S6 |
| S10 | [[../done/STORY-0017-openclaw-agent-preset]] — Artifex Nexus 默认 agent 预设 | Done | 1.5d | S2 |
| S11 | [[../done/STORY-0018-openclaw-gateway-status-panel]] — Gateway 状态控制面板 | Done | 1d | S3 + S6 |
| S12 | [[../done/STORY-0019-openclaw-remote-model-list]] — 远端模型列表自动获取 | Done | 0.5d | S8 |
| S13 | [[../done/STORY-0020-openclaw-reinstall-confirm]] — 重装确认弹窗 | Done | 0.5d | S1 |
| **合计** | | **S1–S13 全部 Done** | **11d** | EPIC-0001 estimate=2w，**剩余 3d buffer** |

**前置（已 archive）**：

- [x] [[../done/STORY-0007-openclaw-spec-realign]] — 上游调研 + spec 校正

## 进展日志

- 2026-05-04 created
- 2026-05-06 align 启动：发现上游 OpenClaw 实际为 Node/pnpm monorepo（非 spec 假设的 Python 项目），先拆调研型 STORY-0007 校正 spec，再拆 S1–S6 实现型 STORY；EPIC 从 Backlog 迁 Ready
- 2026-05-06 align 收尾：锁定 4 项关键决策——① 薄壳模式（不 fork、调用上游 install-cli.sh）② gateway.port=19789（避开 18789 默认）③ M1 不注册系统服务，Tauri 主进程托管 ④ CLI 独立 prefix `~/.artifexnexus/.openclaw/cli/` 不入 PATH；候选 S1–S6 描述按决策刷新
- 2026-05-06 align 补充（用户提示）：再加 2 项约束—— ⑤ OpenClaw 版本号一等公民化（默认 v2026.5.4，`OPENCLAW_VERSION` env + CLI 按版本分子目录支持灰度回滚）⑥ artclaw 历史 `setup_openclaw_env.py` 仅作思路参考，所有 `openclaw.json` 字段须按 v2026.5.4 schema 实测；候选 STORY 拆分扩为 S1–S7（新增 S7 版本升级通道，M1 仅留接口）
- 2026-05-06 align 风险前置：调研确认 install-cli.sh 原生支持 `--version` / `--prefix` / `--no-onboard` / `--json`（NDJSON）/ `--node-version` 全部所需 flag，**零 fallback**；S1 复杂度由"中"降为"低"，估时 1d → 0.5d
- 2026-05-06 STORY-0007 implement 完成主体：交付 `[[../../specs/openclaw-upstream-survey]]`（10 节事实底）+ 3 spec patch（install / runtime / dev）+ ADR 0005 增量小节（Node runtime 共存 + M1 不注册服务）+ board.md / STORY-0007 推进至 in-progress；STORY-0007 待 review 后归档，本 EPIC 即可拆 S1–S7 实现型 STORY 进入 implement
- 2026-05-06 STORY-0007 archive（用户决策跳过 review 直接归档 → done/）；EPIC-0001 align 全部完成，所有前置 spec/ADR 已与上游事实对齐，所有反链已闭合；可正式拆 S1–S7 实现型 STORY 进入 implement
- 2026-05-06 S1–S7 STORY 拆分完成：STORY-0008（S1，ready）+ STORY-0009 ~ 0014（S2–S7，backlog），合计 5d 实现工作量，与 EPIC-0001 estimate=2w 留 5d buffer；S1 [[../ready/STORY-0008-thin-wrapper-installer]] 可立即启 implement
- 2026-05-07 第二批需求 align（用户提示）：在 EPIC-0001 阶段追加 3 条新需求—— ⑦ 设置面板（9 大 LLM provider 多预设管理，落 `openclaw.json` 的 `models.<provider_id>`）⑧ 打开 OpenClaw Web UI 的入口（`tauri-plugin-shell` 调默认浏览器，URL 由 sidecar 探测）⑨ 安装后自动注入 Artifex Nexus 默认 agent 预设（含项目定位 / DCC / MCP 工具 / Skill / 安全边界）；docs-first 已落：survey §11 加 T6/T7/T8 三项 spike + §12 调研挂钩、新建 [[../../specs/openclaw-settings-panel]] / [[../../specs/openclaw-agent-preset]] 两份 spec、[[../../specs/ui/installer-structure]] 加 §11 OpenClaw 行 4 按钮规则、拆出 STORY-0015/0016/0017 进 backlog；合计新增 4d，原 5d buffer 内可吸收，EPIC estimate 仍为 2w
- 2026-05-07 OpenSpec 启用：方案三（不进 git，本机 junction）→ scripts/setup-openspec-links.mjs + pnpm openspec:link/check/clean，docs/ 仍是单一信息源；openspec/changes/<id>/ 6 个文件全部软链 docs/，零双源
- 2026-05-07 T6/T7/T8 spike 一次性完成：实测本机已装的 OpenClaw v2026.5.4，落 1.8MB JSON Schema 到 docs/specs/_spikes/，回填 [[../../specs/openclaw-upstream-survey]] §13/14/15；**重大修正**：① 模型与鉴权解耦（`models.providers` + `auth.profiles`，原 spec "9 provider 一张表"假设错误）② Control UI 复用 gateway.port，CLI `dashboard --no-open` 一行命令拿 URL（4 级 fallback 简化为单命令）③ agent 预设走 `agents.list[]` + `systemPromptOverride` + `skills`，注入必须用 `config patch --stdin`（先 get 后合并避免数组 replace）；驱动 [[../../specs/openclaw-settings-panel]] 与 [[../../specs/openclaw-agent-preset]] 全部重写为 v2-post-spike，3 个 STORY 子任务按真相重新拆分，spike 状态置 ✅
- 2026-05-08 EPIC-0001 全部完成：S1–S13（STORY-0008 ~ STORY-0020）全部推进至 `docs/tasks/done/`，status=done。Python wrapper 225 passed / 2 skipped / 0 failed；前端 vitest 28/28 全绿；`pnpm tauri build` 产出 `artifex-nexus-desktop.exe`（11.0 MB）+ NSIS setup.exe（2.5 MB）。黑屏 bug 修复（sidecar 30s 超时 + ErrorBoundary）+ Echo 测试 UI 移除 + 重装确认弹窗 + 远端模型列表获取 全部合入。
