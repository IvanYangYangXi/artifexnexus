---
tags: [spec, data, andf, contract, M10]
created: 2026-06-03
status: accepted
---

# ANDF 数据格式规范 / Artifex Nexus Data Format

> 摘要：ANDF 是 M10 数据图形视图的内存数据模型，定义**单一信息源**（schema → TS + Python 双端派生）。
> 首版仅覆盖 CSV + JSON 数组导入场景，不做持久化、不做流式、不做嵌套/关系型数据。

## 1. 顶层结构

```jsonc
{
  "$schema": "https://artifexnexus.dev/schemas/andf.schema.json",
  "meta": {
    "source": "scene_positions.csv",
    "importedAt": "2026-06-03T19:00:00+08:00",
    "rowCount": 45,
    "columnCount": 6
  },
  "columns": [
    { "name": "id",        "type": "number",  "nullable": false, "visible": true },
    { "name": "label",     "type": "string",  "nullable": true,  "visible": true },
    { "name": "pos_x",     "type": "number",  "nullable": false, "visible": true },
    { "name": "pos_y",     "type": "number",  "nullable": false, "visible": true },
    { "name": "category",  "type": "string",  "nullable": true,  "visible": true },
    { "name": "created",   "type": "datetime","nullable": true,  "visible": false }
  ],
  "rows": [
    { "id": 0, "label": "Rock_01",  "pos_x": 12.3,  "pos_y": 45.6,  "category": "rock", "created": "2026-05-01T10:00:00" },
    { "id": 1, "label": "Tree_02",  "pos_x": 78.9,  "pos_y": 12.3,  "category": "tree", "created": "2026-05-01T11:00:00" }
  ],
  "view": {
    "type": "table",
    "encoding": { "columns": ["label", "pos_x", "pos_y", "category"] }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `$schema` | string | 是 | JSON Schema 引用 |
| `meta` | object | 是 | 元数据（参见 §2） |
| `columns` | array | 是 | 列定义列表（参见 §3） |
| `rows` | array | 是 | 数据行（对象数组，参见 §4） |
| `view` | object | 否 | 视图配置（首版可选） |

`rows` 采用对象数组格式：每行是一个 `Record<string, any>`，key 对应 `columns[].name`。

## 2. Meta 对象

```jsonc
{
  "source": "scene_positions.csv",            // 可选：原始文件名/来源标识
  "importedAt": "2026-06-03T19:00:00+08:00",  // 必填：ISO 8601 导入时间
  "rowCount": 45,                              // 必填：行数
  "columnCount": 6                             // 必填：列数
}
```

## 3. Column 定义

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `name` | string | 是 | — | 列名，在同一 ANDF 实例内唯一 |
| `type` | string | 是 | — | `"string"` \| `"number"` \| `"boolean"` \| `"datetime"` \| `"url"` |
| `nullable` | boolean | 否 | `false` | 是否允许 null/空值 |
| `visible` | boolean | 否 | `true` | 是否在视图中默认显示 |
| `index` | integer | 否 | 自动 | 列在原始数据源中的序号（0-based） |

**约束**：
- `name` 不得为空、不得含换行符
- `type` 值的枚举由 schema 强校验
- 预留 `index` 字段用于排序恢复，但不参与渲染逻辑

## 4. Rows 格式

`rows` 是 `Array<Record<string, any>>`，每行为一个 plain object，key 对应 `columns[].name`。

**类型一致性**：列的类型由 `columns[].type` 定义。解析器在导入时做类型推断，用户可在 `configuring` 阶段手动覆盖。若某行某字段的实际值与列类型不匹配（例如 number 列出现字符串 "abc"），该字段标记为 `null` 并在 Summary Bar 上累计警告计数。

**行标识**：首版不强制主键/id 列。无需 `id` 列即可工作；有 `id` 列时 Diff 操作可按 `rowId` 定位。

## 5. View 对象（扩充点）

首版最小定义，只包含当前选中视图类型和最基本的 encoding：

```jsonc
{
  "type": "table",               // 视图类型标识（table/card/list/tree/bar/pie/line/scatter/spatial-plot/heatmap）
  "encoding": { "columns": ["label", "pos_x", "pos_y"] }
}
```

详细 encoding 字段参见 `data-view-structure.md` §3.1–§3.3。ANDF 契约层面只规范 `type` 为必须字段，`encoding` 为可选 free-form object。

## 6. ANDF Diff 格式

反向编辑产生的变更通过 Diff 累积（参见 `data-view-structure.md` §4.2）：

```jsonc
{
  "type": "andf-diff/v1",
  "changes": [
    { "op": "update", "row": 0,  "column": "visible", "value": false },
    { "op": "move",   "rowId": "node-3", "toParent": "node-1", "toIndex": 0 }
  ]
}
```

Diff 本身不是 ANDF 的一部分——它是 DataPage 运行时状态。

## 7. 解析器入口（TypeScript）

解析器位于 `packages/apps/web/src/features/data/parser/`：

| 文件 | 职责 |
|------|------|
| `types.ts` | ANDF / Column / Meta / ParseResult 类型导出（从 contracts 包 re-export） |
| `csv-parser.ts` | CSV 文本 → ANDF，含表头解析 + 类型推断 + 错误处理 |
| `json-parser.ts` | JSON 数组文本 → ANDF，含 Schema 校验 + 列提取 + 类型推断 |
| `infer-type.ts` | 类型推断纯函数：`unknown → ColumnType`，顺序 boolean → number → datetime → url → string |

## 8. 类型推断规则

```
if (val === "true" || val === "false") → boolean
if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(val)) → number
if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)?)?$/.test(val) && !isNaN(Date.parse(val))) → datetime
if (/^https?:\/\//.test(val)) → url
→ string
```

推断顺序决定：优先匹配最具体的类型。同一列若所有非空值推断一致则为该类型；若冲突则退化为 `string`。

## 9. 错误码

| code | 含义 |
|------|------|
| `EMPTY_HEADER` | CSV 表头为空 |
| `UNEVEN_ROW` | 某行列数与表头不一致（跳过该行，解析继续） |
| `EMPTY_FILE` | 文件无有效数据 |
| `INVALID_JSON` | JSON 解析失败 |
| `NOT_ARRAY` | JSON 根不是数组 |
| `TYPE_CONFLICT` | 同列类型推断冲突（退化为 string） |

## 相关

- [[ui/data-view-structure]] — UI 结构 spec（视图槽位 / 状态机）
- [[../../tasks/backlog/STORY-0068-andf-contract-and-import]] — 本 STORY 卡
- `packages/platform/contracts/schemas/andf.schema.json` — 契约 Schema 源
