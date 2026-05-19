"""Simulate frontend clicking Run on a DCC nexus-tool.

直接走 sidecar 内的 nexus-tool.run / .result 两个 RPC handler，
不经过 Tauri / IPC，专门用于在本机命令行复现"一直转圈"问题。

用法（在项目根目录）：
    python tools/diagnose_dcc_tool_run.py marketplace/blender-rename-prefix-suffix
"""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

# 让 sidecar 模块可 import
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
for _p in (
    _ROOT / "packages" / "adapters" / "openclaw" / "wrapper" / "src",
    _ROOT / "packages" / "dcc" / "shared",
    _ROOT / "packages" / "platform" / "skill" / "src",
    _ROOT / "packages" / "platform" / "contracts" / "src",
):
    if _p.is_dir():
        sys.path.insert(0, str(_p))

# DEBUG 级别，露出 mcp_bridge / nexus_tool_rpc 全量日志
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(name)s] %(message)s",
    stream=sys.stderr,
)

from artifex_nexus.openclaw_wrapper import nexus_tool_rpc as ntr  # noqa: E402


def main() -> int:
    tool_id = sys.argv[1] if len(sys.argv) > 1 else "marketplace/blender-rename-prefix-suffix"
    run_args = {
        "prefix": "sm",
        "suffix": "",
        "separator": "_",
        "target": "selected",
    }
    if len(sys.argv) > 2:
        run_args.update(json.loads(sys.argv[2]))

    print(f"\n=== diagnose dcc tool run ===\nid={tool_id}\nargs={run_args}\n", file=sys.stderr)

    # Step 1: nexus-tool.run → 拿 task_id
    t0 = time.time()
    resp = ntr._handle_nexus_tool_run(  # type: ignore[attr-defined]
        req_id=1,
        params={"id": tool_id, "args": run_args},
    )
    print(f"\n[run] dt={(time.time() - t0) * 1000:.0f}ms resp={json.dumps(resp, ensure_ascii=False)}",
          file=sys.stderr)

    result = resp.get("result") or {}
    task_id = result.get("task_id")
    if not task_id:
        print("[fatal] 没拿到 task_id；run 直接失败", file=sys.stderr)
        return 1

    # Step 2: 模拟前端轮询 nexus-tool.result，最多 60s
    deadline = time.time() + 60
    last_status = ""
    poll_count = 0
    while time.time() < deadline:
        poll_count += 1
        r = ntr._handle_nexus_tool_result(req_id=poll_count + 1, params={"task_id": task_id})  # type: ignore[attr-defined]
        body = r.get("result") or {}
        status = body.get("status", "?")
        if status != last_status:
            print(f"\n[poll #{poll_count}] status={status} dt={(time.time() - t0):.1f}s", file=sys.stderr)
            last_status = status
        if status in ("done", "error", "cancelled"):
            print(f"\n=== final ===\n{json.dumps(body, ensure_ascii=False, indent=2, default=str)[:2000]}",
                  file=sys.stderr)
            return 0 if status == "done" else 2
        time.sleep(0.5)

    print(f"\n[timeout] task {task_id} 一直在 running，60s 后强制退出（与卡转圈症状一致）",
          file=sys.stderr)
    # 抓快照
    with ntr._task_lock:  # type: ignore[attr-defined]
        snap = dict(ntr._task_store.get(task_id, {}))  # type: ignore[attr-defined]
    snap.pop("cancel_event", None)
    snap.pop("subprocess_handle", None)
    print(f"[task snapshot] {snap}", file=sys.stderr)
    return 3


if __name__ == "__main__":
    sys.exit(main())
