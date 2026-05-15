---
tags: [plan, replication, skill, tool, m4, m5]
created: 2026-05-15
status: draft
related_epics: [EPIC-0004, EPIC-0005]
related_stories: [STORY-0040]
related_survey: "[[artclaw-tool-manager-skill-tool-survey]]"
---

# ArtClaw Tool Manager — Skill & Tool 复刻接入方案

> 基于 `docs/research/artclaw-tool-manager-skill-tool-survey.md` 调研结论制定。
> 原则：不改动已验证的 MCP 基础设施，聚焦 Skill 平台层实现 + Web UI 接入。

---

## 一、前置条件

### ✅ 已有资产（无需改动）

| 组件 | 文件 | 状态 |
|------|------|------|
| Blender MCP Server | `packages/dcc/blender/.../mcp_server.py` | ✅ 端到端验证 |
| Gateway MCP Bridge Plugin | `packages/adapters/openclaw/gateway-plugin/src/index.ts` | ✅ 端到端验证 |
| MCP Bridge Client (Sidecar) | `packages/adapters/openclaw/wrapper/.../mcp_bridge.py` | ✅ 端到端验证 |
| Manifest JSON Schema | `packages/platform/contracts/schemas/manifest.schema.json` | ✅ 已定义 |
| Skill 包骨架 | `packages/platform/skill/src/.../skill/` | ⚠️ 仅目录/空文件 |
| Web UI Skill/Tool 页面 | `packages/apps/web/src/` | ✅ UI 已完成（mock 数据） |
| Chat + ToolCall 组件 | `packages/ui/src/components/tool-call.tsx` | ✅ 已验证 |

### ⚠️ 依赖项（需同步建设）

| 依赖 | 说明 | 影响 |
|------|------|------|
| `platform/core` 事件总线 | Skill 事件广播需要 EventBus | 阻塞 events.py |
| Sidecar Skill RPC | Web UI 需要通过 sidecar 访问 Skill API | 阻塞前端接线 |

---

## 二、总体方案

### 2.1 实施策略

采用 **"最小可行 Skill + 渐进接入"** 策略：

```
Phase A: 核心 Skill 包（decorator + manifest + hub）
    ↓
Phase B: 管理能力（registry + loader + installer + conflict）
    ↓
Phase C: Sidecar RPC + Web UI 接线（STORY-0040）
    ↓
Phase D: 迁移 5 个内置 Skill + 版本管理
    ↓
Phase E: Tool 独立注册表 + 发现（EPIC-0005）
```

### 2.2 架构约束（不可违反）

- **每个 DCC 只注册 1 个 MCP 工具 `run_python`**（ADR 0003 铁律）
- **Skill 由 AI 通过 `run_python` 中写代码调用**，不注册独立 MCP 工具
- **Contracts 先行**：所有数据结构先定义 JSON Schema
- **Skill 包不依赖具体 DCC 模块**（`bpy`/`unreal`）
- **安装路径**：`~/.artifexnexus/.openclaw/workspace/skills/`，copy 不用 symlink

---

## 三、分阶段实施

### Phase A: 核心 Skill 包 ⭐ 最优先

**目标**：Skill 可以被 `@tool` 装饰、被 manifest 描述、被 hub 执行。

#### A1. `decorator/` — @tool 装饰器

**文件**: `packages/platform/skill/src/artifex_nexus/skill/decorator/`

**实现内容**:
```python
# decorator/__init__.py — 公开 API
from .core import tool, ToolResult, artclaw_tool  # artclaw_tool 为兼容别名

# decorator/core.py — 核心实现
- @tool(name, description, category, risk_level, params) 装饰器
  - 将函数元数据存入 __tool_meta__ 属性
  - 自动从 type hints 推导参数 schema（当 params 未显式提供时）
  
- ToolResult 数据类
  - success(data) / error(message) 工厂方法
  - success: bool, data: Any, message: Optional[str]
```

**关键设计点**:
- `@artclaw_tool` 指向同一个实现，仅为别名
- `params` 优先使用显式提供，其次从 type hints 推导
- 装饰后的函数保持原有签名（`functools.wraps`）

