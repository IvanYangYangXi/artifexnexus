---
tags: [spec, unreal, mcp, m7]
created: 2026-05-22
status: draft
related_epic: "[[../../tasks/backlog/EPIC-0007-m7-multi-dcc-inapp-chat]]"
related_adr: [0006]
related_specs: ["系统架构设计", "dcc-plugin-management", "dcc-extension-trigger-system"]
related_packages: ["packages/dcc/unreal", "packages/adapters/openclaw"]
---

# UE 5.7 MCP 集成 - 开发规格

## 1. 背景与目标

EPIC-0007 原计划覆盖 UE/Max/Maya 多 DCC + 内嵌 Chat 面板。
经用户确认，**第一轮仅做 UE 5.7 扩展**，且 **不在 DCC 内嵌 Chat 面板**（Chat/Agent/Skill/Tool 管理全部走 Web 端）。

本规格定义从 [artclaw_bridge UEClawBridge](https://github.com/IvanYangYangXi/artclaw_bridge) 插件**完整复刻并改造**为 Artifex Nexus for Unreal 的技术方案。

### 范围

- ✅ 复刻 UEClawBridge 全部 C++ Blueprint API（20+ API 类）
- ✅ 实现 Python MCP WebSocket 服务器（端口 18080，JSON-RPC 2.0）
- ✅ 实现 `run_python` 工具（Gateway 端注册为 `mcp_unreal-editor_run_python`）
- ✅ 复刻 UE 触发器系统（DCC 事件钩子 + trigger dispatcher）
- ✅ 提供简单控制面板（启动/停止 MCP Server + 触发器开关）
- ✅ Gateway mcp-bridge 插件注册 + Sidecar dcc_installer
- ✅ 所有 artclaw 标识改为 artifex nexus

### 非范围

- ❌ UE 内 Chat/Agent/Skill/Tool 管理 UI（全部走 Web 端）
- ❌ XAtlasLib 独立 UV 工具库（非 AI 桥接功能）
- ❌ Tool Manager HTTP 事件转发（改为 MCP broadcast 模式，与 Blender 一致）
- ❌ Max / Maya / Houdini 扩展（后续 M9 再做）
- ❌ memory_store 定制记忆模块（当前不做）

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
│  → 生成 UE   │   │    registerTool("mcp_unreal-editor_       │
│    config    │   │      run_python")                         │
│              │   │                                           │
│ dcc_installer│   │  System Prompt:                           │
│  → 安装 UE   │   │    IDENTITY.md / SOUL.md / USER.md       │
│    插件      │   └────────────────┬──────────────────────────┘
│              │                    │ MCP over WebSocket (18080)
│ trigger_     │                    │ JSON-RPC 2.0
│ dispatcher   │                    │
└──────────────┘                    ▼
                        ┌──────────────────────────────────────┐
                        │       UE 5.7 编辑器进程               │
                        │                                      │
                        │  Content/Python/artifex_nexus_ue/    │
                        │  ├─ __init__.py       启动入口        │
                        │  ├─ mcp_server.py     MCP WS 服务器   │
                        │  ├─ ue_adapter.py     主线程调度       │
                        │  ├─ trigger_dispatcher.py 触发器引擎   │
                        │  ├─ dcc_event_intercept.py 事件拦截    │
                        │  ├─ knowledge_base.py  知识库          │
                        │  └─ skill_hub.py       Skill 管理      │
                        │                                      │
                        │  Source/ArtifexNexus/ (C++ 主模块)    │
                        │  ├─ ArtifexNexusSubsystem 编辑器子系统 │
                        │  │   DCC 事件钩子 + MCP 控制          │
                        │  └─ ArtifexNexusPanel    控制面板      │
                        │                                      │
                        │  Source/ArtifexNexusAPI/ (C++ API)    │
                        │  ├─ ActorOpsAPI / AssetManagementAPI  │
                        │  ├─ Blueprint 全系列 / Niagara / GAS  │
                        │  └─ ... (20+ API 类)                  │
                        └──────────────────────────────────────┘
```

### 2.2 与 Blender 实现的对照

| 组件 | Blender | UE 5.7 |
|------|---------|--------|
| MCP Server | `mcp_server.py` (asyncio WS, port 18083) | `mcp_server.py` (asyncio WS, port 18080) |
| DCC Adapter | `blender_adapter.py` (queue + bpy.app.timers) | `ue_adapter.py` (unreal.register_slate_post_tick_callback) |
| 主线程调度 | `queue.Queue` + `bpy.app.timers` 50ms 轮询 | `unreal.register_slate_post_tick_callback` + `threading.Event` |
| 触发器引擎 | `trigger_dispatcher.py` (tool-sources.json) | `trigger_dispatcher.py` (tool-sources.json) |
| 事件拦截 | `bpy.app.handlers` (save_post/load_post) | C++ `UEditorSubsystem` delegate hooks |
| 事件广播 | `MCPServer.broadcast_trigger_event()` | 同 Blender 模式 |
| 控制面板 | `ARTIFEX_PT_MainPanel` (bl_idname) | `SArtifexNexusPanel` (Slate dockable tab) |
| MCP 工具名 | `run_python` + `get_editor_context` | `run_python` + `get_editor_context` |
| Gateway 注册 | `mcp_blender-editor_run_python` | `mcp_unreal-editor_run_python` |
| 蓝图层 API | bpy 原生 API | C++ `UBlueprintFunctionLibrary` 全部 BlueprintCallable |

### 2.3 ArtClaw → Artifex Nexus 改造映射

| ArtClaw 原组件 | 改造动作 | 目标名称/路径 |
|---------------|---------|--------------|
| `UEClawBridge.uplugin` | 重写 | `ArtifexNexusForUnreal.uplugin` |
| `UEClawBridge` 模块 (UI) | **删除**,仅保留 Subsystem | `ArtifexNexus` 模块 |
| `UEClawBridgeAPI` 模块 | **重命名**,保留全部 API 类 | `ArtifexNexusAPI` 模块 |
| `XAtlasLib` 模块 | **移除** (非 AI 桥接) | - |
| `UEAgentDashboard` | **删除** (Chat 走 Web) | - |
| `UEAgentManagePanel/McpTab/SkillTab` | **删除** (管理走 Web) | - |
| `IAgentPlatformBridge/OpenClawPlatformBridge` | **删除** (Chat 走 Web) | - |
| `UEClawBridgeCommands/Style` | **删除** (UI 大幅简化) | - |
| `UUEAgentSubsystem` | **改造** (移除 Tool Manager, 保留 DCC 事件) | `UArtifexNexusSubsystem` |
| `bridge_core.py` (OpenClaw uplink) | **删除** (Chat 走 Web) | - |
| `tool_event_bridge.py` (Tool Manager HTTP) | **删除** (改用 MCP broadcast) | - |
| `memory_store.py` | **删除** (暂不做定制记忆) | - |
| `ue_mcp_server.py` | **改造** (参考 Blender mcp_server.py 重写) | `mcp_server.py` |
| `dcc_event_intercept.py` | **改造** (路径 .artclaw → .artifexnexus) | `dcc_event_intercept.py` |
| `init_unreal.py` | **改造** (精简为 MCP + 触发器启动) | `__init__.py` |
| `skill_hub.py` | **保留+改造** (通过 run_python 调用) | `skill_hub.py` |
| `knowledge_base.py` | **保留+改造** (通过 run_python 调用) | `knowledge_base.py` |
| 全部 C++ API 类 | **重命名** (UEClawBridgeAPI → ArtifexNexusAPI) | 20+ API 类全部保留 |
| 全部 UFUNCTION Category | **改名** `ArtClaw\|XXX` → `ArtifexNexus\|XXX` | - |
| 全部日志分类 | **改名** `LogUEAgent` → `LogArtifexNexus` | - |
| 全部宏/命名空间 | **改名** `UECLAWBRIDGE_API` → `ARTIFEXNEXUS_API` | - |

## 3. 文件布局

### 3.1 开发期（Junction 引用）

```
D:\MyProject_D\artifexnexus_packages\ue57_artifex_nexus\
  → Junction 指向 D:\MyProject_D\artifexnexus\packages\dcc\unreal\

UE 项目引用:
  D:\MyProject_D\artifexnexus_packages\ue57_artifex_nexus\
    Plugins\ArtifexNexusForUnreal\  → Junction 到 packages/dcc/unreal/
```

### 3.2 最终插件目录结构

```
ArtifexNexusForUnreal/
├── ArtifexNexusForUnreal.uplugin
├── Content/
│   └── Python/
│       ├── Lib/                         # 第三方库 (websockets, pydantic 等)
│       └── artifex_nexus_ue/
│           ├── __init__.py              # 启动入口 (auto-start MCP + triggers)
│           ├── mcp_server.py            # MCP WebSocket 服务器
│           ├── ue_adapter.py            # UE 主线程适配器
│           ├── trigger_dispatcher.py    # 触发器调度引擎
│           ├── dcc_event_intercept.py   # DCC 事件拦截检查器
│           ├── knowledge_base.py        # 本地知识库
│           ├── skill_hub.py             # Skill 热加载器
│           ├── skill_loader.py          # Skill 加载辅助
│           ├── skill_manifest.py        # Skill manifest 解析
│           ├── skill_version.py         # 版本匹配
│           ├── skill_conflict.py        # 冲突检测
│           ├── skill_mcp_tools.py       # MCP 工具注册 (供 run_python 使用)
│           └── skill_mcp_resources.py   # MCP 资源注册
├── Resources/
│   ├── Icon128.png
│   └── ButtonIcon40.png
└── Source/
    ├── ArtifexNexus/                    # C++ 主模块
    │   ├── ArtifexNexus.Build.cs
    │   ├── Public/
    │   │   ├── ArtifexNexus.h           # 模块入口
    │   │   ├── ArtifexNexusSubsystem.h  # 编辑器子系统
    │   │   └── ArtifexNexusPanel.h     # 控制面板
    │   └── Private/
    │       ├── ArtifexNexus.cpp
    │       ├── ArtifexNexusSubsystem.cpp
    │       └── ArtifexNexusPanel.cpp
    └── ArtifexNexusAPI/                 # C++ Blueprint API 模块
        ├── ArtifexNexusAPI.Build.cs
        ├── Public/
        │   ├── ArtifexNexusAPI.h        # API 模块入口
        │   ├── ArtifexNexusActorOpsAPI.h
        │   ├── ArtifexNexusActorReflectionAPI.h
        │   ├── ArtifexNexusAssetManagementAPI.h
        │   ├── ArtifexNexusAssetQueryAPI.h
        │   ├── ArtifexNexusBehaviorTreeAPI.h
        │   ├── ArtifexNexusBuildSystemAPI.h
        │   ├── ArtifexNexusDataTableAPI.h
        │   ├── ArtifexNexusEnhancedInputAPI.h
        │   ├── ArtifexNexusGameplayAbilityAPI.h
        │   ├── ArtifexNexusInputInjectionAPI.h
        │   ├── ArtifexNexusLoggingAPI.h
        │   ├── ArtifexNexusMeshAnalysisAPI.h
        │   ├── ArtifexNexusMeshUVOpsAPI.h
        │   ├── ArtifexNexusNiagaraAPI.h
        │   ├── ArtifexNexusPIEControlAPI.h
        │   ├── ArtifexNexusPerformanceAPI.h
        │   ├── ArtifexNexusProjectInfoAPI.h
        │   ├── ArtifexNexusSequencerAPI.h
        │   ├── ArtifexNexusStateTreeAPI.h
        │   ├── ArtifexNexusWidgetBlueprintAPI.h
        │   ├── Blueprint/
        │   │   ├── ArtifexNexusAnimBlueprintQuery.h
        │   │   ├── ArtifexNexusBlueprintGraphConnect.h
        │   │   ├── ArtifexNexusBlueprintGraphEdit.h
        │   │   ├── ArtifexNexusBlueprintGraphQuery.h
        │   │   └── ArtifexNexusBlueprintNodeProperty.h
        │   └── Utils/
        │       ├── ArtifexNexusAssetModifier.h
        │       ├── ArtifexNexusGraphLayoutUtil.h
        │       ├── ArtifexNexusJsonHelpers.h
        │       └── ArtifexNexusPropertySerializer.h
        └── Private/                     # 对应 .cpp 实现文件
            ├── ArtifexNexusActorOpsAPI.cpp
            ├── ArtifexNexusActorReflectionAPI.cpp
            ├── ... (30+ 个 .cpp)
            └── Blueprint/
                └── ... (对应 .cpp)
```

## 4. 核心组件设计

### 4.1 C++ Editor Subsystem (`UArtifexNexusSubsystem`)

继承 `UEditorSubsystem`，全局单例。保留以下功能：

| 功能 | 说明 |
|------|------|
| DCC 事件委托 | OnAssetPreSave/OnAssetPostSave/OnAssetImported/OnAssetPreDelete/OnAssetPostDelete/OnLevelPreSave/OnLevelPostSave/OnLevelLoaded/OnEditorStartup |
| IsPackageOKToSave 拦截 | 保存时调用 Python dcc_event_intercept.check_pre_save() |
| MCP 端口管理 | SetServerPort/GetServerAddress/GetClientCount |
| 连接状态 | SetConnectionStatus/GetConnectionStatus/OnConnectionStatusChanged |
| 触发通知 | FlushPendingNotify (读取 pending 文件弹气泡) |

**移除**（artclaw 特有）：
- AutoLaunchToolManager（Tool Manager 不存在于 Artifex）
- SetupSelectionTracking / 活跃面板追踪（无 UE 内 Chat UI）
- SaveInterceptSilentPass（简化触发器配置）

### 4.2 控制面板 (`SArtifexNexusPanel`)

Slate 可停靠面板，在 Window 菜单注册，工具栏按钮打开。

**内容**（极简）：
```
┌─ Artifex Nexus ──────────────────────┐
│  MCP Server:  ● 运行中               │
│  地址: ws://127.0.0.1:18080          │
│  客户端: 0                           │
│                                      │
│  [  停止 MCP Server  ]               │
│                                      │
│  触发器系统:  ☑ 已启用               │
│  [  禁用触发器  ]                     │
│                                      │
│  v5.0.0                              │
└──────────────────────────────────────┘
```

### 4.3 Python MCP Server (`mcp_server.py`)

参考 Blender 的 `mcp_server.py` 实现：

```
特性:
- asyncio WebSocket 服务器, 端口 18080
- JSON-RPC 2.0 协议, MCP 2024-11-05 规范
- 注册工具: run_python, get_editor_context
- 事件广播: broadcast_trigger_event() 向已连接 Gateway 发送事件
- 主线程调度: 通过 UEAdapter 将 exec() 调度到 Game Thread
- asyncio 事件循环: 通过 unreal.register_slate_post_tick_callback 驱动
```

**run_python 工具规范**:
```json
{
  "name": "run_python",
  "description": "在 Unreal Engine 编辑器中执行 Python 代码。\n\n上下文变量（已自动注入）:\n  S = 选中对象列表\n  W = 编辑器世界\n  L = unreal 模块\n  C = 编辑器上下文\n  UE = unreal 模块别名",
  "inputSchema": {
    "type": "object",
    "properties": {
      "code": {"type": "string", "description": "要执行的 Python 代码"},
      "get_context": {"type": "boolean", "description": "仅获取编辑器上下文", "default": false}
    }
  }
}
```

### 4.4 UE Adapter (`ue_adapter.py`)

主线程调度方案（UE 无 `bpy.app.timers`，改用 `unreal.register_slate_post_tick_callback`）：

```
┌─────────────────────────────┐     ┌──────────────────────┐
│  MCP WebSocket 线程          │     │  UE Game Thread       │
│                             │     │                      │
│  tools/call run_python      │     │  Slate Post Tick      │
│       │                     │     │  Callback             │
│       ▼                     │     │       │               │
│  ue_adapter.execute_on_     │     │       ▼               │
│    main_thread(fn, *args)   │     │  _main_thread_consumer│
│       │                     │     │       │               │
│       ├─ queue.put(task) ───┼────►│  while not empty:     │
│       │                     │     │    fn, args = q.get() │
│       ▼                     │     │    result = fn(*args) │
│  result_event.wait(30s)     │     │    result_event.set() │
│       │                     │     │       │               │
│       ▼                     │     │       ▼               │
│  return result              │     │  (next tick)          │
└─────────────────────────────┘     └──────────────────────┘
```

- 使用 `threading.Event` + `queue.Queue`（线程安全）
- `unreal.register_slate_post_tick_callback` 回调在主线程每帧执行
- 30s 超时保护
- 持久化命名空间（`exec(code, ns)` 保持变量跨调用）

### 4.5 触发器系统

**双模式**（与 Blender 一致）：

#### 模式 A：UE 本地触发器

```
C++ DCC 事件 (OnAssetPostSave 等)
  → C++ 调用 Python dcc_event_intercept.handle_post_save()
    → 读取 tool-sources.json 匹配 manifest.json 触发器
      → import 工具模块 → 执行 entry 函数 → 弹窗通知
```

#### 模式 B：Sidecar 触发器

```
C++ DCC 事件
  → MCPServer.broadcast_trigger_event() → WebSocket → Gateway sidecar
    → Sidecar TriggerDispatcher 匹配 → 执行工具
      → 结果通过 MCP run_python 回传 UE 弹窗
```

**配置路径**：artclaw 的 `~/.artclaw/triggers.json` → Artifex 的 `~/.artifexnexus/config/triggers.json`

### 4.6 命名变更速查表

| 类别 | ArtClaw 原名 | Artifex Nexus 新名 |
|------|-------------|-------------------|
| 插件名 | UEClawBridge | ArtifexNexusForUnreal |
| 主模块 | UEClawBridge (Editor) | ArtifexNexus (Editor) |
| API 模块 | UEClawBridgeAPI (Editor) | ArtifexNexusAPI (Editor) |
| DLL 导出 | UECLAWBRIDGE_API | ARTIFEXNEXUS_API |
| 子系统 | UUEAgentSubsystem | UArtifexNexusSubsystem |
| API 类前缀 | UClaw | UArtifexNexus |
| UFUNCTION Category 前缀 | ArtClaw\| | ArtifexNexus\| |
| 日志分类 | LogUEAgent* | LogArtifexNexus* |
| 日志分类 | LogClawBridge* | LogArtifexNexus* |
| JSON 命名空间 | ClawJson | ArtifexNexusJson |
| MCP 工具前缀 | mcp_ue-claw-bridge_ | mcp_unreal-editor_ |
| Python 包 | artclaw_* | artifex_nexus_ue |
| 配置路径 | ~/.artclaw/ | ~/.artifexnexus/ |
| 蓝图枚举 | EUEAgent* | EArtifexNexus* |
| 委托类型 | FOnAgent* | FOnArtifexNexus* |

## 5. 项目侧改动（非 UE 插件内）

### 5.1 Gateway mcp-bridge 插件

文件: `packages/adapters/openclaw/gateway-plugin/src/index.ts`

新增 unreal-editor 服务器注册：

```typescript
// mcp-bridge 配置中新增
servers: {
  "unreal-editor": {
    type: "websocket",
    url: "ws://127.0.0.1:18080",
    enabled: true,
  }
}

// 工具注册
registerTool("mcp_unreal-editor_run_python", {...});
registerTool("mcp_unreal-editor_get_editor_context", {...});
```

### 5.2 Sidecar bootstrap.py

文件: `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/bootstrap.py`

- `_generate_default_config()`: 添加 `unreal-editor` 到 `plugins.entries.mcp-bridge.config.servers`
- `openclaw.json` 模板: 包含 `unreal-editor` 配置块

### 5.3 Sidecar dcc_installer.py

文件: `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/dcc_installer.py`

新增:
- `find_unreal_versions()` — 检测 UE 5.7 安装路径
- `install_unreal_plugin(version, project_path)` — 复制插件到 UE 项目
- `uninstall_unreal_plugin(project_path)` — 移除插件
- `_record_deployment("unreal-addon-5.7")` — 部署 manifest 校验

### 5.4 packages/dcc/unreal/ 更新

- 更新 `ArtifexNexusForUnreal.uplugin`：模块名、版本、依赖
- 更新 `Source/ArtifexNexus/ArtifexNexus.Build.cs`
- 更新 `Content/Python/artifex_nexus_ue/__init__.py` 为实际实现

## 6. 端口分配

| 端口 | 用途 |
|------|------|
| 18080 | UE MCP WebSocket Server |
| 18083 | Blender MCP WebSocket Server |
| 19789 | OpenClaw Gateway + Control UI |

## 7. STORY 分解

| STORY | 名称 | 预估 | 依赖 |
|-------|------|------|------|
| [[STORY-0051-ue-plugin-scaffold]] | UE 插件脚手架 & C++ 模块搭建 | 2d | - |
| [[STORY-0052-ue-blueprint-api-migration]] | C++ Blueprint API 迁移 | 3d | STORY-0051 |
| [[STORY-0053-ue-editor-subsystem]] | Editor Subsystem 改造 | 1.5d | STORY-0051 |
| [[STORY-0054-ue-control-panel]] | 简单控制面板 | 1d | STORY-0053 |
| [[STORY-0055-ue-mcp-server-adapter]] | Python MCP Server & UE Adapter | 2.5d | STORY-0051 |
| [[STORY-0056-ue-trigger-system]] | 触发器系统 | 2d | STORY-0053, STORY-0055 |
| [[STORY-0057-ue-gateway-sidecar]] | Gateway & Sidecar 集成 | 2d | STORY-0055 |
| [[STORY-0058-ue-bootstrap-autostart]] | UE 启动引导 & 自动启动 | 1d | STORY-0054, STORY-0055, STORY-0056 |

**总预估**: ~15d（约 3 周），不包括 UE 编译时间。

## 8. 风险与疑问

| 风险 | 缓解措施 |
|------|---------|
| UE 5.7 API 变化导致 artclaw C++ 代码不兼容 | 逐文件编译验证，Sparse 降级适配 |
| Python websockets 库在 UE Python 环境兼容性 | 预测试依赖导入 |
| 主线程调度性能（Slate Post Tick 频率） | 50ms 批量消费（与 Blender 一致） |
| C++ 编译时间（UE 全量编译 30min+） | 模块化编译，优先编译 API 模块（最复杂） |
| Junction 开发模式与 UE 热重载兼容性 | 测试验证，必要时 fallback 到 copy 模式 |

## 相关

- [[../../tasks/backlog/EPIC-0007-m7-multi-dcc-inapp-chat]] — 父 EPIC
- [[系统架构设计]] §2 MCP 工具最小化
- [[dcc-plugin-management]] — 安装方式
- [[dcc-extension-trigger-system]] — 触发器规范
- [[../development/context-handoff-copy-model-and-validation]] — 部署 manifest
