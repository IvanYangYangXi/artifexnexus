"""
OpenClaw Control UI (Web UI) URL 生成。

Web UI URL builder: composes ``http://127.0.0.1:<port>/#token=<token>`` from
``openclaw.json`` directly (no subprocess), matching the upstream
``openclaw dashboard`` clipboard format.

关键设计决策（来自 STORY-0018 后 hot-fix，2026-05-07 实测）：
- ``openclaw dashboard --no-open`` 在 stdout 只打印**裸 URL**（无 token），
  token 是放进**剪贴板**的 ``http://...#token=...`` —— 不能从 stdout 抓
- 上游 Control UI 用 **fragment**（``#token=...``）传 token，不是 query；
  fragment 不会发到服务器，由前端 JS 读出并存 localStorage
- 我们直接从 ``openclaw.json`` 读 ``gateway.auth.token`` + ``gateway.port``
  自己拼，避开 stdout 解析的脆弱性，且无需 spawn subprocess（更快）
- 老的 ``--no-open`` 路径作为 fallback 保留（兼容未来上游改 stdout 输出格式）
"""

from __future__ import annotations

import logging
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    from . import _subprocess as _sp
    from . import bootstrap as _bootstrap
except ImportError:  # 兼容直接以脚本方式执行
    import _subprocess as _sp  # type: ignore[no-redef]
    import bootstrap as _bootstrap  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DASHBOARD_TIMEOUT = 5.0
"""dashboard 子命令整体超时（秒）。仅 fallback 路径使用。"""

# 匹配 dashboard stdout 行（fallback 用）；只接受 loopback host 防 stdout 注入。
# 注意：v2026.5.4 该输出**不带** token，留 regex 仅作历史兼容。
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
# URL 构造
# ---------------------------------------------------------------------------


def _build_url_from_config(openclaw_home: Path) -> Optional[str]:
    """从 ``openclaw.json`` 直接拼 ``http://127.0.0.1:<port>/#token=<token>``。

    Compose the Control UI URL directly from config: ``gateway.port`` +
    ``gateway.auth.token``. This matches the upstream ``openclaw dashboard``
    clipboard output format (token in fragment, not query).

    Returns:
        URL string；token 缺失时返回 ``None``。
    """
    home = Path(openclaw_home).expanduser().resolve()
    port = _bootstrap.get_gateway_port(home)
    token = _bootstrap.get_gateway_token(home)
    if not token:
        return None
    return f"http://127.0.0.1:{port}/#token={token}"


def _extract_url(text: str) -> Optional[str]:
    """从 dashboard stdout 中提取 URL（fallback 路径，已知不带 token）。"""
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
    """获取 OpenClaw Control UI 的带 token URL。

    Build the Control UI URL with auth token. Tries direct config compose
    first (no subprocess); falls back to ``openclaw dashboard --no-open`` for
    forward-compat with future CLI changes.

    Args:
        openclaw_home: OPENCLAW_HOME 路径（必须是本项目的隔离目录）。
        bin_path: openclaw 可执行文件路径；为空时自动查找。仅 fallback 路径用。
        timeout: dashboard fallback 命令超时秒数。

    Returns:
        WebUrlResult: 包含 available / url / reason。

    Note:
        本函数假定调用方已确认 ``gateway_running == True``；否则前端可能拿到
        URL 但浏览器打开后连不上 ws。
    """
    home = Path(openclaw_home).expanduser().resolve()

    # 1. 主路径：从 openclaw.json 直接拼 URL（无 subprocess，最快）
    url = _build_url_from_config(home)
    if url:
        return WebUrlResult(available=True, url=url)

    # 2. fallback：spawn dashboard。当配置缺 token 时可能仍能给出裸 URL，
    #    虽然没 token 浏览器进去会被挡，但至少不是 silent failure。
    if bin_path is None:
        bin_path = _sp.find_openclaw_bin(home)

    if bin_path is None or not Path(bin_path).exists():
        return WebUrlResult(
            available=False,
            reason="OpenClaw CLI 未安装且 openclaw.json 无 gateway.auth.token",
        )

    try:
        proc = _sp.run_openclaw(
            ["dashboard", "--no-open"],
            home,
            bin_path=bin_path,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        logger.warning("web_ui: dashboard spawn timed out after %ds", timeout)
        return WebUrlResult(
            available=False,
            reason=f"openclaw dashboard 命令超时（>{timeout}s）",
        )
    except (OSError, FileNotFoundError) as exc:
        logger.warning("web_ui: dashboard spawn failed: %s", exc)
        return WebUrlResult(
            available=False,
            reason=f"启动 openclaw dashboard 失败: {exc}",
        )

    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    url = _extract_url(combined)

    if proc.returncode != 0 and not url:
        first_line = (proc.stderr or proc.stdout or "").strip().splitlines()
        msg = first_line[0] if first_line else f"exit code {proc.returncode}"
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

    # fallback 路径拿到的 URL 不带 token，明确标记给前端
    logger.warning(
        "web_ui: 从 dashboard stdout 拿到的 URL 不带 token，浏览器打开后需手粘"
    )
    return WebUrlResult(available=True, url=url)


# ---------------------------------------------------------------------------
# Status 扩展：web_ui_available
# ---------------------------------------------------------------------------


def is_web_ui_available(openclaw_home: Path) -> bool:
    """轻量判断 Web UI 是否"可能可用"（用于 status 字段）。

    Lightweight check for ``openclaw.status.web_ui_available``: only verifies
    that the CLI binary exists. Does not spawn dashboard (avoid status latency).
    The actual URL retrieval happens in :func:`get_web_url`.
    """
    bin_path = _sp.find_openclaw_bin(Path(openclaw_home).expanduser().resolve())
    return bin_path is not None

