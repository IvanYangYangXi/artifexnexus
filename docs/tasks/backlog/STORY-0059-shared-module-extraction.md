---
id: STORY-0059
kind: story
title: 共享模块提取（BaseAdapter + MCPServer → shared SDK）
status: backlog
priority: P1
owner: "@ivan"
assignee: ai
estimate: 1d
created: 2026-05-25
updated: 2026-05-25
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_adr: [0006]
related_specs: ["../../specs/maya-max-mcp-integration", "../../specs/dcc-plugin-management"]
related_packages: ["packages/dcc/shared", "packages/dcc/blender"]
tags: [story, dcc, shared, refactor]
---

# 共享模块提取

## 背景与目标

Maya/Max 插件需要复用 Blender 的 `base_adapter.py` 和 `mcp_server.py`。
将两者提升到 `packages/dcc/shared/artifex_nexus_sdk/`，实现单一源（ADR "SDK 单一源"）。

## 范围 / 非范围

- 范围：提取 `base_adapter.py` 和 `mcp_server.py` 到 shared SDK，参数化 DCC 相关字段
- 非范围：不改变 Blender 插件的运行时行为

## 验收标准

- [ ] `base_adapter.py` 移到 `packages/dcc/shared/artifex_nexus_sdk/`，增加 `from __future__ import annotations`
- [ ] `mcp_server.py` 核心类提取到 shared SDK，`MCPServer` 构造函数接受 `server_name`/`server_version`/`port` 参数
- [ ] `register_builtin_tools()` 保留在 Blender 侧（工具描述与 DCC 绑定）
- [ ] Blender `blender_adapter.py` 改为 `from artifex_nexus_sdk.base_adapter import BaseDCCAdapter`
- [ ] Blender `mcp_server.py` 改为 `from artifex_nexus_sdk.mcp_server import MCPServer`
- [ ] Blender 插件功能无回归

## 设计要点

- 引用 [[../../specs/maya-max-mcp-integration]] §2.3 共享模块架构
- `MCPServer.__init__(self, dcc_name, dcc_version, port, ...)` — 参数化
- `broadcast_trigger_event()` 中的 `dcc` 字段由 `self.dcc_name` 填充

## 子任务（TASK 列表）

- [ ] 复制 `base_adapter.py` → `shared/artifex_nexus_sdk/base_adapter.py` + 添加 `__future__` 导入
- [ ] 提取 `MCPServer` 类 → `shared/artifex_nexus_sdk/mcp_server.py`
- [ ] Blender `mcp_server.py` 改为 `MCPServer(dcc_name="blender", dcc_version="5.0.0", port=18083)`
- [ ] Blender `blender_adapter.py` import 路径更新
- [ ] 验证 Blender 入口 `__init__.py` 兼容新 import

## 进展日志

- 2026-05-25 created
