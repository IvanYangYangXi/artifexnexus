---
id: STORY-0024
kind: story
title: Gateway �?MCP 工具注册 �?mcp_blender_run_python
status: done
priority: P1
owner: "@ivan"
assignee: pair
estimate: 0.5d
created: 2026-05-08
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "packages/adapters/openclaw/gateway-plugin"
tags: [story, gateway, mcp, blender, M2]
---

# STORY-0024 · Gateway �?MCP 工具注册

## 用户故事
作为 AI Agent，我能在 OpenClaw 对话中直接调�?`mcp_blender_run_python` 工具，Gateway 将请求转发到 Blender MCP Server�?
## 验收标准
- [ ] Gateway 启动时自动连�?Blender MCP Server（`ws://127.0.0.1:{port}`�?- [ ] 注册 `mcp_blender_run_python` 工具�?OpenClaw MCP 命名空间
- [ ] 工具调用�?Gateway 转发 `tools/call` �?Blender MCP Server，返回结�?- [ ] Blender MCP Server 不可用时工具返回友好错误信息
- [ ] 单元测试覆盖工具注册 + 转发逻辑

## 技术要�?- 参�?`artclaw_bridge/subprojects/DCCClawBridge/core/bridge_dcc.py` 中的 MCP 工具前缀映射
- 工具命名：`mcp_blender_run_python`（遵�?`mcp_{dcc}_{tool}` 命名规范�?- Gateway 作为 MCP 客户端连�?Blender MCP Server
- 转发逻辑：接�?`tools/call` �?转发�?Blender WS �?返回结果
