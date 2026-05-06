---
id: EPIC-0005
kind: epic
title: M5 · Tool 系统
status: backlog
priority: P2
owner: "@ivan"
assignee: pair
estimate: 2w
created: 2026-05-04
updated: 2026-05-04
parent: "[[../../vision/roadmap]]"
milestone: M5
related_adr: [0003]
related_specs: []
related_packages:
  - "packages/platform/skill"
  - "packages/apps/web"
tags: [epic, tool, M5]
---

# M5 · Tool 系统

## 背景与目标

Tool 与 Skill 解耦管理：Skill 是包，Tool 是包内 `@tool` 装饰的函数。
本阶段提供全局 Tool 注册表 + Web UI 浏览 / 调用。

## 范围 / 非范围

- 范围：Tool 发现 / 启停 / 单次调用 UI
- 非范围：Tool 市场 / 远程分发

## UI 先行产物

- [ ] `docs/specs/ui/tool-manager-structure.md`

## 可分发定义（DoD）

- [ ] Web UI 能列全局 Tool 并一键调用（不含 DCC 侧复杂参数，用 mock）

## 子节点（STORY 列表）

- [ ] 待 align 展开

## 进展日志

- 2026-05-04 created
