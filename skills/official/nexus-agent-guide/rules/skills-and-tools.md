# Skill 与 Nexus-Tool 系统

## 概念区分

| 概念 | 是什么 | 谁管理 | 操作入口 |
|------|--------|--------|---------|
| **Skill** | AI 技能包（Python 代码 + 指引文档） | AI Agent 加载后用 | Skills 面板 / SkillHub |
| **Nexus-Tool** | 用户本地工具（可执行程序/脚本） | 用户安装后使用 | Tools 面板 |
| **MCP Tool** | DCC 桥接工具（如 run_python） | Gateway 自动暴露 | 无需手动管理 |

---

## Skill 系统

### 能力范围
目前 66+ Skills 覆盖 11 种软件：
- **全功能插件**：UE / Blender / Maya / 3ds Max
- **Skill-only 软件**：ComfyUI / Houdini / Substance Painter / Substance Designer / Unity

### 关键操作（通过 nexus-skill-manage Skill 指引）

| 操作 | 说明 |
|------|------|
| 浏览 Skill | Skills 面板展示已安装和可安装的 Skill |
| 安装 Skill | 从官方市场/用户目录/URL 安装 |
| 创建 Skill | 编写 SKILL.md + manifest.json + Python 代码 |
| 调用 Skill | `skill_hub.execute_skill(name, params)` |
| 列出 Skill | `skill_hub.list_skills()` |

### 何时建议创建 Skill
- 用户反复执行相同操作流程
- 需要跨 DCC 复用的工作流
- 有分享/分发价值的操作序列

---

## Nexus-Tool 系统

### 核心概念
- **Tool JSON**：定义工具的名称、版本、入口脚本
- **触发器**：启动触发 / 禁用触发 / 无触发器 三态
- **安装器**：类似 Skill 的气泡弹窗确认安装流程

### 关键操作（通过 nexus-tool-creator Skill 指引）

| 操作 | 说明 |
|------|------|
| 安装 Tool | Tools 面板 → 搜索/导入 → 气泡确认 |
| 创建 Tool | 编写 Tool JSON + 入口脚本 |
| 管理触发器 | 启用/禁用自动触发 |
| 手动运行 | Tools 面板直接执行 |

### 入口函数签名约定

所有 nexus-tool 入口函数应支持 `event_data` 关键字参数：

```python
def main_function(event_data=None, **kwargs) -> dict:
    # event_data: 触发器上下文，手动运行时为 None
    # **kwargs:   用户参数 + 兼容未来扩展
    ...
    return {"success": True, ...}
```

启用了触发器的工具**必须**接 `event_data`（或至少 `**kwargs`），否则触发器调度时
会因 TypeError 报错。

### event_data Schema

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `trigger_type` | str | 通用 | `"event"` 或 `"watch"` |
| `trigger_id` | str | 通用 | manifest.triggers[].id |
| `tool_id` | str | 通用 | manifest.id |
| `event_type` | str | 通用 | 事件名（`"asset.import.post"` 或 `"watch"`） |
| `dcc_type` | str | event | DCC 名（仅 event 触发器） |
| `timing` | str | event | `"pre"` 或 `"post"` |
| `asset_path` | str | event | 资产路径便利字段 |
| `asset_name` | str | event | 资产名 |
| `asset_class` | str | event | 资产类型（StaticMesh/Texture2D 等） |
| `data` | dict | event | 完整原始 DCC payload |
| `file_path` | str | watch | 触发本次执行的文件绝对路径 |
| `file_event` | str | watch | `"created"` / `"modified"` / `"deleted"` |

### 增量模式（watch 触发器）

watch 触发器把"变更的那个文件"通过 `event_data["file_path"]` 传给工具，
工具可以据此只检查那一个文件所属的目标，比全量快得多。例如
`tool-compliance-checker` 支持：

```python
def check_compliance(event_data=None, **kwargs):
    if event_data and event_data.get("file_path"):
        # 增量：定位文件所属工具目录，只检查那一个
        tool_dir = _find_owning_tool_dir(event_data["file_path"])
        if tool_dir:
            return _check_single_tool(tool_dir)
    # 全量回退
    return _check_all_tools()
```

返回值会带 `mode: "incremental" | "full"` 让用户/AI 知道走的哪条路径。

---

## 关联 Skill 加载策略

当用户提出 Skill/Tool 相关需求时：
1. 先加载本文件了解系统概念
2. 如需具体操作步骤，加载对应引导 Skill：
   - Skill 管理 → `nexus-skill-manage`
   - Tool 创建 → `nexus-tool-creator`
   - 安装向导 → `nexus-installer-guide`
