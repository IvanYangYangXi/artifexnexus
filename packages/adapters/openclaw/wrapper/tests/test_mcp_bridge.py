"""
测试 mcp_bridge — Gateway ↔ Blender MCP 桥接层

注意：这些测试在 CI 环境中运行，不依赖 Blender。
测试 MCPBridgeClient 的连接管理和工具调用转发。
"""

import asyncio
import json
import threading
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── 辅助 ─────────────────────────────────────────────────────────────────

def _make_async_mock_connect(mock_ws):
    """创建可 await 的 mock connect 函数"""
    async def _connect(*args, **kwargs):
        return mock_ws
    return _connect


# ── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def mock_websockets():
    """mock websockets 模块"""
    with patch("artifex_nexus.openclaw_wrapper.mcp_bridge.websockets") as mock_ws:
        mock_ws.ConnectionClosed = type("ConnectionClosed", (Exception,), {})
        yield mock_ws


@pytest.fixture
def bridge_client():
    """创建 MCPBridgeClient 实例（重置单例）"""
    from artifex_nexus.openclaw_wrapper.mcp_bridge import MCPBridgeClient

    # 重置单例
    MCPBridgeClient._instance = None
    client = MCPBridgeClient(host="127.0.0.1", port=18083)
    return client


class TestMCPBridgeClient:
    """MCPBridgeClient 基础测试"""

    def test_singleton(self):
        """单例模式"""
        from artifex_nexus.openclaw_wrapper.mcp_bridge import MCPBridgeClient

        # 重置单例
        MCPBridgeClient._instance = None
        client1 = MCPBridgeClient.get_instance(port=18083)
        client2 = MCPBridgeClient.get_instance()
        assert client1 is client2

    def test_server_address(self, bridge_client):
        """服务器地址格式"""
        assert bridge_client.server_address == "ws://127.0.0.1:18083"

    def test_initial_state(self, bridge_client):
        """初始状态"""
        assert not bridge_client.is_connected

    def test_call_tool_not_connected(self, bridge_client):
        """未连接时调用工具返回错误"""
        result = bridge_client.call_tool("run_python", {"code": "print(1)"})
        assert result["isError"] is True
        assert "无法连接" in result["content"][0]["text"]


class TestMCPBridgeCallTool:
    """工具调用测试（mock WebSocket）"""

    def test_call_tool_success(self, bridge_client, mock_websockets):
        """成功调用工具"""
        # mock WebSocket 连接
        mock_ws = MagicMock()

        # initialize 响应
        mock_ws.recv = AsyncMock(side_effect=[
            json.dumps({
                "jsonrpc": "2.0",
                "id": 0,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {"name": "artifex-nexus-blender", "version": "0.1.0"},
                },
            }),
            # tools/call 响应
            json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "content": [{"type": "text", "text": "hello from blender"}],
                    "isError": False,
                },
            }),
        ])
        mock_ws.send = AsyncMock()

        mock_websockets.connect = _make_async_mock_connect(mock_ws)

        # 连接
        assert bridge_client.connect(timeout=2.0)

        # 调用工具
        result = bridge_client.call_tool("run_python", {"code": "print('hello')"})
        assert result["isError"] is False
        assert "hello from blender" in result["content"][0]["text"]

    def test_call_tool_error_response(self, bridge_client, mock_websockets):
        """工具返回错误"""
        mock_ws = MagicMock()
        mock_ws.recv = AsyncMock(side_effect=[
            json.dumps({
                "jsonrpc": "2.0", "id": 0,
                "result": {"protocolVersion": "2024-11-05", "serverInfo": {"name": "test"}},
            }),
            json.dumps({
                "jsonrpc": "2.0", "id": 1,
                "result": {
                    "content": [{"type": "text", "text": "NameError: name 'x' is not defined"}],
                    "isError": True,
                },
            }),
        ])
        mock_ws.send = AsyncMock()

        mock_websockets.connect = _make_async_mock_connect(mock_ws)

        bridge_client.connect(timeout=2.0)
        result = bridge_client.call_tool("run_python", {"code": "x"})
        assert result["isError"] is True
        assert "NameError" in result["content"][0]["text"]


class TestConvenienceFunctions:
    """便捷函数测试"""

    def test_call_blender_run_python(self, mock_websockets):
        """call_blender_run_python 便捷函数"""
        from artifex_nexus.openclaw_wrapper.mcp_bridge import (
            MCPBridgeClient,
            call_blender_run_python,
        )

        # 重置单例
        MCPBridgeClient._instance = None

        mock_ws = MagicMock()
        mock_ws.recv = AsyncMock(side_effect=[
            json.dumps({
                "jsonrpc": "2.0", "id": 0,
                "result": {"protocolVersion": "2024-11-05", "serverInfo": {"name": "test"}},
            }),
            json.dumps({
                "jsonrpc": "2.0", "id": 1,
                "result": {
                    "content": [{"type": "text", "text": "result: 42"}],
                    "isError": False,
                },
            }),
        ])
        mock_ws.send = AsyncMock()

        mock_websockets.connect = _make_async_mock_connect(mock_ws)

        result = call_blender_run_python("result = 42")
        assert result["isError"] is False
        assert "42" in result["content"][0]["text"]

    def test_call_blender_get_context(self, mock_websockets):
        """call_blender_run_python get_context=True"""
        from artifex_nexus.openclaw_wrapper.mcp_bridge import (
            MCPBridgeClient,
            call_blender_run_python,
        )

        MCPBridgeClient._instance = None

        mock_ws = MagicMock()
        mock_ws.recv = AsyncMock(side_effect=[
            json.dumps({
                "jsonrpc": "2.0", "id": 0,
                "result": {"protocolVersion": "2024-11-05", "serverInfo": {"name": "test"}},
            }),
            json.dumps({
                "jsonrpc": "2.0", "id": 1,
                "result": {
                    "content": [{"type": "text", "text": json.dumps({"software": "blender"})}],
                    "isError": False,
                },
            }),
        ])
        mock_ws.send = AsyncMock()

        mock_websockets.connect = _make_async_mock_connect(mock_ws)

        result = call_blender_run_python("", get_context=True)
        assert result["isError"] is False
