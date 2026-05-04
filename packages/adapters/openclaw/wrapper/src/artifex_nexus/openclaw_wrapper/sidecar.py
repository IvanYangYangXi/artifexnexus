"""
JSON-RPC 2.0 over stdio server — 常驻 sidecar 入口。

Protocol: NDJSON (one JSON object per line), no Content-Length header.
Methods: ping, get_port, get_config, set_config, doctor (最小 5 个 method)。
"""

import sys
import json

# 支持直接执行和包内导入两种方式
try:
    from . import ports
except ImportError:
    import ports  # type: ignore[no-redef]


def handle_request(request: dict) -> dict:
    """处理单个 JSON-RPC 请求，返回响应 dict。"""
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    if method == "ping":
        return {"jsonrpc": "2.0", "id": req_id, "result": "pong"}

    if method == "get_port":
        preferred = params.get("port", ports.DEFAULT_PORT)
        try:
            available = ports.find_available_port(start=preferred)
            return {"jsonrpc": "2.0", "id": req_id, "result": {"port": available}}
        except RuntimeError as e:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": str(e)},
            }

    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


def main() -> None:
    """stdio JSON-RPC 主循环：逐行读取 stdin，逐行写回 stdout。"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            # 非法 JSON，返回 parse error
            resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
            continue

        response = handle_request(request)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
