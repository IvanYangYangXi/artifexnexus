---
id: EPIC-0009
kind: epic
title: M9 · 扩展 DCC（SP / SD / Houdini）
status: backlog
priority: P3
owner: "@ivan"
assignee: pair
estimate: 4w
created: 2026-05-05
updated: 2026-05-05
parent: "[[../../vision/roadmap]]"
milestone: M9
related_adr: [0006]
related_specs: []
related_packages:
  - "packages/dcc"
tags: [epic, dcc, substance-painter, substance-designer, houdini, M9]
---

# M9 · 扩展 DCC（SP / SD / Houdini）

## 背景与目标

在 M7 多 DCC 框架稳定后，按需扩展 Substance Painter / Substance Designer / Houdini，
复用 M2 起就跑通的 uplink + gateway-plugin + dcc 插件三件套。

## 范围 / 非范围

- 范围：Substance Painter / Substance Designer / Houdini 的 DCC 适配 + 安装向导接入
- 非范围：行业其它 DCC（Cinema 4D / Modo 等），按社区贡献接

## UI 先行产物

- [ ] `docs/specs/ui/installer-structure.md` 增补这三类 DCC 的子项字段差异（不另建 spec）

## 可分发定义（DoD）

- [ ] 安装向导出现 SP / SD / Houdini 顶级条目，可装、可调
- [ ] 三者中至少一个能跑通 `mcp_<dcc>_run_python`

## 出口条件

- [ ] 所有 STORY 进入 `done/`
- [ ] 至少一个完整 E2E 用例

## 子节点（STORY 列表）

- [ ] 待 align 展开

## 进展日志

- 2026-05-05 created（M9 占位，源于 STORY-0001 align 决策）