**验收**: `@tool` 装饰的函数可被 `inspect.getmembers()` 发现 `__tool_meta__`

---

#### A2. `manifest/` — SkillManifest pydantic 模型

**文件**: `packages/platform/skill/src/artifex_nexus/skill/manifest/`

**实现内容**:
```python
# manifest/models.py
from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional

class ToolRef(BaseModel):
    name: str
    description: str = ""

class SoftwareVersionConstraint(BaseModel):
    min: Optional[str] = None
    max: Optional[str] = None

class SkillManifest(BaseModel):
    manifest_version: Literal["1.0"]
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    display_name: Optional[str] = None
    description: str = ""
    version: str = Field(pattern=r"^\d+\.\d+\.\d+(?:[-+].+)?$")
    author: str = ""
    license: str = ""
    software: Literal["universal", "unreal", "blender"]
    software_version: Optional[SoftwareVersionConstraint] = None
    category: str = ""
    risk_level: Literal["low", "medium", "high", "critical"] = "low"
    dependencies: list[str] = []
    tags: list[str] = []
    entry_point: str = "__init__.py"
    tools: list[ToolRef] = []
    
    @field_validator("tools")
    @classmethod
    def deduplicate_tool_names(cls, v):
        # 去重逻辑
        ...

# manifest/loader.py
def load_manifest(path: Path) -> SkillManifest:
    """从 manifest.json 文件加载并校验"""
    ...

# manifest/enums.py
class Category(str, Enum):
    SCENE = "scene"
    MODELING = "modeling"
    ...
    
class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
```

**关键设计点**:
- pydantic v2 模型，字段与 `manifest.schema.json` 对齐
- `load_manifest()` 从文件加载，失败时抛出 `ValidationError`
- `Category` 枚举先做最小集，后续扩展

**验收**: `load_manifest(Path("manifest.json"))` 返回合法 `SkillManifest`，校验失败抛异常

---

#### A3. `hub/` — SkillHub 运行时

**文件**: `packages/platform/skill/src/artifex_nexus/skill/hub/`

**实现内容**:
```python
# hub/core.py
class SkillHub:
    """Skill 运行时——执行 Skill、查询 Tool"""
    
    def __init__(self):
        self._skills: dict[str, SkillInstance] = {}  # name -> instance
    
    def load_skill(self, skill_path: Path) -> None:
        """加载单个 Skill 包（manifest.json + entry_point）"""
        ...
    
    def load_all(self, skills_dir: Path) -> None:
        """扫描目录加载所有 Skill"""
        ...
    
    def execute(self, tool_name: str, arguments: dict) -> ToolResult:
        """按 tool 名称查找并执行"""
        ...
    
    def list_tools(self, category: str = None) -> list[ToolInfo]:
        """列出所有已加载的 tool"""
        ...
    
    def get_skill(self, name: str) -> Optional[SkillInstance]:
        ...
    
    def reload(self) -> None:
        """重新加载所有 Skill"""
        ...

# hub/instance.py
@dataclass
class SkillInstance:
    """加载后的 Skill 运行时实例"""
    manifest: SkillManifest
    tools: dict[str, Callable]  # tool_name -> function
    source_path: Path
    layer: str  # "00_official" / ...

# hub/executor.py
def execute_tool(tool_fn: Callable, arguments: dict) -> ToolResult:
    """安全执行 @tool 函数，捕获异常"""
    ...
```

**公开 API**（顶层 `skill/__init__.py` 解锁）:
```python
from artifex_nexus.skill import execute, list_skills, get_skill, reload
```

**关键设计点**:
- `SkillHub` 单例模式（整个进程中一个实例）
- `execute(tool_name, args)` 是 AI 代码调用的入口
- 加载失败时跳过并记录日志，不阻断其他 Skill

**验收**: `SkillHub.load_all(skills_dir)` → `hub.execute("create_cube", {...})` 返回正确结果

---

### Phase B: 管理能力

#### B1. `version/` — 版本解析/比较/匹配

