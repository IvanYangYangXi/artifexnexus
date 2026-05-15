---
id: STORY-0045
kind: story
title: M5-SDK-01 · ToolRegistry + ToolInstaller
status: backlog
priority: P2
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-15
updated: 2026-05-15
parent: "[[../backlog/EPIC-0005-m5-tool-system]]"
milestone: M5
related_adr: [0003]
related_docs:
  - "[[../../../docs/research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/platform/skill"
tags: [story, tool, sdk, registry, installer, M5]
---

# STORY-0045 · ToolRegistry + ToolInstaller

## 用户故事
Tool 可独立于 Skill 进行发现、查询、创建、删除和发布，不依赖 Skill 包即可注册。

## 验收标准

### ToolRegistry
- [ ] `ToolRegistry` 类：复制自 ToolManager `services/tool_service.py` + `services/tool_scanner.py`
- [ ] `list_tools(filters)` 返回所有已注册 Tool（分页）
- [ ] `get_tool_detail(id)` 返回 Tool 详情
- [ ] `enable_tool(id)` / `disable_tool(id)` Tool 启停
- [ ] `run_tool(id, args)` 调用 Tool 函数并返回 `ToolResult`
- [ ] `search_tools(query)` 模糊搜索
- [ ] `ToolEntry` 中间扫描结果 dataclass

### ToolInstaller
- [ ] `ToolInstaller` 类：从 ToolManager `services/tool_service.py` 拆出安装/发布逻辑
- [ ] `create_tool(name, source_path, manifest)` 从源路径注册新 Tool 到 `~/.artifexnexus/tools/`
- [ ] `update_tool(id, updates)` 修改 Tool 元数据
- [ ] `delete_tool(id)` 删除 Tool 注册
- [ ] `publish_tool(id, target_layer)` 发布 Tool 到指定 layer
- [ ] `pin_tool(id)` / `unpin_tool(id)` 写入配置
- [ ] `favorite_tool(id)` / `unfavorite_tool(id)` 写入配置

## 源文件对照

| 目标文件 | 源文件 (artclaw_bridge) | 适配量 |
|----------|------------------------|--------|
| `packages/platform/skill/src/artifex_nexus/skill/tool_registry.py` | ToolManager `services/tool_service.py` + `services/tool_scanner.py` (~700行) | **中** |
| `packages/platform/skill/src/artifex_nexus/skill/tool_installer.py` | ToolManager `services/tool_service.py` (§create/update/delete/publish) (~300行) | **中** |

## 关键适配

- `ToolService` (FastAPI) → 拆分为 `ToolRegistry` + `ToolInstaller`（纯 Python 类）
- `ToolScanner` → 合并入 `ToolRegistry`
- Tool 目录：`~/.artclaw/tools/` → `~/.artifexnexus/tools/`
- `ToolData` → `ToolInfo`
- `ScannedTool` → `ToolEntry`

## 依赖
- → EPIC-0005（父）
- ← STORY-0042（`@tool` 装饰器 + `ToolResult` 必须可用）
- ← STORY-0044（`SkillConfig` 共享配置读写）

## 非范围
- Sidecar RPC 注册（→ STORY-0046）
- Tool 市场/远程分发
- Memory 管理
