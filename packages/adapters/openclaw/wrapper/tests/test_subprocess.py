"""``_subprocess`` helper 单测（ADR 0007）。

覆盖：
- 平台敏感的可执行文件查找顺序（Win 优先 .cmd / POSIX 优先无后缀）
- ``cli/current`` symlink / ``cli/current.txt`` / fallback 三种解析路径
- 三件套 env 注入
- ``popen_kwargs`` 在不同平台返回正确的 creationflags
- ``run_openclaw`` 在 bin 不存在时抛 ``FileNotFoundError``
"""

from __future__ import annotations

import platform
from pathlib import Path

import pytest

from artifex_nexus.openclaw_wrapper import _subprocess as _sp


# ---------------------------------------------------------------------------
# is_windows / 平台 patch 工具
# ---------------------------------------------------------------------------


def test_is_windows_returns_bool():
    """is_windows 始终返回 bool 且与 platform.system() 一致。"""
    assert isinstance(_sp.is_windows(), bool)
    assert _sp.is_windows() == (platform.system() == "Windows")


# ---------------------------------------------------------------------------
# find_openclaw_bin — 平台敏感的候选顺序
# ---------------------------------------------------------------------------


def _make_cli_layout(tmp_path: Path, version: str, files: list[str]) -> Path:
    """在 tmp_path 下造一个 cli/<version>/<files...> 目录布局，返回 OPENCLAW_HOME。"""
    home = tmp_path / ".openclaw"
    vdir = home / "cli" / version
    vdir.mkdir(parents=True, exist_ok=True)
    for rel in files:
        p = vdir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("# fake wrapper", encoding="utf-8")
    return home


def test_find_openclaw_bin_windows_prefers_cmd(tmp_path, monkeypatch):
    """Win 上同时存在 openclaw + openclaw.cmd 时，必须选 .cmd。

    复现 [WinError 193] 的根因：旧实现选了无后缀 sh 脚本。
    """
    monkeypatch.setattr(_sp, "is_windows", lambda: True)
    home = _make_cli_layout(tmp_path, "v2026.5.4", ["openclaw", "openclaw.cmd"])
    bin_path = _sp.find_openclaw_bin(home)
    assert bin_path is not None
    assert bin_path.name == "openclaw.cmd"


def test_find_openclaw_bin_posix_prefers_unsuffixed(tmp_path, monkeypatch):
    """非 Win 上优先选 ``bin/openclaw``（npm unix wrapper 默认位置）。"""
    monkeypatch.setattr(_sp, "is_windows", lambda: False)
    home = _make_cli_layout(
        tmp_path,
        "v2026.5.4",
        ["bin/openclaw", "openclaw", "openclaw.cmd"],
    )
    bin_path = _sp.find_openclaw_bin(home)
    assert bin_path is not None
    # 优先级：bin/openclaw > openclaw > bin/openclaw.cmd > openclaw.cmd
    assert bin_path.name == "openclaw"
    assert bin_path.parent.name == "bin"


def test_find_openclaw_bin_windows_fallback_to_root(tmp_path, monkeypatch):
    """Win 上 bin/ 为空（npm 实际行为）时落回根目录的 openclaw.cmd。"""
    monkeypatch.setattr(_sp, "is_windows", lambda: True)
    home = tmp_path / ".openclaw"
    vdir = home / "cli" / "v2026.5.4"
    (vdir / "bin").mkdir(parents=True, exist_ok=True)  # 空 bin/
    (vdir / "openclaw.cmd").write_text("@echo fake")
    (vdir / "openclaw").write_text("#!/bin/sh\necho posix")  # 同时存在 sh
    bin_path = _sp.find_openclaw_bin(home)
    assert bin_path is not None
    assert bin_path.name == "openclaw.cmd"


def test_find_openclaw_bin_uses_current_txt_pointer(tmp_path, monkeypatch):
    """Windows 没 symlink 权限时，cli/current.txt 指针文件指定版本。"""
    monkeypatch.setattr(_sp, "is_windows", lambda: True)
    home = _make_cli_layout(tmp_path, "v2026.5.4", ["openclaw.cmd"])
    _make_cli_layout(tmp_path, "v2025.1.0", ["openclaw.cmd"])  # 旧版本也在
    (home / "cli" / "current.txt").write_text("v2025.1.0", encoding="utf-8")
    bin_path = _sp.find_openclaw_bin(home)
    assert bin_path is not None
    # 指针指向 v2025.1.0，应优先返回该版本的 wrapper（即便有更新版本目录）
    assert "v2025.1.0" in str(bin_path)


