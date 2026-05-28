---
id: EPIC-0005
kind: epic
title: M5 · Nexus-Tool 系统
status: done
priority: P2
owner: "@ivan"
assignee: pair
estimate: 2w
created: 2026-05-04
updated: 2026-05-28
completed: 2026-05-28
parent: "[[../../vision/roadmap]]"
milestone: M5
related_adr: [0003]
related_specs: []
related_packages:
  - "packages/platform/skill"
  - "packages/apps/web"
  - "packages/adapters/openclaw/wrapper"
  - "tools/"
tags: [epic, nexus-tool, M5, done]
---

# M5 · Nexus-Tool 系统 ✅ DONE

## 背景与目标

Nexus-Tool 与 Skill 解耦管理：Skill 是包，SkillTool 是包内 `@skill_tool` 装饰的函数。
本阶段提供全局 Nexus-Tool 注册表 + Web UI 浏览 / 调用。

## 实际交付

### 核心注册与发现

- `NexusToolRegistry`：工具发现/注册/查询中心
- `NexusToolInstaller`：安装/卸载管理（全生命周期）
- `scan_nexus_tools`：自动扫描工具
- `DCCEntry` 统一数据模型：`[{dcc, minVersion?, maxVersion?}]`
- Tool ID 为 UUID v4 GUID

### Nexus-Tool 三态触发系统

- **无触发器**：手动执行
- **启动触发**：随 DCC 启动自动触发
- **禁用触发**：已安装但暂停
- `is_enabled` 字段仅控制触发器，不影响手动调用

### Sidecar RPC

- `nexus_tool_rpc.py`：工具发现与执行 RPC
- `trigger_dispatcher.py`：三态触发规则分发
- `tool_sources.py`：工具源发现

### 工具体系（8 个 Tools）

| 分类 | 数量 | 内容 |
|------|------|------|
| 官方 Tools | 2 个 | skill-compliance-checker / tool-compliance-checker |
| Marketplace Tools | 6 个 | Blender 对象命名检查 / SM 命名检查 / UV 贴图利用率优化（2个）/ 模型批量加前后缀 / 资产批量改名 |

### 诊断工具

- `diagnose_dcc_tool_run.py`：DCC 工具执行问题诊断脚本

### Web UI

- ToolDetailPanel：工具详情面板
- NexusToolList：工具列表浏览
- 与 Skills UI 共享通用组件（ItemCard 等）

## 子节点（STORY 列表，全部完成）

| # | STORY | 状态 |
|---|-------|------|
| S1 | STORY-0045 — NexusToolRegistry + NexusToolInstaller | ✅ done |
| S2 | STORY-0046 — Sidecar RPC（共享） | ✅ done |
| S3 | STORY-0047 — Web UI 接线（共享） | ✅ done |

## 进展日志

- 2026-05-28 **标记完成**：Nexus-Tool 注册表/安装器/触发系统/Web UI 完整，8 个 Tools 就绪
- 2026-05-15 align 完成
- 2026-05-04 created
