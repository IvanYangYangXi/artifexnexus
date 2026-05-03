---
tags: [tasks, views, dataview]
created: 2026-05-03
---

# 任务多维度视图

> 本页所有视图由 Dataview 自动生成，**不要手工编辑表格**。
> 改任务 frontmatter 即可影响这里的呈现。需要启用 **Dataview** 插件。

入口：全量清单 [[README]] · 看板 [[board]]

---

## 我手上的（assignee = ai 或 owner = @ivan）

> 想换查询条件，把下面 `WHERE` 那行改一下即可。

```dataview
TABLE WITHOUT ID
  file.link AS "Task",
  status AS "状态",
  priority AS "优先级",
  estimate AS "工时",
  updated AS "更新"
FROM "docs/tasks"
WHERE id != null
  AND status != "archived" AND status != "done"
  AND (assignee = "ai" OR contains(string(owner), "@ivan"))
SORT priority ASC, updated DESC
```

---

## 进行中（in-progress）

```dataview
TABLE WITHOUT ID
  file.link AS "Task",
  priority AS "优先级",
  owner AS "负责人",
  estimate AS "工时",
  updated AS "更新"
FROM "docs/tasks"
WHERE status = "in-progress"
SORT priority ASC, updated DESC
```

## 待审校（review）

```dataview
TABLE WITHOUT ID
  file.link AS "Task",
  priority AS "优先级",
  owner AS "负责人",
  updated AS "更新"
FROM "docs/tasks"
WHERE status = "review"
SORT updated DESC
```

---

## 按优先级分组

```dataview
TABLE WITHOUT ID
  rows.file.link AS "Tasks",
  length(rows) AS "数量"
FROM "docs/tasks"
WHERE id != null AND status != "done" AND status != "archived"
GROUP BY priority
SORT priority ASC
```

## 按 owner 分组（看每个人手上有什么）

```dataview
TABLE WITHOUT ID
  rows.file.link AS "Tasks",
  length(rows) AS "数量"
FROM "docs/tasks"
WHERE id != null AND status != "done" AND status != "archived"
GROUP BY owner
SORT length(rows) DESC
```

---

## 按 tag 分组（典型 tag：openclaw / installer / skill / dcc / docs …）

```dataview
TABLE WITHOUT ID
  rows.file.link AS "Tasks",
  length(rows) AS "数量"
FROM "docs/tasks"
FLATTEN tags AS t
WHERE id != null AND status != "done" AND status != "archived"
GROUP BY t AS "Tag"
SORT length(rows) DESC
```

---

## 阻塞 / 风险（status = blocked 或 priority = P0）

> 我们暂未引入 `blocked` 状态，需要时直接把 frontmatter.status 改成 `blocked` 即可，本表会自动收。

```dataview
TABLE WITHOUT ID
  file.link AS "Task",
  status AS "状态",
  priority AS "优先级",
  owner AS "负责人",
  updated AS "更新"
FROM "docs/tasks"
WHERE id != null
  AND (status = "blocked" OR priority = "P0")
SORT updated DESC
```

---

## 最近 7 天有更新的

```dataview
TABLE WITHOUT ID
  file.link AS "Task",
  status AS "状态",
  priority AS "优先级",
  updated AS "更新"
FROM "docs/tasks"
WHERE id != null AND updated >= date(today) - dur(7 days)
SORT updated DESC
```

---

## 关联到包 / 模块（按 related_packages 维度）

```dataview
TABLE WITHOUT ID
  rows.file.link AS "Tasks"
FROM "docs/tasks"
FLATTEN related_packages AS pkg
WHERE id != null AND status != "done" AND status != "archived"
GROUP BY pkg AS "Package"
SORT length(rows) DESC
```

---

## 按 ADR 维度（看每个决策牵动哪些任务）

```dataview
TABLE WITHOUT ID
  rows.file.link AS "Tasks"
FROM "docs/tasks"
FLATTEN related_adr AS adr
WHERE id != null AND adr != null
GROUP BY adr AS "ADR"
SORT adr ASC
```
