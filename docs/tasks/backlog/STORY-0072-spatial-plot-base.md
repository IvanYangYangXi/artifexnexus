---
id: STORY-0072
kind: story
title: 空间视图 Spatial Plot（底图 + 坐标点 + 拖动 + 形状/缩略图）
status: backlog
priority: P0
owner: "@ivan"
assignee: ai
estimate: 5d
created: 2026-06-03
updated: 2026-06-03
parent: "[[EPIC-0010-m10-data-view]]"
milestone: M10
related_adr: []
related_specs:
  - "[[../../specs/ui/data-view-structure]]"
related_packages:
  - "packages/apps/web"
tags: [story, data, view, spatial, svg, M10]
---

# STORY-0072 · Spatial Plot 空间可视化基座

## 背景与目标

实现 Spatial Plot：用户上传一张底图（场景俯拍图等），数据行通过 (x, y) 字段
在底图上显示坐标点；点的颜色 / 形状 / 大小可按字段映射；缩略图字段可作为点的图像；
拖动坐标点反向更新 ANDF.rows 的 x/y 字段，产出 ANDF Diff。

本 STORY 是空间型视图基座，STORY-0073 Heatmap 在此之上加密度上色层。

## 范围 / 非范围

- 范围：
  - 底图上传（PNG / JPG，转 dataURL，存内存）
  - 坐标系映射：用户指定底图原点与单位长度，或直接像素坐标
  - 渲染层：SVG `<image>` 底图 + 坐标点层
  - 点编码：
    - color = 字段映射（数值 → 渐变 / 类别 → 调色板）
    - shape = 字段映射（圆 / 方 / 三角 / 自定义图像）
    - size = 字段映射（数值线性映射）
    - thumbnail = 字段映射（字段值为 URL / dataURL → `<image>` 替代点）
  - 交互：
    - 悬停显示 tooltip（指定扩展字段）
    - 拖动点改 ANDF.rows[i].x / .y → 产出 update Diff
    - 点击点选中 → 右侧显示扩展字段
  - 字段映射 UI：每个编码维度一个下拉
- 非范围：缩放 / 平移（首版不做，留 zoom STORY 后续）、多图层叠加、空间索引（首版数据量预计 < 5000 点）

## 验收标准

- [ ] 上传底图后能正确显示
- [ ] x/y 字段选定后坐标点正确分布
- [ ] 4 类编码维度（color/shape/size/thumbnail）全部可工作
- [ ] 拖动点能改 ANDF 数据并产出 Diff
- [ ] tooltip 与点击选中两种交互可用
- [ ] 视觉值全走 token，无硬编码颜色 / 字号
- [ ] 主组件 ≤ 300 行；编码工具函数拆出独立文件

## 设计要点

- 用 SVG，不用 Canvas：缩略图复用、命中检测、CSS Token 应用都更简单
- d3-scale 提供 `scaleLinear / scaleOrdinal / scaleSequential`
- 拖动用原生 PointerEvent + react state，不引入 d3-drag（避免与 React 数据流冲突）
- 形状用 SVG path，缩略图用 `<image href clipPath>`
- 编码字段保存在 ANDF.view.encoding，结构由 spec 与 STORY-0067 定义

## 进展日志

- 2026-06-03 created
