"""
mcp_bridge.py — Gateway ↔ DCC MCP 桥接层
=========================================

作为 WebSocket 客户端连接 Blender MCP Server，
将 sidecar RPC 请求转发为 MCP tools/call 调用。

复刻自 artclaw_bridge/subprojects/DCCClawBridge/core/bridge_dcc.py，
精简：去掉 RetryTracker、MemoryStore、SkillRuntime、Bridge UI 信号。

设计：
  - 单例连接（懒初始化，按需连接）
  - 持久化 event loop（解决 "Event loop is closed" 问题）
  - 自动重连（连接断开后下次调用自动重连）
  - 超时保护（默认 30s）
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ── 常量 ────────────────────────────────────────────────────────────────

DEFAULT_BLENDER_MCP_PORT = 18083
"""Blender MCP Server 默认端口（高位端口，避免与 artclaw 8083 冲突）"""

DEFAULT_TIMEOUT = 30.0
"""默认调用超时（秒）"""

JSONRPC_VERSION = "2.0"
MCP_VERSION = "2024-11-05"

# ── websockets 可用性检查 ───────────────────────────────────────────────

_HAS_WEBSOCKETS = False
try:
    import websockets
    from websockets.exceptions import ConnectionClosed
    _HAS_WEBSOCKETS = True
except ImportError:
    pass


# ── MCP 桥接客户端 ──────────────────────────────────────────────────────

class MCPBridgeClient:
    """
    Gateway 侧的 MCP 客户端 — 连接 Blender MCP Server 并转发工具调用。

    单例模式：整个 sidecar 进程共享一个连接。
    线程安全：使用 threading.Lock 保护连接状态。
    持久化 event loop：connect 和 call_tool 复用同一个 asyncio event loop，
    避免 "Event loop is closed" 错误。
    """

    _instance: Optional[MCPBridgeClient] = None
    _lock = threading.Lock()

    def __init__(self, host: str = "127.0.0.1", port: int = DEFAULT_BLENDER_MCP_PORT):
        self._host = host
        self._port = port
        self._ws: Any = None
        self._connected = False
        self._next_id = 1
        self._conn_lock = threading.Lock()
        # 持久化 event loop（生命周期与 MCPBridgeClient 一致）
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._loop_thread: Optional[threading.Thread] = None

    def _ensure_loop(self):
        """确保持久化 event loop 在后台运行"""
        if self._loop is not None and self._loop.is_running():
            return
        self._loop = asyncio.new_event_loop()
        def _run_forever():
            asyncio.set_event_loop(self._loop)
            self._loop.run_forever()
        self._loop_thread = threading.Thread(target=_run_forever, daemon=True)
        self._loop_thread.start()

    def _stop_loop(self):
        """停止持久化 event loop"""
        if self._loop is not None:
            try:
                self._loop.call_soon_threadsafe(self._loop.stop)
            except Exception:
                pass
            self._loop = None
            self._loop_thread = None

    @classmethod
    def get_instance(cls, host: str = "127.0.0.1", port: int = DEFAULT_BLENDER_MCP_PORT) -> MCPBridgeClient:
        """获取单例实例"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls(host=host, port=port)
        return cls._instance

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def server_address(self) -> str:
        return f"ws://{self._host}:{self._port}"

    # ── 连接管理 ──

    def connect(self, timeout: float = 5.0) -> bool:
        """
        连接到 Blender MCP Server（同步阻塞）。

        Returns:
            True 如果连接成功
        """
        if not _HAS_WEBSOCKETS:
            logger.error("websockets 不可用，无法连接 Blender MCP Server")
            return False

        with self._conn_lock:
            if self._connected and self._ws is not None:
                return True

            self._ensure_loop()

            try:
                future = asyncio.run_coroutine_threadsafe(
                    self._async_connect(timeout), self._loop
                )
                self._ws = future.result(timeout=timeout + 2)
                self._connected = True
                logger.info(f"已连接 Blender MCP Server: {self.server_address}")
                return True
            except Exception as e:
                logger.warning(f"连接 Blender MCP Server 失败: {e}")
                self._ws = None
                self._connected = False
                return False

    async def _async_connect(self, timeout: float) -> Any:
        """异步连接 + MCP initialize 握手"""
        ws = await asyncio.wait_for(
            websockets.connect(self.server_address),
            timeout=timeout,
        )

        # MCP initialize
        init_msg = {
            "jsonrpc": JSONRPC_VERSION,
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": MCP_VERSION,
                "clientInfo": {
                    "name": "artifex-nexus-gateway",
                    "version": "0.1.0",
                },
            },
        }
        await ws.send(json.dumps(init_msg))
        response = json.loads(await ws.recv())

        if "error" in response:
            raise RuntimeError(f"MCP initialize 失败: {response['error']}")

        logger.info(f"MCP 握手成功: {response.get('result', {}).get('serverInfo', {})}")
        return ws

    def disconnect(self) -> None:
        """断开连接"""
        with self._conn_lock:
            if self._ws is not None:
                try:
                    if self._loop is not None and self._loop.is_running():
                        future = asyncio.run_coroutine_threadsafe(
                            self._ws.close(), self._loop
                        )
                        future.result(timeout=2)
                    else:
                        # fallback: 创建临时 loop
                        loop = asyncio.new_event_loop()
                        loop.run_until_complete(self._ws.close())
                        loop.close()
                except Exception:
                    pass
                self._ws = None
            self._connected = False
            logger.info("已断开 Blender MCP Server")

    # ── 工具调用 ──

    def call_tool(self, tool_name: str, arguments: dict,
                  timeout: float = DEFAULT_TIMEOUT) -> Dict[str, Any]:
        """
        调用 Blender MCP 工具（同步阻塞）。

        Args:
            tool_name: 工具名称（如 "run_python"）
            arguments: 工具参数
            timeout: 超时秒数

        Returns:
            MCP tools/call 响应 result 字段
        """
        if not self._connected:
            if not self.connect():
                return {
                    "content": [{
                        "type": "text",
                        "text": "错误: 无法连接 Blender MCP Server。请确认 Blender 已启动且 Artifex Nexus 插件已启用。",
                    }],
                    "isError": True,
                }

        with self._conn_lock:
            if self._ws is None:
                return {
                    "content": [{"type": "text", "text": "错误: Blender MCP 连接已断开"}],
                    "isError": True,
                }

            try:
                self._ensure_loop()
                future = asyncio.run_coroutine_threadsafe(
                    self._async_call_tool(tool_name, arguments, timeout),
                    self._loop,
                )
                return future.result(timeout=timeout + 5)
            except asyncio.TimeoutError:
                self._connected = False
                self._ws = None
                return {
                    "content": [{"type": "text", "text": f"调用超时 ({timeout}s)"}],
                    "isError": True,
                }
            except Exception as e:
                self._connected = False
                self._ws = None
                logger.warning("call_tool: failed tool=%s: %s", tool_name, e)
                return {
                    "content": [{"type": "text", "text": f"调用失败: {str(e)}"}],
                    "isError": True,
                }

    async def _async_call_tool(self, tool_name: str, arguments: dict,
                               timeout: float) -> Dict[str, Any]:
        """异步调用 MCP 工具"""
        request_id = self._next_id
        self._next_id += 1

        call_msg = {
            "jsonrpc": JSONRPC_VERSION,
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }

        await self._ws.send(json.dumps(call_msg))
        response_raw = await asyncio.wait_for(
            self._ws.recv(), timeout=timeout
        )
        response = json.loads(response_raw)

        if "error" in response:
            raise RuntimeError(
                f"MCP 错误: {response['error'].get('message', str(response['error']))}"
            )

        return response.get("result", {})


