---
name: nexus-skill-manage
description: >
  Manage Artifex Nexus skills: list, install, uninstall, sync, publish,
  and create new skills. Use when AI needs to: (1) install/uninstall/update skills,
  (2) publish skills from user layer to official/marketplace,
  (3) list available skills and filter by tags/software/layer,
  (4) create new skills with AI-generated SKILL.md + manifest.json + __init__.py.
  All operations via Python API through SkillHub + SkillInstaller.
  After every operation (install/sync/publish/uninstall/create/rename/compliance-check),
  MUST send a toast + bell notification via the platform notification system.
  NOT for: OpenClaw CLI skill commands, ClawHub marketplace publishing,
  Nexus-Tool management (use nexus-tool-creator instead).
metadata:
  artifex_nexus:
    version: 1.1.0
    author: Artifex Nexus
    software: all
    tags: ["skill-management", "installer", "publish", "notification"]
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

**装饰器 = SkillHub 服务注册的触发器。** 被 ``@skill_tool`` 装饰的函数存入注册表，AI 可以按名调用 ``execute_skill("工具名", {参数})``。没有装饰器的代码 AI 仍可通过 ``run_python`` 执行。

**装饰器统一为 ``@skill_tool``**（全平台唯一装饰器，来自 ``artifex_nexus_sdk.decorator``）。
所有 Hub 通过 walk ``module.__dict__`` 查找 ``_artifex_skill_tool = True`` 标记发现工具。

**什么时候写装饰器？**

| 场景 | 写装饰器？ | 调用方式 |
|------|-----------|---------|
| 稳定、高频、可复用的工具（查询、获取信息、通用编辑） | ✅ 写 | SkillHub 按名调用 |
| 定制化脚本、一次性需求 | ❌ 不写 | AI 读代码 → ``run_python`` 执行 |

**全 DCC 装饰器对照：**

| 目标 DCC | SkillHub 状态 | 装饰器 | 导入方式 |
|----------|-------------|--------|----------|
| `general`（平台通用） | ✅ 已实现 | ``@skill_tool`` | ``from artifex_nexus_sdk.decorator import skill_tool`` |
| `unreal_engine` | ✅ 已实现 | ``@skill_tool`` | 同上 |
| `blender` | ✅ 已实现 | ``@skill_tool`` | 同上 |
| `maya` | ✅ 已实现 | ``@skill_tool`` | 同上 |
| `3ds_max` | ✅ 已实现 | ``@skill_tool`` | 同上 |
| `houdini` | 📋 规划中 | ``@skill_tool`` | 同上 |
| `comfyui` | 📋 规划中 | ``@skill_tool`` | 同上 |
| `substance_painter` | 📋 规划中 | ``@skill_tool`` | 同上 |
| `substance_designer` | 📋 规划中 | ``@skill_tool`` | 同上 |
| `unity` | 📋 规划中 | ``@skill_tool`` | 同上 |

> **规则**：
> - 全 DCC 统一使用 ``@skill_tool``，无例外
> - 装饰器仅标记属性（``_artifex_skill_tool = True``），所有 Hub 统一发现机制（walk ``__dict__``）
> - 稳定通用工具 → 写装饰器；定制一次性脚本 → 不写装饰器
> - 共享 SkillHub（``artifex_nexus_sdk.skill_hub``）已为所有 DCC 提供统一实现

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

检查项：SKILL.md frontmatter（`metadata.artifex_nexus.*` 必需字段：software、version、author）、manifest.json schema、software/dcc 枚举 vs `categories.json`、依赖完整性、tags 格式、`__init__.py` `@skill_tool` 装饰器合规。

---

## 通知集成

完成以下操作后**必须**发送通知（toast 气泡 + 铃铛通知中心），让用户实时感知结果：

| 操作 | 触发时机 | 通知内容示例 |
|------|---------|-------------|
| 安装 Skill | 安装成功/失败后 | "✅ 已安装 blender-operation-rules v1.0.0" |
| 同步 Skill | 同步完成后 | "🔄 已同步 dcc-node-graph-workflow：更新 3 个文件" |
| 发布 Skill | 发布成功后 | "📤 已发布 my-skill v1.0.0 → marketplace" |
| 卸载 Skill | 卸载完成后 | "🗑️ 已卸载 blender-operation-rules" |
| 创建 Skill | 创建 + 合规检查后 | "✅ 新 Skill my-skill 已创建，合规检查通过" |
| 合规检查 | 检查完成后 | "⚠️ Skill 合规检查：3 错误 2 警告" 或 "✅ Skill 合规检查通过" |
| 重命名 Skill | 重命名完成后 | "✅ 已将 old-name 重命名为 new-name（5 处已同步）" |

