#!/usr/bin/env python3
"""
Artifex Nexus 通知发送工具
==========================

向 Artifex Nexus 桌面应用推送通知（右下角 Toast 气泡 + 铃铛通知中心）。

**命令行用法**:
    python scripts/artifex_notify.py --title "任务完成" --message "备份已保存" --type success

**Python API 用法**:
    from scripts.artifex_notify import send_notification
    send_notification(title="备份完成", message="已保存 3 个文件", type="success")

**工作原理**:
    将通知写入 ~/.artifexnexus/pending_notifications/ 目录，
    Artifex Nexus 桌面应用定期扫描该目录并推送通知到前端。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path
from typing import Literal, Optional

NotificationType = Literal["info", "success", "warning", "error"]

VALID_TYPES = frozenset({"info", "success", "warning", "error"})


def _get_pending_dir() -> Path:
    """获取待处理通知目录路径。"""
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or str(Path.home())
    pending_dir = Path(home) / ".artifexnexus" / "pending_notifications"
    pending_dir.mkdir(parents=True, exist_ok=True)
    return pending_dir


def send_notification(
    title: str,
    message: str,
    type: NotificationType = "info",
    source: Optional[str] = None,
) -> bool:
    """向 Artifex Nexus 桌面应用发送通知。

    Args:
        title: 通知标题（必填）
        message: 通知正文（必填）
        type: 通知类型，可选 info/success/warning/error，默认 info
        source: 通知来源标识（如 "script:backup"、"cron:daily-clean"）

    Returns:
        True 表示写入成功，False 表示失败
    """
    if type not in VALID_TYPES:
        type = "info"

    pending_dir = _get_pending_dir()

    payload = {
        "title": title,
        "message": message,
        "type": type,
    }
    if source:
        payload["source"] = source

    # 生成唯一文件名：notif_<timestamp_ms>_<random_hex>.json
    ts = int(time.time() * 1000)
    rand = random.randint(0, 0xFFFF)
    filename = pending_dir / f"notif_{ts}_{rand:04x}.json"

    try:
        filename.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return True
    except OSError:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Artifex Nexus 通知发送工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python artifex_notify.py --title "任务完成" --message "备份已保存"
  python artifex_notify.py --title "错误" --message "文件不存在" --type error --source script:backup
        """,
    )
    parser.add_argument("--title", required=True, help="通知标题")
    parser.add_argument("--message", required=True, help="通知正文")
    parser.add_argument(
        "--type",
        default="info",
        choices=list(VALID_TYPES),
        help="通知类型 (默认: info)",
    )
    parser.add_argument("--source", default=None, help="通知来源标识")

    args = parser.parse_args()

    ok = send_notification(
        title=args.title,
        message=args.message,
        type=args.type,
        source=args.source,
    )

    if ok:
        print(f"[artifex_notify] 通知已发送: {args.title}")
        sys.exit(0)
    else:
        print(f"[artifex_notify] 发送失败: {args.title}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
