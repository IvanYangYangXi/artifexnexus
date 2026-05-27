---
tags: [spec, skill-system, draft]
created: 2026-05-02
status: draft
---

# Skill 子系统设计

> 本文是原 [`artclaw_bridge/docs/specs/skill-management-system.md`](https://github.com/IvanYangYangXi/artclaw_bridge/blob/main/docs/specs/skill-management-system.md) 在 Artifex Nexus 下的重构版。
> **功能完整保留**，结构与 SDK 边界优化。详细原文见原项目，本文聚焦 Artifex Nexus 的设计差异。

## 1. 包组织（按职责拆，每文件 < 300 行）

```
packages/platform/skill/src/artifex_nexus/skill/
├── __init__.py           # 统一门面：from artifex_nexus.skill import skill_tool, SkillToolResult, execute_skill_tool, ...
├── decorator/            # @skill_tool 装饰器、参数 schema 推导（基于 type hints）
├── manifest/             # SkillManifest pydantic v2 模型 + Category / RiskLevel 枚举
├── loader/               # 分层加载（00_official > 01_marketplace > 01_team > 02_user > 99_custom）
├── version/              # 版本解析/比较（基于 packaging）+ 软件版本匹配
├── hub/                  # SkillHub：execute / list / get / reload（运行时入口）
├── conflict/             # 多层级命名冲突检测
├── registry.py           # SkillRegistry：查询 / 匹配 / 最佳版本选择
├── installer.py          # SkillInstaller：install / publish / sync / uninstall / enable / disable
├── events.py             # Skill 事件枚举（创建/更新/重载等），通过 core.event_bus 广播
└── categories.py         # 标准 Category 枚举
```

## 2. SDK / API 优化点（相对原项目）

| 点 | 原项目 | Artifex Nexus | 收益 |
|----|--------|--------------|------|
| 装饰器命名 | `@artclaw_tool` / `@ue_tool` | **全平台统一 `@skill_tool`**（来自 `artifex_nexus_sdk.decorator`）。所有 Hub 通过 walk `module.__dict__` 查找 `_artifex_skill_tool = True` 标记。`@ue_tool` / `@artclaw_tool` 已废弃 | 命名一致，统一发现机制 |
| manifest 校验 | `jsonschema`（手写校验） | **pydantic v2 模型**（schema 由 contracts 提供） | 类型提示 + 运行时校验一步到位 |
| 顶层 API | 散落在 `core.version_manager` / `cli.skill_hub` / `core.skill_decorator` | **统一 `from artifex_nexus.skill import ...`** | 隐藏子模块细节 |
| VersionManager | 一个大类承担"查询 + 安装 + 发布 + 同步" | **拆为 `SkillRegistry` + `SkillInstaller`** | 单一职责，易测易复用 |
| 状态变化通知 | 各处 print / log，UI 自己轮询 | **统一 EventBus 广播 SkillEvent** | Web UI 实时推送、热重载、跨进程一致 |
| CLI 命令前缀 | `artclaw skill *` | **`artifex skill *`** | 与品牌一致；子命令集完整保留 |

## 3. 装饰器使用（Skill 作者视角）

全平台统一使用 ``@skill_tool``（来自共享 SDK ``artifex_nexus_sdk.decorator``）。
所有 Hub（Platform / UE / 未来 DCC）通过 walk ``module.__dict__`` 查找
``_artifex_skill_tool = True`` 标记发现工具，机制完全统一。

### 3.1 统一示例

```python
from artifex_nexus_sdk.decorator import skill_tool, SkillToolResult

@skill_tool(
    name="create_static_mesh",
    description="在场景中创建静态网格体 / Spawn a static mesh actor.",
    risk_level="low",
)
def create_static_mesh(mesh_path: str, location=(0, 0, 0)) -> SkillToolResult:
    import unreal
    actor = unreal.EditorLevelLibrary.spawn_actor_from_object(
        unreal.load_asset(mesh_path), unreal.Vector(*location),
    )
    return SkillToolResult.success({"actor_name": actor.get_name()})
```

### 3.2 装饰器使用决策

```
Skill 需要可执行工具函数？
├── 是 → 稳定、高频、可复用？（查询、获取信息、通用编辑）
│   ├── 是 → 写 @skill_tool → SkillHub 自动发现 → AI 按名调用
│   └── 否 → 不写装饰器 → AI 通过 run_python 执行
└── 否 → 纯知识型 Skill（仅 SKILL.md + manifest.json）
```

**装饰器不是代码能否执行的前提**——没有装饰器的代码 AI 仍可通过 ``run_python`` 执行。
装饰器的唯一作用是**让 SkillHub 自动发现并注册**，使 AI 可以按名调用而非每次读代码。

### 3.3 SkillHub 状态

所有 Hub 使用统一的发现机制。SkillHub 未实现的 DCC，装饰器可提前写入（实现后自动生效）。

| DCC | SkillHub 状态 | 装饰器 | 导入 |
|-----|-------------|--------|------|
| `general`（平台） | ✅ 已实现 | ``@skill_tool`` | ``from artifex_nexus_sdk.decorator import skill_tool`` |
| `unreal_engine` | ✅ 已实现 | ``@skill_tool`` | 同上 |
| `blender` | 📋 规划中 | ``@skill_tool`` | 同上（SkillHub 完成后自动生效） |
| `maya` | 📋 规划中 | ``@skill_tool`` | 同上 |
| `3ds_max` | 📋 规划中 | ``@skill_tool`` | 同上 |
| `houdini` / `comfyui` / `substance_*` / `unity` | 📋 规划中 | ``@skill_tool`` | 同上 |

> **已废弃**：``@ue_tool`` / ``@artclaw_tool`` / ``@tool`` 不再使用。
> 所有 Skill 统一从 ``artifex_nexus_sdk.decorator`` 导入 ``skill_tool``。

> **命名约定**：
> - **Skill** = 一个包（``SKILL.md`` + ``manifest.json`` + 可选的 ``__init__.py``），是分发与版本管理的单位。
> - **SkillTool** = Skill 包内被 ``@skill_tool`` 装饰的可调用函数，是实际执行的单位。一个 Skill 可暴露多个 SkillTool。

## 4. AI 调用方式

AI 不直接调用 Tool，而是通过 MCP 唯一工具 `run_python`（Gateway 端会带 DCC 前缀变成 `mcp_unreal_run_python` / `mcp_blender_run_python`）执行：

```python
from artifex_nexus.skill import execute_skill_tool
result = execute_skill_tool("create_static_mesh", {
    "mesh_path": "/Game/Meshes/Cube",
    "location": [0, 0, 0],
})
print(result)
```

## 5. 安装路径（OpenClaw 平台规则）

```
~/.artifexnexus/.openclaw/workspace/skills/{skill-name}/   # 扁平结构，无 layer/dcc 子目录
```

由 `SkillInstaller` 通过 copy + version 元数据管理，**不使用 symlink**（保证 OpenClaw 看到的版本与 Artifex Nexus 注册的版本一致）。

## 6. 分层与冲突

### 源码目录（项目管理用，按层级区分）

```
skills/
├── official/              ← 00_official  官方 Skill（维护在 git 仓库中）
└── marketplace/           ← 01_marketplace  技能市场
```

> 用户自建 Skill 不放在源码目录中，通过 SkillHub 动态注册。

### 安装目标（OpenClaw 平台规则，扁平结构）

```
~/.artifexnexus/.openclaw/workspace/skills/{skill-name}/
```

> 所有已安装 Skill 直接放在此目录下，**不按 official/team/user 分目录**。
> 由 `SkillInstaller` 通过 copy + version 元数据管理，**不使用 symlink**。

### 加载优先级（数字越小越高）

- `00_official`     ← `skills/official/`（项目内官方源码）
- `01_marketplace`  ← `skills/marketplace/`（技能市场）
- `01_team`         ← 团队共享（publish metadata，无独立源目录）
- `02_user`         ← 用户安装（逻辑区分，安装路径扁平）
- `99_custom`       ← `~/.artifexnexus/.openclaw/workspace/skills/`（已安装目录扫描）

同名时高优先级覆盖低优先级，由 `conflict.py` 检测冲突并通过 `events.py` 广播 `SkillEvent.SHADOWED`。

## 7. CLI 命令

完整继承原项目（前缀改为 `artifex`）：

```
artifex skill create <name> [--category --software --template --description]
artifex skill generate "<自然语言描述>" [--category --software]
artifex skill test <name> [--software --dry-run]
artifex skill package <name> [--output --format]
artifex skill publish <name> [--target --message]
artifex skill install <source> [--source-type --software]
artifex skill list [--category --software --source]
artifex skill info|enable|disable|uninstall|update <name>
```

## 8. 多 Agent Skill 共享

### 8.1 背景

OpenClaw 支持多 agent（如 `artifex-nexus` + `twelve`），每个 agent 有独立 workspace。
OpenClaw 按 `<workspace>/skills/*/SKILL.md` 扫描可用 Skill。

### 8.2 共享策略：目录联结（Junction）

所有非主 agent workspace 的 `skills/` 通过 **Windows `mklink /J`（目录联结）**
指向主 `workspace/skills/`。在 Unix 上使用 `os.symlink`。

```
~/.artifexnexus/.openclaw/
├── workspace/
│   └── skills/                    ← 实体目录（SkillInstaller 真实安装目标）
│       ├── nexus-skill-manage/
│       └── ue57_material_node_edit/
└── workspace-twelve/
    └── skills/  ──Junction──→  workspace/skills/  （自动镜像）
```

**创建时机**：`bootstrap()` 中 `_ensure_skills_junctions()` 在官方 Skill 安装之后调用，
遍历所有 agent 配置自动创建联结。

### 8.3 Agent 配置约束

**禁止 `systemPromptOverride`**：agent 条目中不设置该字段，否则 OpenClaw 的
`buildEmbeddedSystemPrompt()` 被跳过，`<available_skills>` 块丢失。

**Agent 专属指令替代方案**：写入各 workspace 的 `AGENTS.md`，OpenClaw 在会话启动时
自动注入为 Project Context。

参见 ADR `[[../decisions/0009-skill-multi-agent-junction]]`。

## 9. 安装/卸载全链路架构

### 9.1 调用链路

```
┌─ Web UI ──────────────────────────────────────────────────────────────────┐
│  SkillList.tsx                                                            │
│  "安装" 按钮 → skillInstall(name) → invoke("skill_install", {params})     │
│  "卸载" 按钮 → skillUninstall(name) → invoke("skill_uninstall", {params}) │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │ Tauri IPC
┌─ Rust (Tauri) ────────────┼──────────────────────────────────────────────┐
│  commands/skill.rs        │                                              │
│  skill_install() → manager.call("skill.install", params)                 │
│  skill_uninstall() → manager.call("skill.uninstall", params)             │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │ JSON-RPC over stdio
┌─ Python Sidecar ──────────┼──────────────────────────────────────────────┐
│  skill_rpc.py              │                                              │
│  _handle_skill_install()  → installer.install(skill_name)                │
│  _handle_skill_uninstall() → installer.uninstall(skill_name)             │
│                                                                          │
│  _rpc_helpers.py                                                        │
│  _resolve_skill_install_dir() → 检查 Skill 是否已安装                     │
│  _get_skill_installer() → SkillInstaller(hub, layer_sources)             │
│    ├── _root = ~/.artifexnexus/.openclaw/workspace/skills                │
│    └── _target_skill_dir("02_user", name) → _root / name                 │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │
┌─ SkillInstaller ──────────┴──────────────────────────────────────────────┐
│  installer.py                                                             │
│  install(skill_name):                                                     │
│    1. _source_skill_dir("00_official", name) → 项目 skills/official/     │
│    2. _target_skill_dir("02_user", name) → workspace/skills/<name>/      │
│    3. shutil.copytree(source, target)                                    │
│    4. 若已存在 → 自动走 sync 更新                                        │
│                                                                          │
│  uninstall(skill_name):                                                  │
│    _target_skill_dir("02_user", name) → workspace/skills/<name>/         │
│    shutil.rmtree(target_dir)                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

### 9.2 关键路径常量

| 常量 | 值 | 定义位置 |
|------|-----|---------|
| `_DEFAULT_SKILLS_ROOT` | `~/.artifexnexus/.openclaw/workspace/skills` | `_rpc_helpers.py:30` / `installer.py:46` |
| `_DEFAULT_CONFIG_PATH` | `~/.artifexnexus/config/skills.json` | `_rpc_helpers.py:31` |
| 源目录 `00_official` | `<project_root>/skills/official/` | `_find_skill_layer_sources()` |
| 源目录 `01_marketplace` | `<project_root>/skills/marketplace/` | `_find_skill_layer_sources()` |

### 9.3 重装恢复流程

```
Phase 0: _backup_for_reinstall → 备份 workspace/skills/ 到 backups/<ts>/skills/
Phase 2: _clean_install → 删除整个 .openclaw/
Phase 2: install_openclaw → CLI 重装
Phase 2: bootstrap() → 创建目录布局 → 写入 openclaw.json
         → _try_install_official_skills → 安装官方 Skill
         → _ensure_skills_junctions → 创建 workspace-twelve/skills/ 联结
Phase 3: _restore_from_backup → _restore_skills → 复制备份回 workspace/skills/
         → junction 自动反映恢复后的 skills
```

### 9.4 "已安装" 判断

`_resolve_skill_install_dir(skill_name)` 始终检查
`~/.artifexnexus/.openclaw/workspace/skills/<skill_name>/`。
从不检查 junction 路径，保证一致性。

## 10. TODO

- [ ] 把原 `core/version_manager.py` 完整迁移并按本文档拆包
- [ ] 把原 5 个 OpenClaw Skill（`artifex-context` / `artifex-memory` / `artifex-knowledge` / `artifex-skill-manage` / `artifex-highlight`）的 SKILL.md 改名并迁入
- [ ] 把 manifest schema 从 jsonschema 迁到 contracts/schemas/manifest.schema.json + pydantic 模型
- [ ] 实现 EventBus（在 `platform/core` 中）
- [ ] 写 SkillRegistry / SkillInstaller 的契约测试

## 相关

- `[[../decisions/0003-mcp-tools-minimization]]`
- `[[../decisions/0009-skill-multi-agent-junction]]`
- `[[../development/skill-authoring/README]]`
- `[[../../packages/platform/skill]]`（包源码）
