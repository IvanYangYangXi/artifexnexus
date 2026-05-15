---
id: STORY-0046
kind: story
title: M4-RPC-01 · Sidecar RPC：Skill/Tool 方法注册
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1.5d
created: 2026-05-15
updated: 2026-05-15
parent: "[[../backlog/EPIC-0004-m4-skill-system]]"
milestone: M4
related_adr: [0003]
related_docs:
  - "[[../../../docs/research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/adapters/openclaw/wrapper"
  - "packages/platform/skill"
tags: [story, skill, tool, rpc, sidecar, M4, M5]
---

# STORY-0046 · Sidecar RPC：Skill/Tool 方法注册

## 用户故事
前端通过 Tauri invoke → JSON-RPC → sidecar 调用 Skill/Tool 全部管理操作，为 Web UI 提供后端接口。

## 验收标准

### Skill RPC (12 方法)
- [ ] `skill.list(filters)` → `(items, total)` 分页列表
- [ ] `skill.detail(id)` → `SkillDetail` 详情
- [ ] `skill.install(id)` → `{ok, message}`
- [ ] `skill.uninstall(id)` → `{ok, message}`
- [ ] `skill.enable(id)` / `skill.disable(id)` → `SkillInfo`
- [ ] `skill.pin(id)` / `skill.unpin(id)` → `SkillInfo`
- [ ] `skill.favorite(id)` / `skill.unfavorite(id)` → `SkillInfo`
- [ ] `skill.sync(id)` → `{ok, synced_files}`
- [ ] `skill.publish(id, opts)` → `{ok, version}`
- [ ] `skill.batch(operation, ids)` → `{succeeded, failed, errors}`
- [ ] `skill.search(query)` → `list[SkillInfo]`

### Tool RPC (12 方法)
- [ ] `tool.list(filters)` → `(items, total)` 分页列表
- [ ] `tool.detail(id)` → `ToolDetail`
- [ ] `tool.create(...)` → `ToolInfo`
- [ ] `tool.update(id, ...)` → `ToolInfo`
- [ ] `tool.delete(id)` → `{ok}`
- [ ] `tool.enable(id)` / `tool.disable(id)` → `ToolInfo`
- [ ] `tool.pin(id)` / `tool.unpin(id)` → `ToolInfo`
- [ ] `tool.favorite(id)` / `tool.unfavorite(id)` → `ToolInfo`
- [ ] `tool.publish(id, opts)` → `{ok, version}`
- [ ] `tool.run(id, args)` → `ToolResult`
- [ ] `tool.batch(operation, ids)` → `{succeeded, failed, errors}`

### Sidecar 注册
- [ ] `skill_rpc.py` 新建：所有 `skill.*` / `tool.*` handler 函数实现
- [ ] sidecar.py `METHOD_TABLE` 追加 24 个条目
- [ ] 所有方法支持标准 JSON-RPC error 返回（code + message）

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
- ← STORY-0045（ToolRegistry + ToolInstaller 必须可用）

## 非范围
- Rust Tauri command 层（→ STORY-0047）
- 前端 API 封装（→ STORY-0047）
- Memory 管理
