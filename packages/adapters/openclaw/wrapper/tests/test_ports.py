"""端口探测模块测试。"""

import socket

import pytest
from artifex_nexus.openclaw_wrapper import ports


def test_is_port_available():
    """默认端口 19789 应该可用（测试环境）。"""
    assert ports.is_port_available(19789) is True


def test_is_port_available_invalid():
    """端口 0 是保留端口，应该不可用。"""
    # 端口 0 在某些系统上行为不同，这里测试负数端口
    with pytest.raises(OverflowError):
        ports.is_port_available(-1)


def test_find_available_port_default():
    """默认从 19789 开始扫描。"""
    port = ports.find_available_port()
    assert 19789 <= port <= 19789 + ports.PORT_STEP * (ports.MAX_TRIES - 1)


def test_find_available_port_custom_start():
    """从指定端口开始扫描。"""
    port = ports.find_available_port(start=19809)
    assert 19809 <= port <= 19809 + ports.PORT_STEP * (ports.MAX_TRIES - 1)


def test_find_available_port_no_available():
    """范围太小无可用端口时抛异常（仅 Unix 可靠，Win SO_REUSEADDR 语义不同）。"""
    import platform

    if platform.system() == "Windows":
        pytest.skip("Windows SO_REUSEADDR 语义不同，跳过此测试")

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 19789))
    sock.listen(1)
    try:
        with pytest.raises(RuntimeError, match="无可用端口"):
            ports.find_available_port(start=19789, end=19789)
    finally:
        sock.close()


def test_pick_port_default():
    """pick_port 默认返回 19789。"""
    port = ports.pick_port()
    assert port == 19789


def test_pick_port_with_step():
    """pick_port 按步进扫描。"""
    port = ports.pick_port(preferred=19789, step=20, max_tries=3)
    assert port in (19789, 19809, 19829)


def test_derived_segment_probe():
    """派生端口段 probe 应检查 base+2 和 CDP 段。"""
    # 19789 空闲时派生段也应空闲
    assert ports._probe_derived_segment(19789) is True


def test_read_write_last_port(tmp_path):
    """ports.json 读写测试。"""
    json_path = tmp_path / "ports.json"
    ports.write_last_port(str(json_path), 19789)
    assert ports.read_last_port(str(json_path)) == 19789

    # 写入 19809
    ports.write_last_port(str(json_path), 19809)
    assert ports.read_last_port(str(json_path)) == 19809


def test_read_last_port_nonexistent(tmp_path):
    """不存在的 ports.json 返回 None。"""
    json_path = tmp_path / "nonexistent" / "ports.json"
    assert ports.read_last_port(str(json_path)) is None
