# 通知系统实现计划

## 目标

1. **Toast 气泡 API**：外部脚本和 OpenClaw cron 任务可触发右下角 toast 提示
2. **铃铛通知中心**：收集执行结果，未读计数 Badge，点击弹出通知列表，点击通知可查看详情

---

## 架构总览

```
外部脚本 ──→ invoke("push_notification") ──→ Rust 命令 ──→ emit event ──→ WebView
OpenClaw cron ──→ Gateway WS event=notify ──→ gateway-ws.ts ──→ useNotificationStore

                                        ↓
                               useNotificationStore
                              (Zustand, 内存+localStorage)
                                        ↓
                    ┌───────────────────┴──────────────────┐
                    ↓                                       ↓
              toast() 触发                             NotificationBell
              (sonner 气泡)                            (Popover 历史列表)
```

---

## 实施步骤

### Step 1: 通知数据模型 & Zustand Store

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

// Zustand store
interface NotificationStore {
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (n: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  getNotifications: () => AppNotification[];
}
```

- 最大保留 50 条历史
- 持久化到 localStorage key: `artifex.notifications`
- 每次 `addNotification` 自动触发 `toast()` sonner 泡泡

---

### Step 2: Tauri 后端 — `push_notification` 命令

**新建文件：** `apps/desktop/src-tauri/src/commands/notification.rs`

```rust
// 数据结构
struct PushNotificationRequest {
    title: String,
    message: String,
    type_: String,  // info | success | warning | error
    source: Option<String>,
}

// Tauri 命令
#[tauri::command]
async fn push_notification(
    app_handle: tauri::AppHandle,  // 需要注册为 State
    req: PushNotificationRequest,
) -> Result<(), String> {
    // 通过 Tauri 事件推送到前端
    app_handle.emit("notification-received", &req)?;
    Ok(())
}
```

**修改文件：** `apps/desktop/src-tauri/src/commands/mod.rs` — 增加 `pub mod notification;`

**修改文件：** `apps/desktop/src-tauri/src/lib.rs`
- 注册 `commands::notification::push_notification`
- 在 `invoke_handler` 中添加该命令

**关键点：** 目前 lib.rs 没有把 `app_handle` 注入 State。需要：
- 添加 `tauri::AppHandle` 作为 managed State（或在 `setup` 中注入）
- 或者在命令中通过 `app_handle: tauri::AppHandle` 参数注入（Tauri 2 自动支持）

---

### Step 3: 前端 — Tauri 事件监听

**修改文件：** `packages/apps/web/src/components/shell/AppShell.tsx`

在 `useEffect` 中添加：
```ts
import { listen } from "@tauri-apps/api/event";

useEffect(() => {
  const unlisten = listen<PushNotificationRequest>(
    "notification-received",
    (event) => {
      const store = useNotificationStore.getState();
      store.addNotification({
        type: event.payload.type_,
        title: event.payload.title,
        message: event.payload.message,
        source: event.payload.source,
      });
    }
  );
  return () => { unlisten.then(fn => fn()); };
}, []);
```

---

### Step 4: Gateway WebSocket — `notify` 事件支持

**修改文件：** `packages/apps/web/src/lib/chat/gateway-ws.ts`

在 `_handleMessage` 中添加新的事件处理分支：
```ts
// notify 事件（脚本/cron 通知）
if (msg.event === "notify") {
  const payload = msg.payload ?? msg;
  const store = useNotificationStore.getState();
  store.addNotification({
    type: (payload.type as AppNotification["type"]) ?? "info",
    title: payload.title ?? "通知",
    message: payload.message ?? "",
    source: payload.source ?? "gateway",
  });
  return;
}
```

**修改文件：** `packages/apps/web/src/lib/chat/types.ts`

在 `GatewayChatEvent` 中添加（或单独定义）：
```ts
export interface GatewayNotifyEvent {
  event: "notify";
  payload: {
    type: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
    source?: string;
  };
}
```

---

### Step 5: 铃铛按钮 — `NotificationBell` 组件

**新建文件：** `packages/apps/web/src/components/shell/NotificationBell.tsx`

```
┌─────────────────────────────────┐
│  🔔 (3)                    ✕清空 │  ← Bell 按钮 + Badge 计数
├─────────────────────────────────┤
│  ✅ 脚本执行成功          14:30 │  ← 通知条目（类型图标 + 标题 + 时间）
│     my-backup 任务已完成         │  ← 截断的消息摘要
│  ⚠️ cron 执行警告         14:25 │
│     磁盘空间不足                 │
│  ❌ 脚本执行失败          14:20 │
│     /scripts/cleanup.py 返回1   │
│  ...                            │
├─────────────────────────────────┤
│              查看全部 →          │  ← 底部操作
└─────────────────────────────────┘
```

- 使用 `Popover` + `PopoverTrigger` + `PopoverContent`
- 未读通知用 `bg-accent` 底色区分
- `PopoverContent` 最大高 400px，`ScrollArea` 滚动
- 通知条目 hover 时显示边框高亮

**修改文件：** `packages/apps/web/src/components/shell/Topbar.tsx`
- 将现有的空 `Bell` 按钮替换为 `<NotificationBell />`
- 去掉原先无用的 Bell import

---

### Step 6: 通知详情弹窗

**新建文件：** `packages/apps/web/src/components/shell/NotificationDetail.tsx`

- 使用 `Dialog` 组件
- 显示完整通知内容：类型图标、标题、消息、来源、时间
- "标记已读" / "删除" 按钮

**修改文件：** `packages/apps/web/src/components/shell/NotificationBell.tsx`
- 点击通知条目 → 打开 `NotificationDetail` 弹窗

---

### Step 7: 前端 IPC 封装

**新建文件：** `apps/desktop/src/ipc/notification.ts`

```ts
import { invoke } from "@tauri-apps/api/core";

export async function pushNotification(params: {
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  source?: string;
}): Promise<void> {
  return invoke("push_notification", { req: params });
}
```

**修改文件：** `packages/ui/src/index.ts` — 确保 `toast` 可复用

---

## 涉及文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `packages/apps/web/src/lib/notification-store.ts` | Zustand 通知状态管理 |
| 新建 | `apps/desktop/src-tauri/src/commands/notification.rs` | Tauri push_notification 命令 |
| 修改 | `apps/desktop/src-tauri/src/commands/mod.rs` | 注册 notification 模块 |
| 修改 | `apps/desktop/src-tauri/src/lib.rs` | 注册命令 + AppHandle 注入 |
| 新建 | `packages/apps/web/src/components/shell/NotificationBell.tsx` | 铃铛按钮 + Popover 历史 |
| 新建 | `packages/apps/web/src/components/shell/NotificationDetail.tsx` | 通知详情弹窗 |
| 修改 | `packages/apps/web/src/components/shell/Topbar.tsx` | 替换 Bell 为 NotificationBell |
| 修改 | `packages/apps/web/src/components/shell/AppShell.tsx` | 添加 Tauri 事件监听 |
| 修改 | `packages/apps/web/src/lib/chat/gateway-ws.ts` | 添加 notify 事件处理 |
| 修改 | `packages/apps/web/src/lib/chat/types.ts` | 添加 GatewayNotifyEvent 类型 |
| 新建 | `apps/desktop/src/ipc/notification.ts` | 前端 IPC 封装 |

---

## 外部调用方式

### 方式 A：脚本直接调用 Tauri IPC
```bash
# 需要 Tauri IPC bridge 工具或通过 WebView 的 eval
# 暂不暴露独立的 CLI 工具，后续可在 sidecar 中增加 JSON-RPC 方法
```

### 方式 B：通过 Gateway WebSocket（推荐用于 cron）
```json
// OpenClaw cron 任务结果可通过 Gateway plugin 发送:
{
  "event": "notify",
  "payload": {
    "type": "success",
    "title": "每日备份完成",
    "message": "备份大小 2.3GB，耗时 45 秒",
    "source": "cron:daily-backup"
  }
}
```

### 方式 C：通过 Tauri invoke（桌面内脚本）
```ts
import { pushNotification } from "./ipc/notification";
await pushNotification({
  title: "脚本执行完成",
  message: "my-script.py 成功运行",
  type: "success",
  source: "script:my-script",
});
```

---

## 后续扩展

- [ ] `_pending_notify.json` 文件持久化（UE 插件触发）
- [ ] 通知分类过滤（按来源 / 类型）
- [ ] 通知声音 / 系统托盘通知
- [ ] Sidecar JSON-RPC 增加通知模式（接收来自 sidecar 的异步推送）