**文件**: `packages/platform/skill/src/artifex_nexus/skill/version/`

**实现内容**:
```python
基于 packaging.version 实现:
- parse_version(version_str) -> Version
- is_compatible(manifest: SkillManifest, software_version: str) -> bool
- find_best_version(versions: list[str]) -> str
```

---

#### B2. `loader/` — 分层加载

**文件**: `packages/platform/skill/src/artifex_nexus/skill/loader/`

**实现内容**:
```python
class SkillLoader:
    """按优先级层次加载 Skill"""
    
    LAYERS = ["00_official", "01_team", "02_user", "99_custom"]
    
    def __init__(self, base_dirs: dict[str, Path]):
        # base_dirs = {"00_official": Path("..."), "01_team": Path("...")}
        ...
    
    def discover(self) -> list[tuple[Path, str]]:
        """发现所有层的 Skill 路径，返回 (path, layer)"""
        ...
    
    def load_all(self, hub: SkillHub) -> None:
        """按层顺序加载到 SkillHub，高层覆盖低层同名 Skill"""
        ...
```

---

#### B3. `conflict/` — 冲突检测

**文件**: `packages/platform/skill/src/artifex_nexus/skill/conflict/`

**实现内容**:
```python
class ConflictDetector:
    def detect(self, existing: SkillManifest, incoming: SkillManifest) -> ConflictResult:
        """检测两个 Skill 之间的冲突"""
        ...
    
    def detect_batch(self, skills: list[SkillManifest]) -> list[ConflictResult]:
        """批量检测"""
        ...

@dataclass
class ConflictResult:
    name: str
    type: Literal["shadowed", "version_mismatch", "dependency"]
    details: str
    existing_layer: str
    incoming_layer: str
```

---

#### B4. `registry.py` — SkillRegistry

**文件**: `packages/platform/skill/src/artifex_nexus/skill/registry.py`

**实现内容**:
```python
class SkillRegistry:
    """Skill 查询/匹配/最佳版本选择"""
    
    def __init__(self, hub: SkillHub):
        self._hub = hub
    
    def find(self, name: str) -> Optional[SkillInstance]:
        ...
    
    def search(self, query: str = None, category: str = None,
               software: str = None, risk_level: str = None) -> list[SkillInstance]:
        ...
    
    def list_by_layer(self, layer: str) -> list[SkillInstance]:
        ...
    
    def get_tools(self, skill_name: str) -> list[ToolInfo]:
        ...
```

---

#### B5. `installer.py` — SkillInstaller

**文件**: `packages/platform/skill/src/artifex_nexus/skill/installer.py`

**实现内容**:
```python
class SkillInstaller:
    """Skill 安装/发布/同步/卸载/启用/禁用"""
    
    def __init__(self, target_dir: Path, registry: SkillRegistry):
        self._target_dir = target_dir  # ~/.artifexnexus/.openclaw/workspace/skills/
        self._registry = registry
    
    def install(self, source: Path, source_type: str = "local") -> SkillManifest:
        """安装 Skill：copy 到 target_dir + 写版本元数据"""
        ...
    
    def uninstall(self, name: str) -> None:
        """卸载：删除目录 + 清版本元数据"""
        ...
    
    def enable(self, name: str) -> None:
        """启用：重命名禁用标记"""
        ...
    
    def disable(self, name: str) -> None:
        """禁用：添加禁用标记"""
        ...
    
    def publish(self, name: str, target: str) -> None:
        """发布到目标（Git 仓库/registry）"""
        ...
    
    def sync(self, name: str) -> tuple[bool, str]:
        """同步：检测源更新 → 自动安装"""
        ...
    
    def list_installed(self) -> list[dict]:
        """列出已安装 Skill（含版本/状态/源信息）"""
        ...
```

**关键设计点**:
- 安装 = `shutil.copytree(src, dst)` + 记录元数据到 `~/.artifexnexus/config/skills.json`
- 禁用 = 在 Skill 目录放置 `.disabled` 标记文件
- 更新 = 检测源版本 vs 安装版本 → 覆盖安装
- 不删除源文件（source 与 installed 分开）

