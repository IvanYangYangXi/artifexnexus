"""
测试 dcc_installer — Blender 版本检测 + 安装/卸载 + 版本兼容检查
"""

import json
import os
import shutil
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
        with patch.object(dcc_installer, "_DCC_VERSION_SCAN_PATHS", {"blender": "/nonexistent/path"}):
            versions = dcc_installer.find_dcc_versions("blender")
            assert versions == []

    def test_find_versions_mocked(self, dcc_installer):
        """mock 扫描返回版本列表"""
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
            MockDirEntry("config"),
        ]
        with patch("os.scandir", return_value=mock_entries):
            with patch.object(dcc_installer, "_DCC_VERSION_SCAN_PATHS", {"blender": "/fake/base"}):
                with patch("os.path.isdir", return_value=True):
                    versions = dcc_installer.find_dcc_versions("blender")
                    assert versions == ["5.1", "4.2", "3.6"]

    def test_blender_alias(self, dcc_installer):
        """Blender 便捷别名调用通用接口"""
        with patch.object(dcc_installer, "_DCC_VERSION_SCAN_PATHS", {"blender": "/nonexistent/path"}):
            versions = dcc_installer.find_blender_versions()
            assert versions == []


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
        """插件目录名固定为 artifex_nexus（不含版本号，避免 Python import 点号问题）"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        name = dcc_installer._get_addon_dir_name()
        assert name == "artifex_nexus"


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
        """force=True 跳过兼容检查，使用 copy 模式安装"""
        dcc_installer.set_addon_src_dir(str(temp_addon_src / "v5.0.0"))
        with tempfile.TemporaryDirectory() as tmp:
            target_dir = str(Path(tmp) / "target")
            with patch.object(dcc_installer, "get_dcc_addon_target_dir", return_value=target_dir):
                with patch("shutil.copytree") as mock_copy:
                    with patch.object(dcc_installer, "_record_deployment"):
                        result = dcc_installer.install_dcc_addon("blender", "4.2", force=True)
                        assert result["success"] is True
                        assert result["method"] == "copy"
                        mock_copy.assert_called_once()

    def test_uninstall_not_installed(self, dcc_installer):
        """卸载未安装的插件"""
        with patch.object(dcc_installer, "get_dcc_addon_target_dir", return_value="/nonexistent/path"):
            result = dcc_installer.uninstall_dcc_addon("blender", "5.1")
            assert result["success"] is True
            assert "未安装" in result.get("message", "")

    def test_is_addon_installed(self, dcc_installer):
        """检查安装状态"""
        with patch.object(dcc_installer, "get_dcc_addon_target_dir", return_value="/nonexistent"):
            assert dcc_installer.is_dcc_addon_installed("blender", "5.1") is False


class TestJunctionSymlink:
    """Junction/Symlink 工具测试（仅保留清理逻辑的测试，创建逻辑已废弃）"""

    def test_is_junction_or_symlink_nonexistent(self, dcc_installer):
        """不存在的路径"""
        assert dcc_installer._is_junction_or_symlink("/nonexistent/path") is False

    def test_remove_link_or_dir_nonexistent(self, dcc_installer):
        """删除不存在的路径不报错"""
        # 不应抛出异常
        dcc_installer._remove_link_or_dir("/nonexistent/path")


class TestDeployManifest:
    """部署清单（deploy-manifest.json）校验测试"""

    def test_compute_file_sha256(self, dcc_installer, tmp_path):
        """计算文件 SHA-256"""
        f = tmp_path / "test.txt"
        f.write_text("hello world", encoding="utf-8")
        sha = dcc_installer._compute_file_sha256(f)
        # "hello world" 的 SHA-256
        import hashlib
        expected = hashlib.sha256(b"hello world").hexdigest()
        assert sha == expected
        assert len(sha) == 64

    def test_scan_dir_files(self, dcc_installer, tmp_path):
        """扫描目录文件列表"""
        (tmp_path / "a.py").write_text("print('a')", encoding="utf-8")
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "b.json").write_text('{"x":1}', encoding="utf-8")
        files = dcc_installer._scan_dir_files(tmp_path)
        assert len(files) == 2
        paths = {f["path"] for f in files}
        assert paths == {"a.py", "sub/b.json"}
        for f in files:
            assert "sha256" in f
            assert "size" in f
            assert f["size"] > 0

    def test_read_deploy_manifest_empty(self, dcc_installer, tmp_path):
        """空清单文件"""
        manifest_path = tmp_path / "state" / "deploy-manifest.json"
        manifest_path.parent.mkdir(parents=True)
        with patch.object(dcc_installer, "_get_manifest_path", return_value=manifest_path):
            manifest = dcc_installer._read_deploy_manifest()
            assert manifest["version"] == 1
            assert manifest["deployments"] == []

    def test_record_and_validate(self, dcc_installer, tmp_path):
        """记录部署 → 校验通过"""
        # 准备源目录
        src = tmp_path / "src"
        src.mkdir()
        (src / "__init__.py").write_text("bl_info = {'version': (5, 0, 0)}", encoding="utf-8")
        (src / "module.py").write_text("x = 1", encoding="utf-8")

        # 准备目标目录（模拟已安装）
        dst = tmp_path / "dst"
        shutil.copytree(str(src), str(dst))

        # 准备 manifest 路径
        manifest_path = tmp_path / "state" / "deploy-manifest.json"
        manifest_path.parent.mkdir(parents=True)

        with patch.object(dcc_installer, "_get_manifest_path", return_value=manifest_path):
            # 记录部署
            dcc_installer._record_deployment("test-addon", str(src), str(dst), "5.0.0")

            # 校验应全部通过
            results = dcc_installer.validate_all_deployments()
            assert len(results) == 1
            assert results[0]["status"] == "ok"
            assert results[0]["id"] == "test-addon"

    def test_validate_missing(self, dcc_installer, tmp_path):
        """目标目录不存在 → missing"""
        manifest_path = tmp_path / "state" / "deploy-manifest.json"
        manifest_path.parent.mkdir(parents=True)

        manifest = {
            "version": 1,
            "deployments": [{
                "id": "ghost-addon",
                "source": "/fake/src",
                "target": str(tmp_path / "nonexistent"),
                "method": "copy",
                "files": [{"path": "x.py", "sha256": "aa" * 32, "size": 10}],
                "deployedAt": "2026-01-01T00:00:00Z",
                "sourceVersion": "5.0.0",
            }],
        }
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        with patch.object(dcc_installer, "_get_manifest_path", return_value=manifest_path):
            results = dcc_installer.validate_all_deployments()
            assert len(results) == 1
            assert results[0]["status"] == "missing"

    def test_validate_corrupted(self, dcc_installer, tmp_path):
        """文件校验和不匹配 → corrupted"""
        dst = tmp_path / "dst"
        dst.mkdir()
        (dst / "mod.py").write_text("modified content", encoding="utf-8")

        manifest_path = tmp_path / "state" / "deploy-manifest.json"
        import hashlib
        wrong_sha = hashlib.sha256(b"original content").hexdigest()
        manifest = {
            "version": 1,
            "deployments": [{
                "id": "corrupted-addon",
                "source": "/fake/src",
                "target": str(dst),
                "method": "copy",
                "files": [{"path": "mod.py", "sha256": wrong_sha, "size": 16}],
                "deployedAt": "2026-01-01T00:00:00Z",
                "sourceVersion": "5.0.0",
            }],
        }
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        with patch.object(dcc_installer, "_get_manifest_path", return_value=manifest_path):
            results = dcc_installer.validate_all_deployments()
            assert len(results) == 1
            assert results[0]["status"] == "corrupted"

    def test_remove_from_manifest(self, dcc_installer, tmp_path):
        """从 manifest 移除部署项"""
        manifest_path = tmp_path / "state" / "deploy-manifest.json"
        manifest_path.parent.mkdir(parents=True)

        manifest = {
            "version": 1,
            "deployments": [
                {"id": "keep-me", "source": "/s1", "target": "/t1", "method": "copy",
                 "files": [], "deployedAt": "", "sourceVersion": "1.0"},
                {"id": "remove-me", "source": "/s2", "target": "/t2", "method": "copy",
                 "files": [], "deployedAt": "", "sourceVersion": "1.0"},
            ],
        }
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        with patch.object(dcc_installer, "_get_manifest_path", return_value=manifest_path):
            dcc_installer._remove_from_manifest("remove-me")
            updated = dcc_installer._read_deploy_manifest()
            assert len(updated["deployments"]) == 1
            assert updated["deployments"][0]["id"] == "keep-me"

    def test_get_source_version_blender(self, dcc_installer, tmp_path):
        """从 Blender addon 获取版本号"""
        src = tmp_path / "addon"
        src.mkdir()
        (src / "__init__.py").write_text(
            'bl_info = {"version": (5, 0, 1), "name": "Test"}', encoding="utf-8"
        )
        v = dcc_installer._get_source_version(src)
        assert v == "5.0.1"

    def test_get_source_version_package_json(self, dcc_installer, tmp_path):
        """从 package.json 获取版本号（fallback）"""
        src = tmp_path / "plugin"
        src.mkdir()
        (src / "package.json").write_text('{"version": "1.2.3"}', encoding="utf-8")
        v = dcc_installer._get_source_version(src)
        assert v == "1.2.3"

    def test_get_source_version_fallback(self, dcc_installer, tmp_path):
        """无版本文件时返回兜底值"""
        src = tmp_path / "empty"
        src.mkdir()
        v = dcc_installer._get_source_version(src)
        assert v == "0.0.0"
