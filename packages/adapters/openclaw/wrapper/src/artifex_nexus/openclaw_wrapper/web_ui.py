"""
OpenClaw Control UI (Web UI) URL 探测。

Web UI URL probe: spawns ``openclaw dashboard --no-open`` and parses stdout
to extract the dashboard URL (which embeds a one-shot session token).

关键设计决策（来自 EPIC-0001 第二批 T7 spike，2026-05-07 实测）：
- OpenClaw v2026.5.4 自带 Control UI（内嵌于 gateway，复用 ``gateway.port``）
- 配置开关位于 ``gateway.controlUi.enabled``（schema slice 见 docs/specs/_spikes/）
- CLI ``openclaw dashboard --no-open`` 会打印一行 ``http://127.0.0.1:<port>/?token=...``
- 不需要 4 级 fallback：单命令直接拿带 token 的 URL，比 HTTP HEAD 探测更准
- 三件套 env 必须显式注入（OPENCLAW_HOME / OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH）
  否则 dashboard 会读到 ``~/.openclaw/`` 的全局配置，token 与本项目 gateway 不匹配
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    from . import _subprocess as _sp
except ImportError:  # 兼容直接以脚本方式执行
    import _subprocess as _sp  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DASHBOARD_TIMEOUT = 5.0
"""dashboard 子命令整体超时（秒）。"""

# 匹配 dashboard 输出的 URL 行；OpenClaw 输出格式：
#   "Open the OpenClaw dashboard: http://127.0.0.1:19789/?token=xxx"
# 只接受 127.0.0.1 / localhost 避免被恶意 stdout 注入跳到外站
_URL_PATTERN = re.compile(
    r"\b(https?://(?:127\.0\.0\.1|localhost)(?::\d+)?(?:/[^\s\"']*)?)",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class WebUrlResult:
    """Web UI URL 探测结果。

    Web UI URL probe result for ``openclaw.web.get_url`` RPC.
    """

    available: bool
    """Web UI 是否可用。"""
    url: Optional[str] = None
    """带 token 的完整 URL（仅 available=True 时有值）。"""
    reason: Optional[str] = None
    """不可用原因（仅 available=False 时有值，前端 tooltip 用）。"""

    def to_dict(self) -> dict:
        return {
            "available": self.available,
            "url": self.url,
            "reason": self.reason,
        }


# ---------------------------------------------------------------------------
# URL 探测
# ---------------------------------------------------------------------------


def _build_env(openclaw_home: Path) -> dict[str, str]:
    """构建注入隔离 OPENCLAW_HOME 的子进程环境（统一走 helper）。"""
    return _sp.build_openclaw_env(openclaw_home)


def _extract_url(text: str) -> Optional[str]:
    """从 dashboard stdout 中提取 URL。"""
    if not text:
        return None
    for line in text.splitlines():
        match = _URL_PATTERN.search(line)
        if match:
            return match.group(1)
    return None


def get_web_url(
    openclaw_home: Path,
    bin_path: Optional[Path] = None,
    timeout: float = DASHBOARD_TIMEOUT,
) -> WebUrlResult:
    """探测 OpenClaw Control UI 的 URL。

    .. deprecated:: STORY-0018-T2
        改用 sidecar 的 ``openclaw.web.open`` RPC：spawn ``openclaw dashboard``
        让 CLI 自开浏览器，无需把 token 透传给前端。本函数保留一个 release
        周期供 ``openclaw.web.get_url`` 兼容老前端。

    .. deprecated:: STORY-0018-T2 (EN)
        Use the ``openclaw.web.open`` RPC instead. Kept one release cycle for
        backward compatibility.

    Probe the OpenClaw Control UI URL via ``openclaw dashboard --no-open``.

    Args:
        openclaw_home: OPENCLAW_HOME 路径（必须是本项目的隔离目录）。
        bin_path: openclaw 可执行文件路径；为空时自动查找。
        timeout: dashboard 命令超时秒数。

    Returns:
        WebUrlResult: 包含 available / url / reason。

    Note:
        本函数假定调用方已确认 ``gateway_running == True``；若 gateway 未启，
        dashboard 命令会以非零码退出，本函数返回 available=False 并附原因。
    """
    home = Path(openclaw_home).expanduser().resolve()

    # 1. 解析 openclaw 可执行文件（统一走 helper）
    if bin_path is None:
        bin_path = _sp.find_openclaw_bin(home)

    if bin_path is None or not Path(bin_path).exists():
        return WebUrlResult(
            available=False,
            reason="OpenClaw CLI 未安装，无法获取 Web UI URL",
        )

    # 2. spawn dashboard 子命令（helper 自动处理 Win .cmd / NO_WINDOW / UTF-8）
    try:
        proc = _sp.run_openclaw(
            ["dashboard", "--no-open"],
            home,
            bin_path=bin_path,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return WebUrlResult(
            available=False,
            reason=f"openclaw dashboard 命令超时（>{timeout}s）",
        )
    except (OSError, FileNotFoundError) as exc:
        return WebUrlResult(
            available=False,
            reason=f"启动 openclaw dashboard 失败: {exc}",
        )

    # 3. 解析 stdout（先 stdout 再 stderr，覆盖不同版本的输出位置）
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    url = _extract_url(combined)

    if proc.returncode != 0 and not url:
        # 退出码非零且没解析到 URL → 视为不可用
        first_line = (proc.stderr or proc.stdout or "").strip().splitlines()
        msg = first_line[0] if first_line else f"exit code {proc.returncode}"
        # 常见原因：gateway 未运行 / controlUi.enabled = false
        if "not running" in msg.lower() or "gateway" in msg.lower():
            reason = "OpenClaw gateway 未运行，请先启动"
        elif "control" in msg.lower() or "dashboard" in msg.lower():
            reason = "Control UI 未启用（gateway.controlUi.enabled = false）"
        else:
            reason = f"openclaw dashboard 返回错误: {msg}"
        return WebUrlResult(available=False, reason=reason)

    if not url:
        return WebUrlResult(
            available=False,
            reason="openclaw dashboard 输出未包含可识别的 URL",
        )

    return WebUrlResult(available=True, url=url)


# ---------------------------------------------------------------------------
# Status 扩展：web_ui_available
# ---------------------------------------------------------------------------


def is_web_ui_available(openclaw_home: Path) -> bool:
    """轻量判断 Web UI 是否“可能可用”（用于 status 字段）。

    Lightweight check for ``openclaw.status.web_ui_available``: only verifies
    that the CLI binary exists. Does not spawn dashboard (avoid status latency).
    The actual URL retrieval happens in :func:`get_web_url`.
    """
    bin_path = _sp.find_openclaw_bin(Path(openclaw_home).expanduser().resolve())
    return bin_path is not None
