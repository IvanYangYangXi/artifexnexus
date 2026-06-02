# 通知通道 A：Python 文件桥接

外部 Python 脚本通知的专用通道。

> **重要：通过 RunPanel 运行的所有 nexus-tool（包括 DCC 内执行的工具如
> Blender/Maya/Max/UE）已改为前端自动通知，不要再走这条通道**。
> 工具脚本只需返回标准 dict（含 `success: bool`、`error / step / traceback / csv_path` 等），
> `RunPanel.maybeNotify` 会自动识别字段生成对应的成功/失败/扫描结果通知。
> 自己写文件桥接会导致**通知重复**（前端自动 + 工具自发）。
>
> 此通道仅用于：
> - 外部 cron / 系统脚本（不经过 RunPanel）
> - `scripts/artifex_notify.py` CLI
> - AI 在 chat 流程中（非 nexus-tool 执行）想发个进度气泡

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
