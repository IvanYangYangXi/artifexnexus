---
tags: [decisions, index]
created: 2026-05-02
---

# ADR 索引

> Architecture Decision Records — 编号递增，4 位数。新增见 `[[../../.ai/prompts/new-adr|.ai/prompts/new-adr]]`。

| # | 标题 | 状态 |
|---|------|------|
| `[[0001-monorepo-layout]]` | Monorepo 单仓库多包布局 | accepted |
| `[[0002-vendor-openclaw-fork]]` | Vendor & 锁定 OpenClaw 分发（隔离至 `~/.artifexnexus/.openclaw/`） | accepted |
| `[[0003-mcp-tools-minimization]]` | MCP 工具最小化（统一 `run_python`） | accepted |
| `[[0004-contracts-as-source-of-truth]]` | Contracts as Source of Truth | accepted |
| `[[0005-desktop-distribution-tauri-standalone-python]]` | 桌面分发：Tauri + 内置 standalone Python | accepted |
| `[[0006-scope-converge-to-openclaw]]` | 项目范围收敛到 OpenClaw 单平台 | accepted |
| `[[0007-windows-openclaw-shell-spawn]]` | Windows 上 spawn `openclaw` CLI 的统一约定（npm shell wrapper / `.cmd` / `CREATE_NO_WINDOW`） | accepted |
| `[[0008-copy-model-deploy-manifest]]` | 弃用 Junction/Symlink，统一为物理拷贝 + 部署清单校验 | accepted |
