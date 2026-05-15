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

INFER_TIMEOUT = 45.0
"""``openclaw infer model run`` 超时秒。

上游 CLI 每次 cold start ~2.5s（Node.js 初始化），加上某些 provider（如
网易 CodeMaker）响应延迟较高，实测单次 infer 总耗时可达 20-25s。
设为 45s 留足余量，前端会展示"测试中…"进度提示。"""
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
    agent_list: list = field(default_factory=list)
    """``agents.list`` 节点（agent 预设数组，含 id / name / thinkingDefault 等）。"""
    extras: dict = field(default_factory=dict)
    """wrapper 自维护的字段（``providerExtras`` / ``authExtras`` / ``modelExtras``）。"""

    def to_dict(self) -> dict:
        return {
            "providers": self.providers,
            "authProfiles": self.auth_profiles,
            "authOrder": self.auth_order,
            "agentDefaults": self.agent_defaults,
            "agentList": self.agent_list,
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


@dataclass
class SetAuthTokenResult:
    """``openclaw.auth.set_token`` 返回值。

    Result of writing a provider API key into ``auth-profiles.json`` via
    ``openclaw models auth paste-token``. On success the upstream CLI also
    updates ``auth.profiles.<id>`` metadata in ``openclaw.json``.
    """

    success: bool
    profile_id: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "profileId": self.profile_id,
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


def strip_auth_profile_secrets(patch: Any) -> Any:
    """从 patch 的 ``auth.profiles.<id>`` 节点剔除任何 secret 字段。

    Strip secret-looking fields (``token`` / ``apiKey`` / ``api_key`` …) from
    ``auth.profiles.<id>`` regardless of mask state.

    上游 v2026.5.4 schema 把 ``auth.profiles.<id>`` 收敛成纯元数据
    （``provider`` / ``mode`` / ``email`` / ``displayName``）+
    ``additionalProperties: false``，任何 secret 字段都会被 schema validate
    拒绝。凭证另走 ``openclaw models auth paste-token`` 写
    ``state/agents/<agentId>/agent/auth-profiles.json``。

    本函数仅处理 ``auth.profiles.*`` 子节点；不影响 ``models.providers.*``
    等其它位置的 secret（那些由 ``strip_unchanged_secrets`` 按脱敏判定处理）。
    """
    if not isinstance(patch, dict):
        return patch
    auth = patch.get("auth")
    if not isinstance(auth, dict):
        return patch
    profiles = auth.get("profiles")
    if not isinstance(profiles, dict):
        return patch

    cleaned_profiles: dict = {}
    for pid, prof in profiles.items():
        if not isinstance(prof, dict):
            cleaned_profiles[pid] = prof
            continue
        cleaned_profiles[pid] = {
            k: v
            for k, v in prof.items()
            if not (
                isinstance(k, str)
                and k.lower().replace("-", "_") in SECRET_FIELD_NAMES
            )
        }
    new_auth = dict(auth)
    new_auth["profiles"] = cleaned_profiles
    new_patch = dict(patch)
    new_patch["auth"] = new_auth
    return new_patch


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


def _patch_path_exists(patch: Any, dot_path: str) -> bool:
    """检查 dot/bracket 路径在 patch 里是否真有值。

    OpenClaw CLI 校验 ``--replace-path`` 时要求该路径必须在 patch 中出现，
    否则报 ``--replace-path X did not match any value in the input patch``。
    本函数用于在 spawn CLI 前过滤掉 patch 里不存在的 replace_paths。

    支持简单点路径（``a.b.c``）；不实现 bracket 语法（够用即可）。
    """
    if not isinstance(dot_path, str) or not dot_path:
        return False
    parts = [p for p in dot_path.split(".") if p]
    cur: Any = patch
    for p in parts:
        if isinstance(cur, dict) and p in cur:
            cur = cur[p]
        else:
            return False
    return True


def _run_config_patch(
    openclaw_bin: Path,
    openclaw_home: Path,
    patch: dict,
    timeout: float = CONFIG_TIMEOUT,
    *,
    replace_paths: Optional[list[str]] = None,
) -> tuple[bool, Optional[str]]:
    """``openclaw config patch --stdin``；返回 ``(success, error?)``。

    error 含 stderr 前 500 字符（剔除可能的 secret 行）。

    Args:
        replace_paths: 可选；传给 ``--replace-path <path>``（可重复），
            让指定 dot/bracket 路径下的 object/array **整体替换**而非递归 merge。
            用于"删除 provider / 删除 model"等需要真删的场景。
            **会自动过滤掉 patch 中不存在的路径**，避免 OpenClaw 报
            "did not match any value in the input patch"。

    Note: v2026.5.4 的 ``config patch`` **不支持** ``--strict-json`` 选项
    （历史 spike 笔记里写过、实际 CLI 没实现），无脑加上会 ``unknown option``
    退出 1 → 整条 patch 失败。stdin 走的本来就是 JSON5，schema validate +
    atomic write 已经默认开启，``--strict-json`` 是冗余约束。
    """
    cli_args = ["config", "patch", "--stdin"]
    if replace_paths:
        # 关键防御：CLI 严格校验 replace-path 必须在 patch 里有对应值。
        # strip_unchanged_secrets 等剔除逻辑可能让某些路径凭空消失（如 provider
        # 重命名后旧 id 不在 patch 里）。这里按 patch 实际结构过滤一次，避免
        # CLI 报"did not match any value in the input patch"误杀整个 patch。
        for p in replace_paths:
            if p and _patch_path_exists(patch, p):
                cli_args.extend(["--replace-path", p])
    try:
        proc = _sp.run_openclaw(
            cli_args,
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
ConfigPatchFn = Callable[..., tuple]


# ---------------------------------------------------------------------------
# dump
# ---------------------------------------------------------------------------


def _iter_auth_profiles_files(openclaw_home: Path):
    """遍历所有可能的 auth-profiles.json 文件路径（双路径兼容）。

    上游 v2026.5.4+ 正逐步从旧路径 ``state/agents/*/agent/`` 迁移到
    新路径 ``.openclaw/agents/*/agent/``。过渡期内两个路径都可能存在，
    本函数同时返回两个路径的匹配文件，确保无论 CLI 写到哪都能读到。

    **顺序**：先旧路径、后新路径——调用方需要后写覆盖先写的模式来实现
    新路径优先的合并语义。

    Yields:
        Path: 找到的 auth-profiles.json 文件路径（先旧后新）。
    """
    import glob
    # 旧路径（兼容）
    old_pattern = str(openclaw_home / "state" / "agents" / "*" / "agent" / "auth-profiles.json")
    yield from (Path(p) for p in glob.glob(old_pattern))
    # 新路径（v2026.5.4+ 标准位置），后 yield → 后处理 → 覆盖旧值
    new_pattern = str(openclaw_home / ".openclaw" / "agents" / "*" / "agent" / "auth-profiles.json")
    yield from (Path(p) for p in glob.glob(new_pattern))


def _merge_stored_tokens(openclaw_home: Path, auth_profiles: dict, providers: Optional[dict] = None) -> None:
    """把 token 合并进 auth_profiles dict（前端用于显示"已保存"状态）。

    Inject token values into ``auth_profiles[<id>].token`` so the frontend can
    display "saved" badges and masked previews.

    单源策略（2026-05-15 收敛后）：
    - **主要来源**：``openclaw.json::models.providers.<provider>.apiKey``
      （artifex 单源凭据存储）。通过 ``auth_profiles[*].provider`` 反查对应
      provider 的 ``apiKey`` 字段。
    - **历史兼容**：若 ``auth-profiles.json``（已废弃）仍存在，仍合并其 token，
      让用户在迁移前能继续看到旧凭据状态。新写入永远走 ``models.providers.<id>.apiKey``。

    注意：token 会在后续 mask_secrets() 中被脱敏，这里只做合并。
    """
    if not isinstance(auth_profiles, dict):
        return

    # 主路径：从 providers.<id>.apiKey 反查（与 set_auth_token 单源一致）
    if isinstance(providers, dict):
        for profile_id, profile in auth_profiles.items():
            if not isinstance(profile, dict):
                continue
            if profile.get("token"):
                continue  # 已有则跳过
            provider_id = profile.get("provider")
            if not provider_id:
                continue
            provider_cfg = providers.get(provider_id)
            if isinstance(provider_cfg, dict):
                api_key = provider_cfg.get("apiKey")
                if isinstance(api_key, str) and api_key:
                    profile["token"] = api_key

    # 历史兼容路径：auth-profiles.json（已废弃但仍读，便于迁移期）
    for filepath in _iter_auth_profiles_files(openclaw_home):
        try:
            data = json.loads(filepath.read_text(encoding="utf-8"))
            stored_profiles = data.get("profiles", {})
            for profile_id, stored in stored_profiles.items():
                if not isinstance(stored, dict):
                    continue
                token_val = stored.get("token", "")
                if not token_val:
                    continue
                if profile_id not in auth_profiles:
                    auth_profiles[profile_id] = {"provider": stored.get("provider", ""), "mode": stored.get("type", "api_key"), "token": token_val}
                elif isinstance(auth_profiles[profile_id], dict) and not auth_profiles[profile_id].get("token"):
                    auth_profiles[profile_id]["token"] = token_val
        except (OSError, json.JSONDecodeError, KeyError):
            continue


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

    性能优化（STORY-0018 hot-fix）：直接读 openclaw.json 文件而非 4 次 spawn CLI。
    上游 CLI 每次 cold start ~2.4s（Node.js 初始化 + schema 加载），4 次 = ~10s。
    直接读文件 <100ms，且对"只读"操作完全安全（写仍走 ``config patch``）。
    若文件读取失败则 fallback 到原来的 CLI 方式。
    """
    home = Path(openclaw_home).expanduser().resolve()

    # 优先直接读 openclaw.json（性能最优路径）
    config_file = home / "openclaw.json"
    root: Optional[dict] = None
    if config_get_fn is None and config_file.exists():
        try:
            raw = config_file.read_text(encoding="utf-8")
            root = json.loads(raw)
            if not isinstance(root, dict):
                root = None
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("直接读 openclaw.json 失败，fallback 到 CLI: %s", exc)
            root = None

    if root is not None:
        # 从完整 config 中提取各节
        providers = root.get("models", {}).get("providers", {})
        auth_profiles = root.get("auth", {}).get("profiles", {})
        auth_order = root.get("auth", {}).get("order", {})
        agent_defaults = root.get("agents", {}).get("defaults", {})
        agent_list = root.get("agents", {}).get("list", [])
    else:
        # fallback：4 次 CLI spawn（慢但可靠）
        getter: ConfigGetFn = config_get_fn or _run_config_get
        providers = getter(openclaw_bin, home, "models.providers") or {}
        auth_profiles = getter(openclaw_bin, home, "auth.profiles") or {}
        auth_order = getter(openclaw_bin, home, "auth.order") or {}
        agent_defaults = getter(openclaw_bin, home, "agents.defaults") or {}
        agent_list = getter(openclaw_bin, home, "agents.list") or []

    # 把 token 合并进 auth_profiles 给前端展示。
    # 主路径：从 models.providers.<id>.apiKey 反查（artifex 单源策略）
    # 历史兼容：若 auth-profiles.json 仍存在则也读（迁移期）
    _merge_stored_tokens(home, auth_profiles, providers if isinstance(providers, dict) else None)

    extras = read_extras(home)

    return ConfigDump(
        providers=mask_secrets(providers if isinstance(providers, dict) else {}),
        auth_profiles=mask_secrets(auth_profiles if isinstance(auth_profiles, dict) else {}),
        auth_order=auth_order if isinstance(auth_order, dict) else {},
        agent_defaults=agent_defaults if isinstance(agent_defaults, dict) else {},
        agent_list=agent_list if isinstance(agent_list, list) else [],
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
    replace_paths: Optional[list[str]] = None,
) -> PatchResult:
    """把面板修改 patch 到 OpenClaw + extras。

    1. 从 patch 中剔除"用户未改的 secret 字段"（避免把 ``*`` 串写回 OpenClaw）
    2. 调用 ``openclaw config patch --stdin``（可选 ``--replace-path``）
    3. 若 ``extras_patch`` 给出，深合并写回 ``state/artifex-nexus-extras.json``

    extras_patch 与 patch 物理隔离：上游不收的字段（``displayName`` / ``notes``）
    走 extras，避免被 schema validate 拒绝。

    Args:
        replace_paths: 让指定路径**整体替换**而非递归 merge。前端"删除 provider /
            删除 model" 应同时设：
            - patch 里把要删的子路径设为 ``null``（OpenClaw 语义：null 删 key）
              **或**直接给一个不含被删项的新值
            - replace_paths 加上父路径（如 ``"models.providers"`` /
              ``"models.providers.custom.models"``），让 CLI 整体替换数组/对象
    """
    patcher: ConfigPatchFn = config_patch_fn or _run_config_patch
    home = Path(openclaw_home).expanduser().resolve()

    # 1) 剔除"未改的脱敏 secret 占位"（防止把 ******* 写回上游）
    # 2) 强制剔除 auth.profiles.<id> 下的任何 secret 字段
    #    （上游 v2026.5.4 schema 把 profile 收敛成纯元数据，凭证另走 paste-token；
    #     若 patch 残留 token / apiKey 会被 schema validate 拒绝 → 整个 patch 失败）
    cleaned = strip_unchanged_secrets(copy.deepcopy(patch))
    cleaned = strip_auth_profile_secrets(cleaned)

    # 仅当 cleaned 非空时才调 patch（剔除完可能成空 dict）
    if cleaned:
        # 调用方传了 replace_paths 时透传给 patcher（向后兼容旧 patcher 签名）
        try:
            ok, err = patcher(openclaw_bin, home, cleaned, replace_paths=replace_paths)
        except TypeError:
            # 旧 patcher 不支持 replace_paths kwarg，回退到无替换调用
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
    """通过 ``openclaw infer model run`` 发一次最小请求做联通性测试。

    Run ``openclaw infer model run --model <provider>/<model> --prompt ping``
    to validate provider connectivity (auth + endpoint reachable).

    上游 v2026.5.4 实测 CLI 形态：
    - ``infer`` 是命令组（audio/embedding/image/model/tts/video/web）
    - ``infer model run`` 是文本推理子命令
    - **没有** ``--provider`` 选项；模型用 ``provider/model`` 复合字符串
    - **没有** ``--auth-profile`` 选项；profile 由 ``auth.order`` 自动选

    早期 spike 假设的 ``openclaw infer --provider <p> --model <m>`` 已不存在。
    """
    if not provider_id or not model_id:
        return TestProviderResult(success=False, error="provider_id / model_id 必填")

    cli_args = [
        "infer",
        "model",
        "run",
        "--model",
        f"{provider_id}/{model_id}",
        "--prompt",
        "ping",
        "--json",
    ]
    # auth_profile_id 上游不支持显式覆盖；仅作日志线索保留参数
    if auth_profile_id:
        logger.debug(
            "test_provider: auth_profile_id=%s ignored (上游 CLI 不支持显式覆盖)",
            auth_profile_id,
        )

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


# ---------------------------------------------------------------------------
# set_auth_token
# ---------------------------------------------------------------------------


# 测试可注入回调：(bin, home, provider, profile_id, token, expires_in?) -> (success, error?)
SetAuthTokenFn = Callable[..., tuple]

SET_TOKEN_TIMEOUT = 10.0
"""``openclaw models auth paste-token`` 超时秒（含 schema validate + 落盘）。"""


def _run_paste_token(
    openclaw_bin: Path,
    openclaw_home: Path,
    provider: str,
    profile_id: str,
    token: str,
    *,
    expires_in: Optional[str] = None,
    timeout: float = SET_TOKEN_TIMEOUT,
) -> tuple[bool, Optional[str]]:
    """``openclaw models auth paste-token`` via stdin。返回 ``(success, error?)``。

    上游会同时：
    1. 把 ``token`` 写入 ``state/agents/<agentId>/agent/auth-profiles.json``
    2. 在 ``openclaw.json`` 的 ``auth.profiles.<profile_id>`` 注册元数据
       （``provider`` + ``mode: "token"``）

    Token 通过 stdin 而非 argv 传入：避免 token 出现在进程列表 / shell 历史。
    """
    cli_args = [
        "models",
        "auth",
        "paste-token",
        "--provider",
        provider,
        "--profile-id",
        profile_id,
    ]
    if expires_in:
        cli_args.extend(["--expires-in", expires_in])

    # token 末尾追换行，模拟用户回车提交（CLI 是 readline-based prompt）
    stdin_payload = token if token.endswith("\n") else f"{token}\n"

    try:
        proc = _sp.run_openclaw(
            cli_args,
            openclaw_home,
            bin_path=openclaw_bin,
            timeout=timeout,
            input=stdin_payload,
        )
    except (subprocess.TimeoutExpired, OSError, FileNotFoundError) as exc:
        return False, f"调用 openclaw models auth paste-token 失败: {exc}"

    if proc.returncode != 0:
        # 注意：stderr 可能含被脱敏后的 echo；按 500 字符截断已能定位错误类型
        err = (proc.stderr or proc.stdout or "").strip()[:500]
        return False, err or f"openclaw models auth paste-token exit={proc.returncode}"
    return True, None


def set_auth_token(
    openclaw_bin: Path,
    openclaw_home: Path,
    provider: str,
    profile_id: str,
    token: str,
    *,
    expires_in: Optional[str] = None,
    paste_token_fn: Optional[SetAuthTokenFn] = None,
) -> SetAuthTokenResult:
    """把 API token 直接写入 ``openclaw.json`` 的 ``models.providers.<provider>.apiKey``。

    Set a provider API token via direct write to ``openclaw.json``. Bypasses
    OpenClaw's ``auth-profiles.json`` mechanism entirely.

    设计决策（2026-05-15 收敛）：
    - **单源原则**：所有 API key 类凭据存 ``openclaw.json`` 的 ``models.providers.<id>.apiKey``，
      不再写 ``auth-profiles.json``。OpenClaw 的 ``resolveUsableCustomProviderApiKey``
      优先级最高（ADR），命中即返回不再查 store
    - 不再 spawn ``openclaw models auth paste-token``（该命令会写 auth-profiles.json）
    - **OAuth provider 暂不支持**（GitHub Copilot 等）：将来需要时单独引入新路径，
      不复用 legacy auth-profiles.json
    - ``profile_id`` / ``expires_in`` 参数保留（向前兼容），但当前实现忽略
    - Token 永不出 argv，仅写入文件
    - 脱敏占位（全 ``*`` 串）会被拒绝
    """
    if not provider:
        return SetAuthTokenResult(success=False, error="provider 必填")
    if not isinstance(token, str) or not token:
        return SetAuthTokenResult(success=False, error="token 必填且为非空字符串")
    if is_masked_value(token):
        return SetAuthTokenResult(
            success=False,
            profile_id=profile_id,
            error="token 是脱敏占位（全 * 串），拒绝写入；前端应仅在用户输入新值时调用",
        )

    home = Path(openclaw_home).expanduser().resolve()
    config_path = home / "openclaw.json"
    if not config_path.exists():
        return SetAuthTokenResult(
            success=False, profile_id=profile_id,
            error=f"openclaw.json 不存在: {config_path}",
        )

    # 读 → 改 → 原子写
    try:
        cfg = json.loads(config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return SetAuthTokenResult(
            success=False, profile_id=profile_id,
            error=f"读 openclaw.json 失败: {exc}",
        )

    models = cfg.setdefault("models", {})
    providers_node = models.setdefault("providers", {})
    if provider not in providers_node or not isinstance(providers_node[provider], dict):
        # 没找到 provider → 创建空骨架（避免 schema 拒绝）
        providers_node[provider] = {"baseUrl": "", "models": []}
    providers_node[provider]["apiKey"] = token
    # 关键：声明 auth: "api-key"，让 OpenClaw 的 shouldPreferExplicitConfigApiKeyAuth
    # 走"直读 cfg.models.providers.<id>.apiKey"路径，不去查 auth-profiles.json。
    # 否则非 custom provider（如 deepseek）会绕过 apiKey 字段去找 profile store。
    if not providers_node[provider].get("auth"):
        providers_node[provider]["auth"] = "api-key"

    try:
        tmp = config_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
        import os as _os
        _os.replace(str(tmp), str(config_path))
    except OSError as exc:
        return SetAuthTokenResult(
            success=False, profile_id=profile_id,
            error=f"写 openclaw.json 失败: {exc}",
        )

    return SetAuthTokenResult(success=True, profile_id=profile_id or f"{provider}-default")


# ---------------------------------------------------------------------------
# fetch_remote_models
# ---------------------------------------------------------------------------

FETCH_MODELS_TIMEOUT = 10.0
"""远端 ``GET /models`` 超时秒。"""


@dataclass
class RemoteModelInfo:
    """远端返回的单个模型元信息。

    A single model entry returned by the remote provider's /models endpoint.
    """

    id: str
    name: str = ""
    owned_by: str = ""

    def to_dict(self) -> dict:
        d: dict[str, Any] = {"id": self.id}
        if self.name:
            d["name"] = self.name
        if self.owned_by:
            d["ownedBy"] = self.owned_by
        return d


@dataclass
class FetchRemoteModelsResult:
    """``fetch_remote_models`` 返回值。

    Result of fetching the remote provider model list via ``GET {baseUrl}/models``.
    """

    success: bool
    models: list[RemoteModelInfo] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        d: dict[str, Any] = {"success": self.success}
        if self.models:
            d["models"] = [m.to_dict() for m in self.models]
        if self.error:
            d["error"] = self.error
        return d


def fetch_remote_models(
    base_url: str,
    token: str,
    *,
    timeout: float = FETCH_MODELS_TIMEOUT,
) -> FetchRemoteModelsResult:
    """调远端 provider 的 OpenAI 兼容 ``GET /models`` 接口获取模型列表。

    Fetch the model list from a remote provider's OpenAI-compatible
    ``GET {baseUrl}/models`` endpoint.

    设计要点：
    - ``base_url`` 通常以 ``/v1`` 结尾（如 ``https://api.deepseek.com/v1``），
      本函数会自动拼 ``/models``
    - 返回 OpenAI 标准格式 ``{"data": [{"id": ..., "owned_by": ...}]}``
    - 对于不支持此端点的 provider（如网易 CodeMaker）会收到 403/404，
      graceful 返回 error

    参数：
        base_url: provider baseUrl（如 ``https://api.deepseek.com/v1``）
        token: API key / bearer token
        timeout: HTTP 超时秒数
    """
    if not base_url:
        return FetchRemoteModelsResult(success=False, error="baseUrl 必填")
    if not token:
        return FetchRemoteModelsResult(success=False, error="token 必填（请先保存凭据）")

    # 拼接 /models 路径（兼容末尾有无斜杠）
    url = base_url.rstrip("/") + "/models"

    try:
        import urllib.request
        import urllib.error

        req = urllib.request.Request(url, method="GET")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Accept", "application/json")

        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        code = e.code
        if code == 404:
            return FetchRemoteModelsResult(
                success=False,
                error="该 provider 不支持自动获取模型列表（404），请手动填写",
            )
        elif code == 403:
            return FetchRemoteModelsResult(
                success=False,
                error="鉴权被拒（403），请检查 API Key 是否正确",
            )
        elif code == 401:
            return FetchRemoteModelsResult(
                success=False,
                error="API Key 无效或已过期（401）",
            )
        return FetchRemoteModelsResult(
            success=False, error=f"HTTP {code}: {str(e)[:200]}"
        )
    except urllib.error.URLError as e:
        logger.warning("fetch_remote_models: network error url=%s: %s", url, e.reason)
        return FetchRemoteModelsResult(
            success=False, error=f"网络错误: {str(e.reason)[:200]}"
        )
    except TimeoutError:
        logger.warning("fetch_remote_models: timeout url=%s >%ds", url, timeout)
        return FetchRemoteModelsResult(
            success=False, error=f"请求超时（>{timeout}s）"
        )
    except Exception as e:
        logger.warning("fetch_remote_models: request failed url=%s: %s", url, e)
        return FetchRemoteModelsResult(
            success=False, error=f"请求异常: {type(e).__name__}: {str(e)[:200]}"
        )

    # 解析 OpenAI 标准响应格式
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return FetchRemoteModelsResult(
            success=False, error="响应不是有效 JSON"
        )

    # OpenAI 格式：{"object":"list","data":[{"id":"...","owned_by":"..."}]}
    model_list = data.get("data") if isinstance(data, dict) else None
    if not isinstance(model_list, list):
        # 某些 provider 可能直接返回数组
        if isinstance(data, list):
            model_list = data
        else:
            return FetchRemoteModelsResult(
                success=False,
                error="响应格式不符预期（需要 {data: [...]} 或直接数组）",
            )

    models: list[RemoteModelInfo] = []
    for item in model_list:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id", "")).strip()
        if not model_id:
            continue
        models.append(
            RemoteModelInfo(
                id=model_id,
                name=str(item.get("name", "")).strip() or model_id,
                owned_by=str(item.get("owned_by", "")).strip(),
            )
        )

    if not models:
        return FetchRemoteModelsResult(
            success=False, error="远端返回空模型列表"
        )

    logger.info("fetch_remote_models: 获取到 %d 个模型 from %s", len(models), url)
    return FetchRemoteModelsResult(success=True, models=models)