# ── 便捷函数 ────────────────────────────────────────────────────────────

def call_blender_run_python(code: str, get_context: bool = False,
                            timeout: float = DEFAULT_TIMEOUT) -> Dict[str, Any]:
    """
    调用 Blender run_python 工具的便捷函数。

    Args:
        code: Python 代码
        get_context: 是否仅获取上下文
        timeout: 超时秒数

    Returns:
        MCP tools/call 响应 result
    """
    client = MCPBridgeClient.get_instance()
    arguments = {}
    if get_context:
        arguments["get_context"] = True
    else:
        arguments["code"] = code

    return client.call_tool("run_python", arguments, timeout=timeout)


def check_blender_mcp_connection(timeout: float = 3.0) -> Dict[str, Any]:
    """检测 Blender MCP Server 连通性（轻量级 ping）。

    Check Blender MCP Server connectivity by attempting a WebSocket connection.
    不会调用任何工具，仅检测 WebSocket 是否可达。

    Returns:
        {"connected": bool, "address": str, "error": str | None}
    """
    client = MCPBridgeClient.get_instance()
    address = client.server_address

    # 先断开旧连接，确保是新鲜的检测
    if client.is_connected:
        return {"connected": True, "address": address, "error": None}

    # 尝试连接（timeout 较短，仅探测）
    success = client.connect(timeout=timeout)
    if success:
        # 连接成功后断开（检测不应保持连接）
        client.disconnect()
        return {"connected": True, "address": address, "error": None}
    else:
        return {
            "connected": False,
            "address": address,
            "error": f"无法连接到 Blender MCP Server ({address})。请确认 Blender 已启动且 Artifex Nexus 插件已启用。",
        }


def check_blender_mcp_server_running(
    host: str = "127.0.0.1", port: int = DEFAULT_BLENDER_MCP_PORT, timeout: float = 1.0
) -> bool:
    """检测 Blender MCP Server 进程是否在监听端口（纯 TCP socket connect，不跑 MCP 协议）。

    Check if the Blender MCP Server process is listening on the port using a
    raw TCP socket connect — no WebSocket handshake, no MCP initialize.

    与 :func:`check_blender_mcp_connection` 的区别：
    - 本函数仅检测端口是否有进程在监听（TCP SYN → SYN-ACK → 立即关闭）
    - 不涉及 MCP 协议握手，速度极快（~1s timeout）
    - 用于区分"Blender 未启动"（端口无人监听）和"Blender 已启动但 MCP 未就绪"

    Args:
        host: MCP Server 主机地址，默认 127.0.0.1。
        port: MCP Server 端口，默认 18083。
        timeout: 连接超时秒数，默认 1s。

    Returns:
        True 如果端口上有进程在监听。
    """
    import socket as _socket
    try:
        sock = _socket.create_connection((host, port), timeout=timeout)
        sock.close()
        return True
    except (OSError, ConnectionRefusedError, TimeoutError):
        return False
