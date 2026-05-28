---
tags: [inbox, epic, data, visualization, chart]
created: 2026-05-28
updated: 2026-05-28
status: draft
priority: P0
---

# 目标2：数据图形视图 — 可视化展示与反向编辑

> 定义统一数据格式，支持多种图形展示，并可通过图形视图反向编辑数据。
> **首期数据源：CSV 文件导入。**

## 核心设计原则

- **视图样式决定可交互的字段**：每种视图类型（Table/Card/List/Tree/Chart）有自己允许的字段集合
- **字段名可自定义**：用户可自由命名字段（CSV 表头映射 → 视图字段 label）
- **扩展字段**：视图类型支持就支持，不支持则固定为基本字段
- **字段类型**：能自定义就自定义（CSV 推断 → 用户可手动指定），不行就用固定类型集

## 首期数据源：CSV

```
// CSV 文件
name,triangles,materials,visible
SM_Rock_01,12400,2,true
SM_Tree_Oak,35800,4,false

// 导入后解析为 ANDF（自动推断字段类型）
```

CSV 导入流程：
1. 用户拖入/选择 CSV 文件
2. 自动解析表头 → 字段名（可自定义）
3. 自动推断类型：纯数字 → number，true/false → boolean，其他 → string
4. 用户确认/手动调整字段配置
5. 选择视图样式 → 渲染

## 1. 统一数据格式（ANDF — Artifex Nexus Data Format）

```
{
  "schema": "andf/v1",
  "meta": {
    "title": "场景资产列表",
    "source": "csv-import",
    "sourceFile": "scene_stats.csv",
    "created": "2026-05-28T12:00:00Z"
  },
  "columns": [
    { "key": "name",       "label": "资产名称", "type": "string" },
    { "key": "triangles",  "label": "三角面数", "type": "number" },
    { "key": "materials",  "label": "材质数",   "type": "number" },
    { "key": "visible",    "label": "可见",     "type": "boolean" }
  ],
  "rows": [
    { "name": "SM_Rock_01",  "triangles": 12400, "materials": 2, "visible": true },
    { "name": "SM_Tree_Oak", "triangles": 35800, "materials": 4, "visible": false }
  ],
  "view": {
    "type": "table",
    "sortBy": "triangles",
    "sortOrder": "desc"
  }
}
```

### 字段类型

| 类型 | CSV 推断规则 | 视图支持 |
|------|-------------|---------|
| `string` | 默认 | 全部视图 |
| `number` | 纯数字 | 全部视图 |
| `boolean` | true/false | Table, Card, List |
| `datetime` | ISO 8601 | Table, Card |
| `url` | http(s):// 开头 | Table, Card |

## 2. 图形展示样式

### 数据直接展示型（支持反向编辑）

每种视图样式有各自的字段槽位：

| 视图类型 | 必填字段 | 可选/扩展字段 | 反向编辑 |
|---------|---------|-------------|---------|
| **Table**（表格） | columns（列定义） | sortBy, filterBy | 单元格直接编辑 |
| **Card**（卡片） | title, subtitle | image, description, tags | 字段内联编辑 |
| **List**（列表） | primary, secondary | thumbnail, badge | 字段内联编辑 |
| **Tree**（树形） | label, children | expanded | 重命名、拖拽排序 |

### 统计聚合型（只读）

| 视图类型 | 必填字段 | 配置项 |
|---------|---------|--------|
| **Bar Chart** | xAxis (字段), yAxis (数值字段) | 方向、颜色 |
| **Pie Chart** | label (字段), value (数值字段) | 环形/饼图 |
| **Line Chart** | xAxis (字段), yAxis (数值字段) | 多线 |
| **Scatter** | x (数值字段), y (数值字段) | 气泡大小 |

### 扩展字段规则

- Table: 支持（任意数量的列）
- Card: 支持（title, subtitle, image, description, tags + 自定义扩展）
- List: 支持（primary, secondary + 最多 3 个自定义字段）
- Tree: 固定字段（label, children）
- Chart: 固定字段

## 3. 反向编辑数据

- 数据直接展示型视图：点击单元格/字段 → 进入编辑模式
- 变更以 ANDF diff 格式输出
- 支持导出为更新后的 CSV

```
// 反向编辑 diff
{
  "type": "andf-diff/v1",
  "changes": [
    { "op": "update", "row": 0, "column": "visible", "value": false },
    { "op": "update", "row": 2, "column": "materials", "value": 5 }
  ]
}
```

## 4. 基础统计功能

- 数值列：min / max / avg / sum / median
- 文本列：count / unique / top-N
- 布尔列：true 占比
- 统计结果以 Summary Bar 展示

## UI 布局

```
+----------------------------------------------+
|  [Table] [Card] [Bar] [Pie] [Line] [...]      |
+----------------------------------------------+
|  [列配置：name=资产名称(txt) triangles=面数(#)..] |
+----------------------------------------------+
|                                              |
|              图形渲染区                        |
|              （支持反向编辑的：                 |
|               点击 → 编辑模式）                 |
|                                              |
+----------------------------------------------+
|  统计: Min:100 | Max:50000 | Avg:12,340       |
+----------------------------------------------+
```

## 非目标

- 不做 BI 级复杂报表（交叉表、透视表）
- 不做实时流式数据图表（首版静态数据）
- 不做自定义图表主题（沿用 Design Language Token）
- 首版不做 DCC 场景数据直连（仅 CSV 导入）
