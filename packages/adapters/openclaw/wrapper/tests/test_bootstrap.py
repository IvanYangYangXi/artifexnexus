"""bootstrap 模块测试。"""

import json
from pathlib import Path

import pytest
from artifex_nexus.openclaw_wrapper import bootstrap


def test_create_directory_layout(tmp_path):
    """目录布局创建测试。"""
    home = tmp_path / ".openclaw"
    created = bootstrap._create_directory_layout(home)

    assert len(created) > 0
    assert (home / "state" / "lock").exists()
    assert (home / "workspace" / "skills" / "official").exists()
    assert (home / "workspace" / "skills" / "team").exists()
    assert (home / "workspace" / "skills" / "user").exists()


def test_create_directory_layout_idempotent(tmp_path):
    """重复创建目录布局是幂等的。"""
    home = tmp_path / ".openclaw"
    first = bootstrap._create_directory_layout(home)
    second = bootstrap._create_directory_layout(home)

    assert len(first) > 0
    assert len(second) == 0  # 第二次不创建新目录


def test_generate_default_config():
    """默认配置生成测试。"""
    home = Path("/tmp/test/.openclaw")
    config = bootstrap._generate_default_config(home, 19789)

    assert config["gateway"]["port"] == 19789
    assert config["gateway"]["mode"] == "local"
    assert "workspace" in config["agents"]["defaults"]
    # review P0-4/P0-5: 验证 browser.cdpPortRangeStart 和 plugins.entries
    assert config["browser"]["cdpPortRangeStart"] == 19789 + 11
    assert config["plugins"]["entries"]["browser"]["enabled"] is True
    assert config["plugins"]["entries"]["file-transfer"]["enabled"] is True
    # 确认不包含上游不存在的字段
    assert "token" not in config["gateway"]
    assert "controlPort" not in config["browser"]
    assert "version" not in config


def test_write_config_new(tmp_path):
    """新配置文件写入测试。"""
    config_path = tmp_path / "openclaw.json"
    config = bootstrap._generate_default_config(tmp_path, 19789)
    config["version"] = "v2026.5.4"

    bootstrap._write_config(config_path, config)

    assert config_path.exists()
    data = json.loads(config_path.read_text(encoding="utf-8"))
    assert data["gateway"]["port"] == 19789
    assert data["version"] == "v2026.5.4"


def test_write_config(tmp_path):
    """写入配置测试。"""
    config_path = tmp_path / "openclaw.json"

    config = bootstrap._generate_default_config(tmp_path, 19789)
    bootstrap._write_config(config_path, config)

    loaded = json.loads(config_path.read_text(encoding="utf-8"))
    assert loaded["gateway"]["port"] == 19789
    assert loaded["gateway"]["mode"] == "local"
    assert loaded["plugins"]["entries"]["browser"]["enabled"] is True
    assert loaded["plugins"]["entries"]["file-transfer"]["enabled"] is True


def test_bootstrap_full(tmp_path):
    """完整 bootstrap 流程测试。"""
    home = tmp_path / ".openclaw"
    result = bootstrap.bootstrap(home, "v2026.5.4", 19789)

    assert result.success is True
    assert result.config_path.exists()
    assert (home / "state" / "lock").exists()
    assert (home / "workspace" / "skills" / "official").exists()


def test_bootstrap_idempotent(tmp_path):
    """重复 bootstrap 是幂等的。"""
    home = tmp_path / ".openclaw"

    result1 = bootstrap.bootstrap(home, "v2026.5.4", 19789)
    assert result1.success is True

    result2 = bootstrap.bootstrap(home, "v2026.5.4", 19789)
    assert result2.success is True
    # 幂等：重复 bootstrap 不报错


def test_is_bootstrap_done(tmp_path):
    """is_bootstrap_done 检查。"""
    home = tmp_path / ".openclaw"

    assert bootstrap.is_bootstrap_done(home) is False

    bootstrap.bootstrap(home, "v2026.5.4", 19789)
    assert bootstrap.is_bootstrap_done(home) is True


def test_read_config(tmp_path):
    """read_config 测试。"""
    home = tmp_path / ".openclaw"
    bootstrap.bootstrap(home, "v2026.5.4", 19789)

    config = bootstrap.read_config(home)
    assert config is not None
    assert config["gateway"]["port"] == 19789
    assert config["gateway"]["mode"] == "local"


def test_read_config_nonexistent(tmp_path):
    """不存在的配置返回 None。"""
    home = tmp_path / ".nonexistent"
    assert bootstrap.read_config(home) is None


