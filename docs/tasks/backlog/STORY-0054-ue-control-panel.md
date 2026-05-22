---
id: STORY-0054
kind: story
title: 简单控制面板
status: backlog
priority: P1
owner: "@ivan"
assignee: ai
estimate: 1d
created: 2026-05-22
updated: 2026-05-22
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_specs: ["[[../../specs/ue57-mcp-integration]]"]
related_packages: ["packages/dcc/unreal"]
tags: [story, unreal, ui, panel]
---

# 简单控制面板

## 背景与目标

提供一个极简 Slate 面板用于：
1. 查看 MCP Server 运行状态（运行中/已停止、端口、客户端数）
2. 启动/停止 MCP Server
3. 启用/禁用触发器系统

不再提供 UE 内的 Chat/Agent/Skill/Tool 管理界面。

## 范围 / 非范围

- 范围：一个可停靠 Slate 面板 + 工具栏按钮 + 启动/停止操作符
- 非范围：Chat UI、Agent 管理、Skill 列表、Tool 配置（全部走 Web 端）

## 验收标准

- [ ] Window 菜单 + 工具栏注册按钮 "Artifex Nexus"
- [ ] 点击按钮打开可停靠面板 `SArtifexNexusPanel`
- [ ] 面板显示 MCP Server 状态指示灯（● 绿色运行 / ● 红色停止）
- [ ] 面板显示 WebSocket 地址 `ws://127.0.0.1:18080`（动态端口）
- [ ] 面板显示已连接客户端数量
- [ ] "启动 MCP Server" / "停止 MCP Server" 按钮（根据状态切换）
- [ ] 按钮调用 Python `mcp_server.start()` / `mcp_server.stop()`
- [ ] 触发器状态显示（☑ 已启用 / ☐ 已禁用）
- [ ] "启用触发器" / "禁用触发器" 切换按钮
- [ ] 按钮通过 `UArtifexNexusSubsystem` 读写触发器状态
- [ ] 面板显示插件版本号
- [ ] 插件禁用/卸载时自动停止 MCP Server + 清理触发器钩子
- [ ] 面板 UI 参考 Blender `ARTIFEX_PT_MainPanel` 设计风格

## 设计要点

- 参考 [[../../specs/ue57-mcp-integration]] §4.2 面板布局
- 使用 Slate `SHorizontalBox` / `SVerticalBox` 布局
- MCP Server 状态从 `UArtifexNexusSubsystem` 读取
- 操作通过 `GEngine->GetEngineSubsystem<UArtifexNexusSubsystem>()` 获取单例
- Python 命令通过 `GEditor->Exec()` 或 `FPythonScriptPlugin::Get()->ExecPythonCommand()` 执行

## 子任务

- [ ] 创建 `ArtifexNexusPanel.h/.cpp`
- [ ] 注册 Nomad Tab (`FGlobalTabmanager::Get()->RegisterNomadTabSpawner`)
- [ ] 注册工具栏按钮 (`UToolMenus`)
- [ ] 注册 Window 菜单项
- [ ] 实现 `SArtifexNexusPanel::Construct`
- [ ] 状态指示器 UI（连接状态 + 端口 + 客户端数）
- [ ] 启动/停止按钮 + 绑定 Python 命令
- [ ] 触发器开关按钮
- [ ] 在模块 `StartupModule/ShutdownModule` 注册/注销
- [ ] 编译验证

## 进展日志

- 2026-05-22 created
