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
    - plugins.entries: 启用的 plugin 列表（object 格式，仅 5 个）/ Enabled plugins (object format, 5 only)
    - browser.cdpPortRangeStart: CDP 端口段起始 / CDP port range start
    """
    workspace_path = openclaw_home / DEFAULT_WORKSPACE

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
        # Plugin 裁剪：仅保留 Artifex Nexus 需要的 plugin
        # 上游 schema 期望 plugins.entries.<plugin_id>.enabled 格式
        # 实测 v2026.5.4 plugin ID：
        #   - browser: @openclaw/browser-plugin (ID: browser)
        #   - file: File Transfer (ID: file-transfer)
        #   - memory-core: 记忆核心 + 梦境模式（dreaming）
        #   - shell/mcp/gateway 是内置能力，不需要在 plugins 中配置
        "plugins": {
            "entries": {
                "browser": {"enabled": True},
                "file-transfer": {"enabled": True},
                "memory-core": {
                    "config": {
                        "dreaming": {
                            "enabled": True,
                        }
                    }
                },
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
# 选择性保留逻辑（STORY-0020）
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

        # 6. 写入 openclaw.json
        config_path = openclaw_home / "openclaw.json"
        _write_config(config_path, config)

        # 7. 注入 Artifex Nexus 默认 agent 预设（失败仅 warn，不阻塞 bootstrap）
        # EPIC-0001 第二批 #3 / STORY-0017
        _try_install_default_agent_preset(openclaw_home)

        return BootstrapResult(
            success=True,
            created_dirs=created_dirs,
            config_path=config_path,
        )

    except Exception as e:
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
    """
    config_path = Path(openclaw_home).expanduser().resolve() / "openclaw.json"
    if not config_path.exists():
        return None
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
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
    """bootstrap + 端口探测一体化。

    Bootstrap with automatic port conflict resolution.
    先读取 run/ports.json 上次成功端口，probe 是否空闲；
    若空闲则复用，否则调用 pick_port 自动迁移。

    Args:
        openclaw_home: OPENCLAW_HOME 路径。
        version: OpenClaw 版本号。
        preferred_port: 首选端口，默认 19789。
        preserve_options: 重装时保留选项（透传给 bootstrap()）。

    Returns:
        (BootstrapResult, selected_port): bootstrap 结果和最终选定端口。
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
