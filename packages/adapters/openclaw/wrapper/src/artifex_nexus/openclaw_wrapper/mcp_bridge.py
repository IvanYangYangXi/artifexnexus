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
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)
# 确保 stderr 可见（与 nexus_tool_rpc.py 相同原因）
logger.propagate = False
logger.setLevel(logging.INFO)  # mcp_bridge 使用 INFO 级别，避免每条消息刷屏
if not logger.handlers:
    import sys as _sys
    _h = logging.StreamHandler(_sys.stderr)
    _h.setFormatter(logging.Formatter("[sidecar.mcp] %(message)s"))
    _h.setLevel(logging.INFO)
    logger.addHandler(_h)

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


# ── 错误分类辅助 ────────────────────────────────────────────────────────
# 用于判断是否值得重连重试。"网络层"失败（连接关闭/重置/拒绝）会重试；
# 业务错误（MCP error / 超时）不重试。

_CONNECTION_FAILURE_KINDS = frozenset({
    "connection_closed",  # ConnectionClosed / ConnectionClosedOK / ConnectionClosedError
    "no_ws",              # 连接已被先前调用清掉
    "connection_reset",   # ECONNRESET / WinError 10054
    "connection_refused", # ECONNREFUSED
    "broken_pipe",        # EPIPE
})


def _classify_exception(e: BaseException) -> str:
    """把异常归类成可重试 / 不可重试。

    返回的字符串会被存到 result["_error_kind"]；调用方据此决定是否重试。
    """
    # 优先按类型识别 websockets.exceptions.ConnectionClosed*
    cls_name = type(e).__name__
    if cls_name in ("ConnectionClosed", "ConnectionClosedOK", "ConnectionClosedError"):
        return "connection_closed"
    if isinstance(e, ConnectionResetError):
        return "connection_reset"
    if isinstance(e, ConnectionRefusedError):
        return "connection_refused"
    if isinstance(e, BrokenPipeError):
        return "broken_pipe"
    if isinstance(e, ConnectionError):
        return "connection_closed"
    # 再用消息文本兜底（不同 websockets 版本异常字符串包含 "going away" / "1001"）
    msg = str(e).lower()
    if "going away" in msg or "1001" in msg or "1006" in msg or "connection closed" in msg:
        return "connection_closed"
    return "other"


def _is_connection_failure(result: Dict[str, Any]) -> bool:
    """判断 :meth:`_call_tool_once` 的返回结果是否是值得重连的网络层失败。"""
    if not result.get("isError"):
        return False
    kind = result.get("_error_kind")
    return kind in _CONNECTION_FAILURE_KINDS


# ── MCP 桥接客户端 ──────────────────────────────────────────────────────

