# .ai/ — Vibe Coding 工作台

> 本目录是 AI 协作的"操作系统"，让 Cursor / Claude Code / Codex 等 AI 编程助手立刻 onboard。

## 结构

| 子目录 | 用途 | 谁会读它 |
|--------|------|----------|
| `rules/` | **强约束**：架构边界、命名、依赖规则、不许做的事 | AI 写代码前必读 |
| `prompts/` | 复用 prompt 片段（新 Skill / 新 ADR / 新平台） | 人类 + AI |
| `context/` | 工程长程上下文（项目速览 + 术语表） | AI |

## Vibe Coding 三条铁律

1. **Docs is the source of truth.** 改架构必先改 `docs/specs/`，再改代码。
2. **Skill ≠ Tool；MCP 工具最小化。** 唯一 MCP 工具是 `run_python`，新能力一律以 Skill 包 + `@tool` 函数形式提供。
3. **平台/契约隔离。** 平台特化代码只能进 `packages/adapters/<name>/` 与 `vendor/`；
   `platform/core` / `platform/skill` 永远平台无关；跨进程数据先过 `platform/contracts/schemas/`。

## 规则文件加载顺序

| 文件 | 内容 |
|------|------|
| `rules/00-architecture.md` | 架构铁律：依赖方向、MCP 最小化、主线程、路径 |
| `rules/10-coding-style.md` | 命名、文件结构、风格、测试 |
| `rules/20-docs-workflow.md` | Obsidian Vault 协作规则 |
| `rules/30-agent-behavior.md` | **AI 行为准则**：对齐优先、最小改动、文档代码交叉引用、文件行数上限 |

## 常见 AI 任务速查

- **SDD 工作流总入口**：`docs/development/sdd-workflow.md`（口令：`/sdd triage|align|implement|done`）
- 新建 Skill：`prompts/new-skill.md` → 在 `packages/dcc/{unreal,blender}/.../skills/` 建包
- 新增 ADR：`prompts/new-adr.md` → 在 `docs/decisions/` 按编号建文件
- 接入新平台：`prompts/new-platform.md` → 在 `packages/adapters/<name>/` 建包

## 与 Obsidian 的关系

`docs/` 是 Obsidian Vault（人类视角的知识图谱）；`.ai/` 是 AI 视角的索引与规则。
两者通过 `context/project-overview.md` 互相指向。
