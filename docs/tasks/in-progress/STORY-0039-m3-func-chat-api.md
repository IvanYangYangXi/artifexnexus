---
id: STORY-0039
kind: story
title: M3-FUNC-01 · Chat 功能接线（API + WebSocket 流式）
status: in-progress
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
- [x] 对接 OpenClaw Chat API（`POST /v1/chat/completions`）— WebSocket 全双工协议
- [x] WebSocket 流式接收（SSE 或 WS），逐 token 渲染 — GatewayWebSocket 客户端
- [ ] 工具调用卡片实时显示：⏳ → ✅/❌ + 耗时 — 待 Gateway 联调时验证
- [x] 对话状态机完整运行：Idle → Sending → Streaming → ToolExecuting → Idle
- [x] 停止按钮可用（中断流式）— chat.abort RPC
- [x] 恢复按钮可用（继续生成）— Resume 按钮 + 自动恢复
- [x] 队列发送：生成中按发送 → 排队 → 自动发送
- [x] 错误处理：网络断开/Gateway 不可用 → 错误提示 + 重试
- [x] 对话持久化（localStorage 或 IndexedDB）— localStorage 即时可用 + IndexedDB 层就绪

## 前置任务（已记录）
- [x] 移除左下角头像旁的设置按钮（B3 区域）
- [x] 启动时自动检测 OpenClaw：已安装→自动启动 Gateway；未安装→跳转系统面板+弹窗
- [x] 自动恢复：WebSocket 重连后检测未完成流式消息自动续写

## 实施日志
- 2026-05-11 16:18 开始 STORY-0039
- 2026-05-11 前置任务完成：移除 B3 设置按钮 + 启动自动检测
- 2026-05-11 核心实现完成：GatewayWebSocket + ChatService + ChatView 接入
- 2026-05-11 TypeScript 编译通过，Next.js build 通过

## 依赖
- ← STORY-0034（Chat 模块 UI）
- ← STORY-0038（Desktop 内嵌）

## 非范围
- 多模态（图片/文件上传）
- 对话搜索
