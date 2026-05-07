"""
薄壳安装器：调用上游 install-cli.sh / install.ps1 安装 OpenClaw 到隔离 prefix。

Thin-wrapper installer: spawns upstream install-cli.sh (Unix) or install.ps1 (Windows)
to install OpenClaw into an isolated prefix directory. Parses NDJSON progress events.

关键设计决策（详见 docs/specs/openclaw-upstream-survey.md §10）：
- Unix: curl install-cli.sh | bash -s -- --prefix <path> --version <ver> --no-onboard --json
- Windows: install.ps1 无 --prefix 参数，改用 npm install -g --prefix <path> 模拟
- 三件套 env 注入：OPENCLAW_HOME / OPENCLAW_NO_ONBOARD=1
  （S2 写 openclaw.json 之前，CONFIG_PATH 暂不传）
"""

from __future__ import annotations

import json
import logging
import os
import platform
import shlex
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DEFAULT_VERSION = "v2026.5.4"
"""默认 OpenClaw 版本（M1 锁定）。"""

INSTALL_CLI_URL = "https://openclaw.ai/install-cli.sh"
"""Unix 安装脚本 URL。"""

INSTALL_PS1_URL = "https://openclaw.ai/install.ps1"
"""Windows 安装脚本 URL。"""

# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class ProgressEvent:
    """安装进度事件（从 NDJSON 解析）。

    Progress event parsed from upstream NDJSON stream.
    """

    phase: str = ""
    """阶段：download / install / verify / complete / error。"""
    name: str = ""
    """当前组件名（如 node-v22.22.0 / openclaw）。"""
    percent: int = 0
    """进度百分比 0–100。"""
    message: str = ""
    """人类可读消息。"""
    raw: dict = field(default_factory=dict)
    """原始 NDJSON 对象（保留未识别字段）。"""


@dataclass
class InstallResult:
    """安装结果。

    Result of an install operation.
    """

    success: bool
    """是否成功。"""
    version: str = ""
    """安装的版本号。"""
    prefix: Path = field(default_factory=Path)
    """安装目标路径。"""
    bin_path: Optional[Path] = None
    """openclaw 可执行文件路径。"""
    error_code: str = ""
    """错误码：E_NETWORK / E_DISK_FULL / E_PERMISSION / E_UNKNOWN。"""
    error_message: str = ""
    """错误详情。"""


# ---------------------------------------------------------------------------
# 平台检测
# ---------------------------------------------------------------------------


def _is_windows() -> bool:
    return platform.system() == "Windows"


def _is_wsl() -> bool:
    """检测是否在 WSL 中运行（Linux 内核 + Microsoft 标记）。"""
    if platform.system() != "Linux":
        return False
    try:
        with open("/proc/version", "r") as f:
            return "microsoft" in f.read().lower()
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Unix: install-cli.sh
# ---------------------------------------------------------------------------


def _build_unix_cmd(prefix: Path, version: str) -> list[str]:
    """构建 Unix 安装命令。

    等价于：
      curl -fsSL ... | bash -s -- --prefix <prefix> --version <ver> --no-onboard --json
    """
    return [
        "bash",
        "-s",
        "--",
        "--prefix",
        str(prefix),
        "--version",
        version,
        "--no-onboard",
        "--json",
    ]


