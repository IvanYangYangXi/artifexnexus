"""
测试 BlenderAdapter — 主线程调度 + execute_code + 上下文采集

注意：这些测试需要在 Blender Python 环境中运行（bpy 可用）。
在 CI 中通过 mock bpy 模块运行。
直接导入 blender_adapter 模块（绕过 __init__.py 的 bpy import）。
"""

import io
import sys
import threading
import time
from importlib import import_module
from unittest.mock import MagicMock, patch

import pytest


# ── 延迟导入（conftest.py 先注入 sys.path）─────────────────────────────

def _get_blender_adapter_module():
    """延迟导入 blender_adapter 模块"""
    return import_module("blender_addon.blender_adapter")


def _get_blender_adapter_class():
    return _get_blender_adapter_module().BlenderAdapter

# 模拟 bpy 模块（CI 环境无 Blender）
@pytest.fixture
def mock_bpy():
    """创建 mock bpy 模块"""
    bpy = MagicMock()
    bpy.app.version_string = "4.2.0"
    bpy.app.timers = MagicMock()
    bpy.app.timers.is_registered.return_value = False
    bpy.app.timers.register = MagicMock()
    bpy.app.timers.unregister = MagicMock()
    bpy.context = MagicMock()
    bpy.context.selected_objects = []
    bpy.context.scene = MagicMock()
    bpy.context.scene.name = "Scene"
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 250
    bpy.context.scene.render = MagicMock()
    bpy.context.scene.render.fps = 24
    bpy.data = MagicMock()
    bpy.data.filepath = ""
    bpy.data.objects = []
    bpy.ops = MagicMock()
    bpy.ops.ed = MagicMock()
    bpy.ops.ed.undo_push = MagicMock()
    return bpy


@pytest.fixture
def adapter(mock_bpy):
    """创建 BlenderAdapter 实例（注入 mock bpy）"""
    # 注入 mock bpy 到 sys.modules
    with patch.dict(sys.modules, {"bpy": mock_bpy}):
        # 重置全局状态
        ba = _get_blender_adapter_module()
        ba._timer_registered = False
        ba._main_thread_queue = __import__("queue").Queue()

        BlenderAdapter = _get_blender_adapter_class()
        adapter = BlenderAdapter()
        yield adapter


class TestBlenderAdapterBasic:
    """基础信息测试"""

    def test_software_name(self, adapter):
        assert adapter.get_software_name() == "blender"

    def test_software_version(self, adapter, mock_bpy):
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            assert adapter.get_software_version() == "4.2.0"

    def test_python_version(self, adapter):
        version = adapter.get_python_version()
        parts = version.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)


class TestBlenderAdapterContext:
    """上下文采集测试"""

    def test_get_selected_objects_empty(self, adapter, mock_bpy):
        mock_bpy.context.selected_objects = []
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            result = adapter.get_selected_objects()
            assert result == []

    def test_get_selected_objects_with_selection(self, adapter, mock_bpy):
        obj1 = MagicMock()
        obj1.name = "Cube"
        obj1.type = "MESH"
        obj2 = MagicMock()
        obj2.name = "Light"
        obj2.type = "LIGHT"
        mock_bpy.context.selected_objects = [obj1, obj2]
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            result = adapter.get_selected_objects()
            assert len(result) == 2
            assert result[0]["name"] == "Cube"
            assert result[0]["type"] == "MESH"
            assert result[1]["name"] == "Light"

    def test_get_scene_info(self, adapter, mock_bpy):
        mock_bpy.data.objects = [MagicMock(), MagicMock(), MagicMock()]
        mock_bpy.data.objects[0].type = "MESH"
        mock_bpy.data.objects[1].type = "MESH"
        mock_bpy.data.objects[2].type = "LIGHT"
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            result = adapter.get_scene_info()
            assert result["object_count"] == 3
            assert result["mesh_count"] == 2
            assert result["up_axis"] == "Z"
            assert result["fps"] == 24

    def test_get_current_file_untitled(self, adapter, mock_bpy):
        mock_bpy.data.filepath = ""
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            assert adapter.get_current_file() is None

    def test_get_current_file_saved(self, adapter, mock_bpy):
        mock_bpy.data.filepath = "/path/to/scene.blend"
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            assert adapter.get_current_file() == "/path/to/scene.blend"


class TestBlenderAdapterExecuteCode:
    """代码执行测试"""

    def test_execute_simple_code(self, adapter, mock_bpy):
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            result = adapter.execute_code("result = 'hello from blender'")
            assert result["success"] is True
            assert result["result"] == "hello from blender"
            assert result["error"] is None

    def test_execute_with_print(self, adapter, mock_bpy):
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            result = adapter.execute_code("print('test output')")
            assert result["success"] is True
            assert "test output" in result["output"]

    def test_execute_with_error(self, adapter, mock_bpy):
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            result = adapter.execute_code("raise ValueError('test error')")
            assert result["success"] is False
            assert "ValueError" in result["error"]
            assert "test error" in result["error"]

    def test_execute_with_context_variables(self, adapter, mock_bpy):
        """验证预注入变量 S/W/L/C/D/bpy 可用"""
        obj = MagicMock()
        obj.name = "TestCube"
        mock_bpy.context.selected_objects = [obj]
        mock_bpy.data.filepath = "/test.blend"
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            result = adapter.execute_code("""
result = {
    "S_count": len(S),
    "S_name": S[0].name if S else None,
    "W": W,
    "has_bpy": bpy is not None,
    "has_C": C is not None,
    "has_D": D is not None,
    "has_L": L is not None,
}
""")
            assert result["success"] is True
            r = result["result"]
            assert r["S_count"] == 1
            assert r["S_name"] == "TestCube"
            assert r["W"] == "/test.blend"
            assert r["has_bpy"] is True
            assert r["has_C"] is True
            assert r["has_D"] is True
            assert r["has_L"] is True

    def test_persistent_namespace(self, adapter, mock_bpy):
        """验证持久化命名空间：跨调用保持用户变量"""
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            # 第一次调用：定义变量
            adapter.execute_code("my_var = 42")
            # 第二次调用：使用变量
            result = adapter.execute_code("result = my_var * 2")
            assert result["success"] is True
            assert result["result"] == 84

    def test_clear_namespace(self, adapter, mock_bpy):
        """验证清空命名空间"""
        with patch.dict(sys.modules, {"bpy": mock_bpy}):
            adapter.execute_code("my_var = 42")
            adapter.clear_exec_namespace()
            result = adapter.execute_code("result = my_var")
            assert result["success"] is False
            assert "NameError" in result["error"]


class TestMainThreadScheduling:
    """主线程调度测试"""

    def test_execute_on_main_thread_direct(self, adapter):
        """在主线程直接执行（快速路径）"""
        def test_fn(x):
            return x * 2

        result = adapter.execute_on_main_thread(test_fn, 21)
        assert result == 42

    def test_execute_deferred_direct(self, adapter):
        """在主线程直接执行 deferred"""
        results = []

        def test_fn(x):
            results.append(x)

        adapter.execute_deferred(test_fn, "hello")
        assert results == ["hello"]
