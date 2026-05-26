"""
mcp_server.py - Artifex Nexus MCP WebSocket 服务器（共享模块）
=============================================================

提取自 Blender addon，供所有 DCC（Blender / Maya / Max / UE / ...）复用。

核心类 MCPServer 通过构造参数 dcc_name / server_name / server_version / port
参数化，内置工具注册（register_builtin_tools）保留在各 DCC 侧（工具描述与 DCC 绑定）。

在独立线程中运行 asyncio 事件循环。
工具调用通过 adapter 转发到 DCC 主线程执行。
"""

from __future__ import annotations

import asyncio
import json
import logging
import socket
import threading
import time
from typing import Any, Callable, Dict, Optional, Set

logger = logging.getLogger("artifex.mcp")

# ── 常量 ────────────────────────────────────────────────────────────────

JSONRPC_VERSION = "2.0"
MCP_VERSION = "2024-11-05"

DEFAULT_HOST = "127.0.0.1"
MAX_PORT_PROBE = 10

WS_PING_INTERVAL = 30
WS_PING_TIMEOUT = 10

# JSON-RPC 错误码
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INTERNAL_ERROR = -32603

# ── websockets 可用性检查 ───────────────────────────────────────────────

_HAS_WEBSOCKETS = False
try:
    from websockets.server import serve as ws_serve
    from websockets.exceptions import ConnectionClosed
    _HAS_WEBSOCKETS = True
except ImportError:
    pass


# ── JSON-RPC 辅助 ───────────────────────────────────────────────────────

def _make_jsonrpc_response(request_id: Any, result: Any) -> str:
    return json.dumps({
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "result": result,
    }, default=str, ensure_ascii=False)


def _make_jsonrpc_error(request_id: Any, code: int, message: str) -> str:
    return json.dumps({
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "error": {"code": code, "message": message},
    }, default=str, ensure_ascii=False)


# ── MCPServer ───────────────────────────────────────────────────────────

