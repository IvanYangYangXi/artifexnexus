---
id: EPIC-0003
kind: epic
title: M3 · Web UI 框架 + Chat（确立统一设计语言）
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 3w
created: 2026-05-04
updated: 2026-05-10
parent: "[[../../vision/roadmap]]"
milestone: M3
related_adr: []
related_specs:
  - "[[../../specs/ui/design-language]]"
  - "[[../../specs/ui/component-inventory]]"
  - "[[../../specs/ui/web-chat-structure]]"
related_packages:
  - "packages/apps/web"
  - "packages/ui"
  - "apps/desktop"
tags: [epic, web, ui, chat, design-language, M3]
---

# M3 · Web UI 框架 + Chat

## 背景与目标

搭起 Web UI 主框架与 chat 主界面；**本阶段同时确立 Artifex Nexus 统一设计语言**，
后续所有界面（含 M0 向导）都用这套 token 与组件复刷。

## 范围 / 非范围

- 范围
  - `packages/apps/web` 应用骨架（已有空壳，需落地）
  - Chat 主界面（连 OpenClaw 可用，模型可 mock）
  - **设计语言 spec**：tokens（颜色/字体/间距/圆角/阴影/动效）+ 基础组件清单
  - 桌面应用内嵌 Web UI 的加载策略（iframe / 本地服务）
  - 回填 M0 向导使用新设计语言（不改结构）
- 非范围
  - Skill / Tool / Memory / Workflow 管理页（在后续里程碑各自加）

## UI 先行产物

- [x] `docs/specs/ui/design-language.md`（tokens 表）
- [x] `docs/specs/ui/component-inventory.md`（基础组件清单与状态）
- [x] `docs/specs/ui/web-chat-structure.md`

## 子节点（STORY 列表）

### 阶段 1：UI 骨架（先全部做完 UI）

| # | STORY | 估时 | 依赖 |
|---|-------|------|------|
| S1 | [[STORY-0031-m3-ui-tokens-components]] — 设计令牌 + 基础组件库 | 2d | — |
| S2 | [[STORY-0032-m3-ui-global-layout]] — 全局布局骨架 A/B/C/D | 1.5d | S1 |
| S3 | [[STORY-0033-m3-ui-b-sidebar]] — B 区域导航 + 自定义连接 | 1d | S2 |
| S4 | [[STORY-0034-m3-ui-chat-module]] — Chat 模块 UI | 2d | S2 |
| S5 | [[STORY-0035-m3-ui-skills-tools]] — 技能模块 UI（Skill/Tool 卡片） | 2d | S2 |
| S6 | [[STORY-0036-m3-ui-system-module]] — 系统模块 UI | 1.5d | S2 |
| S7 | [[STORY-0037-m3-ui-settings-right-panel]] — 设置模块 + D 区域面板 | 1.5d | S2 |
| S8 | [[STORY-0038-m3-ui-desktop-embed]] — Desktop 内嵌 + M0 回填 | 1d | S1–S7 |
| **UI 合计** | | **12.5d** | |

### 阶段 2：功能接线（UI 全部完成后再做）

| # | STORY | 估时 | 依赖 |
|---|-------|------|------|
| S9 | [[STORY-0039-m3-func-chat-api]] — Chat 功能接线（API + WebSocket） | 2d | S4, S8 |
| S10 | [[STORY-0040-m3-func-modules-api]] — 技能/系统/设置模块功能接线 | 2d | S5, S6, S7, S8 |
| **功能合计** | | **4d** | |
| **总计** | | **16.5d** | EPIC-0003 estimate=3w（15d），**余量 -1.5d** |

## 进展日志

- 2026-05-04 created
- 2026-05-09 三份 UI spec（design-language / component-inventory / web-chat-structure）完成
- 2026-05-10 STORY 拆分完成：阶段1 UI骨架 S1–S8（12.5d）+ 阶段2 功能接线 S9–S10（4d）
