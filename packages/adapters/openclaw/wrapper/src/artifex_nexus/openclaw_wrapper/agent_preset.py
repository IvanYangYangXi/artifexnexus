"""
Artifex Nexus 默认 agent 预设：注入 / 幂等 / 重置。

Agent preset installer: renders the v1 template, upserts into
``openclaw.json`` ``agents.list[]`` via ``openclaw config patch --stdin``,
maintains a lock file with checksum for the "user-modified" idempotency rule.

关键设计决策（见 docs/specs/openclaw-agent-preset.md v2-post-spike）：
- **不直接改 openclaw.json 文本**：走 ``openclaw config patch --stdin``，让上游做 schema 校验
- **patch 数组陷阱**：``config patch`` 对数组是 *replace* 而非 *merge*，所以必须先
  ``config get agents.list`` → Python 端 upsert → 整个数组 patch 回去
- **lock 文件**：``state/artifex-nexus-preset.lock`` 存 ``{version, installedAt, checksum}``，
  bootstrap 时按 checksum 三态决定写/跳/警告；reset_default(force=True) 才允许覆盖
- **v3.0.0 改动**：删除 ``systemPromptOverride``，改用 OpenClaw 标准引导文件机制
  （workspace/AGENTS.md + IDENTITY.md + SOUL.md + USER.md），保留 Skills 列表 /
  memory 注入 / Heartbeat / Runtime 信息等自动组装能力
- **失败不阻塞 bootstrap**：注入失败仅 log.warn，不中断主链
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

try:
    from . import _subprocess as _sp
except ImportError:  # 兼容直接以脚本方式执行
    import _subprocess as _sp  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

PRESET_VERSION = "3.0.0"
"""当前预设版本（写入 lock 文件）。

- v2.0.0: 人格描述从 DCC 桥接扩展为全平台通用助理。
- v3.0.0: 删除 systemPromptOverride，改用 OpenClaw 标准引导文件机制
  （AGENTS.md / IDENTITY.md / SOUL.md / USER.md）+ identity 结构化字段。
  这样 OpenClaw 的 Skills 列表、memory 注入、Heartbeat、Runtime 信息等自动
  组装能力不会被 systemPromptOverride 完全替换。
