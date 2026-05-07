"""
Gateway 日志缓冲：sidecar 进程内的环形 buffer，承接 OpenClaw gateway 子进程
stdout/stderr 行流，供前端 ``openclaw.gateway.tail_log`` RPC 增量轮询。

Gateway log buffer: an in-process ring buffer that captures the OpenClaw
gateway subprocess stdout/stderr stream lines, exposed to the frontend
through the ``openclaw.gateway.tail_log`` RPC for incremental polling.

设计：
    - ``LogEntry``：单条日志的不可变记录（id 单调递增 / unix ts / level / stream / text）
    - ``GatewayLogBuffer``：线程安全 ``deque(maxlen=8000)``；append/tail/since/stats
    - ``infer_level``：按行内关键字推断 level（行首/包含 ``error|fail`` → ERROR；``warn`` → WARN；其余 INFO）
    - ``get_log_buffer``：sidecar 进程级单例

详见 docs/specs/openclaw-status-panel.md §3。
"""

from __future__ import annotations

import re
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, List, Literal, Optional


# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DEFAULT_MAXLEN = 8000
"""buffer 默认容量上限（行）。

8000 行 × 约 200 字节 ≈ 1.6 MB；sidecar 进程级别可接受。
超出后旧条会被 deque 自动丢弃，``GatewayLogBuffer.stats()['dropped']``
会累计已丢弃数，前端可据此提示用户用 ``openclaw logs tail`` 取更长历史。
"""

LogLevel = Literal["DEBUG", "INFO", "WARN", "ERROR"]
"""日志分级；与 OpenClaw 上游 LogLevel 对齐（仅 sidecar 内部用，未跨契约）。"""

LogStream = Literal["stdout", "stderr"]
"""来源流：stdout / stderr（用于前端可选着色）。"""

# level 推断关键字（按优先级排列：先匹配 ERROR > WARN > DEBUG > 默认 INFO）
_RE_ERROR = re.compile(r"\b(error|fail(?:ed|ure)?|fatal|panic|exception)\b", re.IGNORECASE)
_RE_WARN = re.compile(r"\b(warn(?:ing)?|deprecated)\b", re.IGNORECASE)
_RE_DEBUG = re.compile(r"\b(debug|trace|verbose)\b", re.IGNORECASE)


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LogEntry:
    """单条日志记录（不可变）。

    Single log entry (immutable record).

    Attributes:
        id: 单调递增 ID（同一 buffer 实例生命期内唯一）。
        ts: unix timestamp（``time.time()``，秒级 float）。
        level: 推断后的级别。
        stream: 来源流。
        text: 单行原文（已 strip newline 与首尾空白）。
    """

    id: int
    ts: float
    level: LogLevel
    stream: LogStream
    text: str

    def to_dict(self) -> dict:
        """序列化为 RPC 友好的 dict（字段名与 spec §2.1 对齐）。"""
        return {
            "id": self.id,
            "ts": self.ts,
            "level": self.level,
            "stream": self.stream,
            "text": self.text,
        }


@dataclass
class _BufferState:
    """内部状态聚合，便于 ``stats()`` 一次返回。"""

    next_id: int = 1
    """下一条 LogEntry 的 id（递增）。"""
    dropped: int = 0
    """因 deque 溢出被丢弃的累计行数（buffer 满时旧条被自动剔除）。"""
    entries: Deque[LogEntry] = field(default_factory=deque)
    """实际行队列。"""


# ---------------------------------------------------------------------------
# Buffer
# ---------------------------------------------------------------------------


