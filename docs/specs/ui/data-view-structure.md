---
tags: [spec, ui, data, visualization, M10]
created: 2026-06-03
updated: 2026-06-03
status: accepted
---

# 数据图形视图 — UI 结构设计 / Data View UI Structure

> 范围：本 spec 定义 M10「数据」模块的**信息架构 / 状态机 / 视图槽位规则 / 关键交互 /
> 与 AppShell 的对接点**。
> 不含具体视觉值（颜色 / 字号 / 圆角）— 后者沿用 [[design-language]]。
> 实现归 [[../../tasks/backlog/EPIC-0010-m10-data-view]]。
> 数据契约（ANDF schema）见 [[../andf-format]]（由 STORY-0068 创建）。

## 1. 信息架构

数据模块挂在现有 AppShell（参见 [[web-chat-structure]] 的 ABCD 区域命名）。
作为 Sidebar (B) 的一级模块入口，C 区渲染 DataPage 主壳。

```
数据模块（id="data"）
├── B 区 Sidebar：模块入口（图标 Database，紧邻"日历"）
└── C 区 DataPage
    ├── C1 顶部工具条（状态指示 + 导入按钮 + 导出菜单）
    ├── C2 左：列配置面板  ←─ 仅在已导入数据后出现
    ├── C3 中：视图切换器（10 视图 Tab）+ 视图渲染区
    └── C4 底：Summary Bar（数值统计 / 文本统计 / 布尔占比）
```

**D 区右侧面板**：本期不接入数据模块（保持 Skill/Tool 默认行为）。
后续 STORY 视需要再考虑接入"扩展字段详情"。

### 1.1 视图分组（10 视图）

| 分组 | 视图 | 反向编辑 | 实现技术（参考） |
|------|------|---------|----------------|
| **直展型** | Table | ✅ 单元格编辑 | 纯 React + CSS Grid |
| 直展型 | Card | ✅ 字段内联 | 纯 React |
| 直展型 | List | ✅ 字段内联 | 纯 React |
| 直展型 | Tree | ✅ 重命名 / 拖拽 | 纯 React |
| **聚合型** | Bar / Pie / Line / Scatter | ❌ 只读 | Recharts |
| **空间型** | Spatial Plot | ✅ 拖动点改 x/y | SVG + d3-scale |
| 空间型 | Scene Heatmap | ❌ 只读 | SVG + 网格 KDE |

## 2. 状态机

```
       ┌────────┐  drop CSV / paste JSON
       │ empty  │ ──────────────────────► importing
       └────────┘                              │
            ▲                                  │ parse OK
            │ clear                            ▼
            │                          ┌──────────────┐
            │                          │ configuring  │ ◄──┐
            │                          └──────────────┘    │
            │                                  │           │
            │                       confirm cols           │
            │                                  ▼           │ adjust
            │                          ┌──────────────┐    │
            │                          │  rendering   │────┘
            │                          └──────────────┘
            │                            │      ▲
            │                            │      │ exit edit
            │                       enter│      │
            │                            ▼      │
            │                          ┌──────────────┐
            └─── clear ────────────────│   editing    │
                                       └──────────────┘
                       (parse fail at any time)
                                  │
                                  ▼
                              ┌────────┐
                              │ error  │
                              └────────┘
```

| 状态 | 描述 | 允许动作 |
|------|------|---------|
| `empty` | 未导入数据 | 拖拽 / 选择文件 / 粘贴 JSON |
| `importing` | 解析中 | 等待，可取消 |
| `configuring` | 列类型确认 | 修改列类型 / 列名 / 启用，确认或返回 |
| `rendering` | 视图渲染中 | 切视图 / 改字段映射 / 进入 editing / 导出 |
| `editing` | 反向编辑中（仅直展型 + Spatial Plot） | 编辑单元格 / 拖动点，提交 / 取消 |
| `error` | 解析失败 | 查看错误详情，返回 empty |

