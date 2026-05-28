---
id: EPIC-0006
kind: epic
title: M6 · 定制记忆
status: done
priority: P2
owner: "@ivan"
assignee: pair
estimate: 2w
created: 2026-05-04
updated: 2026-05-28
completed: 2026-05-28
parent: "[[../../vision/roadmap]]"
milestone: M6
related_adr: []
related_specs: []
related_packages:
  - "packages/platform/core"
  - "packages/apps/web"
tags: [epic, memory, M6, done]
---

# M6 · 定制记忆 ✅ DONE

## 背景与目标

引入可配置的记忆子系统；Web UI 暴露管理面板（查看 / 清理 / 策略），实现会话跨次保留。

## 实际交付

### 三层记忆体系

| 层级 | 范围 | 实现 | 功能 |
|------|------|------|------|
| Layer 1：Cloud Memory | 全局（服务端） | 服务端自动注入 + conversation_search 工具 | 长期用户画像 + 历史对话检索 |
| Layer 2：User-level Local Memory | 跨项目 | `~/.workbuddy/MEMORY.md`（读写） | 精确、强制的用户级规则 |
| Layer 3：Workspace Memory | 当前项目 | `.workbuddy/memory/YYYY-MM-DD.md`（追加）+ `.workbuddy/memory/MEMORY.md`（长期） | 项目级日志 + 持久化约定 |

### 会话管理

- 会话持久化（IndexedDB）
- 跨次读写：关闭重开后恢复上次会话
- 会话自动清理：
  - 空会话 >24h + 无 transcript → 自动删除
  - 过期 >30d → 自动删除
  - 静默清理，不阻塞 UI

### 清理策略

1. 下拉过滤：无 transcript 且创建 >24h 的会话从下拉列表隐藏
2. 延迟批量删除：30s 后 IndexedDB 批量删除
3. localStorage 清理
4. chat-service 内存清理

### 工作记忆系统

- 项目记忆文件（`D:\MyProject_D\artifexnexus\.workbuddy\memory\`）
- 每日日志（appending-only）
- 长期项目笔记（curated）
- 跨项目用户偏好（`~/.workbuddy/MEMORY.md`）

## 可分发定义（DoD）

- [x] 关闭重开会话后可读到上次上下文
- [x] 可在 UI 清理 / 调策略
- [x] 会话自动清理机制运行正常

## 进展日志

- 2026-05-28 **标记完成**：三层记忆体系完整，会话持久化+自动清理就绪
- 2026-05-04 created
