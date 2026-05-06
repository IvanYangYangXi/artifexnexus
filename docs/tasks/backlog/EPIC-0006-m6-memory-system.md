---
id: EPIC-0006
kind: epic
title: M6 · 定制记忆
status: backlog
priority: P2
owner: "@ivan"
assignee: pair
estimate: 2w
created: 2026-05-04
updated: 2026-05-04
parent: "[[../../vision/roadmap]]"
milestone: M6
related_adr: []
related_specs: []
related_packages:
  - "packages/platform/core"
  - "packages/apps/web"
tags: [epic, memory, M6]
---

# M6 · 定制记忆

## 背景与目标

在 `packages/platform/core` 引入可配置的记忆子系统；Web UI 暴露管理面板（查看 / 清理 / 策略）。

## 范围 / 非范围

- 范围：记忆存储 + 会话跨次读写 + Web UI 面板
- 非范围：向量数据库选型（留 ADR）

## UI 先行产物

- [ ] `docs/specs/ui/memory-manager-structure.md`

## 可分发定义（DoD）

- [ ] 关闭重开会话后可读到上次上下文
- [ ] 可在 UI 清理 / 调策略

## 子节点（STORY 列表）

- [ ] 待 align 展开

## 进展日志

- 2026-05-04 created
