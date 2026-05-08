---
id: EPIC-0002
kind: epic
title: M2 · 骨架贯通 · Blender MCP
status: review
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

| # | STORY | 状态 | 估时 | 依赖 |
|---|-------|------|------|------|
| S1 | [[../review/STORY-0021-blender-addon-scaffold]] — Blender 插件骨架 | Review | 0.5d | — |
| S2 | [[../review/STORY-0022-blender-adapter-core]] — BlenderAdapter 核心 | Review | 1d | S1 |
| S3 | [[../review/STORY-0023-mcp-server-core]] — MCP Server 核心 | Review | 1d | S2 |
| S4 | [[../review/STORY-0024-gateway-mcp-tool]] — Gateway 侧工具注册 | Review | 0.5d | S3 |
| S5 | [[../ready/STORY-0025-e2e-smoke-test]] — E2E 冒烟测试 | Ready | 0.5d | S4 |
| S6 | [[../review/STORY-0026-dcc-installer-blender]] — Sidecar DCC 安装器 | Review | 1d | S3 |
| S7 | [[../review/STORY-0027-installer-blender-real-logic]] — 安装向导 Blender 行接真实逻辑 | Review | 1d | S6 |
| S8 | [[../review/STORY-0028-gateway-mcp-bridge]] — Gateway MCP Bridge 插件 | Review | 1d | S3 |
| **合计** | | **S1–S7 Review，S8 In Progress** | **6.5d** | EPIC-0002 estimate=2w，**剩余 3.5d buffer** |

## 进展日志

- 2026-05-04 created
- 2026-05-08 STORY 拆分完成：S1–S5（STORY-0021 ~ STORY-0025），覆盖 Blender Addon → Adapter → MCP Server → Gateway 工具注册 → E2E 冒烟全链路。复刻范围确认：只复刻核心 MCP（run_python + adapter），不要 Qt/事件拦截/Skill。