def _install_unix(
    prefix: Path, version: str, extra_env: dict[str, str] | None = None
) -> Iterator[ProgressEvent]:
    """Unix 平台：curl install-cli.sh | bash，逐行解析 NDJSON。"""
    env = os.environ.copy()
    env["OPENCLAW_NO_ONBOARD"] = "1"
    if extra_env:
        env.update(extra_env)

    bash_cmd = _build_unix_cmd(prefix, version)

    # 启动 curl | bash 管道
    curl_proc = subprocess.Popen(
        [
            "curl",
            "-fsSL",
            "--proto",
            "=https",
            "--tlsv1.2",
            INSTALL_CLI_URL,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    bash_proc = subprocess.Popen(
        bash_cmd,
        stdin=curl_proc.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True,
    )

    # 关闭 curl 的 stdout（已传给 bash）
    if curl_proc.stdout:
        curl_proc.stdout.close()

    # 逐行读取 bash 的 stdout，解析 NDJSON
    assert bash_proc.stdout is not None
    for line in bash_proc.stdout:
        line = line.strip()
        if not line:
            continue
        event = _parse_ndjson_line(line)
        if event:
            yield event

    # 等待进程结束
    bash_rc = bash_proc.wait()
    curl_rc = curl_proc.wait()

    # 收集 stderr
    stderr_data = ""
    if bash_proc.stderr:
        stderr_data = bash_proc.stderr.read()

    if bash_rc != 0 or curl_rc != 0:
        yield ProgressEvent(
            phase="error",
            message=f"安装失败 (curl={curl_rc}, bash={bash_rc}): {stderr_data[:500]}",
        )


# ---------------------------------------------------------------------------
# Windows: install.ps1（薄壳模拟）
# ---------------------------------------------------------------------------


def _install_windows(
    prefix: Path, version: str, extra_env: dict[str, str] | None = None
) -> Iterator[ProgressEvent]:
    """Windows 平台：使用 npm install -g --prefix 模拟 install-cli.sh 行为。

    install.ps1 上游脚本无 --prefix 参数（TBD T5 实测确认），因此直接调用
    npm install -g --prefix <prefix> openclaw@<version>，然后创建 bin/openclaw.cmd wrapper。

    前置条件：系统需已安装 Node.js（npm 可用）。如果不可用，报 E_NODE_MISSING。
    """
    # 检查 npm 是否可用
    npm_path = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm_path:
        yield ProgressEvent(
            phase="error",
            message="未找到 npm。请先安装 Node.js（https://nodejs.org）或使用 WSL。",
        )
        return

    env = os.environ.copy()
    env["OPENCLAW_NO_ONBOARD"] = "1"
    env["SHARP_IGNORE_GLOBAL_LIBVIPS"] = "1"
    env["NODE_LLAMA_CPP_SKIP_DOWNLOAD"] = "1"
    # 抑制 npm 日志噪音
    env["NPM_CONFIG_LOGLEVEL"] = "error"
    env["NPM_CONFIG_UPDATE_NOTIFIER"] = "false"
    env["NPM_CONFIG_FUND"] = "false"
    env["NPM_CONFIG_AUDIT"] = "false"
    if extra_env:
        env.update(extra_env)

    # 确保 prefix 目录存在
    prefix.mkdir(parents=True, exist_ok=True)

    install_spec = f"openclaw@{version}"

    yield ProgressEvent(
        phase="download",
        name="openclaw",
        percent=0,
        message=f"开始安装 {install_spec} 到 {prefix}...",
    )

    # 执行 npm install -g --prefix <prefix> openclaw@<version>
    try:
        # Win 上 npm 是 .cmd shell wrapper，必须 shell=True；
        # 同时加 CREATE_NO_WINDOW 避免每次安装弹黑窗（Tauri 桌面应用观感）
        _is_win = sys.platform == "win32"
        _popen_kwargs: dict = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "env": env,
            "text": True,
            "shell": _is_win,  # Win 上才需要 shell=True 找 npm.cmd
        }
        if _is_win:
            _popen_kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
        proc = subprocess.Popen(
            [npm_path, "install", "-g", "--prefix", str(prefix), install_spec],
            **_popen_kwargs,
        )
    except OSError as e:
        yield ProgressEvent(
            phase="error",
            message=f"无法启动 npm: {e}",
        )
        return

    # 逐行读取输出，尝试解析进度
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        # npm 输出不是 NDJSON，我们按文本行转发
        event = _parse_ndjson_line(line)
        if event:
            yield event
        else:
            # 非 JSON 行，作为日志消息转发
            yield ProgressEvent(
                phase="install",
                name="npm",
                percent=-1,
                message=line[:200],
            )

    rc = proc.wait()

    if rc != 0:
        yield ProgressEvent(
            phase="error",
            message=f"npm install 失败 (exit={rc})",
        )
        return

    # 创建 bin/openclaw.cmd wrapper（模拟 install-cli.sh 的行为）
    _create_windows_wrapper(prefix)

    yield ProgressEvent(
        phase="complete",
        name="openclaw",
        percent=100,
        message=f"OpenClaw {version} 安装完成",
    )


def _create_windows_wrapper(prefix: Path) -> None:
    """创建 Windows 下的 openclaw.cmd wrapper 脚本。

    上游 install-cli.sh 在 Unix 上创建 $PREFIX/bin/openclaw wrapper，
    Windows 上我们创建 %PREFIX%/bin/openclaw.cmd。
    """
    bin_dir = prefix / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)

    # npm 全局安装后，可执行文件在 prefix 下
    # 查找 openclaw 的实际入口
    wrapper_path = bin_dir / "openclaw.cmd"

    # 简单 wrapper：直接调用 npm 全局安装的 openclaw
    # 实际路径：<prefix>/node_modules/.bin/openclaw.cmd
    openclaw_cmd = prefix / "openclaw.cmd"
    if openclaw_cmd.exists():
        # npm 已在 prefix 根目录创建了 openclaw.cmd
        pass
    else:
        # 手动创建 wrapper
        node_modules_bin = prefix / "node_modules" / ".bin"
        src_cmd = node_modules_bin / "openclaw.cmd"
        if src_cmd.exists():
            wrapper_content = (
                f'@echo off\n'
                f'"{src_cmd}" %*\n'
            )
            wrapper_path.write_text(wrapper_content, encoding="utf-8")
        else:
            # fallback: 用 npx
            wrapper_content = (
                f'@echo off\n'
                f'node "{prefix}/node_modules/openclaw/dist/entry.js" %*\n'
            )
            wrapper_path.write_text(wrapper_content, encoding="utf-8")


# ---------------------------------------------------------------------------
# NDJSON 解析
# ---------------------------------------------------------------------------


