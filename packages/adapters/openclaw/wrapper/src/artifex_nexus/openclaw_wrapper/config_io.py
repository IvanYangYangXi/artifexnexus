"""
OpenClaw 配置 I/O：dump（读 + 脱敏）/ patch（透传 schema validate）/ test_provider。

Config I/O for the Settings Panel: dumps ``models.providers`` /
``auth.profiles`` / ``agents.defaults`` from OpenClaw's CLI, applies API key
masking, and patches updates back through ``openclaw config patch --stdin``.

关键设计决策（见 docs/specs/openclaw-settings-panel.md v2-post-spike）：
- **写必走官方 patch**：不读写 openclaw.json 文本，全部 spawn ``openclaw config patch --stdin``，
  让上游做 schema validate + atomic write
- **API Key 永不出 sidecar**：dump 返回前替成等长 ``*`` 串；patch 收到 ``*`` 串视为"用户未改"，
  从 payload 中剔除该字段
- **extras 降级落点**：上游不存在的字段（如 ``displayName`` / ``notes``）落
  ``state/artifex-nexus-extras.json`` 的 ``providerExtras`` / ``authExtras`` / ``modelExtras`` 节点
- **测试可注入**：所有 subprocess 行为都可以 ``config_get_fn`` / ``config_patch_fn`` mock
"""

from __future__ import annotations

import copy
import json
import logging
import os
import subprocess
import time
from dataclasses import dataclass, field
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

CONFIG_TIMEOUT = 8.0
"""``openclaw config get/patch`` 超时秒。"""

INFER_TIMEOUT = 15.0
"""``openclaw infer`` 测试连接超时秒。"""

API_KEY_MASK = "*"
"""脱敏字符。"""

API_KEY_MIN_MASK = 8
"""最短脱敏长度（防止猜测原 key 长度）。"""

# 已知会含 secret 的字段名（递归搜索时按这些名匹配，case-insensitive）
SECRET_FIELD_NAMES = frozenset(
    {
        "apikey",
        "api_key",
        "token",
        "accesstoken",
        "access_token",
        "secret",
        "secretkey",
        "secret_key",
        "password",
        "authorization",
    }
)


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class ConfigDump:
    """``openclaw.config.dump`` 返回值。

    Aggregated config snapshot for the Settings Panel. All secret-like fields
    are masked before this object leaves the sidecar.
    """

    providers: dict
    """``models.providers`` 节点（dict of provider_id → config）。"""
    auth_profiles: dict
    """``auth.profiles`` 节点（dict of profile_id → config，含脱敏后的 token）。"""
    auth_order: dict
    """``auth.order`` 节点（dict of provider_id → [profile_id, ...]）。"""
    agent_defaults: dict
    """``agents.defaults`` 节点（含 model / imageModel 等）。"""
    extras: dict = field(default_factory=dict)
    """wrapper 自维护的字段（``providerExtras`` / ``authExtras`` / ``modelExtras``）。"""

    def to_dict(self) -> dict:
        return {
            "providers": self.providers,
            "authProfiles": self.auth_profiles,
            "authOrder": self.auth_order,
            "agentDefaults": self.agent_defaults,
            "extras": self.extras,
        }


@dataclass
class PatchResult:
    """``openclaw.config.patch`` 返回值。"""

    success: bool
    validate_error: Optional[str] = None

    def to_dict(self) -> dict:
        return {"success": self.success, "validateError": self.validate_error}


@dataclass
class TestProviderResult:
    """``openclaw.config.test_provider`` 返回值。"""

    success: bool
    latency_ms: Optional[int] = None
    model_echo: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "latencyMs": self.latency_ms,
            "modelEcho": self.model_echo,
            "error": self.error,
        }


# ---------------------------------------------------------------------------
# Extras 文件 io
# ---------------------------------------------------------------------------


def extras_path_for(openclaw_home: Path) -> Path:
    """wrapper extras 文件路径（用于落上游 schema 不收的字段）。"""
    return Path(openclaw_home).expanduser().resolve() / "state" / "artifex-nexus-extras.json"


def read_extras(openclaw_home: Path) -> dict:
    """读 extras；不存在返回空 dict。"""
    p = extras_path_for(openclaw_home)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("读 extras 失败（按空处理）: %s", exc)
        return {}


def write_extras(openclaw_home: Path, extras: dict) -> Path:
    """写 extras，返回路径。"""
    p = extras_path_for(openclaw_home)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(extras, indent=2, ensure_ascii=False), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# 脱敏
# ---------------------------------------------------------------------------


