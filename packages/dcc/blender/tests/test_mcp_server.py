"""
测试 MCPServer — WebSocket 服务 + run_python 工具

注意：这些测试在 CI 环境中运行，不依赖 Blender。
直接导入 mcp_server 模块（绕过 blender_addon/__init__.py 的 bpy import）。
"""

import asyncio
import json
import sys
import threading
import time
from importlib import import_module
from unittest.mock import MagicMock, patch

import pytest
import websockets


# ── 延迟导入（conftest.py 先注入 sys.path）─────────────────────────────

def _get_mcp_server_module():
    """延迟导入 mcp_server 模块"""
    return import_module("blender_addon.mcp_server")


def _get_mcpserver_class():
    return _get_mcp_server_module().MCPServer


def _get_register_builtin_tools():
    return _get_mcp_server_module().register_builtin_tools


# ── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def mock_adapter():
    """创建 mock BlenderAdapter"""
    adapter = MagicMock()
    adapter.get_software_name.return_value = "blender"
    adapter.get_software_version.return_value = "4.2.0"
    adapter.get_python_version.return_value = "3.11.0"
    adapter.get_current_file.return_value = "/test.blend"
    adapter.get_selected_objects.return_value = [{"name": "Cube", "type": "MESH"}]
    adapter.get_scene_info.return_value = {
        "scene_file": "/test.blend",
        "object_count": 1,
        "mesh_count": 1,
        "frame_range": [1, 250],
        "fps": 24,
        "up_axis": "Z",
    }
    adapter.execute_code.return_value = {
        "success": True,
        "result": "hello from blender",
        "error": None,
        "output": "hello from blender\n",
    }
    adapter.execute_on_main_thread = lambda fn, *args: fn(*args)
    return adapter


@pytest.fixture
def mcp_server(mock_adapter):
    """创建 MCPServer 实例并注册工具"""
    MCPServer = _get_mcpserver_class()
    register_builtin_tools = _get_register_builtin_tools()

    server = MCPServer(host="127.0.0.1", port=18083)
    server.set_adapter(mock_adapter)
    register_builtin_tools(server, mock_adapter)
    return server


@pytest.fixture
def running_server(mcp_server):
    """启动 MCP Server 并返回地址（同步版本）"""
    started = mcp_server.start()
    assert started, "MCP Server 启动失败"
    time.sleep(0.3)  # 等待事件循环就绪
    yield mcp_server
    mcp_server.stop()
    time.sleep(0.2)


# ── 测试 ─────────────────────────────────────────────────────────────────

class TestMCPServerLifecycle:
    """服务器生命周期测试"""

    def test_start_stop(self, mcp_server):
        """启动和停止"""
        assert not mcp_server.is_running
        started = mcp_server.start()
        assert started
        assert mcp_server.is_running
        assert mcp_server.actual_port is not None

        mcp_server.stop()
        # 等待停止完成
        time.sleep(0.3)
        assert not mcp_server.is_running

    def test_double_start(self, mcp_server):
        """重复启动应返回 True"""
        mcp_server.start()
        assert mcp_server.start() is True
        mcp_server.stop()
        time.sleep(0.3)

    def test_server_address(self, mcp_server):
        """服务器地址格式"""
        mcp_server.start()
        addr = mcp_server.server_address
        assert addr.startswith("ws://127.0.0.1:")
        assert str(mcp_server.actual_port) in addr
        mcp_server.stop()
        time.sleep(0.3)


