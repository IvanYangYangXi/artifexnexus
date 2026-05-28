---
name: nexus-agent-guide
description: >
  Artifex Nexus Agent 平台操作指南 — 分层索引文档。
  覆盖平台五大能力板块（Chat / Skill / Tool / MCP-DCC / 通知）的操作指引。
  子文档按主题拆分，按需读取避免 token 浪费。
  Use when AI needs to: (1) understand platform capabilities and UI,
  (2) connect to DCC software via MCP, (3) manage skills and tools,
  (4) detect connection status, (5) send notifications.
  NOT for: DCC 软件内部 API 细节（用对应 DCC Skill 如 blender-operation-rules）。
metadata:
  artifex_nexus:
    version: 2.0.0
    author: Artifex Nexus
    software: all
    tags: ["agent", "api", "platform", "mcp", "dcc", "skill", "tool", "notification", "rules"]
    risk_level: low
---

# Artifex Nexus Agent 平台操作指南

提供给 Agent 使用的 Artifex Nexus 平台能力全览。采用 **分层文档结构**：
入口索引 → 能力概览 → 详细子文档，按需读取。

---

## 读取策略

1. **先读本文件** — 了解平台有哪些能力、子文档覆盖哪些主题
2. **按需读子文档** — 只加载当前任务需要的规则，不要一次全读
3. **能力速查 → 再查细节** — 先在对应子文档前 30 行判断是否匹配需求

---

## 平台能力索引

| 能力板块 | 文档 | 何时加载 |
|---------|------|----------|
| **平台总览** | `rules/platform-overview.md` | 首次进入平台、需要了解整体架构和 UI |
| **MCP 连接与 DCC 操作** | `rules/mcp-connections.md` | 需要操作 DCC 软件、调用 run_python |
| **连接状态感知** | `rules/connection-status.md` | 需要判断 DCC/Gateway 是否在线 |
| **Skill 与 Tool 系统** | `rules/skills-and-tools.md` | 需要安装/管理 Skill 或 Tool |
| **通知系统**（气泡 + 铃铛） | `rules/notifications.md` | 需要发 toast/铃铛通知 |
| ├ 通道 A：Python 文件桥接 | `rules/notifications-python.md` | 外部 Python 脚本发送通知 |
| ├ 通道 B：Gateway WebSocket | `rules/notifications-gateway.md` | cron 任务通过 WS 发送通知 |
| └ 通道 C：Tauri IPC | `rules/notifications-tauri.md` | 桌面应用内前端代码通知 |
| **Cron 回复配置**（两种投递 + 决策流程） | `rules/cron-reply.md` | 配置 cron 任务的会话投递方式 |

---

## 常见场景速查

| 场景 | 路径 |
|------|------|
| "介绍一下 Artifex Nexus 平台" | `rules/platform-overview.md` |
| "帮我在 Blender 里创建一个球体" | `rules/connection-status.md` → `rules/mcp-connections.md` |
| "装一个 Blender 的 Skill" | `rules/skills-and-tools.md` + nexus-skill-manage |
| "怎么知道 Maya 有没有连上" | `rules/connection-status.md` |
| "发个通知提醒用户" | `rules/notifications.md` → 按通道选子文档 |
| "设置一个定时任务" | `rules/cron-reply.md`（含方法推荐 + 用户确认流程） |
