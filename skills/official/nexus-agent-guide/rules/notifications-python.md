# 通知通道 A：Python 文件桥接

外部 Python 脚本 / Sidecar 工具完成通知的首选方式。

---

## 原理

```
Python 脚本 → 写 JSON → ~/.artifexnexus/pending_notifications/
                         ↓ (前端每 3s 轮询 scan_pending_notifications)
               Rust scan → emit event → WebView → toast + 铃铛
```

---

## 方式 1：CLI 工具（推荐）

```bash
python scripts/artifex_notify.py \
  --title "备份完成" \
  --message "成功备份 12 个文件到 /backup/" \
  --type success \
  --source script:daily-backup
```

---

## 方式 2：Python API

```python
from scripts.artifex_notify import send_notification

send_notification(
    title="任务完成",
    message="数据导出成功，共 500 条记录",
    type="success",
    source="script:export",
)
```

---

## 方式 3：直接写文件（无外部依赖）

```python
import json, time, uuid
from pathlib import Path

payload = {
    "type": "warning",
    "title": "磁盘空间不足",
    "message": "C 盘剩余 2.1GB，建议清理",
    "source": "script:disk-check",
}

pending_dir = Path.home() / ".artifexnexus" / "pending_notifications"
pending_dir.mkdir(parents=True, exist_ok=True)
fname = f"notif_{int(time.time()*1000)}_{uuid.uuid4().hex[:4]}.json"

with open(pending_dir / fname, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False)
```

---

## 文件命名规则

- 格式：`notif_{timestamp_ms}_{random4}.json`
- 前端消费后自动删除
- 文件名冲突概率极低（timestamp + random）

---

## 消费机制

- 前端 `NotificationBridge` 组件每 3 秒调用 Rust `scan_pending_notifications` 命令
- 扫描 `~/.artifexnexus/pending_notifications/` 中所有 `*.json` 文件
- 逐个解析 → `emit("notification-received")` → 删除文件
- 解析失败的文件也会被删除（避免卡住队列）
