---
id: TASK-0054
title: 编写信息队列修复方案文档
status: review
priority: P2
owner: "@产品经理"
assignee: ai
estimate: 0.5d
created: 2026-05-13
updated: 2026-05-13
related_specs: [[../../inbox/message-queue-fix]]
related_packages: [packages/apps/web]
tags: [task, spec, chat, bugfix]
---

# 编写信息队列修复方案文档

## 背景与目标
用户报告信息队列三个缺陷（消息丢失、WS 断连发送被吞、队列残留），需要编写完整修复方案文档。文档落位 `docs/inbox/message-queue-fix.md`，覆盖全部三个问题的根因分析、修复方案和验收标准。

## 验收标准
- [x] 方案文档包含三个问题的代码级根因定位（文件路径 + 行号）
- [x] 明确"合并发送"功能的设计细节（勾选=换行拼接，不勾选=顺序逐条）
- [x] 列出全部涉及文件和变更范围
- [x] 验收标准可量化、可逐条验证

## 设计要点
- 引用 [[../../inbox/message-queue-fix]]
- 合并格式确认为方案 A（纯 `\n` 拼接），不加序数前缀
- 涉及两层队列：chat-service `pendingQueue` + gateway-ws `_pendingSendQueue`

## 进展日志
- 2026-05-13 源码分析完成（gateway-ws.ts, chat-service.ts, ChatView.tsx）
- 2026-05-13 方案文档编写完成，提交审核
- 2026-05-13 程序审核：有条件通过 → 方案已更新（轻量去重+合并上限）
- 2026-05-13 QA 审核：不通过 → 方案已修正 6 P1 + 3 P2，重新提交复审
- 2026-05-13 新增 §2.4 + §3.6：假连接状态（_eventLoopDegraded 悲观初始化）+ 空回复修复（START_STREAMING 延迟）
