---
tags: [development, index]
created: 2026-05-02
---

# 开发者指南

## 快速开始

```bash
# 1. 安装工具
brew install pnpm uv             # macOS
# Windows: winget install pnpm.pnpm; pip install uv

# 2. 克隆 + 拉 vendor
git clone <repo-url> artifex-nexus
cd artifex-nexus
git submodule update --init --recursive   # 拉 vendor/openclaw

# 3. 装依赖
pnpm install
uv sync --all-packages

# 4. 部署到 ~/.artifexnexus/（开发模式：源码引用）
artifex install --link

# 5. 启动 Web UI
pnpm dev --filter=@artifex-nexus/web

# 6. 健康检查
artifex doctor
```

## Vibe Coding 工作流

1. 想清楚 → 改 `docs/specs/` 或起 ADR（用 `[[../templates/adr]]`）
2. 让 AI 生成代码（参考 `[[../../.ai/prompts/]]`）
3. AI 自动遵守 `[[../../.ai/rules/00-architecture]]`
4. 自检 + pytest / vitest
5. PR：标题 Conventional Commits + 链接到 spec/ADR

## 子页面

- `[[sdd-workflow]]` — **SDD 工作流**（想法→任务→规格→实现→合并；AI 口令）
- `[[task-management]]` — Vibe Coding 任务管理方案（Obsidian Kanban）
- `[[team-roles]]` — 团队角色定义与协作流程（PM / 程序 / QA）
- `[[agent-onboarding]]` — 各类 AI Agent 的接入方式与一键粘贴提示词
- `[[context-handoff-copy-model-and-validation]]` — 统一 Copy 安装模型 + 部署清单校验（ADR 0008 实施手册）
- `[[skill-authoring/README]]` — Skill 编写指南
- `[[guides/onboarding]]` — 新人 onboarding（TODO）
- `[[guides/dcc-unreal]]` — UE 插件开发（TODO）
- `[[guides/dcc-blender]]` — Blender addon 开发（TODO）
- `[[conventions/coding-style]]` — 与 `[[../../.ai/rules/10-coding-style]]` 同步
- `[[conventions/commits]]` — Conventional Commits
