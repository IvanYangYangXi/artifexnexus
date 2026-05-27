---
name: nexus-skill-manage
description: >
  Manage Artifex Nexus skills: list, install, uninstall, sync, publish,
  and create new skills. Use when AI needs to: (1) install/uninstall/update skills,
  (2) publish skills from user layer to official/marketplace,
  (3) list available skills and filter by tags/software/layer,
  (4) create new skills with AI-generated SKILL.md + manifest.json + __init__.py.
  All operations via Python API through SkillHub + SkillInstaller.
  NOT for: OpenClaw CLI skill commands, ClawHub marketplace publishing,
  Nexus-Tool management (use nexus-tool-creator instead).
metadata:
  artifex_nexus:
    version: 1.0.0
    author: Artifex Nexus
    software: all
    tags: ["skill-management", "installer", "publish"]
---

# Artifex Nexus 技能管理

管理 Artifex Nexus 的 Skill 技能包：列出、安装、卸载、同步、发布、创建。

## 架构总览

```
源码 skills/{source}/{name}/SKILL.md          ──install──>  已安装 ~/.artifexnexus/.openclaw/workspace/skills/{name}/
  (Git 仓库，供多人协作)                                       (本地运行时，AI 实际加载)
```

- **install**：源码 → 已安装目录（物理拷贝）
- **update / sync**：对比源码与已安装，自动覆盖过时文件
- **publish**：marks 已安装 Skill 为已发布状态（扁平化架构下为 metadata 操作，无需文件复制）
- **uninstall**：删除已安装目录 + 清理用户偏好

## 调用方式

通过 MCP 工具 `run_python` 在 DCC 进程中执行 Python 代码。

Skill 的 Python API 位于 `packages/platform/skill/src/artifex_nexus/skill/`：
- `SkillHub` — 扫描 / 加载 / 查询 / 执行
- `SkillInstaller` — 安装 / 卸载 / 同步 / 发布
- `SkillConfig` — 用户偏好（禁用 / 置顶 / 收藏）

---

## 常用操作

### 初始化 SkillHub 与 SkillInstaller

```python
from artifex_nexus.skill import SkillHub, SkillInstaller

hub = SkillHub(
    layer_sources={
        "00_official": Path("skills/official"),
        "01_marketplace": Path("skills/marketplace"),
    },
)
installer = SkillInstaller(hub, layer_sources={
    "00_official": Path("skills/official"),
    "01_marketplace": Path("skills/marketplace"),
})

hub.scan_all_skills()  # 扫描所有源层 + 已安装目录
```

### 列出 Skill

```python
# 列出全部（每个 name 取最高优先级层级）
for entry in hub.list_entries():
    print(f"[{entry.layer}] {entry.name} v{entry.version} — {entry.description}")

# 按标签过滤（OR 匹配）
for entry in hub.list_entries(tags=["blender", "scene"]):
    print(entry.display_name)

# 按适用软件过滤
for entry in hub.list_entries(software="blender"):
    print(entry.name)

# 按层级过滤
for entry in hub.list_entries(layer="00_official"):
    print(entry.name)
```

### 安装 / 同步

```python
# 安装单个 Skill（默认从 00_official 源安装）
result = installer.install("dcc-node-graph-workflow", source_layer="00_official")
print(result.message)

# 同步：对比源码 vs 已安装，自动更新过时文件
result = installer.sync("dcc-node-graph-workflow", source_layer="00_official")
print(f"状态: {result.state}, 更新: {result.synced_files}")
```

### 卸载

```python
result = installer.uninstall("dcc-node-graph-workflow")
print(result.message)
```

### 发布（已安装 → 源码仓库）

```python
# 将 user 层的 Skill 发布到 marketplace
result = installer.publish(
    "my_custom_skill",
    target_layer="01_marketplace",
)
print(f"已发布 v{result.version} → {result.published_path}")
```

### 查询 SkillTool

```python
# 加载 Skill 的 Python 模块（收集 @skill_tool 函数）
instance = hub.load_skill("dcc-node-graph-workflow")
if instance and instance.is_loaded:
    for tool_name in instance.tools:
        print(f"  Tool: {tool_name}")
```

---

## 创建新 Skill

### 步骤

1. AI 根据用户需求生成 `SKILL.md`（含 YAML frontmatter）
2. 生成 `manifest.json`（补充元数据：tags、software、dependencies 等）
3. 如 Skill 包含可执行逻辑，生成 `__init__.py`（装饰工具函数，见下方 §装饰器规范）
4. 调用 `SkillInstaller.install()` 写入已安装目录
5. **运行 skill-compliance-checker 验证**（见下方 §合规检查）
6. 如检查不通过，修复后重新检查
7. 可选：`SkillInstaller.publish()` 发布到源码层

### SKILL.md 模板

