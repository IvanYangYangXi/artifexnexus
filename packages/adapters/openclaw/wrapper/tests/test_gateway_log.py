"""Gateway 日志缓冲单元测试。

EPIC-0001 第三批 STORY-0018 T1：``gateway_log.py`` 完整覆盖。

覆盖矩阵：
- LogEntry: dict 序列化
- infer_level: 4 类关键字 + stream 兜底
- GatewayLogBuffer: append / tail / since / dropped / stats / clear / 边界
- 多线程并发 append 不丢条
- get_log_buffer 单例语义
"""

from __future__ import annotations

import threading
import time

import pytest

from artifex_nexus.openclaw_wrapper import gateway_log
from artifex_nexus.openclaw_wrapper.gateway_log import (
    DEFAULT_MAXLEN,
    GatewayLogBuffer,
    LogEntry,
    get_log_buffer,
    infer_level,
    reset_log_buffer_for_test,
)


# ---------------------------------------------------------------------------
# LogEntry
# ---------------------------------------------------------------------------


class TestLogEntry:
    def test_to_dict_keys_match_spec(self):
        e = LogEntry(id=1, ts=1.5, level="INFO", stream="stdout", text="hi")
        d = e.to_dict()
        # spec §2.1 字段名
        assert set(d) == {"id", "ts", "level", "stream", "text"}
        assert d["id"] == 1 and d["text"] == "hi"

    def test_immutable(self):
        e = LogEntry(id=1, ts=1.5, level="INFO", stream="stdout", text="hi")
        with pytest.raises((AttributeError, TypeError)):
            e.id = 2  # frozen=True


# ---------------------------------------------------------------------------
# infer_level
# ---------------------------------------------------------------------------


class TestInferLevel:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("Error: something broke", "ERROR"),
            ("Failed to connect", "ERROR"),
            ("FATAL exception in thread", "ERROR"),
            ("panic at the disco", "ERROR"),
            ("Warning: deprecated API", "WARN"),
            ("warn: low memory", "WARN"),
            ("debug trace verbose ok", "DEBUG"),
            ("Listening on :19789", "INFO"),  # stdout 默认 INFO
        ],
    )
    def test_infer_from_keywords(self, text: str, expected: str):
        assert infer_level(text, "stdout") == expected

    def test_stderr_default_is_warn(self):
        # 没有任何关键字时 stderr → WARN
        assert infer_level("just a plain message", "stderr") == "WARN"

    def test_stdout_default_is_info(self):
        assert infer_level("just a plain message", "stdout") == "INFO"

    def test_priority_error_beats_warn(self):
        # 同时含 error + warn → ERROR 优先
        assert infer_level("warn: error happened", "stdout") == "ERROR"


# ---------------------------------------------------------------------------
# GatewayLogBuffer 基本读写
# ---------------------------------------------------------------------------


class TestBufferAppend:
    def test_append_returns_entry_with_incrementing_id(self):
        buf = GatewayLogBuffer()
        e1 = buf.append("stdout", "first")
        e2 = buf.append("stdout", "second")
        assert e1.id == 1 and e2.id == 2
        assert e1.text == "first" and e2.text == "second"

    def test_append_strips_whitespace_and_newline(self):
        buf = GatewayLogBuffer()
        e = buf.append("stdout", "  hello\n")
        assert e.text == "hello"

    def test_append_empty_line_raises(self):
        buf = GatewayLogBuffer()
        with pytest.raises(ValueError):
            buf.append("stdout", "   \n")

    def test_append_explicit_level_overrides_inference(self):
        buf = GatewayLogBuffer()
        # 文本里有 "error" 但显式传 INFO，应以显式为准
        e = buf.append("stdout", "error happened", level="INFO")
        assert e.level == "INFO"

    def test_append_explicit_ts(self):
        buf = GatewayLogBuffer()
        e = buf.append("stdout", "x", ts=42.0)
        assert e.ts == 42.0

    def test_append_default_ts_is_now(self):
        buf = GatewayLogBuffer()
        before = time.time()
        e = buf.append("stdout", "x")
        after = time.time()
        assert before <= e.ts <= after


class TestBufferTail:
    def test_tail_n_returns_last_n(self):
        buf = GatewayLogBuffer()
        for i in range(10):
            buf.append("stdout", f"line {i}")
        last3 = buf.tail(3)
        assert [e.text for e in last3] == ["line 7", "line 8", "line 9"]

    def test_tail_n_larger_than_size_returns_all(self):
        buf = GatewayLogBuffer()
        buf.append("stdout", "only")
        assert len(buf.tail(100)) == 1

    def test_tail_zero_returns_empty(self):
        buf = GatewayLogBuffer()
        buf.append("stdout", "x")
        assert buf.tail(0) == []

    def test_tail_negative_raises(self):
        buf = GatewayLogBuffer()
        with pytest.raises(ValueError):
            buf.tail(-1)


