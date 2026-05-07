"""doctor 模块测试。"""

from pathlib import Path

from artifex_nexus.openclaw_wrapper import doctor


def test_probe_tcp_available():
    """TCP 探测：19789 应该空闲（测试环境）。"""
    result = doctor._probe_tcp(19789)
    # 端口空闲时 connect_ex 返回非零（连接被拒绝或超时）
    # 这是正常的——没有服务在监听
    assert result.name == "tcp"
    # 不检查 healthy，因为端口可能被占用


def test_probe_tcp_invalid():
    """TCP 探测：无效端口（超出范围应抛异常）。"""
    import pytest
    with pytest.raises(OverflowError):
        doctor._probe_tcp(99999)


def test_probe_lock_nonexistent(tmp_path):
    """Lock 探测：不存在的目录。"""
    home = tmp_path / ".openclaw"
    result = doctor._probe_lock(home)
    assert result.name == "lock"
    assert result.healthy is False


def test_probe_lock_empty(tmp_path):
    """Lock 探测：空目录。"""
    home = tmp_path / ".openclaw"
    lock_dir = home / "state" / "lock"
    lock_dir.mkdir(parents=True)
    result = doctor._probe_lock(home)
    assert result.name == "lock"
    assert result.healthy is False  # 空目录 = 未启动


def test_probe_upstream_doctor_no_cli(tmp_path):
    """上游 doctor：CLI 未安装。"""
    home = tmp_path / ".openclaw"
    result = doctor._probe_upstream_doctor(home)
    assert result.name == "doctor"
    assert result.healthy is False
    assert "未安装" in result.message


def test_compute_overall_all_healthy():
    """全部健康 → healthy。"""
    channels = [
        doctor.ChannelResult(name="tcp", healthy=True, message="ok"),
        doctor.ChannelResult(name="lock", healthy=True, message="ok"),
        doctor.ChannelResult(name="doctor", healthy=True, message="ok"),
    ]
    overall, problems = doctor._compute_overall(channels)
    assert overall == "healthy"
    assert len(problems) == 0


def test_compute_overall_all_down():
    """全部不健康 → down。"""
    channels = [
        doctor.ChannelResult(name="tcp", healthy=False, message="fail"),
        doctor.ChannelResult(name="lock", healthy=False, message="fail"),
    ]
    overall, problems = doctor._compute_overall(channels)
    assert overall == "down"
    assert len(problems) == 2


def test_compute_overall_degraded():
    """部分健康 → degraded。"""
    channels = [
        doctor.ChannelResult(name="tcp", healthy=True, message="ok"),
        doctor.ChannelResult(name="lock", healthy=False, message="fail"),
    ]
    overall, problems = doctor._compute_overall(channels)
    assert overall == "degraded"
    assert len(problems) == 1


def test_compute_overall_empty():
    """无通道 → unknown。"""
    overall, problems = doctor._compute_overall([])
    assert overall == "unknown"


def test_check_openclaw_health(tmp_path):
    """完整健康检查（无 gateway 运行）。"""
    home = tmp_path / ".openclaw"
    report = doctor.check_openclaw_health(home, 19789)

    assert report.overall in ("down", "degraded")
    assert len(report.channels) >= 2  # tcp + lock + doctor
    assert report.port == 19789


def test_health_report_to_dict():
    """HealthReport.to_dict 测试。"""
    report = doctor.HealthReport(
        overall="healthy",
        channels=[
            doctor.ChannelResult(name="tcp", healthy=True, message="ok"),
        ],
        problems=[],
        port=19789,
    )
    d = report.to_dict()
    assert d["overall"] == "healthy"
    assert len(d["channels"]) == 1
    assert d["port"] == 19789


def test_is_gateway_healthy_no_gateway(tmp_path):
    """无 gateway 运行时 is_gateway_healthy 返回 False。"""
    home = tmp_path / ".openclaw"
    assert doctor.is_gateway_healthy(home, 19789) is False
