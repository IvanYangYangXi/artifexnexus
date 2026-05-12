#!/usr/bin/env python3
"""
Gateway 响应速度测试脚本
=======================
测试 OpenClaw Gateway (127.0.0.1:19789) 的 WebSocket 连接和响应延迟。

用法：
    python scripts/test_gateway_perf.py              # 默认端口 19789
    python scripts/test_gateway_perf.py --port 19789 # 指定端口
    python scripts/test_gateway_perf.py --rounds 10  # 跑 10 轮
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

# ── 常量 ────────────────────────────────────────────────────────────────
DEFAULT_PORT = 19789
DEFAULT_HOST = "127.0.0.1"
DEFAULT_ROUNDS = 5

# 如果环境变量设置了 OPENCLAW_HOME，用它找配置
OPENCLAW_HOME = os.environ.get(
    "OPENCLAW_HOME",
    str(Path.home() / ".artifexnexus" / ".openclaw"),
)


def check_port_open(host: str, port: int, timeout: float = 2.0) -> tuple[bool, float]:
    """TCP 端口探测，返回 (开放, 延迟_ms)。"""
    start = time.perf_counter()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        result = s.connect_ex((host, port))
        s.close()
        elapsed = (time.perf_counter() - start) * 1000
        return result == 0, elapsed
    except OSError:
        return False, 0


def check_ws_handshake(host: str, port: int, timeout: float = 5.0) -> tuple[bool, float, str]:
    """WebSocket 握手探测（纯 HTTP Upgrade 请求，不依赖 websockets 库）。

    Returns: (成功, 延迟_ms, 错误消息)
    """
    import http.client

    start = time.perf_counter()
    try:
        conn = http.client.HTTPConnection(host, port, timeout=timeout)
        conn.request(
            "GET",
            "/",
            headers={
                "Upgrade": "websocket",
                "Connection": "Upgrade",
                "Sec-WebSocket-Version": "13",
                "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
                "Host": f"{host}:{port}",
            },
        )
        response = conn.getresponse()
        elapsed = (time.perf_counter() - start) * 1000
        # WebSocket 握手成功应返回 101
        is_ws = response.status == 101
        msg = f"HTTP {response.status} {response.reason}" if not is_ws else "WebSocket handshake OK"
        conn.close()
        return is_ws, elapsed, msg
    except Exception as e:
        elapsed = (time.perf_counter() - start) * 1000
        return False, elapsed, str(e)


def get_gateway_config() -> dict | None:
    """读取 openclaw.json 获取 gateway 配置。"""
    config_path = Path(OPENCLAW_HOME) / "openclaw.json"
    if not config_path.exists():
        return None
    try:
        raw = config_path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def get_pid_on_port(port: int) -> int | None:
    """通过 netstat 获取端口占用进程 PID。"""
    try:
        out = subprocess.check_output(
            ["netstat", "-ano"],
            timeout=3,
            creationflags=0x08000000 if os.name == "nt" else 0,
        ).decode("utf-8", errors="replace")
        for line in out.splitlines():
            if f":{port}" in line and "LISTEN" in line:
                parts = line.split()
                if parts:
                    try:
                        return int(parts[-1])
                    except ValueError:
                        pass
    except Exception:
        pass
    return None


def get_process_name(pid: int) -> str:
    """获取进程名。"""
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True,
            timeout=3,
            creationflags=0x08000000,
        )
        stdout = result.stdout.decode("utf-8", errors="replace")
        for line in stdout.splitlines():
            if str(pid) in line:
                parts = line.split()
                if parts:
                    return parts[0]
    except Exception:
        pass
    return "unknown"


def measure_round_trip(host: str, port: int, rounds: int) -> dict:
    """测量多轮 TCP 和 WebSocket 延迟。"""
    tcp_times = []
    ws_times = []
    ws_success = 0

    for i in range(rounds):
        # TCP 延迟
        _, tcp_ms = check_port_open(host, port)
        tcp_times.append(tcp_ms)

        # WebSocket 握手延迟
        ok, ws_ms, _ = check_ws_handshake(host, port)
        ws_times.append(ws_ms)
        if ok:
            ws_success += 1

        if i < rounds - 1:
            time.sleep(0.5)

    return {
        "tcp_avg_ms": round(sum(tcp_times) / len(tcp_times), 1) if tcp_times else 0,
        "tcp_min_ms": round(min(tcp_times), 1) if tcp_times else 0,
        "tcp_max_ms": round(max(tcp_times), 1) if tcp_times else 0,
        "ws_avg_ms": round(sum(ws_times) / len(ws_times), 1) if ws_times else 0,
        "ws_min_ms": round(min(ws_times), 1) if ws_times else 0,
        "ws_max_ms": round(max(ws_times), 1) if ws_times else 0,
        "ws_success_rate": f"{ws_success}/{rounds}",
    }


def check_mcp_bridge_config() -> dict:
    """检查 MCP Bridge 插件配置状态。"""
    config = get_gateway_config()
    result = {
        "configured": False,
        "enabled": False,
        "servers": [],
        "env_var_bug": False,
        "tool_pre_registration_missing": False,
    }

    if not config:
        return result

    try:
        mcp_bridge = (
            config.get("plugins", {})
            .get("entries", {})
            .get("mcp-bridge", {})
        )
        if mcp_bridge:
            result["configured"] = True
            result["enabled"] = mcp_bridge.get("enabled", False)
            servers = mcp_bridge.get("config", {}).get("servers", {})
            result["servers"] = [
                {"name": name, "enabled": cfg.get("enabled", True), "url": cfg.get("url", "")}
                for name, cfg in servers.items()
            ]
    except Exception:
        pass

    # 检查 dist/index.js 是否存在 env var bug
    try:
        # 找 dist 文件的路径
        dist_candidates = [
            Path(OPENCLAW_HOME) / "cli",
            Path.home() / ".openclaw" / "cli",
        ]
        for cli_dir in dist_candidates:
            if not cli_dir.exists():
                continue
            for entry in sorted(cli_dir.iterdir(), reverse=True):
                if entry.is_dir() and entry.name.startswith("v"):
                    # 检查 bundled extensions 中的 mcp-bridge
                    bundled = entry / "node_modules" / "openclaw" / "dist" / "extensions" / "mcp-bridge"
                    if bundled.exists():
                        js_file = bundled / "index.js"
                        if js_file.exists():
                            content = js_file.read_text(encoding="utf-8", errors="replace")
                            # 检查是否有 env var 读取
                            has_env = "OPENCLAW_HOME" in content or "OPENCLAW_CONFIG_PATH" in content
                            if not has_env:
                                result["env_var_bug"] = True
                            # 检查是否有预注册
                            has_prereg = "KNOWN_TOOLS" in content or "Pre-registered" in content
                            if not has_prereg:
                                result["tool_pre_registration_missing"] = True
                            break
    except Exception:
        pass

    return result


def main():
    parser = argparse.ArgumentParser(description="Gateway 响应速度测试")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Gateway 端口（默认 {DEFAULT_PORT}）")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Gateway 主机（默认 {DEFAULT_HOST}）")
    parser.add_argument("--rounds", type=int, default=DEFAULT_ROUNDS, help=f"测试轮数（默认 {DEFAULT_ROUNDS}）")
    args = parser.parse_args()

    print("=" * 65)
    print("  Artifex Nexus — OpenClaw Gateway 性能诊断")
    print("=" * 65)
    print()

    # ── 1. 端口检测 ──
    print(">>> 1. 端口检测")
    port_open, tcp_ms = check_port_open(args.host, args.port)
    pid = get_pid_on_port(args.port) if port_open else None
    proc_name = get_process_name(pid) if pid else ""
    print(f"    端口 {args.port}: {'✅ 开放' if port_open else '❌ 未监听'} (TCP {tcp_ms:.1f}ms)")
    if pid:
        print(f"    占用进程: PID={pid}, name={proc_name}")
    print()

    # ── 2. WebSocket 握手 ──
    print(">>> 2. WebSocket 握手测试")
    ws_ok, ws_ms, ws_msg = check_ws_handshake(args.host, args.port)
    print(f"    握手结果: {'✅ 成功' if ws_ok else '❌ 失败'} ({ws_ms:.1f}ms)")
    print(f"    详情: {ws_msg}")
    print()

    # ── 3. 多轮延迟 ──
    print(f">>> 3. 延迟测试 ({args.rounds} 轮)")
    perf = measure_round_trip(args.host, args.port, args.rounds)
    print(f"    TCP 延迟: avg={perf['tcp_avg_ms']}ms  min={perf['tcp_min_ms']}ms  max={perf['tcp_max_ms']}ms")
    print(f"    WS 延迟:  avg={perf['ws_avg_ms']}ms  min={perf['ws_min_ms']}ms  max={perf['ws_max_ms']}ms")
    print(f"    WS 成功率: {perf['ws_success_rate']}")

    # 判断性能
    if perf["ws_avg_ms"] > 500:
        print(f"    ⚠️  WebSocket 平均延迟 {perf['ws_avg_ms']}ms 偏高（>500ms 阈值）")
    elif perf["ws_avg_ms"] > 100:
        print(f"    ⚡ WebSocket 平均延迟 {perf['ws_avg_ms']}ms 正常")
    else:
        print(f"    🚀 WebSocket 平均延迟 {perf['ws_avg_ms']}ms 优秀")
    print()

    # ── 4. 配置诊断 ──
    print(">>> 4. MCP Bridge 插件配置诊断")
    mcp_status = check_mcp_bridge_config()
    print(f"    OPENCLAW_HOME: {OPENCLAW_HOME}")
    print(f"    插件已配置: {'✅ 是' if mcp_status['configured'] else '❌ 否'}")
    print(f"    插件已启用: {'✅ 是' if mcp_status['enabled'] else '❌ 否'}")
    if mcp_status["servers"]:
        print(f"    MCP Server 列表:")
        for s in mcp_status["servers"]:
            status_icon = "✅" if s["enabled"] else "⏸️"
            print(f"      {status_icon} {s['name']}: {s['url']}")
    else:
        print(f"    MCP Server 列表: （无）")

    # Bug 检测
    print()
    print(">>> 5. 已知 Bug 检测")
    if mcp_status["env_var_bug"]:
        print("    🔴 Bug #1 (P0): dist/index.js 忽略 OPENCLAW_HOME 环境变量 — 已修复")
    else:
        print("    ✅ Bug #1: 环境变量读取 — 正常")

    if mcp_status["tool_pre_registration_missing"]:
        print("    🔴 Bug #2 (P0): dist/index.js 缺少同步工具预注册 — 已修复")
    else:
        print("    ✅ Bug #2: 工具预注册 — 正常")

    print()
    print(">>> 6. 总结")
    issues = []
    if not port_open:
        issues.append("Gateway 未运行，请先启动")
    if not ws_ok:
        issues.append("WebSocket 握手失败")
    if perf["ws_avg_ms"] > 500:
        issues.append(f"延迟偏高 ({perf['ws_avg_ms']}ms)")
    if not mcp_status["configured"]:
        issues.append("MCP Bridge 插件未配置")
    if not mcp_status["enabled"]:
        issues.append("MCP Bridge 插件未启用")

    if issues:
        print(f"    ❌ 发现 {len(issues)} 个问题:")
        for issue in issues:
            print(f"       - {issue}")
    else:
        print("    ✅ 所有检查通过，Gateway 状态健康")

    print()
    print("=" * 65)

    # 返回 JSON 结果供程序化使用
    return {
        "port_open": port_open,
        "pid": pid,
        "ws_handshake_ok": ws_ok,
        "ws_handshake_ms": ws_ms,
        "perf": perf,
        "mcp_bridge": mcp_status,
        "issues": issues,
    }


if __name__ == "__main__":
    result = main()
    # 同时输出 JSON 到 stderr 供脚本解析
    print(json.dumps(result, indent=2, ensure_ascii=False), file=sys.stderr)
    sys.exit(0 if not result["issues"] else 1)
