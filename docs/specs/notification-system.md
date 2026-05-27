# 通知系统实现计划

## 目标

1. **Toast 气泡 API**：外部脚本和 OpenClaw cron 任务可触发右下角 toast 提示
2. **铃铛通知中心**：收集执行结果，未读计数 Badge，点击弹出通知列表，点击通知可查看详情
3. **Python 调用方式**：Python 脚本可通过文件桥接发送通知

---

## 架构总览

```
外部脚本 ──→ invoke("push_notification") ──→ Rust 命令 ──→ emit event ──→ WebView
Python脚本 ──→ ~/.artifexnexus/pending_notifications/ ──→ scan_pending RPC ──→ emit event
OpenClaw cron ──→ Gateway WS event=notify ──→ gateway-ws.ts ──→ useNotificationStore

                                        ↓
                               useNotificationStore
                              (React Context + useReducer, localStorage)
                                        ↓
                    ┌───────────────────┴──────────────────┐
                    ↓                                       ↓
              toast() 触发                             NotificationBell
              (sonner 气泡)                            (Popover 历史列表)
```

---

## 实施步骤

### Step 1: 通知数据模型 & React Context Store

**新建文件：** `packages/apps/web/src/lib/notification-store.ts`

```ts
// 通知条目类型
interface AppNotification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: string; // ISO
  source?: string;  // 来源标记，如 "cron:job-123", "script:my-script"
  read: boolean;
}
```

- 最大保留 50 条历史
- 持久化到 localStorage key: `artifex.notifications`
- 每次 `addNotification` 自动触发 `toast()` sonner 泡泡

---

### Step 2: Tauri 后端 — `push_notification` 命令 + `scan_pending_notifications` 文件桥接

**新建文件：** `apps/desktop/src-tauri/src/commands/notification.rs`

提供两个命令：
1. `push_notification` — 直接通过 IPC 推送（供 Tauri invoke 调用）
2. `scan_pending_notifications` — 扫描 `~/.artifexnexus/pending_notifications/` 中的 JSON 文件，消费后删除

**修改文件：** `apps/desktop/src-tauri/src/commands/mod.rs` — 增加 `pub mod notification;`

**修改文件：** `apps/desktop/src-tauri/src/lib.rs`
- 注册 `commands::notification::push_notification` 和 `commands::notification::scan_pending_notifications`

---

### Step 3: 前端 — Tauri 事件监听 + 文件轮询

**修改文件：** `packages/apps/web/src/components/shell/AppShell.tsx`

在 `NotificationBridge` 组件中：
1. 监听 Tauri `notification-received` 事件
2. 每 3 秒轮询 `scan_pending_notifications` 命令（消费 Python 写入的文件）

---

### Step 4: Gateway WebSocket — `notify` 事件支持

**修改文件：** `packages/apps/web/src/lib/chat/gateway-ws.ts`

在 `_handleMessage` 中添加新的事件处理分支：
```ts
if (msg.event === "notify") {
  this._handleNotifyEvent(msg);
  return;
}
```

---

### Step 5: 铃铛按钮 — `NotificationBell` 组件

**新建文件：** `packages/apps/web/src/components/shell/NotificationBell.tsx`

- 使用 `Popover` + `PopoverTrigger` + `PopoverContent`
- 未读通知用 `bg-accent` 底色区分
- Badge 显示未读计数

---

### Step 6: 通知详情弹窗

**新建文件：** `packages/apps/web/src/components/shell/NotificationDetail.tsx`

- 使用 `Dialog` 组件
- 显示完整通知内容：类型图标、标题、消息、来源、时间

---

### Step 7: 前端 IPC 封装 + Python 通知脚本

**新建文件：** `apps/desktop/src/ipc/notification.ts`

```ts
import { invoke } from "@tauri-apps/api/core";
export async function pushNotification(params: {...}): Promise<void> {
  return invoke("push_notification", { req: params });
}
```

**新建文件：** `scripts/artifex_notify.py`

Python 通知发送工具，提供 CLI + Python API 两种调用方式。

---

