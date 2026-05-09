---
id: STORY-0031
kind: story
title: M3-UI-01 · 设计令牌 + 基础组件库
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/design-language]]"
  - "[[../../specs/ui/component-inventory]]"
related_packages:
  - "packages/apps/web"
  - "packages/ui"
tags: [story, ui, tokens, components, M3]
---

# STORY-0031 · 设计令牌 + 基础组件库

## 用户故事
作为开发者，我能使用统一的 Tailwind CSS token 和 shadcn/ui 组件搭建所有界面，后续任何页面都基于此组件库构建。

## 验收标准
- [ ] `packages/ui/tailwind.preset.ts` 导出完整 Tailwind preset（颜色/字体/间距/圆角/阴影）
- [ ] CSS 变量 token 表落地（`globals.css`），深色主题为主
- [ ] P0 组件全部实现：Button / Input / Textarea / Card / Badge / Dialog / DropdownMenu / Tabs / ScrollArea / Tooltip
- [ ] 每个组件 ≤ 300 行，使用 `cva` 变体 + `cn()` 类合并 + `forwardRef`
- [ ] 组件有 Storybook 或最小 demo 页面可预览
- [ ] `pnpm -C packages/ui build` 通过

## 技术要点
- 基于 `design-language.md` 的 HSL token 表
- 基于 `component-inventory.md` 的 P0 组件清单
- shadcn/ui（Radix UI + Tailwind CSS）为底层
- 字体：Inter（UI）+ JetBrains Mono（代码/日志）

## 非范围
- P1/P2 组件（M4+）
- 业务页面逻辑
