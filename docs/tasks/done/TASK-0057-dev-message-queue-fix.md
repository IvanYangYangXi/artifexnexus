---
id: TASK-0057
title: 开发信息队列修复
status: done
priority: P2
owner: "@程序"
assignee: ai
estimate: 1d
created: 2026-05-13
updated: 2026-05-13
related_specs: [[../../inbox/message-queue-fix]]
related_packages: [packages/apps/web]
tags: [task, dev, chat, bugfix]
---

# 开发信息队列修复

## 背景与目标
根据 `docs/inbox/message-queue-fix.md` §3 修复方案，在应用中实现五层修复：
1. 合并发送功能（§3.1）
2. WS 断连发送检查修复（§3.2）
3. 队列清理（§3.3）
4. 假连接状态 + 空回复修复（§3.6）
5. 并发回放竞争（§3.5 — 已有机制，确认无额外工作）

## 验收标准
- [ ] `gateway-ws.ts` `_replayQueuedSends()`：改为轻量去重（相同 sessionKey + 完全相同 message 文本，纯字符串比对不做语义判断 → 5s 窗口内保留最新），按 mergeEnabled 决定拼接或顺序回放
- [ ] `gateway-ws.ts` `_enqueueChatSend()`：保留现有连续相同内容去重（line 401-408），防止重复点击
- [ ] `gateway-ws.ts` 合并回放：单次合并上限 10 条，超过则分批（10条/批，批间等待 FINISH_STREAMING）
- [ ] `chat-service.ts` `sendMessage()`：移除 isSendReady() 前置阻断，始终调用 ws.sendChat()
- [ ] `chat-service.ts` `processQueue()`：支持合并模式（\n 拼接，上限 10 条）和顺序模式（原有行为）
- [ ] `chat-service.ts` `RESET_STATE`：清理 pendingQueue
- [ ] `ChatInputArea.tsx`：新增"合并发送"checkbox（默认勾选）
- [ ] `ChatView.tsx`：透传 mergeEnabled 状态 + 持久化 localStorage
- [ ] `chat-service.ts` `sendMessage()`：将 START_STREAMING 延迟到 sendChat() 成功之后，失败时不创建占位气泡
- [ ] `gateway-ws.ts` `_setState("connected")`：`_eventLoopDegraded` 默认初始化改为 `true`（悲观），等首次 health 确认
- [ ] `gateway-ws.ts` `STARTUP_GRACE_MS`：从 15000ms 缩短到 3000ms
- [ ] TypeScript 编译零错误
- [ ] `pnpm -C packages/apps/web build` 构建通过

## 设计要点
- 引用 [[../../inbox/message-queue-fix]]
- 合并发送通过 `chat-service` 新增 `mergeEnabled` state 控制
- mergeEnabled 持久化到 localStorage，键名 `artifex.chat.mergeSend`
- 轻量去重：`_replayQueuedSends()` 基于 Map<sessionKey, Map<message内容, 最新item>> 实现 5s 窗口内去重
- 合并批上限：10 条/批，超出分批发（批间 100ms setTimeout）
- `_enqueueChatSend` 现有去重逻辑（line 401-408：连续相同内容阻止重复压栈）保持不变
- **假连接修复**：`_eventLoopDegraded` 在 `_setState("connected")` 中设为 `true`（悲观），首次 health 事件确认后更新为真实值
- **空回复修复**：`sendMessage()` 仅在 `sendChat() === true` 时 dispatch START_STREAMING
- **宽限期**：`STARTUP_GRACE_MS` 从 15s 缩短到 3s，匹配 health 事件最大到达延迟

## 进展日志
- 2026-05-13 等待 TASK-0055、TASK-0056 审核通过后启动
- 2026-05-13 方案文档已按程序审核反馈更新：轻量去重替代完全移除、合并上限 10 条/批
- 2026-05-13 QA 复审通过，TASK-0055 + TASK-0056 均 done，解除阻塞，迁入 ready
- 2026-05-13 开发完成：TypesScript 编译零错误。变更涉及 chat-service.ts、gateway-ws.ts、ChatInputArea.tsx、ChatView.tsx
