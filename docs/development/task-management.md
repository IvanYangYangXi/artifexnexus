---
tags: [dev, task-management, vibe-coding]
created: 2026-05-03
status: accepted
---

# Vibe Coding 任务管理方案

> 面向：个人 / 小团队 + AI 助手共同协作。载体：Obsidian Vault `docs/tasks/`。
>
> ⚠️ **编辑保护**：本文件曾被 Obsidian 视图回写覆盖过。修改时请使用纯文本编辑器或确认 Obsidian 已加载到最新版本，避免丢失多级任务/UI 先行等约束。

## 1. 设计目标

- **AI 可读、人可编**：每个任务一份 md，frontmatter 机读，正文人读。
- **全链路可追溯**：任务 ↔ ADR ↔ spec ↔ 代码包，互相 `[[wiki-link]]`。
- **零工具绑架**：不依赖特定 Obsidian 插件也能读；装上 Kanban / Tasks 插件只是更好看。
- **支持多级层级**：EPIC → STORY → TASK 三级，靠 frontmatter 的 `kind` + `parent` 体现，不靠目录深度。

## 2. 目录结构

```
docs/tasks/
├── README.md                # 索引 + 规则（本文件的入口）
├── board.md                 # Kanban 视图（Obsidian Kanban 插件）
├── tree.md                  # 层级树视图（Dataview 自动生成）
├── views.md                 # 多维度视图
├── backlog/                 # 未排期
├── ready/                   # 已对齐设计，随时可做
├── in-progress/             # 进行中
├── review/                  # 已完成，等审校
├── done/                    # 已合并
└── archived/                # 超过 30 天或作废
```

文件命名（**三级共用同一生命周期目录**，靠前缀区分）：

- EPIC：`EPIC-NNNN-<slug>.md`
- STORY：`STORY-NNNN-<slug>.md`
- TASK：`TASK-NNNN-<slug>.md`

三者使用**各自独立**的 4 位编号空间，但**共用 `docs/tasks/<status>/`** 子目录。

## 3. 卡片 frontmatter

通用字段：

```yaml
---
id: TASK-0001              # 或 EPIC-0000 / STORY-0001
kind: task                 # epic | story | task
title: OpenClaw 包壳改造
status: in-progress        # backlog | ready | in-progress | review | done | archived
priority: P1               # P0 阻塞 | P1 高 | P2 中 | P3 低
owner: "@ivan"
assignee: ai               # human | ai | pair
estimate: 1d               # 粗粒度工时（EPIC 用周 / 周+）
created: 2026-05-03
updated: 2026-05-03
parent: "[[EPIC-0000-m0-installer-wizard]]"   # 直接父节点；EPIC 留空或指向 roadmap
children:                                      # 直接子节点（写作便利，落盘即可）
  - "[[STORY-0001-xxx]]"
milestone: M0              # 所属里程碑（M0..M9）
related_adr: [0002]
related_specs: ["[[openclaw-wrapper]]"]
related_packages: ["packages/adapters/openclaw"]
tags: [task, openclaw, installer]
---
```

层级规则：

- EPIC 的 `parent` 必须留空（或指向 `[[../../vision/roadmap]]`）。
- STORY 的 `parent` 必须指向一张 EPIC。
- TASK 的 `parent` 指向一张 STORY；**若 EPIC 足够简单没有拆 STORY，允许 TASK 直接挂到 EPIC**。
- `children` 字段是冗余信息，写作 / 阅读便利；Dataview 视图以 `parent` 为准反向聚合，**有出入以 `parent` 为准**。

## 4. 卡片正文模板

- TASK：`docs/templates/task.md`
- STORY：`docs/templates/story.md`
- EPIC：`docs/templates/epic.md`

三者必须包含的章节：

| 章节 | EPIC | STORY | TASK |
|---|---|---|---|
| 背景与目标 | ✓ | ✓ | ✓ |
| 范围 / 非范围 | ✓ | ✓ | - |
| 可分发定义 / DoD | ✓ | - | - |
| 验收标准（可自检 checklist） | - | ✓ | ✓ |
| 设计要点 / 关联 spec | ✓ | ✓ | ✓ |
| 子节点列表 | ✓（STORY 列表） | ✓（TASK 列表） | - |
| 进展日志 | ✓ | ✓ | ✓ |

## 5. 状态机

```
backlog ─► ready ─► in-progress ─► review ─► done ─► archived
   ▲                                 │
   └──────── 打回 ──────────────────┘
```

**迁移动作 = 改 frontmatter.status + 移动文件到对应子目录 + 改 board.md 列位**。三者必须同步。

