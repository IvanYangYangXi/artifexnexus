---
tags: [spec, maya, 3ds_max, mcp, m7]
created: 2026-05-25
status: draft
related_epic: "[[../tasks/backlog/EPIC-0007-m7-multi-dcc-inapp-chat]]"
related_adr: [0006]
related_specs: ["系统架构设计", "dcc-plugin-management", "dcc-extension-trigger-system", "ue57-mcp-integration"]
related_packages: ["packages/dcc/maya", "packages/dcc/max", "packages/dcc/shared", "packages/adapters/openclaw"]
---

# Maya & 3ds Max MCP 集成 - 开发规格

## 1. 背景与目标

EPIC-0007 原计划覆盖 UE/Max/Maya 多 DCC + 内嵌 Chat 面板。
UE 5.7 已于 STORY-0051~0058 完成，本规格定义 **Maya 和 3ds Max** 的 MCP 集成方案。

参照已完成的 Blender 插件架构（[[../tasks/review/STORY-0021-blender-addon-scaffold]] 系列），为 Maya 和 3ds Max 构建同构的 MCP WebSocket Server + DCC Adapter + 触发器系统。

### 范围

- ✅ 提取共享模块（BaseAdapter + MCPServer → `packages/dcc/shared/artifex_nexus_sdk/`）
- ✅ Maya 插件（MCP Server + Adapter + 触发器 + 控制面板）
- ✅ 3ds Max 插件（MCP Server + Adapter + 触发器 + 控制面板）
- ✅ Gateway mcp-bridge 注册 Maya/Max 工具
- ✅ Sidecar dcc_installer 扩展支持 Maya/Max 安装
- ✅ 前端安装器支持 Maya/Max 检测/安装/卸载
- ✅ Blender 适配共享模块（import 路径更新）

### 非范围

- ❌ DCC 内嵌 Chat/Agent/Skill/Tool 管理 UI（全部走 Web 端）
- ❌ Maya/Max SDK API 封装（C++ 蓝图 API 层，仅 UE 需要）
- ❌ memory_store 定制记忆模块
- ❌ Houdini / Substance Painter / Substance Designer（后续 M9）

## 2. 架构概览

### 2.1 整体数据流

```
┌──────────────────────────────────────────────────────────────┐
│                    Tauri 桌面应用 (Web UI)                    │
│  ChatView / 设置面板 / 安装向导                                │
└──────┬───────────────────────┬───────────────────────────────┘
       │ stdio JSON-RPC        │ WebSocket (19789)
       ▼                       │
┌──────────────┐   ┌───────────▼──────────────────────────────┐
│ Sidecar (Py) │   │        OpenClaw Gateway (Node.js)         │
│              │   │                                           │
│ bootstrap.py │   │  mcp-bridge plugin:                       │
│  → 生成配置  │   │    mcp_maya-primary_run_python            │
│              │   │    mcp_max-primary_run_python             │
│ dcc_installer│   │    mcp_blender-editor_run_python          │
│  → 安装      │   │    mcp_unreal-editor_run_python           │
│    Maya/Max  │   └────────────────┬──────────────────────────┘
│    插件      │                    │ MCP over WebSocket
│              │                    │ JSON-RPC 2.0
│ trigger_     │                    │
│ dispatcher   │              ┌─────┴──────────┐
└──────────────┘              │                  │
                        ws://127.0.0.1:18081  ws://127.0.0.1:18082
                              │                  │
                    ┌─────────▼──────┐  ┌───────▼──────────┐
                    │   Maya 编辑器   │  │  3ds Max 编辑器   │
                    │                │  │                  │
                    │  scripts/      │  │  scripts/        │
                    │  artifex_nexus/│  │  artifex_nexus/  │
                    │  ├─ __init__   │  │  ├─ __init__     │
                    │  ├─ maya_      │  │  ├─ max_         │
                    │  │   adapter   │  │  │   adapter     │
                    │  ├─ mcp_server │  │  ├─ mcp_server   │
                    │  └─ trigger_   │  │  ├─ trigger_     │
                    │      dispatcher│  │  │   dispatcher  │
                    │                │  │  ├─ startup.py   │
                    │                │  │  └─ startup.ms   │
                    └────────────────┘  └──────────────────┘
```

### 2.2 与 Blender 实现的对照

