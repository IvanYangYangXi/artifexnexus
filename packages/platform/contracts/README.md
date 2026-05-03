# Artifex Nexus — Contracts

> **契约 = 一份 JSON Schema，三种使用方**

```
contracts/
├── schemas/                      # 🟢 唯一信息源 / Single source of truth
│   ├── manifest.schema.json      # Skill manifest
│   ├── config.schema.json        # ~/.artifexnexus/config/artifexnexus.json
│   ├── stream-event.schema.json  # 平台流事件
│   ├── execution-context.schema.json
│   ├── tool-item.schema.json     # Web UI ToolItem 数据模型
│   └── ...
│
├── python/                       # → 生成 pydantic v2 模型
│   └── src/artifex_nexus/contracts/
└── typescript/                   # → 生成 TypeScript types
    └── src/
```

## 同步机制

- **手动起步期**：JSON Schema 是手写源，Python/TS 类型也手写并保持同步
- **后续优化**：用 `datamodel-code-generator`（Python）+ `json-schema-to-typescript`（TS）做 codegen，由 `scripts/codegen.sh` 一键生成

避免原项目"core/version_manager.py 三处独立实现"的漂移问题（参见 `docs/decisions/0004-contracts-as-source-of-truth.md`）。

此外，本目录还托管 Python 抽象基类（ABC），对应原项目 `core/interfaces/`：

- `PlatformAdapter` — AI 平台适配器抽象基类
- `BaseDCCAdapter`  — DCC 适配器抽象基类
- `ExecutionContext` — 跨 DCC 执行上下文
- `StreamEvent`     — 平台流事件枚举
