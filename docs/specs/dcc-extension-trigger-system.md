---
tags: [spec, dcc, trigger, blender, architecture]
created: 2026-05-18
updated: 2026-05-19
status: in-progress
---

# DCC 扩展触发器系统规范

> 定义 Artifex Nexus 工具在 DCC（Blender / Maya / Max / UE / Houdini / ...）内部的触发器架构。
> 以 Blender 为参考实现，跑通后扩展到其他 DCC。

## 1. 设计原则

### 1.1 核心原则

1. **DCC 本地执行**：触发器匹配与工具执行在 DCC 进程内完成，不经过 sidecar round-trip
2. **源码目录不变**：工具源码保留在原目录，通过配置文件记录路径
3. **配置驱动**：`~/.artifexnexus/config/tool-sources.json` 是唯一路径真相源
4. **声明式注册**：工具只需在 `manifest.json` 中声明 `triggers` 字段即可被自动发现
5. **用户可控**：每个 DCC 的触发器系统提供独立的启用/禁用开关
6. **三维度控制**：触发器启用/禁用分为 per-trigger（分闸）、tool-level（总闸）、DCC-level（全局）三个独立维度

### 1.2 触发器启用/禁用三维度

| 维度 | 存储位置 | 粒度 | UI 位置 | 读取方 |
|------|---------|------|---------|--------|
| 1. Per-Trigger `enabled` | `manifest.json` → `triggers[].enabled` | 单条触发器 | 工具详情面板 → 触发器条目开关 | Sidecar + DCC dispatcher |
| 2. Tool-Level 总闸 | `~/.artifexnexus/config/skills.json` → `nexus_tools.disabled[]` | 整个工具 | 工具卡片「启用/禁用触发」按钮 | Sidecar (via `SkillConfig`) + DCC dispatcher (直接读 JSON) |
| 3. DCC-Level 全局 | 各 DCC 插件自行管理 | 整个 DCC | DCC 面板内开关 | DCC dispatcher (`_enabled` 属性) |

**关键规则**：
- 三维度**互不修改**——禁用工具总闸不会改动 `triggers[].enabled`，反之亦然
- 三个维度是 **AND 关系**——全部启用才生效
- 「▶ 运行」按钮不受任何维度影响（手动运行永远可用）

### 1.3 与旧架构的区别

| 维度 | 旧架构（round-trip） | 新架构（DCC 本地） |
|------|---------------------|-------------------|
| 触发流程 | DCC → MCP → sidecar → MCP → DCC | DCC 内部完成 |
| 工具执行 | sidecar import（无 bpy） | DCC 内 import（有 bpy） |
| 弹窗 | sidecar 通过 run_python 回传 | DCC 直接 bpy popup_menu |
| 延迟 | ~100-500ms（网络 + 序列化） | ~10-50ms（本地 import） |
| SDK 路径 | sidecar 内部推导 | 读取 tool-sources.json 中的 sdk_path |

## 2. 架构总览

```
┌──────────────────────────────────────────────────┐
│                    DCC 进程                        │
│                                                    │
│  bpy.app.handlers.save_post                        │
│         │                                          │
│         ▼                                          │
│  _notify_trigger_event()                           │
│         │                                          │
│         ▼                                          │
│  ┌─────────────────────────────┐                  │
│  │  DCC TriggerDispatcher      │                  │
│  │                             │                  │
│  │  1. 读 tool-sources.json    │                  │
│  │     ├─ sdk_path             │                  │
│  │     └─ sources[]            │                  │
│  │  2. 扫描 manifest.json      │                  │
│  │  3. 匹配 event → tool       │                  │
│  │  4. import 工具模块          │                  │
│  │  5. 调用 entry 函数          │                  │
│  │  6. bpy popup_menu 弹窗     │                  │
│  └─────────────────────────────┘                  │
│         │                                          │
│         ▼ (可选)                                    │
│  MCP broadcast status → sidecar                    │
└──────────────────────────────────────────────────┘
```

## 3. 配置文件

### 3.1 `tool-sources.json` 扩展

路径：`~/.artifexnexus/config/tool-sources.json`

```jsonc
{
  "version": 1,
  "sdk_path": "/path/to/project/packages/dcc/shared",
  "sources": [
    { "path": ".../tools",                "type": "tools",    ... },
    { "path": ".../skills",               "type": "skills",   ... },
    { "path": "~/.artifexnexus/nexus-tools", "type": "user", ... }
  ],
  "updated_by": "bootstrap",
  "updated_at": "2026-05-19T10:00:00+00:00"
}
```

