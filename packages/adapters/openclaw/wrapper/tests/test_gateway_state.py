"""Gateway 进程级状态单例单元测试。

EPIC-0001 第三批 STORY-0018 T2：``gateway_state.py`` 完整覆盖。

覆盖矩阵：
- GatewayInfo: 默认值 / 不可变 / to_status_dict
- set_running / set_stopped / set_errored 三个语义入口
- get_info 快照语义（不漏读、不被回退污染）
- 多线程并发写入不破坏不变式
- reset_for_test 隔离
"""

from __future__ import annotations

import threading
import time

import pytest

from artifex_nexus.openclaw_wrapper import gateway_state
from artifex_nexus.openclaw_wrapper.gateway_state import (
    GatewayInfo,
    get_info,
    reset_for_test,
    set_errored,
    set_running,
    set_stopped,
)


@pytest.fixture(autouse=True)
def _reset():
    """每条用例前后都把单例重置回初始 stopped。"""
    reset_for_test()
    yield
    reset_for_test()


# ---------------------------------------------------------------------------
# GatewayInfo
# ---------------------------------------------------------------------------


class TestGatewayInfo:
    def test_default_is_stopped(self):
        info = GatewayInfo()
        assert info.state == "stopped"
        assert info.pid is None
        assert info.port is None
        assert info.started_at is None
        assert info.last_error is None

    def test_immutable(self):
        info = GatewayInfo()
        with pytest.raises((AttributeError, TypeError)):
            info.state = "running"  # type: ignore[misc]  # frozen=True

    def test_to_status_dict_keys_match_spec(self):
        info = GatewayInfo(
            state="running", pid=123, port=19789, started_at=1700000000.0
        )
        d = info.to_status_dict(last_log_id=42)
        # spec §2.1 字段名（去掉 uptime_seconds，前端自算）
        assert set(d) == {"state", "pid", "port", "started_at", "last_error", "last_log_id"}
        assert d["state"] == "running"
        assert d["pid"] == 123
        assert d["port"] == 19789
        assert d["started_at"] == 1700000000.0
        assert d["last_error"] is None
        assert d["last_log_id"] == 42

    def test_to_status_dict_default_log_id_is_zero(self):
        d = GatewayInfo().to_status_dict()
        assert d["last_log_id"] == 0

    def test_to_status_dict_errored_carries_message(self):
        info = GatewayInfo(state="errored", last_error="spawn 失败: ENOENT")
        d = info.to_status_dict()
        assert d["state"] == "errored"
        assert d["last_error"] == "spawn 失败: ENOENT"


# ---------------------------------------------------------------------------
# set_running
# ---------------------------------------------------------------------------


class TestSetRunning:
    def test_writes_pid_port_started_at(self):
        before = time.time()
        info = set_running(pid=4321, port=19789)
        after = time.time()
        assert info.state == "running"
        assert info.pid == 4321
        assert info.port == 19789
        assert before <= (info.started_at or 0) <= after
        assert info.last_error is None

    def test_explicit_started_at_overrides_now(self):
        info = set_running(pid=1, port=2, started_at=1234567890.5)
        assert info.started_at == 1234567890.5

    def test_overwrites_previous_errored_state(self):
        set_errored("boom")
        info = set_running(pid=1, port=2)
        assert info.state == "running"
        assert info.last_error is None  # 显式清掉错误

    @pytest.mark.parametrize("bad_pid", [0, -1, -99999])
    def test_rejects_non_positive_pid(self, bad_pid):
        with pytest.raises(ValueError, match="pid"):
            set_running(pid=bad_pid, port=19789)

    @pytest.mark.parametrize("bad_port", [0, -1])
    def test_rejects_non_positive_port(self, bad_port):
        with pytest.raises(ValueError, match="port"):
            set_running(pid=1, port=bad_port)


# ---------------------------------------------------------------------------
# set_stopped
# ---------------------------------------------------------------------------


class TestSetStopped:
    def test_clears_all_running_fields(self):
        set_running(pid=1, port=2)
        info = set_stopped()
        assert info.state == "stopped"
        assert info.pid is None
        assert info.port is None
        assert info.started_at is None
        assert info.last_error is None

    def test_idempotent_when_already_stopped(self):
        info1 = set_stopped()
        info2 = set_stopped()
        assert info1.state == info2.state == "stopped"


# ---------------------------------------------------------------------------
# set_errored
# ---------------------------------------------------------------------------


class TestSetErrored:
    def test_keeps_previous_pid_and_port_for_diagnostics(self):
        set_running(pid=999, port=19789)
        info = set_errored("port 探活失败")
        # 保留上次 PID/port 便于 UI 显示 "last known"
        assert info.pid == 999
        assert info.port == 19789
        assert info.state == "errored"
        assert info.last_error == "port 探活失败"

    def test_overrides_previous_error_message(self):
        set_errored("first")
        info = set_errored("second")
        assert info.last_error == "second"

    def test_works_from_stopped_state(self):
        info = set_errored("spawn ENOENT")
        assert info.state == "errored"
        assert info.last_error == "spawn ENOENT"
        assert info.pid is None  # 之前没 running 过


# ---------------------------------------------------------------------------
# get_info
# ---------------------------------------------------------------------------


class TestGetInfo:
    def test_initial_is_stopped(self):
        assert get_info().state == "stopped"

    def test_returns_latest_snapshot(self):
        set_running(pid=1, port=2)
        assert get_info().pid == 1
        set_stopped()
        assert get_info().pid is None

    def test_snapshot_not_mutated_by_subsequent_writes(self):
        set_running(pid=1, port=2)
        snap = get_info()
        set_running(pid=99, port=88)
        # snap 是 frozen dataclass 实例，不会被后续写入污染
        assert snap.pid == 1
        assert snap.port == 2


# ---------------------------------------------------------------------------
# 并发安全
# ---------------------------------------------------------------------------


class TestThreadSafety:
    def test_concurrent_writes_do_not_corrupt(self):
        """8 个线程各 200 次 set_running，最终 state 必须是 running。

        不要求 pid/port 可预测（最后赢家任意），只要求不破坏不变式：
        - state 始终是合法枚举值
        - running 时 pid/port/started_at 都非 None
        """
        N_THREADS = 8
        N_ITER = 200
        errors: list[str] = []

        def worker(tid: int):
            for i in range(N_ITER):
                pid = tid * N_ITER + i + 1
                set_running(pid=pid, port=19789)
                info = get_info()
                if info.state == "running":
                    if info.pid is None or info.port is None or info.started_at is None:
                        errors.append(f"running 但字段缺失: {info}")

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(N_THREADS)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"并发写入破坏不变式: {errors[:5]}"
        final = get_info()
        assert final.state == "running"
        assert final.pid is not None and final.pid > 0


# ---------------------------------------------------------------------------
# reset_for_test
# ---------------------------------------------------------------------------


class TestResetForTest:
    def test_returns_to_initial_stopped(self):
        set_running(pid=1, port=2)
        gateway_state.reset_for_test()
        assert get_info() == GatewayInfo()
