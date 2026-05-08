"""
mcp_server.py - Artifex Nexus MCP WebSocket 服务器（精简版）
===========================================================

复刻自 artclaw_bridge/subprojects/DCCClawBridge/core/mcp_server.py，
精简：去掉 RetryTracker、MemoryStore、SkillRuntime、Bridge UI 信号、
IMAGE 标记解析、Legacy MCP 工具。

在独立线程中运行 asyncio 事件循环。
工具调用通过 adapter 转发到 Blender 主线程执行。
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
SERVER_NAME = "artifex-nexus-blender"
SERVER_VERSION = "0.1.0"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8083
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
    MCP WebSocket 通信服务器（Blender 精简版）。

    在独立线程中运行 asyncio 事件循环。
    工具调用通过 adapter 转发到 Blender 主线程执行。
    """

    def __init__(self, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT):
        self._host = host
        self._port = port
        self._actual_port: Optional[int] = None

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
        for offset in range(MAX_PORT_PROBE):
            candidate = self._port + offset
            if self._is_port_available(self._host, candidate):
                if offset > 0:
                    logger.info(f"端口 {self._port} 被占用，使用 {candidate}")
                return candidate
        logger.warning(f"所有端口 {self._port}-{self._port + MAX_PORT_PROBE} 被占用")
        return self._port

    # ── WebSocket 连接处理 ──

    async def _connection_handler(self, websocket):
        client_id = id(websocket)
        self._clients.add(websocket)
        logger.info(f"MCP 客户端连接 (总数: {len(self._clients)})")

        try:
            async for raw_message in websocket:
                try:
                    response = await self._handle_message(websocket, raw_message)
                    if response:
                        await websocket.send(response)
                except Exception as e:
                    logger.error(f"消息处理异常: {e}")
                    try:
                        await websocket.send(
                            _make_jsonrpc_error(None, INTERNAL_ERROR, str(e))
                        )
                    except Exception:
                        pass

        except ConnectionClosed:
            pass
        except Exception as e:
            logger.error(f"连接异常: {e}")
        finally:
            self._clients.discard(websocket)
            self._initialized_clients.discard(client_id)
            logger.info(f"MCP 客户端断开 (剩余: {len(self._clients)})")

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
            logger.error(f"处理 {method} 异常: {e}")
            if request_id is not None:
                return _make_jsonrpc_error(request_id, INTERNAL_ERROR, str(e))
            return None

    # ── MCP 协议方法 ──

    async def _handle_initialize(self, websocket, params: dict) -> dict:
        client_info = params.get("clientInfo", {})
        logger.info(f"MCP initialize 来自 {client_info.get('name', 'unknown')}")
        return {
            "protocolVersion": MCP_VERSION,
            "capabilities": {
                "tools": {"listChanged": True},
            },
            "serverInfo": {
                "name": SERVER_NAME,
                "version": SERVER_VERSION,
            },
        }

    async def _handle_initialized(self, websocket, params: dict) -> None:
        self._initialized_clients.add(id(websocket))
        logger.info("MCP 客户端已初始化")

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

        logger.info(f"tools/call -> {tool_name}")

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
            logger.error(f"工具执行异常 ({tool_name}): {e}")
            return {
                "content": [{"type": "text", "text": f"执行错误: {str(e)}"}],
                "isError": True,
            }

    async def _execute_on_main_thread(self, handler: Callable, arguments: dict) -> Any:
        """在 Blender 主线程执行工具 handler。

        通过 loop.run_in_executor 调用 adapter.execute_on_main_thread，
        避免阻塞 asyncio 事件循环，消除旧实现的 1s 轮询延迟。
        adapter.execute_on_main_thread 内部有 30s 超时保护。
        """
        if self._adapter_ref is None:
            raise RuntimeError("DCC adapter 未注入，无法调度主线程执行")

        loop = asyncio.get_event_loop()

        # adapter.execute_on_main_thread(handler, arguments)
        #   → fn=handler, args=(arguments,) → handler(arguments)
        # 在线程池中阻塞等待主线程执行结果，不阻塞 asyncio 事件循环
        try:
            result = await loop.run_in_executor(
                None,
                self._adapter_ref.execute_on_main_thread,
                handler,
                arguments,
            )
            return result
        except TimeoutError:
            logger.error("主线程执行超时 (30s)")
            raise
        except Exception:
            logger.error("主线程执行异常", exc_info=True)
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
            main_thread: 是否必须在 Blender 主线程执行
        """
        self._tools[name] = {
            "name": name,
            "description": description,
            "inputSchema": input_schema,
            "_handler": handler,
            "_main_thread": main_thread,
        }
        logger.info(f"工具已注册: {name}" + (" [主线程]" if main_thread else ""))

    def unregister_tool(self, name: str) -> None:
        if name in self._tools:
            del self._tools[name]

    # ── 服务器生命周期 ──

    def start(self) -> bool:
        """启动 MCP Server（在独立线程中运行 asyncio）"""
        if not _HAS_WEBSOCKETS:
            logger.error("websockets 不可用。请安装: pip install websockets")
            return False

        if self._running:
            logger.warning("MCP Server 已在运行")
            return True

        self._thread = threading.Thread(
            target=self._run_loop, daemon=True, name="Artifex-MCP"
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
            logger.error(f"MCP Server 循环异常: {e}")
        finally:
            self._loop.close()
            self._loop = None

    async def _start_server(self) -> None:
        self._actual_port = self._find_available_port()

        for attempt in range(MAX_PORT_PROBE):
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
                    logger.warning(f"端口 {self._actual_port} 被占用，尝试下一个...")
                    self._actual_port += 1
                else:
                    raise
        else:
            logger.error(f"无法绑定端口 {self._port}-{self._actual_port}")
            return

        self._running = True
        logger.info(f"MCP Server 已启动: {self.server_address}")

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
        logger.info("MCP Server 已停止")


# ── 内置工具注册 ────────────────────────────────────────────────────────

def register_builtin_tools(server: MCPServer, adapter=None) -> None:
    """注册内置 MCP 工具（run_python）"""

    # ── run_python: 万能执行器 ──
    def _handle_run_python(arguments: dict) -> dict:
        # get_context 快捷模式 — 直接返回编辑器上下文
        if arguments.get("get_context", False):
            if not adapter:
                return {
                    "content": [{"type": "text", "text": "错误: DCC adapter 未初始化"}],
                    "isError": True,
                }
            try:
                info = {
                    "software": adapter.get_software_name(),
                    "version": adapter.get_software_version(),
                    "python": adapter.get_python_version(),
                    "current_file": adapter.get_current_file() or "untitled",
                    "selected_objects": adapter.get_selected_objects(),
                    "scene_info": adapter.get_scene_info(),
                }
                return {
                    "content": [{"type": "text", "text": json.dumps(info, ensure_ascii=False, indent=2)}],
                    "isError": False,
                }
            except Exception as e:
                return {
                    "content": [{"type": "text", "text": f"错误: {e}"}],
                    "isError": True,
                }

        code = arguments.get("code", "")
        if not code:
            return {
                "content": [{"type": "text", "text": "错误: 未提供代码"}],
                "isError": True,
            }

        if adapter:
            result = adapter.execute_code(code)
            output_parts = []
            if result.get("output"):
                output_parts.append(result["output"])
            if result.get("error"):
                output_parts.append(f"错误: {result['error']}")
            elif result.get("result") is not None:
                output_parts.append(f"返回值: {result['result']}")

            text = "\n".join(output_parts) if output_parts else "执行完成 (无输出)"

            return {
                "content": [{"type": "text", "text": text}],
                "isError": not result.get("success", False),
            }
        else:
            return {
                "content": [{"type": "text", "text": "错误: DCC adapter 未初始化"}],
                "isError": True,
            }

    server.register_tool(
        name="run_python",
        description=(
            "在 Blender 中执行 Python 代码。\n\n"
            "上下文变量（已自动注入，无需 import）:\n"
            "  S = 选中对象列表\n"
            "  W = 当前场景文件路径\n"
            "  L = bpy 模块\n"
            "  C = bpy.context\n"
            "  D = bpy.data\n"
            "  bpy = bpy 模块\n\n"
            "将返回值赋给 result 变量，框架会自动提取并返回。\n"
            "所有写操作都有 Undo 支持（Ctrl+Z 可撤销）。\n\n"
            "快捷上下文: 设 get_context=true（无需 code）可获取编辑器状态。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "要执行的 Python 代码",
                },
                "get_context": {
                    "type": "boolean",
                    "description": "设为 true 时直接返回编辑器上下文（软件/版本/选中对象/场景），无需提供 code",
                    "default": False,
                },
            },
            "required": [],
        },
        handler=_handle_run_python,
        main_thread=True,
    )

    logger.info("已注册 1 个内置工具: run_python")