#### `sdk_path` 字段

- **类型**：`string | null`
- **语义**：`artifex_nexus_sdk` 包父目录。加入 `sys.path` 后 `import artifex_nexus_sdk as sdk` 可解析
- **写入点**：bootstrap.py（首次安装）、sidecar.py main()（启动期自动补齐缺失值）
- **读取点**：DCC 侧 TriggerDispatcher（Blender / Maya / ...）
- **为什么需要**：DCC addon 安装到 DCC 的插件目录后，脱离了 monorepo 源码树，无法通过向上查找定位 SDK 路径

### 3.2 `sources` 条目

每个 source 条目描述一个工具源码目录：

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | string | 绝对路径（写入时经 `_normalize_path()` 剥离 Windows `\\?\` 前缀） |
| `type` | string | `"bundled"` / `"skills"` / `"user"` |
| `last_verified` | string | ISO 8601 时间戳 |
| `tool_count` | int | 该目录下 manifest.json 数量 |
| `skill_count` | int | 该目录下 SKILL.md 数量 |

**source type 说明**：

| Type | 路径 | 内容 | 注册时机 |
|------|------|------|---------|
| `tools` | `<project>/tools/` | 内置 Nexus Tool（official + marketplace） | bootstrap + dcc_installer |
| `skills` | `<project>/skills/` | Skill 目录（含 manifest.json） | bootstrap + dcc_installer |
| `user` | `~/.artifexnexus/nexus-tools/` | 用户创建的实例工具 | bootstrap + sidecar 启动期确保 |

**Windows 路径去重**：`register_source()` 内部使用 `_normalize_path()` 剥离 `\\?\` 前缀，防止同一目录因路径前缀不同被重复注册。 |

## 4. 工具 manifest 触发器声明

### 4.1 触发器字段（v2 扁平格式）

工具在 `manifest.json` 中声明触发器，无需额外配置文件注册：

```jsonc
{
  "id": "marketplace/blender-object-naming-check",
  "triggers": [
    {
      "id": "uuid",                    // 触发器唯一 ID
      "name": "Blender保存时命名检查",  // 触发器显示名称
      "description": "保存文件时自动检查对象命名规范",  // 可选
      "enabled": true,                 // 维度1：per-trigger 启用/禁用
      "triggerType": "event",          // 触发器类型：event / schedule
      "dcc": "blender",                // 目标 DCC
      "eventType": "file.save.post",   // 事件名称（triggerType=event 时必填）
      "executionMode": "notify",       // notify / silent / block
      "useDefaultFilters": true,       // 是否使用工具默认 filters
      "conditions": {},                // 条件表达式（未来扩展）
      "scheduleConfig": {              // 定时触发配置（triggerType=schedule 时使用）
        "type": "interval",
        "interval": "30m"
      }
    }
  ]
}
```

### 4.2 格式兼容（新旧 fallback）

Dispatcher 读取时使用新旧格式 fallback，兼容升级前创建的旧实例工具：

```python
# Dispatcher _load_tools() 中的统一读取模式
trigger_type = t.get("triggerType") or (t.get("trigger", {}) or {}).get("type", "")
dcc = t.get("dcc") or (t.get("trigger", {}) or {}).get("dcc", "")
event_name = t.get("eventType") or (t.get("trigger", {}) or {}).get("event", "")
```

旧格式（已废弃，仅保留兼容读取）：

```jsonc
{ "trigger": { "type": "event", "dcc": "blender", "event": "file.save.post" } }
```

### 4.3 触发器类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `event` | DCC 钩子事件触发 | `file.save.post`, `file.open.post` |
| `schedule` | 定时触发 | 每 30 分钟（未来实现） |

### 4.4 执行模式

| 模式 | 行为 | Blender 表现 | Maya 表现（规划） |
|------|------|-------------|-----------------|
| `notify` | reject/error 时弹窗提示，需用户手动关闭 | `popup_menu` 弹窗 | `confirmDialog` |
| `silent` | reject/error 时气泡通知，5 秒自动消失 | draw handler 气泡 | `inViewMessage` |
| `block` | reject 时阻止操作并弹窗（未来实现） | — | — |

### 4.5 工具入口

```jsonc
{
  "implementation": {
    "entry": "main.py",         // 入口文件
    "function": "check_naming", // 入口函数
    "type": "script"
  }
}
```

工具入口函数签名：
```python
def check_naming(event_data=None, **kwargs):
    """返回 {"action": "allow"|"reject"|"error", "reason": str}"""
