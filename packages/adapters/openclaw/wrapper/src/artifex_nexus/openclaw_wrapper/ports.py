"""
端口探测：默认 19789（与上游默认 18789 隔离 +1000），冲突按 +20 步进自动迁移。

Port probing: default 19789 (isolated +1000 from upstream default 18789).
On conflict, auto-migrate with +20 step to preserve derived port segment isolation.

详见 docs/specs/openclaw-upstream-survey.md §3 与 openclaw-wrapper-runtime.md §4。
"""

import socket
from typing import Optional

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DEFAULT_PORT = 19789
"""默认 gateway 端口（与上游 18789 隔离 +1000）。"""

PORT_STEP = 20
"""端口步进（保证派生端口段隔离：controlPort=port+2, CDP=controlPort+9..+108）。"""

MAX_TRIES = 5
"""最大尝试次数。"""

# ---------------------------------------------------------------------------
# 端口探测
# ---------------------------------------------------------------------------


def is_port_available(port: int, host: str = "127.0.0.1") -> bool:
    """检查端口是否可用（bind 后立即 close）。

    Check if a port is available by attempting to bind then immediately closing.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((host, port))
            return True
        except OSError:
            return False


def _probe_derived_segment(base: int, host: str = "127.0.0.1") -> bool:
    """探测派生端口段是否全部空闲。

    派生端口段 = [base, base+2, base+11..base+110]。
    只有全部空闲才认为 base 可用（避免选中 base 但 controlPort 被占的 bug）。

    Probe the derived port segment to ensure all ports are free.
    Derived segment = [base, base+2, base+11..base+110].
    """
    # 先检查 base 和 controlPort
    if not is_port_available(base, host):
        return False
    if not is_port_available(base + 2, host):
        return False

    # 检查 CDP 端口段（base+11 到 base+110）
    for p in range(base + 11, base + 111):
        if not is_port_available(p, host):
            return False

    return True


def pick_port(
    preferred: int = DEFAULT_PORT,
    step: int = PORT_STEP,
    max_tries: int = MAX_TRIES,
    host: str = "127.0.0.1",
) -> int:
    """返回首个可用的端口（含派生端口段 probe）。

    Pick the first available port with full derived segment availability.

    Args:
        preferred: 首选端口，默认 19789。
        step: 步进值，默认 20（保证派生端口段隔离）。
        max_tries: 最大尝试次数，默认 5。
        host: 绑定地址，默认 127.0.0.1。

    Returns:
        首个可用端口号。

    Raises:
        RuntimeError: 所有候选端口均不可用。
    """
    for i in range(max_tries):
        candidate = preferred + i * step
        if _probe_derived_segment(candidate, host):
            return candidate

    raise RuntimeError(
        f"端口范围 {preferred}–{preferred + (max_tries - 1) * step} "
        f"内无可用端口（含派生段），请手动指定"
    )


def find_available_port(
    start: int = DEFAULT_PORT,
    end: int | None = None,
    step: int = PORT_STEP,
) -> int:
    """从 start 开始按 step 扫描，返回第一个可用端口。

    兼容旧 API（骨架阶段），内部调用 pick_port。

    Scan from start with step, return first available port.
    Compatible with legacy skeleton API.
    """
    if end is not None:
        # 旧 API：线性扫描
        for port in range(start, end + 1):
            if is_port_available(port):
                return port
        raise RuntimeError(f"端口范围 {start}–{end} 内无可用端口")

    return pick_port(preferred=start, step=step)


# ---------------------------------------------------------------------------
# 端口持久化
# ---------------------------------------------------------------------------


def read_last_port(ports_json_path: str) -> Optional[int]:
    """从 run/ports.json 读取上次成功端口。

    Read the last successful port from run/ports.json.
    """
    import json
    from pathlib import Path

    path = Path(ports_json_path).expanduser().resolve()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        port = data.get("gateway_port")
        if isinstance(port, int) and 1024 <= port <= 65535:
            return port
    except (json.JSONDecodeError, KeyError, ValueError):
        pass
    return None


def write_last_port(ports_json_path: str, port: int) -> None:
    """写入 run/ports.json 记录当前端口。

    Write the current port to run/ports.json.
    """
    import json
    from pathlib import Path

    path = Path(ports_json_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "gateway_port": port,
        "control_port": port + 2,
        "cdp_range": f"{port + 11}-{port + 110}",
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
