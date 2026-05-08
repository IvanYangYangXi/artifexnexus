---
id: STORY-0021
kind: story
title: Blender 插件骨架 — 侧栏面板 + 启动/停止按钮
status: review
priority: P1
owner: "@ivan"
assignee: pair
estimate: 0.5d
created: 2026-05-08
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "packages/dcc/blender"
tags: [story, blender, addon, M2]
---

# STORY-0021 · Blender 插件骨架

## 用户故事
作为用户，我能在 Blender 侧栏看到 Artifex Nexus 面板，点击"启动"按钮后 MCP Server 开始监听。

## 验收标准
- [ ] Blender 侧栏（N 面板）出现 "Artifex Nexus" 标签页
- [ ] 面板显示：状态指示灯（红/绿）、启动/停止按钮、端口号
- [ ] 点击"启动"→ 状态变绿，显示 `ws://127.0.0.1:{port}`
- [ ] 点击"停止"→ 状态变红，端口释放
- [ ] 关闭 Blender 时自动停止 MCP Server

## 技术要点
- 复刻 `artclaw_bridge/subprojects/DCCClawBridge/blender_addon.py`
- 精简：去掉 Qt Bridge、事件拦截、Tool Manager 相关代码
- 保留：`bpy.types.Panel` + `bpy.utils.register_class` 注册模式
- 面板布局：`bl_info` → `register()` → `unregister()`
