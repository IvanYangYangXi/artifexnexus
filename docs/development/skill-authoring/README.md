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

- **Skill** = 一个包（目录 + `SKILL.md` + `manifest.json` + `__init__.py`），是分发与版本管理的单位
- **SkillTool** = Skill 包内被 `@skill_tool` 装饰的可调用函数，是实际执行的单位
- 一个 Skill 可暴露多个 SkillTool

## 一个 SkillTool 只做三件事

1. 声明元数据（name / description / category / risk_level）
2. 定义参数 schema
3. 调用 DCC API

## 模板

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
    import unreal  # 仅在 UE 环境可用
    actor = unreal.EditorLevelLibrary.spawn_actor_from_object(
        unreal.load_asset(mesh_path), unreal.Vector(*location),
    )
    return SkillToolResult.success({"actor_name": actor.get_name()})
```

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
