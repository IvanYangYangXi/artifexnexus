---
id: STORY-0070
kind: story
title: 直展型视图（Table / Card / List / Tree）+ 反向编辑
status: done
priority: P0
owner: "@ivan"
assignee: ai
estimate: 4d
created: 2026-06-03
updated: 2026-06-04T10:53
parent: "[[EPIC-0010-m10-data-view]]"
milestone: M10
related_adr: []
related_specs:
  - "[[../../specs/ui/data-view-structure]]"
related_packages:
  - "packages/apps/web"
tags: [story, data, view, edit, M10]
---

# STORY-0070 · 直展型视图 + 反向编辑

## 背景与目标

实现 4 个数据直接展示型视图，全部支持反向编辑：
变更先在内存 ANDF 上 in-place 更新，并产出 ANDF Diff（`type: "andf-diff/v1"`），
用户可导出 Diff JSON 或更新后的 CSV。

## 范围 / 非范围

- 范围：
  - `TableView`：列定义、排序、单元格点击进入编辑模式
  - `CardView`：title / subtitle / image / description / tags 槽位 + 字段内联编辑
  - `ListView`：primary / secondary / thumbnail / badge 槽位 + 字段内联编辑
  - `TreeView`：label / children 字段映射，重命名、拖拽排序
  - ANDF Diff 生成器：每次 update / move / delete 入队，可清空 / 导出
  - CSV 导出（基于当前内存 ANDF）
- 非范围：批量编辑、撤销/重做（首版不做）、行新增/删除（首版只做 update + tree move）

## 验收标准

- [x] 4 视图按 spec 槽位规则正确显示：Table（全列+排序）/ Card（title/subtitle/desc/tags/image+3扩展）/ List（primary/secondary/thumb/badge+3扩展）/ Tree（label+parentId+expanded）
- [x] Table 单元格双击进入编辑，Enter 提交，Esc 取消
- [x] Card / List 字段点击编辑提交后视图刷新（clickOutside + Enter+Esc）
- [x] Tree 拖拽排序产出 `op: "move"` 的 Diff（含子孙检测）
- [x] InlineFieldEditor 共享组件，按类型派发（string/number/boolean/datetime/url）
- [x] Diff 累计后可导出 JSON（顶栏「导出 Diff (N)」按钮）
- [x] CSV 导出与原始结构一致 + 反映所有修改
- [x] 视图组件单文件均 ≤ 300 行（TableView 147 / CardView 213 / ListView 188 / TreeView 268）

## 设计要点

- 槽位映射逻辑统一封装：`mapColumnsToSlots(view, columns)`
- 编辑组件统一封装 `<InlineFieldEditor type=...>`，按字段类型派发输入控件
- ANDF Diff 在 DataPage 顶层维护，视图通过回调上报变更
- Table 用 CSS grid + sticky header；不引入 react-table（用过的同事常吐槽 API 重）

## 进展日志

- 2026-06-03 created
- 2026-06-04 implemented：activeView 抬升 DataPageContext + editing 态 + Diff 队列 + CSV 导出 + 4 视图组件（TableView/CardView/ListView/TreeView）+ slot-mapping + InlineFieldEditor + typecheck 0 新增错误
- 2026-06-04 review 修复（P0×2 + P1×4）：
  - P0#1 TableView：sortedRows 携带 origIdx，commitEdit 用原始索引 + 行号显示原始 index
  - P0#2 TreeView：isDescendant 加 labelField 参数 + 用 String(rows[current]?.[labelField]) 比较 + 加 maxIterations 防御性循环上限
  - P1#3 InlineFieldEditor：统一外层 `<div ref={containerRef}>`，clickOutside 在所有类型分支生效
  - P1#4 InlineFieldEditor datetime：改走 draft state + Enter/blur 提交语义
  - P1#5 slot-mapping `expanded` candidates 去重
  - P1#6 SummaryBar 在 editing 态保持显示
- 2026-06-04 review 通过（P0 + P1 已修，typecheck 0 新增 + vitest 26/26），迁 done/