def _mask_value(value: Any) -> Any:
    """把 secret 值替成等长 ``*`` 串，但短于 ``API_KEY_MIN_MASK`` 的拉长。"""
    if not isinstance(value, str):
        return value
    if not value:
        return value  # 空字符串保持空，便于前端区分"没填"和"填了"
    n = max(len(value), API_KEY_MIN_MASK)
    return API_KEY_MASK * n


def mask_secrets(payload: Any) -> Any:
    """递归脱敏：dict 中字段名命中 ``SECRET_FIELD_NAMES`` 的值替成 ``*`` 串。

    Recursively mask secret-looking fields. Returns a *new* structure; does not
    mutate input. Lists / nested dicts are walked.
    """
    if isinstance(payload, dict):
        out: dict = {}
        for k, v in payload.items():
            if isinstance(k, str) and k.lower().replace("-", "_") in SECRET_FIELD_NAMES:
                out[k] = _mask_value(v)
            else:
                out[k] = mask_secrets(v)
        return out
    if isinstance(payload, list):
        return [mask_secrets(x) for x in payload]
    return payload


def is_masked_value(value: Any) -> bool:
    """判断字符串是否是脱敏占位（全 ``*``，且长度 ≥ ``API_KEY_MIN_MASK``）。"""
    if not isinstance(value, str) or not value:
        return False
    return len(value) >= API_KEY_MIN_MASK and set(value) == {API_KEY_MASK}


def strip_unchanged_secrets(patch: Any) -> Any:
    """从 patch payload 里剔除"用户未改的 secret 字段"（值仍是 ``*`` 串）。

    Recursively walk and remove any secret field whose value is still a mask
    placeholder. This prevents writing the masked string back to OpenClaw,
    while leaving the existing secret untouched (patch 中缺字段 = 不变)。

    与 mask_secrets 不同：本函数 *删字段*，而不是替值。
    """
    if isinstance(patch, dict):
        out: dict = {}
        for k, v in patch.items():
            if (
                isinstance(k, str)
                and k.lower().replace("-", "_") in SECRET_FIELD_NAMES
                and is_masked_value(v)
            ):
                # 跳过：相当于 patch 不含该字段，OpenClaw 保留旧值
                continue
            out[k] = strip_unchanged_secrets(v)
        return out
    if isinstance(patch, list):
        return [strip_unchanged_secrets(x) for x in patch]
    return patch


# ---------------------------------------------------------------------------
# subprocess 封装
# ---------------------------------------------------------------------------


def _build_env(openclaw_home: Path) -> dict[str, str]:
    """三件套 env（与 agent_preset / web_ui 一致；现统一走 helper）。"""
    return _sp.build_openclaw_env(openclaw_home)


def _run_config_get(
    openclaw_bin: Path,
    openclaw_home: Path,
    path: str,
    timeout: float = CONFIG_TIMEOUT,
) -> Any:
    """``openclaw config get <path> --json``；失败返回 None（路径不存在亦如此）。"""
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
        logger.warning("openclaw config get %s 返回非 JSON", path)
        return None


def _run_config_patch(
    openclaw_bin: Path,
    openclaw_home: Path,
    patch: dict,
    timeout: float = CONFIG_TIMEOUT,
) -> tuple[bool, Optional[str]]:
    """``openclaw config patch --stdin --strict-json``；返回 ``(success, error?)``。

    error 含 stderr 前 500 字符（剔除可能的 secret 行）。
    """
    try:
        proc = _sp.run_openclaw(
            ["config", "patch", "--stdin", "--strict-json"],
            openclaw_home,
            bin_path=openclaw_bin,
            timeout=timeout,
            input=json.dumps(patch, ensure_ascii=False),
        )
    except (subprocess.TimeoutExpired, OSError, FileNotFoundError) as exc:
        return False, f"调用 openclaw config patch 失败: {exc}"

    if proc.returncode != 0:
        err = (proc.stderr or "").strip()[:500]
        return False, err or f"openclaw config patch exit={proc.returncode}"
    return True, None


# 测试可注入回调
ConfigGetFn = Callable[[Path, Path, str], Any]
ConfigPatchFn = Callable[[Path, Path, dict], tuple]


# ---------------------------------------------------------------------------
# dump
# ---------------------------------------------------------------------------