class TestMCPProtocol:
    """MCP 协议测试（使用 asyncio.run 包装 async 操作）"""

    @staticmethod
    async def _initialize_and_call(addr: str, method: str, params: dict) -> dict:
        """辅助：连接、initialize、发送请求、返回响应"""
        async with websockets.connect(addr) as ws:
            # initialize
            await ws.send(json.dumps({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "clientInfo": {"name": "test"}},
            }))
            init_resp = json.loads(await ws.recv())
            assert init_resp["result"]["serverInfo"]["name"] == "artifex-nexus-blender"

            # 发送目标请求
            await ws.send(json.dumps({
                "jsonrpc": "2.0", "id": 2, "method": method, "params": params,
            }))
            return json.loads(await ws.recv())

    def test_initialize(self, running_server):
        """MCP initialize 握手"""
        async def _run():
            addr = running_server.server_address
            async with websockets.connect(addr) as ws:
                await ws.send(json.dumps({
                    "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "clientInfo": {"name": "test-client", "version": "1.0.0"},
                    },
                }))
                response = json.loads(await ws.recv())
                assert response["jsonrpc"] == "2.0"
                assert response["id"] == 1
                assert response["result"]["protocolVersion"] == "2024-11-05"
                assert response["result"]["serverInfo"]["name"] == "artifex-nexus-blender"
        asyncio.run(_run())

    def test_tools_list(self, running_server):
        """tools/list 返回已注册工具"""
        response = asyncio.run(
            self._initialize_and_call(running_server.server_address, "tools/list", {})
        )
        tools = response["result"]["tools"]
        assert len(tools) >= 1
        tool_names = [t["name"] for t in tools]
        assert "run_python" in tool_names

    def test_tools_call_run_python(self, running_server):
        """tools/call run_python 执行代码"""
        response = asyncio.run(
            self._initialize_and_call(
                running_server.server_address,
                "tools/call",
                {"name": "run_python", "arguments": {"code": "result = 'hello from blender'"}},
            )
        )
        content = response["result"]["content"]
        assert len(content) >= 1
        assert "hello from blender" in content[0]["text"]

    def test_tools_call_get_context(self, running_server):
        """tools/call run_python get_context=true"""
        response = asyncio.run(
            self._initialize_and_call(
                running_server.server_address,
                "tools/call",
                {"name": "run_python", "arguments": {"get_context": True}},
            )
        )
        content = response["result"]["content"][0]["text"]
        info = json.loads(content)
        assert info["software"] == "blender"
        assert info["version"] == "4.2.0"
        assert "selected_objects" in info
        assert "scene_info" in info

    def test_tools_call_unknown_tool(self, running_server):
        """调用未知工具应返回错误"""
        response = asyncio.run(
            self._initialize_and_call(
                running_server.server_address,
                "tools/call",
                {"name": "nonexistent_tool", "arguments": {}},
            )
        )
        assert response["result"]["isError"] is True

    def test_ping(self, running_server):
        """ping 测试"""
        response = asyncio.run(
            self._initialize_and_call(running_server.server_address, "ping", {})
        )
        assert response["result"] == {}

    def test_unknown_method(self, running_server):
        """未知方法应返回错误"""
        async def _run():
            addr = running_server.server_address
            async with websockets.connect(addr) as ws:
                await ws.send(json.dumps({
                    "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {"protocolVersion": "2024-11-05", "clientInfo": {"name": "test"}},
                }))
                await ws.recv()
                await ws.send(json.dumps({
                    "jsonrpc": "2.0", "id": 2, "method": "unknown_method",
                }))
                response = json.loads(await ws.recv())
                assert response["id"] == 2
                assert "error" in response
                assert response["error"]["code"] == -32601
        asyncio.run(_run())


class TestMCPServerEdgeCases:
    """边界情况测试"""

    def test_port_probe(self, mcp_server):
        """端口探测"""
        port = mcp_server._find_available_port()
        assert port >= 18083

    def test_register_unregister_tool(self, mcp_server):
        """工具注册和反注册"""
        def dummy_handler(args):
            return {"content": [{"type": "text", "text": "ok"}]}

        mcp_server.register_tool(
            name="test_tool",
            description="A test tool",
            input_schema={"type": "object", "properties": {}},
            handler=dummy_handler,
        )
        assert "test_tool" in mcp_server._tools

        mcp_server.unregister_tool("test_tool")
        assert "test_tool" not in mcp_server._tools
