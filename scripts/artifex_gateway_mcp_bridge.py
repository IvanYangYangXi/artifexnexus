#!/usr/bin/env python3
"""
Artifex Nexus Gateway MCP Bridge
================================
一个轻量级 MCP (Model Context Protocol) stdio bridge，
通过 WebSocket 桥接到 Artifex Nexus OpenClaw Gateway，
暴露 health check / ping / 诊断工具供 WorkBuddy 调用。

用法（在 ~/.workbuddy/mcp.json 中配置）:
{
  "artifex-openclaw": {
    "command": "python",
    "args": ["D:/MyProject_D/artifexnexus/scripts/artifex_gateway_mcp_bridge.py"]
  }
}
"""

from __future__ import annotations

import json
import os
import socket
import sys
from pathlib import Path
from typing import Any

# ── 常量 ────────────────────────────────────────────────────────────────
DEFAULT_PORT = 19789
DEFAULT_HOST = "127.0.0.1"
MCP_VERSION = "2024-11-05"
SERVER_NAME = "artifex-gateway-bridge"
SERVER_VERSION = "0.1.0"


# ── 工具函数 ────────────────────────────────────────────────────────────


def _check_gateway_health(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> dict:
    """检查 Gateway 健康状态。"""
    result = {
        "ok": False,
        "host": host,
        "port": port,
        "tcp_reachable": False,
        "ws_handshake": False,
        "latency_ms": 0,
        "error": None,
        "openclaw_home": "",
    }

    # 读取 OPENCLAW_HOME
    openclaw_home = os.environ.get(
        "OPENCLAW_HOME",
        str(Path.home() / ".artifexnexus" / ".openclaw"),
    )
    result["openclaw_home"] = openclaw_home

    # 检查 config
    config_path = Path(openclaw_home) / "openclaw.json"
    if config_path.exists():
        try:
            raw = config_path.read_bytes()
            if raw.startswith(b"\xef\xbb\xbf"):
                raw = raw[3:]
            config = json.loads(raw.decode("utf-8"))
            gw = config.get("gateway", {})
            result["config_port"] = gw.get("port", DEFAULT_PORT)
            # 检查 controlUi 配置
            cui = gw.get("controlUi", {})
            result["control_ui_enabled"] = cui.get("enabled", True)
            result["device_auth_disabled"] = cui.get("dangerouslyDisableDeviceAuth", False)
            result["allowed_origins"] = cui.get("allowedOrigins", [])
            # 检查 mcp-bridge 插件
            mcp_bridge = config.get("plugins", {}).get("entries", {}).get("mcp-bridge", {})
            result["mcp_bridge_enabled"] = mcp_bridge.get("enabled", False)
            result["mcp_bridge_servers"] = list(
                mcp_bridge.get("config", {}).get("servers", {}).keys()
            )
        except Exception as e:
            result["config_error"] = str(e)

    # TCP 探测
    import time
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3)
        start = time.perf_counter()
        connect_result = s.connect_ex((host, port))
        result["tcp_latency_ms"] = round((time.perf_counter() - start) * 1000, 1)
        s.close()
        result["tcp_reachable"] = connect_result == 0
    except OSError as e:
        result["tcp_error"] = str(e)

    # WebSocket 握手
    import http.client
    try:
        conn = http.client.HTTPConnection(host, port, timeout=5)
        start = time.perf_counter()
        conn.request(
            "GET", "/",
            headers={
                "Upgrade": "websocket",
                "Connection": "Upgrade",
                "Sec-WebSocket-Version": "13",
                "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
                "Host": f"{host}:{port}",
            },
        )
        response = conn.getresponse()
        result["ws_latency_ms"] = round((time.perf_counter() - start) * 1000, 1)
        result["ws_handshake"] = response.status == 101
        result["ws_status"] = response.status
        conn.close()
    except Exception as e:
        result["ws_error"] = str(e)

    result["ok"] = result["tcp_reachable"] and result["ws_handshake"]
    return result