class MCPBridgeClient:
    """
    DCC MCP 客户端 — 连接 DCC MCP Server 并转发工具调用。

    多实例模式：每个 (host, port) 组合独立管理连接，
    支持同时连接 Blender(18083)、UE(18080) 等多个 DCC。
    线程安全：使用 threading.Lock 保护连接状态。
    持久化 event loop：connect 和 call_tool 复用同一个 asyncio event loop，
    避免 "Event loop is closed" 错误。
    """

    _instances: Dict[str, MCPBridgeClient] = {}
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
        # 后台消息分发
        self._response_queue: Optional[asyncio.Queue] = None
        self._reader_task: Optional[asyncio.Task] = None
        # trigger_event 回调
        self._trigger_handler: Optional[Callable] = None
        # 连接失败日志抑制：避免 Blender 未启动时刷屏
        self._connect_fail_count = 0
        self._connect_fail_log_threshold = 3
        # DCC 名称（由 get_instance_for_dcc 设置）。错误信息使用，区分
        # 不同 DCC 的连接断开提示。fallback 到 "DCC" 通用名。
        self._dcc_name: str = "DCC"

    @property
    def dcc_label(self) -> str:
        """对外可读的 DCC 名称（用于错误消息）。"""
        return self._dcc_name or "DCC"

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
        """获取指定 (host, port) 的客户端实例（多实例，非全局单例）。

        同一个 (host, port) 组合共享同一个连接，不同 DCC 独立管理。
        """
        key = f"{host}:{port}"
        if key not in cls._instances:
            with cls._lock:
                if key not in cls._instances:
                    cls._instances[key] = cls(host=host, port=port)
        return cls._instances[key]

    @classmethod
    def get_instance_for_dcc(cls, dcc: str) -> MCPBridgeClient:
        """根据 DCC 名称获取对应的客户端实例。

        支持的 DCC: blender(18083), unreal_engine(18080), maya(18081), 3ds_max(18082)
        """
        _DCC_PORT: dict[str, int] = {
            "blender": 18083,
            "unreal_engine": 18080,
            "maya": 18081,
            "3ds_max": 18082,
            "houdini": 18086,
        }
        port = _DCC_PORT.get(dcc, DEFAULT_BLENDER_MCP_PORT)
        inst = cls.get_instance(host="127.0.0.1", port=port)
        # 记录 dcc 名称，用于错误信息中区分不同 DCC（避免"Blender MCP Server"
        # 出现在 UE 工具的报错里）
        inst._dcc_name = dcc
        return inst

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
                # _async_connect 内部已经把 self._ws / self._connected 设上
                # （必须在 reader create_task 之前设，见 _async_connect 注释）。
                # 这里只是同步等待握手完成；返回值仅作冗余确认，不再覆盖状态。
                future.result(timeout=timeout + 2)
                if self._ws is None or not self._connected:
                    # 理论上不会进入；防御 _async_connect 内部异常但未抛
                    logger.warning("connect: _async_connect 返回但状态不一致")
                    return False
                logger.info(f"已连接 Blender MCP Server: {self.server_address}")
                self._connect_fail_count = 0  # 成功后重置计数
                return True
            except Exception as e:
                self._connect_fail_count += 1
                if self._connect_fail_count <= self._connect_fail_log_threshold:
                    logger.warning(f"连接 Blender MCP Server 失败: {e}")
                self._ws = None
                self._connected = False
                return False

    async def _async_connect(self, timeout: float) -> Any:
        """异步连接 + MCP initialize 握手 + 启动后台消息 reader

        ping_interval=None：禁用客户端 WS keep-alive ping。
        原因：DCC MCP Server（如 UE universal_proxy）在 asyncio loop 中
        同步执行 exec(code)，长任务（>40s 的扫描/批处理）期间整个 loop 被
        阻塞，无法响应 ping/pong → 默认 ping_interval=20s + ping_timeout=20s
        会让客户端误判"连接死亡"主动关闭连接，工具被中断报"连接已断开"。
        禁用 ping 后只在工具实际超时（call_tool 自己的 timeout）才报错。
        TCP 层的 keepalive 仍由 OS 提供，不影响真正断网检测。
        """
        ws = await asyncio.wait_for(
            websockets.connect(
                self.server_address,
                ping_interval=None,   # 关闭客户端 ping，避免长任务被误杀
                close_timeout=10,     # 主动 close 等待 10s
                max_size=None,        # 不限制消息体大小（扫描结果可能很大）
            ),
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

        # MCP 协议要求：收到 initialize 响应后，客户端必须发送 initialized 通知
        await ws.send(json.dumps({"jsonrpc": JSONRPC_VERSION, "method": "initialized"}))
        logger.debug("MCP initialized 通知已发送")

        # 启动后台消息 reader（进程级单例，WS 连接存活期间持续运行）
        # ──────────────────────────────────────────────────────────────
        # 重要：必须在 create_task 之前把 self._ws / self._connected 设上！
        # 否则 reader 协程被调度时 while-loop 条件 (self._connected and self._ws)
        # 会立即为 False，reader 启动即退出 → 后续 _async_call_tool 永远在
        # 空队列上 .get()，导致前端"一直转圈"。
        # （历史 bug：上层 connect() 在 run_coroutine_threadsafe.result() 后才
        # 设 self._connected=True，时序上晚于 reader 的首次 while 判断。）
        # ──────────────────────────────────────────────────────────────
        import asyncio as _asyncio
        self._ws = ws
        self._connected = True
        self._response_queue = _asyncio.Queue()
        self._reader_task = _asyncio.create_task(self._message_reader())

        return ws

    def disconnect(self) -> None:
        """断开连接"""
        with self._conn_lock:
            # 取消后台 reader
            if self._reader_task is not None:
                self._reader_task.cancel()
                self._reader_task = None
            if self._response_queue is not None:
                self._response_queue = None

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

    # ── trigger_event 监听 ──

    def on_trigger_event(self, handler: Callable) -> None:
        """注册 trigger_event 回调。

        当从 Blender MCP Server 收到 trigger_event 广播时，
        调用 handler(payload_dict)。
        """
        self._trigger_handler = handler

    async def _message_reader(self) -> None:
        """后台消息读取任务。

        持续从 WebSocket 读取消息并分发：
          - type="trigger_event" → _trigger_handler()
          - jsonrpc="2.0" + id → _response_queue.put()

        当连接断开时，自动清理状态防止后续调用在死连接上操作。
        """
        import asyncio as _asyncio
        try:
            while self._connected and self._ws is not None:
                try:
                    raw = await self._ws.recv()
                except ConnectionClosed:
                    break
                except _asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.warning("_message_reader recv 异常: %s", e)
                    break

                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("_message_reader 无法解析消息: %.100s", raw)
                    continue

                # trigger_event 广播 → 回调
                if isinstance(msg, dict) and msg.get("type") == "trigger_event":
                    logger.debug("[mcp:recv] trigger_event event=%s", msg.get("event"))
                    if self._trigger_handler is not None:
                        try:
                            self._trigger_handler(msg)
                        except Exception as e:
                            logger.error("trigger_event handler 异常: %s", e, exc_info=True)
                    continue

                # JSON-RPC 响应 → 入队
                if isinstance(msg, dict) and msg.get("jsonrpc") == JSONRPC_VERSION:
                    if self._response_queue is not None:
                        logger.debug("[mcp:recv] rpc id=%s method=%s", msg.get("id"), msg.get("method", ""))
                        await self._response_queue.put(msg)
                    continue

                logger.debug("_message_reader 忽略未知消息: %.100s", raw)
        finally:
            # 连接断开：清理状态，防止后续 call_tool 在死连接上操作
            logger.info("_message_reader 退出，清理连接状态")
            self._connected = False
            self._ws = None
            self._reader_task = None
            # 向队列推入 sentinel 唤醒所有等待 _async_call_tool 的协程。
            # 历史 bug：曾用 `if was_connected` 守卫，但 race 下 connect() 还没把
            # _connected 设 True 就被 reader 看到 False，导致 sentinel 漏推 →
            # _async_call_tool 永远 await get() → 前端"一直转圈"。
            if self._response_queue is not None:
                try:
                    self._response_queue.put_nowait(None)
                except Exception:
                    pass

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

        自动重连策略：
          当首次调用因 ``ConnectionClosed``（含 1001 ``Server shutting down``）
          或 ``ConnectionError`` 失败时，自动 ``disconnect → connect → 重试一次``。
          这样在 DCC 端 addon reload / 用户重启 MCP server 等场景下，前端不会
          看到 "received 1001 (going away)" 之类的原始 ws 错误。

          仅对 **网络层未送达** 错误重试，业务错误（MCP error / 超时）不重试，
          避免幂等性问题（即便 ``tools/call`` 在多数情况下幂等，超时往往说明
          Blender 主线程在跑，重试会叠加阻塞）。
        """
        if not self._connected:
            if not self.connect():
                return {
                    "content": [{
                        "type": "text",
                        "text": f"错误: 无法连接 DCC MCP Server ({self.server_address})。请确认 DCC 已启动且 Artifex Nexus 插件已启用。",
                    }],
                    "isError": True,
                }

        # 首次尝试
        result = self._call_tool_once(tool_name, arguments, timeout)
        if not _is_connection_failure(result):
            return result

        # 网络层失败 → 重连一次再试
        logger.warning(
            "[mcp:call] tool=%s 首次失败 (%s)，尝试重连后重试",
            tool_name, result.get("_error_kind"),
        )
        # 显式清理状态再重连，避免复用死 ws
        with self._conn_lock:
            self._connected = False
            self._ws = None
        if not self.connect():
            return {
                "content": [{
                    "type": "text",
                    "text": (
                        f"错误: 与 DCC MCP Server ({self.server_address}) 的连接已断开，且重连失败。"
                        "请确认 DCC 仍在运行、Artifex Nexus 插件已启用、"
                        "且 MCP Server 未被手动停止。"
                        "提示：面板可能仍显示 Running 但端口未实际监听，"
                        "请尝试 Stop Server → Start Server 重新启动。"
                    ),
                }],
                "isError": True,
            }
        result = self._call_tool_once(tool_name, arguments, timeout)
        # 第二次失败：把 _error_kind 元字段去掉再返回（前端不需要）
        result.pop("_error_kind", None)
        return result

    def _call_tool_once(self, tool_name: str, arguments: dict,
                        timeout: float) -> Dict[str, Any]:
        """单次工具调用（不重试）。

        失败时返回 isError=True 的 MCP 结果；内部用 ``_error_kind`` 元字段标记
        失败种类，供 :meth:`call_tool` 决定是否重试。
        """
        with self._conn_lock:
            if self._ws is None:
                return {
                    "content": [{"type": "text", "text": f"错误: DCC MCP 连接已断开 ({self.server_address})"}],
                    "isError": True,
                    "_error_kind": "no_ws",
                }

            try:
                self._ensure_loop()
                future = asyncio.run_coroutine_threadsafe(
                    self._async_call_tool(tool_name, arguments, timeout),
                    self._loop,
                )
                return future.result(timeout=timeout + 5)
            except asyncio.TimeoutError:
                # 超时不重试：很可能 DCC 主线程在跑长任务
                self._connected = False
                self._ws = None
                return {
                    "content": [{
                        "type": "text",
                        "text": (
                            f"调用超时 ({timeout}s) — {self.dcc_label} 主线程长时间无响应。"
                            "可能原因：脚本运行时间较长、DCC 进入模态对话框、"
                            f"或 {self.dcc_label} 假死。可在 DCC 界面查看进度。"
                        ),
                    }],
                    "isError": True,
                    "_error_kind": "timeout",
                }
            except ConnectionError as e:
                # _async_call_tool 主动抛出的"连接已断开"（sentinel 路径）
                self._connected = False
                self._ws = None
                logger.warning("call_tool: connection lost tool=%s dcc=%s: %s",
                               tool_name, self._dcc_name, e)
                return {
                    "content": [{"type": "text", "text": f"连接已断开: {e}"}],
                    "isError": True,
                    "_error_kind": "connection_closed",
                }
            except Exception as e:
                self._connected = False
                self._ws = None
                # websockets.ConnectionClosed* 在不同版本下继承关系不一定一致，
                # 用字符串/类型名兜底识别
                kind = _classify_exception(e)
                logger.warning("call_tool: failed tool=%s dcc=%s kind=%s: %s",
                               tool_name, self._dcc_name, kind, e)
                return {
                    "content": [{"type": "text", "text": f"{self.dcc_label} 调用失败: {str(e)}"}],
                    "isError": True,
                    "_error_kind": kind,
                }

    async def _async_call_tool(self, tool_name: str, arguments: dict,
                               timeout: float) -> Dict[str, Any]:
        """异步调用 MCP 工具（使用后台 reader + Queue 分发，规避 trigger_event 竞态）"""
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

        logger.debug("[mcp:call] → id=%s tool=%s code_len=%d", request_id, tool_name, len(arguments.get("code", "")))
        await self._ws.send(json.dumps(call_msg))

        # 从后台 reader 填充的 response_queue 中匹配对应 id 的响应
        import asyncio as _asyncio
        deadline = _asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - _asyncio.get_event_loop().time()
            if remaining <= 0:
                raise _asyncio.TimeoutError(f"tools/call {tool_name} 超时 ({timeout}s)")
            try:
                msg = await _asyncio.wait_for(
                    self._response_queue.get(), timeout=remaining
                )
            except _asyncio.TimeoutError:
                raise _asyncio.TimeoutError(f"tools/call {tool_name} 超时 ({timeout}s)")

            # sentinel：_message_reader 推送 None 表示连接已断开
            if msg is None:
                logger.warning("[mcp:call] ← id=%s sentinel (连接断开) dcc=%s", request_id, self._dcc_name)
                raise ConnectionError(f"{self.dcc_label} MCP Server 连接已断开")

            logger.debug("[mcp:call] dequeue id=%s expect=%s", msg.get("id"), request_id)
            # 只处理匹配的响应，其他消息已被 _message_reader 分发
            if msg.get("id") == request_id:
                if "error" in msg:
                    raise RuntimeError(
                        f"MCP 错误: {msg['error'].get('message', str(msg['error']))}"
                    )
                logger.debug("[mcp:call] ← id=%s OK", request_id)
                return msg.get("result", {})
            else:
                # 不匹配的响应放回队列（极少情况，如请求超时后的迟到响应）
                logger.debug("[mcp:call] requeue id=%s (expecting %s)", msg.get("id"), request_id)
                self._response_queue.put_nowait(msg)


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
        # 保持连接不断开：bridge 需要持久连接接收 Blender trigger_event 广播。
        # 之前这里会 disconnect() 导致触发通道被切断。
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


def check_unreal_mcp_server_running(
    host: str = "127.0.0.1", port: int = 18080, timeout: float = 1.0
) -> bool:
    """检测 UE MCP Server 进程是否在监听端口（纯 TCP socket connect）。

    与 :func:`check_blender_mcp_server_running` 行为一致，默认使用 UE MCP 端口 18080。

    Args:
        host: MCP Server 主机地址，默认 127.0.0.1。
        port: MCP Server 端口，默认 18080。
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


def check_unreal_mcp_connection(
    host: str = "127.0.0.1", port: int = 18080, timeout: float = 3.0
) -> Dict[str, Any]:
    """检测 UE MCP Server 连通性（WebSocket + MCP initialize 握手）。

    与 :func:`check_blender_mcp_connection` 行为一致，使用 asyncio.run 内部驱动。

    Args:
        host: MCP Server 主机地址，默认 127.0.0.1。
        port: MCP Server 端口，默认 18080。
        timeout: 连接超时秒数，默认 3s。

    Returns:
        {"connected": bool, "address": str, "error": str|None}
    """
    import asyncio as _asyncio

    async def _connect():
        address = f"ws://{host}:{port}"
        try:
            async with _asyncio.timeout(timeout):
                async with websockets.connect(address) as ws:
                    await ws.send(json.dumps({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "clientInfo": {"name": "artifex-nexus-sidecar", "version": "1.0.0"},
                        },
                    }))
                    resp = await _asyncio.wait_for(ws.recv(), timeout=timeout)
                    data = json.loads(resp)
                    if "result" in data:
                        return {"connected": True, "address": address, "error": None}
                    err_msg = data.get("error", {}).get("message", "未知 MCP 错误")
                    return {"connected": False, "address": address, "error": f"MCP 握手失败: {err_msg}"}
        except Exception as e:
            return {"connected": False, "address": address, "error": str(e)}

    try:
        return _asyncio.run(_connect())
    except RuntimeError:
        # 如果已有运行中的 event loop，尝试用 nest_asyncio 或回退
        logger.warning("check_unreal_mcp_connection: 无法在已有 event loop 中运行，返回未连接")
        return {"connected": False, "address": f"ws://{host}:{port}", "error": "异步运行时冲突"}


