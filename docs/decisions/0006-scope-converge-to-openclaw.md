---
tags: [adr, accepted, scope, openclaw]
created: 2026-05-03
status: accepted
---

# ADR 0006 — 项目范围收敛到 OpenClaw 单平台

## Context

北极星 §3"收敛范围"原表述为"只接 OpenClaw，但通过 `packages/adapters/<platform>/`
与 `packages/platform/contracts/` 留好抽象，未来接其他平台只需新增一个 adapter 包"。

实践中这层"未来抽象"带来 3 个真实代价：

1. **schema 冗余**：`config.schema.json` 的 `platform.type/gateway_url` 等字段
   永远只有 `openclaw` 一个值，是伪枚举（详见 [[../tasks/backlog/TASK-0002-schema-de-abstraction]]）。
2. **目录冗余**：`packages/adapters/<platform>/` 二级目录只为容纳一个适配器存在。
3. **认知冗余**：所有新人和 AI 都得学一个永不实现的"多平台"概念。

YAGNI（You Aren't Gonna Need It）：在没有第二个真实候选平台的情况下，
**抽象只增成本不增价值**。

## Decision

1. **正式将项目范围收敛为：只支持 OpenClaw 一个 AI Agent 平台**，
   覆盖立项、规格、代码、文档、品牌叙事所有层面。
2. 不再保留"多平台抽象"作为显式架构目标。`openclaw` 直接成为一等公民。
3. 仍保留 `packages/adapters/openclaw/` 子目录的物理隔离
   （Vendor / Gateway 插件 / 协议代码归此），但**不为虚构的 `<other-platform>/`
   保留位置**。
4. 任何与"多平台"挂钩的措辞、字段、目录占位将通过 [[../tasks/backlog/TASK-0002-schema-de-abstraction]]
   及后续清理任务逐步移除。
5. **逆转条件**：当出现具体的第二平台候选（issue 提名 + 设计 spec），
   才重启抽象层；届时由新 ADR superseded 本决策。

## Consequences

**优点**：

- 核心 schema / 命名 / 文档将更直白，新人 onboarding 成本下降。
- `platform.*` 抽象的去除会减少 100+ 行代码与文档冗余。
- 所有精力聚焦 OpenClaw 的稳定性、易用性与 Skill 生态。

**代价**：

- 未来若真的接第二平台，需要重新引入抽象（成本可控，因为有 contracts schema 作锚）。
- 部分历史文档措辞需要清理（已立 TASK-0002）。

## Alternatives Considered

- **保留多平台抽象**：被拒，YAGNI。
- **删除 `adapters/openclaw/` 目录、把代码上移到 `platform/`**：被拒，
  物理隔离便于未来真要支持第二平台时回退；并且 vendor 的子目录归属也需要这层。

## Cleanup Backlog（由本 ADR 触发）

- [[../tasks/backlog/TASK-0002-schema-de-abstraction]]：合并 `platform.*` → `openclaw.*`
- 清理 `docs/vision/north-star.md` §3 的"多平台抽象"措辞
- 清理 `docs/specs/系统架构设计.md` 中的"未来接其他平台"段落
- 清理 `.ai/rules/00-architecture.md` 依赖图中的 `adapters/<platform>` 通用化表述
- 清理 `.ai/prompts/new-platform.md`（删除或改为"OpenClaw 内部子模块"指南）

## Links

- [[0001-monorepo-layout]]
- [[0002-vendor-openclaw-fork]]
- [[0004-contracts-as-source-of-truth]]
- [[../vision/north-star]]
- [[../tasks/backlog/TASK-0002-schema-de-abstraction]]
