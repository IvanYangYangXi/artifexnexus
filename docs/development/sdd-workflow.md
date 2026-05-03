---
tags: [workflow, sdd, agent]
created: 2026-05-03
status: accepted
---

# SDD 工作流（Spec-Driven Development）

> 本文件定义 **想法 → 任务 → 规格对齐 → 实现 → 合并** 的完整闭环。
> AI 助手（Claude / Cursor / Codex …）必须按本流程执行，详见 `[[../../.ai/rules/30-agent-behavior]]`。

## 0. 前提

- 所有写入 `docs/inbox/` 的文件都是"候选输入"。
- 所有任务卡的生命周期按 `[[task-management]]` 管理。
- 流程里**每一步**都必须满足 `.ai/rules/30-agent-behavior.md` 的"接单前追问"与"最小改动"。

## 1. 触发口令（用户 → Agent）

为了不用每次都贴长指令，约定 4 个短口令。Agent 看到即进入对应阶段。

| 口令（示例） | 阶段 | 期望产物 |
|---|---|---|
| `/sdd triage <inbox 文件路径>` | 想法 → 任务卡 | `docs/tasks/backlog/TASK-NNNN-*.md` |
| `/sdd align <任务卡 wiki-link>` | 任务 → 规格对齐 | spec/ADR + 更新后的任务卡，迁 `ready/` |
| `/sdd implement <任务卡 wiki-link>` | 规格 → 代码 | 代码 + 迁 `review/` |
| `/sdd done <任务卡 wiki-link>` | 合并完成 | 迁 `done/`、追 changelog |

> 这些口令**只是约定**，不是硬解析；Agent 按自然语言理解即可。

## 2. 各阶段细则

### 2.1 triage（想法 → 任务）

1. 读取指定 `docs/inbox/*.md`。
2. 按 `.ai/rules/30-agent-behavior.md`，先**追问**必要设计问题（每问配推荐答案）。
3. 对齐后，用 `docs/templates/task.md` 生成任务卡：
   - 编号 = `docs/tasks/` 下现有最大 `TASK-NNNN` + 1
   - 位置：`docs/tasks/backlog/`
   - frontmatter.status = `backlog`
4. 同步更新：
   - `docs/tasks/README.md` 索引表新增一行
   - `docs/tasks/board.md` 的 **Backlog** 列新增 `- [ ] [[TASK-NNNN-slug]]`
5. 任务卡正文中反链原 inbox 文件。
6. **不要**继续 align 或 implement；提交给用户确认。

### 2.2 align（任务 → 规格）

1. 沿设计树逐分支追问，解决决策依赖。
2. 产出落位（择一或多个）：
   - 新 spec：`docs/specs/<slug>.md`（**≤ 2000 字**，超则按模块拆 `<slug>-<module>.md`）
   - 新 ADR：`docs/decisions/NNNN-<slug>.md`
   - 已有 spec/ADR 的增补
3. 把**可机器逐条校验**的验收标准写进任务卡 "验收标准" 章节。
4. 迁移：
   - 文件：`backlog/` → `ready/`
   - frontmatter.status: `ready`
   - `board.md`：Backlog 列的条目移到 Ready 列
5. 在新建 spec/ADR 的 "相关" 章节反链任务卡。
6. **不要**写实现代码。

### 2.3 implement（规格 → 代码）

1. 确认任务卡 status 为 `ready`，否则回到 2.2。
2. 迁：`ready/` → `in-progress/`，status 同步，board.md 同步；"进展日志" 记一行。
3. 按验收标准逐条实现：
   - 代码文件 **100–300 行**黄金区；**硬上限 500**
   - 单一职责；禁止顺手重构；bug 修复必须先复现
   - 公共 API docstring 中英双语；注释中文
4. 每完成一条验收标准勾选 `[x]`。
5. 全部勾完后：
   - 迁 `in-progress/` → `review/`，status 同步，board.md 同步
   - 进展日志追加本轮改动概要

### 2.4 done（合并 → 归档）

**由人类触发**。Agent 动作：

1. 迁 `review/` → `done/`，status 同步，board.md 同步。
2. `docs/changelog/README.md` 追加一条用户可见变更。
3. `docs/tasks/README.md` 把卡片从"当前活跃"表移到"归档"表。

> 30 天未更新的 `done` 卡由人类每周清理到 `archived/`。

## 3. 三处同步铁律

任何状态迁移，**同一次提交**必须改三处：

1. **文件位置**（`docs/tasks/<status>/`）
2. **frontmatter.status**
3. **`docs/tasks/board.md`** 所在列

缺一不可。Agent 自检清单里要检查这一条。

## 4. 新对话里如何快速启动

**首选**：Agent 启动时已自动读 `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/*.mdc`。
你只需要说：

> `/sdd triage docs/inbox/2026-05-03-xxx.md`
> `/sdd align [[TASK-0002-xxx]]`
> `/sdd implement [[TASK-0002-xxx]]`

**次选**（Agent 不支持自动 onboarding 时）：对话开头粘贴一句：

> 请先读取 `.ai/rules/30-agent-behavior.md` 与 `docs/development/sdd-workflow.md`，然后按 SDD 流程执行。

## 5. 不做什么

- 不跳过 align 直接 implement
- 不允许 Agent 自己标记 done
- 不把 PRD / 规格塞进同一个巨型 md（超 2000 字就拆）
- 不在 MCP server 加新工具（见 `[[../../.ai/rules/00-architecture]]` §2）

## 相关

- `[[task-management]]`
- `[[../../.ai/rules/30-agent-behavior]]`
- `[[../../.ai/rules/20-docs-workflow]]`
- `[[../templates/task]]`
