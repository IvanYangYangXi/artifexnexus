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
        },
        "agents": {
            "defaults": {
                "workspace": str(workspace_path),
            }
        },
        # Plugin 裁剪：仅保留 Artifex Nexus 需要的 plugin
        # 上游 schema 期望 plugins.entries.<plugin_id>.enabled 格式
        # 实测 v2026.5.4 plugin ID：
        #   - browser: @openclaw/browser-plugin (ID: browser)
        #   - file: File Transfer (ID: file-transfer)
        #   - shell/mcp/gateway 是内置能力，不需要在 plugins 中配置
        "plugins": {
            "entries": {
                "browser": {"enabled": True},
                "file-transfer": {"enabled": True},
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
) -> BootstrapResult:
    """初始化 ~/.artifexnexus/.openclaw/ 目录布局 + 生成 openclaw.json。

    Bootstrap the OpenClaw home directory with full layout and default config.

    Args:
        openclaw_home: OPENCLAW_HOME 路径（~/.artifexnexus/.openclaw/）。
        version: OpenClaw 版本号，默认 v2026.5.4。
        port: gateway 端口，默认 19789。

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

        # 2. 生成默认配置
        config = _generate_default_config(openclaw_home, port)

        # 3. 写入 openclaw.json
        config_path = openclaw_home / "openclaw.json"
        _write_config(config_path, config)

        # 4. 注入 Artifex Nexus 默认 agent 预设（失败仅 warn，不阻塞 bootstrap）
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
    """从 openclaw.json 读取 gateway.token。

    Read gateway.token from openclaw.json.
    """
    config = read_config(openclaw_home)
    if config:
        token = config.get("gateway", {}).get("token", "")
        if token and len(token) >= 48:
            return token
    return None


def bootstrap_with_port_probe(
    openclaw_home: Path,
    version: str = "v2026.5.4",
    preferred_port: int = _ports.DEFAULT_PORT,
) -> tuple[BootstrapResult, int]:
    """bootstrap + 端口探测一体化。

    Bootstrap with automatic port conflict resolution.
    先读取 run/ports.json 上次成功端口，probe 是否空闲；
    若空闲则复用，否则调用 pick_port 自动迁移。

    Args:
        openclaw_home: OPENCLAW_HOME 路径。
        version: OpenClaw 版本号。
        preferred_port: 首选端口，默认 19789。

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
    result = bootstrap(openclaw_home, version, selected_port)

    return result, selected_port
