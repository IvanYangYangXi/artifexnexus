"""Sidecar JSON-RPC 服务端测试。"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

SIDECAR_PATH = (
    Path(__file__).parent.parent
    / "src"
    / "artifex_nexus"
    / "openclaw_wrapper"
    / "sidecar.py"
)


def _call_sidecar(method: str, params: dict | None = None, req_id: int = 1) -> dict:
    """通过 stdio 调用 sidecar，返回解析后的响应 dict。"""
    request = {"jsonrpc": "2.0", "method": method, "params": params or {}, "id": req_id}
    result = subprocess.run(
        [sys.executable, str(SIDECAR_PATH)],
        input=json.dumps(request) + "\n",
        capture_output=True,
        text=True,
        timeout=10,
    )
    return json.loads(result.stdout.strip())


def test_ping():
    """ping 应返回 pong。"""
    resp = _call_sidecar("ping")
    assert resp["id"] == 1
    assert resp["result"] == "pong"


def test_get_port_default():
    """get_port 默认返回 19789。"""
    resp = _call_sidecar("get_port")
    assert resp["id"] == 1
    assert resp["result"]["port"] == 19789


def test_get_port_custom():
    """get_port 从指定端口开始扫描。"""
    resp = _call_sidecar("get_port", {"port": 19809})
    assert resp["id"] == 1
    assert resp["result"]["port"] == 19809


def test_unknown_method():
    """未知 method 返回 -32601。"""
    resp = _call_sidecar("nonexistent")
    assert resp["id"] == 1
    assert resp["error"]["code"] == -32601


def test_parse_error():
    """非法 JSON 返回 -32700。"""
    result = subprocess.run(
        [sys.executable, str(SIDECAR_PATH)],
        input="not valid json\n",
        capture_output=True,
        text=True,
        timeout=10,
    )
    resp = json.loads(result.stdout.strip())
    assert resp["id"] is None
    assert resp["error"]["code"] == -32700


def test_multiple_requests():
    """连续多个请求各自独立响应。"""
    requests = [
        {"jsonrpc": "2.0", "method": "ping", "id": 1},
        {"jsonrpc": "2.0", "method": "ping", "id": 2},
        {"jsonrpc": "2.0", "method": "get_port", "params": {"port": 19809}, "id": 3},
    ]
    input_str = "\n".join(json.dumps(r) for r in requests) + "\n"
    result = subprocess.run(
        [sys.executable, str(SIDECAR_PATH)],
        input=input_str,
        capture_output=True,
        text=True,
        timeout=10,
    )
    lines = [l for l in result.stdout.strip().split("\n") if l]
    assert len(lines) == 3
    resp1 = json.loads(lines[0])
    resp2 = json.loads(lines[1])
    resp3 = json.loads(lines[2])
    assert resp1["result"] == "pong"
    assert resp2["result"] == "pong"
    assert resp3["result"]["port"] == 19809


def test_openclaw_upgrade_not_implemented():
    """openclaw.upgrade 应返回 not_implemented。"""
    resp = _call_sidecar("openclaw.upgrade")
    assert resp["id"] == 1
    assert resp["result"]["status"] == "not_implemented"


def test_openclaw_rollback_not_implemented():
    """openclaw.rollback 应返回 not_implemented。"""
    resp = _call_sidecar("openclaw.rollback")
    assert resp["id"] == 1
    assert resp["result"]["status"] == "not_implemented"