## 2.1 导入态线框 / Import State Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│ C1:  [导入数据]                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                       │
│                    │                    │                       │
│                    │   📁  拖拽 CSV 或   │                       │
│                    │      JSON 文件到    │                       │
│                    │      此处           │                       │
│                    │      或点击选择     │                       │
│                    │                    │                       │
│                    │   ──── 或 ────      │                       │
│                    │                    │                       │
│                    │   📋  粘贴 JSON     │                       │
│                    │      数据           │                       │
│                    │                    │                       │
│                    └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ C4: 支持 CSV (.csv) 和 JSON 数组 (.json) 格式                   │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 视图槽位规则

每个视图有自己的字段槽位定义。槽位映射存储在 `ANDF.view.encoding`。
**视图样式决定可绑字段类型**；扩展字段视图支持就支持，不支持则忽略。

### 3.1 直展型槽位

| 视图 | 必填槽位 | 可选槽位 | 扩展字段 |
|------|---------|---------|---------|
| Table | columns（列定义自动派生自 ANDF.columns） | sortBy, filterBy | 全部列 |
| Card | title (string), subtitle (string) | image (url), description (string), tags (string\|array) | 最多 3 个自定义 |
| List | primary (string), secondary (string) | thumbnail (url), badge (string\|number) | 最多 3 个自定义 |
| Tree | label (string), children (string，作为父子关系字段) | expanded (boolean) | 不支持 |

### 3.2 聚合型槽位

| 视图 | 必填槽位 | 配置 |
|------|---------|------|
| Bar | xAxis (string\|number), yAxis (number) | direction (h/v), color |
| Pie | label (string), value (number) | innerRadius (donut/pie) |
| Line | xAxis (string\|number\|datetime), yAxis (number) | series (可多线) |
| Scatter | x (number), y (number) | size (number, optional), color (string\|number, optional) |

### 3.3 空间型槽位（核心新增）

| 视图 | 必填槽位 | 编码维度 |
|------|---------|---------|
| Spatial Plot | x (number), y (number), background (image dataURL) | color / shape / size / thumbnail (4 个独立维度，各自可绑字段) |
| Scene Heatmap | x (number), y (number), background (image dataURL) | bandwidth (number, default 24px), opacity (0-1), colorScale (string) |

**编码维度详解（Spatial Plot）**：

```
encoding: {
  background: { src: "data:image/png;base64...", origin: "top-left" | "center", unitPerPx?: number },
  x:    { field: "pos_x" },
  y:    { field: "pos_y" },
  color:     { field?: "category", scale: "ordinal" | "sequential", palette?: [...] },
  shape:     { field?: "type",     mapping?: { tree: "circle", rock: "square" } },
  size:      { field?: "weight",   range: [4, 24] },
  thumbnail: { field?: "thumb_url" },
  tooltipFields: ["name", "tris", "materials"]
}
```

**未绑定的编码维度行为**：
- `color`: 默认 `hsl(var(--primary))`
- `shape`: 默认 `circle`
- `size`: 默认 8px
- `thumbnail`: 不显示，回落到 shape

## 4. 反向编辑细则

### 4.1 通用规则

- 反向编辑的目标只有内存中的 ANDF 对象
- 每次修改既 in-place 更新 ANDF.rows，**也**入队一条 ANDF Diff
- Diff 队列在 DataPage 顶层 state 维护，可清空、可导出 JSON
- 关闭页面 / 切模块即丢失（首版无持久化）

### 4.2 Diff 操作集

```jsonc
{
  "type": "andf-diff/v1",
  "changes": [
    { "op": "update", "row": 0, "column": "visible", "value": false },
    { "op": "move",   "rowId": "node-3", "toParent": "node-1", "toIndex": 0 },
    { "op": "delete", "row": 5 }
  ]
}
```

首版只用到 `update`（Table/Card/List/Spatial Plot）与 `move`（Tree）。
`delete` schema 留位但首版不暴露 UI。

### 4.3 提交语义