| 组件 | Blender | Maya | 3ds Max |
|------|---------|------|---------|
| MCP Server | `mcp_server.py` (18083) | `mcp_server.py` (18081) | `mcp_server.py` (18082) |
| DCC Adapter | `blender_adapter.py` (queue + timers) | `maya_adapter.py` (`executeInMainThreadWithResult`) | `max_adapter.py` (`pymxs.callbacks`) |
| 主线程调度 | `queue.Queue` + `bpy.app.timers` | `maya.utils.executeInMainThreadWithResult` | `pymxs.runtime.callbacks.addScript #timeout` |
| 触发器引擎 | `trigger_dispatcher.py` | 同 Blender 模式 | 同 Blender 模式 |
| 事件拦截 | `bpy.app.handlers` | `MSceneMessage` callbacks | `#filePostSave` / `#filePostOpen` |
| 控制面板 | `ARTIFEX_PT_MainPanel` (Panel) | Shelf Button + Menu | Menu Bar + Listener 输出 |
| 入口方式 | Blender Addon 自动注册 | `userSetup.py` 自动加载 | `scripts/startup/` 自动加载 |
| MCP 工具名 | `mcp_blender-editor_run_python` | `mcp_maya-primary_run_python` | `mcp_max-primary_run_python` |
| 上下文变量 | S/L=bpy.data/C/D=bpy | S/L=maya.cmds/C/D=maya | S/L=pymxs.runtime/C/D=pymxs |
| Up Axis | Z (Blender) | Y (Maya) | Z (Max) |

### 2.3 共享模块架构

为避免代码重复，将 Blender 的 `base_adapter.py` 和 `mcp_server.py` 提升为共享 SDK：

```
packages/dcc/shared/artifex_nexus_sdk/
├── __init__.py              # SDK 入口（已有）
├── base_adapter.py          # ← 从 Blender 提升（各 DCC 适配层基类）
├── mcp_server.py            # ← 提取共享（参数化 dcc_name / port）
├── context.py               # 已有
├── event.py                 # 已有
├── logger.py                # 已有
├── params.py                # 已有
└── result.py                # 已有
```

- `MCPServer(server_name=DCC_NAME, server_version=VERSION, port=PORT)`
- `register_builtin_tools()` 保留在各 DCC 侧（工具描述与 DCC 绑定）
- `broadcast_trigger_event()` 的 `dcc` 字段由 server_name 参数化

## 3. 端口分配

| 端口 | 用途 |
|------|------|
| 18080 | UE MCP WebSocket Server |
| **18081** | **Maya MCP WebSocket Server** |
| **18082** | **3ds Max MCP WebSocket Server** |
| 18083 | Blender MCP WebSocket Server |
| 19789 | OpenClaw Gateway + Control UI |

## 4. Maya 插件设计

### 4.1 文件布局

```
packages/dcc/maya/
├── pyproject.toml
├── README.md
└── src/artifex_nexus/
    └── v2023/
        └── maya_addon/
            ├── __init__.py              # Maya 入口（Shelf/Menu UI + 生命周期）
            ├── maya_adapter.py          # Maya 适配层（继承 BaseDCCAdapter）
            ├── trigger_dispatcher.py    # 触发器调度器（Maya 事件钩子）
            └── mcp_server.py            # 从 SDK 导入 MCPServer + 绑定内置工具
```

### 4.2 安装路径

```
~/Documents/maya/{version}/scripts/artifex_nexus/
```

**Locale 同步**：扫描 `{base}/{locale}/scripts/` 子目录（`xx_XX` 格式），物理复制指向主目录。

### 4.3 关键设计

#### maya_adapter.py

- 继承 `artifex_nexus_sdk.base_adapter.BaseDCCAdapter`
- `get_software_name()` → `"maya"`
- `get_software_version()` → `maya.cmds.about(version=True)`
- 主线程调度：`maya.utils.executeInMainThreadWithResult(fn, *args)`（原生支持，无需 queue）
- 上下文变量：`S=maya.cmds.ls(selection=True)`, `W=file(sceneName=True)`, `L=maya.cmds`, `maya=maya`, `pymel=pymel.core`
- Up Axis: Y

#### 事件钩子

- `maya.OpenMaya.MSceneMessage.addCallback(MSceneMessage.kAfterSave, ...)`
- `maya.OpenMaya.MSceneMessage.addCallback(MSceneMessage.kAfterOpen, ...)`

#### 控制面板

- Shelf Button：启动/停止 MCP Server + 触发器开关 + 状态指示灯
- Maya Menu：`Artifex Nexus` 菜单项

## 5. 3ds Max 插件设计

### 5.1 文件布局

```
packages/dcc/max/
├── pyproject.toml
├── README.md
└── src/artifex_nexus/
    └── v2023/
        └── max_addon/
            ├── __init__.py              # Max 入口（菜单栏注册 + 对话框）
            ├── max_adapter.py           # Max 适配层（继承 BaseDCCAdapter）
            ├── trigger_dispatcher.py    # 触发器调度器
            ├── startup.py               # Python 启动脚本
            └── artifex_startup.ms       # MaxScript 启动脚本
```

### 5.2 安装路径

```
%LOCALAPPDATA%/Autodesk/3dsMax/{version}/ENU/scripts/artifex_nexus/
```

**Locale 同步**：全 locale 目录（ENU/CHS/JPN 等），物理复制指向 ENU 主目录。

### 5.3 关键设计

#### max_adapter.py

