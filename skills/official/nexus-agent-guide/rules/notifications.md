# 通知系统规则（气泡 + 铃铛）

Artifex Nexus 桌面应用的右下角 toast 气泡和右上角铃铛通知中心，是统一的用户反馈通道。

---

## 系统架构

```
通知来源 ──→ NotificationStore (React Context + localStorage)
                 ├──→ toast() sonner 气泡（右下角弹出）
                 └──→ NotificationBell（铃铛 + Badge + Popover 历史列表）
```

- 每次 `addNotification()` 自动触发 toast 气泡
- 通知历史最大 50 条，持久化到 localStorage
- 点击铃铛可查看历史列表，点击条目弹出详情 Dialog

---

## 三种通知通道选择

| 通道 | 适用场景 | 延迟 |
|------|----------|:--:|
| **Python 文件桥接** | 外部 Python 脚本、Sidecar 工具完成通知 | ~3s |
| **Gateway WebSocket** | Gateway 内 cron 任务、Gateway 插件 | 实时 |
| **Tauri IPC** | 桌面应用 WebView 内前端代码 | 实时 |

### 通道选择决策

```
你要从哪里发通知？
├─ 外部 Python 脚本 → 通道 A（Python 文件桥接）
├─ Gateway cron 任务 → 通道 B（Gateway WS）
├─ Tauri WebView 前端代码 → 通道 C（Tauri IPC）
└─ Sidecar 工具执行完成 → 自动通知（无需手动调用）
```

---

## Nexus-Tool 自动通知

通过 Artifex Nexus 面板触发的工具（包括定时触发器），执行完成后**自动**发送通知：

- 成功：标题 `工具: {名称}`，消息 `执行成功`
- 失败：标题 `工具: {名称}`，消息 `执行失败: {错误}`

---

## 通知数据结构

```json
{
  "type": "success",
  "title": "通知标题（显示在 toast 和铃铛列表）",
  "message": "通知详情内容",
  "source": "script:my-identifier"
}
```

| 字段 | 必需 | 说明 |
|------|:---:|------|
| `type` | ✅ | `info` / `success` / `warning` / `error` |
| `title` | ✅ | 通知标题 |
| `message` | ✅ | 通知详情 |
| `source` | 可选 | 来源标识 |

---

## 子文档

- 通道 A 详细指引 → `notifications-python.md`
- 通道 B 详细指引 → `notifications-gateway.md`
- 通道 C 详细指引 → `notifications-tauri.md`
