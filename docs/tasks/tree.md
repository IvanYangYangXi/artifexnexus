---
tags: [tasks, views, tree, dataview]
created: 2026-05-04
---

# 任务层级树

> 按 EPIC → STORY → TASK 展开。视图依赖 frontmatter 的 `kind` 与 `parent`。
> 需要启用 **Dataview** 插件才能渲染。

入口：看板 [[board]] · 全量清单 [[README]] · 多维度视图 [[views]] · 路线图 [[../vision/roadmap]]

---

## 全部 EPIC

```dataview
TABLE WITHOUT ID
  file.link AS "EPIC",
  milestone AS "里程碑",
  status AS "状态",
  priority AS "优先级",
  estimate AS "预估",
  updated AS "更新"
FROM "docs/tasks"
WHERE kind = "epic" AND status != "archived"
SORT milestone ASC, updated DESC
```

---

## EPIC 下挂的 STORY

```dataview
TABLE WITHOUT ID
  rows.file.link AS "STORY"
FROM "docs/tasks"
WHERE kind = "story" AND status != "archived"
GROUP BY parent AS "EPIC"
SORT parent ASC
```

## STORY 下挂的 TASK

```dataview
TABLE WITHOUT ID
  rows.file.link AS "TASK"
FROM "docs/tasks"
WHERE kind = "task" AND status != "archived"
GROUP BY parent AS "父节点"
SORT parent ASC
```

---

## 按里程碑聚合

```dataview
TABLE WITHOUT ID
  rows.file.link AS "条目",
  length(rows) AS "数量"
FROM "docs/tasks"
WHERE milestone != null AND status != "archived"
GROUP BY milestone
SORT milestone ASC
```

## 孤儿（无 parent 又不是 EPIC）

> 正常应为空；出现即表示忘挂父节点。

```dataview
TABLE WITHOUT ID
  file.link AS "条目",
  kind AS "类型",
  status AS "状态"
FROM "docs/tasks"
WHERE kind != "epic" AND (parent = null OR parent = "") AND status != "archived"
```
