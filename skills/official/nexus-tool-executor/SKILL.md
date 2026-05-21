---
name: nexus-tool-executor
description: >
  Executes Artifex Nexus tools via the appropriate channel.
  Use when AI needs to: (1) run a nexus-tool by GUID or name,
  (2) determine whether to execute locally, via DCC MCP run_python,
  or by wrapping a Skill, (3) handle tool execution results.
  NOT for: creating tools (use nexus-tool-creator),
  managing skills (use nexus-skill-manage).
metadata:
  artifex_nexus:
    version: 1.0.0
    author: Artifex Nexus
    software: all
    tags: ["tool-executor", "nexus-tool", "runtime"]
---

# Artifex Nexus 工具执行器

当用户请求运行某个 Nexus-Tool 时激活。根据工具类型（script / skill_wrapper / composite）
选择正确的执行通道。

## 触发条件

- 用户点击「运行」按钮（传入 tool GUID）
- 用户说「运行工具 XXX」
- 用户说「执行命名检查」等

## 核心规则

### 1. 获取工具详情

```python
from artifex_nexus.skill.nexus_tool.registry import NexusToolRegistry
from pathlib import Path

registry = NexusToolRegistry(
    tools_path=Path("skills/official").parent / "tools",  # tools/ 根目录
)
nexus_tool = registry.get_nexus_tool(nexus_tool_id)  # UUID v4 GUID
if nexus_tool is None:
    # 工具未找到
    pass

manifest = nexus_tool.manifest
impl_type = manifest["implementation"]["type"]  # script / skill_wrapper / composite
software = nexus_tool.software  # List[DCCEntry]
```

### 2. 根据类型选择执行通道

| 条件 | 执行通道 |
|------|----------|
| `impl_type == "script"` 且 `software` 为空（通用） | `NexusToolRegistry.run_nexus_tool(id, params)` |
| `impl_type == "script"` 且 `software` 含真实 DCC | DCC MCP `run_python`（在目标 DCC 进程中执行） |
| `impl_type == "skill_wrapper"` | `SkillHub.execute_skill_tool()` 执行被包装的 Skill |
| `impl_type == "composite"` | AI 在对话中引导用户按管线顺序执行 |

### 3. 通过 DCC MCP run_python 执行（DCC 绑定工具）

> **SDK_PATH 说明**：`SDK_PATH` 需解析为项目 `packages/dcc/shared/` 目录的绝对路径，
> AI 执行时应根据项目根目录动态计算（如 `PROJECT_ROOT / "packages" / "dcc" / "shared"`）。

```python
# 构建执行代码
manifest = nexus_tool.manifest
impl = manifest.get("implementation", {})
tool_dir = nexus_tool.nexus_tool_path

code = f"""
import sys
sys.path.insert(0, {repr(tool_dir)})
sys.path.insert(0, {repr(SDK_PATH)})  # packages/dcc/shared/

import importlib.util
spec = importlib.util.spec_from_file_location(
    'nexus_tool_exec', {repr(Path(tool_dir) / impl.get("entry", "main.py"))}
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
result = mod.{impl.get("function", "main_function")}(**{repr(params)})
print(json.dumps(result))
"""

# 通过 MCP run_python 发送到目标 DCC
# 统一使用 run_python（ADR 0003：每 DCC 只注册 1 个工具）
```

### 4. 通用工具本地执行

```python
from artifex_nexus.skill.nexus_tool.registry import NexusToolRegistry

registry = NexusToolRegistry()
result = registry.run_nexus_tool(nexus_tool_id, params=user_params)
# result: NexusToolResult(success=bool, data=Any, error=str)
```

### 5. skill_wrapper 执行

```python
from artifex_nexus.skill import SkillHub

hub = SkillHub()
hub.scan_all_skills()

wrapper_skill_name = manifest["implementation"]["skill"]
fixed_params = manifest["implementation"].get("fixedParams", {})
merged_params = {**fixed_params, **user_params}

result = hub.execute_skill_tool(
    tool_name=wrapper_skill_name,
    arguments=merged_params,
)
```

---

## 参数预处理

AI 在调用工具前应按以下规则预处理参数：

### 路径格式转换

| DCC | 正确格式 | 常见错误 |
|-----|----------|----------|
| UE | `/Game/路径/资产名`（不含 `.uasset`） | `D:\Project\Content\...uasset` |
| Blender | 对象 name | `bpy.data.objects["Cube"]` |
| Maya | DAG 路径或短名 | — |

### 多目标输入

| 场景 | 处理 |
|------|------|
| 换行分隔多个路径 | 转为逗号分隔 |
| "选中的 XX" | 告知工具自动读取选中，无需手动填参数 |
| "文件夹下所有 XX" | 如工具不支持目录扫描，提示先选中 |

### 类型转换

| 场景 | 处理 |
|------|------|
| number 参数但用户给文字 | 转换（如 "一千" → 1000） |
| boolean 参数 | 是/否 → true/false |
| select 参数值不在 options 内 | 列出可选项供选择 |

---

## 批处理策略

| manifest 特征 | 策略 |
|---------------|------|
| 路径参数 description 含"逗号分隔" | 工具自带批处理 → 一次传入多个 |
| 路径参数不支持多值 | AI 循环调用 → 每次传一个 |
| `defaultFilters.typeFilter.source == "selection"` | 提示用户先选中目标 |
| `defaultFilters.typeFilter.source == "parameter"` | 必须手动传入路径 |

---

## 结果处理

### NexusToolResult 格式

```python
@dataclass
class NexusToolResult:
    success: bool
    data: Any = None
    error: str = ""
```

### 常见错误处理

| error | 含义 | AI 建议 |
|-------|------|---------|
| `NO_INPUT` | 未指定目标且无选中 | "请在 Content Browser 中选中要处理的资产" |
| `DCC_NOT_CONNECTED` | DCC 未连接 | "请先打开 Blender/Maya 并启动 Artifex Nexus Bridge 插件" |
| `EXECUTION_TIMEOUT` | 超时 | "处理数据量可能过大，建议减少处理数量" |
| `MISSING_INPUT` | 必填参数缺失 | 列出缺失参数名 |
| `Nexus-Tool not found` | tool_id 无效 | 检查 GUID 是否正确 |
| `targets DCC [...]` | 本地执行了 DCC 绑定工具 | 提示通过 `run_python` 在 DCC 内执行 |

---

## 执行前检查清单

AI 在执行前应完成：

1. ✅ 所有 `required=true` 参数有值
2. ✅ `select` 类型参数值在 `options` 范围内
3. ✅ `number` 类型参数值在 `min`/`max` 范围内
4. ✅ 路径格式符合目标 DCC 规范
5. ✅ DCC 绑定工具通过 `run_python` 执行（非本地）
6. ✅ 如有 `agentHint`，已阅读并遵循

## ⛔ 禁止事项

- **禁止编造执行结果** — 必须实际调用 API
- **禁止在 DCC 未连接时假装执行成功**
- **禁止对 UE 工具使用本地执行** — 必须通过 DCC MCP `run_python`

## MCP 工具对照

| DCC | MCP Tool Name |
|-----|--------------|
| 所有 DCC | `run_python` |
