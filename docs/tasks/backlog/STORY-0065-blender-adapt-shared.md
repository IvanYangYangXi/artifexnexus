---
id: STORY-0065
kind: story
title: Blender 适配共享模块
status: backlog
priority: P2
owner: "@ivan"
assignee: ai
estimate: 0.5d
created: 2026-05-25
updated: 2026-05-25
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_adr: [0006]
related_specs: ["../../specs/maya-max-mcp-integration"]
related_packages: ["packages/dcc/blender", "packages/dcc/shared"]
tags: [story, blender, refactor]
---

# Blender 适配共享模块

## 背景与目标

STORY-0059 将 `base_adapter.py` 和 `mcp_server.py` 提升到了 shared SDK。
Blender 插件的 import 路径需要同步更新，并删除本地副本。

## 范围 / 非范围

- 范围：Blender addon 的 import 路径更新 + 删除源文件副本
- 非范围：不改变 Blender 插件运行时行为

## 验收标准

- [ ] `blender_adapter.py` import 更新：`from artifex_nexus_sdk.base_adapter import BaseDCCAdapter`
- [ ] `mcp_server.py` import 更新：`from artifex_nexus_sdk.mcp_server import MCPServer`
- [ ] `__init__.py` 确保 SDK 在 sys.path 中
- [ ] 删除 `blender_addon/base_adapter.py`（已提升到 shared）
- [ ] 确保 SDK 模块在 Blender addon 安装时同步部署

## 设计要点

- SDK 路径确保：安装时需要额外复制 `artifex_nexus_sdk/` 模块
- 或通过 sys.path 注入指向 `packages/dcc/shared/`

## 子任务（TASK 列表）

- [ ] `blender_adapter.py` import 路径更新
- [ ] `mcp_server.py` 改为从 SDK 导入
- [ ] `__init__.py` 确保 sys.path 包含 SDK 路径
- [ ] 删除 `base_adapter.py` 本地副本
- [ ] 验证 Blender addon 注册/注销功能

## 进展日志

- 2026-05-25 created
