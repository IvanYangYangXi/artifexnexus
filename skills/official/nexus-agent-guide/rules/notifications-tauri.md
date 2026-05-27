# 通知通道 C：Tauri IPC

桌面应用 WebView 内前端代码发送通知的方式。

---

## 调用方式

```typescript
import { invoke } from "@tauri-apps/api/core";

await invoke("push_notification", {
  req: {
    title: "操作完成",
    message: "配置文件已更新",
    type: "success",
    source: "app:settings",
  },
});
```

---

## Rust 命令定义

```
push_notification(app_handle, req: PushNotificationRequest) → Result<(), String>
  → emit("notification-received", req) → WebView listen → NotificationStore
```

---

## 适用场景

- Tauri WebView 内的 React 组件代码
- 前端业务逻辑完成后的用户提示
- 仅在桌面应用环境可用

---

## 限制

- 仅限 Tauri WebView 进程内调用
- 外部脚本 / Gateway 无法使用
- 浏览器开发环境不可用