def test_read_config_tolerates_utf8_bom(tmp_path):
    """openclaw.json 被 PowerShell 等工具加了 UTF-8 BOM 后仍能读取。

    STORY-0039 bug 复现：BOM (EF BB BF) 开头的 openclaw.json 原本会让
    ``json.loads`` 抛 ``JSONDecodeError``，导致 ``read_config`` 静默返回
    ``None``，上层 ``get_gateway_token`` 拿不到 token，前端 WS 握手
    ``token_missing`` 1008。
    """
    home = tmp_path / ".openclaw"
    home.mkdir()
    cfg_path = home / "openclaw.json"
    payload = b'\xef\xbb\xbf{"gateway":{"port":19789,"auth":{"mode":"token","token":"secret-x"}}}'
    cfg_path.write_bytes(payload)

    config = bootstrap.read_config(home)
    assert config is not None, "带 BOM 的配置必须能读回（符合 .ai/rules 铁律 §8）"
    assert config["gateway"]["port"] == 19789
    assert bootstrap.get_gateway_token(home) == "secret-x"


def test_bootstrap_fixed_port_writes_19789_even_when_busy(tmp_path, monkeypatch):
    """bootstrap_fixed_port 不再自动迁移到 19809，openclaw.json 永远写 19789。

    STORY-0039 方案 A 验证：模拟 pick_port 会选 19809 的场景，新入口必须
    依然写 19789 到 openclaw.json（配置稳定不漂移）。
    """
    from artifex_nexus.openclaw_wrapper import ports as _ports_mod

    # 假装 pick_port 会迁移（即使上游端口探测会选 19809，也不能影响我们写值）
    monkeypatch.setattr(_ports_mod, "pick_port", lambda preferred=19789, **_: 19809)

    home = tmp_path / ".openclaw"
    result, selected = bootstrap.bootstrap_fixed_port(home, "v2026.5.4", port=19789)

    assert selected == 19789
    assert result.success
    config = bootstrap.read_config(home)
    assert config is not None
    assert config["gateway"]["port"] == 19789, "bootstrap_fixed_port 不应迁移端口"

    # run/ports.json 也必须写 19789
    ports_json = home.parent / "run" / "ports.json"
    import json as _json
    data = _json.loads(ports_json.read_text(encoding="utf-8"))
    assert data["gateway_port"] == 19789


def test_reset_config_port_if_drifted_heals_legacy_19809(tmp_path, monkeypatch):
    """reset_config_port_if_drifted：检测到 19809 等漂移值 → 改回 19789。

    模拟 CLI 不可用的场景（无 openclaw 可执行文件），只测试 ports.json 层的
    修正和 config patch 调用路径；patch 本身由 config_io 单测覆盖。
    """
    home = tmp_path / ".openclaw"
    home.mkdir()
    # 人工写一个漂移的 config
    cfg = {"gateway": {"port": 19809, "auth": {"mode": "token", "token": "t"}}}
    (home / "openclaw.json").write_text(
        '{"gateway":{"port":19809,"auth":{"mode":"token","token":"t"}}}',
        encoding="utf-8",
    )
    # ports.json 也是漂移值
    run_dir = home.parent / "run"
    run_dir.mkdir()
    (run_dir / "ports.json").write_text(
        '{"gateway_port":19809,"control_port":19811,"cdp_range":"19820-19919"}',
        encoding="utf-8",
    )

    # CLI 不可用 → 只修 ports.json
    from artifex_nexus.openclaw_wrapper import _subprocess as _sp
    monkeypatch.setattr(_sp, "find_openclaw_bin", lambda home: None)

    old = bootstrap.reset_config_port_if_drifted(home)
    assert old == 19809

    import json as _json
    data = _json.loads((run_dir / "ports.json").read_text(encoding="utf-8"))
    assert data["gateway_port"] == 19789, "ports.json 必须修回 19789"


def test_get_gateway_port(tmp_path):
    """get_gateway_port 测试。"""
    home = tmp_path / ".openclaw"
    bootstrap.bootstrap(home, "v2026.5.4", 19809)

    assert bootstrap.get_gateway_port(home) == 19809


def test_get_gateway_port_default(tmp_path):
    """无配置时返回默认端口。"""
    home = tmp_path / ".nonexistent"
    assert bootstrap.get_gateway_port(home) == 19789


def test_get_gateway_token(tmp_path):
    """get_gateway_token 测试（上游无 token 字段，返回 None）。"""
    home = tmp_path / ".openclaw"
    bootstrap.bootstrap(home, "v2026.5.4", 19789)

    token = bootstrap.get_gateway_token(home)
    # v2026.5.4 上游无 gateway.token 字段
    assert token is None
