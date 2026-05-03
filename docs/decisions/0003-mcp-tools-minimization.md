---
tags: [adr, accepted]
created: 2026-05-02
status: accepted
---

# ADR 0003 — MCP 工具最小化与命名统一

## Context

原 artclaw_bridge v2.6 已经把 MCP 注册的工具精简为每个 DCC 仅 1 个：UE 用 `run_ue_python`，其他 DCC 用 `run_python`。其余能力通过该 Python 入口由 AI 写代码调用 `skill_hub.execute_skill()`。Artifex Nexus 重构是否保留？

此外，原项目区分 `run_python` / `run_ue_python` 是为了名字提醒 AI（UE 内 `unreal` 模块 vs Maya 内 `maya.cmds`）。但现在 Gateway 端会自动加 `mcp_{server}_{tool}` 前缀，AI 看到的本就是 `mcp_unreal_run_python` 与 `mcp_blender_run_python`，前缀已经隔离了 DCC 上下文，工具自身名字可以统一。

## Decision

1. **保留并强化** v2.6 的最小化设计：每个 DCC 的 MCP Server 只注册 1 个工具，所有领域能力以 Skill 形式提供。
2. **统一工具名为 `run_python`**（不再区分 `run_ue_python`）。多 DCC 同时运行时由 Gateway 端自动命名空间隔离：
   - `mcp_unreal_run_python`
   - `mcp_blender_run_python`
3. 工具的 `description` 字段动态注入 DCC 上下文：
   `"This is the {dcc_name} {dcc_version} Python environment. Available modules: {hints}."`
4. Skill 装饰器统一为 `@tool`（区分 Skill = 包，Tool = 函数）。`@artclaw_tool` 保留为别名兼容。
5. `.ai/rules/00-architecture.md` 把"不许新增 MCP 工具"列为铁律。

## Consequences

**优点**：

- 工具列表稳定，AI 端 prompt 不会因为新功能而膨胀。
- Skill 增删不影响 MCP 接口契约。
- 测试与版本管理简单（Skill 是普通 Python 函数）。

**代价**：

- AI 必须懂得"通过 run_python 调 skill_hub"的范式（已写入 OpenClaw Skill 提示文档 `[[../sdk/skill-authoring]]`）。
- 调用链多一跳，延迟略增（实测可忽略）。

## Alternatives Considered

- **每个 Skill / Tool 注册为独立 MCP 工具**：被拒，工具数将爆炸（Skill 计划 ~80~100 / DCC）。
- **混合：高频 Skill 注册为 MCP 工具，其他走 run_python**：被拒，规则不一致带来心智负担。
- **保留 `run_ue_python` 区分**：被拒，Gateway 命名空间已隔离，名字重复反而增加心智负担。

## Links

- `[[../specs/系统架构设计]]`
- `[[../api/mcp-jsonrpc]]`
- `[[../sdk/skill-authoring]]`