```

### 4.6 实例工具与 parentPath fallback

实例工具（`instanceOf` 标记）只存 `manifest.json`（用户修改的参数副本），**不复制 `main.py`**，脚本沿用父工具。

实例工具 manifest 特征字段：
```jsonc
{
  "id": "user/Example-Blender对象命名规范检查 (实例)-01",
  "instanceOf": "marketplace/Example-Blender对象命名规范检查",
  "parentPath": "D:\\...\\tools\\marketplace\\Blender对象命名规范检查",
  "implementation": {
    "entry": "main.py",
    "function": "check_naming",
    "sourceTool": "marketplace/Example-Blender对象命名规范检查",
    "type": "script"
  }
}
```

**TriggerDispatcher 必须实现 parentPath fallback**：执行工具时，若入口文件不在工具目录，fallback 到 `parentPath` 目录加载：

```python
def _execute_tool(self, tool_id, payload):
    manifest = reg["manifest"]
    tool_dir = reg["dir"]
    impl = manifest.get("implementation", {})
    entry = impl.get("entry", "main.py")

    # 实例工具 fallback：脚本沿用父工具
    entry_path = Path(tool_dir) / entry
    if not entry_path.exists():
        parent_path = manifest.get("parentPath", "")
        if parent_path and Path(parent_path).is_dir():
            tool_dir = parent_path

    # ... 后续 sys.path 插入和 import 使用 tool_dir
```

**注意**：此处 `tool_dir` 重赋值必须在 `paths_added.append(tool_dir)` 之前，确保 finally 块能正确清理路径。

## 5. DCC 侧 TriggerDispatcher 接口

### 5.1 公共接口

每个 DCC 实现自己的 `TriggerDispatcher`，对外暴露统一接口：

```python
class BaseDCCTriggerDispatcher:
    """DCC 触发器调度器抽象基类"""

    # ── 配置文件路径（各 DCC 实现相同）──
    TOOL_SOURCES_PATH = Path.home() / ".artifexnexus" / "config" / "tool-sources.json"
    SKILLS_CONFIG_PATH = Path.home() / ".artifexnexus" / "config" / "skills.json"

    def __init__(self):
        self._tool_registry: Dict[str, dict] = {}   # tool_id → metadata
        self._event_index: Dict[str, List[str]] = {} # event_type → [(tool_id, execution_mode), ...]
        self._loaded = False
        self._enabled = True  # 维度3：DCC 全局开关

    @property
    def enabled(self) -> bool:
        """触发器全局启用状态"""

    @enabled.setter
    def enabled(self, value: bool):
        """设置全局启用状态"""

    def load_tools(self) -> None:
        """扫描所有已注册源目录的 manifest，构建事件索引。
        必须实现三项检查：
        1. 维度2：跳过 skills.json nexus_tools.disabled 中的工具
        2. 维度1：跳过 triggers[].enabled=false 的触发器
        3. manifest 新旧格式 fallback
        """

    def on_trigger_event(self, event_type: str, filepath: str, data: dict) -> None:
        """DCC 事件入口。匹配触发器 → 执行工具 → 处理结果"""

    def _execute_tool(self, tool_id: str, payload: dict) -> dict:
        """动态 import 工具模块，调用 entry 函数。
        必须实现 parentPath fallback（§4.6）。
        """

    def _show_popup(self, issues: List[dict], event_type: str, filepath: str) -> None:
        """DCC 原生弹窗（Blender: bpy popup_menu, Maya: cmds.confirmDialog, ...）"""
```

### 5.2 SDK 路径注入

TriggerDispatcher 启动时：

1. 读取 `tool_sources_config.sdk_path`
2. 若 `sdk_path` 不在 `sys.path` 中，`sys.path.insert(0, sdk_path)`
3. 执行工具时，临时将工具所在目录加入 `sys.path`：

```python
def _execute_tool(self, tool_id, payload):
    tool_dir = self._tool_registry[tool_id]["dir"]
    # §4.6: 实例工具 parentPath fallback
    entry_path = Path(tool_dir) / entry
    if not entry_path.exists():
        parent_path = manifest.get("parentPath", "")
        if parent_path and Path(parent_path).is_dir():
            tool_dir = parent_path

    paths_added = []
    if tool_dir not in sys.path:
        sys.path.insert(0, tool_dir)
        paths_added.append(tool_dir)
    try:
        mod = importlib.import_module(module_name)
        fn = getattr(mod, function_name)
        result = fn(event_data=event_data)
        return result
    finally:
        for p in reversed(paths_added):
            if p in sys.path:
                sys.path.remove(p)
