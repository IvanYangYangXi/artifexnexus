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


def test_port_busy_error_carries_occupants():
    """STORY-0039：PortBusyError 携带结构化 occupants 列表供前端渲染。"""
    err = runtime.PortBusyError(
        19789,
        occupants=[{"pid": 12345, "name": "python.exe", "cmdline": "python foo.py"}],
    )
    assert err.port == 19789
    assert err.occupants[0]["pid"] == 12345
    msg = str(err)
    assert "19789" in msg
    assert "12345" in msg
    assert "python.exe" in msg


def test_start_gateway_raises_port_busy_when_external_occupant(tmp_path, monkeypatch):
    """STORY-0039：端口被非 OpenClaw 进程占用 → 抛 PortBusyError，不自动迁移。

    模拟 ``_list_pids_on_port`` 返回一个 PID 且 ``_is_openclaw_process`` 判断为
    外部进程，runtime.start_gateway 必须 raise ``PortBusyError`` 而不是 fallback。
    """
    home = tmp_path / ".openclaw"
    home.mkdir()
    (home / "cli").mkdir()

    # find_openclaw_bin 返回一个假路径即可（不会真 spawn，测试在 cleanup 前就抛）
    fake_bin = tmp_path / "fake-openclaw"
    fake_bin.write_text("#!/bin/sh\necho fake\n")

    monkeypatch.setattr(runtime, "_find_openclaw_bin", lambda _h: fake_bin)
    monkeypatch.setattr(runtime, "_read_pid", lambda _h: None)
    monkeypatch.setattr(runtime, "_ensure_control_ui_allowed_origins", lambda *a, **kw: None)
    monkeypatch.setattr(runtime, "_cleanup_orphan_gateways", lambda _p: 0)
    # 关键：端口仍被占用，且占用者不是 openclaw
    monkeypatch.setattr(runtime, "_list_pids_on_port", lambda _p: [99999])
    monkeypatch.setattr(runtime, "_is_openclaw_process", lambda _pid: False)
    monkeypatch.setattr(
        runtime,
        "_describe_pid",
        lambda pid: {"pid": pid, "name": "someapp.exe", "cmdline": "someapp --port 19789"},
    )

    with pytest.raises(runtime.PortBusyError) as exc_info:
        runtime.start_gateway(home, 19789)

    err = exc_info.value
    assert err.port == 19789
    assert err.occupants[0]["pid"] == 99999
    assert err.occupants[0]["name"] == "someapp.exe"


# ---------------------------------------------------------------------------
# STORY-0039：controlUi.allowedOrigins 漂移清理
# ---------------------------------------------------------------------------


def _patch_config_io(monkeypatch, current_controlui, captured_patches):
    """安装 config_io._run_config_get / _run_config_patch 的 mock。"""
    import artifex_nexus.openclaw_wrapper.config_io as cfg_mod

    def fake_get(_bin, _home, path):
        assert path == "gateway.controlUi"
        return current_controlui

    def fake_patch(_bin, _home, patch, **_kw):
        captured_patches.append(patch)
        return True, None

    monkeypatch.setattr(cfg_mod, "_run_config_get", fake_get)
    monkeypatch.setattr(cfg_mod, "_run_config_patch", fake_patch)


def test_ensure_control_ui_drops_stale_drift_loopback(tmp_path, monkeypatch):
    """漂移过的 http://127.0.0.1:19809 等旧条目必须被清掉。

    STORY-0039：历史 bootstrap_with_port_probe 把 19809 loopback 写进
    allowedOrigins；固定 19789 后这些条目就是死代码。
    """
    current = {
        "enabled": True,
        "allowedOrigins": [
            "http://127.0.0.1:19809",  # 应删
            "http://localhost:19809",  # 应删
            "http://127.0.0.1:19829",  # 应删（drift 段内）
            "tauri://localhost",
            "https://tauri.localhost",
            "http://127.0.0.1:19789",
            "http://localhost:19789",
            "http://tauri.localhost",
        ],
        "dangerouslyDisableDeviceAuth": True,
    }
    captured: list[dict] = []
    _patch_config_io(monkeypatch, current, captured)

    runtime._ensure_control_ui_allowed_origins(
        tmp_path / "fake-openclaw", tmp_path, 19789
    )

    assert len(captured) == 1, "必须触发一次 patch 写入"
    merged = captured[0]["gateway"]["controlUi"]["allowedOrigins"]
    assert "http://127.0.0.1:19809" not in merged
    assert "http://localhost:19809" not in merged
    assert "http://127.0.0.1:19829" not in merged
    # 必需项保留
    assert "http://127.0.0.1:19789" in merged
    assert "tauri://localhost" in merged


def test_ensure_control_ui_preserves_user_added_origins(tmp_path, monkeypatch):
    """用户在面板里加的非漂移段 origin 不能被"清理"逻辑误伤。"""
    current = {
        "enabled": True,
        "allowedOrigins": [
            "http://127.0.0.1:19809",  # 漂移段，应删
            "http://my-devbox:8080",   # 用户自加，必须保留
            "https://internal.company.com",  # 用户自加，必须保留
            "http://127.0.0.1:19789",
        ],
        "dangerouslyDisableDeviceAuth": True,
    }
    captured: list[dict] = []
    _patch_config_io(monkeypatch, current, captured)

    runtime._ensure_control_ui_allowed_origins(
        tmp_path / "fake-openclaw", tmp_path, 19789
    )

    assert len(captured) == 1
    merged = captured[0]["gateway"]["controlUi"]["allowedOrigins"]
    assert "http://127.0.0.1:19809" not in merged
    assert "http://my-devbox:8080" in merged, "用户自加项不能被清"
    assert "https://internal.company.com" in merged, "用户自加项不能被清"


def test_ensure_control_ui_noop_when_already_clean(tmp_path, monkeypatch):
    """已经干净的 config 不应触发多余 patch（幂等）。"""
    current = {
        "enabled": True,
        "allowedOrigins": [
            "http://127.0.0.1:19789",
            "http://localhost:19789",
            "tauri://localhost",
            "https://tauri.localhost",
        ],
        "dangerouslyDisableDeviceAuth": True,
    }
    captured: list[dict] = []
    _patch_config_io(monkeypatch, current, captured)

    runtime._ensure_control_ui_allowed_origins(
        tmp_path / "fake-openclaw", tmp_path, 19789
    )

    assert captured == [], "无漂移 + 无缺失项时不应写 patch"