def dump_config(
    openclaw_bin: Path,
    openclaw_home: Path,
    *,
    config_get_fn: Optional[ConfigGetFn] = None,
) -> ConfigDump:
    """聚合 OpenClaw 当前配置，secret 字段已脱敏。

    Aggregate ``models.providers`` / ``auth.profiles`` / ``auth.order`` /
    ``agents.defaults`` from upstream and merge with wrapper extras.
    All secret-looking fields are masked before return.
    """
    getter: ConfigGetFn = config_get_fn or _run_config_get
    home = Path(openclaw_home).expanduser().resolve()

    providers = getter(openclaw_bin, home, "models.providers") or {}
    auth_profiles = getter(openclaw_bin, home, "auth.profiles") or {}
    auth_order = getter(openclaw_bin, home, "auth.order") or {}
    agent_defaults = getter(openclaw_bin, home, "agents.defaults") or {}
    extras = read_extras(home)

    return ConfigDump(
        providers=mask_secrets(providers if isinstance(providers, dict) else {}),
        auth_profiles=mask_secrets(auth_profiles if isinstance(auth_profiles, dict) else {}),
        auth_order=auth_order if isinstance(auth_order, dict) else {},
        agent_defaults=agent_defaults if isinstance(agent_defaults, dict) else {},
        extras=extras,
    )


# ---------------------------------------------------------------------------
# patch
# ---------------------------------------------------------------------------


def patch_config(
    openclaw_bin: Path,
    openclaw_home: Path,
    patch: dict,
    *,
    extras_patch: Optional[dict] = None,
    config_patch_fn: Optional[ConfigPatchFn] = None,
) -> PatchResult:
    """把面板修改 patch 到 OpenClaw + extras。

    1. 从 patch 中剔除"用户未改的 secret 字段"（避免把 ``*`` 串写回 OpenClaw）
    2. 调用 ``openclaw config patch --stdin --strict-json``
    3. 若 ``extras_patch`` 给出，深合并写回 ``state/artifex-nexus-extras.json``

    extras_patch 与 patch 物理隔离：上游不收的字段（``displayName`` / ``notes``）
    走 extras，避免被 strict-json 拒绝。
    """
    patcher: ConfigPatchFn = config_patch_fn or _run_config_patch
    home = Path(openclaw_home).expanduser().resolve()

    cleaned = strip_unchanged_secrets(copy.deepcopy(patch))

    # 仅当 cleaned 非空时才调 patch（剔除完可能成空 dict）
    if cleaned:
        ok, err = patcher(openclaw_bin, home, cleaned)
        if not ok:
            return PatchResult(success=False, validate_error=err)

    # extras 深合并
    if extras_patch:
        try:
            current = read_extras(home)
            merged = _deep_merge(current, extras_patch)
            write_extras(home, merged)
        except OSError as exc:
            return PatchResult(success=False, validate_error=f"写 extras 失败: {exc}")

    return PatchResult(success=True)


def _deep_merge(base: dict, overlay: dict) -> dict:
    """深合并：dict 递归 merge；其它类型 / 数组直接 overlay 替换；overlay 中值为 None 则删 key。"""
    out = dict(base)
    for k, v in overlay.items():
        if v is None:
            out.pop(k, None)
            continue
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


# ---------------------------------------------------------------------------
# test_provider
# ---------------------------------------------------------------------------


def test_provider(
    openclaw_bin: Path,
    openclaw_home: Path,
    provider_id: str,
    model_id: str,
    *,
    auth_profile_id: Optional[str] = None,
    timeout: float = INFER_TIMEOUT,
) -> TestProviderResult:
    """通过 ``openclaw infer`` 发一次最小请求做联通性测试。

    Spike 待解（spec §10 P3）：当前实现先尝试 ``openclaw infer``；若该子命令不存在
    或非零退出，返回 ``error`` 描述（前端据此提示"无法测试，请保存后在 OpenClaw 内联调"）。
    M2 可加 HTTP 直 ping baseUrl 作 fallback。
    """
    if not provider_id or not model_id:
        return TestProviderResult(success=False, error="provider_id / model_id 必填")

    cli_args = [
        "infer",
        "--provider",
        provider_id,
        "--model",
        model_id,
        "--prompt",
        "ping",
    ]
    if auth_profile_id:
        cli_args.extend(["--auth-profile", auth_profile_id])

    home = Path(openclaw_home).expanduser().resolve()
    started = time.monotonic()

    try:
        proc = _sp.run_openclaw(
            cli_args,
            home,
            bin_path=openclaw_bin,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return TestProviderResult(success=False, error=f"测试超时（>{timeout}s）")
    except (OSError, FileNotFoundError) as exc:
        return TestProviderResult(success=False, error=f"启动 openclaw infer 失败: {exc}")

    latency_ms = int((time.monotonic() - started) * 1000)

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()[:400]
        return TestProviderResult(
            success=False,
            latency_ms=latency_ms,
            error=err or f"exit={proc.returncode}",
        )

    out = (proc.stdout or "").strip()
    return TestProviderResult(
        success=True,
        latency_ms=latency_ms,
        model_echo=out[:120] if out else None,
    )
