# Artifex Nexus API 参考

精确参数和接口定义。仅在需要查 API 细节时加载。

---

## push_notification（Tauri Command）

**参数**：

| 字段 | 类型 | 必需 | 说明 |
|------|------|:---:|------|
| `title` | string | ✅ | 通知标题 |
| `message` | string | ✅ | 通知详情 |
| `type` | enum | ✅ | `info` / `success` / `warning` / `error` |
| `source` | string | 可选 | 来源标记 |

---

## scan_pending_notifications（Tauri Command）

- **无参数**
- **返回**：`{ processed: number, errors: string[] }`
- 扫描 `~/.artifexnexus/pending_notifications/*.json`，消费后删除

---

## Gateway WS notify 事件

```json
{
  "event": "notify",
  "payload": {
    "type": "success",
    "title": "标题",
    "message": "详情",
    "source": "cron:job-id"
  }
}
```

---

## 通知文件 JSON 格式

文件路径：`~/.artifexnexus/pending_notifications/notif_{ts}_{rand}.json`

```json
{
  "type": "warning",
  "title": "磁盘空间告警",
  "message": "C 盘剩余低于 5GB",
  "source": "cron:disk-monitor"
}
```

---

## AppNotification 数据结构

```typescript
interface AppNotification {
  id: string;          // UUID v4
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: string;   // ISO 8601
  source?: string;
  read: boolean;
}
```

- 最大 50 条 / localStorage key: `artifex.notifications.v1`
- addNotification 自动触发 sonner toast

---

## Python 通知脚本 CLI

```
usage: artifex_notify.py --title TITLE --message MESSAGE
       [--type {info,success,warning,error}] [--source SOURCE]
```
