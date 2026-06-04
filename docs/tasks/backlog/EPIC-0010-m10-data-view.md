---
id: EPIC-0010
kind: epic
title: M10 · 数据图形视图（ANDF + 10 视图 + 反向编辑）
status: backlog
priority: P0
owner: "@ivan"
assignee: pair
estimate: 4w
created: 2026-06-03
updated: 2026-06-04
parent: "[[../../vision/roadmap]]"
milestone: M10
related_adr: []
related_specs:
  - "[[../../specs/ui/data-view-structure]]"
related_packages:
  - "packages/apps/web"
  - "packages/platform/contracts"
  - "packages/ui"
tags: [epic, data, visualization, M10, planned]
---

# M10 · 数据图形视图 📋 PLANNED

## 背景与目标

在 Web UI 新增独立「数据」模块。定义统一数据格式 **ANDF**，
支持从 CSV / JSON 数组导入，渲染 **10 种视图**（4 直展 + 4 聚合 + 2 空间），
对**直展型**与**空间型**视图支持反向编辑（单元格修改、坐标拖动），
变更以 ANDF Diff 输出，可导出回 CSV / JSON。

把项目从「只能用聊天看 / 用 DCC 看数据」推到「桌面应用本身就是一个轻量数据视图工具」。

源构想：[[../../inbox/data-visualization-view]]（已 triage）。

## 范围 / 非范围

**范围**：
- ANDF 数据契约（JSON Schema → Python pydantic / TS 类型派生）
- CSV / JSON 数组导入与字段类型推断
- 数据模块 UI 外壳（Sidebar 模块入口 + DataPage + 视图切换器 + 列配置 + 渲染区 + Summary Bar）
- **直展型 4 视图**：Table / Card / List / Tree（含反向编辑）
- **聚合型 4 视图**：Bar / Pie / Line / Scatter（只读，Recharts 实现）
- **空间型 2 视图**：Spatial Plot / Scene Heatmap（自定义底图 + 坐标点 + 拖动改值，SVG + d3-scale 实现）
- 导出：CSV、ANDF JSON、ANDF Diff

**非范围**：
- 不做 BI 级复杂报表（交叉表 / 透视表）
- 不做实时流式数据图
- 首版不做 DCC 场景数据直连（仅 CSV / JSON 数组）
- 不做 Excel(.xlsx) 导入（首版）
- 不做自定义图表主题（沿用 Design Language Token）
- 不做数据持久化（仅内存 + 导出，关闭即丢；后续视需要再加）

## 可分发定义（DoD）

- [ ] `pnpm tauri build` 出可装 artifact
- [ ] 用户拖入一个 CSV 或粘贴 JSON 数组 → 选择视图 → 编辑数据 → 导出 CSV，端到端完整可用
- [ ] 10 种视图全部可切换并按字段槽位规则正确渲染
- [ ] Spatial Plot 可上传底图 + 拖动坐标点改 x/y 数据
- [ ] 直展型视图反向编辑产出 ANDF Diff 并能下载
- [ ] 所有 UI 走 `@artifex-nexus/ui` 现成组件，无硬编码视觉值
- [ ] UI 结构 spec accepted

## 出口条件

- [ ] STORY-0067 至 STORY-0074 全部 done
- [ ] [[../../specs/ui/data-view-structure]] accepted
- [ ] [[../../specs/andf-format]] accepted（由 STORY-0068 创建）
- [ ] 手动冒烟通过：CSV 与 JSON 各跑一次完整流程

## 设计要点

- **UI 先行铁律**：开工前必须先 accept UI 结构 spec（见 STORY-0067）
- **契约即源**：ANDF 必须先在 `packages/platform/contracts/schemas/andf.schema.json` 定义，再派生 Py / TS 类型
- **图表分层**：统计图走 Recharts；空间图走 SVG + d3-scale 自绘（拖动 / 形状 / 缩略图 Recharts 满足不了）
- **设计令牌**：所有视觉值读 CSS 变量，禁止硬编码颜色 / 字号 / 圆角
- **代码上限**：单文件 100–300 行黄金区，硬上限 500 行；视图组件单一职责

## 子节点（STORY 列表）

- [x] [[../done/STORY-0067-data-view-ui-structure]] — UI 结构 spec（前置）✅ 2026-06-03
- [x] [[../done/STORY-0068-andf-contract-and-import]] — ANDF 契约 + CSV/JSON 导入 ✅ 2026-06-03
- [x] [[../done/STORY-0069-data-module-shell]] — Sidebar 集成 + DataPage 主壳 + 列配置 + 视图切换 ✅ 2026-06-03
- [x] [[../done/STORY-0070-direct-views-and-edit]] — Table / Card / List / Tree + 反向编辑 + ANDF Diff ✅ 2026-06-04
- [x] [[../done/STORY-0071-aggregate-views-recharts]] — Bar / Pie / Line / Scatter（Recharts）✅ 2026-06-04
- [x] [[../done/STORY-0072-spatial-plot-base]] — Spatial Plot（底图 + 坐标点 + 拖动 + 形状/大小/颜色映射 + 缩略图）✅ 2026-06-04
- [x] [[../done/STORY-0073-scene-heatmap]] — Scene Heatmap（KDE 密度上色，复用 Spatial Plot 底座）✅ 2026-06-04
- [ ] [[STORY-0074-summary-and-e2e]] — Summary Bar 统计 + 导出 + E2E 烟雾 + tauri 出包

## 进展日志

- 2026-06-03 created（由 [[../../inbox/data-visualization-view]] triage 而来）
- 2026-06-03 STORY-0067 / STORY-0068 done（review 通过，迁 done/）
- 2026-06-03 STORY-0069 done（数据模块外壳 + 状态机 + 6 组件就位，P1 已记由 STORY-0070 修）
- 2026-06-04 STORY-0070 done（直展型 4 视图 + 反向编辑 + Diff 队列 + CSV 导出，review 修 P0×2 + P1×4 后通过）
- 2026-06-04 STORY-0071/0072/0073 进 review（Recharts 4 视图 + Spatial Plot 基座 + Scene Heatmap），同日 review fix（P0×2 hooks 顺序+KDE 依赖；P1×3 KDE 复用 dataToPixel + 选中态/SelectionPanel + tooltipFields UI），等待 ivan 复核切 done。
- 2026-06-04T21:22 STORY-0071/0072/0073 done — 复核通过，三个 story 同时迁 done/。EPIC-0010 7/8 done，仅余 STORY-0074（Summary Bar + E2E + tauri 出包）。