| 视图 | 提交方式 | 取消方式 |
|------|---------|---------|
| Table 单元格 | Enter | Esc |
| Card / List 字段 | 失焦 + Enter | Esc 或点击外部 |
| Tree 拖拽 | drop 时立即 | 拖回原位 |
| Spatial Plot 点 | pointerup 时立即 | Esc 取消当前拖动（回到 pointerdown 起点） |

## 4.4 直展型视图态线框 / Direct View Wireframe

以 Table 视图为代表（rendering 状态），展示 C2 列配置面板 / C3 视图区 / C4 Summary Bar 的典型布局：

```
┌─────────────────────────────────────────────────────────────────┐
│ C1: 状态: 渲染中  [导入] [导出 CSV ▾] [导出 ANDF]               │
├──────────────┬──────────────────────────────────────────────────┤
│ C2 列配置    │ C3 [Table ●][Card][List][Tree][Bar][Pie][Line]...│
│              │ ┌──────────────────────────────────────────────┐ │
│  ☑ name     │ │ # │ name      │ pos_x │ pos_y │ type   │ wgt │ │
│  ☑ pos_x    │ │───┼───────────┼───────┼───────┼────────┼─────│ │
│  ☑ pos_y    │ │ 0 │ Rock_01   │  12.3 │  45.6 │ rock   │ 8.2 │ │
│  ☑ type     │ │ 1 │ Tree_02   │  78.9 │  12.3 │ tree   │ 3.1 │ │
│  ☑ weight   │ │ 2 │ Bush_03   │  56.7 │  89.0 │ bush   │ 1.5 │ │
│              │ │ 3 │ Gate_04   │  34.5 │  67.8 │ gate   │ 5.0 │ │
│  ─────      │ │───┼───────────┼───────┼───────┼────────┼─────│ │
│  列类型     │ │ 共 4 行，5 列，1 列隐藏                       │ │
│  name: str  │ └──────────────────────────────────────────────┘ │
│  pos_x: num │                                                   │
│  pos_y: num │                                                   │
│  type: str  │                                                   │
│  weight:num │                                                   │
├──────────────┴──────────────────────────────────────────────────┤
│ C4 Summary: weight min:1.5 max:8.2 avg:4.5 | name: 4 unique     │
└──────────────────────────────────────────────────────────────────┘
```

## 5. Spatial Plot 交互细节

### 5.1 线框（编辑态）