---

#### B6. `events.py` — Skill 事件广播

**文件**: `packages/platform/skill/src/artifex_nexus/skill/events.py`

**实现内容**:
```python
class SkillEvent(Enum):
    CREATED = "skill.created"
    UPDATED = "skill.updated"
    REMOVED = "skill.removed"
    RELOADED = "skill.reloaded"
    INSTALLED = "skill.installed"
    UNINSTALLED = "skill.uninstalled"
    ENABLED = "skill.enabled"
    DISABLED = "skill.disabled"
    SHADOWED = "skill.shadowed"  # 被高优先级覆盖
    CONFLICT = "skill.conflict"

# 通过 platform.core.event_bus 广播
# 如 core.event_bus 未就绪，先用 log + callback 模式
```

---

### Phase C: Sidecar RPC + Web UI 接线 (STORY-0040)

#### C1. Sidecar RPC — Skill 管理接口

**位置**: `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/`

**新增文件**: `skill_api.py`

```python
# Sidecar 暴露给 Web UI 的 Skill RPC 方法
class SkillAPI:
    """通过 JSON-RPC Over stdio 暴露 Skill 管理能力"""
    
    # RPC methods:
    def list_skills(self, category=None, software=None, source=None) -> list[dict]:
        """列出所有 Skill（已安装 + 可安装 + 注册表）"""
        ...
    
    def install_skill(self, source: str) -> dict:
        """安装 Skill"""
        ...
    
    def uninstall_skill(self, name: str) -> dict:
        """卸载 Skill"""
        ...
    
    def enable_skill(self, name: str) -> dict:
        ...
    
    def disable_skill(self, name: str) -> dict:
        ...
    
    def get_skill_detail(self, name: str) -> dict:
        """Skill 详情（含源码路径/安装目录）"""
        ...
    
    def list_tools(self, category=None, software=None) -> list[dict]:
        """列出所有已注册 Tool"""
        ...
    
    def get_tool_detail(self, name: str) -> dict:
        """Tool 详情（参数 schema/描述/所属 Skill）"""
        ...
    
    def run_tool(self, tool_name: str, arguments: dict) -> dict:
        """单次执行 Tool"""
        ...
    
    def search_skills(self, query: str) -> list[dict]:
        """搜索 Skill/Tool"""
        ...
```

**Sidecar main 注册**:
```python
# sidecar.py 中添加 RPC 方法注册
rpc.register("skill.list", skill_api.list_skills)
rpc.register("skill.install", skill_api.install_skill)
rpc.register("skill.uninstall", skill_api.uninstall_skill)
rpc.register("skill.enable", skill_api.enable_skill)
rpc.register("skill.disable", skill_api.disable_skill)
rpc.register("skill.detail", skill_api.get_skill_detail)
rpc.register("tool.list", skill_api.list_tools)
rpc.register("tool.detail", skill_api.get_tool_detail)
rpc.register("tool.run", skill_api.run_tool)
rpc.register("skill.search", skill_api.search_skills)
```

---

#### C2. Web UI — 替换 mock 数据

**定位**: STORY-0040 验收标准

**变更范围**:
1. 技能模块 Skill Tab — 替换 mock → `invoke("skill.list")` / `invoke("skill.detail")` 等
2. 技能模块 Tool Tab — 替换 mock → `invoke("tool.list")` / `invoke("tool.detail")`
3. 安装/卸载/启用/禁用 按钮 — 对接 `invoke("skill.install")` 等
4. Tool 运行 — 对接 `invoke("tool.run")`，或跳转 Chat 预输入
5. Skill 详情弹窗 — 对接 `invoke("skill.detail")` 获取源码/安装目录路径
6. 搜索 — 对接 `invoke("skill.search")`
7. Tool 收藏 — 本地 localStorage

**前端新增 hook/helper**:
```typescript
// packages/apps/web/src/lib/skill/skill-api.ts
export async function listSkills(filters?: SkillFilters): Promise<SkillItem[]>
export async function installSkill(source: string): Promise<void>
export async function uninstallSkill(name: string): Promise<void>
// ...
```

