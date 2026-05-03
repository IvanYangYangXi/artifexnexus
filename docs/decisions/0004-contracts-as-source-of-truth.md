---
tags: [adr, accepted]
created: 2026-05-02
status: accepted
---

# ADR 0004 — Contracts as Source of Truth

## Context

原项目 `artclaw_bridge` 出现过多次"同一份契约三处独立实现"导致漂移的问题——
最典型的是 `core/version_manager.py`、`UEClawBridge/Content/Python/skill_version.py`、
`DCCClawBridge/core/skill_sync.py` 三处版本管理逻辑各自演化（见原 spec 13.1）。

类似的还有：Skill manifest schema 在 Python 侧用 `jsonschema` 校验、Web UI 侧用手写 TS 类型；
配置中心 schema 也是 Python 与 TS 各写一份。

## Decision

引入统一的 **`packages/platform/contracts/`** 包，作为四层 SDK 共用的契约源：

```
contracts/
├── schemas/      # 唯一信息源 / Single source of truth
├── python/       # pydantic v2 模型 + Python ABC（PlatformAdapter / BaseDCCAdapter / ...）
└── typescript/   # 自动从 schemas/ 生成的 TS types
```

**规则**：

1. 任何跨进程 / 跨语言传递的数据结构，必须先在 `contracts/schemas/` 加 JSON Schema。
2. Python 侧用 `datamodel-code-generator` 或手写 pydantic 模型（先手写起步）。
3. TS 侧用 `json-schema-to-typescript` 自动生成。
4. Python ABC（如 `PlatformAdapter`）也放在本包，因为它们也是契约——只是用代码而非 schema 表达。
5. 由 `scripts/codegen.sh` 统一刷新所有生成物，CI 校验生成物与 schema 一致。

## Consequences

**优点**：

- 单点修改，多处自动同步，杜绝原项目的"三处实现漂移"。
- Web UI（TS）能直接拿到强类型，不必反向猜 Python 端 schema。
- AI 助手只需读 `contracts/schemas/` 就能掌握全系统的数据模型。

**代价**：

- 引入 codegen 步骤（用 git 提交生成物 + CI 校验来抵消）。
- 起步阶段手写 schema + Python + TS 三份，待迁移规模大时再上 codegen。

## Alternatives Considered

- **保持原项目散落式定义**：被拒，已被原项目证明会漂移。
- **只用 pydantic 作为唯一源，TS 从 OpenAPI 生成**：被拒，pydantic v2 → JSON Schema 在嵌套类型上有边角问题，反而更复杂。

## Links

- `[[../specs/系统架构设计]]`
- `[[../../packages/platform/contracts/README]]`