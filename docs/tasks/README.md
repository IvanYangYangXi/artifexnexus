---
tags: [tasks, index]
created: 2026-05-03
---

# 任务索引

任务卡片管理规则：[[../development/task-management]] · SDD 流程：[[../development/sdd-workflow]]

## 视图入口

- 路线图（阶段纲领）：[[../vision/roadmap]]
- 看板（拖拽，状态总览）：[[board]]
- 层级树（EPIC → STORY → TASK）：[[tree]]
- 多维度专项视图（按 owner / priority / DCC / 阻塞）：[[views]]

## 全量清单（自动，由 Dataview 生成）

> 直接读取每张任务卡 frontmatter；新建/移动任务后**无需手工维护本表**。
> 如需在 Obsidian 看到本表，需启用 **Dataview** 插件。

```dataview
TABLE WITHOUT ID
  file.link AS "Task",
  status AS "状态",
  priority AS "优先级",
  owner AS "负责人",
  assignee AS "执行",
  estimate AS "工时",
  updated AS "更新"
FROM "docs/tasks"
WHERE id != null AND status != "archived"
SORT
  choice(status = "in-progress", 0,
  choice(status = "review", 1,
  choice(status = "ready", 2,
  choice(status = "backlog", 3,
  choice(status = "done", 4, 5))))) ASC,
  priority ASC,
  updated DESC
```

## 数量统计

```dataview
TABLE WITHOUT ID
  status AS "状态",
  length(rows) AS "数量"
FROM "docs/tasks"
WHERE id != null
GROUP BY status
SORT
  choice(status = "in-progress", 0,
  choice(status = "review", 1,
  choice(status = "ready", 2,
  choice(status = "backlog", 3,
  choice(status = "done", 4, 5))))) ASC
```

## 使用规则（提醒）

1. 新任务：复制 [[../templates/task]]，编号递增，先进 `backlog/` 或 `ready/`。
2. 状态迁移必须**同时改 frontmatter.status 与文件所在目录**；
   `board.md` 由 Agent / 你手工同步（详见 [[../development/sdd-workflow]] §3）。
3. 本页"全量清单"由 Dataview 自动生成；不要手工编辑表格。

## 子目录

- `backlog/` — 未排期
- `ready/` — 已对齐设计，随时可做
- `in-progress/` — 进行中
- `review/` — 已完成，等审校
- `done/` — 已合并
- `archived/` — 超过 30 天或作废
