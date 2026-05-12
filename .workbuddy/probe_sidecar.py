"""
直接以 subprocess 方式驱动 sidecar.py，复现 "openclaw.gateway.start" 30s 卡死。
对每个 RPC 计时并把 sidecar stderr 实时打印；不经过 Rust，不带 CREATE_NO_WINDOW。
"""
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path(r"D:/MyProject_D/artifexnexus")
SIDECAR = REPO / "packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py"
HOME = Path.home()
OPENCLAW_HOME = HOME / ".artifexnexus" / ".openclaw"

env = os.environ.copy()
env["OPENCLAW_HOME"] = str(OPENCLAW_HOME)
env["OPENCLAW_STATE_DIR"] = str(OPENCLAW_HOME / "state")
env["OPENCLAW_CONFIG_PATH"] = str(OPENCLAW_HOME / "openclaw.json")
env["OPENCLAW_NO_ONBOARD"] = "1"
env["ARTIFEX_NEXUS_HOME"] = str(HOME / ".artifexnexus")
env["PYTHONPATH"] = str(SIDECAR.parent) + os.pathsep + env.get("PYTHONPATH", "")
env["PYTHONUNBUFFERED"] = "1"

print(f"[probe] launching sidecar.py: {SIDECAR}", flush=True)
proc = subprocess.Popen(
    [sys.executable, "-u", str(SIDECAR)],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env,
    bufsize=0,
)


def pump_stderr():
    while True:
        line = proc.stderr.readline()
        if not line:
            break
        try:
            print(f"[sidecar:stderr] {line.decode('utf-8', errors='replace').rstrip()}", flush=True)
        except Exception:
            print(f"[sidecar:stderr] <decode-fail> {line!r}", flush=True)


threading.Thread(target=pump_stderr, daemon=True).start()


def call(method, params, timeout=60):
    rpc_id = call.counter
    call.counter += 1
    req = {"jsonrpc": "2.0", "method": method, "params": params, "id": rpc_id}
    line = json.dumps(req) + "\n"
    print(f"\n[probe] >>> {method} (id={rpc_id}) params={params}", flush=True)
    t0 = time.monotonic()
    proc.stdin.write(line.encode("utf-8"))
    proc.stdin.flush()
    # 读取响应（按行）
    while True:
        elapsed = time.monotonic() - t0
        if elapsed > timeout:
            print(f"[probe] !!! TIMEOUT after {elapsed:.1f}s waiting for {method}", flush=True)
            return None
        if proc.poll() is not None:
            print(f"[probe] !!! sidecar exited code={proc.returncode} during {method}", flush=True)
            return None
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.05)
            continue
        elapsed = time.monotonic() - t0
        try:
            resp = json.loads(line.decode("utf-8"))
        except Exception as e:
            print(f"[probe] non-json line: {line!r} ({e})", flush=True)
            continue
        if resp.get("id") == rpc_id:
            print(f"[probe] <<< {method} took {elapsed:.2f}s", flush=True)
            print(f"[probe]     {json.dumps(resp, ensure_ascii=False)[:400]}", flush=True)
            return resp


call.counter = 1

try:
    call("ping", None, timeout=10)
    call("openclaw.status", {}, timeout=15)
    call("openclaw.gateway.status", {}, timeout=15)
    call("openclaw.gateway.start", {"port": 19789, "force_restart": True}, timeout=60)
    time.sleep(2)
    call("openclaw.gateway.status", {}, timeout=15)
    call("openclaw.sessions.history", {"session_key": "agent:artifex-nexus:main"}, timeout=10)
    # 收尾停 gateway
    call("openclaw.stop", {}, timeout=15)
finally:
    print("[probe] closing stdin", flush=True)
    try:
        proc.stdin.close()
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    print(f"[probe] sidecar exit={proc.returncode}", flush=True)
