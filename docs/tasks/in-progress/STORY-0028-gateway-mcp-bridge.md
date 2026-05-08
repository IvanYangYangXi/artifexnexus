---
id: STORY-0028
kind: story
title: Gateway MCP Bridge 插件 — WebSocket→OpenClaw 桥接
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1d
created: 2026-05-08
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "packages/adapters/openclaw/gateway-plugin"
tags: [story, mcp, gateway, bridge, blender, M2]
---

# STORY-0028 · Gateway MCP Bridge 插件

## 用户故事
作为 AI Agent，我能在 OpenClaw 对话中调用 `mcp_blender-editor_run_python` 工具，Gateway 通过 mcp-bridge 插件将请求转发到 Blender MCP Server。

## 验收标准
- [ ] 复刻 artclaw `platforms/openclaw/gateway/index.ts` 的 mcp-bridge 插件
- [ ] 支持 WebSocket 连接 Blender MCP Server
- [ ] 自动 tools/list → 注册到 OpenClaw agent tools
- [ ] 支持 late discovery（Blender 后启动也能自动发现）
- [ ] 工具命名：`mcp_{server-name}_{tool-name}`（如 `mcp_blender-editor_run_python`）
- [ ] bootstrap 时自动写入 `plugins.entries.mcp-bridge` 配置
- [ ] Agent preset 的 `tools.allow` 添加 `mcp_blender-editor_*`
- [ ] 安装 Blender 插件时自动写入 `mcp-bridge.config.servers.blender-editor`

## 技术要点
- 复刻 `artclaw_bridge/platforms/openclaw/gateway/index.ts`
- 精简：去掉多 DCC 支持（只保留 Blender），去掉 RetryTracker
- 插件目录：`packages/adapters/openclaw/gateway-plugin/`
- 部署方式：symlink 到 `~/.openclaw/plugins/mcp-bridge/`
