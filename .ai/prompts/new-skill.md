# Prompt：新建一个 Skill

> 用法：把下面整段 prompt 复制给 AI，并替换 `{{}}` 占位符。

---

我要在 `{{unreal|blender}}` 中新增一个 **Skill 包** `{{skill_name}}`，作用是：
{{用一句话描述}}。

请按以下步骤执行：

1. **先读** `.ai/rules/00-architecture.md`、`docs/specs/skill-system.md`、`docs/development/skill-authoring/README.md`。
2. 严守命名约定：
   - **Skill = 包**（目录 + `SKILL.md` + `manifest.json` + `__init__.py`）
   - **Tool = 函数**，用 `@tool` 装饰（不是 `@skill`）
   - 装饰器统一 import：`from artifex_nexus.skill import tool, ToolResult`
3. **不允许**新增 MCP 工具；新能力一律以 Tool 方式提供，由 `run_python` 通过 `from artifex_nexus.skill import execute; execute(name, params)` 调用。
4. 在 `packages/dcc/{{unreal|blender}}/.../skills/{{category}}/{{skill_name}}/` 创建 Skill 包：
   - `manifest.json`（参考 `packages/platform/contracts/schemas/manifest.schema.json`）
   - `SKILL.md`（AI 触发文档）
   - `__init__.py`（含一个或多个 `@tool` 函数）
5. 给出最小 happy-path + 至少 1 个失败用例的 pytest 测试，放在对应包的 `tests/skills/`。
6. 如果引入了新概念，更新 `.ai/context/glossary.md`。
7. **不要写"用户使用文档"**——Skill 是给 AI 用的，AI 看 SKILL.md 就够。
8. 最后在你的回答末尾给出 checklist 自检结果。