- 继承 `artifex_nexus_sdk.base_adapter.BaseDCCAdapter`
- `get_software_name()` → `"3ds_max"`
- `get_software_version()` → `pymxs.runtime.MaxVersion()`
- 主线程调度：通过 `pymxs.runtime.callbacks.addScript #timeout` 消费队列（参考 artclaw 实现）
- 上下文变量：`S=pymxs.runtime.selection`, `W=maxFilePath+maxFileName`, `L=pymxs.runtime`, `rt=pymxs.runtime`, `pymxs=pymxs`
- Up Axis: Z

#### 事件钩子

- `pymxs.runtime.callbacks.addScript #filePostSave`
- `pymxs.runtime.callbacks.addScript #filePostOpen`

#### 入口方式

- `scripts/startup/artifex_startup.ms`（MaxScript）：`python.executeFile "artifex_startup.py"`
- `scripts/startup/artifex_startup.py`（Python）：导入并启动 MCP Server

## 6. Gateway mcp-bridge 插件

文件：`packages/adapters/openclaw/gateway-plugin/src/index.ts`

新增两个服务器注册：

```typescript
servers: {
  "maya-primary": {
    type: "websocket",
    url: "ws://127.0.0.1:18081",
    enabled: true,
  },
  "max-primary": {
    type: "websocket",
    url: "ws://127.0.0.1:18082",
    enabled: true,
  },
}

// 工具注册
registerTool("mcp_maya-primary_run_python", {...});
registerTool("mcp_max-primary_run_python", {...});
```

## 7. Sidecar 扩展

### dcc_installer.py

取消注释并实现 Maya/Max 配置：

```python
_DCC_VERSION_SCAN_PATHS = {
    "blender": os.path.join(os.environ.get("APPDATA", ...), "Blender Foundation", "Blender"),
    "maya": os.path.join(os.path.expanduser("~"), "Documents", "maya"),
    "3ds_max": os.path.join(os.environ.get("LOCALAPPDATA", ""), "Autodesk", "3dsMax"),
}

_DCC_ADDON_PATH_TEMPLATES = {
    "blender": "{base}/{version}/scripts/addons/",
    "maya": "{base}/{version}/scripts/",
    "3ds_max": "{base}/{version}/ENU/scripts/",
}

_DCC_DEFAULT_PORTS = {
    "blender": 18083, "unreal": 18080, "maya": 18081, "3ds_max": 18082,
}
```

### bootstrap.py

`_generate_default_config()` 中添加 `maya-primary` / `max-primary` 到 `plugins.entries.mcp-bridge.config.servers`。

### nexus_tool_rpc.py

完善 Maya/Max 连接指引（`_DCC_TO_MCP_SERVER` 映射已预留）。

## 8. 版本兼容范围

| DCC | 最低版本 | 最高版本 | Python 要求 |
|-----|---------|---------|------------|
| Maya | 2023 | 无上限 | Python 3.9+ |
| 3ds Max | 2023 | 无上限 | Python 3.10+ |
| Blender | 5.0 | 5.1.x | Python 3.13+ |

## 9. STORY 分解

| STORY | 名称 | 预估 | 依赖 |
|-------|------|------|------|
| [[../tasks/backlog/STORY-0059-shared-module-extraction]] | 共享模块提取 | 1d | - |
| [[../tasks/backlog/STORY-0060-maya-plugin-scaffold]] | Maya 插件脚手架 & Adapter | 2d | STORY-0059 |
| [[../tasks/backlog/STORY-0061-max-plugin-scaffold]] | 3ds Max 插件脚手架 & Adapter | 2d | STORY-0059 |
| [[../tasks/backlog/STORY-0062-gateway-maya-max-bridge]] | Gateway mcp-bridge | 0.5d | - |
| [[../tasks/backlog/STORY-0063-sidecar-maya-max]] | Sidecar 扩展 | 1.5d | STORY-0060/0061 |
| [[../tasks/backlog/STORY-0064-installer-maya-max-ui]] | 前端安装器 | 1d | STORY-0063 |
| [[../tasks/backlog/STORY-0065-blender-adapt-shared]] | Blender 适配共享模块 | 0.5d | STORY-0059 |
| [[../tasks/backlog/STORY-0066-e2e-maya-max-verify]] | 端到端验证 | 1d | STORY-0062~0065 |

**总预估**: ~9.5d

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 3ds Max 无原生主线程调度 API | 参考 artclaw `max_adapter.py` 的 pymxs.callbacks 实现 |
| shared SDK 需同步部署到 DCC 运行目录 | 安装器额外复制 SDK 文件 + 确保 sys.path |
| Maya/Max Python 版本差异 | 最低要求 Python 3.9，与项目 Python 3.13 前向兼容 |
| 无法在当前环境测试 Maya/Max | 先完成代码开发，标记待实际环境验证 |

## 相关

- [[../tasks/backlog/EPIC-0007-m7-multi-dcc-inapp-chat]] — 父 EPIC
- [[系统架构设计]] §2 MCP 工具最小化
- [[dcc-plugin-management]] — 安装方式
- [[dcc-extension-trigger-system]] — 触发器规范
- [[ue57-mcp-integration]] — UE 5.7 集成参考