class MCPServer:
    """
    MCP WebSocket 通信服务器（共享模块）。

    通过 dcc_name / dcc_version / port 参数化，支持多 DCC 复用。

    在独立线程中运行 asyncio 事件循环。
    工具调用通过 adapter 转发到 DCC 主线程执行。
    """

    def __init__(
        self,
        dcc_name: str = "unknown",
        dcc_version: str = "0.1.0",
        host: str = DEFAULT_HOST,
        port: int = 0,
        max_port_probe: int = 10,
    ):
        self._dcc_name = dcc_name
        self._dcc_version = dcc_version
        self._host = host
        self._port = port
        self._max_port_probe = max_port_probe
        self._actual_port: Optional[int] = None

        # 从 dcc_name 推导 server_name，如 "blender" → "artifex-nexus-blender"
        self._server_name = f"artifex-nexus-{dcc_name}"

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._server = None
        self._thread: Optional[threading.Thread] = None

        self._clients: Set = set()
        self._initialized_clients: Set[int] = set()

        self._running = False

        # Tool 注册表
        self._tools: Dict[str, dict] = {}

        # 主线程执行器（由外部注入，如 adapter.execute_deferred）
        self._main_thread_executor: Optional[Callable] = None

        # adapter 引用（供主线程调度使用）
        self._adapter_ref = None

    # ── 属性 ──

    @property
    def dcc_name(self) -> str:
        return self._dcc_name

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def actual_port(self) -> Optional[int]:
        return self._actual_port

    @property
    def server_address(self) -> str:
        if self._actual_port:
            return f"ws://{self._host}:{self._actual_port}"
        return ""

    # ── 主线程执行器注入 ──

    def set_main_thread_executor(self, executor: Callable) -> None:
        """注入主线程执行器（adapter.execute_deferred）"""
        self._main_thread_executor = executor

    def set_adapter(self, adapter) -> None:
        """注入 adapter 引用"""
        self._adapter_ref = adapter

    # ── 端口探测 ──

    @staticmethod
    def _is_port_available(host: str, port: int) -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                s.bind((host, port))
                return True
        except OSError:
            return False

    def _find_available_port(self) -> int:
        for offset in range(self._max_port_probe):
            candidate = self._port + offset
            if self._is_port_available(self._host, candidate):
                if offset > 0:
                    logger.info(f"端口 {self._port} 被占用，使用 {candidate}")
                return candidate
        logger.warning(f"所有端口 {self._port}-{self._port + self._max_port_probe} 被占用")
        return self._port

    # ── WebSocket 连接处理 ──

    async def _connection_handler(self, websocket):
        client_id = id(websocket)
        self._clients.add(websocket)
        logger.info(f"[{self._dcc_name}] MCP 客户端连接 (总数: {len(self._clients)})")

        try:
            async for raw_message in websocket:
                try:
                    response = await self._handle_message(websocket, raw_message)
                    if response:
                        await websocket.send(response)
                except Exception as e:
                    logger.error(f"[{self._dcc_name}] 消息处理异常: {e}")
                    try:
                        await websocket.send(
                            _make_jsonrpc_error(None, INTERNAL_ERROR, str(e))
                        )
                    except Exception:
                        pass

        except ConnectionClosed:
            pass
        except Exception as e:
            logger.error(f"[{self._dcc_name}] 连接异常: {e}")
        finally:
            self._clients.discard(websocket)
            self._initialized_clients.discard(client_id)
            logger.info(f"[{self._dcc_name}] MCP 客户端断开 (剩余: {len(self._clients)})")

    # ── MCP 消息路由 ──

    async def _handle_message(self, websocket, raw_message: str) -> Optional[str]:
        try:
            msg = json.loads(raw_message)
        except json.JSONDecodeError as e:
            return _make_jsonrpc_error(None, PARSE_ERROR, f"JSON 解析错误: {e}")

        if not isinstance(msg, dict) or msg.get("jsonrpc") != JSONRPC_VERSION:
            return _make_jsonrpc_error(msg.get("id"), INVALID_REQUEST, "无效的 JSON-RPC 2.0 请求")

        method = msg.get("method", "")
        params = msg.get("params", {})
        request_id = msg.get("id")

        handlers = {
            "initialize": self._handle_initialize,
            "initialized": self._handle_initialized,
            "ping": self._handle_ping,
            "tools/list": self._handle_tools_list,
            "tools/call": self._handle_tools_call,
        }

        handler = handlers.get(method)
        if handler is None:
            if request_id is not None:
                return _make_jsonrpc_error(request_id, METHOD_NOT_FOUND, f"未知方法: {method}")
            return None

        try:
            result = await handler(websocket, params)
            if request_id is not None:
                return _make_jsonrpc_response(request_id, result)
            return None
        except Exception as e:
            logger.error(f"[{self._dcc_name}] 处理 {method} 异常: {e}")
            if request_id is not None:
                return _make_jsonrpc_error(request_id, INTERNAL_ERROR, str(e))
            return None

    # ── MCP 协议方法 ──

    async def _handle_initialize(self, websocket, params: dict) -> dict:
        client_info = params.get("clientInfo", {})
        logger.info(f"[{self._dcc_name}] MCP initialize 来自 {client_info.get('name', 'unknown')}")
        return {
            "protocolVersion": MCP_VERSION,
            "capabilities": {
                "tools": {"listChanged": True},
            },
            "serverInfo": {
                "name": self._server_name,
                "version": self._dcc_version,
            },
        }

    async def _handle_initialized(self, websocket, params: dict) -> None:
        self._initialized_clients.add(id(websocket))
        logger.info(f"[{self._dcc_name}] MCP 客户端已初始化")

    async def _handle_ping(self, websocket, params: dict) -> dict:
        return {}

    async def _handle_tools_list(self, websocket, params: dict) -> dict:
        tools = []
        for tool in self._tools.values():
            tools.append({k: v for k, v in tool.items() if not k.startswith("_")})
        return {"tools": tools}

    async def _handle_tools_call(self, websocket, params: dict) -> dict:
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})

        if tool_name not in self._tools:
            return {
                "content": [{"type": "text", "text": f"未知工具: {tool_name}"}],
                "isError": True,
            }

        logger.info(f"[{self._dcc_name}] tools/call -> {tool_name}")

        tool_def = self._tools[tool_name]
        handler = tool_def.get("_handler")
        if handler is None:
            return {
                "content": [{"type": "text", "text": f"工具 '{tool_name}' 无 handler"}],
                "isError": True,
            }

        try:
            # 需要主线程执行：通过 adapter.execute_on_main_thread 调度
            if tool_def.get("_main_thread", False) and self._adapter_ref:
                result = await self._execute_on_main_thread(handler, arguments)
            elif asyncio.iscoroutinefunction(handler):
                result = await handler(arguments)
            else:
                result = handler(arguments)

            # 标准化结果
            if isinstance(result, dict) and "content" in result:
                mcp_result = result
            else:
                mcp_result = {
                    "content": [{"type": "text", "text": str(result)}],
                    "isError": False,
                }

            return mcp_result

        except Exception as e:
            logger.error(f"[{self._dcc_name}] 工具执行异常 ({tool_name}): {e}")
            return {
                "content": [{"type": "text", "text": f"执行错误: {str(e)}"}],
                "isError": True,
            }

    async def _execute_on_main_thread(self, handler: Callable, arguments: dict) -> Any:
        """在 DCC 主线程执行工具 handler。

        通过 loop.run_in_executor 调用 adapter.execute_on_main_thread，
        避免阻塞 asyncio 事件循环。
        adapter.execute_on_main_thread 内部有 30s 超时保护。
        """
        if self._adapter_ref is None:
            raise RuntimeError("DCC adapter 未注入，无法调度主线程执行")

        loop = asyncio.get_event_loop()

        try:
            result = await loop.run_in_executor(
                None,
                self._adapter_ref.execute_on_main_thread,
                handler,
                arguments,
            )
            return result
        except TimeoutError:
            logger.error(f"[{self._dcc_name}] 主线程执行超时 (30s)")
            raise
        except Exception:
            logger.error(f"[{self._dcc_name}] 主线程执行异常", exc_info=True)
            raise

    # ── Tool 注册接口 ──

    def register_tool(self, name: str, description: str,
                      input_schema: dict, handler: Callable,
                      main_thread: bool = False) -> None:
        """
        注册 MCP 工具。

        Args:
            name: 工具名称
            description: 工具描述（AI 会看到）
            input_schema: JSON Schema 参数定义
            handler: 执行函数
            main_thread: 是否必须在 DCC 主线程执行
        """
        self._tools[name] = {
            "name": name,
            "description": description,
            "inputSchema": input_schema,
            "_handler": handler,
            "_main_thread": main_thread,
        }
        logger.info(f"[{self._dcc_name}] 工具已注册: {name}" + (" [主线程]" if main_thread else ""))

    def unregister_tool(self, name: str) -> None:
        if name in self._tools:
            del self._tools[name]

    # ── 服务器生命周期 ──

    def start(self) -> bool:
        """启动 MCP Server（在独立线程中运行 asyncio）"""
        if not _HAS_WEBSOCKETS:
            logger.error(f"[{self._dcc_name}] websockets 不可用。请安装: pip install websockets")
            return False

        if self._running:
            logger.warning(f"[{self._dcc_name}] MCP Server 已在运行")
            return True

        self._thread = threading.Thread(
            target=self._run_loop, daemon=True, name=f"Artifex-MCP-{self._dcc_name}"
        )
        self._thread.start()

        # 等待启动
        deadline = time.time() + 5.0
        while time.time() < deadline and not self._running:
            time.sleep(0.1)

        return self._running

    def _run_loop(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._start_server())
            if self._running:
                self._loop.run_forever()
        except Exception as e:
            logger.error(f"[{self._dcc_name}] MCP Server 循环异常: {e}")
        finally:
            self._loop.close()
            self._loop = None

    async def _start_server(self) -> None:
        self._actual_port = self._find_available_port()

        # max_port_probe=0 表示固定端口（不探测），但仍需尝试绑定一次
        max_attempts = max(self._max_port_probe, 1)
        for _ in range(max_attempts):
            try:
                self._server = await ws_serve(
                    self._connection_handler,
                    self._host,
                    self._actual_port,
                    ping_interval=WS_PING_INTERVAL,
                    ping_timeout=WS_PING_TIMEOUT,
                )
                break
            except OSError as e:
                if "address already in use" in str(e).lower() or getattr(e, "errno", 0) == 10048:
                    if self._max_port_probe > 0:
                        logger.warning(f"[{self._dcc_name}] 端口 {self._actual_port} 被占用，尝试下一个...")
                        self._actual_port += 1
                        continue
                    else:
                        # 固定端口模式，端口占用即失败
                        raise
                else:
                    raise
        else:
            logger.error(f"[{self._dcc_name}] 无法绑定端口 {self._port}-{self._actual_port}")
            return

        self._running = True
        logger.info(f"[{self._dcc_name}] MCP Server 已启动: {self.server_address}")

    def broadcast_trigger_event(self, event_type: str, filepath: str = "",
                                  timing: str = "", data: dict = None) -> None:
        """向所有已连接的 Artifex Nexus 客户端广播触发器事件。

        线程安全：可从 DCC 主线程调用（通过 call_soon_threadsafe 投递）。

        Args:
            event_type: 事件类型，如 "file.save.post"
            filepath: 当前场景文件路径
            timing: 事件时序，如 "pre" / "post"
            data: 增强事件数据（scene_name, asset_class 等）
        """
        if not self._running or not self._loop:
            return
        if not self._clients:
            return

        payload_dict = {
            "type": "trigger_event",
            "dcc": self._dcc_name,
            "event": event_type,
            "filepath": filepath,
        }
        if timing:
            payload_dict["timing"] = timing
        if data:
            payload_dict["data"] = data

        payload = json.dumps(payload_dict)

        async def _broadcast():
            dead: list = []
            for ws in list(self._clients):
                try:
                    await ws.send(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self._clients.discard(ws)

        try:
            asyncio.run_coroutine_threadsafe(_broadcast(), self._loop)
        except Exception:
            pass  # 静默失败

    def stop(self) -> None:
        """停止 MCP Server"""
        if not self._running:
            return

        self._running = False

        if self._loop and self._loop.is_running():
            async def _shutdown():
                if self._clients:
                    for ws in list(self._clients):
                        try:
                            await ws.close(1001, "Server shutting down")
                        except Exception:
                            pass
                    self._clients.clear()
                    self._initialized_clients.clear()

                if self._server:
                    self._server.close()
                    await self._server.wait_closed()
                    self._server = None

                self._loop.stop()

            asyncio.run_coroutine_threadsafe(_shutdown(), self._loop)

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)

        self._actual_port = None
        self._thread = None
        logger.info(f"[{self._dcc_name}] MCP Server 已停止")
