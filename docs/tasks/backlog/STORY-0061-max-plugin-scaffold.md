---
id: STORY-0061
kind: story
title: 3ds Max 插件脚手架 & Adapter
status: backlog
priority: P1
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-05-25
updated: 2026-05-25
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_adr: [0006]
related_specs: ["../../specs/maya-max-mcp-integration", "../../specs/dcc-plugin-management"]
related_packages: ["packages/dcc/max", "packages/dcc/shared"]
tags: [story, dcc, 3ds_max, mcp]
---

# 3ds Max 插件脚手架 & Adapter

## 背景与目标

参照 Blender 插件架构（[[STORY-0021-blender-addon-scaffold]]），为 3ds Max 创建 MCP WebSocket Server + DCC Adapter + 触发器系统。使用共享 SDK 的 `BaseDCCAdapter` 和 `MCPServer`。

## 范围 / 非范围

- 范围：`packages/dcc/max/` 目录结构 + `__init__.py` / `max_adapter.py` / `trigger_dispatcher.py` / `startup.py` / `artifex_startup.ms`
- 非范围：Max 内 Chat UI、Max SDK API 封装

## 验收标准

- [ ] `packages/dcc/max/` 目录结构创建完成
- [ ] `__init__.py`：菜单栏注册 + 启动/停止 MCP Server + 触发器开关
- [ ] `max_adapter.py`：继承 BaseDCCAdapter，主线程调度用 `pymxs.runtime.callbacks`（参考 artclaw 实现）
- [ ] `startup.py`：Python 启动脚本（自动启动 MCP Server）
- [ ] `artifex_startup.ms`：MaxScript 启动脚本
- [ ] `trigger_dispatcher.py`：Max 事件钩子（`#filePostSave` / `#filePostOpen`）
- [ ] CI 兼容：`pymxs` 导入失败时暴露空壳

## 设计要点

- 主线程调度：通过 `pymxs.runtime.callbacks.addScript #timeout` 消费队列（无原生 API）
- 上下文变量：`S=pymxs.runtime.selection`, `W=maxFilePath+maxFileName`, `L=pymxs.runtime`, `rt=pymxs.runtime`
- 安装路径：`%LOCALAPPDATA%/Autodesk/3dsMax/{ver}/ENU/scripts/artifex_nexus/`
- 入口方式：`scripts/startup/` 自动加载机制
- Locale 同步：全 locale 目录（ENU/CHS/JPN 等）

## 子任务（TASK 列表）

- [ ] 创建 `packages/dcc/max/` 目录结构 + `pyproject.toml`
- [ ] 编写 `__init__.py`（菜单栏注册 + 对话框 + CI 空壳）
- [ ] 编写 `max_adapter.py`
- [ ] 编写 `startup.py` + `artifex_startup.ms`
- [ ] 编写 `trigger_dispatcher.py`

## 进展日志

- 2026-05-25 created
