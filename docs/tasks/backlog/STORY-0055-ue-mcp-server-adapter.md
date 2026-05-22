---
id: STORY-0055
kind: story
title: Python MCP Server & UE Adapter
status: backlog
priority: P0
owner: "@ivan"
assignee: ai
estimate: 2.5d
created: 2026-05-22
updated: 2026-05-22
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_specs: ["[[../../specs/ue57-mcp-integration]]"]
related_packages: ["packages/dcc/unreal", "packages/dcc/blender"]
tags: [story, unreal, mcp, python]
---

# Python MCP Server & UE Adapter

## 背景与目标

参考 Blender 的 `mcp_server.py` + `blender_adapter.py` 实现，
为 UE 构建 Python MCP WebSocket 服务器和主线程适配器。
这是 AI Agent 通过 OpenClaw Gateway 操作 UE 的核心通道。

## 范围 / 非范围

- 范围：MCP WebSocket Server、UE Adapter 主线程调度、run_python 工具、get_editor_context
- 非范围：触发器广播（STORY-0056）、Skill Hub/KB 集成（STORY-0058）

## 验收标准

### MCP Server (mcp_server.py)

- [ ] WebSocket 服务器监听 `127.0.0.1:18080`
- [ ] JSON-RPC 2.0 协议，MCP 2024-11-05 规范
- [ ] 处理 `initialize` → 返回 serverInfo + capabilities
- [ ] 处理 `tools/list` → 返回 `run_python` + `get_editor_context`
- [ ] 处理 `tools/call` → 参数校验 + 调度到主线程执行
- [ ] 处理 `ping` → pong
- [ ] 支持多客户端并发连接（记录数量到 Subsystem）
- [ ] `broadcast_trigger_event(event_payload)` 向所有已连接客户端广播
- [ ] asyncio 事件循环通过 `unreal.register_slate_post_tick_callback` 驱动
- [ ] 启动/停止接口: `mcp_server.start()` / `mcp_server.stop()`
- [ ] 优雅关闭：停止时关闭所有活跃连接
- [ ] 日志输出到 UE Output Log（LogArtifexNexus_MCP/LogArtifexNexus_Error）

### run_python 工具

- [ ] 输入参数: `code: string`, `get_context: boolean`
- [ ] `get_context=true` 时仅返回编辑器上下文（选中对象/世界/面板等）
- [ ] `code` 在被持久化命名空间中执行
- [ ] 预注入变量: `S` (选中对象) / `W` (编辑器世界) / `L` (unreal 模块) / `C` (编辑器上下文) / `UE` (unreal 别名)
- [ ] 代码通过 `UEAdapter.execute_on_main_thread()` 在 Game Thread 执行
- [ ] 捕获 stdout 输出并返回
- [ ] 30s 超时保护
- [ ] 异常时返回错误信息

### UE Adapter (ue_adapter.py)

- [ ] `UEAdapter.execute_on_main_thread(fn, *args)` 阻塞等待执行完毕
- [ ] 基于 `queue.Queue` + `threading.Event` + `unreal.register_slate_post_tick_callback`
- [ ] 回调在主线程每帧消费队列（最多 10 个/帧, 与 Blender 一致）
- [ ] 30s 超时保护
- [ ] 持久化命名空间 `exec(code, ns)` 跨调用保持变量
- [ ] BaseDCCAdapter 抽象接口兼容（get_software_name/get_software_version/get_python_version 等）
- [ ] 参考 Blender `blender_adapter.py` 的结构设计

## 设计要点

- 参考 Blender 实现的 `mcp_server.py` 和 `blender_adapter.py`
- UE 主线程调度与 Blender 关键差异: 用 `register_slate_post_tick_callback` 代替 `bpy.app.timers`
- MCP Server 与 artclaw `ue_mcp_server.py` 的关键差异:
  - 不在 MCP Server 内注册多个工具（只注册 `run_python` + `get_editor_context`）
  - 不使用 `@ue_agent.tool` 装饰器（Skill 通过 run_python 调用）
  - WebSocket 库: 使用 Python 标准 `asyncio` + `websockets` 第三方库
- 第三方库依赖检查：需要在 UE Python 环境中预先安装 `websockets` 包

## 子任务

- [ ] 创建 `mcp_server.py`（参考 Blender 实现）
- [ ] 创建 `ue_adapter.py`（参考 Blender adapter）
- [ ] 创建 `base_adapter.py`（从 Blender 复制，通用接口）
- [ ] 实现 MCPServer 类（asyncio 事件循环 + WebSocket 处理）
- [ ] 实现 JSON-RPC 2.0 处理（initialize/tools_list/tools_call/ping）
- [ ] 实现 run_python handler（代码执行 + 上下文注入）
- [ ] 实现 get_editor_context handler
- [ ] 实现 UEAdapter 主线程调度
- [ ] 实现 Slate Post Tick 回调注册
- [ ] 实现 broadcast_trigger_event
- [ ] 端口配置可读取（环境变量或配置文件）
- [ ] 单元测试（pytest, mock unreal）

## 进展日志

- 2026-05-22 created