```
┌─────────────────────────────────────────────────────────────────┐
│ C1: 状态: 编辑中  [导出 CSV] [导出 ANDF] [导出 Diff (3)]          │
├──────────────┬──────────────────────────────────────────────────┤
│ C2 列配置    │ C3 视图切换 [Table][...][Spatial Plot ●][Heatmap]│
│  name (str)  │ ┌──────────────────────────────────────────────┐ │
│  pos_x (num) │ │ 编码: x[pos_x] y[pos_y] color[type]          │ │
│  pos_y (num) │ │       size[weight] thumb[--]                  │ │
│  type (str)  │ │ ┌──────────────────────────────────────────┐ │ │
│  weight (num)│ │ │                                          │ │ │
│              │ │ │      [底图]                              │ │ │
│              │ │ │        ●        ◆ (drag me)              │ │ │
│              │ │ │              ●                           │ │ │
│              │ │ │      ◆                                   │ │ │
│              │ │ │  ●         ●                             │ │ │
│              │ │ └──────────────────────────────────────────┘ │ │
│              │ │ tooltip: name=Rock_01 weight=12.4             │ │
│              │ └──────────────────────────────────────────────┘ │
├──────────────┴──────────────────────────────────────────────────┤
│ C4 Summary: weight min:1 max:50 avg:12.4 | type 5 unique         │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 拖动语义

1. `pointerdown` 命中点 → 进入 dragging，记录起点 (x0, y0) 与 row index
2. `pointermove` → 实时更新该点位置（仅视觉），不写 ANDF
3. `pointerup` → 反映射 (svgX, svgY) 回数据坐标 → in-place 更新 ANDF.rows[i] → 入队 update Diff
4. `Esc 按下` → 取消，回到 (x0, y0)，不入 Diff

### 5.3 坐标系映射

底图坐标 ↔ 数据坐标（用户选其一）：

- **像素模式（默认）**：x/y 字段单位即像素，原点在底图左上角
- **自定义单位模式**：用户在配置面板填 `unitPerPx`（每像素代表的单位数）+ 选择原点位置（左上 / 中心 / 左下）

### 5.4 性能

- 数据量 < 5000 点：SVG 全量渲染
- 5000–20000：开启视口剔除（仅渲染当前 viewBox 内的点）
- > 20000：弹提示"建议过滤数据"，首版不做 Canvas 兜底

## 6. Scene Heatmap 交互细节

### 6.1 渲染层

```
[底图] → [密度色块层（半透明）] → [可选：Spatial 点层]
```

### 6.2 计算流程

1. 把底图区域划分成 N×N 网格（N 默认 64）
2. 每个数据点累加到所属单元（按 (x,y) 字段反映射后）
3. 高斯核平滑（带宽 = bandwidth 像素）
4. 单元密度归一化 [0,1] → colorScale 着色

### 6.3 配置面板字段

- bandwidth: 8 / 16 / 24 / 48（默认 24）
- opacity: 0 / 0.3 / 0.5 / 0.7 / 1（默认 0.5）
- colorScale: viridis / inferno / blues（默认 viridis）
- showPoints: boolean（默认 true，叠加显示坐标点）

## 7. 与现有架构的对接点

| 对接位置 | 改动 |
|---------|------|
| `Sidebar.tsx` MODULES | 加 `{ id: "data", label: "数据", icon: Database }` |
| `Sidebar.tsx` ModuleId 类型 | 加 `\| "data"` |
| `ContentArea.tsx` | 加 `<div className={module === "data" ? "contents" : "hidden"}><DataPage /></div>` |
| `packages/apps/web/src/components/data/` | 新建目录，含 DataPage 等 |
| `packages/apps/web/src/features/data/` | 解析器 / Diff / 统计纯函数 |
| `packages/platform/contracts/schemas/` | 加 `andf.schema.json`（STORY-0068） |
| `RightPanel.tsx` | **不动**（首版数据模块不接入 D 区） |
| `Topbar.tsx` | **不动** |

## 8. 错误与边界

| 场景 | 处理 |
|------|------|
| CSV 表头空 | error 状态 + 文案"表头为空，请检查首行" |
| 行列数不齐 | 跳过该行 + warning 提示数量 |
| 全空文件 | empty 状态 + 文案"未发现可解析的数据" |
| 类型推断冲突（同列既有 number 又有非 number） | 退化为 string，列配置面板高亮提示 |
| 视图必填槽位未绑定 | 视图区显示空态提示"请绑定 X 字段" |
| Spatial Plot 无底图 | 视图区显示上传引导（虚线框 + 上传图标） |
| Heatmap 无 x/y 字段 | 视图区显示空态 + 引导用户绑定 |

## 9. 非目标（重申）

- 不做数据持久化（关闭即丢）
- 不做 Excel(.xlsx) 解析
- 不做 BI 级交叉表 / 透视表
- 不做实时流式数据
- 不做自定义图表主题
- 不做 DCC 场景数据直连（首版仅 CSV / JSON）

## 相关

- [[../../tasks/backlog/EPIC-0010-m10-data-view]] — EPIC 卡
- [[../../tasks/backlog/STORY-0067-data-view-ui-structure]] — 本 spec 所属 STORY
- [[../../inbox/data-visualization-view]] — 原始构想
- [[design-language]] — 设计令牌
- [[web-chat-structure]] — AppShell 区域命名
- [[../andf-format]] — ANDF 数据契约（待 STORY-0068 创建）
