---
tags: [dev, task-management, vibe-coding]
created: 2026-05-03
status: accepted
---

# Vibe Coding 任务管理方案

> 面向：个人 / 小团队 + AI 助手共同协作。载体：Obsidian Vault `docs/tasks/`。

## 1. 设计目标

- **AI 可读、人可编**：每个任务一份 md，frontmatter 机读，正文人读。
- **全链路可追溯**：任务 ↔ ADR ↔ spec ↔ 代码包，互相 `[[wiki-link]]`。
- **零工具绑架**：不依赖特定 Obsidian 插件也能读；装上 Kanban / Tasks 插件只是更好看。

## 2. 目录结构

```
docs/tasks/
├── README.md                # 索引 + 规则（本文件的入口）
├── board.md                 # Kanban 视图（Obsidian Kanban 插件）
├── backlog/                 # 未排期
├── ready/                   # 已对齐设计，随时可做
├── in-progress/             # 进行中
├── review/                  # 已完成，等审校
├── done/                    # 已合并
└── archived/                # 超过 30 天或作废
```

任务文件命名：`TASK-NNNN-<slug>.md`，编号递增 4 位，跨目录不复用。

## 3. 任务卡片 frontmatter

```yaml
---
id: TASK-0001
title: OpenClaw 包壳改造
status: in-progress   # backlog | ready | in-progress | review | done | archived
priority: P1          # P0 阻塞 | P1 高 | P2 中 | P3 低
owner: "@ivan"
assignee: ai          # human | ai | pair
estimate: 1d          # 粗粒度工时
created: 2026-05-03
updated: 2026-05-03
related_adr: [0002]
related_specs: ["[[openclaw-wrapper]]"]
related_packages: ["packages/adapters/openclaw"]
tags: [task, openclaw, installer]
---
```

## 4. 卡片正文模板

见 `docs/templates/task.md`，必有章节：

1. **背景与目标**（≤ 200 字）
2. **验收标准**（Checklist，AI 可自检）
3. **设计要点**（链到 spec / ADR）
4. **子任务**（可选，复杂任务拆）
5. **进展日志**（日期倒序，每条 1 行）

## 5. 状态机

```
backlog ─► ready ─► in-progress ─► review ─► done ─► archived
   ▲                                 │
   └──────── 打回 ──────────────────┘
```

**迁移动作 = 改 frontmatter.status + 移动文件到对应子目录**。两者必须同步。

## 6. AI 执行规则（与 `.ai/rules/30-agent-behavior.md` 对齐）

1. AI 认领任务时：先把卡片状态从 `ready` 迁到 `in-progress`，并在"进展日志"写一条。
2. 验收标准未全勾选**不得**自行迁到 `review`。
3. 任何阻塞/追问 → 追加到卡片"进展日志"；重大设计分歧 → 另起 ADR 并回链。
4. 合并后由**人类**迁到 `done`。

## 7. 视图体系（三入口）

Obsidian **Kanban 插件**识别 markdown 列表为列；Dataview 直接读 frontmatter。

| 入口 | 解决什么问题 | 文件 |
|------|------------|------|
| **Kanban** | "现在整体什么状态" — 看墙、拖卡 | `docs/tasks/board.md` |
| **Dataview 全量清单** | "全部任务一张表，按状态/优先级排序" | `docs/tasks/README.md` 顶部查询块 |
| **Dataview 多维度视图** | "我手上的 / P0 / 阻塞 / 按 owner / 按 ADR …" | `docs/tasks/views.md` |

三者**读同一份 frontmatter**，只有 Kanban 需要在 `board.md` 里手工同步状态列；
Dataview 视图改 frontmatter 自动反映，**无需维护**。

### Kanban 字段显示（一次性配置）

`board.md` 视图右上角 `⋯ → Open board settings → Linked Page Metadata`，
Add：`status / priority / owner / assignee / estimate`。本仓的 board.md 已保留该配置。

### 7.1 Kanban 列与 frontmatter 对照

```
## Backlog        ↔  frontmatter.status: backlog        目录: docs/tasks/backlog/
## Ready          ↔  frontmatter.status: ready          目录: docs/tasks/ready/
## In Progress    ↔  frontmatter.status: in-progress    目录: docs/tasks/in-progress/
## Review         ↔  frontmatter.status: review         目录: docs/tasks/review/
## Done           ↔  frontmatter.status: done           目录: docs/tasks/done/
```

自动化：每周人肉跑一次"把 frontmatter.status = done 且 updated > 30d 的卡片移到 archived"。不值得自动化，成本低。

## 8. 交叉引用强约束

- 新任务 → **追加到 `docs/tasks/README.md` 索引表**
- 任务引用的 spec / ADR / 包 → 全部用 `[[wiki-link]]`
- spec/ADR 也要反向链回其对应 tasks

## 9. 不做什么

- 不做复杂甘特图
- 不做工时精算
- 不把任务同步到外部 Issue 追踪（保持单一信息源）
- 不写长任务描述（> 500 字必须拆）

## 相关

- [[../templates/task]]
- [[../../.ai/rules/30-agent-behavior]]
- [[../../.ai/rules/20-docs-workflow]]
