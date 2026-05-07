"""Web UI URL 探测模块测试。

EPIC-0001 第二批 STORY-0016：``openclaw.web.get_url`` RPC 单测。
覆盖 4 个核心场景：
1. dashboard 命令成功 + URL 解析
2. CLI 未安装
3. dashboard 退出码非零
4. dashboard 超时
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from artifex_nexus.openclaw_wrapper import web_ui


# ---------------------------------------------------------------------------
# _extract_url 单元测试
# ---------------------------------------------------------------------------


class TestExtractUrl:
    """URL 正则解析。"""

    def test_extract_127_with_token(self):
        text = "Open the OpenClaw dashboard: http://127.0.0.1:19789/?token=abc123"
        assert web_ui._extract_url(text) == "http://127.0.0.1:19789/?token=abc123"

    def test_extract_localhost(self):
        text = "Listening on http://localhost:19789/"
        assert web_ui._extract_url(text) == "http://localhost:19789/"

    def test_reject_external_url(self):
        # 安全：拒绝非 127.0.0.1 / localhost 的 URL
        text = "Visit https://evil.example.com/?token=stolen"
        assert web_ui._extract_url(text) is None

    def test_empty_text(self):
        assert web_ui._extract_url("") is None
        assert web_ui._extract_url(None) is None  # type: ignore[arg-type]

    def test_first_match_wins(self):
        text = (
            "Some banner...\n"
            "Dashboard: http://127.0.0.1:19789/?token=a\n"
            "Other: http://127.0.0.1:9999/\n"
        )
        assert web_ui._extract_url(text) == "http://127.0.0.1:19789/?token=a"


# ---------------------------------------------------------------------------
# get_web_url 主流程
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_home(tmp_path: Path) -> Path:
    """创建一个伪造的 OPENCLAW_HOME，包含 cli/v.../bin/openclaw 占位文件。"""
    bin_dir = tmp_path / "cli" / "v2026.5.4" / "bin"
    bin_dir.mkdir(parents=True)
    bin_path = bin_dir / "openclaw"
    bin_path.write_text("#!/bin/sh\necho stub", encoding="utf-8")
    bin_path.chmod(0o755)
    return tmp_path


class TestGetWebUrl:
    """get_web_url 高层流程（mock subprocess）。"""

    def test_success_extracts_url(self, fake_home: Path):
        """dashboard 成功输出 URL → available=True。"""
        fake_completed = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="Open the OpenClaw dashboard: http://127.0.0.1:19789/?token=xyz\n",
            stderr="",
        )
        with patch.object(subprocess, "run", return_value=fake_completed):
            result = web_ui.get_web_url(fake_home)
        assert result.available is True
        assert result.url == "http://127.0.0.1:19789/?token=xyz"
        assert result.reason is None

    def test_cli_not_installed(self, tmp_path: Path):
        """没有 openclaw 可执行 → available=False。"""
        result = web_ui.get_web_url(tmp_path)  # 空目录
        assert result.available is False
        assert result.url is None
        assert "未安装" in (result.reason or "")

    def test_dashboard_nonzero_exit_gateway_down(self, fake_home: Path):
        """dashboard 非零退出 + 含 gateway 关键字 → reason 提示 gateway 未运行。"""
        fake_completed = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="error: gateway not running\n",
        )
        with patch.object(subprocess, "run", return_value=fake_completed):
            result = web_ui.get_web_url(fake_home)
        assert result.available is False
        assert "gateway" in (result.reason or "").lower()

    def test_dashboard_timeout(self, fake_home: Path):
        """dashboard 超时 → reason 含超时字样。"""
        with patch.object(
            subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(cmd=["openclaw"], timeout=5.0),
        ):
            result = web_ui.get_web_url(fake_home, timeout=5.0)
        assert result.available is False
        assert "超时" in (result.reason or "")

    def test_dashboard_no_url_in_output(self, fake_home: Path):
        """dashboard exit=0 但 stdout 没 URL → available=False。"""
        fake_completed = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="Some unrelated banner with no url\n",
            stderr="",
        )
        with patch.object(subprocess, "run", return_value=fake_completed):
            result = web_ui.get_web_url(fake_home)
        assert result.available is False
        assert "未包含" in (result.reason or "")


# ---------------------------------------------------------------------------
# is_web_ui_available
# ---------------------------------------------------------------------------


def test_is_web_ui_available_true(fake_home: Path):
    assert web_ui.is_web_ui_available(fake_home) is True


def test_is_web_ui_available_false(tmp_path: Path):
    assert web_ui.is_web_ui_available(tmp_path) is False
