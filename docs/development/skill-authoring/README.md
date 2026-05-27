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
- **SkillTool** = Skill 包内被 ``@skill_tool`` 装饰的可调用函数，是实际执行的单位
- 一个 Skill 可暴露多个 SkillTool
- **纯知识型 Skill** = 仅 SKILL.md + manifest.json，无 ``__init__.py``

## 装饰器的作用

**装饰器 = SkillHub 服务注册的触发器。** 被 ``@skill_tool`` 装饰的函数存入注册表，
AI 可以直接按名调用 ``execute_skill("工具名", {参数})``，无需每次读代码。

**全平台统一为 ``@skill_tool``**（来自 ``artifex_nexus_sdk.decorator``）。
所有 Hub 通过 walk ``module.__dict__`` 查找 ``_artifex_skill_tool = True`` 标记发现工具。

**没有装饰器的代码 AI 仍然可以执行**——通过 ``run_python`` 发送代码。

### 什么时候写装饰器？

| 场景 | 写装饰器？ | 调用方式 |
|------|-----------|---------|
| 稳定、高频、可复用的工具（查询、获取信息、通用编辑） | ✅ 写 | SkillHub 按名调用 |
| 定制化脚本、一次性需求 | ❌ 不写 | AI 读代码 → ``run_python`` 执行 |

### 装饰器选择（全平台统一）

| 目标环境 | SkillHub 状态 | 装饰器 | 导入 |
|----------|-------------|--------|------|
| 所有 DCC | ✅ / 📋 | ``@skill_tool`` | ``from artifex_nexus_sdk.decorator import skill_tool`` |

> **已废弃**：``@ue_tool`` / ``@artclaw_tool`` / ``@tool`` 不再使用。全平台统一 ``@skill_tool``。

## 一个 SkillTool 只做三件事

1. 声明元数据（name / description / category / risk_level）
2. 定义参数 schema
3. 调用 DCC API

## 模板（全平台统一）

```python
from artifex_nexus_sdk.decorator import skill_tool, SkillToolResult

@skill_tool(
    name="my_tool",
    description="工具描述 / Tool description.",
    risk_level="low",
)
def my_tool(input_path: str) -> SkillToolResult:
    # DCC API 调用（unreal / bpy / maya.cmds ...）
    return SkillToolResult.success({"path": input_path})
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
