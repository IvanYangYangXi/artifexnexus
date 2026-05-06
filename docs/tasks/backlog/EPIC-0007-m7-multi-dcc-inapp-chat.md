---
id: EPIC-0007
kind: epic
title: M7 · 多 DCC 接入 + 软件内 Chat
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 4w
created: 2026-05-04
updated: 2026-05-04
parent: "[[../../vision/roadmap]]"
milestone: M7
related_adr: [0006]
related_specs:
  - "[[../../specs/系统架构设计]]"
related_packages:
  - "packages/dcc/unreal"
  - "packages/dcc/blender"
tags: [epic, dcc, unreal, max, maya, inapp-chat, M7]
---

# M7 · 多 DCC 接入 + 软件内 Chat

## 背景与目标

把 M2 在 Blender 上跑通的链路，平铺到 UE 5.7 / 3ds Max / Maya；
每个 DCC 插件内提供 chat 面板（嵌 Web UI 或精简子集）。

## 范围 / 非范围

- 范围：UE / Max / Maya 各自插件 + DCC 内 chat 面板
- 非范围：与 Skill 深度耦合（已在 M4 完成）

## UI 先行产物

- [ ] `docs/specs/ui/inapp-chat-structure.md`（桌面 vs DCC 内的差异与 fallback）

## 可分发定义（DoD）

- [ ] 在任一 DCC 软件内打开面板可直接聊天并执行 `run_python`
- [ ] 多 DCC 并存时工具命名空间不冲突（`mcp_<dcc>_run_python`）

## 子节点（STORY 列表）

- [ ] 待 align 展开（建议按 DCC 拆）

## 进展日志

- 2026-05-04 created
