"""
dcc_connections.py — DCC 连接状态跟踪与查询 API
=================================================

提供统一的跨 DCC 连接状态查询，解决 agent 需要逐个探测来判断 DCC 是否在线的痛点。

暴露的 RPC 方法：
- openclaw.dcc.connections.list   — 列出所有注册 DCC 及其连接状态
- openclaw.dcc.connections.status  — 单个 DCC 的详细连接信息
- openclaw.dcc.connections.events  — 最近的连接状态变更事件

设计：
- 复用 mcp_bridge.py 已有的 check_* 函数
- 并行探测（多线程），单次查询耗时 ≈ max(单 DCC 探测)
- 轻量缓存（默认 TTL=5s），避免 agent 连续多轮对话反复探测
- 事件日志（内存环形缓冲），记录连接状态变更
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from . import mcp_bridge as _mcp_bridge

logger = logging.getLogger(__name__)
logger.propagate = False
logger.setLevel(logging.INFO)
if not logger.handlers:
    import sys
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("[sidecar.dcc_conn] %(message)s"))
    _h.setLevel(logging.INFO)
    logger.addHandler(_h)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

CACHE_TTL = 5.0  # 秒，连接状态缓存有效期
"""agent 连续多轮对话时避免重复探测。"""

EVENT_LOG_MAX = 50  # 最多保留的事件数
"""环形缓冲上限。"""

# 所有已知 DCC 的注册表（key = dcc_name）
_DCC_REGISTRY: Dict[str, Dict[str, Any]] = {
    "unreal_engine": {
        "dcc": "unreal_engine",
        "displayName": "Unreal Engine",
        "port": 18080,
        "installKey": "unreal",
    },
    "blender": {
        "dcc": "blender",
        "displayName": "Blender",
        "port": 18083,
        "installKey": "blender",
    },
    "maya": {
        "dcc": "maya",
        "displayName": "Maya",
        "port": 18081,
        "installKey": "maya",
    },
    "3ds_max": {
        "dcc": "3ds_max",
        "displayName": "3ds Max",
        "port": 18082,
        "installKey": "max",
    },
    "houdini": {
        "dcc": "houdini",
        "displayName": "Houdini",
        "port": 18086,
        "installKey": "houdini",
    },
}

# DCC → MCP bridge check function mapping
_CHECK_FUNCTIONS: Dict[str, Dict[str, Callable]] = {
    "blender": {
        "server_running": _mcp_bridge.check_blender_mcp_server_running,
        "mcp_connected": _mcp_bridge.check_blender_mcp_connection,
    },
    "unreal_engine": {
        "server_running": _mcp_bridge.check_unreal_mcp_server_running,
        "mcp_connected": _mcp_bridge.check_unreal_mcp_connection,
    },
    "maya": {
        "server_running": _mcp_bridge.check_maya_mcp_server_running,
        "mcp_connected": _mcp_bridge.check_maya_mcp_connection,
    },
    "3ds_max": {
        "server_running": _mcp_bridge.check_max_mcp_server_running,
        "mcp_connected": _mcp_bridge.check_max_mcp_connection,
    },
}

# ---------------------------------------------------------------------------
# 缓存与事件日志
# ---------------------------------------------------------------------------

_cache: Dict[str, Dict[str, Any]] = {}
_cache_ts: float = 0.0
_cache_lock = threading.Lock()

_event_log: List[Dict[str, Any]] = []
_event_log_lock = threading.Lock()


def _check_dcc(dcc_name: str, registry_entry: Dict[str, Any]) -> Dict[str, Any]:
    """探测单个 DCC 的连接状态。

    两阶段探测：
    1. TCP socket connect（1s timeout）→ 判断进程是否监听端口
    2. 如果 TCP 可达，再 WebSocket + MCP initialize 握手（3s timeout）
    """
    result = {
        "dcc": dcc_name,
        "displayName": registry_entry["displayName"],
        "port": registry_entry["port"],
        "serverRunning": False,
        "mcpConnected": False,
        "address": f"ws://127.0.0.1:{registry_entry['port']}",
        "error": None,
    }

    check_funcs = _CHECK_FUNCTIONS.get(dcc_name)
    if check_funcs is None:
        result["error"] = f"不支持的 DCC: {dcc_name}"
        return result

    # 阶段 1: TCP 探测
    try:
        result["serverRunning"] = check_funcs["server_running"](timeout=1.0)
    except Exception as e:
        logger.debug("TCP 探测 %s 失败: %s", dcc_name, e)
        result["error"] = str(e)
        return result

    if not result["serverRunning"]:
        return result

    # 阶段 2: MCP 握手
    try:
        conn_result = check_funcs["mcp_connected"](timeout=3.0)
        result["mcpConnected"] = conn_result["connected"]
        result["address"] = conn_result.get("address", result["address"])
        if conn_result.get("error"):
            result["error"] = conn_result["error"]
    except Exception as e:
        logger.debug("MCP 握手 %s 失败: %s", dcc_name, e)
        result["error"] = str(e)

    return result


def _probe_all_dccs() -> Dict[str, Any]:
    """并行探测所有 DCC 的连接状态。"""
    results: Dict[str, Dict[str, Any]] = {}

    threads = []
    for dcc_name, entry in _DCC_REGISTRY.items():
        t = threading.Thread(
            target=lambda r=results, n=dcc_name, e=entry: r.update({n: _check_dcc(n, e)}),
            daemon=True,
        )
        threads.append(t)
        t.start()

    for t in threads:
        t.join(timeout=5.0)  # 整体超时保护（TCP 1s + MCP 3s + buffer）

    # 确保所有 DCC 都有结果（线程未完成的 fallback）
    for dcc_name, entry in _DCC_REGISTRY.items():
        if dcc_name not in results:
            results[dcc_name] = {
                "dcc": dcc_name,
                "displayName": entry["displayName"],
                "port": entry["port"],
                "serverRunning": False,
                "mcpConnected": False,
                "address": f"ws://127.0.0.1:{entry['port']}",
                "error": "探测超时",
            }

    return results


def _get_or_refresh_cache() -> Dict[str, Any]:
    """获取连接状态，优先使用缓存在 TTL 内的结果。"""
    global _cache, _cache_ts
    with _cache_lock:
        now = time.time()
        if _cache and (now - _cache_ts) < CACHE_TTL:
            return dict(_cache)
    # 缓存过期或不存在，重新探测
    new_results = _probe_all_dccs()
    with _cache_lock:
        _cache = new_results
        _cache_ts = time.time()
    return dict(new_results)


def _record_event(dcc_name: str, old_state: Optional[Dict], new_state: Dict) -> None:
    """记录连接状态变更事件（环形缓冲）。"""
    with _event_log_lock:
        _event_log.append({
            "dcc": dcc_name,
            "timestamp": time.time(),
            "previous": {
                "serverRunning": old_state.get("serverRunning") if old_state else None,
                "mcpConnected": old_state.get("mcpConnected") if old_state else None,
            } if old_state else None,
            "current": {
                "serverRunning": new_state["serverRunning"],
                "mcpConnected": new_state["mcpConnected"],
            },
        })
        # 环形缓冲裁剪
        while len(_event_log) > EVENT_LOG_MAX:
            _event_log.pop(0)


def _check_and_log_changes(old_results: Dict, new_results: Dict) -> None:
    """对比旧新状态，记录变更事件。"""
    for dcc_name, new_state in new_results.items():
        old_state = old_results.get(dcc_name) if old_results else None
        if old_state is None:
            continue
        if (old_state.get("serverRunning") != new_state.get("serverRunning") or
                old_state.get("mcpConnected") != new_state.get("mcpConnected")):
            _record_event(dcc_name, old_state, new_state)


# ---------------------------------------------------------------------------
# RPC Handler
# ---------------------------------------------------------------------------

def _handle_dcc_connections_list(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.connections.list

    列出所有已注册 DCC 的连接状态。

    返回：
        {
            "gatewayOnline": bool,
            "dccs": {
                "<dcc_name>": {
                    "dcc": str,           // 内部名 (blender/unreal_engine/maya/3ds_max)
                    "displayName": str,    // 显示名
                    "port": int,           // MCP Server 端口
                    "address": str,        // WebSocket 地址
                    "serverRunning": bool, // TCP 端口是否有进程监听
                    "mcpConnected": bool,  // MCP 握手是否成功
                    "error": str|null,     // 连接失败原因
                },
                ...
            },
            "summary": {
                "total": int,     // 注册 DCC 总数
                "online": int,    // MCP 在线数
                "listening": int, // TCP 监听数
            },
            "cached": bool        // 是否来自缓存（TTL 内）
        }
    """
    try:
        # 检查 Gateway 是否在线
        gateway_online = False
        try:
            from . import _runtime
            gateway_online = _runtime.is_running()
        except Exception:
            pass

        with _cache_lock:
            old_cache = dict(_cache) if _cache else {}
        results = _get_or_refresh_cache()

        # 记录状态变更
        _check_and_log_changes(old_cache, results)

        # 计算汇总
        total = len(results)
        online = sum(1 for r in results.values() if r["mcpConnected"])
        listening = sum(1 for r in results.values() if r["serverRunning"])

        # 判断是否来自缓存
        with _cache_lock:
            cached = (time.time() - _cache_ts) < CACHE_TTL and old_cache

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "gatewayOnline": gateway_online,
                "dccs": results,
                "summary": {
                    "total": total,
                    "online": online,
                    "listening": listening,
                },
                "cached": cached,
            },
        }
    except Exception as e:
        logger.exception("dcc.connections.list 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_dcc_connections_status(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.connections.status

    查询单个 DCC 的详细连接状态。

    params:
        dcc: str  // DCC 内部名，如 "blender"/"unreal_engine"/"maya"/"3ds_max"

    返回：同 dccs 中的单个条目结构，额外包含 mcpConnected、serverRunning 的
    详细状态描述。
    """
    try:
        dcc = params.get("dcc", "")
        if not dcc:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32602, "message": "缺少参数: dcc"},
            }

        entry = _DCC_REGISTRY.get(dcc)
        if entry is None:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32602, "message": f"未知 DCC: {dcc}"},
            }

        result = _check_dcc(dcc, entry)

        # 添加状态描述
        if result["mcpConnected"]:
            result["status"] = "connected"
            result["statusLabel"] = "已连接"
        elif result["serverRunning"]:
            result["status"] = "listening"
            result["statusLabel"] = "端口监听中（MCP 未就绪）"
        else:
            result["status"] = "offline"
            result["statusLabel"] = "离线"

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": result,
        }
    except Exception as e:
        logger.exception("dcc.connections.status 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_dcc_connections_events(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.connections.events

    返回最近的连接状态变更事件。

    params:
        limit: int  // 可选，最多返回几条，默认 20

    返回：
        {
            "events": [
                {
                    "dcc": str,
                    "timestamp": float,
                    "previous": {"serverRunning": bool|null, "mcpConnected": bool|null}|null,
                    "current": {"serverRunning": bool, "mcpConnected": bool},
                },
                ...
            ]
        }
    """
    try:
        limit = params.get("limit", 20)
        with _event_log_lock:
            events = _event_log[-limit:] if limit > 0 else list(_event_log)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "events": events,
            },
        }
    except Exception as e:
        logger.exception("dcc.connections.events 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


def _handle_dcc_connections_refresh(req_id: Any, params: dict) -> dict:
    """openclaw.dcc.connections.refresh

    强制刷新所有 DCC 连接状态（跳过缓存）。
    用于用户主动点击"刷新"按钮，或 agent 发现状态不一致时。
    """
    try:
        global _cache, _cache_ts
        with _cache_lock:
            _cache_ts = 0.0  # 标记缓存失效

        with _cache_lock:
            old_cache = dict(_cache) if _cache else {}
        new_results = _probe_all_dccs()
        with _cache_lock:
            _cache = new_results
            _cache_ts = time.time()

        _check_and_log_changes(old_cache, new_results)

        total = len(new_results)
        online = sum(1 for r in new_results.values() if r["mcpConnected"])

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "dccs": new_results,
                "summary": {
                    "total": total,
                    "online": online,
                    "listening": sum(1 for r in new_results.values() if r["serverRunning"]),
                },
            },
        }
    except Exception as e:
        logger.exception("dcc.connections.refresh 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


# ---------------------------------------------------------------------------
# 方法表（供 sidecar.py METHOD_TABLE 合并）
# ---------------------------------------------------------------------------

DCC_CONNECTIONS_METHODS: Dict[str, Callable] = {
    "openclaw.dcc.connections.list": _handle_dcc_connections_list,
    "openclaw.dcc.connections.status": _handle_dcc_connections_status,
    "openclaw.dcc.connections.events": _handle_dcc_connections_events,
    "openclaw.dcc.connections.refresh": _handle_dcc_connections_refresh,
}
