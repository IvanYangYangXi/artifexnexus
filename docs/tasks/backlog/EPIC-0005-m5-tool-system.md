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
updated: 2026-05-15
parent: "[[../../vision/roadmap]]"
milestone: M5
related_adr: [0003]
related_specs: []
related_docs:
  - "[[../../research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/platform/skill"
  - "packages/apps/web"
  - "apps/desktop"
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

- [ ] [[STORY-0045-m5-sdk-tool-registry]] · ToolRegistry + ToolInstaller (2d)
- [ ] [[STORY-0046-m4-rpc-skill-tool]] · Sidecar RPC：Tool 方法（共享）(0.5d)
- [ ] [[STORY-0047-m4-ui-skill-tool-wiring]] · Web UI 接线（共享）(1d)

## 进展日志

- 2026-05-15 align 完成：子节点已按 v2 复刻方案展开为 3 个 STORY
- 2026-05-04 created
