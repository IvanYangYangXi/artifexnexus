"""
Artifex Nexus 应用级设置（app.settings.*）。
=========================================================

存储位置：``<openclaw_home>/state/artifex/app-settings.json``。
设计目标：
  * 给前端"设置 → 常规"页提供持久化（默认工具超时、最大并发数等）。
  * 后端运行时读取（如 ``nexus_tool_rpc._execute_general_tool`` 的超时）。

约束：
  * 文件不存在时返回 ``DEFAULT_SETTINGS``，不主动创建——避免 dev/prod 路径污染。
  * 写入采用 "load-merge-save" 策略，部分字段更新不会清掉其他字段。
  * 字段命名走 ``camelCase``（与前端对齐，已是项目其他设置的惯例）。
  * **跨模块只读访问** 请用 :func:`get_runtime_settings`，它会带 in-memory cache，
    避免 nexus-tool 每次执行都打开一次 JSON。

新增字段流程：
  1. 在 :data:`DEFAULT_SETTINGS` 加默认值。
  2. 在 :func:`_validate` 加校验（可选）。
  3. 前端 ``GeneralTab`` 加输入控件 + 提交逻辑。
  4. 后端使用方读 :func:`get_runtime_settings()` 对应字段。
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ── 默认值 ────────────────────────────────────────────────────────────────────
# 字段说明（前端展示文案在 settings.i18n.ts，本表只放结构 + 默认值）：
#   nexusToolDefaultTimeoutSec: 通用 nexus-tool 默认超时（秒）。manifest.implementation.timeout
#                                可单工具覆盖；本字段是兜底默认。
#   nexusToolMaxConcurrent:     同时允许运行的通用 nexus-tool 数；超出会拒绝 run 请求。
#   nexusToolKillProcessTree:   cancel 时是否递归杀子进程（Windows 下尤其重要）。
#   logLevel:                   sidecar 日志等级（"DEBUG"/"INFO"/"WARN"/"ERROR"）。仅展示，
#                                实际生效需 sidecar 重启或单独 RPC 热更新——后续迭代再做。
DEFAULT_SETTINGS: Dict[str, Any] = {
    "nexusToolDefaultTimeoutSec": 120,
    "nexusToolMaxConcurrent": 3,
    "nexusToolKillProcessTree": True,
    "logLevel": "INFO",
}

# 校验范围（防止前端写脏数据让 sidecar 卡死）
_INT_RANGES: Dict[str, tuple[int, int]] = {
    "nexusToolDefaultTimeoutSec": (1, 24 * 60 * 60),  # 1s ~ 24h
    "nexusToolMaxConcurrent": (1, 64),
}
_LOG_LEVELS = {"DEBUG", "INFO", "WARN", "WARNING", "ERROR"}

# ── 内部状态 ──────────────────────────────────────────────────────────────────
_lock = threading.Lock()
_cached: Optional[Dict[str, Any]] = None
_cached_at: float = 0.0
_CACHE_TTL = 5.0  # 秒；nexus-tool 高频读，但用户改后也要及时生效


def _settings_path() -> Path:
    """返回 settings 文件路径。

    优先 ``OPENCLAW_HOME``；缺省回到 ``~/.artifexnexus/.openclaw/state/artifex/``。
    与 ``sidecar._get_openclaw_home`` 行为对齐，但避免循环 import，本模块独立实现。
    """
    import os

    home = os.environ.get("OPENCLAW_HOME", "")
    base = Path(home).expanduser() if home else Path.home() / ".artifexnexus" / ".openclaw"
    return (base / "state" / "artifex" / "app-settings.json").resolve()


def _validate(settings: Dict[str, Any]) -> Optional[str]:
    """返回错误信息字符串；None 表示通过。"""
    for key, (lo, hi) in _INT_RANGES.items():
        if key in settings:
            v = settings[key]
            if not isinstance(v, int) or isinstance(v, bool) or not (lo <= v <= hi):
                return f"{key} 必须是 [{lo}, {hi}] 范围内的整数（当前: {v!r}）"
    if "nexusToolKillProcessTree" in settings and not isinstance(
        settings["nexusToolKillProcessTree"], bool
    ):
        return "nexusToolKillProcessTree 必须是布尔值"
    if "logLevel" in settings:
        lv = settings["logLevel"]
        if not isinstance(lv, str) or lv.upper() not in _LOG_LEVELS:
            return f"logLevel 必须是 {sorted(_LOG_LEVELS)} 之一"
    return None


def _read_disk() -> Dict[str, Any]:
    """从磁盘读取，缺失/损坏时返回 ``DEFAULT_SETTINGS`` 副本。

    损坏的文件会被备份为 ``.broken-<ts>``，避免悄无声息覆盖用户改坏的内容。
    """
    p = _settings_path()
    if not p.is_file():
        return dict(DEFAULT_SETTINGS)
    try:
        raw = p.read_text(encoding="utf-8")
        data = json.loads(raw) if raw.strip() else {}
        if not isinstance(data, dict):
            raise ValueError(f"settings 根节点应是 object，得到 {type(data).__name__}")
        # 与 DEFAULT 合并（用户文件可能缺新字段）
        merged = {**DEFAULT_SETTINGS, **data}
        return merged
    except Exception as e:
        logger.warning("[app-settings] 读取失败 (%s): %s；使用默认值", p, e)
        try:
            backup = p.with_suffix(p.suffix + f".broken-{int(time.time())}")
            p.rename(backup)
            logger.warning("[app-settings] 损坏文件已备份至 %s", backup)
        except Exception:
            pass
        return dict(DEFAULT_SETTINGS)


def _write_disk(settings: Dict[str, Any]) -> None:
    p = _settings_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    # 原子写：先写 .tmp，再 rename
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(
        json.dumps(settings, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    tmp.replace(p)


# ── 公开 API ──────────────────────────────────────────────────────────────────


def get_runtime_settings() -> Dict[str, Any]:
    """**给后端模块用**：带 5s 缓存的快速 getter（nexus-tool 高频调用）。

    Returns:
        dict: 完整设置（合并默认值），副本，外部修改不会污染缓存。
    """
    global _cached, _cached_at
    with _lock:
        now = time.time()
        if _cached is not None and now - _cached_at < _CACHE_TTL:
            return dict(_cached)
        _cached = _read_disk()
        _cached_at = now
        return dict(_cached)


def invalidate_cache() -> None:
    """显式让缓存失效（写入后立即调用）。"""
    global _cached, _cached_at
    with _lock:
        _cached = None
        _cached_at = 0.0


def handle_app_settings_get(req_id: Any, _params: dict) -> dict:
    """RPC: ``app.settings.get`` → 返回完整设置 + 文件路径 + 默认值。"""
    try:
        settings = _read_disk()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "settings": settings,
                "defaults": dict(DEFAULT_SETTINGS),
                "path": str(_settings_path()),
            },
        }
    except Exception as e:
        logger.exception("app.settings.get failed")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def handle_app_settings_set(req_id: Any, params: dict) -> dict:
    """RPC: ``app.settings.set`` (patch) → 部分更新；返回更新后的完整设置。

    params:
      patch: dict — 要写入的字段（可不含全部字段）。
    """
    patch = params.get("patch") if isinstance(params, dict) else None
    if not isinstance(patch, dict):
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": "缺少参数: patch (object)"},
        }

    err = _validate(patch)
    if err:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": err},
        }

    try:
        with _lock:
            current = _read_disk()
            merged = {**current, **patch}
            _write_disk(merged)
            # 失效缓存
            global _cached, _cached_at
            _cached = None
            _cached_at = 0.0
        logger.info("[app-settings] updated keys=%s", list(patch.keys()))
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"settings": merged, "defaults": dict(DEFAULT_SETTINGS), "path": str(_settings_path())},
        }
    except Exception as e:
        logger.exception("app.settings.set failed")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def handle_app_settings_reset(req_id: Any, _params: dict) -> dict:
    """RPC: ``app.settings.reset`` → 恢复默认值。"""
    try:
        with _lock:
            _write_disk(dict(DEFAULT_SETTINGS))
            global _cached, _cached_at
            _cached = None
            _cached_at = 0.0
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"settings": dict(DEFAULT_SETTINGS), "path": str(_settings_path())},
        }
    except Exception as e:
        logger.exception("app.settings.reset failed")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


APP_SETTINGS_METHODS = {
    "app.settings.get": handle_app_settings_get,
    "app.settings.set": handle_app_settings_set,
    "app.settings.reset": handle_app_settings_reset,
}