```markdown
---
name: my-skill-name
description: >
  英文描述。包含触发条件和使用场景。
  Use when AI needs to: (1) ..., (2) ...
  NOT for: ...
metadata:
  artifex_nexus:
    software: [blender, unreal_engine]   # ✅ 必需："all" 或 DCC 列表
    version: 1.0.0                       # ✅ 必需：semver
    author: Artifex Nexus                # ✅ 必需
    display_name: "中文显示名"            # 可选
    tags: ["blender", "modeling"]        # 可选
    risk_level: low                      # 可选，默认 low
---

# Skill 标题

## 调用方式
通过 MCP 工具 `run_python` 执行。

## 操作示例
（代码示例）
```

### Frontmatter 字段规范

| 字段 | 必需 | 说明 |
|------|------|------|
| `name` | ✅ | kebab-case，如 `my-skill-name` |
| `description` | ✅ | 英文，含触发条件和排除场景 |
| `layout` | 可选 | OpenClaw 兼容 |
| `metadata` | 可选 | 嵌套对象，`artifex_nexus` 子块 |

**Artifex Nexus 专属字段**（`metadata.artifex_nexus.*`）：

| 字段 | 必需 | 说明 |
|------|------|------|
| `software` | ✅ 必需 | `"all"` 或 `["blender", "maya", ...]` |
| `version` | ✅ 必需 | semver，如 `1.0.0` |
| `author` | ✅ 必需 | 作者，如 `"Artifex Nexus"` 或 `"Ivan(杨己力)"` |
| `display_name` | 可选 | 中文显示名 |
| `tags` | 可选 | 标签数组（OR 匹配，category 已废弃） |
| `risk_level` | 可选 | `low` / `medium` / `high` / `critical`，默认 `low` |

### 装饰器规范

Skill 的 `__init__.py` 中工具函数需要根据目标 DCC 使用对应装饰器注册。

两个 SkillHub 运行时互相隔离：
- **Platform SkillHub**：扫描 `_artifex_skill_tool` 标记（来自 `@skill_tool`）
- **UE SkillHub**：扫描 `_ue_agent_tool` 标记（来自 `@ue_tool`）

| 目标 DCC | SkillHub | 装饰器 | 导入方式 |
|----------|----------|--------|----------|
| `general`（平台通用） | ✅ Platform | `@skill_tool` | `from artifex_nexus.skill import skill_tool` |
| `unreal_engine` | ✅ UE | `@ue_tool` | `from skill_hub import tool as ue_tool` |
| `blender` | ❌ | — | 纯知识型（仅 SKILL.md + manifest.json） |
| `maya` | ❌ | — | 纯知识型 |
| `3ds_max` | ❌ | — | 纯知识型 |
| `houdini` | ❌ | — | 纯知识型 |
| `comfyui` | ❌ | — | 纯知识型 |
| `substance_painter` | ❌ | — | 纯知识型 |
| `substance_designer` | ❌ | — | 纯知识型 |
| `unity` | ❌ | — | 纯知识型 |

> **规则**：
> - 非 DCC 或跨 DCC Skill → `@skill_tool`（平台标准）
> - UE Skill → `@ue_tool`（UE SkillHub 不支持 `@skill_tool`）
> - 其他 DCC（Blender/Maya/Max 等）→ 无装饰器（纯知识型 Skill，无 `__init__.py`）
> - 兼容别名：`@tool`（skill_hub 通用）、`@artclaw_tool`（过渡期）

### manifest.json 模板（最小）

```json
{
  "name": "my-skill-name",
  "description": "描述（与 SKILL.md frontmatter 一致）",
  "version": "1.0.0",
  "author": "Artifex Nexus",
  "software": [{"dcc": "blender"}],
  "tags": ["blender", "modeling"],
  "dependencies": []
}
```

> **注意**：`entry_point` 字段仅当 Skill 包含可执行 `__init__.py` 时才需要。纯知识型 Skill 不写 `entry_point`。

## Skill 分层

| 优先级 | 层级 | 来源 |
|--------|------|------|
| 最高 | `00_official` | `skills/official/` 源码 |
| 高 | `01_marketplace` | `skills/marketplace/` 源码 |
| 中 | `02_user` | 用户自定义 |
| 最低 | `99_custom` | `~/.artifexnexus/.openclaw/workspace/skills/` 已安装 |

同名 Skill 按层级优先级选择最高层。已安装目录为扁平结构，不分 official/team/user 子目录。

## MCP 工具对照

| DCC | MCP Tool Name | 说明 |
|-----|--------------|------|
| 所有 DCC | `run_python` | ADR 0003：每 DCC 只注册 1 个工具 |

> 注意：Artifex Nexus 统一使用 `run_python`，每个 DCC 只注册这一个 MCP 工具。

## 合规检查

