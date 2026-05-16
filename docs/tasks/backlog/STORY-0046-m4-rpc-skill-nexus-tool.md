---
id: STORY-0046
kind: story
title: M4-RPC-01 · Sidecar RPC：Skill/Nexus-Tool 方法注册
status: ready
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1.5d
created: 2026-05-15
updated: 2026-05-16
parent: "[[../backlog/EPIC-0004-m4-skill-system]]"
milestone: M4
related_adr: [0003]
related_docs:
  - "[[../../../docs/research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/adapters/openclaw/wrapper"
  - "packages/platform/skill"
tags: [story, skill, nexus-tool, rpc, sidecar, M4, M5]
---

# STORY-0046 · Sidecar RPC：Skill/Nexus-Tool 方法注册

## 用户故事
前端通过 Tauri invoke → JSON-RPC → sidecar 调用 Skill/Nexus-Tool 全部管理操作，为 Web UI 提供后端接口。

## 验收标准

### Skill RPC (14 方法)
- [x] `skill.list(filters)` → `(items, total)` 分页列表
- [x] `skill.detail(id)` → `SkillDetail` 详情
- [x] `skill.install(id)` → `{ok, message}`
- [x] `skill.uninstall(id)` → `{ok, message}`
- [x] `skill.enable(id)` / `skill.disable(id)` → `SkillInfo`
- [x] `skill.pin(id)` / `skill.unpin(id)` → `SkillInfo`
- [x] `skill.favorite(id)` / `skill.unfavorite(id)` → `SkillInfo`
- [x] `skill.sync(id)` → `{ok, synced_files}`
- [x] `skill.publish(id, opts)` → `{ok, version}`
- [x] `skill.batch(operation, ids)` → `{succeeded, failed, errors}`
- [x] `skill.search(query)` → `list[SkillInfo]`

### Nexus-Tool RPC (13 方法，不含 run)
- [x] `nexus-tool.list(filters)` → `(items, total)` 分页列表
- [x] `nexus-tool.detail(id)` → `NexusToolDetail`
- [x] `nexus-tool.create(...)` → `NexusToolInfo`
- [x] `nexus-tool.update(id, ...)` → `NexusToolInfo`
- [x] `nexus-tool.delete(id)` → `{ok}`
- [x] `nexus-tool.enable(id)` / `nexus-tool.disable(id)` → `NexusToolInfo`
- [x] `nexus-tool.pin(id)` / `nexus-tool.unpin(id)` → `NexusToolInfo`
- [x] `nexus-tool.favorite(id)` / `nexus-tool.unfavorite(id)` → `NexusToolInfo`
- [x] `nexus-tool.publish(id, opts)` → `{ok, version}`
- [x] `nexus-tool.batch(operation, ids)` → `{succeeded, failed, errors}`

### Sidecar 注册
- [x] `skill_rpc.py` + `nexus_tool_rpc.py` + `_rpc_helpers.py` 新建
- [x] sidecar.py `METHOD_TABLE` 追加 27 个条目（14 skill + 13 nexus-tool）
- [x] 所有方法支持标准 JSON-RPC error 返回（code + message）

## 源文件对照

| 目标文件 | 源文件 (artclaw_bridge) | 适配量 |
|----------|------------------------|--------|
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/skill_rpc.py` | ToolManager `server/api/skills.py` + `server/api/tools.py` (~500行) | **高** |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py` | 已存在（修改 +50行） | **低** |

## 关键适配

- FastAPI `@app.get("/api/skills")` → `def _handle_skill_list(req_id, params) -> dict`
- 所有 handler 从 FastAPI endpoint 转为纯函数（JSON-RPC over stdio）
- METHOD_TABLE 注册：`METHOD_TABLE["skill.list"] = _handle_skill_list`
- 错误处理：FastAPI HTTPException → JSON-RPC error `{"code": -32000, "message": "..."}`

## 依赖
- → EPIC-0004（父）
- ← STORY-0044（SkillInstaller + Loader + Config 必须可用）
- ← STORY-0045（NexusToolRegistry + NexusToolInstaller 必须可用）

## 非范围
- Rust Tauri command 层（→ STORY-0047）
- 前端 API 封装（→ STORY-0047）
- Memory 管理

## ⚠️ PM 标注（2026-05-16）：`nexus-tool.run` RPC 方法需移除

**问题**：验收标准 §`nexus-tool.run(id, args)` 将 Nexus-Tool 执行暴露为 Sidecar RPC 方法，
但 Nexus-Tool 执行必须在 DCC 的 Python 环境中进行（需要 `bpy` / `unreal` 等 DCC 模块），
sidecar 进程无法访问这些环境。

**正确路径**：Nexus-Tool 执行应通过 OpenClaw → MCP Bridge → DCC `run_python` 完成。
前端 [▶ 运行] 按钮不应调用 `nexus-tool.run` RPC，而应触发 OpenClaw agent 生成 `run_python` 调用。

**建议**：从 Nexus-Tool RPC 方法列表中移除 `nexus-tool.run`（减少为 11 个方法）。
`NexusToolRegistry.run_nexus_tool()` 保留为纯 Python SDK 方法，供 DCC 内部使用。