## 涉及文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `packages/apps/web/src/lib/notification-store.ts` | React Context 通知状态管理 |
| 新建 | `apps/desktop/src-tauri/src/commands/notification.rs` | Tauri 通知命令 + 文件桥接 |
| 修改 | `apps/desktop/src-tauri/src/commands/mod.rs` | 注册 notification 模块 |
| 修改 | `apps/desktop/src-tauri/src/lib.rs` | 注册两个通知命令 |
| 新建 | `packages/apps/web/src/components/shell/NotificationBell.tsx` | 铃铛按钮 + Popover 历史 |
| 新建 | `packages/apps/web/src/components/shell/NotificationDetail.tsx` | 通知详情弹窗 |
| 修改 | `packages/apps/web/src/components/shell/Topbar.tsx` | 替换 Bell 为 NotificationBell |
| 修改 | `packages/apps/web/src/components/shell/AppShell.tsx` | Tauri 事件监听 + 文件轮询 |
| 修改 | `packages/apps/web/src/lib/chat/gateway-ws.ts` | notify 事件处理 |
| 修改 | `packages/apps/web/src/lib/chat/types.ts` | GatewayNotifyEvent 类型 |
| 新建 | `apps/desktop/src/ipc/notification.ts` | 前端 IPC 封装 |
| 新建 | `scripts/artifex_notify.py` | Python 通知发送工具 |

---

## 外部调用方式

### 方式 A：Python 脚本调用（推荐）
```bash
# CLI 方式
python scripts/artifex_notify.py --title "备份完成" --message "已保存 3 个文件" --type success --source script:backup
```
```python
# API 方式
from scripts.artifex_notify import send_notification
send_notification(title="备份完成", message="已保存 3 个文件", type="success", source="script:backup")
```

**工作原理**：Python 写入 JSON 文件到 `~/.artifexnexus/pending_notifications/`，桌面应用每 3 秒轮询消费。

### 方式 B：通过 Gateway WebSocket（推荐用于 cron）
```json
{"event": "notify", "payload": {"type": "success", "title": "每日备份完成", "message": "备份大小 2.3GB", "source": "cron:daily-backup"}}
```

### 方式 C：通过 Tauri invoke（桌面内脚本/前端代码）
```ts
import { pushNotification } from "./ipc/notification";
await pushNotification({ title: "脚本执行完成", message: "成功运行", type: "success", source: "script:my-script" });
```

---

## 已实现状态

| 特性 | 状态 |
|------|------|
| Toast 气泡 API（sonner） | ✅ |
| 铃铛通知中心 + Badge | ✅ |
| 通知详情弹窗 | ✅ |
| Gateway WS notify 事件 | ✅ |
| Tauri IPC push_notification | ✅ |
| Python 文件桥接 | ✅ |
| 前端轮询扫描 | ✅ |
| **Nexus-Tool 执行完成自动通知** | ✅ |

## 数据流总结

```
┌─────────────────────────────────────────────────────────────┐
│                  三条通知路径                                  │
│                                                              │
│  A: Tauri IPC  (前端代码)                                     │
│     invoke("push_notification") → Rust → emit event → UI     │
│                                                              │
│  B: Gateway WS (cron 任务)                                    │
│     WS send {event:"notify"} → gateway-ws.ts → Store → UI    │
│                                                              │
│  C: Python 文件桥接 (外部脚本)                                 │
│     写JSON → ~/.artifexnexus/pending_notifications/          │
│     → Rust scan_pending → emit event → UI                    │
│                                                              │
│  D: Nexus-Tool 自动通知 (Sidecar 内部)   ← 新增               │
│     工具执行完成 → _send_tool_completion_notification()       │
│     → 写JSON(同C) → 轮询消费 → UI                             │
└─────────────────────────────────────────────────────────────┘
```

## 后续扩展

- [ ] 通知分类过滤（按来源 / 类型）
- [ ] 通知声音 / 系统托盘通知
- [ ] Sidecar JSON-RPC 增加通知模式
- [ ] Python websocket 直连 Gateway 方案（需 Gateway 服务端支持转发）