## 6. AI 执行规则（与 `.ai/rules/30-agent-behavior.md` 对齐）

1. AI 认领任务时：先把卡片状态从 `ready` 迁到 `in-progress`，并在"进展日志"写一条。
2. 验收标准未全勾选**不得**自行迁到 `review`。
3. 任何阻塞 / 追问 → 追加到卡片"进展日志"；重大设计分歧 → 另起 ADR 并回链。
4. 合并后由**人类**迁到 `done`。
5. 涉及 GUI 的任务，先按 §9 出 UI 结构 spec。

## 7. 视图体系（四入口）

Obsidian **Kanban 插件**识别 markdown 列表为列；Dataview 直接读 frontmatter。

| 入口 | 解决什么问题 | 文件 |
|------|------------|------|
| **Kanban** | "现在整体什么状态" — 看墙、拖卡 | `docs/tasks/board.md` |
| **层级树** | "按 EPIC → STORY → TASK 看全局脉络" | `docs/tasks/tree.md` |
| **Dataview 全量清单** | "全部条目一张表，按状态/优先级排序" | `docs/tasks/README.md` |
| **Dataview 多维度视图** | "我手上的 / P0 / 阻塞 / 按 owner / 按里程碑 …" | `docs/tasks/views.md` |

四者**读同一份 frontmatter**，只有 Kanban 需要在 `board.md` 里**手工同步状态列**；
Dataview 视图改 frontmatter 自动反映，**无需维护**。

### Kanban 字段显示（一次性配置）

`board.md` 视图右上角 `⋯ → Open board settings → Linked Page Metadata`，
Add：`kind / milestone / status / priority / owner / assignee / estimate`。

> ⚠️ **Obsidian Kanban 插件不读 frontmatter，不会按 `status` 自动归列**。
> 列名（`Backlog / Ready / In Progress / Review / Done`，**首字母大写**）与 frontmatter 小写值
> 是逻辑等价但**机械上互不感知**。任何状态迁移都必须**手工**改 `board.md` 的列位，
> 与文件位置、frontmatter 一起完成"三处同步"（详见 [[sdd-workflow]] §3）。
> 若发生 board 与 frontmatter 不一致，**以 frontmatter 为准**重排 board.md。

### 7.1 Kanban 列与 frontmatter 对照

```
## Backlog        ↔  frontmatter.status: backlog        目录: docs/tasks/backlog/
## Ready          ↔  frontmatter.status: ready          目录: docs/tasks/ready/
## In Progress    ↔  frontmatter.status: in-progress    目录: docs/tasks/in-progress/
## Review         ↔  frontmatter.status: review         目录: docs/tasks/review/
## Done           ↔  frontmatter.status: done           目录: docs/tasks/done/
```

每周人肉跑一次"把 frontmatter.status = done 且 updated > 30d 的卡片移到 archived"。

## 8. 交叉引用强约束

- 新任务 → **追加到 `docs/tasks/README.md` 索引**
- 任务引用的 spec / ADR / 包 → 全部用 `[[wiki-link]]`
- spec/ADR 也要反向链回对应 tasks
- **层级链**：TASK ↔ STORY ↔ EPIC 必须通过 `parent` / `children` 双向可达
- 孤儿（非 EPIC 但无 `parent`）= 0；定期用 `tree.md` 的孤儿查询自检

## 9. UI 先行约束（GUI 强约束）

任何交付 GUI 的 STORY / TASK，**开工前**必须先出 UI 结构 spec：

1. 落位 `docs/specs/ui/<module>-structure.md`，至少含：信息架构 / 状态机 / 关键流程 / 线框（ASCII 即可）/ 与现有架构对接点。
2. 所属 EPIC 卡的"出口条件"必须显式包含"UI 结构 spec accepted"。
3. 设计语言（design tokens / 基础组件）由 M3 阶段统一沉淀到 `docs/specs/ui/design-language.md` + `component-inventory.md`，**M3 之前的 UI 不要硬编码视觉**。
4. 允许使用外部辅助（如 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)）做探索，**结论必须沉淀到 spec**。

## 10. 不做什么

- 不做复杂甘特图
- 不做工时精算
- 不把任务同步到外部 Issue 追踪（保持单一信息源）
- 不写长任务描述（> 500 字必须拆）

## 相关

- [[../templates/task]] · [[../templates/story]] · [[../templates/epic]]
- [[../../.ai/rules/30-agent-behavior]]
- [[../../.ai/rules/20-docs-workflow]]
- [[sdd-workflow]]
- [[../vision/roadmap]]
