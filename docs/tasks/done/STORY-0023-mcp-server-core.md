---
id: STORY-0023
kind: story
title: MCP Server �?WebSocket 服务 + run_python 工具
status: done
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1d
created: 2026-05-08
updated: 2026-05-08
design_notes:
  - "2026-05-08: _execute_on_main_thread �?execute_deferred+Future 轮询改为 loop.run_in_executor(adapter.execute_on_main_thread)，消�?1s 轮询延迟，超�?30s �?adapter 层统一保护"
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "packages/dcc/blender"
tags: [story, mcp, websocket, blender, M2]
---

# STORY-0023 · MCP Server 核心实现

## 用户故事
作为 AI Agent，我能通过 WebSocket 连接�?Blender 中的 MCP Server，调�?`run_python` 工具执行 Blender Python 代码�?
## 验收标准
- [ ] MCP Server 在独立线程运�?asyncio 事件循环
- [ ] 支持 MCP 协议：`initialize` / `tools/list` / `tools/call` / `ping`
- [ ] 注册 `run_python` 工具，参�?`{code: string, get_context?: boolean}`
- [ ] `get_context=true` 时返回编辑器上下文（软件/版本/选中对象/场景信息�?- [ ] 端口自动探测�?083 起始，最多探�?10 个端口）
- [ ] 单元测试覆盖 MCP 协议握手 + tools/list + tools/call

## 技术要�?- 复刻 `artclaw_bridge/subprojects/DCCClawBridge/core/mcp_server.py`
- 精简：去�?RetryTracker、MemoryStore、SkillRuntime、Bridge UI 信号、IMAGE 标记解析
- 保留：MCPServer �?+ WebSocket 连接处理 + MCP 协议路由 + 端口探测
- 保留：`_register_builtin_tools` 中的 `run_python` 工具注册
- 保留：`_execute_on_main_thread` 主线程调度（通过 adapter�?- **设计优化**：主线程调度�?`execute_deferred` + `Future` 轮询改为 `loop.run_in_executor` + `adapter.execute_on_main_thread`，消�?1s 轮询延迟，超时由 adapter �?30s 统一保护，依赖改�?`_adapter_ref` 直调
