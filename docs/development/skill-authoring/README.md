---
tags: [development, skill, draft]
created: 2026-05-02
status: draft
---

# Skill 编写指南

> Skill 是给 AI 用的，**不需要写给最终用户的使用文档**——AI 通过 Skill 包内的
> `SKILL.md`（触发文档）和 `manifest.json`（元数据）就能正确调用。
> 本文是给**Skill 作者**的开发指南。

## 名词约定

- **Skill** = 一个包（目录 + `SKILL.md` + `manifest.json` + 可选的 `__init__.py`），是分发与版本管理的单位
- **SkillTool** = Skill 包内被 `@skill_tool`（平台）或 `@ue_tool`（UE DCC）装饰的可调用函数，是实际执行的单位
- 一个 Skill 可暴露多个 SkillTool
- **纯知识型 Skill** = 仅 SKILL.md + manifest.json，无 `__init__.py`。面向无 SkillHub 的 DCC（Blender/Maya/Max 等）

## 装饰器选择

Skill 按目标环境选择装饰器：

| 目标环境 | 装饰器 | 导入 |
|----------|--------|------|
| 平台通用 / 跨 DCC | `@skill_tool` | `from artifex_nexus.skill import skill_tool` |
| UE（Unreal Engine） | `@ue_tool` | `from skill_hub import tool as ue_tool` |
| Blender / Maya / Max / 其他 | 无（纯知识型） | —（无 SkillHub 运行时） |

> **`@skill_tool` 在 UE 中不可用**：UE SkillHub 只扫描 `_ue_agent_tool` 标记，不认识 `_artifex_skill_tool`。

## 一个 SkillTool 只做三件事

1. 声明元数据（name / description / category / risk_level）
2. 定义参数 schema
3. 调用 DCC API

## 模板

### 平台通用 Skill

```python
from artifex_nexus.skill import skill_tool, SkillToolResult

@skill_tool(
    name="my_tool",
    description="工具描述 / Tool description.",
    category="utils",
    risk_level="low",
    params={"input_path": {"type": "string", "required": True}},
)
def my_tool(input_path: str) -> SkillToolResult:
    # 通用逻辑，不依赖特定 DCC
    return SkillToolResult.success({"path": input_path})
```

### UE Skill

```python
from skill_hub import tool as ue_tool

@ue_tool(
    name="create_static_mesh",
    description="在场景中创建静态网格体 / Spawn a static mesh actor.",
    category="scene",
    risk_level="low",
)
def create_static_mesh(**kwargs) -> dict:
    import unreal
    mesh_path = kwargs.get("mesh_path")
    actor = unreal.EditorLevelLibrary.spawn_actor_from_object(
        unreal.load_asset(mesh_path), unreal.Vector(0, 0, 0),
    )
    return {"success": True, "actor_name": str(actor.get_name())}
```

详细规范见 `docs/specs/skill-system.md` §3。

## 安装路径

`~/.artifexnexus/.openclaw/workspace/skills/` —— 由 `SkillInstaller` 统一管理版本，**不要手动改文件**。

## 测试

CLI 提供离线测试（不依赖 AI 平台）：

```bash
artifex skill test create_static_mesh --mesh_path=/Game/Meshes/Cube
artifex skill list --category=scene
```

## 详细规范

见 `[[../../specs/skill-system]]`、`[[../../specs/系统架构设计]]`、ADR `[[../../decisions/0003-mcp-tools-minimization]]`。
