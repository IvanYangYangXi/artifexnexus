---
id: STORY-0073
kind: story
title: Scene Heatmap（密度热力，复用 Spatial Plot 底座）
status: done
priority: P0
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
tags: [story, data, view, heatmap, M10]
---

# STORY-0073 · Scene Heatmap

## 背景与目标

在 Spatial Plot 基座之上叠加密度热力层：以坐标点位置为输入，
通过 KDE（核密度估计）或简化网格统计计算密度场，渲染半透明色块覆盖在底图上。
首版只读，不做反向编辑。

## 范围 / 非范围

- 范围：
  - 复用 STORY-0072 的底图 + 坐标系
  - 密度计算：网格化 + 高斯核（带宽参数 UI 可调）
  - 色阶：sequential 色阶（如 viridis / 定制单色），透明度可调
  - 图例：显示色阶 → 密度值
  - 仍保留 Spatial Plot 的点层（默认显示，可隐藏）
- 非范围：3D 热力、等高线渲染、按字段权重的密度（首版只按点频次）

## 验收标准

- [x] 切到 heatmap 视图后底图上出现密度色块
- [x] 调节带宽 / 透明度参数立即重绘
- [x] 图例正确显示密度范围
- [x] 点击切换"显示坐标点"开关有效
- [x] 数据量 5000 点以内渲染流畅（≥ 30 fps）
- [x] 主组件 ≤ 300 行

## 设计要点

- 用网格化简化方案：把底图分成 N×N 单元，统计落入每个单元的点数 → 高斯核平滑 → 上色
- 性能：N 默认 64，可上调到 256；高于此用 Canvas 绘色块（SVG 太多 rect 会卡）
- 颜色用 d3-scale-chromatic 或自定义 token-aware 色阶

## 进展日志

- 2026-06-03 created
- 2026-06-04 implemented — SceneHeatmapView.tsx (254行), shared/heatmap-kde.ts, shared/heatmap-colors.ts; DataPage 扩展 HeatmapEncoding 类型 + SET_HEATMAP_ENCODING action; ViewContainer case "scene-heatmap" 集成; 复用 Spatial Plot 底图+坐标转换
- 2026-06-04T20:55 review fix（P0+P1）：① `useMemo` 依赖数组补齐 `encoding.x.field` / `encoding.y.field` / `background.origin` / `background.unitPerPx`，切换坐标字段或底图坐标系后密度图立即重算；② `computeDensityGrid` 改为复用 `dataToPixel` 计算像素坐标后再网格化，与 SpatialPlot 坐标系完全一致（origin=center / unitPerPx 设置时不再错位）。SceneHeatmapView 263 行 / heatmap-kde 196 行，仍 ≤300。typecheck 0 新增错误。
- 2026-06-04T21:22 done — review 通过，迁 done/。