class GatewayLogBuffer:
    """线程安全的环形日志缓冲。

    Thread-safe ring buffer for gateway log lines.

    用法（典型读 stdout 守护线程）::

        buf = get_log_buffer()
        for line in proc.stdout:
            buf.append("stdout", line)

    用法（RPC tail_log）::

        # 首次拉：tail(n=200)
        recent = buf.tail(200)
        # 增量轮询：since(last_id)
        new = buf.since(client_last_id)
    """

    def __init__(self, maxlen: int = DEFAULT_MAXLEN) -> None:
        if maxlen <= 0:
            raise ValueError(f"maxlen 必须 > 0, 实际 = {maxlen}")
        self._maxlen = maxlen
        self._state = _BufferState(entries=deque(maxlen=maxlen))
        self._lock = threading.Lock()

    @property
    def maxlen(self) -> int:
        """容量上限。"""
        return self._maxlen

    # ----- 写入 -----------------------------------------------------------

    def append(
        self,
        stream: LogStream,
        text: str,
        level: Optional[LogLevel] = None,
        ts: Optional[float] = None,
    ) -> LogEntry:
        """追加一条日志，返回写入的 ``LogEntry``。

        Append a single log line; returns the inserted entry.

        Args:
            stream: ``stdout`` 或 ``stderr``。
            text: 单行原文（任何首尾空白与换行符会被 strip）。
            level: 显式 level；为 ``None`` 时调用 :func:`infer_level` 推断。
            ts: 显式 unix ts；为 ``None`` 时用 ``time.time()``。

        Note:
            - 空行（strip 后为空）会被忽略，返回最近一条 entry 的占位副本？
              ❌ 不：直接抛 ``ValueError``，由调用方决定要不要 catch。
              （守护线程通常 ``if not line.strip(): continue``。）
            - buffer 满时 ``deque`` 自动从左边丢弃最老条目，``dropped`` +1。
        """
        clean = text.strip()
        if not clean:
            raise ValueError("空行不入 buffer；调用方应预过滤")

        eff_level: LogLevel = level if level is not None else infer_level(clean, stream)
        eff_ts: float = ts if ts is not None else time.time()

        with self._lock:
            entry = LogEntry(
                id=self._state.next_id,
                ts=eff_ts,
                level=eff_level,
                stream=stream,
                text=clean,
            )
            # deque 满时 append 会从左边自动丢；先记录"是否会丢"再 append
            will_drop = len(self._state.entries) >= self._maxlen
            self._state.entries.append(entry)
            if will_drop:
                self._state.dropped += 1
            self._state.next_id += 1
            return entry

    # ----- 读取 -----------------------------------------------------------

    def tail(self, n: int = 200) -> List[LogEntry]:
        """返回最近 ``n`` 条；buffer 不足时返回全部。

        Return up to the last ``n`` entries; fewer if buffer not full.
        """
        if n < 0:
            raise ValueError(f"n 必须 >= 0, 实际 = {n}")
        if n == 0:
            return []
        with self._lock:
            if n >= len(self._state.entries):
                return list(self._state.entries)
            # deque 切片需要先转 list；性能上 8000 行可接受
            return list(self._state.entries)[-n:]

    def since(self, since_id: int) -> List[LogEntry]:
        """返回所有 ``id > since_id`` 的条目（增量轮询）。

        Return entries with ``id > since_id`` (incremental polling).

        Note:
            - 若 ``since_id`` 早于 buffer 最老 id（即客户端落后太多被丢弃），
              返回的就是 buffer 内全部条目；客户端可通过 ``stats()['dropped']``
              判断是否漏行。
        """
        with self._lock:
            # 队列单调递增，可早退；但 8000 行直接遍历也够快，写法简单优先
            return [e for e in self._state.entries if e.id > since_id]

    # ----- 元信息 ---------------------------------------------------------

    def stats(self) -> dict:
        """返回 ``{size, max_id, dropped, maxlen}``。"""
        with self._lock:
            return {
                "size": len(self._state.entries),
                "max_id": self._state.next_id - 1,  # 0 表示从未写入
                "dropped": self._state.dropped,
                "maxlen": self._maxlen,
            }

    def clear(self) -> None:
        """清空 buffer（不重置 ``next_id``，避免 id 复用导致客户端错乱）。

        Test/debug helper. Production code should not need to clear the buffer
        because gateway restart spawns a new sidecar process and a new buffer.
        """
        with self._lock:
            self._state.entries.clear()
            self._state.dropped = 0


# ---------------------------------------------------------------------------
# Level 推断
# ---------------------------------------------------------------------------


def infer_level(text: str, stream: LogStream) -> LogLevel:
    """按行内关键字推断 level。

    Infer log level from line content.

    规则（优先级从高到低）：
        1. 行内匹配 ``error|fail|fatal|panic|exception`` → ERROR
        2. 行内匹配 ``warn|deprecated`` → WARN
        3. 行内匹配 ``debug|trace|verbose`` → DEBUG
        4. 否则：stderr → WARN（保守），stdout → INFO

    设计意图：
        OpenClaw v2026.5.4 的输出没有结构化 level 字段；我们只能从行文本推断。
        当推断不出时，按 stream 分流：stderr 默认 WARN（用户更敏感），
        stdout 默认 INFO（噪音多）。
    """
    if _RE_ERROR.search(text):
        return "ERROR"
    if _RE_WARN.search(text):
        return "WARN"
    if _RE_DEBUG.search(text):
        return "DEBUG"
    return "WARN" if stream == "stderr" else "INFO"


# ---------------------------------------------------------------------------
# 单例
# ---------------------------------------------------------------------------

_singleton: Optional[GatewayLogBuffer] = None
_singleton_lock = threading.Lock()


def get_log_buffer() -> GatewayLogBuffer:
    """sidecar 进程级单例，第一次调用时惰性创建。

    Process-level singleton; lazy-initialized on first access.

    Note:
        sidecar 进程结束 = 单例消亡 = buffer 清零。这是预期行为：
        gateway 重启走"老 sidecar 不动"路径时 buffer 内容保留；
        sidecar 整体重启时（用户重启桌面应用）buffer 清零，前端
        感知 ``stats()['max_id'] == 0`` 即视为"全新会话"。
    """
    global _singleton
    if _singleton is None:
        with _singleton_lock:
            if _singleton is None:  # double-checked
                _singleton = GatewayLogBuffer()
    return _singleton


def reset_log_buffer_for_test() -> None:
    """重置单例；仅供单元测试用，禁止生产代码调用。"""
    global _singleton
    with _singleton_lock:
        _singleton = None
