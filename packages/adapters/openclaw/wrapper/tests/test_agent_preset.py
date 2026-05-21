"""Artifex Nexus 默认 agent 预设注入测试。

EPIC-0001 第二批 STORY-0017：
- 模板渲染 + JSON 转义
- checksum 稳定性
- upsert_by_id 4 种场景
- install 三态（首次 / 重复未改 / 重复已改）+ force
- lock 文件读写
- bootstrap 末尾失败不阻塞
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from artifex_nexus.openclaw_wrapper import agent_preset


# ---------------------------------------------------------------------------
# fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_home(tmp_path: Path) -> Path:
    """为 install 测试准备的 OPENCLAW_HOME（state/ workspace/ 都建好）。"""
    (tmp_path / "state").mkdir()
    (tmp_path / "workspace").mkdir()
    return tmp_path


@pytest.fixture
def fake_bin(tmp_path: Path) -> Path:
    """伪造 openclaw 可执行文件路径（不会真的执行，因为 install 用 fn 注入）。"""
    return tmp_path / "fake-openclaw"


# ---------------------------------------------------------------------------
# render_v1_0_0 / 模板
# ---------------------------------------------------------------------------


class TestRender:
    def test_renders_valid_json_with_real_assets(self, fake_home: Path):
        """读真实 assets 模板与 prompt，渲染后是合法 JSON 且包含关键字段。"""
        preset = agent_preset.render_v1_0_0(fake_home)
        assert preset["id"] == "artifex-nexus"
        assert preset["default"] is True
        assert "skills" not in preset  # 不限制，让 agent 可用所有已安装 skill
        assert preset["agentRuntime"]["id"] == "pi"
        assert preset["workspace"].endswith("workspace") or "workspace" in preset["workspace"]
        # system prompt 含关键字
        assert "Artifex Nexus" in preset["systemPromptOverride"]
        assert "DCC" in preset["systemPromptOverride"]
        # 不含模型字段（spec §2.4）
        assert "model" not in preset

    def test_workspace_path_is_substituted(self, fake_home: Path):
        preset = agent_preset.render_v1_0_0(fake_home)
        assert "{{OPENCLAW_WORKSPACE}}" not in preset["workspace"]
        assert str(fake_home / "workspace") in preset["workspace"]

    def test_system_prompt_with_special_chars(self, fake_home: Path):
        """system prompt 含双引号、反斜杠、换行也能正确转义。"""
        weird = 'line1\n"quoted"\\backslash\n'
        preset = agent_preset.render_v1_0_0(
            fake_home,
            template_text=(
                '{"id":"artifex-nexus","systemPromptOverride":{{SYSTEM_PROMPT_JSON}},'
                '"workspace":"{{OPENCLAW_WORKSPACE}}"}'
            ),
            system_prompt=weird,
        )
        assert preset["systemPromptOverride"] == weird

    def test_workspace_with_backslash_path(self, tmp_path: Path):
        """Windows 路径 (含 \\) 也要正确 JSON 转义。"""
        win_home = tmp_path / "winpath"
        win_home.mkdir()
        preset = agent_preset.render_v1_0_0(
            win_home,
            template_text='{"id":"artifex-nexus","workspace":"{{OPENCLAW_WORKSPACE}}",'
            '"systemPromptOverride":{{SYSTEM_PROMPT_JSON}}}',
            system_prompt="x",
        )
        # 不会因路径里有 \ 把 JSON 撑坏
        assert preset["id"] == "artifex-nexus"

    def test_invalid_template_raises(self, fake_home: Path):
        with pytest.raises(ValueError):
            agent_preset.render_v1_0_0(
                fake_home, template_text="not valid {{SYSTEM_PROMPT_JSON}} json",
                system_prompt="x",
            )


# ---------------------------------------------------------------------------
# checksum
# ---------------------------------------------------------------------------


class TestChecksum:
    def test_stable_across_key_order(self):
        a = {"id": "x", "skills": ["a", "b"]}
        b = {"skills": ["a", "b"], "id": "x"}
        assert agent_preset.compute_checksum(a) == agent_preset.compute_checksum(b)

    def test_changes_on_value_change(self):
        a = {"id": "x", "skills": ["a"]}
        b = {"id": "x", "skills": ["b"]}
        assert agent_preset.compute_checksum(a) != agent_preset.compute_checksum(b)


# ---------------------------------------------------------------------------
# upsert_by_id
# ---------------------------------------------------------------------------


class TestUpsert:
    def test_empty_list_appends(self):
        out = agent_preset.upsert_by_id([], {"id": "artifex-nexus", "x": 1})
        assert out == [{"id": "artifex-nexus", "x": 1}]

    def test_replace_same_id(self):
        existing = [{"id": "other", "y": 1}, {"id": "artifex-nexus", "x": 1}]
        out = agent_preset.upsert_by_id(existing, {"id": "artifex-nexus", "x": 2})
        assert out == [{"id": "other", "y": 1}, {"id": "artifex-nexus", "x": 2}]

    def test_append_when_no_match(self):
        existing = [{"id": "other"}]
        out = agent_preset.upsert_by_id(existing, {"id": "artifex-nexus"})
        assert out == [{"id": "other"}, {"id": "artifex-nexus"}]

    def test_dedup_multiple_same_id(self):
        existing = [
            {"id": "artifex-nexus", "v": 1},
            {"id": "other"},
            {"id": "artifex-nexus", "v": 2},
        ]
        out = agent_preset.upsert_by_id(existing, {"id": "artifex-nexus", "v": "new"})
        assert out == [{"id": "artifex-nexus", "v": "new"}, {"id": "other"}]

    def test_none_existing_treated_as_empty(self):
        out = agent_preset.upsert_by_id(None, {"id": "artifex-nexus"})  # type: ignore[arg-type]
        assert out == [{"id": "artifex-nexus"}]

    def test_missing_id_raises(self):
        with pytest.raises(ValueError):
            agent_preset.upsert_by_id([], {"name": "no-id"})


# ---------------------------------------------------------------------------
# lock io
# ---------------------------------------------------------------------------


class TestLock:
    def test_write_then_read_roundtrip(self, fake_home: Path):
        p = agent_preset.write_lock(fake_home, "1.0.0", "sha256:abc")
        assert p.exists()
        lock = agent_preset.read_lock(fake_home)
        assert lock is not None
        assert lock["version"] == "1.0.0"
        assert lock["checksum"] == "sha256:abc"
        assert "installedAt" in lock

    def test_read_missing_returns_none(self, tmp_path: Path):
        assert agent_preset.read_lock(tmp_path) is None

    def test_read_corrupt_returns_none(self, fake_home: Path):
        p = agent_preset.lock_path_for(fake_home)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("{not valid json", encoding="utf-8")
        assert agent_preset.read_lock(fake_home) is None


# ---------------------------------------------------------------------------
# install_default_preset 三态
# ---------------------------------------------------------------------------


class _Recorder:
    """记录 patch 调用与模拟 config get 的迷你 stub。"""

    def __init__(self, get_returns=None):
        self.get_calls: list[str] = []
        self.patch_calls: list[dict] = []
        self.get_returns = get_returns if get_returns is not None else []
        self._get_idx = 0
        self.patch_ok = True
        # 模拟 openclaw.json 的当前 agents.list 状态（patch 时同步更新）
        self.current_state: list[dict] = []

    def get(self, _bin, _home, path):
        self.get_calls.append(path)
        # 让 status 检查能"看到"上一次 patch 的结果
        return list(self.current_state)

    def patch(self, _bin, _home, payload):
        self.patch_calls.append(payload)
        # 同步更新 current_state，模拟上游真实生效
        if isinstance(payload, dict):
            agents = payload.get("agents", {})
            if isinstance(agents, dict) and isinstance(agents.get("list"), list):
                self.current_state = list(agents["list"])
        return self.patch_ok


class TestInstall:
    def test_first_install_creates_lock_and_patches(self, fake_home: Path, fake_bin: Path):
        rec = _Recorder()
        result = agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        assert result.success is True
        assert result.action == "installed"
        # patch 被调用一次，且 payload 是 {agents:{list:[...]}}
        assert len(rec.patch_calls) == 1
        merged = rec.patch_calls[0]["agents"]["list"]
        assert any(a["id"] == "artifex-nexus" for a in merged)
        # lock 文件被写
        lock = agent_preset.read_lock(fake_home)
        assert lock is not None
        assert lock["version"] == "1.0.0"

    def test_repeat_unchanged_skips(self, fake_home: Path, fake_bin: Path):
        rec = _Recorder()
        # 第一次安装
        agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        patch_calls_after_first = len(rec.patch_calls)

        # 第二次（lock checksum 与渲染一致 + 上游含同条目）→ 跳过
        result2 = agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        assert result2.success is True
        assert result2.action == "skipped-same-checksum"
        # 没有再 patch
        assert len(rec.patch_calls) == patch_calls_after_first

    def test_repeat_user_modified_warns_and_skips(
        self, fake_home: Path, fake_bin: Path
    ):
        rec = _Recorder()
        # 第一次安装
        agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        # 模拟用户改了配置（修改 current_state 中 artifex-nexus 的 name）
        for a in rec.current_state:
            if a.get("id") == "artifex-nexus":
                a["name"] = "用户改的名字"

        # 改 lock checksum 让"未改"路径不命中（强制走"用户改过"分支）
        # 实际上即便 checksum 不变也会经 is_modified_by_user 判定一次；这里直接改 lock
        lock = agent_preset.read_lock(fake_home)
        assert lock is not None
        lock["checksum"] = "sha256:different"
        agent_preset.lock_path_for(fake_home).write_text(
            json.dumps(lock), encoding="utf-8"
        )

        result2 = agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        assert result2.success is True
        assert result2.action == "skipped-user-modified"

    def test_force_overwrites_user_modification(
        self, fake_home: Path, fake_bin: Path
    ):
        rec = _Recorder()
        # 先安装 + 改 + lock 不一致
        agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        for a in rec.current_state:
            if a.get("id") == "artifex-nexus":
                a["name"] = "用户改的名字"
        # force=True
        result = agent_preset.reset_default(
            fake_bin, fake_home, force=True, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        assert result.success is True
        assert result.action == "forced"
        # 应该再次 patch
        assert len(rec.patch_calls) >= 2
        # 新 patch 里 artifex-nexus 的 name 回到模板默认（含 "DCC"）
        last = rec.patch_calls[-1]["agents"]["list"]
        found = next(a for a in last if a["id"] == "artifex-nexus")
        assert "DCC" in found["name"]

    def test_patch_failure_returns_failed(self, fake_home: Path, fake_bin: Path):
        rec = _Recorder()
        rec.patch_ok = False
        result = agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        assert result.success is False
        assert result.action == "failed"
        assert "patch" in (result.error or "")
        # 没写 lock
        assert agent_preset.read_lock(fake_home) is None

    def test_get_returns_non_list_fails(self, fake_home: Path, fake_bin: Path):
        def bad_get(_b, _h, _p):
            return {"unexpected": "object"}

        rec = _Recorder()
        result = agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=bad_get, config_patch_fn=rec.patch
        )
        assert result.success is False
        assert result.action == "failed"
        assert "数组" in (result.error or "")

    def test_user_deleted_preset_reinstalls(self, fake_home: Path, fake_bin: Path):
        """checksum 命中但 openclaw.json 中预设被用户删了 → 重新注入。"""
        rec = _Recorder()
        # 第一次安装
        agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        # 用户删了
        rec.current_state = [a for a in rec.current_state if a.get("id") != "artifex-nexus"]
        n_before = len(rec.patch_calls)
        result = agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        assert result.success is True
        # 因为上游已经没条目了，应该重新 patch
        assert len(rec.patch_calls) > n_before


# ---------------------------------------------------------------------------
# get_status
# ---------------------------------------------------------------------------


class TestStatus:
    def test_status_when_not_installed(self, fake_home: Path, fake_bin: Path):
        rec = _Recorder()
        s = agent_preset.get_status(fake_bin, fake_home, config_get_fn=rec.get)
        assert s.installed is False
        assert s.version is None
        assert s.modified_by_user is False
        assert s.lock_path.endswith("artifex-nexus-preset.lock")

    def test_status_when_installed_unchanged(self, fake_home: Path, fake_bin: Path):
        rec = _Recorder()
        agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        s = agent_preset.get_status(fake_bin, fake_home, config_get_fn=rec.get)
        assert s.installed is True
        assert s.version == "1.0.0"
        assert s.modified_by_user is False

    def test_status_detects_user_modification(self, fake_home: Path, fake_bin: Path):
        rec = _Recorder()
        agent_preset.install_default_preset(
            fake_bin, fake_home, config_get_fn=rec.get, config_patch_fn=rec.patch
        )
        for a in rec.current_state:
            if a.get("id") == "artifex-nexus":
                a["name"] = "改了"
        s = agent_preset.get_status(fake_bin, fake_home, config_get_fn=rec.get)
        assert s.installed is True
        assert s.modified_by_user is True
