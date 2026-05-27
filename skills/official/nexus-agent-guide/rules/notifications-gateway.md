# 通知通道 B：Gateway WebSocket

Gateway 内 cron 任务 / 插件发送通知的方式。

---

## 原理

Gateway 进程和 WebView 之间已有 WebSocket 连接。Gateway 内代码直接通过 WS 发送 `notify` 事件即可。

```
Gateway cron/plugin → WS send {event:"notify", payload:{...}}
                   → gateway-ws.ts._handleNotifyEvent()
                   → NotificationStore.addNotification()
                   → toast + 铃铛
```

---

## 事件格式

```json
{
  "event": "notify",
  "payload": {
    "type": "success",
    "title": "定时任务完成",
    "message": "每日备份已成功完成，共 1,248 个文件",
    "source": "cron:daily-backup"
  }
}
```

---

## 适用场景

- cron 任务执行完成后的结果通知
- Gateway 插件事件通知
- 仅在 Gateway 进程内可用

---

## 限制

- 外部 WebSocket 客户端无法直连 Gateway（需要 token 认证）
- Gateway 服务端（OpenClaw 二进制）不可修改
- 外部脚本请使用通道 A（Python 文件桥接）
