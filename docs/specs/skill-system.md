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
| 装饰器命名 | `@artclaw_tool` / `@ue_tool` | **统一 `@skill_tool`**；`@artclaw_tool` / `@tool` 保留为别名兼容 | 命名一致，区分 Skill（包）与 SkillTool（函数）语义 |
| manifest 校验 | `jsonschema`（手写校验） | **pydantic v2 模型**（schema 由 contracts 提供） | 类型提示 + 运行时校验一步到位 |
| 顶层 API | 散落在 `core.version_manager` / `cli.skill_hub` / `core.skill_decorator` | **统一 `from artifex_nexus.skill import ...`** | 隐藏子模块细节 |
| VersionManager | 一个大类承担"查询 + 安装 + 发布 + 同步" | **拆为 `SkillRegistry` + `SkillInstaller`** | 单一职责，易测易复用 |
| 状态变化通知 | 各处 print / log，UI 自己轮询 | **统一 EventBus 广播 SkillEvent** | Web UI 实时推送、热重载、跨进程一致 |
| CLI 命令前缀 | `artclaw skill *` | **`artifex skill *`** | 与品牌一致；子命令集完整保留 |

## 3. 装饰器使用（Skill 作者视角）

```python
from artifex_nexus.skill import skill_tool, SkillToolResult

@skill_tool(
    name="create_static_mesh",
    description="在场景中创建静态网格体 / Spawn a static mesh actor.",
    category="scene",
    risk_level="low",
    params={
        "mesh_path": {"type": "string", "required": True},
        "location":  {"type": "vec3", "default": [0, 0, 0]},
    },
)
def create_static_mesh(mesh_path: str, location=(0, 0, 0)) -> SkillToolResult:
    import unreal
    actor = unreal.EditorLevelLibrary.spawn_actor_from_object(
        unreal.load_asset(mesh_path), unreal.Vector(*location),
    )
    return SkillToolResult.success({"actor_name": actor.get_name()})
```

> **命名约定**：
> - **Skill** = 一个包（`SKILL.md` + `manifest.json` + `__init__.py`），是分发与版本管理的单位。
> - **SkillTool** = Skill 包内被 `@skill_tool` 装饰的可调用函数，是实际执行的单位。一个 Skill 可暴露多个 SkillTool。

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

## 8. TODO

- [ ] 把原 `core/version_manager.py` 完整迁移并按本文档拆包
- [ ] 把原 5 个 OpenClaw Skill（`artifex-context` / `artifex-memory` / `artifex-knowledge` / `artifex-skill-manage` / `artifex-highlight`）的 SKILL.md 改名并迁入
- [ ] 把 manifest schema 从 jsonschema 迁到 contracts/schemas/manifest.schema.json + pydantic 模型
- [ ] 实现 EventBus（在 `platform/core` 中）
- [ ] 写 SkillRegistry / SkillInstaller 的契约测试

## 相关

- `[[../decisions/0003-mcp-tools-minimization]]`
- `[[../development/skill-authoring/README]]`
- `[[../../packages/platform/skill]]`（包源码）
