#!/usr/bin/env python3
"""
EPIC-0001 S1–S7 快速验收脚本。
运行环境：Python 3.10+，已 pip install -e packages/adapters/openclaw/wrapper。
不需要 OpenClaw 运行时即可跑大部分检查。
"""

import json
import os
import platform
import subprocess
import sys
from pathlib import Path

PASS = 0
FAIL = 0
SKIP = 0


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        print(f"  ❌ {name}  — {detail}")


def skip_check(name: str, reason: str = ""):
    global SKIP
    SKIP += 1
    print(f"  ⏭ {name}  — {reason}")


# ── 1. 单元测试 ──
print("\n═══ 1. 单元测试 ═══")
result = subprocess.run(
    [sys.executable, "-m", "pytest", "packages/adapters/openclaw/wrapper/tests/", "-q"],
    capture_output=True, text=True, cwd=Path(__file__).parent.parent
)
print(result.stdout[-500:] if result.stdout else result.stderr[-500:])
check("pytest 全绿", result.returncode == 0, f"exit={result.returncode}")

# ── 2. 端口默认值 ──
print("\n═══ 2. 端口默认值 19789 ═══")
from artifex_nexus.openclaw_wrapper import ports
check("DEFAULT_PORT = 19789", ports.DEFAULT_PORT == 19789)
check("PORT_STEP = 20", ports.PORT_STEP == 20)

# ── 3. 端口探测 ──
print("\n═══ 3. 端口探测 ──")
try:
    p = ports.pick_port(preferred=19789)
    check(f"pick_port(19789) = {p}", p == 19789 or p >= 19789)
except RuntimeError as e:
    check("pick_port 不抛异常", False, str(e))

# ── 4. 派生段 probe ──
print("\n═══ 4. 派生端口段 probe ──")
result = ports._probe_derived_segment(19789)
check("_probe_derived_segment(19789) 返回 bool", isinstance(result, bool))

# ── 5. ports.json 读写 ──
print("\n═══ 5. ports.json 持久化 ──")
import tempfile
with tempfile.TemporaryDirectory() as td:
    json_path = Path(td) / "ports.json"
    ports.write_last_port(str(json_path), 19789)
    read_back = ports.read_last_port(str(json_path))
    check("write/read 19789", read_back == 19789)
    check("不存在的文件返回 None", ports.read_last_port(str(Path(td) / "nope.json")) is None)

# ── 6. bootstrap 目录布局 ──
print("\n═══ 6. bootstrap 目录布局 ──")
from artifex_nexus.openclaw_wrapper import bootstrap
with tempfile.TemporaryDirectory() as td:
    home = Path(td) / ".openclaw"
    result = bootstrap.bootstrap(home, "v2026.5.4", 19789)
    check("bootstrap 成功", result.success)
    check("token 已生成", result.token_generated)
    check("token 长度 ≥ 48", len(bootstrap.get_gateway_token(home) or "") >= 48)
    check("state/lock 存在", (home / "state" / "lock").exists())
    check("workspace/skills/official 存在", (home / "workspace" / "skills" / "official").exists())
    check("openclaw.json 存在", result.config_path.exists())

    # 幂等性
    result2 = bootstrap.bootstrap(home, "v2026.5.4", 19789)
    check("重复 bootstrap 成功", result2.success)
    check("重复 bootstrap 不重新生成 token", not result2.token_generated)

    # 配置读取
    config = bootstrap.read_config(home)
    check("read_config 非空", config is not None)
    if config:
        check("gateway.port = 19789", config.get("gateway", {}).get("port") == 19789)
        check("version = v2026.5.4", config.get("version") == "v2026.5.4")

# ── 7. runtime PID 锁 ──
print("\n═══ 7. runtime PID 锁 ──")
from artifex_nexus.openclaw_wrapper import runtime
with tempfile.TemporaryDirectory() as td:
    home = Path(td) / ".openclaw"
    run_dir = home.parent / "run"
    run_dir.mkdir(parents=True)
    runtime._write_pid(home, 12345)
    check("写入 PID 12345", runtime._read_pid(home) == 12345)
    runtime._clear_pid(home)
    check("清除 PID", runtime._read_pid(home) is None)

# ── 8. PID 存活检测 ──
print("\n═══ 8. PID 存活检测 ──")
check("当前进程存活", runtime._is_pid_alive(os.getpid()))
check("不存在 PID 不存活", not runtime._is_pid_alive(99999999))

# ── 9. 版本列表 ──
print("\n═══ 9. 版本列表 ──")
with tempfile.TemporaryDirectory() as td:
    home = Path(td) / ".openclaw"
    cli_dir = home / "cli"
    vdir = cli_dir / "v2026.5.4"
    vdir.mkdir(parents=True)
    (vdir / "bin").mkdir(parents=True)
    (vdir / "bin" / "openclaw").write_text("")
    versions = runtime.list_versions(home)
    check("list_versions 返回 1 个版本", len(versions) == 1)
    if versions:
        check("版本号 = v2026.5.4", versions[0].version == "v2026.5.4")

# ── 10. current symlink / fallback ──
print("\n═══ 10. current 版本切换 ──")
with tempfile.TemporaryDirectory() as td:
    home = Path(td) / ".openclaw"
    cli_dir = home / "cli"
    vdir = cli_dir / "v2026.5.4"
    vdir.mkdir(parents=True)
    runtime.set_current_version(home, "v2026.5.4")
    resolved = runtime._resolve_current_version(home)
    check("resolve_current_version = v2026.5.4", resolved == "v2026.5.4")
    # 检查 symlink 或 current.txt
    has_symlink = (cli_dir / "current").exists()
    has_txt = (cli_dir / "current.txt").exists()
    check("current symlink 或 current.txt 存在", has_symlink or has_txt)