```

### 5.3 工具总闸读取（skills.json）

DCC dispatcher 无法 import `artifex_nexus.core.skill_config`（不在 DCC Python 环境），需**直接读 JSON**：

```python
SKILLS_CONFIG_PATH = Path.home() / ".artifexnexus" / "config" / "skills.json"

def _get_disabled_nexus_tools() -> set:
    """读取 skills.json → nexus_tools.disabled（工具总闸禁用列表）"""
    if SKILLS_CONFIG_PATH.exists():
        try:
            with open(SKILLS_CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
            nexus_tools = config.get("nexus_tools", {})
            disabled = nexus_tools.get("disabled", [])
            return set(disabled) if isinstance(disabled, list) else set()
        except (json.JSONDecodeError, OSError):
            pass
    return set()
```

### 5.4 _load_tools() 完整逻辑

```python
def _load_tools(self):
    # 1. 注入 SDK 路径
    sdk_path = _get_sdk_path()
    if sdk_path and sdk_path not in sys.path:
        sys.path.insert(0, sdk_path)

    # 2. 扫描所有已注册源目录的 manifest
    source_dirs = _get_source_dirs()        # 从 tool-sources.json 读取
    manifest_paths = _find_manifest_paths(source_dirs)

    # 3. 读取工具总闸禁用列表（维度2）
    disabled_tools = _get_disabled_nexus_tools()

    for mp in manifest_paths:
        manifest = json.load(open(mp))
        tool_id = manifest.get("id", "")
        if not tool_id:
            continue

        # 维度2：跳过工具总闸禁用的工具
        if tool_id in disabled_tools:
            continue

        # 维度1：筛选启用的触发器（新旧格式 fallback）
        for t in manifest.get("triggers", []):
            trigger_type = t.get("triggerType") or (t.get("trigger", {}) or {}).get("type", "")
            dcc = t.get("dcc") or (t.get("trigger", {}) or {}).get("dcc", "")
            event_name = t.get("eventType") or (t.get("trigger", {}) or {}).get("event", "")
            if trigger_type != "event" or dcc != self._dcc_name:
                continue
            if not t.get("enabled", True):
                continue  # 维度1
            # ... 注册工具 + 构建事件索引

    self._loaded = True
```

## 6. Blender 参考实现

### 6.1 文件结构

```
packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/
├── __init__.py                  # 面板 + 钩子注册 + UI 开关
├── trigger_dispatcher.py        # [新建] BlenderTriggerDispatcher
├── mcp_server.py                # [不改] MCP Server（可选状态上报）
├── blender_adapter.py           # [不改] Blender 适配层
└── base_adapter.py              # [不改] 抽象接口
```

### 6.2 BlenderTriggerDispatcher

- 继承/实现 `BaseDCCTriggerDispatcher` 接口（或直接独立实现）
- 弹窗使用 `bpy.context.window_manager.popup_menu()`
- UI 开关集成到侧栏面板 `ARTIFEX_PT_MainPanel`

### 6.3 UI 开关

在 Artifex Nexus 侧栏面板中添加触发器开关：

```
┌─ Artifex Nexus ──────────────┐
│ ● MCP Server 运行中           │
│ 端口: 18083                   │
│ 地址: ws://127.0.0.1:18083   │
│                               │
│ [停止 MCP Server]             │
│                               │
│ 触发器：● 启用  [禁用]       │  ← 新增
│                               │
│ Artifex Nexus MCP Bridge v5.0 │
└───────────────────────────────┘
```

### 6.4 触发流程

```
bpy.app.handlers.save_post
  → __init__._on_save_post_impl()
    → _notify_trigger_event("file.save.post", filepath)
      → if not _TRIGGER_ENABLED: return
      → dispatcher.on_trigger_event(event_type, filepath, data)
        → load_tools() [懒加载]
        → _match_triggers(event_type)
        → for tool_id in matched:
            result = _execute_tool(tool_id, payload)
        → if any reject/error:
            _show_popup(issues)       # bpy popup_menu
        → [可选] server.broadcast_trigger_event(status)
```

## 7. 扩展到其他 DCC

### 7.1 扩展清单

| DCC | 插件目录 | 钩子系统 | 弹窗 API | 状态 |
|------|---------|---------|---------|------|
| Blender | `%APPDATA%/Blender Foundation/Blender/<ver>/scripts/addons/` | `bpy.app.handlers` | `popup_menu()` | **实现中** |
| Maya | `~/Documents/maya/<ver>/scripts/` | `scriptJob` / `api.MSceneMessage` | `cmds.confirmDialog()` | 规划 |
| 3ds Max | `%LOCALAPPDATA%/Autodesk/3dsMax/<ver>/ENU/scripts/` | `callbacks.addScript()` | `messageBox()` | 规划 |
| Unreal Engine | `Content/Python/` (Editor Python) | `unreal.register_slate_post_tick_callback` | `unreal.EditorDialog` | 规划 |
| Houdini | `~/houdini<ver>/python3.11libs/` | `hou.nodeEventType` | `hou.ui.displayMessage()` | 规划 |

### 7.2 扩展要点

每个 DCC 需要实现：

1. **TriggerDispatcher 子类**：实现 `_show_popup()` 使用对应 DCC 的原生弹窗
2. **钩子注册**：在 addon 启用时注册 DCC 事件钩子，禁用时反注册
3. **UI 开关**：在 DCC 面板/菜单中添加触发器启用/禁用控制
4. **SDK 路径**：从 `tool-sources.json` 读取 `sdk_path`

## 8. 配置写入流程

```
bootstrap.py (首次安装)
  └─ _register_default_tool_sources()
       ├─ tool_sources.register_source(bundled_path, "bundled")
       ├─ tool_sources.register_source(skills_path, "skills")
       ├─ tool_sources.register_source(user_tools_path, "user")    ← 用户实例工具
       └─ tool_sources.set_sdk_path(sdk_path)

dcc_installer.py (DCC 插件安装)
  └─ _try_register_tool_source(src_dir)
       ├─ tool_sources.register_source(bundled_path, "bundled")
       └─ tool_sources.register_source(skills_path, "skills")

sidecar.py main() (每次启动)
  ├─ tool_sources.verify_and_refresh()     ← 验证所有 sources、更新统计
  ├─ 确保 sdk_path 已写入（缺失时自动补齐）
  └─ 确保 user nexus-tools 源已注册        ← 缺失时 register_source("user", "startup")
```

**关键设计**：user 源（`~/.artifexnexus/nexus-tools/`）由 bootstrap 首次注册 + sidecar 启动期兜底确保，因为：
- bootstrap 只执行一次，已安装环境可能缺此源
- 用户可能随时创建实例工具，sidecar 启动时确保目录存在即注册

## 9. 测试验证

### 9.1 验收标准（Blender — 已通过）

- [x] Blender addon 侧栏新增触发器启用/禁用开关
- [x] 开关关闭时，事件不触发任何检查
- [x] 开关开启时，Save 触发命名规范检查
  - [x] 有违规对象 → 弹出 popup 显示违规列表
  - [x] 无违规 → 静默通过
- [x] 触发器执行不依赖 sidecar 运行
- [x] 用户实例工具触发生效（tool-sources.json 注册 + parentPath fallback）
- [x] 工具卡片「禁用触发」在 Blender 内生效（skills.json 工具总闸读取）
- [x] 触发器新旧格式兼容（实例工具升级前创建的旧格式仍可触发）

### 9.2 扩展到其他 DCC 时的验收清单

新 DCC 接入时必须验证：
- [ ] 触发器启用/禁用三维度全部生效
- [ ] parentPath fallback 对实例工具生效
- [ ] SDK 路径从 tool-sources.json 正确读取
- [ ] 新旧 manifest 格式兼容
- [ ] tool-sources.json 包含该 DCC 相关的 source 目录

## 10. 参考

- [DCC 插件安装与版本管理规范](./dcc-plugin-management.md)
- [计划：DCC 内部独立触发器系统](./dcc-trigger-system-plan.md)
- [Skill 系统规范](./skill-system.md)
- ADR 0003: tool 用到再加载
