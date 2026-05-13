"""
OpenClaw CLI spawn 统一封装（ADR 0007）。

Centralized helpers for spawning the upstream ``openclaw`` CLI on all platforms,
with special handling for Windows (npm shell wrappers, ``CREATE_NO_WINDOW`` to
suppress console flashes, UTF-8 decoding to avoid GBK ``UnicodeDecodeError``).

任何 wrapper 内 spawn ``openclaw`` 子进程的代码都必须经此模块；禁止散落
``subprocess.Popen([str(bin), …])`` 不带 ``CREATE_NO_WINDOW`` 的写法。

设计决策：see ``docs/decisions/0007-windows-openclaw-shell-spawn.md``。

主要导出：

- :func:`is_windows` — 平台判定（独立小工具，便于单测 monkeypatch）
- :func:`find_openclaw_bin` — 按平台正确顺序查找可执行文件
- :func:`build_openclaw_env` — 构造三件套 + ``OPENCLAW_NO_ONBOARD=1`` 环境
- :func:`popen_kwargs` — 返回 ``Popen`` / ``run`` 共用的 kwargs（含 Win flags）
- :func:`run_openclaw` — ``subprocess.run`` 简化封装；返回 ``CompletedProcess``
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

# Windows: subprocess.CREATE_NO_WINDOW 隐藏黑窗（仅 Win 平台可用）
# Windows: subprocess.CREATE_NEW_PROCESS_GROUP 用于 taskkill /T 杀进程树
_WIN_CREATE_NO_WINDOW = 0x08000000
_WIN_CREATE_NEW_PROCESS_GROUP = 0x00000200


# ---------------------------------------------------------------------------
# 平台判定
# ---------------------------------------------------------------------------


def is_windows() -> bool:
    """当前是否运行在 Windows 上。

    Whether the current platform is Windows. Standalone for easy monkeypatching
    in tests.
    """
    return platform.system() == "Windows"


# ---------------------------------------------------------------------------
# 可执行文件查找
# ---------------------------------------------------------------------------

# Windows 候选顺序：优先 ``.cmd``，避免命中 npm 同时落下的无后缀 sh 脚本
# （sh 脚本在 Win 上 spawn 会触发 ``[WinError 193] %1 不是有效的 Win32 应用程序``）
_WIN_CANDIDATES = (
    "openclaw.cmd",
    "bin/openclaw.cmd",
    "openclaw.ps1",
    "openclaw",
    "bin/openclaw",
)

# POSIX 候选顺序：优先 ``bin/openclaw``（npm 的 unix wrapper 默认位置），
# 兜底根目录的 sh 脚本
_POSIX_CANDIDATES = (
    "bin/openclaw",
    "openclaw",
    "bin/openclaw.cmd",
    "openclaw.cmd",
)


def _candidates_for_vdir(vdir: Path) -> Iterable[Path]:
    """按平台返回某 version 目录下的候选可执行文件列表（按优先级）。"""
    rels = _WIN_CANDIDATES if is_windows() else _POSIX_CANDIDATES
    for rel in rels:
        yield vdir / rel


def _check_vdir(vdir: Path) -> Optional[Path]:
    """在 version 目录中按候选清单找首个 exists 的可执行文件。"""
    for c in _candidates_for_vdir(vdir):
        if c.exists():
            return c
    return None


def find_openclaw_bin(openclaw_home: Path) -> Optional[Path]:
    """查找 openclaw 可执行文件。

    Locate the ``openclaw`` executable inside ``<openclaw_home>/cli/``.

    Resolution order:

    1. ``cli/current`` symlink（macOS/Linux 主用）
    2. ``cli/current.txt`` 指针文件（Windows 兜底，因 symlink 需开发者模式）
    3. ``cli/`` 下所有版本目录倒序（最新在前），逐个尝试

    Args:
        openclaw_home: ``OPENCLAW_HOME`` 路径（隔离根）。

    Returns:
        命中的 ``Path``；全部 miss 时返回 ``None``。
    """
    home = Path(openclaw_home).expanduser().resolve()
    cli_dir = home / "cli"
    logger.debug("find_openclaw_bin: searching in %s", cli_dir)
    if not cli_dir.exists():
        logger.debug("find_openclaw_bin: cli_dir does not exist: %s", cli_dir)
        return None

    # 1. cli/current symlink
    current_link = cli_dir / "current"
    logger.debug("find_openclaw_bin: trying symlink %s", current_link)
    if current_link.is_symlink():
        try:
            resolved = current_link.resolve()
            result = _check_vdir(resolved)
            if result:
                logger.debug("find_openclaw_bin: found via symlink: %s", result)
                return result
        except OSError as e:
            logger.debug("find_openclaw_bin: symlink resolve failed: %s", e)

    # 2. cli/current.txt 指针文件（Win 兜底）
    current_txt = cli_dir / "current.txt"
    logger.debug("find_openclaw_bin: trying current.txt %s", current_txt)
    if current_txt.exists():
        try:
            version_dir_name = current_txt.read_text(encoding="utf-8").strip()
            if version_dir_name:
                result = _check_vdir(cli_dir / version_dir_name)
                if result:
                    logger.debug("find_openclaw_bin: found via current.txt: %s", result)
                    return result
        except OSError as e:
            logger.debug("find_openclaw_bin: current.txt read failed: %s", e)

    # 3. 扫描 cli/ 下所有版本目录，倒序找首个可用
    logger.debug("find_openclaw_bin: scanning cli/ directories")
    try:
        versions = sorted(
            [d for d in cli_dir.iterdir() if d.is_dir() and d.name != "current"],
            reverse=True,
        )
    except OSError as e:
        logger.debug("find_openclaw_bin: cli_dir scan failed: %s", e)
        return None
    logger.debug("find_openclaw_bin: scanning %d version dirs", len(versions))
    for vdir in versions:
        result = _check_vdir(vdir)
        if result:
            logger.debug("find_openclaw_bin: found via scan: %s", result)
            return result

    logger.debug("find_openclaw_bin: not found")
    return None


# ---------------------------------------------------------------------------
# 环境变量三件套
# ---------------------------------------------------------------------------


def build_openclaw_env(openclaw_home: Path) -> dict[str, str]:
    """构造注入隔离 ``OPENCLAW_HOME`` 的子进程环境。

    Build the env dict for any ``openclaw`` subprocess: starts from
    ``os.environ`` then injects the canonical OpenClaw triplet plus
    ``OPENCLAW_NO_ONBOARD=1`` to skip the interactive onboarding prompt.

    See `[[docs/specs/openclaw-wrapper-runtime#3-隔离策略-强约束]]`.
    """
    env = os.environ.copy()
    home = Path(openclaw_home).expanduser().resolve()
    env["OPENCLAW_HOME"] = str(home)
    env["OPENCLAW_STATE_DIR"] = str(home / "state")
    env["OPENCLAW_CONFIG_PATH"] = str(home / "openclaw.json")
    env["OPENCLAW_NO_ONBOARD"] = "1"
    return env


# ---------------------------------------------------------------------------
# subprocess kwargs 工厂
# ---------------------------------------------------------------------------


def popen_kwargs(
    *,
    win_no_window: bool = True,
    win_new_process_group: bool = False,
) -> dict[str, Any]:
    """返回 ``Popen`` / ``run`` 共用的平台敏感 kwargs。

    Build the platform-aware kwargs shared by both :class:`subprocess.Popen`
    and :func:`subprocess.run` for spawning ``openclaw`` CLIs.

    Always includes:
    - ``text=True`` + ``encoding="utf-8"`` + ``errors="replace"``：
      统一 UTF-8 解码，规避 Windows GBK 控制台的 ``UnicodeDecodeError``。

    On Windows additionally:
    - ``creationflags=CREATE_NO_WINDOW`` 当 ``win_no_window=True``：
      避免每次 spawn 弹黑色 cmd 窗口。
    - ``creationflags |= CREATE_NEW_PROCESS_GROUP`` 当 ``win_new_process_group=True``：
      仅长进程（如 gateway）需要，便于 ``taskkill /T`` 杀进程树。

    Args:
        win_no_window: Windows 上是否启用 ``CREATE_NO_WINDOW``（默认 ``True``）。
        win_new_process_group: Windows 上是否启用 ``CREATE_NEW_PROCESS_GROUP``。

    Returns:
        kwargs dict，可直接 ``**`` 传入 ``Popen`` / ``run``。
    """
    kwargs: dict[str, Any] = {
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if is_windows():
        flags = 0
        if win_no_window:
            flags |= _WIN_CREATE_NO_WINDOW
        if win_new_process_group:
            flags |= _WIN_CREATE_NEW_PROCESS_GROUP
        if flags:
            kwargs["creationflags"] = flags
    return kwargs


# ---------------------------------------------------------------------------
# run_openclaw 简化封装
# ---------------------------------------------------------------------------


def run_openclaw(
    cli_args: list[str],
    openclaw_home: Path,
    *,
    bin_path: Optional[Path] = None,
    timeout: float = 10.0,
    input: Optional[str] = None,
    win_no_window: bool = True,
) -> subprocess.CompletedProcess:
    """spawn ``openclaw <cli_args>`` 并等待完成。

    Run ``openclaw`` once and wait for completion. This is the **only** way
    short-lived ``config get`` / ``config patch`` / ``infer`` / ``dashboard`` /
    ``doctor`` calls inside this package should be invoked.

    Args:
        cli_args: 不含 ``openclaw`` 本身的参数列表，例如
            ``["config", "get", "models.providers", "--json"]``。
        openclaw_home: ``OPENCLAW_HOME`` 路径，自动注入三件套 env。
        bin_path: 可执行文件路径；为 ``None`` 时自动 :func:`find_openclaw_bin`。
        timeout: 子进程总超时（秒）。
        input: 喂给 stdin 的字符串（``config patch --stdin`` 用）。
        win_no_window: Win 上是否隐藏黑窗，默认 ``True``。

    Returns:
        :class:`subprocess.CompletedProcess`（``text=True`` 模式下 ``stdout`` /
        ``stderr`` 是 str；UTF-8 解码失败的字节用 ``\\ufffd`` 替换）。

    Raises:
        FileNotFoundError: ``openclaw`` 可执行文件不存在。
        subprocess.TimeoutExpired: 超时。
        OSError: 其它 spawn 失败（caller 通常需要 catch 并降级）。
    """
    home = Path(openclaw_home).expanduser().resolve()
    bp = bin_path or find_openclaw_bin(home)
    if bp is None:
        raise FileNotFoundError(
            f"openclaw 可执行文件未找到（OPENCLAW_HOME={home}）。请先安装 OpenClaw。"
        )

    cmd = [str(bp), *cli_args]
    kwargs = popen_kwargs(win_no_window=win_no_window)

    logger.debug("run_openclaw: cmd=%s timeout=%.1fs", " ".join(cmd), timeout)
    return subprocess.run(  # noqa: S603 — args 完全由本仓库代码构造，无 shell 注入
        cmd,
        capture_output=True,
        env=build_openclaw_env(home),
        timeout=timeout,
        check=False,
        input=input,
        **kwargs,
    )