def _parse_ndjson_line(line: str) -> Optional[ProgressEvent]:
    """解析单行 NDJSON，返回 ProgressEvent 或 None（非 JSON 行）。

    Parse a single NDJSON line into a ProgressEvent. Returns None for non-JSON lines.

    上游 NDJSON 字段（实测核对，TBD T1 补充完整 schema）：
      {"event":"download","name":"node-v22.22.0","percent":42}
      {"event":"step","name":"npm-install","status":"ok"}
      {"event":"complete","version":"v2026.5.4"}
    """
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return None

    event_type = data.get("event", "")
    name = data.get("name", "")
    percent = data.get("percent", -1)
    message = data.get("message", data.get("status", ""))

    # 映射上游事件类型到统一 phase
    phase_map = {
        "download": "download",
        "extract": "install",
        "step": "install",
        "npm-install": "install",
        "verify": "verify",
        "complete": "complete",
        "error": "error",
    }
    phase = phase_map.get(event_type, event_type)

    return ProgressEvent(
        phase=phase,
        name=name,
        percent=percent if isinstance(percent, int) else -1,
        message=message,
        raw=data,
    )


# ---------------------------------------------------------------------------
# 公共 API
# ---------------------------------------------------------------------------


def install_openclaw(
    version: str = DEFAULT_VERSION,
    prefix: Path | str | None = None,
    openclaw_home: Path | str | None = None,
    extra_env: dict[str, str] | None = None,
) -> Iterator[ProgressEvent]:
    """安装 OpenClaw 到隔离 prefix（薄壳模式）。

    Install OpenClaw to an isolated prefix directory using upstream install scripts.

    Args:
        version: OpenClaw 版本号，默认 v2026.5.4。
        prefix: 安装目标路径。如不指定，自动推导为
                <openclaw_home>/cli/<version>/。
        openclaw_home: OPENCLAW_HOME 路径，默认 ~/.artifexnexus/.openclaw/。
        extra_env: 额外环境变量（如 HTTPS_PROXY）。

    Yields:
        ProgressEvent: 安装进度事件流。
    """
    # 路径推导
    if openclaw_home is None:
        openclaw_home = Path.home() / ".artifexnexus" / ".openclaw"
    elif isinstance(openclaw_home, str):
        openclaw_home = Path(openclaw_home).expanduser().resolve()

    if prefix is None:
        prefix = Path(openclaw_home) / "cli" / version
    elif isinstance(prefix, str):
        prefix = Path(prefix).expanduser().resolve()

    prefix = Path(prefix)

    # 幂等检查：如果 bin/openclaw 已存在且版本匹配，跳过安装
    bin_path = _find_openclaw_bin(prefix)
    if bin_path and _check_version_match(bin_path, version):
        yield ProgressEvent(
            phase="complete",
            name="openclaw",
            percent=100,
            message=f"OpenClaw {version} 已安装（幂等跳过）",
        )
        return

    # 确保父目录存在
    prefix.parent.mkdir(parents=True, exist_ok=True)

    # 注入 OPENCLAW_HOME 环境变量
    env = dict(extra_env or {})
    env.setdefault("OPENCLAW_HOME", str(openclaw_home))

    # 平台分发
    if _is_windows() and not _is_wsl():
        yield from _install_windows(prefix, version, env)
    else:
        yield from _install_unix(prefix, version, env)


def _find_openclaw_bin(prefix: Path) -> Optional[Path]:
    """查找 openclaw 可执行文件。"""
    if _is_windows():
        candidates = [
            prefix / "bin" / "openclaw.cmd",
            prefix / "openclaw.cmd",
            prefix / "node_modules" / ".bin" / "openclaw.cmd",
        ]
    else:
        candidates = [
            prefix / "bin" / "openclaw",
        ]
    for p in candidates:
        if p.exists():
            return p
    return None


def _check_version_match(bin_path: Path, expected_version: str) -> bool:
    """检查已安装的 openclaw 版本是否匹配。"""
    try:
        result = subprocess.run(
            [str(bin_path), "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            shell=_is_windows(),
        )
        output = result.stdout.strip()
        return expected_version in output
    except Exception:
        return False


def get_install_result(
    events: list[ProgressEvent], prefix: Path, version: str
) -> InstallResult:
    """从事件列表汇总安装结果。

    Aggregate install result from a list of progress events.
    """
    has_error = any(e.phase == "error" for e in events)
    has_complete = any(e.phase == "complete" for e in events)

    if has_error:
        error_event = next((e for e in events if e.phase == "error"), None)
        msg = error_event.message if error_event else "未知错误"

        # 错误分类
        if "network" in msg.lower() or "curl" in msg.lower() or "ENOTFOUND" in msg:
            code = "E_NETWORK"
        elif "disk" in msg.lower() or "ENOSPC" in msg.lower() or "space" in msg.lower():
            code = "E_DISK_FULL"
        elif "permission" in msg.lower() or "EACCES" in msg.lower() or "EPERM" in msg:
            code = "E_PERMISSION"
        else:
            code = "E_UNKNOWN"

        return InstallResult(
            success=False,
            version=version,
            prefix=prefix,
            error_code=code,
            error_message=msg,
        )

    bin_path = _find_openclaw_bin(prefix)

    return InstallResult(
        success=has_complete,
        version=version,
        prefix=prefix,
        bin_path=bin_path,
    )
