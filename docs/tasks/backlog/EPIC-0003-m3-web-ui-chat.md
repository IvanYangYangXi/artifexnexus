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
updated: 2026-05-04
parent: "[[../../vision/roadmap]]"
milestone: M3
related_adr: []
related_specs: []
related_packages:
  - "packages/apps/web"
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

- [ ] `docs/specs/ui/design-language.md`（tokens 表）
- [ ] `docs/specs/ui/component-inventory.md`（基础组件清单与状态）
- [ ] `docs/specs/ui/web-chat-structure.md`

## 辅助工具

允许引入 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 做 UX 探索；
**结论必须沉淀到上述三份 spec**，不在对话里口述带过。

## 可分发定义（DoD）

- [ ] Web UI 可打包并被桌面应用加载
- [ ] Chat 界面可发消息（后端可 mock）
- [ ] M0 向导已用新设计语言复刷

## 出口条件

- [ ] 三份 UI spec accepted
- [ ] 所有 STORY 进入 `done/`

## 子节点（STORY 列表）

- [ ] 待 align 展开（建议：设计令牌→基础组件→chat 结构→桌面内嵌→M0 回填）

## 进展日志

- 2026-05-04 created
