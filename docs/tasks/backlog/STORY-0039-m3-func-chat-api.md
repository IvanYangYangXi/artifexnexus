---
id: STORY-0039
kind: story
title: M3-FUNC-01 · Chat 功能接线（API + WebSocket 流式）
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/web-chat-structure]]"
related_packages:
  - "packages/apps/web"
  - "packages/adapters/openclaw"
tags: [story, chat, api, websocket, streaming, M3]
---

# STORY-0039 · Chat 功能接线（API + WebSocket 流式）

## 用户故事
在 Chat 界面输入消息后，能通过 OpenClaw API 发送并接收流式回复，工具调用卡片实时更新。

## 验收标准
- [ ] 对接 OpenClaw Chat API（`POST /v1/chat/completions`）
- [ ] WebSocket 流式接收（SSE 或 WS），逐 token 渲染
- [ ] 工具调用卡片实时显示：⏳ → ✅/❌ + 耗时
- [ ] 对话状态机完整运行：Idle → Sending → Streaming → ToolExecuting → Idle
- [ ] 停止按钮可用（中断流式）
- [ ] 恢复按钮可用（继续生成）
- [ ] 队列发送：生成中按发送 → 排队 → 自动发送
- [ ] 错误处理：网络断开/Gateway 不可用 → 错误提示 + 重试
- [ ] 对话持久化（localStorage 或 IndexedDB）

## 依赖
- ← STORY-0034（Chat 模块 UI）
- ← STORY-0038（Desktop 内嵌）

## 非范围
- 多模态（图片/文件上传）
- 对话搜索
