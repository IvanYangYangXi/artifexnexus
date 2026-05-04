"""
端口探测：默认 14523，冲突自动扫描 14524–14599。

骨架阶段：实现 find_available_port，后续集成到 sidecar JSON-RPC method。
"""

import socket

DEFAULT_PORT = 14523
SCAN_RANGE_START = 14524
SCAN_RANGE_END = 14599


def is_port_available(port: int, host: str = "127.0.0.1") -> bool:
    """检查端口是否可用（bind 后立即 close）。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def find_available_port(start: int = DEFAULT_PORT, end: int = SCAN_RANGE_END) -> int:
    """从 start 开始扫描，返回第一个可用端口。"""
    for port in range(start, end + 1):
        if is_port_available(port):
            return port
    raise RuntimeError(f"端口范围 {start}–{end} 内无可用端口")
