# M10 Data View — E2E Manual Checklist

> EPIC-0010 STORY-0074 | 最后更新：2026-06-04T22:30
> 按顺序执行，每项通过后勾选 `[x]`
> ✅ 2026-06-04 ivan + ai 手动跑通全部 30 项

---

## 1. 导入数据

- [x] 拖拽 CSV 文件到 DataPage 空态区 → 进入 configuring 态
- [x] 粘贴 JSON 数组（Ctrl+V） → 自动识别 columns + rows
- [x] 导入报错文件（非 CSV/JSON） → 显示错误消息 + "返回"按钮
- [x] 错误态点击"返回" → 回到 empty 态

## 2. 列配置（configuring 态）

- [x] 导入后左侧 ColumnConfig 面板自动列出所有列（name + type 标签）
- [x] 已选/未选列数量正确
- [x] 点击"确认"按钮 → 进入 rendering 态（默认 table 视图）

## 3. 直接视图切换

- [x] 切换到 Table 视图 → 表头 + 数据行 + sticky header
- [x] 切换到 Card 视图 → 卡片布局展示
- [x] 切换到 List 视图 → 列表布局
- [x] 切换到 Tree 视图 → 展开/折叠（若有 parentId 数据）

## 4. 聚合视图

- [x] 切换到 Bar → 选择 x/y → 渲染柱状图
- [x] 切换到 Pie → 渲染饼图 + 百分比标签
- [x] 切换到 Line → 渲染折线图（多系列若选中多列）
- [x] 切换到 Scatter → 渲染散点图

## 5. 空间视图

- [x] 切换到 Spatial Plot → 上传底图（PNG） → 绑定 x/y 字段 → 坐标点出现
- [x] 拖动坐标点 → Diff 计数 +1（x:+1, y:+1）
- [x] 切换到 Scene Heatmap → 上传底图 → 热力色块出现
- [x] 调节 bandwidth/opacity/colorScale 参数 → 热力图即时更新

## 6. 编辑与 Diff

- [x] Table 视图中双击单元格 → InlineFieldEditor 出现
- [x] 修改值后确认 → Diff 计数 +1，TopBar "导出 Diff (N)" 可见
- [x] 导出 Diff JSON → 文件内容格式为 `{ type: "andf-diff/v1", changes: [...] }`
- [x] ANDF 数据中对应行的值已更新

## 7. 导出

- [x] 点击"导出 ANDF" → 下载 `data.andf.json`，内容 = columns + rows + meta
- [x] 点击"导出 CSV" → 下载 `export.csv`，UTF-8 表格可打开
- [x] 点击"导出 Diff (N)" → 下载 `andf-diff.json`

## 8. SummaryBar

- [x] rendering / editing 态底部显示 SummaryBar
- [x] 显示 "N 行 M 列"
- [x] 显示前 5 列的统计摘要（数值列 min/max/avg、文本列 unique、布尔列 true%）
- [x] 编辑态底部右侧显示 "未保存 N 条修改"

## 9. 性能

- [x] 导入 5000 行 CSV → 解析完成（< 3s） → 视图渲染流畅
- [x] 热力图 5000 点 N=64 → 色块渲染流畅（无卡顿）
- [x] 空间图 5000 点 → 坐标点渲染流畅

## 10. 边界情况

- [x] 空 CSV（仅 header）→ 导入成功，0 行
- [x] 无 header CSV → 自动生成 col_0, col_1, ...
- [x] 超大文件（> 5MB）→ ImportDropzone 拒绝，显示提示
- [x] 字段映射未完成时切换到聚合视图 → 空态提示

---

> 通过条件：全部 项通过则 M10 Data View E2E 通过。
