---
tags: [spec, dcc, trigger, blender, architecture]
created: 2026-05-18
status: draft
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

### 1.2 与旧架构的区别

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
  "sdk_path": "/path/to/project/packages/dcc/shared",  // 新增
  "sources": [
    {
      "path": "/path/to/_bundled_nexus_tools",
      "type": "bundled",
      "last_verified": "2026-05-18T10:00:00+00:00",
      "tool_count": 8,
      "skill_count": 0
    }
  ],
  "updated_by": "bootstrap",
  "updated_at": "2026-05-18T10:00:00+00:00"
}
```

#### `sdk_path` 字段（新增）

- **类型**：`string | null`
- **语义**：`artifex_nexus_sdk` 包父目录。加入 `sys.path` 后 `import artifex_nexus_sdk as sdk` 可解析
- **写入点**：bootstrap.py（首次安装）
- **读取点**：DCC 侧 TriggerDispatcher（Blender / Maya / ...）
- **为什么需要**：DCC addon 安装到 DCC 的插件目录后，脱离了 monorepo 源码树，无法通过向上查找定位 SDK 路径

### 3.2 `sources` 条目

每个 source 条目描述一个工具源码目录：

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | string | 绝对路径 |
| `type` | string | `"bundled"` / `"skills"` / `"user"` |
| `last_verified` | string | ISO 8601 时间戳 |
| `tool_count` | int | 该目录下 manifest.json 数量 |
| `skill_count` | int | 该目录下 SKILL.md 数量 |

## 4. 工具 manifest 触发器声明

### 4.1 触发器字段

工具在 `manifest.json` 中声明触发器，无需额外配置文件注册：

```jsonc
{
  "id": "marketplace/blender-object-naming-check",
  "triggers": [
    {
      "trigger": {
        "type": "event",              // 触发器类型：event / schedule
        "dcc": "blender",             // 目标 DCC
        "event": "file.save.post"     // 事件名称
      },
      "enabled": true,                // 是否启用
      "name": "Blender保存时命名检查", // 触发器显示名称
      "executionMode": "notify",      // notify / silent / block
      "useDefaultFilters": true       // 是否使用工具默认 filters
    }
  ]
}
```

### 4.2 触发器类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `event` | DCC 钩子事件触发 | `file.save.post`, `file.open.post` |
| `schedule` | 定时触发 | 每 30 分钟（未来实现） |

### 4.3 执行模式

| 模式 | 行为 | Blender 表现 | Maya 表现（规划） |
|------|------|-------------|-----------------|
| `notify` | reject/error 时弹窗提示，需用户手动关闭 | `popup_menu` 弹窗 | `confirmDialog` |
| `silent` | reject/error 时气泡通知，5 秒自动消失 | draw handler 气泡 | `inViewMessage` |
| `block` | reject 时阻止操作并弹窗（未来实现） | — | — |

### 4.4 工具入口

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

## 5. DCC 侧 TriggerDispatcher 接口

### 5.1 公共接口

每个 DCC 实现自己的 `TriggerDispatcher`，对外暴露统一接口：

```python
class BaseDCCTriggerDispatcher:
    """DCC 触发器调度器抽象基类"""

    def __init__(self):
        self._tool_registry: Dict[str, dict] = {}   # tool_id → metadata
        self._event_index: Dict[str, List[str]] = {} # event_type → [tool_id, ...]
        self._loaded = False
        self._enabled = True  # 全局开关

    @property
    def enabled(self) -> bool:
        """触发器全局启用状态"""

    @enabled.setter
    def enabled(self, value: bool):
        """设置全局启用状态"""

    def load_tools(self) -> None:
        """扫描所有已注册源目录的 manifest，构建事件索引"""

    def on_trigger_event(self, event_type: str, filepath: str, data: dict) -> None:
        """DCC 事件入口。匹配触发器 → 执行工具 → 处理结果"""

    def _execute_tool(self, tool_id: str, payload: dict) -> dict:
        """动态 import 工具模块，调用 entry 函数"""

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
       └─ tool_sources.set_sdk_path(sdk_path)        ← 新增

dcc_installer.py (DCC 插件安装)
  └─ _try_register_tool_source(src_dir)
       ├─ tool_sources.register_source(bundled_path, "bundled")
       └─ tool_sources.register_source(skills_path, "skills")

sidecar.py main() (每次启动)
  └─ tool_sources.verify_and_refresh()
       └─ 验证所有 sources 路径、更新统计
```

## 9. 测试验证

### 9.1 验收标准（Blender M1）

- [ ] Blender addon 侧栏新增触发器启用/禁用开关
- [ ] 开关关闭时，保存文件不触发任何检查
- [ ] 开关开启时，Save 触发 "Blender对象命名规范检查"
  - [ ] 有违规对象 → 弹出 popup 显示违规列表
  - [ ] 无违规 → 静默通过
- [ ] 触发器执行不依赖 sidecar 运行（sidecar 未启动时仍可弹窗）
- [ ] 触发器执行结果可选上报 sidecar（sidecar 在线时收到状态报告）

### 9.2 回退测试

- [ ] 旧版 sidecar `trigger_dispatcher.py` 仍可正常工作（非 Blender DCC fallback）

## 10. 参考

- [DCC 插件安装与版本管理规范](./dcc-plugin-management.md)
- [计划：DCC 内部独立触发器系统](./dcc-trigger-system-plan.md)
- [Skill 系统规范](./skill-system.md)
- ADR 0003: tool 用到再加载