"""

PRESET_ID = "artifex-nexus"
"""agents.list[].id。"""

CONFIG_TIMEOUT = 8.0
"""``openclaw config`` 子命令超时（秒）。"""

_ASSETS_DIR = Path(__file__).parent / "assets" / "agents"
"""模板资源目录。"""

_TEMPLATE_FILE = _ASSETS_DIR / "artifex-nexus.preset.json.tpl"


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class PresetStatus:
    """预设状态查询结果（``openclaw.agent_preset.status`` RPC）。"""

    installed: bool
    """lock 文件是否存在。"""
    version: Optional[str]
    """lock 文件记录的版本号。"""
    modified_by_user: bool
    """openclaw.json 中实际值与 lock checksum 是否不一致。"""
    lock_path: str
    """lock 文件绝对路径。"""

    def to_dict(self) -> dict:
        return {
            "installed": self.installed,
            "version": self.version,
            "modifiedByUser": self.modified_by_user,
            "lockPath": self.lock_path,
        }


@dataclass
class PresetInstallResult:
    """注入操作的返回值（内部 + RPC 两用）。"""

    success: bool
    action: str
    """``installed`` / ``skipped-same-checksum`` / ``skipped-user-modified`` /
    ``forced`` / ``failed``。"""
    version: str = PRESET_VERSION
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "action": self.action,
            "version": self.version,
            "error": self.error,
        }


# ---------------------------------------------------------------------------
# 路径工具
# ---------------------------------------------------------------------------


def lock_path_for(openclaw_home: Path) -> Path:
    """返回 lock 文件路径。"""
    return Path(openclaw_home).expanduser().resolve() / "state" / "artifex-nexus-preset.lock"


def workspace_for(openclaw_home: Path) -> Path:
    """返回 agent workspace 路径（与 bootstrap 的 DEFAULT_WORKSPACE 一致）。"""
    return Path(openclaw_home).expanduser().resolve() / "workspace"


# ---------------------------------------------------------------------------
# 模板渲染
# ---------------------------------------------------------------------------


def _read_template() -> str:
    """读取模板（assets 目录）。"""
    return _TEMPLATE_FILE.read_text(encoding="utf-8")


def render_v1_0_0(
    openclaw_home: Path,
    *,
    template_text: Optional[str] = None,
) -> dict:
    """渲染 v3.0.0 预设为 dict。

    Render the v3.0.0 preset template into a dict ready for ``agents.list[]``.

    v3.0.0 改动：不再注入 systemPromptOverride。人格/平台知识统一通过 OpenClaw
    标准引导文件机制（AGENTS.md / IDENTITY.md / SOUL.md / USER.md）注入，
    保留 OpenClaw 自动组装的 Skills 列表 / memory / Heartbeat / Runtime 等能力。

    Args:
        openclaw_home: 用于替换 ``{{OPENCLAW_WORKSPACE}}``。
        template_text: 测试可注入；为空读 assets 文件。

    Returns:
        预设 dict，可直接 upsert 到 ``agents.list[]``。

    Raises:
        ValueError: 渲染后非合法 JSON。
    """
    tpl = template_text if template_text is not None else _read_template()

    workspace = str(workspace_for(openclaw_home))

    # workspace 占位符位于已加引号的位置，用转义后的字符串体替换
    rendered = tpl.replace("{{OPENCLAW_WORKSPACE}}", _escape_for_json_string(workspace))

    try:
        preset = json.loads(rendered)
    except json.JSONDecodeError as exc:
        raise ValueError(f"模板渲染后 JSON 无效: {exc}\n--- rendered ---\n{rendered}") from exc

    # 兜底：渲染前后都强制保证关键字段
    if preset.get("id") != PRESET_ID:
        raise ValueError(f"模板 id 字段不为 {PRESET_ID!r}")

    return preset


def _escape_for_json_string(value: str) -> str:
    """把裸字符串转换为 JSON string body（不含外层引号）。

    Used for ``{{OPENCLAW_WORKSPACE}}``: template already provides surrounding
    quotes around the placeholder, so we only need the *escaped body*.
    """
    return json.dumps(value, ensure_ascii=False)[1:-1]


# ---------------------------------------------------------------------------
# checksum
# ---------------------------------------------------------------------------


def compute_checksum(preset: dict) -> str:
    """对预设 dict 算 sha256 checksum（key 排序后序列化，跨平台稳定）。"""
    body = json.dumps(preset, sort_keys=True, ensure_ascii=False)
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# upsert
# ---------------------------------------------------------------------------


def upsert_by_id(existing: list[dict], new_preset: dict) -> list[dict]:
    """在 ``agents.list`` 中按 id upsert 单个 preset。

    - 找到首个同 id 项 → 替换
    - 没有同 id → 追加到末尾
    - 多个同 id → 仅替换第一个，删除后续重复项（数据自愈）

    Args:
        existing: 上游 ``openclaw config get agents.list`` 返回的数组（可空 / None）。
        new_preset: 渲染好的预设 dict，必须含 ``id`` 字段。

    Returns:
        合并后的新数组（不修改入参）。
    """
    target_id = new_preset.get("id")
    if not target_id:
        raise ValueError("new_preset 必须包含非空 'id' 字段")

    out: list[dict] = []
    inserted = False
    for item in existing or []:
        if not isinstance(item, dict):
            out.append(item)
            continue
        if item.get("id") == target_id:
            if not inserted:
                out.append(new_preset)
                inserted = True
            # else: 重复同 id，丢弃（自愈）
            continue
        out.append(item)

    if not inserted:
        out.append(new_preset)

    return out


# ---------------------------------------------------------------------------
# openclaw config 子命令封装
# ---------------------------------------------------------------------------


def _build_env(openclaw_home: Path) -> dict[str, str]:
    """三件套 env 注入（统一走 helper）。"""
    return _sp.build_openclaw_env(openclaw_home)


def _run_config_get(
    openclaw_bin: Path,
    openclaw_home: Path,
    path: str,
    timeout: float = CONFIG_TIMEOUT,
) -> Any:
    """spawn ``openclaw config get <path> --json``，返回解析后的 JSON 值。

    若 path 不存在或上游版本不带 ``--json``，返回 ``None``。
    """
    try:
        proc = _sp.run_openclaw(
            ["config", "get", path, "--json"],
            openclaw_home,
            bin_path=openclaw_bin,
            timeout=timeout,
        )
    except (subprocess.TimeoutExpired, OSError, FileNotFoundError) as exc:
        logger.warning("openclaw config get %s 失败: %s", path, exc)
        return None

    if proc.returncode != 0:
        # 路径不存在 / 字段未配置都会非零退出，按 None 处理（caller 当作空数组）
        logger.debug(
            "openclaw config get %s exit=%s stderr=%s",
            path,
            proc.returncode,
            (proc.stderr or "").strip(),
        )
        return None

    out = (proc.stdout or "").strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        logger.warning("openclaw config get %s 返回非 JSON: %r", path, out[:200])
        return None


def _run_config_patch(
    openclaw_bin: Path,
    openclaw_home: Path,
    patch: dict,
    timeout: float = CONFIG_TIMEOUT,
) -> bool:
    """spawn ``openclaw config patch --stdin``，stdin 喂 patch JSON。

    Returns:
        True 当 returncode == 0。
    """
    try:
        proc = _sp.run_openclaw(
            ["config", "patch", "--stdin"],
            openclaw_home,
            bin_path=openclaw_bin,
            timeout=timeout,
            input=json.dumps(patch, ensure_ascii=False),
        )
    except (subprocess.TimeoutExpired, OSError, FileNotFoundError) as exc:
        logger.warning("openclaw config patch 失败: %s", exc)
        return False

    if proc.returncode != 0:
        logger.warning(
            "openclaw config patch exit=%s stderr=%s",
            proc.returncode,
            (proc.stderr or "").strip(),
        )
        return False
    return True


# 测试可注入的两个回调（默认走子进程实现）
ConfigGetFn = Callable[[Path, Path, str], Any]
ConfigPatchFn = Callable[[Path, Path, dict], bool]


# ---------------------------------------------------------------------------
# lock 文件 io
# ---------------------------------------------------------------------------


def read_lock(openclaw_home: Path) -> Optional[dict]:
    """读 lock 文件；不存在或破损返回 None。"""
    p = lock_path_for(openclaw_home)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_lock(openclaw_home: Path, version: str, checksum: str) -> Path:
    """写 lock 文件，返回路径。"""
    p = lock_path_for(openclaw_home)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": version,
        "installedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "checksum": checksum,
    }
    p.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# "用户是否改过" 判定
# ---------------------------------------------------------------------------


def is_modified_by_user(
    openclaw_bin: Path,
    openclaw_home: Path,
    lock: dict,
    *,
    config_get_fn: Optional[ConfigGetFn] = None,
) -> bool:
    """对比 openclaw.json 实际值与 lock.checksum；不一致 → 用户改过。

    用户**删除**预设算"未改"（返回 False），让 bootstrap 重新注入。
    """
    getter: ConfigGetFn = config_get_fn or _run_config_get
    current = getter(openclaw_bin, openclaw_home, "agents.list")
    if not isinstance(current, list):
        return False
    found = next((a for a in current if isinstance(a, dict) and a.get("id") == PRESET_ID), None)
    if not found:
        return False
    return compute_checksum(found) != lock.get("checksum")


# ---------------------------------------------------------------------------
# install / reset 主流程
# ---------------------------------------------------------------------------


def install_default_preset(
    openclaw_bin: Path,
    openclaw_home: Path,
    *,
    force: bool = False,
    config_get_fn: Optional[ConfigGetFn] = None,
    config_patch_fn: Optional[ConfigPatchFn] = None,
) -> PresetInstallResult:
    """注入 Artifex Nexus 默认 agent 预设（幂等）。

    See docs/specs/openclaw-agent-preset.md §3.1 for the algorithm.

    Args:
        openclaw_bin: openclaw 可执行文件路径。
        openclaw_home: OPENCLAW_HOME 路径。
        force: True → 跳过用户改动检测，强制覆盖（reset_default 用）。
        config_get_fn / config_patch_fn: 测试注入；默认走 subprocess。

    Returns:
        PresetInstallResult，含 action 标签，便于 RPC / 日志区分。
    """
    getter: ConfigGetFn = config_get_fn or _run_config_get
    patcher: ConfigPatchFn = config_patch_fn or _run_config_patch

    # 1. 渲染 + checksum
    try:
        preset = render_v1_0_0(openclaw_home)
    except (OSError, ValueError) as exc:
        return PresetInstallResult(success=False, action="failed", error=f"渲染模板失败: {exc}")

    new_checksum = compute_checksum(preset)

    # 2. 幂等检查
    lock = read_lock(openclaw_home)
    if lock and not force:
        if lock.get("version") == PRESET_VERSION and lock.get("checksum") == new_checksum:
            # checksum 命中 → 还要确认上游配置里实际存在（防御：用户可能手动 delete）
            current = getter(openclaw_bin, openclaw_home, "agents.list")
            present = isinstance(current, list) and any(
                isinstance(a, dict) and a.get("id") == PRESET_ID for a in current
            )
            if present:
                return PresetInstallResult(success=True, action="skipped-same-checksum")
            # 用户删了 → 重新注入

        if is_modified_by_user(openclaw_bin, openclaw_home, lock, config_get_fn=getter):
            logger.warning("用户已自定义 Artifex Nexus preset，跳过更新（reset_default(force=True) 可强制覆盖）")
            return PresetInstallResult(success=True, action="skipped-user-modified")

    # 3. 读现有 list → 合并
    existing = getter(openclaw_bin, openclaw_home, "agents.list")
    if existing is None:
        existing = []
    if not isinstance(existing, list):
        return PresetInstallResult(
            success=False,
            action="failed",
            error=f"agents.list 期望数组，实际类型: {type(existing).__name__}",
        )
    merged = upsert_by_id(existing, preset)

    # 4. patch 写入
    patch_payload = {"agents": {"list": merged}}
    if not patcher(openclaw_bin, openclaw_home, patch_payload):
        return PresetInstallResult(success=False, action="failed", error="openclaw config patch 失败")

    # 5. 写 lock
    try:
        write_lock(openclaw_home, PRESET_VERSION, new_checksum)
    except OSError as exc:
        return PresetInstallResult(success=False, action="failed", error=f"写 lock 失败: {exc}")

    return PresetInstallResult(
        success=True,
        action="forced" if force else "installed",
    )


def reset_default(
    openclaw_bin: Path,
    openclaw_home: Path,
    *,
    force: bool = True,
    config_get_fn: Optional[ConfigGetFn] = None,
    config_patch_fn: Optional[ConfigPatchFn] = None,
) -> PresetInstallResult:
    """重置预设（设置面板"重置默认 agent 预设"按钮调用）。

    默认 force=True，跳过"用户改过"检测，强制覆盖。
    """
    return install_default_preset(
        openclaw_bin,
        openclaw_home,
        force=force,
        config_get_fn=config_get_fn,
        config_patch_fn=config_patch_fn,
    )


def get_status(
    openclaw_bin: Path,
    openclaw_home: Path,
    *,
    config_get_fn: Optional[ConfigGetFn] = None,
) -> PresetStatus:
    """探测预设当前状态（``openclaw.agent_preset.status`` RPC）。"""
    lock = read_lock(openclaw_home)
    lock_p = str(lock_path_for(openclaw_home))

    if not lock:
        return PresetStatus(
            installed=False, version=None, modified_by_user=False, lock_path=lock_p
        )

    modified = is_modified_by_user(openclaw_bin, openclaw_home, lock, config_get_fn=config_get_fn)
    return PresetStatus(
        installed=True,
        version=lock.get("version"),
        modified_by_user=modified,
        lock_path=lock_p,
    )
