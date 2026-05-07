"""runtime 模块测试。"""

import os
import platform
from pathlib import Path

import pytest
from artifex_nexus.openclaw_wrapper import runtime


def test_is_windows():
    """平台检测测试。"""
    is_win = runtime._is_windows()
    assert isinstance(is_win, bool)
    assert is_win == (platform.system() == "Windows")


def test_pid_file_path():
    """PID 文件路径测试。"""
    home = Path("/tmp/test/.openclaw")
    pf = runtime._pid_file(home)
    assert pf.name == "gateway.pid"
    assert "run" in str(pf)


def test_read_write_clear_pid(tmp_path):
    """PID 文件读写清除测试。"""
    home = tmp_path / ".openclaw"
    run_dir = home.parent / "run"
    run_dir.mkdir(parents=True, exist_ok=True)

    # 写入
    runtime._write_pid(home, 12345)
    assert runtime._read_pid(home) == 12345

    # 清除
    runtime._clear_pid(home)
    assert runtime._read_pid(home) is None


def test_read_pid_nonexistent(tmp_path):
    """不存在的 PID 文件返回 None。"""
    home = tmp_path / ".nonexistent"
    assert runtime._read_pid(home) is None


def test_is_pid_alive_current():
    """当前进程 PID 应该存活。"""
    assert runtime._is_pid_alive(os.getpid()) is True


def test_is_pid_alive_dead():
    """不存在的 PID 应该不存活。"""
    # 使用一个极大的 PID，几乎不可能存在
    assert runtime._is_pid_alive(99999999) is False


def test_find_openclaw_bin_nonexistent(tmp_path):
    """不存在的目录返回 None。"""
    home = tmp_path / ".nonexistent"
    assert runtime._find_openclaw_bin(home) is None


def test_resolve_current_version_none(tmp_path):
    """无 current 时返回 None。"""
    home = tmp_path / ".openclaw"
    assert runtime._resolve_current_version(home) is None


def test_list_versions_empty(tmp_path):
    """无版本时返回空列表。"""
    home = tmp_path / ".openclaw"
    assert runtime.list_versions(home) == []


def test_list_versions_with_dirs(tmp_path):
    """有版本目录时正确列出。"""
    home = tmp_path / ".openclaw"
    cli_dir = home / "cli"
    v1 = cli_dir / "v2026.5.4"
    v2 = cli_dir / "v2026.5.0"
    v1.mkdir(parents=True)
    v2.mkdir(parents=True)
    # 创建假的 openclaw 可执行文件
    (v1 / "bin").mkdir(parents=True)
    (v1 / "bin" / "openclaw").write_text("")
    (v2 / "bin").mkdir(parents=True)
    (v2 / "bin" / "openclaw").write_text("")

    versions = runtime.list_versions(home)
    assert len(versions) == 2
    assert versions[0].version == "v2026.5.4"
    assert versions[1].version == "v2026.5.0"


def test_set_current_version_unix(tmp_path):
    """设置 current symlink（Unix）。"""
    if platform.system() == "Windows":
        pytest.skip("symlink 测试在 Windows 上行为不同")

    home = tmp_path / ".openclaw"
    cli_dir = home / "cli"
    vdir = cli_dir / "v2026.5.4"
    vdir.mkdir(parents=True)

    runtime.set_current_version(home, "v2026.5.4")

    current = cli_dir / "current"
    assert current.is_symlink()
    assert runtime._resolve_current_version(home) == "v2026.5.4"


def test_set_current_version_windows_fallback(tmp_path):
    """Windows current 设置测试（symlink 或 current.txt fallback）。"""
    if platform.system() != "Windows":
        pytest.skip("此测试仅 Windows")

    home = tmp_path / ".openclaw"
    cli_dir = home / "cli"
    vdir = cli_dir / "v2026.5.4"
    vdir.mkdir(parents=True)

    runtime.set_current_version(home, "v2026.5.4")

    # 检查 symlink 或 current.txt
    current_link = cli_dir / "current"
    current_txt = cli_dir / "current.txt"
    assert current_link.exists() or current_txt.exists(), (
        "current symlink 或 current.txt 应存在"
    )
    # 验证版本解析
    resolved = runtime._resolve_current_version(home)
    assert resolved == "v2026.5.4"


def test_get_status(tmp_path):
    """get_status 聚合测试。"""
    home = tmp_path / ".openclaw"
    status = runtime.get_status(home, 19789)

    assert status.cli_installed is False
    assert status.bootstrap_done is False
    assert status.gateway_running is False
    assert status.port == 19789