class TestBufferSince:
    def test_since_returns_entries_after_id(self):
        buf = GatewayLogBuffer()
        for i in range(5):
            buf.append("stdout", f"line {i}")
        # 拉 id > 2 的 → 应得 id=3,4,5
        new = buf.since(2)
        assert [e.id for e in new] == [3, 4, 5]

    def test_since_zero_returns_all(self):
        buf = GatewayLogBuffer()
        for i in range(3):
            buf.append("stdout", f"line {i}")
        assert len(buf.since(0)) == 3

    def test_since_too_high_returns_empty(self):
        buf = GatewayLogBuffer()
        buf.append("stdout", "x")
        assert buf.since(999) == []

    def test_since_returns_all_when_client_lagged_dropped(self):
        # 客户端 since_id=1，但 buffer 已滚出该 id，应返回 buffer 内全部条目
        buf = GatewayLogBuffer(maxlen=3)
        for i in range(10):
            buf.append("stdout", f"line {i}")  # id 1..10，buffer 留 8,9,10
        new = buf.since(1)
        assert [e.id for e in new] == [8, 9, 10]


# ---------------------------------------------------------------------------
# 容量与丢弃
# ---------------------------------------------------------------------------


class TestBufferCapacity:
    def test_default_maxlen(self):
        buf = GatewayLogBuffer()
        assert buf.maxlen == DEFAULT_MAXLEN

    def test_custom_maxlen(self):
        buf = GatewayLogBuffer(maxlen=5)
        assert buf.maxlen == 5

    def test_maxlen_zero_raises(self):
        with pytest.raises(ValueError):
            GatewayLogBuffer(maxlen=0)

    def test_maxlen_negative_raises(self):
        with pytest.raises(ValueError):
            GatewayLogBuffer(maxlen=-1)

    def test_overflow_drops_oldest_and_counts(self):
        buf = GatewayLogBuffer(maxlen=3)
        for i in range(5):
            buf.append("stdout", f"line {i}")
        # 应保留最后 3 条；dropped 计数 = 2
        texts = [e.text for e in buf.tail(10)]
        assert texts == ["line 2", "line 3", "line 4"]
        assert buf.stats()["dropped"] == 2

    def test_max_id_keeps_growing_after_overflow(self):
        buf = GatewayLogBuffer(maxlen=2)
        for i in range(10):
            buf.append("stdout", f"line {i}")
        # 即使 buffer 只有 2 条，max_id 仍是 10（id 单调递增不复用）
        assert buf.stats()["max_id"] == 10


# ---------------------------------------------------------------------------
# stats / clear
# ---------------------------------------------------------------------------


class TestBufferStats:
    def test_stats_keys(self):
        buf = GatewayLogBuffer()
        s = buf.stats()
        assert set(s) == {"size", "max_id", "dropped", "maxlen"}

    def test_stats_initial(self):
        buf = GatewayLogBuffer(maxlen=100)
        s = buf.stats()
        assert s == {"size": 0, "max_id": 0, "dropped": 0, "maxlen": 100}

    def test_clear_keeps_next_id(self):
        buf = GatewayLogBuffer()
        buf.append("stdout", "a")
        buf.append("stdout", "b")
        buf.clear()
        assert buf.stats()["size"] == 0
        # 下一条应继续递增（id=3，不复用 1/2 避免客户端错乱）
        e = buf.append("stdout", "c")
        assert e.id == 3


# ---------------------------------------------------------------------------
# 多线程并发
# ---------------------------------------------------------------------------


class TestBufferConcurrency:
    def test_concurrent_append_no_loss_no_dup_id(self):
        """8 个线程各 append 500 条，最终应无 id 重复且总数 = 4000。"""
        buf = GatewayLogBuffer(maxlen=10000)  # 留足空间不触发丢弃
        N_THREADS = 8
        N_PER = 500

        def worker(tid: int):
            for i in range(N_PER):
                buf.append("stdout", f"t{tid}-{i}")

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(N_THREADS)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        all_entries = buf.tail(N_THREADS * N_PER + 100)
        assert len(all_entries) == N_THREADS * N_PER
        ids = [e.id for e in all_entries]
        assert len(set(ids)) == len(ids), "id 不应重复"
        # id 应连续覆盖 1..N_THREADS*N_PER
        assert sorted(ids) == list(range(1, N_THREADS * N_PER + 1))

    def test_concurrent_append_with_overflow_dropped_correct(self):
        """maxlen=100、写 500 条 → 最终 size=100、dropped=400。"""
        buf = GatewayLogBuffer(maxlen=100)
        N_THREADS = 5
        N_PER = 100

        def worker(tid: int):
            for i in range(N_PER):
                buf.append("stdout", f"t{tid}-{i}")

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(N_THREADS)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        s = buf.stats()
        assert s["size"] == 100
        assert s["dropped"] == 400
        assert s["max_id"] == 500


# ---------------------------------------------------------------------------
# 单例
# ---------------------------------------------------------------------------


class TestSingleton:
    def setup_method(self):
        reset_log_buffer_for_test()

    def teardown_method(self):
        reset_log_buffer_for_test()

    def test_get_log_buffer_returns_same_instance(self):
        a = get_log_buffer()
        b = get_log_buffer()
        assert a is b

    def test_get_log_buffer_default_maxlen(self):
        buf = get_log_buffer()
        assert buf.maxlen == DEFAULT_MAXLEN

    def test_reset_creates_new_instance(self):
        a = get_log_buffer()
        a.append("stdout", "x")
        reset_log_buffer_for_test()
        b = get_log_buffer()
        assert a is not b
        assert b.stats()["size"] == 0
        # next_id 也重置（新实例）
        assert b.stats()["max_id"] == 0