# ── 11. doctor 三通道 ──
print("\n═══ 11. doctor 健康检查 ──")
from artifex_nexus.openclaw_wrapper import doctor
with tempfile.TemporaryDirectory() as td:
    home = Path(td) / ".openclaw"
    report = doctor.check_openclaw_health(home, 19789)
    check("report.overall 非空", report.overall in ("healthy", "degraded", "down", "unknown"))
    check("至少 2 个通道", len(report.channels) >= 2)
    check("report.port = 19789", report.port == 19789)
    check("to_dict 可序列化", isinstance(report.to_dict(), dict))

# ── 12. sidecar JSON-RPC ──
print("\n═══ 12. sidecar JSON-RPC ──")
sidecar_path = (
    Path(__file__).parent.parent
    / "packages" / "adapters" / "openclaw" / "wrapper"
    / "src" / "artifex_nexus" / "openclaw_wrapper" / "sidecar.py"
)
if sidecar_path.exists():
    def call_rpc(method, params=None):
        req = json.dumps({"jsonrpc": "2.0", "method": method, "params": params or {}, "id": 1})
        r = subprocess.run([sys.executable, str(sidecar_path)], input=req + "\n",
                           capture_output=True, text=True, timeout=10)
        return json.loads(r.stdout.strip())

    check("ping → pong", call_rpc("ping").get("result") == "pong")
    check("get_port → 19789", call_rpc("get_port").get("result", {}).get("port") == 19789)
    check("unknown method → -32601", call_rpc("nonexistent").get("error", {}).get("code") == -32601)
    check("upgrade → not_implemented", call_rpc("openclaw.upgrade").get("result", {}).get("status") == "not_implemented")
    check("rollback → not_implemented", call_rpc("openclaw.rollback").get("result", {}).get("status") == "not_implemented")
else:
    skip_check("sidecar.py 不存在", str(sidecar_path))

# ── 13. 全仓无旧端口 14523/18789 作为默认值 ──
print("\n═══ 13. 旧端口 14523/18789 残留检查 ──")
repo_root = Path(__file__).parent.parent
# 扫描范围：packages/、apps/、docs/specs/、docs/vision/、.env*、scripts/
scan_dirs = [
    repo_root / "packages",
    repo_root / "apps",
    repo_root / "docs" / "specs",
    repo_root / "docs" / "vision",
    repo_root / "scripts",
]
scan_files = list(repo_root.glob(".env*"))
import glob as g
for d in scan_dirs:
    if d.exists():
        scan_files.extend(g.glob(str(d / "**/*"), recursive=True))

found = []
for f in scan_files:
    fp = Path(f)
    if not fp.is_file():
        continue
    # 跳过二进制文件、node_modules、target、.git、dist
    if any(p in fp.parts for p in ["node_modules", "target", ".git", "__pycache__", "dist"]):
        continue
    if fp.suffix in [".exe", ".dll", ".pdb", ".png", ".ico", ".lock", ".sum"]:
        continue
    try:
        content = fp.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    # 跳过 review 文档和自身
    if "docs/reviews/" in str(fp) or fp.name == "verify-epic-0001.py":
        continue
    # 检查 14523 作为默认值（非说明性引用）
    if "14523" in content:
        found.append(f"{fp.relative_to(repo_root)} (14523)")
    # 检查 18789 作为默认值：排除说明性引用（"与上游默认 18789 隔离"等）
    if "18789" in content:
        # 允许说明性引用模式
        lines_with_18789 = [l.strip() for l in content.splitlines() if "18789" in l]
        for line in lines_with_18789:
            # 跳过说明性引用：包含"上游"、"避开"、"隔离"、"默认"（指上游默认）等
            if any(kw in line for kw in ["上游", "upstream", "避开", "隔离", "isolated", "差 +1000", "base+1000", "互不干扰"]):
                continue
            # 跳过 survey 表格中的"上游默认值"列
            if "**18789**" in line:
                continue
            found.append(f"{fp.relative_to(repo_root)} (18789: {line[:80]})")
check("无 14523/18789 残留", len(found) == 0, "; ".join(found) if found else "")

# ── 14. contracts schema 存在 ──
print("\n═══ 14. contracts schema 文件 ──")
schemas_dir = Path(__file__).parent.parent / "packages" / "platform" / "contracts" / "schemas"
for name in ["openclaw-status.schema.json", "openclaw-health.schema.json", "openclaw-version.schema.json"]:
    check(f"{name} 存在", (schemas_dir / name).exists())

# ── 15. Rust 命令注册 ──
print("\n═══ 15. Rust 命令注册 ──")
lib_rs = Path(__file__).parent.parent / "apps" / "desktop" / "src-tauri" / "src" / "lib.rs"
if lib_rs.exists():
    content = lib_rs.read_text(encoding="utf-8")
    for cmd in ["openclaw_status", "openclaw_install", "openclaw_bootstrap",
                "openclaw_start", "openclaw_stop", "openclaw_doctor"]:
        check(f"lib.rs 注册 {cmd}", cmd in content)
else:
    skip_check("lib.rs 不存在")

# ── 汇总 ──
print(f"\n{'='*50}")
print(f"结果: {PASS} passed, {FAIL} failed, {SKIP} skipped")
if FAIL == 0:
    print("🎉 全部通过！")
else:
    print(f"⚠ 有 {FAIL} 项失败，请检查上述 ❌ 项")
print(f"{'='*50}")
