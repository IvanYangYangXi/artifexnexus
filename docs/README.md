---
tags: [project, overview]
created: 2026-05-02
---

# Artifex Nexus 项目文档（Obsidian Vault）

> **The AI-Agent Bridge for Digital Creation**
>
> 本仓库的 `docs/` 既是 Obsidian Vault，也是项目"单一信息源"。
> AI 编程助手（Cursor / Claude Code）请先读 `[[../.ai/context/project-overview]]` 与 `[[../.ai/rules/00-architecture]]`。

## 阅读路径

### 给开发者（人类）

1. `[[vision/north-star]]` — 北极星：项目目标与方向
2. `[[specs/系统架构设计]]` — 系统架构（迁移并重写中）
3. `[[specs/skill-system]]` — Skill 子系统设计（迁移并重写中）
4. `[[specs/install]]` — 安装与部署
5. `[[development/README]]` — 开发者上手与规范
6. `[[decisions/README]]` — 决策记录索引（ADR）

### 给 AI 助手

- `[[../.ai/context/project-overview]]`
- `[[../.ai/rules/00-architecture]]`
- `[[../.ai/rules/20-docs-workflow]]`

## 目录结构

| 目录 | 内容 | 谁更新 |
|------|------|--------|
| `[[vision/]]` | 长期愿景：北极星、路线图、非目标 | 项目负责人 |
| `[[specs/]]` | **唯一权威**：架构、协议、子系统设计、安装、数据模型 | 改架构者（先改 specs 再改代码） |
| `[[decisions/]]` | ADR — 关键决策记录 | 任何引入或改变决策的人 |
| `[[tasks/]]` | 任务看板（Obsidian Kanban） | 任何人（规则见 `[[development/task-management]]`） |
| `[[development/]]` | 开发者上手、约定、Skill 编写指南 | 工程师 |
| `[[inbox/]]` | **你的灵感、需求、临时想法**（每周清理） | 任何人 |
| `[[templates/]]` | Obsidian 模板（ADR / 想法 / Skill / Task） | 文档维护者 |
| `[[changelog/]]` | 用户向 changelog | 发版时 |
| `[[assets/]]` | 图片 / 附件 | 任何人 |

## 灵感、需求、新想法放哪里？

→ 一律先扔进 `[[inbox/]]`。每周整理一次，决定它的归宿：

- 升级到 `vision/` — 如果是长期目标 / 愿景级想法
- 升级到 `specs/` — 如果是落到具体子系统的设计
- 升级到 `decisions/` — 如果引发了一个关键决策
- 删除 — 如果想清楚了不做

## 文档规范

详见 `[[../.ai/rules/20-docs-workflow]]`：

- 每个文档必须有 frontmatter（tags / created / status）
- 用 `[[wiki-link]]` 而不是相对路径
- **改架构必先改 `specs/`**
