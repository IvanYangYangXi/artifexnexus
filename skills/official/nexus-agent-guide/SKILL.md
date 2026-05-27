---
name: nexus-agent-guide
description: >
  Artifex Nexus Agent integration guide — a layered rule index.
  Covers notification APIs (toast + bell), cron task reply configuration,
  and platform conventions. Sub-documents are split by topic for on-demand reading.
  Use when AI needs to: (1) send toast/bell notifications from scripts or cron,
  (2) configure cron task reply delivery, (3) understand platform API surface.
  NOT for: DCC-specific operations (use blender-operation-rules etc.),
  Nexus-Tool management (use nexus-tool-creator), skill management
  (use nexus-skill-manage).
metadata:
  artifex_nexus:
    version: 1.0.0
    author: Artifex Nexus
    software: all
    tags: ["agent", "api", "cron", "notification", "integration", "rules"]
    risk_level: low
---

# Artifex Nexus Agent 规则指引

提供给 Agent 使用的 Artifex Nexus 平台规则和 API 指引。采用**分层文档结构**：入口索引 → 规则概述 → 详细子文档，按需读取避免浪费 token。

---

## 读取策略

1. **先读本文件** — 了解有哪些规则、什么时候需要加载子文档
2. **按需读子文档** — 只读当前任务需要的规则，不要一次全部加载
3. **api-reference.md 最后读** — 仅在需要精确 API 参数时查阅

---

## 规则索引

| 规则 | 文档 | 何时加载 |
|------|------|----------|
| **通知系统**（气泡 + 铃铛） | `rules/notifications.md` | 需要发 toast/铃铛通知时 |
| ├ 通道 A：Python 文件桥接 | `rules/notifications-python.md` | 外部 Python 脚本发送通知 |
| ├ 通道 B：Gateway WebSocket | `rules/notifications-gateway.md` | cron 任务通过 WS 发送通知 |
| └ 通道 C：Tauri IPC | `rules/notifications-tauri.md` | 桌面应用内前端代码通知 |
| **Cron 回复配置** | `rules/cron-reply.md` | 配置 cron 任务的会话投递 |
| **API 参考文档** | `api-reference.md` | 需要精确 API 参数时 |

---

## 常见场景速查

| 场景 | 加载文档 |
|------|----------|
| 外部 Python 脚本想弹 toast | `rules/notifications.md` → `rules/notifications-python.md` |
| cron 任务执行完想通知用户 | `rules/notifications.md` → `rules/notifications-gateway.md` |
| 配置 cron 任务让它回复到当前会话 | `rules/cron-reply.md` |
| 在 Tauri 前端代码里发通知 | `rules/notifications-tauri.md` |
| 查某个 API 的精确参数格式 | `api-reference.md` |