# ── Maya MCP Server 检测 ─────────────────────────────────────────────────

DEFAULT_MAYA_MCP_PORT = 18081


def check_maya_mcp_server_running(
    host: str = "127.0.0.1", port: int = DEFAULT_MAYA_MCP_PORT, timeout: float = 1.0
) -> bool:
    """检测 Maya MCP Server 进程是否在监听端口（纯 TCP socket connect）。"""
    import socket as _socket
    try:
        sock = _socket.create_connection((host, port), timeout=timeout)
        sock.close()
        return True
    except (OSError, ConnectionRefusedError, TimeoutError):
        return False


def check_maya_mcp_connection(
    host: str = "127.0.0.1", port: int = DEFAULT_MAYA_MCP_PORT, timeout: float = 3.0
) -> Dict[str, Any]:
    """检测 Maya MCP Server 连通性（WebSocket + MCP initialize 握手）。"""
    import asyncio as _asyncio
    address = f"ws://{host}:{port}"

    async def _connect():
        try:
            async with _asyncio.timeout(timeout):
                async with websockets.connect(address) as ws:
                    await ws.send(json.dumps({
                        "jsonrpc": "2.0", "id": 1, "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "clientInfo": {"name": "artifex-nexus-sidecar", "version": "1.0.0"},
                        },
                    }))
                    resp = await _asyncio.wait_for(ws.recv(), timeout=timeout)
                    data = json.loads(resp)
                    if "result" in data:
                        return {"connected": True, "address": address, "error": None}
                    err_msg = data.get("error", {}).get("message", "未知 MCP 错误")
                    return {"connected": False, "address": address, "error": f"MCP 握手失败: {err_msg}"}
        except Exception as e:
            return {"connected": False, "address": address, "error": str(e)}

    try:
        return _asyncio.run(_connect())
    except RuntimeError:
        logger.warning("check_maya_mcp_connection: 无法在已有 event loop 中运行，返回未连接")
        return {"connected": False, "address": address, "error": "异步运行时冲突"}