---

### Phase D: 内置 Skill 迁移 + 版本管理

#### D1. 迁移 5 个 OpenClaw Skill

来源：artclaw_bridge 项目中的 5 个内置 Skill:
1. `artifex-context` — 上下文信息采集
2. `artifex-memory` — 记忆读写管理
3. `artifex-knowledge` — 知识库搜索
4. `artifex-skill-manage` — Skill 自身的 CRUD
5. `artifex-highlight` — 代码/输出高亮格式化

**迁移工作**:
1. 找到 artclaw_bridge 对应源文件
2. 将 `SKILL.md` 改写为符合 `docs/development/skill-authoring/README.md` 格式
3. 构造 `manifest.json`
4. 用 `@tool` 装饰器改写原有函数
5. 放入 `~/.artifexnexus/.openclaw/workspace/skills/` 对应位置

#### D2. 版本元数据持久化

**文件**: `~/.artifexnexus/config/skills.json`

```json
{
  "installed": {
    "artifex-context": {
      "version": "1.0.0",
      "source": "official",
      "source_path": "packages/skills/official/artifex-context",
      "installed_at": "2026-05-15T..."
    }
  }
}
```

---

### Phase E: Tool 独立注册表 (EPIC-0005)

**目标**: Tool 与 Skill 解耦管理，提供全局 Tool 浏览/调用。

#### E1. ToolRegistry

```python
class ToolRegistry:
    """全局 Tool 注册表——跨 Skill 查询"""
    
    def discover(self, hub: SkillHub) -> None:
        """从 Hub 中扫描所有 @tool 函数"""
        ...
    
    def list_all(self, filters: dict = None) -> list[ToolInfo]:
        """列出所有 Tool（可选过滤）"""
        ...
    
    def get(self, name: str) -> Optional[ToolInfo]:
        ...
    
    def run(self, name: str, arguments: dict) -> ToolResult:
        """单次执行（封装 hub.execute）"""
        ...
    
    def get_schema(self, name: str) -> dict:
        """获取 Tool 的 JSON Schema 参数定义"""
        ...
```

#### E2. Web UI — Tool 页增强

- Tool 列表面向注册表查询（不再 mock）
- Tool 运行 → 右侧 D 面板展开参数表单（自动从 schema 生成）
- Tool 收藏 → localStorage 持久化
- @提及 Tool → Chat 预输入

---

## 四、EPIC-0004 / EPIC-0005 / STORY-0040 子故事拆分

### EPIC-0004: M4 · Skill 系统

| ID | 标题 | 估计 | 依赖 |
|----|------|------|------|
| STORY-0040-A1 | `@tool` 装饰器 + ToolResult 实现 | 1d | 无 |
| STORY-0040-A2 | SkillManifest pydantic 模型 + manifest 加载 | 0.5d | 无 |
| STORY-0040-A3 | SkillHub 运行时（load/execute/list） | 1.5d | A1, A2 |
| STORY-0040-B1 | 版本解析/比较/匹配 | 0.5d | A2 |
| STORY-0040-B2 | 分层加载器（SkillLoader） | 1d | A3, B1 |
| STORY-0040-B3 | 冲突检测（ConflictDetector） | 0.5d | B2 |
| STORY-0040-B4 | SkillRegistry 查询/匹配 | 1d | A3, B2 |
| STORY-0040-B5 | SkillInstaller 安装/卸载/启停/同步 | 2d | B4 |
| STORY-0040-B6 | Skill 事件广播（events.py） | 0.5d | B5 |
| STORY-0040-C1 | Sidecar Skill RPC 接口 | 1d | B4, B5 |
| STORY-0040-C2 | Web UI Skill Tab 替换 mock → 真实 API | 1.5d | C1 |
| STORY-0040-C3 | Web UI Tool Tab 替换 mock → 真实 API | 1d | C1 |
| STORY-0040-D1 | 迁移 5 个内置 Skill | 2d | A1, A2 |
| STORY-0040-D2 | 版本元数据持久化 + 更新/同步逻辑 | 1d | B5 |

