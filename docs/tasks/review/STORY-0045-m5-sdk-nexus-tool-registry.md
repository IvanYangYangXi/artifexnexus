---
id: STORY-0045
kind: story
title: M5-SDK-01 · NexusToolRegistry + NexusToolInstaller
status: review
priority: P2
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-15
updated: 2026-05-16
parent: "[[../backlog/EPIC-0005-m5-nexus-tool-system]]"
milestone: M5
related_adr: [0003]
related_docs:
  - "[[../../../docs/research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/platform/skill"
tags: [story, nexus-tool, sdk, registry, installer, M5]
---

# STORY-0045 · NexusToolRegistry + NexusToolInstaller

## 用户故事
Nexus-Tool 可独立于 Skill 进行发现、查询、创建、删除和发布，不依赖 Skill 包即可注册。

## 验收标准

### NexusToolRegistry
- [x] `NexusToolRegistry` 类：复制自 ToolManager `services/nexus_tool_service.py` + `services/nexus_tool_scanner.py`
- [x] `list_nexus_tools(filters)` 返回所有已注册 Nexus-Tool（分页）
- [x] `get_nexus_tool(id)` 返回 Nexus-Tool 详情
- [x] `enable_nexus_tool(id)` / `disable_nexus_tool(id)` Nexus-Tool 启停
- [x] `run_nexus_tool(id, args)` 调用 Nexus-Tool 函数并返回 `NexusToolResult`
- [x] `search_nexus_tools(query)` 模糊搜索
- [x] `NexusToolEntry` 中间扫描结果 dataclass（实现为 `ScannedNexusTool`）

### NexusToolInstaller
- [x] `NexusToolInstaller` 类：从 ToolManager `services/nexus_tool_service.py` 拆出安装/发布逻辑
- [x] `create_nexus_tool(name, source_path, manifest)` 从源路径注册新 Nexus-Tool 到 `~/.artifexnexus/nexus-tools/`
- [x] `update_nexus_tool(id, updates)` 修改 Nexus-Tool 元数据
- [x] `delete_nexus_tool(id)` 删除 Nexus-Tool 注册
- [x] `publish_nexus_tool(id, target_layer)` 发布 Nexus-Tool 到指定 layer
- [x] `pin_nexus_tool(id)` / `unpin_nexus_tool(id)` 写入配置
- [x] `favorite_nexus_tool(id)` / `unfavorite_nexus_tool(id)` 写入配置

## 源文件对照

| 目标文件 | 源文件 (artclaw_bridge) | 适配量 |
|----------|------------------------|--------|
| `packages/platform/skill/src/artifex_nexus/skill/nexus_tool_registry.py` | ToolManager `services/nexus_tool_service.py` + `services/nexus_tool_scanner.py` (~700行) | **中** |
| `packages/platform/skill/src/artifex_nexus/skill/nexus_tool_installer.py` | ToolManager `services/nexus_tool_service.py` (§create/update/delete/publish) (~300行) | **中** |

## 关键适配

- `ToolService` (FastAPI) → 拆分为 `NexusToolRegistry` + `NexusToolInstaller`（纯 Python 类）
- `NexusToolScanner` → 合并入 `NexusToolRegistry`
- Nexus-Tool 目录：`~/.artclaw/tools/` → `~/.artifexnexus/nexus-tools/`
- `ToolData` → `NexusToolData`
- `ScannedTool` → `ScannedNexusTool`

## 依赖
- → EPIC-0005（父）
- ← STORY-0042（`@skill_tool` 装饰器 + `SkillToolResult` 必须可用）
- ← STORY-0044（`SkillConfig` 共享配置读写）

## 非范围
- Sidecar RPC 注册（→ STORY-0046）
- Nexus-Tool 市场/远程分发
- Memory 管理
- 触发器系统（→ M6+）

## 实现笔记（2026-05-16）

### 文件结构
采用子包 `nexus_tool/`（非扁平 `.py`），与 `hub/`、`decorator/` 模式一致：
```
nexus_tool/
├── __init__.py    (28 行) — 公共 API
├── models.py      (75 行) — ScannedNexusTool, NexusToolData, NexusToolResult
├── scanner.py     (156 行) — scan_nexus_tools()
├── registry.py    (263 行) — NexusToolRegistry
└── installer.py   (300 行) — NexusToolInstaller
```

### 命名铁律
- 所有类名：`NexusTool*`（不是 `Tool*`）
- 所有方法名：`*_nexus_tool()` / `*_nexus_tools()`
- 所有 RPC 方法：`nexus-tool.*`
- 路径：`~/.artifexnexus/nexus-tools/`
- 零裸 `tool` 出现

### SkillConfig 扩展
`core/skill_config.py` 新增 `nexus_tools` 段（12 个方法）：
`enable/disable/pin/unpin/favorite/unfavorite` + 对应的 `is_*/get_*` 查询。

### 设计决策
- `run_nexus_tool` 保留为 SDK 方法，**不从 Sidecar RPC 暴露**（前端 [▶ 运行] 应触发 DCC 内 run_python）
- DCC 绑定工具禁止本地 subprocess 执行（返回明确错误）
- Pin/Favorite 复用 SkillConfig（统一 `skills.json`），不新建配置类
- 触发器暂不迁移（依赖独立事件引擎）

### 测试
13 项功能测试通过：创建/扫描/列表/详情/搜索/启停/置顶/收藏/更新/运行/删除/刷新。

## ⚠️ PM 标注（2026-05-16）：`run_nexus_tool` 执行路径待确认

**问题**：验收标准 §`run_nexus_tool(id, args)` 在当前架构下存在歧义。

Artifex Nexus 的架构分工是：
- **Sidecar**：只做管理（list / install / enable / disable / pin / favorite / search）
- **OpenClaw**（通过 DCC `run_python` MCP 工具）：负责执行

`NexusToolRegistry.run_nexus_tool()` 如果在 sidecar 进程中调用，无法访问 DCC 的 Python 环境（`bpy` / `unreal` 等）。
该方法的正确使用场景是：**作为公共 API 供 OpenClaw AI 生成的 Python 代码在 DCC 内部调用**，
不应通过 Sidecar RPC 暴露。

**建议**：实现 `run_nexus_tool` 方法本身（纯 Python SDK），但从 Sidecar RPC 的 `nexus-tool.*` 方法列表中移除
（STORY-0046 的 `nexus-tool.run` 也需标注）。前端 [▶ 运行] 按钮应触发 DCC 内 `run_python` 而非 sidecar RPC。