# ── 3ds Max MCP Server 检测 ──────────────────────────────────────────────

DEFAULT_MAX_MCP_PORT = 18082


def check_max_mcp_server_running(
    host: str = "127.0.0.1", port: int = DEFAULT_MAX_MCP_PORT, timeout: float = 1.0
) -> bool:
    """检测 3ds Max MCP Server 进程是否在监听端口（纯 TCP socket connect）。"""
    import socket as _socket
    try:
        sock = _socket.create_connection((host, port), timeout=timeout)
        sock.close()
        return True
    except (OSError, ConnectionRefusedError, TimeoutError):
        return False


def check_max_mcp_connection(
    host: str = "127.0.0.1", port: int = DEFAULT_MAX_MCP_PORT, timeout: float = 3.0
) -> Dict[str, Any]:
    """检测 3ds Max MCP Server 连通性（WebSocket + MCP initialize 握手）。"""
    import asyncio as _asyncio
    address = f"ws://{host}:{port}"

    async def _connect():
        try:
            async with _asyncio.timeout(timeout):
                async with websockets.connect(address) as ws:
                    await ws.send(json.dumps({
                        "jsonrpc": "2.0", "id": 1, "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "clientInfo": {"name": "artifex-nexus-sidecar", "version": "1.0.0"},
                        },
                    }))
                    resp = await _asyncio.wait_for(ws.recv(), timeout=timeout)
                    data = json.loads(resp)
                    if "result" in data:
                        return {"connected": True, "address": address, "error": None}
                    err_msg = data.get("error", {}).get("message", "未知 MCP 错误")
                    return {"connected": False, "address": address, "error": f"MCP 握手失败: {err_msg}"}
        except Exception as e:
            return {"connected": False, "address": address, "error": str(e)}

    try:
        return _asyncio.run(_connect())
    except RuntimeError:
        logger.warning("check_max_mcp_connection: 无法在已有 event loop 中运行，返回未连接")
        return {"connected": False, "address": address, "error": "异步运行时冲突"}
