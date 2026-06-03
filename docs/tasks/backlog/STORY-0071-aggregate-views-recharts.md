---
id: STORY-0071
kind: story
title: 聚合型视图 Bar / Pie / Line / Scatter（Recharts）
status: backlog
priority: P1
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-06-03
updated: 2026-06-03
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

- [ ] 4 视图能正确渲染 ANDF.rows 中的数据
- [ ] 字段映射 UI 提供下拉选择数值字段 / 分类字段
- [ ] tooltip / legend 颜色与 design-language 一致
- [ ] 切换字段映射后图表立即重绘
- [ ] 单文件 ≤ 300 行
- [ ] bundle 体积增量 ≤ 120 KB gzip（控制 tree-shaking）

## 设计要点

- Recharts 颜色直接读 `hsl(var(--primary))` / `hsl(var(--muted-foreground))`
- 通用容器 `<ResponsiveContainer>` 包一层
- 字段映射状态存入 ANDF.view.encoding，便于持久化 / 导出（虽然首版不持久化，但格式留好）

## 进展日志

- 2026-06-03 created