**EPIC-0004 小计: ~15d (3w)**

---

### EPIC-0005: M5 · Tool 系统

| ID | 标题 | 估计 | 依赖 |
|----|------|------|------|
| STORY-0040-E1 | ToolRegistry 全局注册表 | 1d | A3 |
| STORY-0040-E2 | Tool 参数 schema 提取 + 表单生成 | 1d | E1 |
| STORY-0040-E3 | Web UI Tool 页增强（运行 + 收藏） | 1.5d | E1, E2 |
| STORY-0040-E4 | Tool 启停独立控制（不依赖 Skill 安装状态） | 1d | E1 |
| STORY-0040-E5 | @提及 Tool → Chat 预输入 + 上下文注入 | 1d | E3 |

**EPIC-0005 小计: ~5.5d (~1w)**

---

### STORY-0040: M3-FUNC-02 · 技能/系统/设置模块功能接线

| 验收项 | 对应子故事 | 状态 |
|--------|-----------|------|
| Skill 列表从 API 加载 | C2 | Phase C |
| Skill 安装/卸载/启用/禁用/更新/钉选 | C2 | Phase C |
| Skill 详情弹窗（源码/安装目录） | C2 | Phase C |
| Tool 列表从 API 加载 | C3 | Phase C |
| Tool 运行 → Chat | C3 | Phase C |
| Tool 收藏持久化 | C3 | Phase C |

---

## 五、优先级排序

```
优先级链:
  A1 (decorator) → A2 (manifest) → A3 (hub)
    ↘
  B1 (version) → B2 (loader) → B3 (conflict) → B4 (registry) → B5 (installer) → B6 (events)
    ↘
  C1 (sidecar RPC) → C2 (Skill UI) → C3 (Tool UI)
    ↘
  D1 (5 skills) → D2 (version metadata)
    ↘
  E1 (ToolRegistry) → E2 (schema) → E3 (Tool UI) → E4 (独立启停) → E5 (@提及)
```

**推荐执行顺序**: A1 → A2 → A3 → B4 → C1 → C2 → C3 → 剩余

这样可以在 A3 完成时就有一个最小可用 Skill 运行时，C2/C3 完成时 Skill/Tool UI 可用。

---

## 六、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `platform/core` event_bus 未实现，阻塞 events.py | 中 | 低 | 先用 callback + log 模式，event_bus 就绪后迁移 |
| Sidecar RPC 框架不支持新增方法注册 | 低 | 中 | 先检查 sidecar.py 的 RPC 注册机制 |
| 原 artclaw_bridge Skills 代码大量依赖旧 API | 中 | 中 | 先迁移 1 个最小 Skill 验证可行性 |
| Blender Skill 执行环境限制（无标准 pip 包） | 高 | 低 | Skill 代码保持纯 Python + DCC SDK，不引入外部包 |
| 多 DCC 场景下 Skill 重复执行 | 低 | 中 | Skill 执行时指定 DCC target，由 MCP 前缀路由 |

---

## 七、下一步行动

1. [ ] **审核本次方案**：确认实施顺序和范围
2. [ ] **检查 sidecar RPC 注册机制**：确认能否在 sidecar.py 新增 RPC 方法
3. [ ] **启动 Phase A**：开始实现 decorator + manifest + hub
4. [ ] **同步 `platform/core` 事件总线**：确认 event_bus 时间线与本次任务的协调

---

## 相关文档

- `[[../research/artclaw-tool-manager-skill-tool-survey]]` — 调研报告
- `[[../../specs/skill-system]]` — Skill 子系统设计
- `[[../../decisions/0003-mcp-tools-minimization]]` — MCP 最小化 ADR
- `[[../../vision/roadmap]]` — 路线图
- `../../tasks/backlog/EPIC-0004-m4-skill-system.md`
- `../../tasks/backlog/EPIC-0005-m5-tool-system.md`
- `../../tasks/backlog/STORY-0040-m3-func-modules-api.md`
