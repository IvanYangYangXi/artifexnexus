---
id: STORY-0060
kind: story
title: Maya 插件脚手架 & Adapter
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
related_packages: ["packages/dcc/maya", "packages/dcc/shared"]
tags: [story, dcc, maya, mcp]
---

# Maya 插件脚手架 & Adapter

## 背景与目标

参照 Blender 插件架构（[[STORY-0021-blender-addon-scaffold]]），为 Maya 创建 MCP WebSocket Server + DCC Adapter + 触发器系统。使用共享 SDK 的 `BaseDCCAdapter` 和 `MCPServer`。

## 范围 / 非范围

- 范围：`packages/dcc/maya/` 目录结构 + `__init__.py` / `maya_adapter.py` / `trigger_dispatcher.py` / `mcp_server.py`
- 非范围：Maya 内 Chat UI、Maya SDK API 封装

## 验收标准

- [ ] `packages/dcc/maya/` 目录结构创建完成
- [ ] `__init__.py`：Shelf Button / Menu 注册 + 启动/停止 MCP Server + 触发器开关
- [ ] `maya_adapter.py`：继承 BaseDCCAdapter，主线程调度用 `maya.utils.executeInMainThreadWithResult`
- [ ] `mcp_server.py`：从 SDK 导入 MCPServer，绑定 Maya 内置工具（`run_python` + `get_editor_context`），端口 18081
- [ ] `trigger_dispatcher.py`：Maya 事件钩子（`MSceneMessage.kAfterSave` / `kAfterOpen`）
- [ ] CI 兼容：`maya.cmds` 导入失败时暴露空壳 `register()` / `unregister()`

## 设计要点

- 主线程调度：Maya 原生 `executeInMainThreadWithResult()`，比 Blender queue+timer 简单
- 上下文变量：`S=maya.cmds.ls(sl=True)`, `W=file(q=True, sn=True)`, `L=maya.cmds`, `maya=maya`, `pymel=pymel.core`
- 安装路径：`~/Documents/maya/{ver}/scripts/artifex_nexus/`
- Locale 同步：扫描 `xx_XX/scripts/` 子目录 junction

## 子任务（TASK 列表）

- [ ] 创建 `packages/dcc/maya/` 目录结构 + `pyproject.toml`
- [ ] 编写 `__init__.py`（Shelf/Menu UI + 生命周期 + CI 空壳）
- [ ] 编写 `maya_adapter.py`
- [ ] 编写 `mcp_server.py`（从 SDK 导入 + 内置工具注册）
- [ ] 编写 `trigger_dispatcher.py`

## 进展日志

- 2026-05-25 created
