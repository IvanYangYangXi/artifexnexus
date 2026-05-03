---
tags: [adr, accepted]
created: 2026-05-02
status: accepted
---

# ADR 0001 — Monorepo 单仓库多包布局

## Context

原 `artclaw_bridge` 的代码、Gateway 插件、UE/Maya/Max 插件、Tool Manager 散落在不同仓库或同仓库的不同子目录，缺乏统一的构建与版本管理。重构 Artifex Nexus 时需要决定仓库形态。

## Decision

采用 **Monorepo + 多包**，按"层"组织：

```
packages/
├── platform/        # 平台层（所有 DCC/适配复用）：core / skill / contracts / cli
├── adapters/        # AI 平台适配（每个 AI Agent 平台一个子目录）：openclaw/...
├── dcc/             # DCC 插件（每个 DCC 一个子目录）：unreal / blender
└── apps/            # 终端用户应用：web
```

工具链：
- 顶层 `pnpm workspaces` + `Turborepo` 管理 TS 包；
- `uv workspaces` 管理 Python 包；
- UE C++ 子项目作为 monorepo 内目录（`packages/dcc/unreal/`），构建走 UE BuildTool。

详见 `[[../README|docs/README]]` 与 `[[../specs/系统架构设计]]`。

## Consequences

**优点**：

- 一处提交、一处发版，CI 可缓存（Turbo / uv build cache）。
- TS 与 Python 共享 `shared-types` / 配置 schema 不易漂移。
- 重构期跨包改名重构友好。

**代价**：

- UE 工程师需要拉整个 monorepo（可通过 sparse checkout 缓解）。
- 需要 Turbo + uv 双工具链；新人 onboarding 多一个步骤（已写入 `[[../runbook/install]]`）。

## Alternatives Considered

- **Polyrepo**：每个子项目独立 git。被拒：跨包重构成本高，文档分散。
- **混合（核心 + Web UI 在主仓，DCC 各自独立）**：被拒：当前阶段单仓更便于敏捷重构。

## Links

- `[[0002-vendor-openclaw-fork]]`
- `[[../specs/系统架构设计]]`
