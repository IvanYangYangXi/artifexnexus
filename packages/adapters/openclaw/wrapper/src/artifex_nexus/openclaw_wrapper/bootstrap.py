"""
首启初始化：目录结构、默认 openclaw.json、Skill 预装。

Bootstrap: creates the full ~/.artifexnexus/.openclaw/ directory layout,
generates a self-contained openclaw.json (skipping upstream onboard wizard),
and copies official skills.

关键设计决策：
- schema 探测策略：首次 implement 时 spawn 一次默认 openclaw 拿 default config
  （TBD T1：v2026.5.4 openclaw.json 实际 schema 待实测核对）
- artclaw 历史脚本字段逐项裁剪复用 / 弃用（详见 survey §8）
- 幂等性：重复 bootstrap 不覆盖已有 token
- 失败回滚：已创建的目录不留半成品
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# 支持包内导入和直接执行两种方式
try:
    from . import ports as _ports
except ImportError:
    import ports as _ports  # type: ignore[no-redef]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DEFAULT_PORT = 19789
"""默认 gateway 端口。"""

DEFAULT_WORKSPACE = "workspace"
"""agents.defaults.workspace 相对路径。"""

SKILL_DIRS = ["official", "team", "user"]
"""workspace/skills/ 下的子目录。"""

# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class BootstrapResult:
    """bootstrap 操作结果。

    Result of a bootstrap operation.
    """

    success: bool
    """是否成功。"""
    created_dirs: list[Path] = field(default_factory=list)
    """新创建的目录列表。"""
    config_path: Path = field(default_factory=Path)
    """openclaw.json 路径。"""
    error_message: str = ""
    """错误信息。"""


# ---------------------------------------------------------------------------
# openclaw.json 默认模板
# ---------------------------------------------------------------------------

# TBD T1 已解决（2026-05-07）：通过 `openclaw config schema` 实测 v2026.5.4 上游 schema。
#
# 实测结论：
# - gateway.port ✅ 存在
# - gateway.token ❌ 上游无此字段（认证通过 gateway.auth 或 channels 配置）
# - browser.controlPort ❌ 上游无此字段（CDP 端口通过 browser.cdpPortRangeStart 控制）
# - agents.defaults.workspace ✅ 存在
# - plugins ❌ 期望 object（plugins.entries.<name>.enabled），不是 array
# - version ❌ 上游无此字段（自定义字段，已移除）
# - models.mode ✅ 存在（"merge" / "replace"）
#
# artclaw 历史脚本字段处置（survey §8 已更新）：
# - models.mode = "replace" → 弃用（上游默认 merge，Artifex Nexus 不强制 replace）
# - Provider preset 注入 → 默认不写 token，用户首启在设置面板填
# - Plugin 列表裁剪 → 重写：使用 plugins.entries.<name>.enabled 格式
# - 自动生成 token → 弃用（上游无 gateway.token 字段）
# - 跳过 onboard → 改用 OPENCLAW_NO_ONBOARD=1 env


def _generate_default_config(
    openclaw_home: Path, port: int = DEFAULT_PORT
) -> dict:
    """生成默认 openclaw.json 配置。

    Generate a default openclaw.json configuration.

    字段说明（中英双语，基于 v2026.5.4 上游 schema 实测）：
    - gateway.port: Gateway 监听端口 / Gateway listen port
    - gateway.mode: Gateway 运行模式（local）/ Gateway mode
    - agents.defaults.workspace: Agent 工作区路径 / Agent workspace path
    - plugins.entries: 4 个核心插件启用 + 49 个 AI Provider 禁用，其余默认。
      总计 93 插件中禁用 49 个（阻止 require()），启动时实际加载 ~44 个。
    - browser.cdpPortRangeStart: CDP 端口段起始 / CDP port range start
    """
    workspace_path = openclaw_home / DEFAULT_WORKSPACE

    # AI Provider 插件列表（全部禁用，用户通过设置面板手动启用需要的）
    # 基于 OpenClaw v2026.5.4 extensions/ 目录扫描，package.json name 含 "-provider" 后缀。
    # 禁用原因：Artifex Nexus 不需要 Gateway 内置的 AI Provider 插件（模型配置由
    # 设置面板的 models.providers 管理），加载 49 个 Provider 插件会严重拖慢启动速度。
    _AI_PROVIDER_PLUGIN_IDS = [
        "alibaba", "amazon-bedrock", "amazon-bedrock-mantle", "anthropic",
        "anthropic-vertex", "arcee", "byteplus", "cerebras", "chutes",
        "cloudflare-ai-gateway", "comfy", "deepgram", "deepinfra", "deepseek",
        "fal", "fireworks", "github-copilot", "groq", "huggingface",
        "kilocode", "kimi-coding", "litellm", "lmstudio", "minimax",
        "mistral", "moonshot", "nvidia", "ollama", "openai", "opencode",
        "opencode-go", "openrouter", "qianfan", "qwen", "runway",
        "senseaudio", "sglang", "stepfun", "synthetic", "tencent",
        "together", "venice", "vercel-ai-gateway", "vllm", "volcengine",
        "voyage", "vydra", "xiaomi", "zai",
    ]

    config = {
        "gateway": {
            "port": port,
            "mode": "local",
            # Control UI 浏览器白名单
            # Browser-origin allowlist for the gateway Control UI WebSocket.
            #
            # 背景 / Background：
            # 上游 v2026.5.4 的 Control UI 默认使用严格 origin 校验。当本机存在
            # 任何代理头（例如某些浏览器扩展、企业代理或路由器透明代理注入
            # X-Forwarded-For）时，gateway 不再把 loopback 客户端当作"local"，
            # 必须命中显式 allowedOrigins 白名单，否则握手时返回 1008
            # "origin not allowed" 拒绝连接。
            #
            # 我们默认放行：
            # - http://127.0.0.1:{port} / http://localhost:{port}：从浏览器直接访问
            # - tauri://localhost / https://tauri.localhost：Tauri Desktop 内嵌访问
            "controlUi": {
                "enabled": True,
                "allowedOrigins": [
                    f"http://127.0.0.1:{port}",
                    f"http://localhost:{port}",
                    "tauri://localhost",
                    "https://tauri.localhost",
                    "http://tauri.localhost",
                ],
                # M1 本地 Tauri 部署属于 trusted local：禁用 Control UI 的
                # device-identity pairing（默认会让 ws 握手返回 1008
                # "pairing required: device is not approved yet"），
                # 改用 token/password 的 gateway.auth 即可。
                #
                # M1 (local Tauri) is a trusted-local profile: disable Control UI
                # device pairing handshake and rely on gateway.auth instead.
                # 上游说明（schema）："Use only for short-lived debugging on
                # trusted networks" — 在 M1 单机场景这就是常态。
                "dangerouslyDisableDeviceAuth": True,
            },
        },
        "agents": {
            "defaults": {
                "workspace": str(workspace_path),
                # 默认推理模型：避免 WebUI 启动时 fallback 到未配置的 "openai"
                # 用户安装 provider 后可在设置面板修改
                "reasoningDefault": "on",
                "thinkingDefault": "adaptive",
            }
        },
        # Plugin 配置（TASK-0052）：
        #   - 4 个核心插件启用：browser / file-transfer / memory-core / mcp-bridge
        #   - 49 个 AI Provider 插件显式禁用（"enabled": false，阻止 require()）
        #   - 其余 40 个插件保留默认（enabledByDefault=true），用户可能用到
        # 上游 schema 期望 plugins.entries.<plugin_id>.enabled 格式。
        # enabled=false 时 plugin loader 直接返回 "plugin-disabled"，完全跳过
        # require() 调用 —— 这是减少启动时加载插件数（93→4+40=44）的关键。
        "plugins": {
            "entries": {
                "browser": {"enabled": True},
                "file-transfer": {"enabled": True},
                # v4.2.0 治本修复：移除 memory-core dreaming 默认开启
                # 之前在安装时写入 dreaming.enabled=true，希望默认开启梦境记忆固化。
                # 但实测发现 dreaming 在用户对话期间会并发启动 2 个额外 LLM 调用
                # （dreaming-narrative-light + dreaming-narrative-rem）
                # → 3 个 model_call 同时占 EventLoop → CPU 100% +
                # eventLoopDelay 飙到 6000-7000ms → Node.js 进程被
                # Windows 系统资源压力静默杀死（无 panic / 无 stderr）
                # 这是 Gateway 反复崩溃的根本原因。
                #
                # OpenClaw 默认 dreaming 不开启 → 这里不再写入 memory-core 配置，
                # 让 OpenClaw 自然使用默认值。用户如想开启，可手动改 openclaw.json。
                # 旧版本残留 dreaming.enabled=true 的用户需手动改回 false（或重装）。
                #
                # "memory-core": {
                #     "config": {
                #         "dreaming": {
                #             "enabled": True,
                #         }
                #     }
                # },
                "mcp-bridge": {
                    "enabled": True,
                    "config": {
                        "servers": {
                            "blender-editor": {
                                "type": "websocket",
                                "url": "ws://127.0.0.1:18083",
                                "enabled": True,
                            }
                        }
                    }
                },
                # AI Provider 插件全部禁用（用户通过设置面板手动启用）
                **{pid: {"enabled": False} for pid in _AI_PROVIDER_PLUGIN_IDS},
            }
        },
        # CDP 端口段起始 = gateway port + 11
        "browser": {
            "cdpPortRangeStart": port + 11,
        },
    }

    return config


def _write_config(config_path: Path, config: dict) -> None:
    """写入 openclaw.json。

    Write openclaw.json.
    """
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# 选择性保留逻辑（STORY-0020 — ⚠️ DEPRECATED by STORY-0041）
#
# _apply_preserve_options 已被 _backup_for_reinstall + _restore_from_backup
# 替代。保留此函数仅用于向后兼容（直接调用 bootstrap() 而不传 backup_dir
# 的旧调用路径），新代码请使用三阶段备份-安装-恢复流程。
# ---------------------------------------------------------------------------


def _apply_preserve_options(
    new_config: dict,
    old_config: dict,
    preserve_options: dict,
) -> dict:
    """按 preserve_options 深合并旧配置到新配置。

    Apply selective preservation of old config into newly generated config.
    gateway.auth.token 始终使用新值（安全考虑）。

    Args:
        new_config: 新生成的默认配置。
        old_config: 旧 openclaw.json 的内容。
        preserve_options: 保留选项（preserveProviders / preserveAuth /
            preserveAgents / preservePlugins）。

    Returns:
        合并后的配置。
    """
    result = json.loads(json.dumps(new_config))  # deep copy

    if preserve_options.get("preserveProviders"):
        old_providers = old_config.get("models", {}).get("providers")
        if isinstance(old_providers, dict) and old_providers:
            result.setdefault("models", {})["providers"] = old_providers
            logger.info("preserve: 恢复 models.providers (%d 个)", len(old_providers))

    if preserve_options.get("preserveAuth"):
        old_auth = old_config.get("auth", {})
        if isinstance(old_auth, dict):
            old_profiles = old_auth.get("profiles")
            old_order = old_auth.get("order")
            if isinstance(old_profiles, dict) and old_profiles:
                result.setdefault("auth", {})["profiles"] = old_profiles
                logger.info("preserve: 恢复 auth.profiles (%d 个)", len(old_profiles))
            if isinstance(old_order, dict) and old_order:
                result.setdefault("auth", {})["order"] = old_order
                logger.info("preserve: 恢复 auth.order")

    if preserve_options.get("preserveAgents"):
        old_agents = old_config.get("agents", {})
        if isinstance(old_agents, dict):
            old_defaults = old_agents.get("defaults")
            old_list = old_agents.get("list")
            if isinstance(old_defaults, dict) and old_defaults:
                result.setdefault("agents", {})["defaults"] = old_defaults
                logger.info("preserve: 恢复 agents.defaults")
            if isinstance(old_list, list) and old_list:
                result.setdefault("agents", {})["list"] = old_list
                logger.info("preserve: 恢复 agents.list (%d 个)", len(old_list))

    if preserve_options.get("preservePlugins"):
        old_plugins = old_config.get("plugins", {}).get("entries")
        if isinstance(old_plugins, dict) and old_plugins:
            # 合并策略：旧的 plugin 条目补充到新默认中（新默认已有的不覆盖）
            new_entries = result.get("plugins", {}).get("entries", {})
            for plugin_id, plugin_cfg in old_plugins.items():
                if plugin_id not in new_entries:
                    new_entries[plugin_id] = plugin_cfg
                    logger.info("preserve: 恢复 plugin %s", plugin_id)
                else:
                    # 已有的 plugin：深合并 config 子节点
                    if isinstance(plugin_cfg, dict) and isinstance(new_entries[plugin_id], dict):
                        old_cfg = plugin_cfg.get("config", {})
                        if old_cfg:
                            new_entries[plugin_id].setdefault("config", {}).update(old_cfg)
            result.setdefault("plugins", {})["entries"] = new_entries

    # gateway.auth.token 始终使用新值（安全考虑，不保留旧 token）
    # 此处无需额外操作——new_config 中的 token 字段是由 runtime 另行生成的，
    # 如果 _generate_default_config 里没有 gateway.auth，则由 bootstrap 后续步骤处理。

    return result


def _migrate_auth_profiles_files(openclaw_home: Path, config: dict) -> None:  # pragma: no cover
    """[废弃 2026-05-15] 不再迁移 auth-profiles.json。

    Deprecated: API key 已收敛到 ``openclaw.json::models.providers.<id>.apiKey``，
    legacy ``auth-profiles.json`` 不再被 sidecar 写入或读取。函数保留为空
    stub 仅为兼容旧调用方。
    """
    return None


# ---------------------------------------------------------------------------
# STORY-0041：备份-全新安装-恢复（替代 _apply_preserve_options）
# ---------------------------------------------------------------------------

_AGENT_IDENTITY_FILES = [
    "AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "TOOLS.md", "HEARTBEAT.md",
]
"""Agent 独立 workspace 中需要备份的人格文件列表。"""


def _backup_for_reinstall(
    openclaw_home: Path,
    preserve_options: dict,
    backup_dir: Path,
) -> dict:
    """Phase 1: 按 preserve_options 收集数据到 backup_dir。

    Backup user data according to preserve_options into ``backup_dir``.
    Returns a backup manifest dict.

    5 个勾选项的 key：
    - preserveProvidersAndAuth：models.providers + auth + auth-profiles.json（双路径）
    - preserveAgents：agents.list/defaults + 各 agent 独立 workspace 人格文件
    - preservePluginsAndMemory：plugins.entries + state/memory/*.sqlite + workspace/memory/
    - preserveMCPServers：plugins.entries.mcp-bridge.config.servers
    - preserveSkills：workspace/skills/ 整个目录（扁平结构）
    """
    import shutil
    import time as _time

    openclaw_home = Path(openclaw_home).expanduser().resolve()
    backup_dir = Path(backup_dir).expanduser().resolve()
    backup_dir.mkdir(parents=True, exist_ok=True)

    config = read_config(openclaw_home)
    manifest: dict = {
        "timestamp": _time.time(),
        "backup_dir": str(backup_dir),
        "openclaw_home": str(openclaw_home),
        "items": {},
        "skipped": [],  # 被锁/无权限的单文件，记录但不中断
    }
    skipped: list[dict] = manifest["skipped"]

    # ── 1. 供应商配置 + API 凭据 ──
    if preserve_options.get("preserveProvidersAndAuth"):
        item: dict = {}
        if config:
            providers_auth = {}
            if config.get("models", {}).get("providers"):
                providers_auth["providers"] = config["models"]["providers"]
            if config.get("auth"):
                providers_auth["auth"] = config["auth"]
            if providers_auth:
                target = backup_dir / "config-providers-auth.json"
                target.write_text(
                    json.dumps(providers_auth, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                item["config_snapshot"] = str(target)
                item["provider_count"] = len(providers_auth.get("providers", {}))
                item["has_auth"] = "auth" in providers_auth

        # 注：自 2026-05-15 收敛后，API key 全部写到 openclaw.json 的
        # ``models.providers.<id>.apiKey`` 字段（已包含在 config-providers-auth.json）。
        # auth-profiles.json 不再被 sidecar 写入或读取，所以**不再备份**。
        # 历史 auth-profiles.json 文件（如有）由 full-snapshot 安全网兜底保留，
        # 用户可手工恢复但不会被自动 restore 流程触碰。

        if item:
            manifest["items"]["providersAuth"] = item

    # ── 2. Agent 配置 + 工作空间 ──
    if preserve_options.get("preserveAgents"):
        item: dict = {}
        if config:
            agents_config = {}
            if config.get("agents", {}).get("list") is not None:
                agents_config["list"] = config["agents"]["list"]
            if config.get("agents", {}).get("defaults") is not None:
                agents_config["defaults"] = config["agents"]["defaults"]
            if agents_config:
                target = backup_dir / "config-agents.json"
                target.write_text(
                    json.dumps(agents_config, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                item["config_snapshot"] = str(target)
                item["agent_count"] = len(agents_config.get("list", []))

        # 各 agent 独立 workspace 人格文件
        agents_list = (config or {}).get("agents", {}).get("list", [])
        ws_backups = []
        for agent in agents_list:
            if not isinstance(agent, dict):
                continue
            ws_field = agent.get("workspace")
            agent_id = agent.get("id")
            if not ws_field or not agent_id:
                continue
            # ``workspace`` 字段可能是相对路径（"workspace" / "workspace-twelve"）
            # 也可能历史遗留为绝对路径。统一规范化为相对 openclaw_home 的相对路径
            # —— 这样 backup_dir / "agent-workspaces" / ws_rel 才能落到备份目录里
            ws_path = Path(ws_field)
            if ws_path.is_absolute():
                try:
                    ws_rel = str(ws_path.resolve().relative_to(openclaw_home))
                except ValueError:
                    logger.warning("backup: agent %s 的 workspace=%s 不在 openclaw_home 之内，跳过", agent_id, ws_field)
                    continue
            else:
                ws_rel = str(ws_path)
            ws_src = openclaw_home / ws_rel
            if not ws_src.is_dir():
                continue
            ws_dst = backup_dir / "agent-workspaces" / ws_rel
            backed = False
            for fname in _AGENT_IDENTITY_FILES:
                src = ws_src / fname
                if src.exists():
                    dst = ws_dst / fname
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    ok, err = _safe_copy_file(src, dst)
                    if ok:
                        backed = True
                    else:
                        skipped.append({"path": str(src), "error": err or "unknown"})
            if backed:
                ws_backups.append({
                    "agent_id": agent_id,
                    "workspace": ws_rel,
                    "path": str(ws_dst),
                })
        if ws_backups:
            item["workspaces"] = ws_backups

        if item:
            manifest["items"]["agents"] = item

    # ── 3. 插件配置 + Memory ──
    if preserve_options.get("preservePluginsAndMemory"):
        item: dict = {}
        if config:
            plugins_entries = config.get("plugins", {}).get("entries")
            if plugins_entries:
                target = backup_dir / "config-plugins.json"
                target.write_text(
                    json.dumps({"entries": plugins_entries}, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                item["config_snapshot"] = str(target)
                item["plugin_count"] = len(plugins_entries)

        # state/memory/*.sqlite
        mem_dir = openclaw_home / "state" / "memory"
        if mem_dir.is_dir():
            db_files = list(mem_dir.glob("*.sqlite"))
            if db_files:
                mem_dst = backup_dir / "memory"
                mem_dst.mkdir(parents=True, exist_ok=True)
                copied_dbs: list[str] = []
                for db in db_files:
                    target = mem_dst / db.name
                    # SQLite 优先用在线 backup API（跨进程一致性快照，绕过文件锁）
                    if _sqlite_backup(db, target):
                        copied_dbs.append(db.name)
                        continue
                    # 回退普通拷贝
                    ok, err = _safe_copy_file(db, target)
                    if ok:
                        copied_dbs.append(db.name)
                    else:
                        skipped.append({"path": str(db), "error": err or "unknown"})
                item["memory_dbs"] = copied_dbs

        # workspace/memory/（默认 agent）
        ws_mem = openclaw_home / "workspace" / "memory"
        if ws_mem.is_dir():
            dst = backup_dir / "workspace-memory"
            _copytree_ignore_patterns(str(ws_mem), str(dst), ignore_patterns=[".git"], skipped=skipped)
            item["workspace_memory"] = str(dst)

        # workspace-<agent>/memory/（各 agent 独立 workspace 的梦境数据）
        agents_for_mem = (config or {}).get("agents", {}).get("list", [])
        ws_mem_backups: list[dict] = []
        for agent in agents_for_mem:
            if not isinstance(agent, dict):
                continue
            ws_field = agent.get("workspace")
            if not ws_field or not agent.get("id"):
                continue
            # 同上：把绝对路径规范化为相对路径
            ws_path_obj = Path(ws_field)
            if ws_path_obj.is_absolute():
                try:
                    ws_rel = str(ws_path_obj.resolve().relative_to(openclaw_home))
                except ValueError:
                    continue
            else:
                ws_rel = str(ws_path_obj)
            ws_mem_src = openclaw_home / ws_rel / "memory"
            if ws_mem_src.is_dir():
                ws_mem_dst = backup_dir / "agent-workspace-memory" / ws_rel / "memory"
                _copytree_ignore_patterns(
                    str(ws_mem_src), str(ws_mem_dst), ignore_patterns=[".git"], skipped=skipped,
                )
                ws_mem_backups.append({
                    "agent_id": agent["id"],
                    "workspace": ws_rel,
                    "path": str(ws_mem_dst),
                })
        if ws_mem_backups:
            item["agent_workspace_memory"] = ws_mem_backups

        # state/agents/<id>/sessions/ + .openclaw/agents/<id>/sessions/（各 agent 对话历史，双路径）
        agents_for_sessions = (config or {}).get("agents", {}).get("list", [])
        session_backups: list[dict] = []
        for agent in agents_for_sessions:
            if not isinstance(agent, dict):
                continue
            agent_id = agent.get("id")
            if not agent_id:
                continue
            for prefix, label in [("state", "legacy"), (".openclaw", "new")]:
                sessions_src = openclaw_home / prefix / "agents" / agent_id / "sessions"
                if sessions_src.is_dir() and any(sessions_src.iterdir()):
                    sessions_dst = backup_dir / "agent-sessions" / label / agent_id / "sessions"
                    _copytree_ignore_patterns(
                        str(sessions_src), str(sessions_dst), ignore_patterns=[".git"], skipped=skipped,
                    )
                    session_backups.append({
                        "agent_id": agent_id,
                        "path": str(sessions_dst),
                        "prefix": prefix,
                    })
        if session_backups:
            item["agent_sessions"] = session_backups

        if item:
            manifest["items"]["pluginsAndMemory"] = item

    # ── 4. MCP 服务器配置 ──
    if preserve_options.get("preserveMCPServers"):
        item: dict = {}
        if config:
            mcp_servers = (
                config.get("plugins", {})
                .get("entries", {})
                .get("mcp-bridge", {})
                .get("config", {})
                .get("servers")
            )
            if mcp_servers:
                target = backup_dir / "config-mcp-servers.json"
                target.write_text(
                    json.dumps({"servers": mcp_servers}, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                item["config_snapshot"] = str(target)
                item["server_count"] = len(mcp_servers)
        if item:
            manifest["items"]["mcpServers"] = item

    # ── 5. Skill ──
    if preserve_options.get("preserveSkills"):
        skills_dir = openclaw_home / "workspace" / "skills"
        if skills_dir.is_dir():
            dst = backup_dir / "skills"
            _copytree_ignore_patterns(str(skills_dir), str(dst), ignore_patterns=[".git"], skipped=skipped)
            manifest["items"]["skills"] = {
                "source": str(skills_dir),
                "target": str(dst),
            }

    # 写 manifest
    manifest_path = backup_dir / "backup-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    logger.info("backup: manifest → %s (%d 项)", manifest_path, len(manifest.get("items", {})))

    # 计算总大小
    total_size = sum(
        f.stat().st_size for f in backup_dir.rglob("*") if f.is_file()
    )
    manifest["total_size_bytes"] = total_size

    return manifest


def create_full_snapshot(
    openclaw_home: Path,
    snapshots_root: Path | None = None,
    max_keep: int = 3,
) -> dict:
    """对整个 ``.openclaw/`` 目录做一次容错的全量快照（"安全网"备份）。

    Take a tolerant full snapshot of the entire .openclaw/ directory before any
    destructive operation (install/reinstall/restore). This is the **last-line
    safety net** — if everything else fails, the user can manually restore from
    here.

    设计要点：
    - 排除 ``cli/`` （CLI 重新下载即可，~200MB+）
    - 排除 ``.git/``
    - 排除 ``state/browser/`` （Chromium 用户数据太大，且每次都会变）
    - 用 ``_copytree_ignore_patterns`` 容错，被锁文件计入 ``skipped``，不抛
    - 独立放在 ``~/.artifexnexus/full-snapshots/<ts>/``，**不**随重装清理
    - 自动保留最近 ``max_keep`` 份，删除更早的

    Args:
        openclaw_home: ``~/.artifexnexus/.openclaw/``
        snapshots_root: 默认 ``openclaw_home.parent / "full-snapshots"``
        max_keep: 保留最近 N 份（默认 3）

    Returns:
        dict: ``{success, snapshot_dir, timestamp, file_count, skipped_count, total_size_bytes}``
            ``snapshot_dir = None`` 表示 .openclaw/ 不存在或没东西可备
    """
    import time as _time

    openclaw_home = Path(openclaw_home).expanduser().resolve()
    if snapshots_root is None:
        snapshots_root = openclaw_home.parent / "full-snapshots"
    snapshots_root = Path(snapshots_root).expanduser().resolve()

    if not openclaw_home.exists():
        logger.info("create_full_snapshot: %s 不存在，跳过", openclaw_home)
        return {"success": True, "snapshot_dir": None, "skipped_full_snapshot": True}

    timestamp = f"{_time.time():.0f}"
    snapshot_dir = snapshots_root / timestamp

    # 用 os.walk 手动拷贝，跳过 cli / .git / state/browser
    excluded_dirs = {"cli", ".git"}
    excluded_relpaths = {Path("state") / "browser"}

    skipped: list[dict] = []
    file_count = 0

    snapshot_dir.mkdir(parents=True, exist_ok=True)

    for root, dirs, files in os.walk(openclaw_home):
        rel = Path(root).relative_to(openclaw_home)
        # 顶层排除目录
        if rel == Path("."):
            dirs[:] = [d for d in dirs if d not in excluded_dirs]
        # 路径前缀排除（state/browser）
        dirs[:] = [
            d for d in dirs
            if not any(rel / d == ex or (rel / d).is_relative_to(ex) for ex in excluded_relpaths)
        ]
        target_dir = snapshot_dir / rel
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            skipped.append({"path": str(target_dir), "error": str(exc)})
            continue
        for fname in files:
            ok, err = _safe_copy_file(Path(root) / fname, target_dir / fname)
            if ok:
                file_count += 1
            else:
                skipped.append({"path": str(Path(root) / fname), "error": err or "unknown"})

    # 写 snapshot manifest（方便后续恢复或诊断）
    total_size = sum(
        f.stat().st_size for f in snapshot_dir.rglob("*") if f.is_file()
    )
    manifest = {
        "type": "full-snapshot",
        "timestamp": float(timestamp),
        "openclaw_home": str(openclaw_home),
        "snapshot_dir": str(snapshot_dir),
        "file_count": file_count,
        "skipped_count": len(skipped),
        "skipped": skipped[:50],  # 截断
        "total_size_bytes": total_size,
        "excluded_dirs": sorted(excluded_dirs),
        "excluded_relpaths": [str(p) for p in excluded_relpaths],
    }
    (snapshot_dir / "snapshot-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    logger.info(
        "create_full_snapshot: %s 完成 (files=%d, skipped=%d, size=%d KB)",
        snapshot_dir, file_count, len(skipped), total_size // 1024,
    )

    # 清理旧 snapshot（保留最近 max_keep 份）
    try:
        all_snaps = sorted(
            (p for p in snapshots_root.iterdir() if p.is_dir() and p.name.replace(".", "").isdigit()),
            key=lambda p: float(p.name),
            reverse=True,
        )
        for old in all_snaps[max_keep:]:
            try:
                import shutil
                shutil.rmtree(str(old), ignore_errors=True)
                logger.info("create_full_snapshot: 已清理旧快照 %s", old)
            except OSError as exc:
                logger.warning("create_full_snapshot: 清理旧快照失败 %s: %s", old, exc)
    except OSError as exc:
        logger.warning("create_full_snapshot: 列出快照目录失败: %s", exc)

    return {
        "success": True,
        "snapshot_dir": str(snapshot_dir),
        "timestamp": timestamp,
        "file_count": file_count,
        "skipped_count": len(skipped),
        "total_size_bytes": total_size,
    }


def _sqlite_backup(src: Path, dst: Path) -> bool:
    """用 sqlite3 在线 backup API 把 ``src`` 快照到 ``dst``。

    SQLite online backup API works **even if another process has the source DB
    open** — including when that process holds a write lock. This is the
    canonical way to back up a live SQLite database. Returns ``True`` on
    success; ``False`` to let caller fall back to file-level copy.

    Falls back silently for non-SQLite-format files or any sqlite error
    (corrupt, encrypted, version mismatch, etc.).
    """
    import sqlite3

    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        # 用只读 URI + immutable 安全打开（不会拿写锁，不会修改源）
        # immutable=1 告诉 sqlite "源不会变"，避免它尝试创建 -journal/-wal
        uri = f"file:{src.as_posix()}?mode=ro&immutable=1"
        with sqlite3.connect(uri, uri=True, timeout=2.0) as src_conn, \
                sqlite3.connect(str(dst), timeout=5.0) as dst_conn:
            src_conn.backup(dst_conn)
        logger.info("backup: sqlite online backup ok %s", src.name)
        return True
    except (sqlite3.Error, OSError) as exc:
        logger.warning("backup: sqlite online backup 失败 %s: %s（回退到文件拷贝）", src, exc)
        return False


def _safe_copy_file(src: Path, dst: Path) -> tuple[bool, str | None]:
    """容错单文件拷贝。Windows 下若文件被独占锁占用 (WinError 32)，
    退一步尝试以共享读模式 (FILE_SHARE_READ|WRITE|DELETE) 打开后流式复制；
    全部失败时返回 (False, error_msg)，**不抛异常**，让上层把失败计入 manifest。

    Tolerant single-file copy. On Windows, ``shutil.copy2`` (=> CopyFile2) fails
    with ERROR_SHARING_VIOLATION (32) when the source is held with an exclusive
    lock (e.g. SQLite WAL writer, jsonl appender). We then fall back to an
    explicit ``open(..., 'rb')`` which Python 3 maps to ``CreateFileW`` with
    ``FILE_SHARE_READ|WRITE|DELETE`` — succeeding for most "shared write"
    cases. Returns ``(success, err_msg)``; never raises.
    """
    import shutil

    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(src), str(dst))
        return True, None
    except (OSError, PermissionError) as exc:
        # 回退：手动 open + read + write，绕过 CopyFile2 的共享语义限制
        try:
            with open(src, "rb") as fr, open(dst, "wb") as fw:
                while True:
                    chunk = fr.read(1024 * 1024)
                    if not chunk:
                        break
                    fw.write(chunk)
            # 复制 mtime/atime（best-effort）
            try:
                st = src.stat()
                os.utime(dst, (st.st_atime, st.st_mtime))
            except OSError:
                pass
            logger.info("backup: copy fallback ok %s (orig err: %s)", src.name, exc)
            return True, None
        except (OSError, PermissionError) as exc2:
            logger.warning("backup: copy 仍失败 %s: %s", src, exc2)
            return False, f"{type(exc2).__name__}: {exc2}"


def _copytree_ignore_patterns(
    src: str,
    dst: str,
    ignore_patterns: list[str],
    skipped: list[dict] | None = None,
) -> None:
    """shutil.copytree 的薄封装，忽略匹配模式的文件/目录。

    Thin wrapper around shutil.copytree with pattern-based ignore.
    单文件失败不会中断整个 copytree —— 失败项追加到可选的 ``skipped`` 列表。
    """
    import fnmatch

    src_path = Path(src)
    dst_path = Path(dst)
    if not src_path.is_dir():
        return

    def _is_ignored(name: str) -> bool:
        for pat in ignore_patterns:
            if fnmatch.fnmatch(name, pat):
                return True
        return False

    for root, dirs, files in os.walk(src_path):
        # 过滤被忽略的目录（in-place 修改，让 os.walk 不下钻）
        dirs[:] = [d for d in dirs if not _is_ignored(d)]
        rel = Path(root).relative_to(src_path)
        target_dir = dst_path / rel
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            if skipped is not None:
                skipped.append({"path": str(target_dir), "error": str(exc)})
            continue
        for fname in files:
            if _is_ignored(fname):
                continue
            ok, err = _safe_copy_file(Path(root) / fname, target_dir / fname)
            if not ok and skipped is not None:
                skipped.append({"path": str(Path(root) / fname), "error": err or "unknown"})


def _clean_install(openclaw_home: Path) -> None:
    """Phase 2: 停止 Gateway 并删除整个 .openclaw/ 目录。

    Stop the Gateway process and remove the entire .openclaw/ directory.
    备份数据在 ~/.artifexnexus/backups/ 下，不受影响。
    """
    import shutil

    openclaw_home = Path(openclaw_home).expanduser().resolve()
    backups_dir = openclaw_home.parent / "backups"

    # 停止 Gateway
    try:
        from . import runtime as _runtime
    except ImportError:
        import runtime as _runtime  # type: ignore[no-redef]
    try:
        _runtime.stop_gateway()
        logger.info("clean_install: Gateway 已停止")
    except Exception as exc:  # noqa: BLE001
        logger.warning("clean_install: 停止 Gateway 失败（继续删除）: %s", exc)

    # 删除整个 .openclaw/ 目录
    if openclaw_home.exists():
        shutil.rmtree(str(openclaw_home), ignore_errors=True)
        logger.info("clean_install: 已删除 %s", openclaw_home)

    # 确保 backups/ 目录不被误删
    if not backups_dir.exists():
        logger.warning("clean_install: backups/ 目录不存在，可能已被手动删除")


def _restore_from_backup(
    openclaw_home: Path,
    backup_dir: Path,
    preserve_options: dict,
    manifest: dict,
) -> dict:
    """Phase 3: 按 manifest 将备份数据恢复到新安装的 .openclaw/。

    Restore backed-up data into the freshly installed .openclaw/ directory.
    Returns ``{success, errors: [{item, error}]}``.

    恢复顺序：
    1 → providersAuth（全量替换）
    2 → agents（全量替换）
    3 → pluginsAndMemory（合并策略）
    4 → mcpServers（合并策略；若 #3 已处理则跳过）
    5 → skills（文件复制）
    """
    import shutil

    openclaw_home = Path(openclaw_home).expanduser().resolve()
    backup_dir = Path(backup_dir).expanduser().resolve()
    errors: list[dict] = []

    items = manifest.get("items", {})

    # ── 1. 供应商配置 + API 凭据 ──
    if preserve_options.get("preserveProvidersAndAuth"):
        try:
            _restore_providers_auth(openclaw_home, backup_dir, items.get("providersAuth", {}))
            logger.info("restore: 供应商配置 + API 凭据 已恢复")
        except Exception as exc:  # noqa: BLE001
            errors.append({"item": "providersAuth", "error": str(exc)})
            logger.warning("restore: 供应商配置恢复失败: %s", exc)

    # ── 2. Agent 配置 + 工作空间 ──
    if preserve_options.get("preserveAgents"):
        try:
            _restore_agents(openclaw_home, backup_dir, items.get("agents", {}))
            logger.info("restore: Agent 配置 + 工作空间 已恢复")
        except Exception as exc:  # noqa: BLE001
            errors.append({"item": "agents", "error": str(exc)})
            logger.warning("restore: Agent 配置恢复失败: %s", exc)

    # ── 3. 插件配置 + Memory ──
    handled_mcp = False
    if preserve_options.get("preservePluginsAndMemory"):
        try:
            _restore_plugins_and_memory(openclaw_home, backup_dir, items.get("pluginsAndMemory", {}))
            logger.info("restore: 插件配置 + Memory 已恢复")
            # 如果 #4 也勾选，此处已包含 mcp-bridge.config.servers，跳过 #4
            handled_mcp = True
        except Exception as exc:  # noqa: BLE001
            errors.append({"item": "pluginsAndMemory", "error": str(exc)})
            logger.warning("restore: 插件/Memory 恢复失败: %s", exc)

    # ── 4. MCP 服务器配置 ──
    if preserve_options.get("preserveMCPServers") and not handled_mcp:
        try:
            _restore_mcp_servers(openclaw_home, backup_dir, items.get("mcpServers", {}))
            logger.info("restore: MCP 服务器配置 已恢复")
        except Exception as exc:  # noqa: BLE001
            errors.append({"item": "mcpServers", "error": str(exc)})
            logger.warning("restore: MCP 服务器恢复失败: %s", exc)

    # ── 5. Skill ──
    if preserve_options.get("preserveSkills"):
        try:
            _restore_skills(openclaw_home, backup_dir, items.get("skills", {}))
            logger.info("restore: Skill 已恢复")
        except Exception as exc:  # noqa: BLE001
            errors.append({"item": "skills", "error": str(exc)})
            logger.warning("restore: Skill 恢复失败: %s", exc)

    # ── registry refresh ──
    try:
        _run_registry_refresh(openclaw_home)
        logger.info("restore: plugins registry --refresh 完成")
    except Exception as exc:  # noqa: BLE001
        logger.warning("restore: registry refresh 失败（不阻塞）: %s", exc)

    return {
        "success": len(errors) == 0,
        "errors": errors if errors else None,
    }


# ── 各子恢复函数 ────────────────────────────────────────────────────────


def _restore_providers_auth(
    openclaw_home: Path, backup_dir: Path, item: dict,
) -> None:
    """恢复供应商配置 + API 凭据。"""
    import shutil

    # 恢复 openclaw.json 字段
    config_path = backup_dir / "config-providers-auth.json"
    if config_path.exists():
        data = json.loads(config_path.read_text(encoding="utf-8"))
        patch = {}
        if data.get("providers"):
            patch["models"] = {"providers": data["providers"]}
        if data.get("auth"):
            patch["auth"] = data["auth"]
        if patch:
            _patch_or_write_config(openclaw_home, patch)

    # auth-profiles.json 自 2026-05-15 起不再恢复（已收敛到 openclaw.json）。
    # 保留 manifest 中 ``auth_files`` 字段的兼容读取（仅日志），不做实际拷贝。
    if item.get("auth_files"):
        logger.info(
            "restore: 跳过 %d 个 auth-profiles.json 文件（已废弃，token 在 openclaw.json）",
            len(item["auth_files"]),
        )


def _restore_agents(
    openclaw_home: Path, backup_dir: Path, item: dict,
) -> None:
    """恢复 Agent 配置 + 工作空间。

    注意：``agents.list`` 是 OpenClaw 的保护配置字段，``config patch --stdin``
    会拒绝写入。所以这里**直接读 openclaw.json → 替换 agents 字段 → 写回**，
    绕过 CLI patch 接口。
    """
    config_path = backup_dir / "config-agents.json"
    if config_path.exists():
        data = json.loads(config_path.read_text(encoding="utf-8"))
        # 直写：read → replace agents → write
        oc_config_path = openclaw_home / "openclaw.json"
        if oc_config_path.exists():
            try:
                current = json.loads(oc_config_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                raise RuntimeError(f"读取 openclaw.json 失败: {exc}") from exc
        else:
            current = {}
        # 用备份的 agents 字段全量替换（list/defaults 都来自备份）
        if "agents" not in current or not isinstance(current.get("agents"), dict):
            current["agents"] = {}
        if data.get("list") is not None:
            current["agents"]["list"] = data["list"]
        if data.get("defaults") is not None:
            current["agents"]["defaults"] = data["defaults"]
        # 原子写入：先写临时文件再 rename
        tmp = oc_config_path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(current, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(str(tmp), str(oc_config_path))
        logger.info("restore: agents 直写 openclaw.json 成功 (%d agents)", len(data.get("list", [])))

    # 恢复独立 workspace 人格文件
    for ws in item.get("workspaces", []):
        ws_rel = ws["workspace"]
        # ws_rel 是相对 openclaw_home 的路径（修复后），但若 manifest 来自旧版本可能仍是绝对的
        ws_rel_path = Path(ws_rel)
        if ws_rel_path.is_absolute():
            # 老 manifest：尝试从绝对路径中提取 openclaw_home 之后的部分
            try:
                ws_rel_path = ws_rel_path.resolve().relative_to(openclaw_home)
            except ValueError:
                logger.warning("restore: workspace=%s 不在 openclaw_home 之内，跳过", ws_rel)
                continue
        src = Path(ws["path"])
        # 修正：旧 manifest path 字段可能是源路径（绝对，等于 ws_src）
        # 检查 path 是否在 backup_dir 之内，否则用约定路径替代
        try:
            Path(src).resolve().relative_to(backup_dir.resolve())
            src_in_backup = True
        except ValueError:
            src_in_backup = False
        if not src_in_backup:
            src = backup_dir / "agent-workspaces" / ws_rel_path
        dst = openclaw_home / ws_rel_path
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            for f in src.iterdir():
                if f.is_file():
                    ok, err = _safe_copy_file(f, dst / f.name)
                    if not ok:
                        logger.warning("restore: workspace 文件 %s 拷贝失败: %s", f, err)


def _restore_plugins_and_memory(
    openclaw_home: Path, backup_dir: Path, item: dict,
) -> None:
    """恢复插件配置 + Memory（合并策略）。"""
    import shutil

    # 恢复 plugins.entries（合并策略）
    config_path = backup_dir / "config-plugins.json"
    if config_path.exists():
        backup_data = json.loads(config_path.read_text(encoding="utf-8"))
        backup_entries = backup_data.get("entries", {})

        # 读当前 openclaw.json 的 plugins.entries
        current = read_config(openclaw_home)
        current_entries = (current or {}).get("plugins", {}).get("entries", {})

        # 合并：当前已有的保留，当前没有的从备份追加
        merged = dict(current_entries)
        for pid, pcfg in backup_entries.items():
            if pid not in merged:
                merged[pid] = pcfg

        _patch_or_write_config(openclaw_home, {"plugins": {"entries": merged}})

    # 恢复 state/memory/*.sqlite
    mem_src = backup_dir / "memory"
    if mem_src.is_dir():
        mem_dst = openclaw_home / "state" / "memory"
        mem_dst.mkdir(parents=True, exist_ok=True)
        for db in mem_src.glob("*.sqlite"):
            shutil.copy2(str(db), str(mem_dst / db.name))

    # 恢复 workspace/memory/（默认 agent）
    ws_mem_src = backup_dir / "workspace-memory"
    if ws_mem_src.is_dir():
        ws_mem_dst = openclaw_home / "workspace" / "memory"
        _copytree_ignore_patterns(str(ws_mem_src), str(ws_mem_dst), ignore_patterns=[".git"])

    # 恢复 workspace-<agent>/memory/（各 agent 独立 workspace 的梦境数据）
    for mem_info in item.get("agent_workspace_memory", []):
        src = Path(mem_info["path"])
        dst = openclaw_home / mem_info["workspace"] / "memory"
        if src.is_dir():
            _copytree_ignore_patterns(str(src), str(dst), ignore_patterns=[".git"])

    # 恢复 state/agents/<id>/sessions/ + .openclaw/agents/<id>/sessions/（双路径）
    for sess_info in item.get("agent_sessions", []):
        src = Path(sess_info["path"])
        prefix = sess_info.get("prefix", "state")  # 旧 manifest 兼容：默认 state
        dst = openclaw_home / prefix / "agents" / sess_info["agent_id"] / "sessions"
        if src.is_dir():
            _copytree_ignore_patterns(str(src), str(dst), ignore_patterns=[".git"])


def _restore_mcp_servers(
    openclaw_home: Path, backup_dir: Path, item: dict,
) -> None:
    """恢复 MCP 服务器配置（仅当 #3 未勾选时独立执行）。"""
    config_path = backup_dir / "config-mcp-servers.json"
    if not config_path.exists():
        return

    backup_data = json.loads(config_path.read_text(encoding="utf-8"))
    backup_servers = backup_data.get("servers", {})

    current = read_config(openclaw_home)
    current_servers = (
        (current or {})
        .get("plugins", {})
        .get("entries", {})
        .get("mcp-bridge", {})
        .get("config", {})
        .get("servers", {})
    )

    # 合并 servers：同名替换，保留双方不冲突的条目
    merged = dict(current_servers)
    merged.update(backup_servers)

    _patch_or_write_config(openclaw_home, {
        "plugins": {
            "entries": {
                "mcp-bridge": {
                    "config": {"servers": merged},
                },
            },
        },
    })


def _restore_skills(
    openclaw_home: Path, backup_dir: Path, item: dict,
) -> None:
    """恢复 workspace/skills/ 整个目录。"""
    src = Path(item.get("target", backup_dir / "skills"))
    if src.is_dir():
        dst = openclaw_home / "workspace" / "skills"
        _copytree_ignore_patterns(str(src), str(dst), ignore_patterns=[".git"])


def _patch_or_write_config(openclaw_home: Path, patch: dict) -> None:
    """优先用 ``openclaw config patch --stdin``，失败则回退到直写 openclaw.json。

    Patch via the upstream CLI when possible (preserves backups, validates
    schema). Falls back to direct deep-merge + atomic write when CLI is
    unavailable (e.g. CLI still installing) or the field is "protected" by
    upstream (e.g. ``agents.list``).
    """
    try:
        _patch_openclaw_config(openclaw_home, patch)
        return
    except Exception as exc:  # noqa: BLE001
        logger.info("config patch 失败 → 回退直写: %s", exc)

    oc_config_path = openclaw_home / "openclaw.json"
    if oc_config_path.exists():
        try:
            current = json.loads(oc_config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise RuntimeError(f"读取 openclaw.json 失败: {exc}") from exc
    else:
        current = {}

    def _deep_merge(dst: dict, src: dict) -> None:
        for k, v in src.items():
            if isinstance(v, dict) and isinstance(dst.get(k), dict):
                _deep_merge(dst[k], v)
            else:
                dst[k] = v

    _deep_merge(current, patch)
    tmp = oc_config_path.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(current, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(str(tmp), str(oc_config_path))
    logger.info("config 直写成功 (patch keys: %s)", list(patch.keys()))


def _patch_openclaw_config(openclaw_home: Path, patch: dict) -> None:
    """通过 openclaw config patch --stdin 写入 openclaw.json。

    Patch openclaw.json via the upstream CLI. Falls back to direct
    JSON merge if CLI is unavailable.
    """
    try:
        from . import runtime as _runtime
    except ImportError:
        import runtime as _runtime  # type: ignore[no-redef]

    bin_path = _runtime._find_openclaw_bin(openclaw_home)
    if bin_path is None:
        raise RuntimeError("openclaw CLI 未安装，无法执行 config patch")

    import subprocess
    patch_json = json.dumps(patch, ensure_ascii=False)
    try:
        proc = subprocess.run(
            [str(bin_path), "config", "patch", "--stdin"],
            input=patch_json,
            capture_output=True,
            text=True,
            timeout=30,
            env={
                **__import__("os").environ,
                "OPENCLAW_HOME": str(openclaw_home),
                "OPENCLAW_CONFIG_PATH": str(openclaw_home / "openclaw.json"),
            },
        )
        if proc.returncode != 0:
            raise RuntimeError(f"config patch 失败 (code={proc.returncode}): {proc.stderr}")
        logger.info("config patch 成功 (%d bytes)", len(patch_json))
    except subprocess.TimeoutExpired:
        raise RuntimeError("config patch 超时（30s）")


def _run_registry_refresh(openclaw_home: Path) -> None:
    """运行 openclaw plugins registry --refresh 重建 installs.json。"""
    try:
        from . import runtime as _runtime
    except ImportError:
        import runtime as _runtime  # type: ignore[no-redef]

    bin_path = _runtime._find_openclaw_bin(openclaw_home)
    if bin_path is None:
        logger.warning("registry refresh: CLI 未安装，跳过")
        return

    import subprocess
    try:
        proc = subprocess.run(
            [str(bin_path), "plugins", "registry", "--refresh"],
            capture_output=True,
            text=True,
            timeout=60,
            env={
                **__import__("os").environ,
                "OPENCLAW_HOME": str(openclaw_home),
                "OPENCLAW_CONFIG_PATH": str(openclaw_home / "openclaw.json"),
            },
        )
        if proc.returncode != 0:
            logger.warning("registry refresh 返回非零: %s", proc.stderr)
        else:
            logger.info("registry refresh 完成")
    except subprocess.TimeoutExpired:
        logger.warning("registry refresh 超时（60s）")

# ---------------------------------------------------------------------------
# 目录布局
# ---------------------------------------------------------------------------


def _create_directory_layout(openclaw_home: Path) -> list[Path]:
    """创建完整目录布局，返回新创建的目录列表。

    Create the full directory layout, return list of newly created directories.

    布局（详见 openclaw-wrapper-runtime.md §2）：
      {openclaw_home}/
      ├── cli/                    # CLI 安装目录（S1 已创建）
      ├── state/                  # OPENCLAW_STATE_DIR
      │   └── lock/               # gateway 锁文件
      ├── workspace/              # agents.defaults.workspace
      │   └── skills/
      │       ├── official/
      │       ├── team/
      │       └── user/
      └── openclaw.json           # OPENCLAW_CONFIG_PATH
    """
    dirs = [
        openclaw_home / "state" / "lock",
        openclaw_home / "workspace" / "skills" / "official",
        openclaw_home / "workspace" / "skills" / "team",
        openclaw_home / "workspace" / "skills" / "user",
    ]

    created = []
    for d in dirs:
        if not d.exists():
            d.mkdir(parents=True, exist_ok=True)
            created.append(d)

    return created


# ---------------------------------------------------------------------------
# workspace 人格文件预置
# ---------------------------------------------------------------------------

_WORKSPACE_ASSETS_DIR = Path(__file__).parent / "assets" / "agents" / "workspace"
"""workspace 预设文件资源目录。"""

_WORKSPACE_IDENTITY_FILES = ["IDENTITY.md", "SOUL.md", "USER.md"]
"""需要预置到 workspace 的人格文件列表。"""


def _install_workspace_identity_files(openclaw_home: Path) -> None:
    """预置 workspace 的人格文件（IDENTITY.md / SOUL.md / USER.md）。

    Install default identity files to the agent workspace directory.
    仅在目标文件不存在时写入（不覆盖用户修改）。
    """
    workspace_dir = openclaw_home / DEFAULT_WORKSPACE
    workspace_dir.mkdir(parents=True, exist_ok=True)

    for filename in _WORKSPACE_IDENTITY_FILES:
        target = workspace_dir / filename
        if target.exists():
            # 不覆盖用户已修改的文件
            continue
        source = _WORKSPACE_ASSETS_DIR / filename
        if not source.exists():
            logger.warning("workspace 预设文件缺失: %s", source)
            continue
        try:
            target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
            logger.info("预置 workspace 文件: %s", target)
        except OSError as exc:
            logger.warning("写入 workspace 文件失败: %s: %s", target, exc)


# ---------------------------------------------------------------------------
# 公共 API
# ---------------------------------------------------------------------------


def _try_install_default_agent_preset(openclaw_home: Path) -> None:
    """注入 Artifex Nexus 默认 agent 预设；失败仅 warn 不阻塞 bootstrap。

    Best-effort: requires the openclaw CLI to be installed (so we can shell out
    to ``openclaw config patch``). If CLI is missing or any step fails, log
    a warning and return — bootstrap itself still succeeds.
    """
    try:
        try:
            from . import agent_preset as _ap
            from . import runtime as _runtime
        except ImportError:
            import agent_preset as _ap  # type: ignore[no-redef]
            import runtime as _runtime  # type: ignore[no-redef]

        bin_path = _runtime._find_openclaw_bin(openclaw_home)
        if bin_path is None:
            logger.info(
                "agent_preset: openclaw CLI 未安装，跳过 Artifex Nexus 预设注入"
            )
            return

        result = _ap.install_default_preset(bin_path, openclaw_home)
        if result.success:
            logger.info(
                "agent_preset: %s (version=%s)", result.action, result.version
            )
        else:
            logger.warning(
                "agent_preset 注入失败（不阻塞 bootstrap）: %s", result.error
            )
    except Exception as exc:  # noqa: BLE001 - 兜底任何异常都不能阻塞 bootstrap
        logger.warning("agent_preset 注入抛出异常（已忽略）: %s", exc)


def _register_default_tool_sources(ts) -> None:
    """注册默认的 Nexus Tool 和 Skill 源码目录到 tool-sources.json。

    自动探测当前包中的 _bundled_nexus_tools 目录和 skills 目录。
    """
    try:
        pkg_dir = Path(__file__).resolve().parent

        # bundled Nexus Tools
        bundled = pkg_dir / "_bundled_nexus_tools"
        if bundled.is_dir():
            ts.register_source(str(bundled), "bundled", "bootstrap")

        # skills 目录（从项目根目录推导）
        # pkg_dir = .../wrapper/src/artifex_nexus/openclaw_wrapper/
        # project_root = pkg_dir.parents[5] (artifexnexus/)
        project_root = pkg_dir.parents[5]
        skills = project_root / "skills"
        if skills.is_dir():
            ts.register_source(str(skills), "skills", "bootstrap")

        # 用户实例 Nexus Tool 目录
        user_tools = Path.home() / ".artifexnexus" / "nexus-tools"
        if user_tools.is_dir():
            ts.register_source(str(user_tools), "user", "bootstrap")

        # SDK 单一源路径（供 DCC addon 定位 artifex_nexus_sdk）
        sdk_parent = project_root / "packages" / "dcc" / "shared"
        if sdk_parent.is_dir():
            ts.set_sdk_path(str(sdk_parent))
    except Exception:
        logger.warning("Failed to register default tool sources", exc_info=True)


def bootstrap(
    openclaw_home: Path,
    version: str = "v2026.5.4",
    port: int = DEFAULT_PORT,
    preserve_options: Optional[dict] = None,
) -> BootstrapResult:
    """初始化 ~/.artifexnexus/.openclaw/ 目录布局 + 生成 openclaw.json。

    Bootstrap the OpenClaw home directory with full layout and default config.

    Args:
        openclaw_home: OPENCLAW_HOME 路径（~/.artifexnexus/.openclaw/）。
        version: OpenClaw 版本号，默认 v2026.5.4。
        port: gateway 端口，默认 19789。
        preserve_options: 重装时的保留选项。键：
            - preserveProviders (bool): 保留 models.providers
            - preserveAuth (bool): 保留 auth.profiles + auth.order
            - preserveAgents (bool): 保留 agents.defaults + agents.list
            - preservePlugins (bool): 保留 plugins.entries（与新默认合并）
            为 None 或全 False 时行为与之前一致（全新覆写）。

    Returns:
        BootstrapResult: 包含创建目录列表、配置路径、token 是否新生成等信息。

    Raises:
        OSError: 目录创建失败。
        IOError: 配置文件写入失败。
    """
    openclaw_home = Path(openclaw_home).expanduser().resolve()
    created_dirs: list[Path] = []

    try:
        # 1. 创建目录布局
        created_dirs = _create_directory_layout(openclaw_home)

        # 2. 预置 workspace 人格文件（IDENTITY.md / SOUL.md / USER.md）
        _install_workspace_identity_files(openclaw_home)

        # 3. 读取旧配置（用于 preserve 合并）
        old_config: Optional[dict] = None
        if preserve_options and any(preserve_options.values()):
            old_config = read_config(openclaw_home)

        # 4. 生成默认配置
        config = _generate_default_config(openclaw_home, port)

        # 5. 按 preserve_options 深合并旧配置到新配置
        if old_config and preserve_options:
            config = _apply_preserve_options(config, old_config, preserve_options)

        # 注：自 2026-05-15 收敛后，不再迁移 auth-profiles.json
        # （API key 全部存 openclaw.json::models.providers.<id>.apiKey）。
        # 历史 auth-profiles.json 文件保留在原位但不再被读写。

        # 6. 写入 openclaw.json
        config_path = openclaw_home / "openclaw.json"
        _write_config(config_path, config)

        # 7. 注入 Artifex Nexus 默认 agent 预设（失败仅 warn，不阻塞 bootstrap）
        # EPIC-0001 第二批 #3 / STORY-0017
        _try_install_default_agent_preset(openclaw_home)

        # 8. 自动部署 mcp-bridge 插件（失败仅 warn，不阻塞 bootstrap）
        # 此时 openclaw.json 已就绪 + CLI 已安装 → install_gateway_mcp_bridge()
        # 可正常执行拷贝 + config patch + registry refresh。
        # 这也会自动生成 deploy-manifest.json，让 validate_all_deployments() 立即可用。
        try:
            try:
                from . import dcc_installer as _dcc
            except ImportError:
                import dcc_installer as _dcc  # type: ignore[no-redef]
            result = _dcc.install_gateway_mcp_bridge()
            if result["success"]:
                logger.info(
                    "bootstrap: mcp-bridge 插件已自动部署到 %s",
                    result.get("target"),
                )
            else:
                logger.warning(
                    "bootstrap: mcp-bridge 自动部署失败: %s",
                    result.get("error", "未知错误"),
                )
        except Exception:
            logger.warning(
                "bootstrap: mcp-bridge 自动部署异常（不阻塞 bootstrap）",
                exc_info=True,
            )

        # 9. 注册 Nexus Tool / Skill 源码目录到 tool-sources.json
        #    供 Blender/DCC 插件触发器系统定位 manifest 文件。
        try:
            from . import tool_sources as _ts
        except ImportError:
            import tool_sources as _ts  # type: ignore[no-redef]
        _register_default_tool_sources(_ts)

        return BootstrapResult(
            success=True,
            created_dirs=created_dirs,
            config_path=config_path,
        )

    except Exception as e:
        logger.exception("bootstrap failed")
        # 失败回滚：删除已创建的目录（仅删除本次创建的）
        for d in reversed(created_dirs):
            try:
                if d.exists():
                    d.rmdir()  # 只删空目录
            except OSError:
                pass

        return BootstrapResult(
            success=False,
            created_dirs=created_dirs,
            config_path=openclaw_home / "openclaw.json",
            error_message=str(e),
        )


def is_bootstrap_done(openclaw_home: Path) -> bool:
    """检查 bootstrap 是否已完成。

    Check if bootstrap has been completed.
    条件：openclaw.json 存在 + state/ 目录存在 + workspace/ 目录存在。
    """
    openclaw_home = Path(openclaw_home).expanduser().resolve()
    config_path = openclaw_home / "openclaw.json"
    state_dir = openclaw_home / "state"
    workspace_dir = openclaw_home / "workspace"

    return config_path.exists() and state_dir.exists() and workspace_dir.exists()


def read_config(openclaw_home: Path) -> Optional[dict]:
    """读取 openclaw.json 配置。

    Read openclaw.json configuration.

    遵守 `.ai/rules/30-agent-behavior.md` §8：openclaw.json 按 UTF-8 读取，但
    为向后兼容早期被 PowerShell 加了 UTF-8 BOM 的配置文件，进入 JSON 解析前
    必须先显式剥 BOM（``EF BB BF`` / ``\\ufeff``）。``json.loads`` 对 BOM
    会抛 ``JSONDecodeError``，此前本函数会静默返回 ``None``，导致上层
    ``get_gateway_token`` 拿不到 token，前端 WS 握手 1008 ``token_missing``
    （STORY-0039 bug）。
    """
    config_path = Path(openclaw_home).expanduser().resolve() / "openclaw.json"
    if not config_path.exists():
        return None
    try:
        raw = config_path.read_bytes()
        # 剥 UTF-8 BOM（如有）
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        text = raw.decode("utf-8")
        return json.loads(text)
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return None


def get_gateway_port(openclaw_home: Path) -> int:
    """从 openclaw.json 读取 gateway.port。

    Read gateway.port from openclaw.json.
    """
    config = read_config(openclaw_home)
    if config:
        port = config.get("gateway", {}).get("port", DEFAULT_PORT)
        if isinstance(port, int):
            return port
    return DEFAULT_PORT


def get_gateway_token(openclaw_home: Path) -> Optional[str]:
    """从 openclaw.json 读取 gateway 鉴权 token。

    Read the gateway auth token from openclaw.json.

    上游 v2026.5.4 schema 把 token 放在 ``gateway.auth.token``（``token`` 模式时）。
    早期 spike 假设的顶层 ``gateway.token`` 已被废弃，但兼容一段时间。

    Returns:
        token 字符串；未配置或非 token 模式时返回 ``None``。
    """
    config = read_config(openclaw_home)
    if not config:
        return None

    gw = config.get("gateway", {}) if isinstance(config, dict) else {}
    if not isinstance(gw, dict):
        return None

    # 主路径：v2026.5.4 真实位置
    auth = gw.get("auth", {})
    if isinstance(auth, dict):
        tok = auth.get("token")
        # token 字段可以是 string 或 SecretRef object；只取明文 string
        if isinstance(tok, str) and tok:
            return tok

    # 兼容老路径（早期 spike 假设的顶层 gateway.token）
    legacy = gw.get("token")
    if isinstance(legacy, str) and legacy:
        return legacy

    return None


def bootstrap_with_port_probe(
    openclaw_home: Path,
    version: str = "v2026.5.4",
    preferred_port: int = _ports.DEFAULT_PORT,
    preserve_options: Optional[dict] = None,
) -> tuple[BootstrapResult, int]:
    """bootstrap + 端口探测一体化（已弃用，STORY-0039 起请用 :func:`bootstrap_fixed_port`）。

    Bootstrap with automatic port conflict resolution.

    .. deprecated:: STORY-0039
        自动迁移 ``+20`` 步进会把 ``openclaw.json.gateway.port`` 写成 19809/19829…
        导致 Control UI allowedOrigins、Gateway WS URL、run/ports.json 全部漂移，
        调试难度剧增。新入口 :func:`bootstrap_fixed_port` 固定写 19789；端口被占
        时由 :func:`runtime.start_gateway` 负责"自家孤儿杀掉，外部占用报错"语义。
    """
    openclaw_home = Path(openclaw_home).expanduser().resolve()
    run_dir = openclaw_home.parent / "run"
    ports_json = run_dir / "ports.json"

    # 1. 尝试读取上次成功端口
    last_port = _ports.read_last_port(str(ports_json))
    probe_port = last_port if last_port else preferred_port

    # 2. 端口探测
    try:
        selected_port = _ports.pick_port(preferred=probe_port)
    except RuntimeError:
        # 所有候选端口不可用，使用 preferred_port 并让后续启动报错
        selected_port = preferred_port

    # 3. 写回 ports.json
    run_dir.mkdir(parents=True, exist_ok=True)
    _ports.write_last_port(str(ports_json), selected_port)

    # 4. bootstrap
    result = bootstrap(openclaw_home, version, selected_port, preserve_options=preserve_options)

    return result, selected_port


def bootstrap_fixed_port(
    openclaw_home: Path,
    version: str = "v2026.5.4",
    port: int = _ports.DEFAULT_PORT,
    preserve_options: Optional[dict] = None,
) -> tuple[BootstrapResult, int]:
    """固定端口版 bootstrap（STORY-0039 起的默认入口）。

    Fixed-port bootstrap: writes ``gateway.port = 19789`` unconditionally,
    does not probe, does not migrate to 19809/19829.

    设计要点（为什么不再自动迁移）：
      - 之前 :func:`bootstrap_with_port_probe` 在 19789 被**任何**进程占用时
        按 ``+20`` 步进迁到 19809，写入 ``openclaw.json`` + ``run/ports.json``。
        后果：Control UI ``allowedOrigins``、Gateway WS URL、Tauri 前端 port
        硬编码、``auth_info`` 结果全部漂移，每次端口状态变化都会产生多处
        不一致的"幻影配置"，调试/重装链路极难维护。
      - 新策略：**config 永远写 19789**；端口占用处理推给
        :func:`runtime.start_gateway` ——自家孤儿自动杀、外部占用显式报错让
        用户干预。这样 ``openclaw.json`` 是稳定的"意图配置"，运行期冲突
        是"瞬时错误"，两者正交。

    Args:
        openclaw_home: OPENCLAW_HOME 路径。
        version: OpenClaw 版本号。
        port: 目标端口（默认 19789；测试/特殊部署可覆盖）。
        preserve_options: 重装时保留选项（透传给 :func:`bootstrap`）。

    Returns:
        ``(BootstrapResult, port)``，第二个值恒等于入参 ``port``。
    """
    openclaw_home = Path(openclaw_home).expanduser().resolve()
    run_dir = openclaw_home.parent / "run"
    ports_json = run_dir / "ports.json"

    # 写回 ports.json（保持与 bootstrap_with_port_probe 的 run dir 约定一致，
    # 但值永远是 fixed port，不再产生 19809 这种漂移值）
    run_dir.mkdir(parents=True, exist_ok=True)
    _ports.write_last_port(str(ports_json), port)

    result = bootstrap(openclaw_home, version, port, preserve_options=preserve_options)
    return result, port


def reset_config_port_if_drifted(
    openclaw_home: Path,
    bin_path: Optional[Path] = None,
    default_port: int = _ports.DEFAULT_PORT,
) -> Optional[int]:
    """一次性自愈：若 ``openclaw.json.gateway.port`` 不等于 ``default_port``，
    改回 ``default_port``。同步修正 ``run/ports.json``。

    One-shot self-heal: if ``openclaw.json.gateway.port`` drifted off
    ``default_port`` (e.g. legacy ``bootstrap_with_port_probe`` left 19809),
    patch it back and align ``run/ports.json``.

    实现策略（为什么直写而非走 ``config patch``）：
      - 上游 ``config patch --stdin`` 在实际合并时会把整个 ``gateway`` 对象
        按 key 替换（而不是按 path merge），触发 ``size-drop`` 保护把写入
        reject。对于"只想改一个端口数字"这个极小操作，风险明显小于 patch
        带来的副作用链。
      - **仅此一处例外** 直写 ``openclaw.json`` 文本；所有其它写操作仍然
        必须走 ``config patch``（AGENTS §4）。
      - 直写前先备份到 ``openclaw.json.bak.port-heal-<ts>``，失败可恢复。

    Returns:
        修正前的旧 port（发生漂移时）；无漂移返回 ``None``；修正失败返回
        ``None`` 并记 warning（不阻塞 sidecar 启动）。
    """
    home = Path(openclaw_home).expanduser().resolve()
    current = get_gateway_port(home)
    if current == default_port:
        return None

    logger.warning(
        "检测到 gateway.port 漂移 (%d → 目标 %d)，尝试自愈…", current, default_port
    )

    # 1. run/ports.json：我们自己管理，无 schema 约束，直接重写
    run_dir = home.parent / "run"
    run_dir.mkdir(parents=True, exist_ok=True)
    _ports.write_last_port(str(run_dir / "ports.json"), default_port)

    # 2. openclaw.json：读完整 config → 改 gateway.port → 原子写回
    config_path = home / "openclaw.json"
    if not config_path.exists():
        # 无 config 就没法自愈；下次 bootstrap_fixed_port 会覆盖
        return current

    try:
        raw = config_path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):  # strip BOM（与 read_config 一致）
            raw = raw[3:]
        data = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
        logger.warning("读 openclaw.json 失败，跳过 port 自愈: %s", exc)
        return None

    if not isinstance(data, dict) or not isinstance(data.get("gateway"), dict):
        logger.warning("openclaw.json 结构异常，跳过 port 自愈")
        return None

    # 备份（时间戳后缀，保留历史状态可供追查）
    try:
        import time as _time
        bak = config_path.with_suffix(
            f".json.bak.port-heal-{int(_time.time())}"
        )
        bak.write_bytes(raw)
    except OSError as exc:
        logger.warning("备份 openclaw.json 失败（继续自愈）: %s", exc)

    data["gateway"]["port"] = default_port

    # 原子写（写临时文件 → rename），避免中途崩溃留下半截配置
    tmp = config_path.with_suffix(".json.tmp.port-heal")
    try:
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(config_path)
        logger.info("gateway.port 已从 %d 改回 %d（直写路径）", current, default_port)
        return current
    except OSError as exc:
        logger.warning("写回 openclaw.json 失败（已忽略）: %s", exc)
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        return None

