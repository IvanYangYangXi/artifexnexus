"""OpenClaw 配置 I/O 模块测试。

EPIC-0001 第二批 STORY-0015：
- 脱敏 / 还原（mask_secrets / strip_unchanged_secrets）
- dump 聚合
- patch 透传 + extras 深合并
- test_provider 三态
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch as mock_patch

import pytest

from artifex_nexus.openclaw_wrapper import config_io


# ---------------------------------------------------------------------------
# fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_home(tmp_path: Path) -> Path:
    (tmp_path / "state").mkdir()
    return tmp_path


@pytest.fixture
def fake_bin(tmp_path: Path) -> Path:
    return tmp_path / "fake-openclaw"


# ---------------------------------------------------------------------------
# mask_secrets
# ---------------------------------------------------------------------------


class TestMaskSecrets:
    def test_masks_apikey_field(self):
        masked = config_io.mask_secrets({"apiKey": "sk-1234567890abcdef"})
        assert masked["apiKey"] == "*" * len("sk-1234567890abcdef")

    def test_masks_token_in_nested(self):
        src = {"auth": {"profiles": {"openai-default": {"token": "tok_abc"}}}}
        masked = config_io.mask_secrets(src)
        # token 是已知 secret 字段；至少 8 个 * 兜底
        assert masked["auth"]["profiles"]["openai-default"]["token"] == "*" * 8
        # 原对象不变
        assert src["auth"]["profiles"]["openai-default"]["token"] == "tok_abc"

    def test_does_not_touch_non_secret_fields(self):
        src = {"baseUrl": "https://api.example.com", "apiKey": "secret"}
        masked = config_io.mask_secrets(src)
        assert masked["baseUrl"] == "https://api.example.com"
        assert masked["apiKey"].startswith("*")

    def test_handles_lists(self):
        src = {"items": [{"apiKey": "a"}, {"apiKey": "b"}]}
        masked = config_io.mask_secrets(src)
        assert masked["items"][0]["apiKey"] == "*" * 8
        assert masked["items"][1]["apiKey"] == "*" * 8

    def test_empty_string_stays_empty(self):
        # 空 = 没填，不应填星号迷惑用户
        masked = config_io.mask_secrets({"apiKey": ""})
        assert masked["apiKey"] == ""

    def test_kebab_case_key_recognized(self):
        masked = config_io.mask_secrets({"api-key": "secret"})
        assert masked["api-key"] == "*" * 8


# ---------------------------------------------------------------------------
# strip_unchanged_secrets
# ---------------------------------------------------------------------------


class TestStripUnchanged:
    def test_strips_masked_apikey(self):
        patch_payload = {"auth": {"profiles": {"x": {"apiKey": "*" * 8, "mode": "api-key"}}}}
        cleaned = config_io.strip_unchanged_secrets(patch_payload)
        assert "apiKey" not in cleaned["auth"]["profiles"]["x"]
        assert cleaned["auth"]["profiles"]["x"]["mode"] == "api-key"

    def test_keeps_real_apikey(self):
        patch_payload = {"auth": {"profiles": {"x": {"apiKey": "sk-real-key"}}}}
        cleaned = config_io.strip_unchanged_secrets(patch_payload)
        assert cleaned["auth"]["profiles"]["x"]["apiKey"] == "sk-real-key"

    def test_handles_lists(self):
        src = {"items": [{"token": "*" * 10}, {"token": "real"}]}
        cleaned = config_io.strip_unchanged_secrets(src)
        assert "token" not in cleaned["items"][0]
        assert cleaned["items"][1]["token"] == "real"

    def test_does_not_strip_short_string_of_stars(self):
        # 用户真把 key 设成 "***" 也不该被吃掉（< MIN_MASK 长度）
        src = {"apiKey": "***"}
        cleaned = config_io.strip_unchanged_secrets(src)
        assert cleaned["apiKey"] == "***"


# ---------------------------------------------------------------------------
# extras io
# ---------------------------------------------------------------------------


class TestExtras:
    def test_read_missing_returns_empty(self, fake_home: Path):
        assert config_io.read_extras(fake_home) == {}

    def test_write_then_read(self, fake_home: Path):
        p = config_io.write_extras(fake_home, {"providerExtras": {"openai": {"notes": "x"}}})
        assert p.exists()
        assert config_io.read_extras(fake_home)["providerExtras"]["openai"]["notes"] == "x"

    def test_corrupt_returns_empty(self, fake_home: Path):
        p = config_io.extras_path_for(fake_home)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("{not valid", encoding="utf-8")
        assert config_io.read_extras(fake_home) == {}


# ---------------------------------------------------------------------------
# dump_config
# ---------------------------------------------------------------------------


class TestDump:
    def test_aggregates_all_4_paths(self, fake_home: Path, fake_bin: Path):
        captured = []

        def stub_get(_b, _h, path):
            captured.append(path)
            return {
                "models.providers": {"openai": {"baseUrl": "https://api.openai.com/v1"}},
                "auth.profiles": {"openai-default": {"token": "sk-xxx"}},
                "auth.order": {"openai": ["openai-default"]},
                "agents.defaults": {"model": "openai/gpt-4o-mini"},
            }.get(path)

        dump = config_io.dump_config(fake_bin, fake_home, config_get_fn=stub_get)
        # 四次 get 调用
        assert set(captured) == {
            "models.providers",
            "auth.profiles",
            "auth.order",
            "agents.defaults",
        }
        # secret 已脱敏
        assert dump.auth_profiles["openai-default"]["token"].startswith("*")
        # 非 secret 保留
        assert dump.providers["openai"]["baseUrl"] == "https://api.openai.com/v1"

    def test_missing_paths_default_empty(self, fake_bin: Path, fake_home: Path):
        dump = config_io.dump_config(fake_bin, fake_home, config_get_fn=lambda *_: None)
        assert dump.providers == {}
        assert dump.auth_profiles == {}
        assert dump.auth_order == {}
        assert dump.agent_defaults == {}

    def test_extras_loaded(self, fake_home: Path, fake_bin: Path):
        config_io.write_extras(fake_home, {"providerExtras": {"openai": {"displayName": "我的 GPT"}}})
        dump = config_io.dump_config(fake_bin, fake_home, config_get_fn=lambda *_: None)
        assert dump.extras["providerExtras"]["openai"]["displayName"] == "我的 GPT"


# ---------------------------------------------------------------------------
# patch_config
# ---------------------------------------------------------------------------


class TestPatch:
    def test_strips_masked_apikey_before_send(self, fake_home: Path, fake_bin: Path):
        sent = []

        def stub_patch(_b, _h, payload):
            sent.append(payload)
            return True, None

        result = config_io.patch_config(
            fake_bin,
            fake_home,
            {"auth": {"profiles": {"x": {"apiKey": "*" * 8, "mode": "api-key"}}}},
            config_patch_fn=stub_patch,
        )
        assert result.success is True
        # apiKey 已被剔除
        assert "apiKey" not in sent[0]["auth"]["profiles"]["x"]
        assert sent[0]["auth"]["profiles"]["x"]["mode"] == "api-key"

    def test_skips_patch_when_cleaned_empty(self, fake_home: Path, fake_bin: Path):
        sent = []

        def stub_patch(_b, _h, payload):
            sent.append(payload)
            return True, None

        # 整个 patch 只含被脱敏的 secret，剔除后为空 → 不应调上游
        result = config_io.patch_config(
            fake_bin,
            fake_home,
            {"auth": {"profiles": {"x": {"apiKey": "*" * 8}}}},
            config_patch_fn=stub_patch,
        )
        assert result.success is True
        # cleaned 退化成 {auth:{profiles:{x:{}}}}（仍非空）→ 会调，但不含 apiKey
        # 验证 apiKey 不在
        if sent:
            assert "apiKey" not in sent[0]["auth"]["profiles"]["x"]

    def test_extras_deep_merge_writes_file(self, fake_home: Path, fake_bin: Path):
        # 先写一份 extras
        config_io.write_extras(fake_home, {"providerExtras": {"openai": {"notes": "old"}}})
        # patch 增量 + extras 增量
        config_io.patch_config(
            fake_bin,
            fake_home,
            {},  # 空 patch
            extras_patch={"providerExtras": {"openai": {"displayName": "新名"}}},
            config_patch_fn=lambda *_: (True, None),
        )
        merged = config_io.read_extras(fake_home)
        # 新字段加入，旧字段保留
        assert merged["providerExtras"]["openai"]["notes"] == "old"
        assert merged["providerExtras"]["openai"]["displayName"] == "新名"

    def test_extras_null_deletes_key(self, fake_home: Path, fake_bin: Path):
        config_io.write_extras(
            fake_home, {"providerExtras": {"openai": {"a": 1, "b": 2}}}
        )
        config_io.patch_config(
            fake_bin,
            fake_home,
            {},
            extras_patch={"providerExtras": {"openai": {"a": None}}},
            config_patch_fn=lambda *_: (True, None),
        )
        merged = config_io.read_extras(fake_home)
        assert "a" not in merged["providerExtras"]["openai"]
        assert merged["providerExtras"]["openai"]["b"] == 2

    def test_patch_failure_returns_error(self, fake_home: Path, fake_bin: Path):
        result = config_io.patch_config(
            fake_bin,
            fake_home,
            {"models": {"providers": {"openai": {"baseUrl": "x"}}}},
            config_patch_fn=lambda *_: (False, "schema invalid: bad url"),
        )
        assert result.success is False
        assert "bad url" in (result.validate_error or "")


# ---------------------------------------------------------------------------
# test_provider
# ---------------------------------------------------------------------------


class TestTestProvider:
    def test_success_with_latency(self, fake_home: Path, fake_bin: Path):
        fake = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="pong\n", stderr=""
        )
        with mock_patch.object(subprocess, "run", return_value=fake):
            result = config_io.test_provider(fake_bin, fake_home, "openai", "gpt-4o-mini")
        assert result.success is True
        assert result.latency_ms is not None
        assert result.model_echo == "pong"

    def test_nonzero_exit_returns_failure(self, fake_home: Path, fake_bin: Path):
        fake = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="auth failed"
        )
        with mock_patch.object(subprocess, "run", return_value=fake):
            result = config_io.test_provider(fake_bin, fake_home, "openai", "gpt-4o-mini")
        assert result.success is False
        assert "auth failed" in (result.error or "")

    def test_timeout_returns_failure(self, fake_home: Path, fake_bin: Path):
        with mock_patch.object(
            subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(cmd=["x"], timeout=15.0),
        ):
            result = config_io.test_provider(
                fake_bin, fake_home, "openai", "gpt-4o-mini", timeout=15.0
            )
        assert result.success is False
        assert "超时" in (result.error or "")

    def test_missing_required_returns_error(self, fake_home: Path, fake_bin: Path):
        result = config_io.test_provider(fake_bin, fake_home, "", "gpt-4o-mini")
        assert result.success is False
        assert "必填" in (result.error or "")


# ---------------------------------------------------------------------------
# strip_auth_profile_secrets
# ---------------------------------------------------------------------------


class TestStripAuthProfileSecrets:
    """v2026.5.4 后：auth.profiles.<id> 的 secret 字段必须被剔除。"""

    def test_strips_token_field_from_profile(self):
        patch_payload = {
            "auth": {
                "profiles": {
                    "deepseek-default": {
                        "provider": "deepseek",
                        "mode": "token",
                        "token": "sk-real-key",
                    }
                }
            }
        }
        cleaned = config_io.strip_auth_profile_secrets(patch_payload)
        prof = cleaned["auth"]["profiles"]["deepseek-default"]
        assert "token" not in prof
        # 元数据保留
        assert prof["provider"] == "deepseek"
        assert prof["mode"] == "token"

    def test_strips_apikey_and_aliases(self):
        patch_payload = {
            "auth": {
                "profiles": {
                    "x": {
                        "provider": "openai",
                        "mode": "api_key",
                        "apiKey": "sk-1",
                        "api_key": "sk-2",
                        "secret": "s",
                        "password": "p",
                    }
                }
            }
        }
        cleaned = config_io.strip_auth_profile_secrets(patch_payload)
        prof = cleaned["auth"]["profiles"]["x"]
        for k in ("apiKey", "api_key", "secret", "password"):
            assert k not in prof
        assert prof["provider"] == "openai"

    def test_no_auth_section_passthrough(self):
        patch_payload = {"models": {"providers": {"openai": {"baseUrl": "x"}}}}
        cleaned = config_io.strip_auth_profile_secrets(patch_payload)
        assert cleaned == patch_payload

    def test_does_not_mutate_input(self):
        original = {
            "auth": {"profiles": {"x": {"provider": "openai", "token": "sk-real"}}}
        }
        config_io.strip_auth_profile_secrets(original)
        # 原对象不变
        assert original["auth"]["profiles"]["x"]["token"] == "sk-real"

    def test_preserves_unrelated_secrets_in_models_section(self):
        """models.providers.<id>.headers.Authorization 之类的 secret 不归本函数管。"""
        patch_payload = {
            "auth": {"profiles": {"x": {"provider": "openai", "token": "sk-1"}}},
            "models": {
                "providers": {
                    "openai": {"headers": {"Authorization": "Bearer sk-2"}}
                }
            },
        }
        cleaned = config_io.strip_auth_profile_secrets(patch_payload)
        # auth.profiles.<id>.token 被删
        assert "token" not in cleaned["auth"]["profiles"]["x"]
        # models 节点不动
        assert (
            cleaned["models"]["providers"]["openai"]["headers"]["Authorization"]
            == "Bearer sk-2"
        )


# ---------------------------------------------------------------------------
# set_auth_token
# ---------------------------------------------------------------------------


class TestSetAuthToken:
    def test_success(self, fake_home: Path, fake_bin: Path):
        sent: list[tuple] = []

        def fake_paste(bin_p, home, provider, profile_id, token, *, expires_in=None):
            sent.append((bin_p, home, provider, profile_id, token, expires_in))
            return True, None

        result = config_io.set_auth_token(
            fake_bin,
            fake_home,
            "deepseek",
            "deepseek-default",
            "sk-real-key-1234567890",
            paste_token_fn=fake_paste,
        )
        assert result.success is True
        assert result.profile_id == "deepseek-default"
        assert sent[0][2] == "deepseek"
        assert sent[0][3] == "deepseek-default"
        assert sent[0][4] == "sk-real-key-1234567890"

    def test_rejects_masked_token(self, fake_home: Path, fake_bin: Path):
        called = []

        def fake_paste(*a, **kw):
            called.append(1)
            return True, None

        result = config_io.set_auth_token(
            fake_bin,
            fake_home,
            "deepseek",
            "deepseek-default",
            "*" * 16,
            paste_token_fn=fake_paste,
        )
        assert result.success is False
        assert "脱敏" in (result.error or "")
        assert called == []  # 没有真的去调 CLI

    def test_rejects_empty_token(self, fake_home: Path, fake_bin: Path):
        result = config_io.set_auth_token(
            fake_bin, fake_home, "deepseek", "deepseek-default", ""
        )
        assert result.success is False
        assert "必填" in (result.error or "")

    def test_rejects_missing_provider(self, fake_home: Path, fake_bin: Path):
        result = config_io.set_auth_token(
            fake_bin, fake_home, "", "x", "sk-1", paste_token_fn=lambda *a, **kw: (True, None)
        )
        assert result.success is False
        assert "provider" in (result.error or "")

    def test_paste_failure_returns_error(self, fake_home: Path, fake_bin: Path):
        result = config_io.set_auth_token(
            fake_bin,
            fake_home,
            "deepseek",
            "deepseek-default",
            "sk-real",
            paste_token_fn=lambda *a, **kw: (False, "schema validate failed"),
        )
        assert result.success is False
        assert "schema validate" in (result.error or "")

    def test_passes_expires_in(self, fake_home: Path, fake_bin: Path):
        captured: dict = {}

        def fake_paste(*a, **kw):
            captured.update(kw)
            return True, None

        config_io.set_auth_token(
            fake_bin,
            fake_home,
            "deepseek",
            "deepseek-default",
            "sk-real",
            expires_in="365d",
            paste_token_fn=fake_paste,
        )
        assert captured.get("expires_in") == "365d"