def test_find_openclaw_bin_returns_none_when_missing(tmp_path):
    """cli/ 不存在时返回 None（caller 据此报"未安装"）。"""
    home = tmp_path / ".openclaw"
    home.mkdir(parents=True, exist_ok=True)
    assert _sp.find_openclaw_bin(home) is None


def test_find_openclaw_bin_falls_back_to_latest_version(tmp_path, monkeypatch):
    """无 current symlink/pointer 时，按版本目录名倒序取首个可用。"""
    monkeypatch.setattr(_sp, "is_windows", lambda: True)
    home = _make_cli_layout(tmp_path, "v2024.12.0", ["openclaw.cmd"])
    _make_cli_layout(tmp_path, "v2026.5.4", ["openclaw.cmd"])
    bin_path = _sp.find_openclaw_bin(home)
    assert bin_path is not None
    # 字典序倒序：v2026.5.4 > v2024.12.0
    assert "v2026.5.4" in str(bin_path)


# ---------------------------------------------------------------------------
# build_openclaw_env — 三件套
# ---------------------------------------------------------------------------


def test_build_openclaw_env_includes_triplet(tmp_path):
    """env 必须含 OPENCLAW_HOME / STATE_DIR / CONFIG_PATH / NO_ONBOARD=1 四件套。"""
    home = tmp_path / ".openclaw"
    env = _sp.build_openclaw_env(home)
    assert env["OPENCLAW_HOME"] == str(home.resolve())
    assert env["OPENCLAW_STATE_DIR"] == str((home / "state").resolve())
    assert env["OPENCLAW_CONFIG_PATH"] == str((home / "openclaw.json").resolve())
    assert env["OPENCLAW_NO_ONBOARD"] == "1"


def test_build_openclaw_env_inherits_path(tmp_path):
    """env 应继承 PATH 等系统变量（基于 os.environ.copy()）。"""
    env = _sp.build_openclaw_env(tmp_path / ".openclaw")
    # PATH 在所有主流平台都存在
    assert "PATH" in env or "Path" in env  # Win 可能是 "Path"


# ---------------------------------------------------------------------------
# popen_kwargs — 平台分支
# ---------------------------------------------------------------------------


def test_popen_kwargs_always_utf8():
    """text/encoding/errors 三个解码字段无论平台都设。"""
    kwargs = _sp.popen_kwargs()
    assert kwargs["text"] is True
    assert kwargs["encoding"] == "utf-8"
    assert kwargs["errors"] == "replace"


def test_popen_kwargs_win_no_window(monkeypatch):
    """Win 上 win_no_window=True 必带 CREATE_NO_WINDOW (0x08000000)。"""
    monkeypatch.setattr(_sp, "is_windows", lambda: True)
    kwargs = _sp.popen_kwargs(win_no_window=True)
    assert kwargs.get("creationflags", 0) & 0x08000000


def test_popen_kwargs_win_can_disable_no_window(monkeypatch):
    """Win 上 win_no_window=False 时不应带 CREATE_NO_WINDOW。"""
    monkeypatch.setattr(_sp, "is_windows", lambda: True)
    kwargs = _sp.popen_kwargs(win_no_window=False, win_new_process_group=False)
    assert "creationflags" not in kwargs or not (
        kwargs["creationflags"] & 0x08000000
    )


def test_popen_kwargs_win_new_process_group(monkeypatch):
    """Win 上启用 CREATE_NEW_PROCESS_GROUP 用于 taskkill /T。"""
    monkeypatch.setattr(_sp, "is_windows", lambda: True)
    kwargs = _sp.popen_kwargs(win_new_process_group=True)
    assert kwargs.get("creationflags", 0) & 0x00000200


def test_popen_kwargs_posix_no_creationflags(monkeypatch):
    """非 Win 上不应有 creationflags 字段（subprocess 在 POSIX 上不接受）。"""
    monkeypatch.setattr(_sp, "is_windows", lambda: False)
    kwargs = _sp.popen_kwargs(win_no_window=True, win_new_process_group=True)
    assert "creationflags" not in kwargs


# ---------------------------------------------------------------------------
# run_openclaw — 错误路径
# ---------------------------------------------------------------------------


def test_run_openclaw_raises_when_bin_missing(tmp_path):
    """openclaw 不存在时必须抛 FileNotFoundError，让 caller 降级处理。"""
    home = tmp_path / ".openclaw"
    home.mkdir(parents=True, exist_ok=True)
    with pytest.raises(FileNotFoundError):
        _sp.run_openclaw(["--version"], home, timeout=1.0)
