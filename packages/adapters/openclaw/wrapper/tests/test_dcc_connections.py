"""
测试 dcc_connections 模块。
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

# 确保能 import 到包
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from artifex_nexus.openclaw_wrapper import dcc_connections as _dc


def test_dcc_registry():
    """所有已知 DCC 都在注册表中。"""
    expected = {"unreal_engine", "blender", "maya", "3ds_max", "houdini"}
    assert set(_dc._DCC_REGISTRY.keys()) == expected, f"Missing DCC: {expected - set(_dc._DCC_REGISTRY.keys())}"

    for dcc, entry in _dc._DCC_REGISTRY.items():
        assert "dcc" in entry
        assert "displayName" in entry
        assert "port" in entry
        assert "installKey" in entry
        print(f"  {dcc}: {entry['displayName']} (port {entry['port']})")


def test_check_functions():
    """所有注册 DCC 都有对应的 check 函数，houdini 除外。"""
    for dcc in _dc._DCC_REGISTRY:
        if dcc == "houdini":
            assert dcc not in _dc._CHECK_FUNCTIONS, f"Houdini should not have check functions yet"
        else:
            assert dcc in _dc._CHECK_FUNCTIONS, f"{dcc} missing check functions"
            assert "server_running" in _dc._CHECK_FUNCTIONS[dcc]
            assert "mcp_connected" in _dc._CHECK_FUNCTIONS[dcc]
    print("  All DCC check functions mapped")


def test_check_dcc_houdini_no_check():
    """Houdini 无 check 函数时应返回 error。"""
    entry = _dc._DCC_REGISTRY["houdini"]
    result = _dc._check_dcc("houdini", entry)
    assert result["dcc"] == "houdini"
    assert result["error"] is not None
    print(f"  Houdini no-check: {result['error']}")


def test_check_dcc_offline():
    """未运行的 DCC 应返回 serverRunning=False。"""
    entry = _dc._DCC_REGISTRY["blender"]
    result = _dc._check_dcc("blender", entry)
    assert result["dcc"] == "blender"
    # Blender 大概率没有运行
    print(f"  Blender status: serverRunning={result['serverRunning']}, mcpConnected={result['mcpConnected']}")


def test_handle_list():
    """list handler 返回结构正确。"""
    result = _dc._handle_dcc_connections_list("test-req", {})
    assert result["jsonrpc"] == "2.0"
    assert result["id"] == "test-req"
    assert "result" in result
    res = result["result"]
    assert "gatewayOnline" in res
    assert "dccs" in res
    assert "summary" in res
    assert "cached" in res
    assert isinstance(res["dccs"], dict)
    summary = res["summary"]
    assert "total" in summary
    assert "online" in summary
    assert "listening" in summary
    assert summary["total"] == 5
    print(f"  list result: gatewayOnline={res['gatewayOnline']}, total={summary['total']}, "
          f"online={summary['online']}, listening={summary['listening']}, cached={res['cached']}")


def test_handle_status_missing_param():
    """缺少 dcc 参数应返回 error。"""
    result = _dc._handle_dcc_connections_status("test-req", {})
    assert "error" in result
    assert result["error"]["code"] == -32602


def test_handle_status_unknown_dcc():
    """未知 DCC 应返回 error。"""
    result = _dc._handle_dcc_connections_status("test-req", {"dcc": "photoshop"})
    assert "error" in result
    assert result["error"]["code"] == -32602


def test_handle_status_valid():
    """有效 DCC 返回详细状态。"""
    result = _dc._handle_dcc_connections_status("test-req", {"dcc": "blender"})
    assert "result" in result
    res = result["result"]
    assert res["dcc"] == "blender"
    assert "status" in res
    assert "statusLabel" in res
    assert "serverRunning" in res
    assert "mcpConnected" in res
    print(f"  Blender detail: status={res['status']} ({res['statusLabel']})")


def test_handle_events():
    """events handler 返回事件列表。"""
    result = _dc._handle_dcc_connections_events("test-req", {"limit": 5})
    assert "result" in result
    assert "events" in result["result"]
    assert isinstance(result["result"]["events"], list)
    print(f"  events: {len(result['result']['events'])} recorded")


def test_cache():
    """缓存 TTL 内不重复探测。"""
    # 清空缓存
    with _dc._cache_lock:
        _dc._cache.clear()
        _dc._cache_ts = 0.0

    result1 = _dc._handle_dcc_connections_list("t1", {})
    ts1 = _dc._cache_ts
    assert not result1["result"]["cached"], "First call should not be cached"

    # 立即再调一次
    result2 = _dc._handle_dcc_connections_list("t2", {})
    ts2 = _dc._cache_ts
    assert result2["result"]["cached"], "Second call within TTL should be cached"
    assert ts2 == ts1, "Cache timestamp should not change"
    print(f"  Cache test: first={not result1['result']['cached']}, second={result2['result']['cached']}")


def test_refresh():
    """refresh 跳过缓存。"""
    result = _dc._handle_dcc_connections_refresh("t3", {})
    assert "result" in result
    assert "dccs" in result["result"]
    res = result["result"]
    print(f"  Refresh: total={res['summary']['total']}, online={res['summary']['online']}")


def test_summary_counts():
    """汇总数据正确。"""
    result = _dc._handle_dcc_connections_list("t4", {})
    res = result["result"]
    summary = res["summary"]
    dccs = res["dccs"]

    # 验证汇总与实际数据一致
    actual_total = len(dccs)
    actual_online = sum(1 for d in dccs.values() if d["mcpConnected"])
    actual_listening = sum(1 for d in dccs.values() if d["serverRunning"])

    assert summary["total"] == actual_total
    assert summary["online"] == actual_online
    assert summary["listening"] == actual_listening
    print(f"  Counts verified: total={actual_total}, online={actual_online}, listening={actual_listening}")


def run_all():
    tests = [
        ("DCC Registry", test_dcc_registry),
        ("Check Functions", test_check_functions),
        ("Houdini No-Check", test_check_dcc_houdini_no_check),
        ("DCC Offline", test_check_dcc_offline),
        ("List Handler", test_handle_list),
        ("Status Missing Param", test_handle_status_missing_param),
        ("Status Unknown DCC", test_handle_status_unknown_dcc),
        ("Status Valid", test_handle_status_valid),
        ("Events Handler", test_handle_events),
        ("Cache TTL", test_cache),
        ("Refresh", test_refresh),
        ("Summary Counts", test_summary_counts),
    ]

    passed = 0
    failed = 0
    for name, fn in tests:
        try:
            fn()
            passed += 1
            print(f"  [PASS] {name}")
        except Exception as e:
            failed += 1
            print(f"  [FAIL] {name}: {e}")

    print(f"\n{'='*50}")
    print(f"Results: {passed} passed, {failed} failed, {len(tests)} total")
    return failed == 0


if __name__ == "__main__":
    success = run_all()
    sys.exit(0 if success else 1)
