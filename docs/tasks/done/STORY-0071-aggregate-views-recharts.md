---
id: STORY-0071
kind: story
title: 聚合型视图 Bar / Pie / Line / Scatter（Recharts）
status: done
priority: P1
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-06-03
updated: 2026-06-04T21:22
parent: "[[EPIC-0010-m10-data-view]]"
milestone: M10
related_adr: []
related_specs:
  - "[[../../specs/ui/data-view-structure]]"
related_packages:
  - "packages/apps/web"
tags: [story, data, chart, recharts, M10]
---

# STORY-0071 · 聚合型视图（Recharts）

## 背景与目标

只读统计图。基于 Recharts 实现 Bar / Pie / Line / Scatter 4 类，
所有视觉值读 CSS 变量，与 design-language 完全对接。

## 范围 / 非范围

- 范围：
  - 引入 `recharts` 依赖（`packages/apps/web` 局部）
  - 4 视图组件：`BarView` / `PieView` / `LineView` / `ScatterView`
  - 每视图配套字段映射 UI（xAxis / yAxis / category / value 等）
  - tooltip / legend 沿用 Recharts 内置，样式覆盖到 token
  - 空数据 / 字段类型不匹配的友好提示
- 非范围：动画自定义、双 Y 轴、堆叠柱、自定义 brush

## 验收标准

- [x] 4 视图能正确渲染 ANDF.rows 中的数据（Bar/Pie/Line/Scatter）
- [x] 字段映射 UI（FieldMapping 横条）提供下拉选择数值/分类字段，Line 支持多选 yAxis
- [x] tooltip / legend 颜色读 CSS 变量（chart-colors.ts 8 色板从 --primary / --success / --warning / --info 派生）
- [x] 切换字段映射后图表立即重绘（encoding 入 DataPageContext Reducer，变更触发 dispatch）
- [x] 单文件 ≤ 300 行（BarView 122 / PieView 111 / LineView 137 / ScatterView 156 / FieldMapping 113 / chart-colors 67）
- [x] web typecheck 0 新增错误（仅 2 预存）

## 设计要点

- Recharts 颜色直接读 `hsl(var(--primary))` / `hsl(var(--muted-foreground))`
- 通用容器 `<ResponsiveContainer>` 包一层
- 字段映射状态存入 ANDF.view.encoding，便于持久化 / 导出（虽然首版不持久化，但格式留好）

## 进展日志

- 2026-06-03 created
- 2026-06-04 implemented：recharts v3.8.1 引入 + chart-colors 8 色板 + slot-mapping 聚合型槽位（bar/pie/line/scatter）+ DataPage encodings 状态扩展 + FieldMapping 横条组件 + 4 图表视图组件 + ViewContainer 派发 + typecheck 0 新增错误
- 2026-06-04T20:55 review fix（P0）：4 视图（Bar/Pie/Line/Scatter）的 `useMemo` 全部从 early return 之后上移到 hooks 区，修复 rules-of-hooks 违例（切换字段映射不再触发 "Rendered more hooks" 报错）。typecheck 仍 0 新增错误。
- 2026-06-04T21:22 done — review 通过，迁 done/。