创建或修改 Skill 后**必须**运行 `skill-compliance-checker` 验证：

```python
import sys
from pathlib import Path

checker_dir = Path("D:/MyProject_D/artifexnexus/tools/official/skill-compliance-checker")
sys.path.insert(0, str(checker_dir))
from main import check_skill_compliance

result = check_skill_compliance(
    source_root=Path("skills"),
    installed_root=Path.home() / ".artifexnexus" / ".openclaw" / "workspace" / "skills",
)

if not result.get("success"):
    print(f"⚠️ {result['report']}")
    # → AI 根据 issues 逐一修复 → 重新运行检查 → 直到 success=True
else:
    print("✅ 合规检查通过")
```

检查项：SKILL.md frontmatter（`metadata.artifex_nexus.*` 必需字段：software、version、author）、manifest.json schema、software/dcc 枚举 vs `categories.json`、依赖完整性、tags 格式、`__init__.py` 装饰器合规（`@skill_tool` / `@ue_tool` 等 DCC 装饰器）。

---

## 重命名 Skill

Skill 的身份标识由 **目录名** 和 **SKILL.md `name`** 共同决定，两者必须一致。
改名时必须同步修改以下 **5 个位置**，缺一不可：

### 必须同步修改的位置

| # | 位置 | 说明 |
|---|------|------|
| 1 | **SKILL.md frontmatter `name`** | 如 `name: old-name` → `name: new-name` |
| 2 | **manifest.json `name`** | 如 `"name": "old-name"` → `"name": "new-name"` |
| 3 | **源码目录名** | `skills/{source}/old-name/` → `skills/{source}/new-name/` |
| 4 | **已安装目录名** | `~/.artifexnexus/.openclaw/workspace/skills/old-name/` → `.../new-name/` |
| 5 | **用户偏好 `skills.json`** | `favorites`/`pinned`/`disabled` 中的旧名条目 |

### 重命名脚本模板

```python
from pathlib import Path
from artifex_nexus.skill import SkillHub, SkillInstaller
from artifex_nexus.core.skill_config import SkillConfig

old_name = "my-old-name"
new_name = "my-new-name"

# 0. 初始化
hub = SkillHub(layer_sources={...})
hub.scan_all_skills()
installer = SkillInstaller(hub, layer_sources={...})

# 1. 修改 SKILL.md frontmatter name
for source_dir in [Path("skills/official"), Path("skills/marketplace")]:
    skill_md = source_dir / old_name / "SKILL.md"
    if skill_md.exists():
        text = skill_md.read_text("utf-8")
        text = text.replace(f"name: {old_name}", f"name: {new_name}")
        skill_md.write_text(text, "utf-8")

# 2. 修改 manifest.json name
for source_dir in [Path("skills/official"), Path("skills/marketplace")]:
    mf = source_dir / old_name / "manifest.json"
    if mf.exists():
        import json
        data = json.loads(mf.read_text("utf-8"))
        data["name"] = new_name
        mf.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

# 3. 重命名源码目录
for source_dir in [Path("skills/official"), Path("skills/marketplace")]:
    old_dir = source_dir / old_name
    new_dir = source_dir / new_name
    if old_dir.is_dir() and not new_dir.exists():
        old_dir.rename(new_dir)

# 4. 重命名已安装目录
installed_dir = Path.home() / ".artifexnexus" / ".openclaw" / "workspace" / "skills"
old_installed = installed_dir / old_name
new_installed = installed_dir / new_name
if old_installed.is_dir() and not new_installed.exists():
    old_installed.rename(new_installed)

# 5. 更新用户偏好
config = SkillConfig()
config.rename(old_name, new_name)  # 如果 SkillConfig 支持此方法
# 或手动修改：
# skills_json = Path.home() / ".artifexnexus" / "config" / "skills.json"
# ...
```

### 常见陷阱

| 陷阱 | 后果 |
|------|------|
| 只改目录名不改 SKILL.md `name` | Hub 按 frontmatter name 索引，列表中出现旧名或找不到 |
| 只改 SKILL.md 不改 manifest.json | 安装/同步时 manifest 校验失败（name 不一致） |
| 忘改已安装目录名 | `installed` 检查失败，显示为"未安装"但实际已安装 |
| 忘更新 `skills.json` | 旧的置顶/收藏/禁用偏好丢失 |
| 只改源码不改已安装目录 | 同步后两边 name 不一致，列表中出现两个同名条目 |
| name 与目录名不匹配且未修复 | Hub 记录 WARNING 日志，但不阻止扫描 — 潜伏 bug |

> **规则**：`name`（SKILL.md frontmatter）= `"name"`（manifest.json）= 源码目录名 = 已安装目录名。
> 任何不一致都是 bug，`hub/core.py` 的 `_build_skill_entry()` 会输出 WARNING。
