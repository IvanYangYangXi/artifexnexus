"""端口探测模块测试。"""

import pytest
from artifex_nexus.openclaw_wrapper import ports


def test_is_port_available():
    """默认端口 14523 应该可用（测试环境）。"""
    assert ports.is_port_available(14523) is True


def test_is_port_available_invalid():
    """端口 0 是保留端口，应该不可用。"""
    # 注意：端口 0 在某些系统上行为不同，这里测试负数端口
    with pytest.raises(OverflowError):
        ports.is_port_available(-1)


def test_find_available_port_default():
    """默认从 14523 开始扫描。"""
    port = ports.find_available_port()
    assert 14523 <= port <= ports.SCAN_RANGE_END


def test_find_available_port_custom_start():
    """从指定端口开始扫描。"""
    port = ports.find_available_port(start=14530)
    assert 14530 <= port <= ports.SCAN_RANGE_END


def test_find_available_port_no_available():
    """范围太小无可用端口时抛异常。"""
    # 绑定一个端口使其不可用
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 14550))
    sock.listen(1)
    try:
        with pytest.raises(RuntimeError, match="无可用端口"):
            ports.find_available_port(start=14550, end=14550)
    finally:
        sock.close()
