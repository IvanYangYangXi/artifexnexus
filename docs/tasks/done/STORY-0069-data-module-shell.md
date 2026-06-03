---
id: STORY-0069
kind: story
title: 数据模块外壳（Sidebar 集成 + DataPage + 列配置 + 视图切换）
status: done
priority: P0
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-06-03
updated: 2026-06-03T23:41
parent: "[[EPIC-0010-m10-data-view]]"
milestone: M10
related_adr: []
related_specs:
  - "[[../../specs/ui/data-view-structure]]"
related_packages:
  - "packages/apps/web"
tags: [story, data, shell, ui, M10]
---

# STORY-0069 · 数据模块外壳

## 背景与目标

把数据视图模块挂到现有 AppShell：Sidebar 加「数据」一级模块，
在 ContentArea 路由到 DataPage；实现导入入口 → 列配置 → 视图切换 → 渲染容器的完整外壳，
具体视图组件是空槽位（"View not implemented"），由 STORY-0070~0073 填入。

## 范围 / 非范围

- 范围：
  - `Sidebar.tsx` MODULES 数组加 `data` 项
  - `ContentArea.tsx` 加 `data` 路由
  - `packages/apps/web/src/components/data/DataPage.tsx` 主壳
  - 导入区：拖拽 / 选择文件 / 粘贴 JSON
  - 列配置面板：每列名 / 显示名 / 类型 / 启用，可手动覆盖类型
  - 视图切换器：10 视图按钮组（基于 `@artifex-nexus/ui` 的 Tabs 或自封装）
  - 渲染容器：根据 `andf.view.type` 派发到对应视图组件占位
  - Summary Bar 占位（STORY-0074 实现）
- 非范围：视图本身的渲染、反向编辑、导出（各自归后续 STORY）

## 验收标准

- [x] Sidebar 显示「数据」模块项，icon=Database，激活态符合 design-language
- [x] 切到数据模块后渲染 DataPage（ContentArea 路由已加）
- [x] 拖入 / 选文件 / 粘贴 JSON 三种导入入口就位，ImportDropzone 含完整交互
- [x] 导入成功后进入 configuring 态，右侧出现 ColumnConfig 面板（列名 + 类型标签）
- [x] 视图切换器 10 视图分 3 组按钮，未实现视图显示 ViewPlaceholder 占位
- [x] 全部走 `@artifex-nexus/ui` 现成组件（ScrollArea），无硬编码视觉
- [x] 单文件 ≤ 300 行（DataPage 276 / ImportDropzone 220 / ColumnConfig 87 / ViewSwitcher 117 / ViewContainer 83 / SummaryBar 49）
- [x] 状态机 5 态（empty/importing/configuring/rendering/error）完整
- [x] 导入区 3 入口（拖拽 / 选文件 / 粘贴 JSON）+ 大小校验（5MB）
- [x] ColumnConfig 显示列名 + 推断类型标签 + 可见性 checkbox（disabled 占位）
- [x] ViewSwitcher 分 3 组：直展 / 聚合 / 空间
- [x] SummaryBar 占位：显示行数和列数
- [x] web typecheck 0 新增错误

## 设计要点

- 模块 id 用 `"data"`，icon 用 `lucide-react` 的 `Database`（待 spec 确定）
- DataPage 内部分成 `<ImportDropzone />` / `<ColumnConfigPanel />` / `<ViewSwitcher />` / `<ViewRenderer />` / `<SummaryBar />` 5 个子组件
- 状态用 React state（首版不持久化），ANDF 对象在 DataPage 内部 useState 管理

## 进展日志

- 2026-06-03 created
- 2026-06-03 implemented：Sidebar + ContentArea 路由 + 6 个组件文件（DataPage/ImportDropzone/ColumnConfig/ViewSwitcher/ViewContainer/SummaryBar）+ 状态机 + typecheck 0 新增错误
- 2026-06-03 review 通过（AC 14/14），迁 done/。P1 已记：STORY-0070 必须把 activeView 抬升到 DataPageContext 解除 ViewSwitcher/ViewContainer state 隔离
