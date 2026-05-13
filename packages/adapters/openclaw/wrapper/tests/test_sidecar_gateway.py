"""STORY-0018 T2：5 个新 gateway RPC handler 单元测试。

直接调用 ``sidecar_gateway.handle_*`` 入口函数（非 stdio 集成层），
mock 掉真实的 subprocess.Popen 与 runtime 副作用，专注验证：

- 请求参数解析（n / since_id 互斥、force_restart 语义、port 默认值）
- 与 ``gateway_state`` / ``gateway_log`` 单例的协作
- 错误路径：spawn 失败 / 非法参数 / 异常上抛
- 响应字段名与 spec §2.1-2.5 对齐

测试矩阵（≥ 6 条要求 → 实际 18 条）：
- gateway.status: 2 条（stopped / running 含 last_log_id）
- gateway.start: 4 条（首次启动 / 已运行幂等 / force_restart / 异常）
- gateway.restart: 1 条（等价 force_restart=True）
- gateway.tail_log: 6 条（n 默认 / n 指定 / since_id / 互斥 / 非法 since_id / n<0）
- web.open: 5 条（成功 / CLI 缺失 / spawn OSError / FileNotFoundError / 兜底异常）
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from artifex_nexus.openclaw_wrapper import (
    gateway_log,
    gateway_state,
    sidecar_gateway,
)


@pytest.fixture(autouse=True)
def _reset_singletons():
    """每条用例前后重置 buffer 与 state 单例，避免互相污染。"""
    gateway_log.reset_log_buffer_for_test()
    gateway_state.reset_for_test()
    yield
    gateway_log.reset_log_buffer_for_test()
    gateway_state.reset_for_test()


# ---------------------------------------------------------------------------
# openclaw.gateway.status
# ---------------------------------------------------------------------------


class TestGatewayStatus:
    def test_stopped_initial(self):
        resp = sidecar_gateway.handle_gateway_status(req_id=1, _params={})
        assert resp["id"] == 1
        result = resp["result"]
        assert result["state"] == "stopped"
        assert result["pid"] is None
        assert result["port"] is None
        assert result["started_at"] is None
        assert result["last_error"] is None
        assert result["last_log_id"] == 0

    def test_running_with_log_id(self):
        gateway_state.set_running(pid=4321, port=19789, started_at=1700000000.0)
        buf = gateway_log.get_log_buffer()
        buf.append("stdout", "boot ok")
        buf.append("stderr", "warn: x")

        # mock _current_process 为"存活中"（poll() → None），
        # 避免反向存活检测误判 PID 4321 已死
        fake_proc = MagicMock()
        fake_proc.poll.return_value = None
        with patch.object(sidecar_gateway._runtime, "_current_process", fake_proc):
            resp = sidecar_gateway.handle_gateway_status(req_id=2, _params={})

        result = resp["result"]
        assert result["state"] == "running"
        assert result["pid"] == 4321
        assert result["port"] == 19789
        assert result["started_at"] == 1700000000.0
        assert result["last_log_id"] == 2  # 写了 2 条
        # spec §2.1：去掉 uptime_seconds，前端自算
        assert "uptime_seconds" not in result


# ---------------------------------------------------------------------------
# openclaw.gateway.start  /  restart
# ---------------------------------------------------------------------------


class TestGatewayStart:
    def test_first_time_start_invokes_runtime_and_returns_pid(self):
        fake_proc = MagicMock(pid=1234, port=19789, message="gateway 已启动 (pid=1234)")
        with patch.object(sidecar_gateway._runtime, "start_gateway", return_value=fake_proc) as m:
            resp = sidecar_gateway.handle_gateway_start(
                req_id=1, params={"openclaw_home": "/tmp/x", "port": 19789}
            )
        assert resp["id"] == 1
        result = resp["result"]
        assert result["success"] is True
        assert result["restarted"] is False
        assert result["pid"] == 1234
        assert result["port"] == 19789
        m.assert_called_once()

    def test_idempotent_when_already_running(self):
        gateway_state.set_running(pid=999, port=19789)
        with patch.object(sidecar_gateway._runtime, "_is_pid_alive", return_value=True), \
             patch.object(sidecar_gateway._runtime, "start_gateway") as m_start:
            resp = sidecar_gateway.handle_gateway_start(req_id=1, params={})
        result = resp["result"]
        assert result["success"] is True
        assert result["restarted"] is False
        assert result["pid"] == 999
        assert "已在运行" in result["message"]
        m_start.assert_not_called()

    def test_force_restart_stops_then_starts(self):
        gateway_state.set_running(pid=999, port=19789)
        fake_proc = MagicMock(pid=2222, port=19789, message="gateway 已启动 (pid=2222)")
        with patch.object(sidecar_gateway._runtime, "_is_pid_alive", return_value=True), \
             patch.object(sidecar_gateway._runtime, "stop_gateway", return_value=True) as m_stop, \
             patch.object(sidecar_gateway._runtime, "start_gateway", return_value=fake_proc) as m_start:
            resp = sidecar_gateway.handle_gateway_start(
                req_id=1, params={"force_restart": True}
            )
        result = resp["result"]
        assert result["success"] is True
        assert result["restarted"] is True
        assert result["pid"] == 2222
        m_stop.assert_called_once()
        m_start.assert_called_once()

    def test_runtime_exception_returns_jsonrpc_error(self):
        with patch.object(
            sidecar_gateway._runtime,
            "start_gateway",
            side_effect=FileNotFoundError("no openclaw bin"),
        ):
            resp = sidecar_gateway.handle_gateway_start(req_id=7, params={})
        assert resp["id"] == 7
        assert "error" in resp
        assert resp["error"]["code"] == -32000
        assert "no openclaw bin" in resp["error"]["message"]


class TestGatewayRestart:
    def test_restart_equivalent_to_force_restart(self):
        """restart 必须等价 start({force_restart: True})。"""
        gateway_state.set_running(pid=111, port=19789)
        fake_proc = MagicMock(pid=222, port=19789, message="gateway 已启动 (pid=222)")
        with patch.object(sidecar_gateway._runtime, "_is_pid_alive", return_value=True), \
             patch.object(sidecar_gateway._runtime, "stop_gateway", return_value=True), \
             patch.object(sidecar_gateway._runtime, "start_gateway", return_value=fake_proc):
            resp = sidecar_gateway.handle_gateway_restart(req_id=1, params={})
        result = resp["result"]
        assert result["restarted"] is True
        assert result["pid"] == 222


# ---------------------------------------------------------------------------
# openclaw.gateway.tail_log
# ---------------------------------------------------------------------------


class TestGatewayTailLog:
    def _seed(self, n: int) -> None:
        buf = gateway_log.get_log_buffer()
        for i in range(n):
            buf.append("stdout", f"line {i}")

    def test_default_n_returns_all_when_buffer_smaller(self):
        self._seed(5)
        resp = sidecar_gateway.handle_gateway_tail_log(req_id=1, params={})
        result = resp["result"]
        assert len(result["entries"]) == 5
        assert result["max_id"] == 5
        assert result["buffer_size"] == 5
        assert result["dropped"] == 0
        # 字段名对齐 spec §2.4
        assert {"id", "ts", "level", "stream", "text"} == set(result["entries"][0].keys())

    def test_n_explicit_caps_at_buffer_tail(self):
        self._seed(50)
        resp = sidecar_gateway.handle_gateway_tail_log(req_id=1, params={"n": 10})
        result = resp["result"]
        assert len(result["entries"]) == 10
        # 取最后 10 条 → id 41..50
        assert result["entries"][0]["id"] == 41
        assert result["entries"][-1]["id"] == 50

    def test_since_id_returns_only_newer(self):
        self._seed(20)
        resp = sidecar_gateway.handle_gateway_tail_log(
            req_id=1, params={"since_id": 15}
        )
        result = resp["result"]
        assert len(result["entries"]) == 5  # id 16..20
        assert result["entries"][0]["id"] == 16

    def test_since_id_takes_precedence_over_n(self):
        """spec §2.4：n 与 since_id 同传时，since_id 优先（互斥决议）。"""
        self._seed(20)
        resp = sidecar_gateway.handle_gateway_tail_log(
            req_id=1, params={"n": 3, "since_id": 18}
        )
        result = resp["result"]
        # 用 since_id 走的话是 2 条（id 19、20），不是 n=3
        assert len(result["entries"]) == 2
        assert [e["id"] for e in result["entries"]] == [19, 20]

    def test_since_id_non_int_returns_invalid_params(self):
        resp = sidecar_gateway.handle_gateway_tail_log(
            req_id=1, params={"since_id": "abc"}
        )
        assert "error" in resp
        assert resp["error"]["code"] == -32602

    def test_negative_n_returns_invalid_params(self):
        resp = sidecar_gateway.handle_gateway_tail_log(req_id=1, params={"n": -1})
        assert "error" in resp
        assert resp["error"]["code"] == -32602


# ---------------------------------------------------------------------------
# openclaw.web.open
# ---------------------------------------------------------------------------


class TestWebOpen:
    def test_success_spawns_dashboard_and_returns_pid(self):
        fake_proc = MagicMock(pid=8888)
        fake_bin = Path("/fake/openclaw.cmd")
        with patch.object(sidecar_gateway._sp, "find_openclaw_bin", return_value=fake_bin), \
             patch.object(sidecar_gateway._sp, "build_openclaw_env", return_value={"OPENCLAW_HOME": "/x"}), \
             patch.object(sidecar_gateway._sp, "popen_kwargs", return_value={"text": True}), \
             patch.object(subprocess, "Popen", return_value=fake_proc) as m_popen:
            resp = sidecar_gateway.handle_web_open(
                req_id=1, params={"openclaw_home": "/tmp/x"}
            )
        result = resp["result"]
        assert result["success"] is True
        assert result["method"] == "openclaw_dashboard"
        assert result["pid"] == 8888
        # 必须用 DEVNULL 防止污染 sidecar stdio
        kwargs = m_popen.call_args.kwargs
        assert kwargs["stdout"] == subprocess.DEVNULL
        assert kwargs["stderr"] == subprocess.DEVNULL
        # cmd 不能带 --no-open（让 CLI 自开浏览器）
        cmd = m_popen.call_args.args[0]
        assert cmd[-1] == "dashboard"
        assert "--no-open" not in cmd

    def test_cli_missing_returns_failure(self):
        with patch.object(sidecar_gateway._sp, "find_openclaw_bin", return_value=None):
            resp = sidecar_gateway.handle_web_open(
                req_id=1, params={"openclaw_home": "/tmp/x"}
            )
        result = resp["result"]
        assert result["success"] is False
        assert result["method"] == "openclaw_dashboard"
        assert "未找到" in result["error"]

    def test_spawn_oserror_returns_failure_not_exception(self):
        fake_bin = Path("/fake/openclaw.cmd")
        with patch.object(sidecar_gateway._sp, "find_openclaw_bin", return_value=fake_bin), \
             patch.object(sidecar_gateway._sp, "build_openclaw_env", return_value={}), \
             patch.object(sidecar_gateway._sp, "popen_kwargs", return_value={}), \
             patch.object(subprocess, "Popen", side_effect=OSError("permission denied")):
            resp = sidecar_gateway.handle_web_open(req_id=1, params={})
        result = resp["result"]
        assert result["success"] is False
        assert "permission denied" in result["error"]

    def test_spawn_filenotfound_returns_failure(self):
        fake_bin = Path("/fake/openclaw.cmd")
        with patch.object(sidecar_gateway._sp, "find_openclaw_bin", return_value=fake_bin), \
             patch.object(sidecar_gateway._sp, "build_openclaw_env", return_value={}), \
             patch.object(sidecar_gateway._sp, "popen_kwargs", return_value={}), \
             patch.object(subprocess, "Popen", side_effect=FileNotFoundError("no such file")):
            resp = sidecar_gateway.handle_web_open(req_id=1, params={})
        result = resp["result"]
        assert result["success"] is False
        assert "no such file" in result["error"]


# ---------------------------------------------------------------------------
# openclaw.gateway.auth_info
# ---------------------------------------------------------------------------


class TestGatewayAuthInfo:
    """STORY-0039：前端 WS 握手凭据查询。

    重点验证：
    - token 模式：读 openclaw.json → gateway.auth.token + 运行态 port
    - 非 token 模式：token 返回空串，port 仍返回
    - 无配置：fallback 到 DEFAULT_PORT + token="" + auth_mode=""
    - 运行态 port 覆盖 bootstrap.get_gateway_port（端口探测迁移场景）
    """

    def test_token_mode_returns_port_and_token(self):
        gateway_state.set_running(pid=1, port=19809)
        with patch.object(
            sidecar_gateway._bootstrap,
            "read_config",
            return_value={"gateway": {"auth": {"mode": "token", "token": "sekret"}}},
        ), patch.object(
            sidecar_gateway._bootstrap, "get_gateway_token", return_value="sekret"
        ):
            resp = sidecar_gateway.handle_gateway_auth_info(req_id=1, params={})
        result = resp["result"]
        assert result["port"] == 19809  # 运行态 port 优先
        assert result["token"] == "sekret"
        assert result["auth_mode"] == "token"

    def test_non_token_mode_returns_empty_token(self):
        gateway_state.set_running(pid=1, port=19789)
        with patch.object(
            sidecar_gateway._bootstrap,
            "read_config",
            return_value={"gateway": {"auth": {"mode": "none"}}},
        ):
            resp = sidecar_gateway.handle_gateway_auth_info(req_id=2, params={})
        result = resp["result"]
        assert result["port"] == 19789
        assert result["token"] == ""
        assert result["auth_mode"] == "none"

    def test_no_config_falls_back_to_defaults(self):
        # 未运行 + 无 config → port 走 get_gateway_port fallback，token 空
        with patch.object(
            sidecar_gateway._bootstrap, "read_config", return_value=None
        ), patch.object(
            sidecar_gateway._bootstrap,
            "get_gateway_port",
            return_value=sidecar_gateway.DEFAULT_PORT,
        ):
            resp = sidecar_gateway.handle_gateway_auth_info(req_id=3, params={})
        result = resp["result"]
        assert result["port"] == sidecar_gateway.DEFAULT_PORT
        assert result["token"] == ""
        assert result["auth_mode"] == ""

    def test_running_port_overrides_bootstrap_port(self):
        """端口探测把 gateway 迁到 19829，auth_info 必须返回 19829 而不是 19789。"""
        gateway_state.set_running(pid=2, port=19829)
        with patch.object(
            sidecar_gateway._bootstrap, "read_config", return_value={}
        ), patch.object(
            sidecar_gateway._bootstrap, "get_gateway_port", return_value=19789
        ):
            resp = sidecar_gateway.handle_gateway_auth_info(req_id=4, params={})
        result = resp["result"]
        assert result["port"] == 19829
        assert result["token"] == ""
        assert result["auth_mode"] == ""

    def test_unexpected_exception_returns_jsonrpc_error(self):
        """非 OSError/FileNotFoundError 的异常走 -32000 通道。"""
        with patch.object(
            sidecar_gateway._sp,
            "find_openclaw_bin",
            side_effect=RuntimeError("unexpected"),
        ):
            resp = sidecar_gateway.handle_web_open(req_id=1, params={})
        assert "error" in resp
        assert resp["error"]["code"] == -32000
        assert "unexpected" in resp["error"]["message"]