### 通知发送方式

通过 Python 文件桥接写入 `~/.artifexnexus/pending_notifications/`：

```python
import json, time, random
from pathlib import Path

def send_notification(title: str, message: str, notif_type: str = "success"):
    """发送通知到前端 toast + 铃铛。type: success / warning / error"""
    notif_dir = Path.home() / ".artifexnexus" / "pending_notifications"
    notif_dir.mkdir(parents=True, exist_ok=True)
    ts = int(time.time() * 1000)
    rand = random.randint(1000, 9999)
    notif_file = notif_dir / f"notif_{ts}_{rand}.json"
    notif_file.write_text(json.dumps({
        "type": notif_type,
        "title": title,
        "message": message,
        "source": "nexus-skill-manage",
    }, ensure_ascii=False), encoding="utf-8")

# 示例：安装成功后
send_notification(
    "Skill 安装完成",
    "✅ 已安装 blender-operation-rules v1.0.0",
    "success",
)
```

> 详细通知系统文档见 `nexus-agent-guide/rules/notifications.md` 和 `rules/notifications-python.md`。

---

## Agent 导向 Skill 的分层文档策略

当 Skill 的目标读者是 Agent（AI）而非人类用户时，应采用分层文档结构，让 Agent 按需加载，避免一次性吞入大量 token。

### 设计原则

1. **入口文件尽量短** — `SKILL.md` 仅作为规则索引 + 读取策略指引，不加载全部内容
2. **按主题拆分子文档** — 每个规则 / 通道 / 场景独立一个 `.md`，放在 `rules/` 子目录
3. **按需读取** — Agent 先看索引，根据当前任务选择性地加载子文档
4. **API 参考文档分离** — `api-reference.md` 放在最后加载，仅在需要精确参数时查阅

### 推荐目录结构

```
skills/official/{skill-name}/
├── SKILL.md                    # 入口：索引 + 读取策略 + 场景速查表
├── manifest.json
├── rules/                      # 规则子文档（按主题拆分）
│   ├── topic-a.md              #   规则 A 概述
│   ├── topic-a-channel-1.md    #   规则 A 通道 1 详细指引
│   ├── topic-a-channel-2.md    #   规则 A 通道 2 详细指引
│   └── topic-b.md              #   规则 B
└── api-reference.md            # API 精确参数参考（最后加载）
```

### SKILL.md 入口模板

```markdown
# {Skill 标题}

采用分层文档结构：入口索引 → 规则概述 → 详细子文档，按需读取。

## 读取策略
1. 先读本文件 — 了解有哪些规则、何时加载子文档
2. 按需读子文档 — 只读当前任务需要的
3. api-reference.md 最后读 — 仅在需要精确参数时

## 规则索引
| 规则 | 文档 | 何时加载 |
|------|------|----------|
| {规则名} | `rules/{file}.md` | {触发条件} |
| ...

## 常见场景速查
| 场景 | 加载文档 |
|------|----------|
| ...
```

### 何时使用分层结构

| 条件 | 是否分层 |
|------|:---:|
| Skill 面向 Agent（AI 自动加载执行） | ✅ 分层 |
| Skill 内容 > 200 行且包含多个独立主题 | ✅ 分层 |
| Skill 面向人类用户阅读 | ❌ 单文件即可 |
| Skill 只有一个主题且 < 100 行 | ❌ 单文件即可 |

### 示例

参考 `nexus-agent-guide` Skill 的结构：

```
nexus-agent-guide/
├── SKILL.md                     # 入口：4 行规则索引 + 场景速查表
├── manifest.json
├── rules/
│   ├── notifications.md         #  通知规则概述 + 通道选择
│   ├── notifications-python.md  #  通道 A 详细指引
│   ├── notifications-gateway.md #  通道 B 详细指引
│   ├── notifications-tauri.md   #  通道 C 详细指引
│   └── cron-reply.md            #  cron 回复配置规则
└── api-reference.md             #  API 精确参数参考
```

> **关键**：Agent 先读 `SKILL.md`（~40 行）了解全貌，再根据需要加载 1-2 个子文档（各 ~30-50 行），而不是一次性吞入 230 行的单文件。

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
