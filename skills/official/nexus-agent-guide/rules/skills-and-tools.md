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

---

## 关联 Skill 加载策略

当用户提出 Skill/Tool 相关需求时：
1. 先加载本文件了解系统概念
2. 如需具体操作步骤，加载对应引导 Skill：
   - Skill 管理 → `nexus-skill-manage`
   - Tool 创建 → `nexus-tool-creator`
   - 安装向导 → `nexus-installer-guide`
