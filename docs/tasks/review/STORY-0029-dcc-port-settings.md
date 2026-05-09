---
id: STORY-0029
kind: story
title: DCC 端口设置 — 父行设置按钮弹出端口配置
status: review
priority: P2
owner: "@ivan"
assignee: pair
estimate: 0.5d
created: 2026-05-09
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "apps/desktop/src"
  - "packages/dcc/blender"
tags: [story, dcc, port, settings, M2]
---

# STORY-0029 · DCC 端口设置

## 用户故事
作为用户，我能在安装向导中点击 DCC 父行的"设置"按钮，弹出端口配置对话框，修改 Blender MCP Server 端口和 mcp-bridge 连接端口。

## 验收标准
- [ ] DCC 父行"设置"按钮弹出端口配置对话框
- [ ] 对话框显示当前端口（默认 18083）
- [ ] 修改端口后同步更新：
  - Blender MCP Server 端口（重启后生效）
  - mcp-bridge 配置中的 `url`（`openclaw.json`）
- [ ] 端口冲突检测：修改前检查新端口是否被占用
- [ ] 取消不保存

## 技术要点
- 新增 `PortSettingsDialog.tsx` 组件
- 父行 `handleSettings` 改为弹出对话框（当前无作用）
- sidecar RPC：`openclaw.dcc.{dcc}.port.set` / `openclaw.dcc.{dcc}.port.get`
- 修改 `openclaw.json` 中 `plugins.entries.mcp-bridge.config.servers.{dcc}.url`
