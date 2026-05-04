---
type: handoff-index
exclude_from_kanban: true
exclude_from_dataview: true
---

# 跨对话交接归档 / Handoff Archive

本目录存放**对话切换时**的上下文交接快照。

## 用途
- 长对话被截断 / 主动开新窗口时，留一份"接得上"的启动描述
- 给新加入的协作者（人 / AI）一个 3 分钟入门通道
- 不参与 SDD 状态机（不会出现在 Kanban / Dataview 任务列表中）

## 命名约定
`YYYY-MM-DD-<动作>-<对象>.md`

- 动作：`resume` / `pause` / `pivot` / `kickoff`
- 对象：任务 ID 或里程碑名

示例：
- `2026-05-03-resume-task-0001.md`
- `2026-05-10-pivot-m2-to-m3.md`

## frontmatter 必填
```yaml
---
type: handoff             # 固定
exclude_from_kanban: true # Kanban 插件忽略
exclude_from_dataview: true
created: YYYY-MM-DD
related_tasks: [TASK-XXXX]
---
```

## 注意
- 一份 handoff = 一次对话切换，**不要追加修改**，需要新版本就新建文件
- handoff 是只读快照，真相仍以 `docs/specs/` 与对应任务卡为准
