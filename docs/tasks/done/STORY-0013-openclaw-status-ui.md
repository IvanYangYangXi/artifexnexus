---
id: STORY-0013
kind: story
title: 安装清单 OpenClaw 行接入真实状态 — sidecar.openclaw.status RPC
status: done
priority: P1
owner: "@ivan"
assignee: ai
estimate: 0.5d
created: 2026-05-06
updated: 2026-05-06
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: []
related_specs:
  - "[[../../specs/openclaw-wrapper-runtime]]"
  - "[[../../specs/openclaw-wrapper-ipc]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, ui, status, M1]
depends_on:
  - "[[STORY-0011-openclaw-health-check]]"
---

# 安装清单 OpenClaw 行接入真实状态 — sidecar.openclaw.status RPC

## 背景与目标

M0 STORY-0003 实现了安装清单的状态机 UI（pending / installing / installed / error），但
OpenClaw 行目前是 mock 数据。本 STORY 把 S1–S4 的能力**串到 UI**：sidecar 暴露
`openclaw.status` RPC 聚合（cli 是否装、bootstrap 是否完成、gateway 是否运行、health 状态），
前端按状态机渲染。

## 范围 / 非范围

- 范围
  - sidecar `openclaw.status() -> StatusReport` 聚合 4 项：
    `{ cli_installed, bootstrap_done, gateway_running, health: HealthReport, version, port }`
  - Tauri Rust 命令 `openclaw_status` + 周期性 polling（5s 间隔）
  - 前端安装清单 OpenClaw 行：状态徽章 + 版本号 + 端口 + 健康指示灯
  - 操作按钮：Install / Bootstrap / Start / Stop / Restart / Doctor / Open Log / Open Data Dir
  - 状态机驱动按钮可见性（未装时只显 Install；已装未启时显 Start；已启时显 Stop / Restart）
- 非范围
  - DCC 插件状态（M2）
  - Skill 列表 UI（M2）

## 验收标准

- [ ] 全新机器：UI 显示"未安装"，按钮仅 Install 可用
- [ ] 安装中：进度条实时更新（来自 S1 NDJSON 事件）
- [ ] 装完未启：显示"已安装 v2026.5.4"，Start 可用
- [ ] 运行中：显示绿点 + 端口号；Stop / Restart / Doctor 可用
- [ ] 异常：显示红点 + 简短错误，"Open Log" 跳详情
- [ ] 端口被切换（S5）时显示实际端口 + 历史 toast 一致
- [ ] polling 不阻塞 UI；后台静默失败不弹错（仅日志）

## 设计要点

- **StatusReport schema** 走 `packages/platform/contracts/schemas/`，前后端共用
- **状态机**：`unknown → installing → installed → starting → running → stopped`，
  每个迁移有合法事件集；前端按当前状态渲染按钮
- **polling vs event**：M1 用 polling（简单）；M2+ 改成 sidecar 主动 push event
- **"Open Data Dir"** Win 用 `explorer`，mac 用 `open`，Linux 用 `xdg-open`

## 子任务

- [ ] 在 `contracts/schemas/` 加 `openclaw-status.schema.json`
- [ ] sidecar `openclaw.status()` 聚合实现
- [ ] Rust 周期性 polling + Tauri event emit
- [ ] 前端安装清单 OpenClaw 行重写（按状态机）
- [ ] 操作按钮串通到 S1–S4 RPC

## 进展日志

- 2026-05-06 created（S6 of 7，依赖 S4 done）