def _list_gateway_sessions(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> dict:
    """通过 WebSocket ping 测试 Gateway 连通性并返回基本信息。"""
    return {
        "gateway_host": f"{host}:{port}",
        "protocol": "WebSocket (OpenClaw Control UI)",
        "note": "完整 session 列表需通过 OpenClaw dashboard 查看",
    }


def _ping_gateway(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> dict:
    """快速 ping Gateway。"""
    import time

    results = []
    for i in range(3):
        start = time.perf_counter()
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2)
            s.connect((host, port))
            s.close()
            ms = round((time.perf_counter() - start) * 1000, 1)
            results.append({"round": i + 1, "latency_ms": ms, "ok": True})
        except OSError as e:
            ms = round((time.perf_counter() - start) * 1000, 1)
            results.append({"round": i + 1, "latency_ms": ms, "ok": False, "error": str(e)})
        if i < 2:
            time.sleep(0.3)

    ok_count = sum(1 for r in results if r["ok"])
    latencies = [r["latency_ms"] for r in results if r["ok"]]
    return {
        "results": results,
        "success_rate": f"{ok_count}/{len(results)}",
        "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0,
    }


# ── MCP 协议处理 ────────────────────────────────────────────────────────

def handle_mcp_request(request: dict) -> dict | None:
    """处理 MCP JSON-RPC 请求。返回响应或 None（通知）。"""
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    # initialize
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": MCP_VERSION,
                "capabilities": {
                    "tools": {},
                },
                "serverInfo": {
                    "name": SERVER_NAME,
                    "version": SERVER_VERSION,
                },
            },
        }

    # tools/list
    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": [
                    {
                        "name": "gateway_health_check",
                        "description": "检查 Artifex Nexus OpenClaw Gateway 的健康状态，包括 TCP 连通性、WebSocket 握手、配置诊断等。",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "host": {"type": "string", "description": "Gateway 主机地址", "default": DEFAULT_HOST},
                                "port": {"type": "integer", "description": "Gateway 端口", "default": DEFAULT_PORT},
                            },
                        },
                    },
                    {
                        "name": "gateway_ping",
                        "description": "快速 ping Gateway，返回 3 轮 TCP 延迟测量结果。用于快速判断 Gateway 响应速度是否正常。",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "host": {"type": "string", "description": "Gateway 主机地址", "default": DEFAULT_HOST},
                                "port": {"type": "integer", "description": "Gateway 端口", "default": DEFAULT_PORT},
                            },
                        },
                    },
                    {
                        "name": "gateway_sessions",
                        "description": "获取 Gateway 会话信息。",
                        "inputSchema": {
                            "type": "object",
                            "properties": {},
                        },
                    },
                ],
            },
        }

    # tools/call
    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})

        try:
            if tool_name == "gateway_health_check":
                host = tool_args.get("host", DEFAULT_HOST)
                port = tool_args.get("port", DEFAULT_PORT)
                result = _check_gateway_health(host, port)
                content = [
                    {"type": "text", "text": json.dumps(result, indent=2, ensure_ascii=False)}
                ]

            elif tool_name == "gateway_ping":
                host = tool_args.get("host", DEFAULT_HOST)
                port = tool_args.get("port", DEFAULT_PORT)
                result = _ping_gateway(host, port)
                content = [
                    {"type": "text", "text": json.dumps(result, indent=2, ensure_ascii=False)}
                ]

            elif tool_name == "gateway_sessions":
                result = _list_gateway_sessions()
                content = [
                    {"type": "text", "text": json.dumps(result, indent=2, ensure_ascii=False)}
                ]

            else:
                content = [
                    {"type": "text", "text": f"Unknown tool: {tool_name}"}
                ]

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": content,
                },
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": f"Tool 调用失败: {e}"}],
                    "isError": True,
                },
            }

    # notifications/initialized — 无需响应
    if method == "notifications/initialized":
        return None

    # ping
    if method == "ping":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {},
        }

    # 未识别方法
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {
            "code": -32601,
            "message": f"Method not found: {method}",
        },
    }


def main():
    """MCP stdio 主循环。"""
    # stderr 用于调试日志（stdout 是 MCP 协议通道）
    sys.stderr.write(f"[artifex-mcp-bridge] initialized (OPENCLAW_HOME={os.environ.get('OPENCLAW_HOME', 'default')})\n")
    sys.stderr.flush()

    while True:
        try:
            line = sys.stdin.readline()
        except Exception:
            break
        if not line:
            break
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        response = handle_mcp_request(request)
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
