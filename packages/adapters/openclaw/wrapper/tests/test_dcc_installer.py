"""
测试 dcc_installer — Blender 版本检测 + 安装/卸载 + 版本兼容检查
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture
def dcc_installer():
    """导入 dcc_installer 模块"""
    from artifex_nexus.openclaw_wrapper import dcc_installer
    return dcc_installer


@pytest.fixture
def temp_addon_src():
    """创建临时插件源目录（模拟版本化目录结构）"""
    with tempfile.TemporaryDirectory() as tmp:
        src_dir = Path(tmp) / "v5.0.0" / "blender_addon"
        src_dir.mkdir(parents=True)
        # 写入 bl_info
        init_file = src_dir / "__init__.py"
        init_file.write_text('''
bl_info = {
    "name": "Artifex Nexus Bridge",
    "author": "Artifex Nexus",
    "version": (5, 0, 0),
    "blender": (5, 0, 0),
    "blender_max": (5, 1, 9),
    "location": "View3D > Sidebar > Artifex Nexus",
    "description": "Artifex Nexus MCP Bridge",
    "category": "Interface",
}
''', encoding="utf-8")
        yield Path(tmp)


class TestFindBlenderVersions:
    """版本检测测试"""

    def test_no_blender_installed(self, dcc_installer):
        """无 Blender 安装时返回空列表"""
        with patch.object(dcc_installer, "_BLENDER_ADDONS_BASE", "/nonexistent/path"):
            versions = dcc_installer.find_blender_versions()
            assert versions == []

    def test_find_versions_mocked(self, dcc_installer):
        """mock 扫描返回版本列表"""
        # 使用真实字符串而非 MagicMock，因为 sorted() 需要比较
        class MockDirEntry:
            def __init__(self, name, is_dir_val=True):
                self.name = name
                self._is_dir = is_dir_val
            def is_dir(self):
                return self._is_dir

        mock_entries = [
            MockDirEntry("4.2"),
            MockDirEntry("5.1"),
            MockDirEntry("3.6"),
            MockDirEntry("config"),  # 非数字开头，应跳过
        ]
        with patch("os.scandir", return_value=mock_entries):
            with patch.object(dcc_installer, "_BLENDER_ADDONS_BASE", "/fake/base"):
                with patch("os.path.isdir", return_value=True):
                    versions = dcc_installer.find_blender_versions()
                    assert versions == ["5.1", "4.2", "3.6"]


class TestVersionCompatibility:
    """版本兼容检查测试"""

    def test_compatible_in_range(self, dcc_installer, temp_addon_src):
        """版本在兼容范围内"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        compatible, reason = dcc_installer.check_version_compatibility("5.1")
        assert compatible is True
        assert "5.0.0" in reason

    def test_compatible_min_boundary(self, dcc_installer, temp_addon_src):
        """版本等于最低要求"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        compatible, reason = dcc_installer.check_version_compatibility("5.0.0")
        assert compatible is True

    def test_compatible_max_boundary(self, dcc_installer, temp_addon_src):
        """版本等于最高支持"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        compatible, reason = dcc_installer.check_version_compatibility("5.1.9")
        assert compatible is True

    def test_incompatible_too_low(self, dcc_installer, temp_addon_src):
        """版本低于最低要求"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        compatible, reason = dcc_installer.check_version_compatibility("4.2")
        assert compatible is False
        assert "低于" in reason

    def test_incompatible_too_high(self, dcc_installer, temp_addon_src):
        """版本高于最高支持"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        compatible, reason = dcc_installer.check_version_compatibility("5.2.0")
        assert compatible is False
        assert "高于" in reason

    def test_invalid_version_string(self, dcc_installer, temp_addon_src):
        """无效版本号"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        compatible, reason = dcc_installer.check_version_compatibility("abc")
        assert compatible is False


class TestGetAddonInfo:
    """插件信息读取测试"""

    def test_get_addon_info(self, dcc_installer, temp_addon_src):
        """读取 bl_info"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        info = dcc_installer.get_addon_info()
        assert info["name"] == "Artifex Nexus Bridge"
        assert info["version"] == (5, 0, 0)
        assert info["blender_min"] == (5, 0, 0)
        assert info["blender_max"] == (5, 1, 9)

    def test_get_addon_dir_name(self, dcc_installer, temp_addon_src):
        """插件目录名含版本号"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        name = dcc_installer._get_addon_dir_name()
        assert name == "artifex_nexus_v5.0.0"


class TestInstallUninstall:
    """安装/卸载测试"""

    def test_install_no_source(self, dcc_installer):
        """源目录不存在时返回错误"""
        dcc_installer.set_addon_src_dir("/nonexistent/path")
        result = dcc_installer.install_blender_addon("5.1")
        assert result["success"] is False
        assert "不存在" in result["error"]

    def test_install_incompatible_version(self, dcc_installer, temp_addon_src):
        """不兼容版本返回错误"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        result = dcc_installer.install_blender_addon("4.2")
        assert result["success"] is False
        assert "低于" in result["error"]

    def test_install_force_incompatible(self, dcc_installer, temp_addon_src):
        """force=True 跳过兼容检查"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        with tempfile.TemporaryDirectory() as tmp:
            # mock addons 目录
            addons_dir = Path(tmp) / "scripts" / "addons"
            addons_dir.mkdir(parents=True)

            with patch.object(dcc_installer, "_get_blender_addons_dir", return_value=str(addons_dir)):
                with patch.object(dcc_installer, "_link_or_copy_dir", return_value="copy"):
                    result = dcc_installer.install_blender_addon("4.2", force=True)
                    assert result["success"] is True
                    assert result["method"] == "copy"

    def test_uninstall_not_installed(self, dcc_installer):
        """卸载未安装的插件"""
        with patch.object(dcc_installer, "_get_addon_target_dir", return_value="/nonexistent/path"):
            result = dcc_installer.uninstall_blender_addon("5.1")
            assert result["success"] is True
            assert "未安装" in result.get("message", "")

    def test_is_addon_installed(self, dcc_installer):
        """检查安装状态"""
        with patch.object(dcc_installer, "_get_addon_target_dir", return_value="/nonexistent"):
            assert dcc_installer.is_addon_installed("5.1") is False


class TestJunctionSymlink:
    """Junction/Symlink 工具测试"""

    def test_is_junction_or_symlink_nonexistent(self, dcc_installer):
        """不存在的路径"""
        assert dcc_installer._is_junction_or_symlink("/nonexistent/path") is False

    def test_remove_link_or_dir_nonexistent(self, dcc_installer):
        """删除不存在的路径不报错"""
        # 不应抛出异常
        dcc_installer._remove_link_or_dir("/nonexistent/path")

    def test_link_or_copy_dir_fallback(self, dcc_installer):
        """junction/symlink 失败时 fallback 到复制"""
        with tempfile.TemporaryDirectory() as src_tmp:
            src = Path(src_tmp) / "src"
            src.mkdir()
            (src / "test.txt").write_text("hello")

            with tempfile.TemporaryDirectory() as dst_tmp:
                dst = str(Path(dst_tmp) / "dst")
                # 强制 junction/symlink 失败
                with patch.object(dcc_installer, "_try_junction", return_value=False):
                    with patch.object(dcc_installer, "_try_symlink_dir", return_value=False):
                        method = dcc_installer._link_or_copy_dir(str(src), dst)
                        assert method == "copy"
                        assert os.path.isdir(dst)
