---
id: EPIC-0002
kind: epic
title: M2 · 骨架贯通 · Blender MCP
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2w
created: 2026-05-04
updated: 2026-05-04
parent: "[[../../vision/roadmap]]"
milestone: M2
related_adr: [0003, 0006]
related_specs:
  - "[[../../specs/系统架构设计]]"
  - "[[../../specs/skill-system]]"
related_packages:
  - "packages/adapters/openclaw/uplink"
  - "packages/adapters/openclaw/gateway-plugin"
  - "packages/dcc/blender"
tags: [epic, dcc, blender, mcp, M2]
---

# M2 · 骨架贯通 · Blender MCP

## 背景与目标

以 Blender 作为首个 DCC 跑通上行（uplink）+ 下行（MCP）全链路，
证明 OpenClaw ↔ Gateway ↔ DCC 的闭环可用。

## 范围 / 非范围

- 范围：Blender uplink + gateway-plugin + blender 插件注入 + `run_python` 单工具
- 非范围：UE / Max / Maya（M7）

## 可分发定义（DoD）

- [ ] 装好后能在 OpenClaw 侧输入一句话，Blender 内成功 print hello
- [ ] 工具命名空间 `mcp_blender_run_python` 正确前缀

## 出口条件

- [ ] E2E 冒烟脚本化
- [ ] 所有 STORY 进入 `done/`

## 子节点（STORY 列表）

- [ ] 待 align 展开

## 进展日志

- 2026-05-04 created
