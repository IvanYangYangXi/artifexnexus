---
tags: [spec, dcc, install, standard, master]
created: 2026-05-08
updated: 2026-05-25
status: active
---

# DCC 插件扩展总文档

> **本文档是 DCC 插件扩展的主入口。** 接入新 DCC 时以此文档为检查清单，确保不遗漏任何模块。
> 已完成接入的 DCC 详细文档链接在 §10 中。

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────┐
│  前端 (Tauri Desktop)                                     │
│  InstallerWizard.tsx ← dccRegistry.ts ← IPC openclaw.ts  │
└───────────────────────┬──────────────────────────────────┘
                        │ Tauri invoke
┌───────────────────────▼──────────────────────────────────┐
│  Rust Backend (src-tauri/)                                │
│  commands/openclaw.rs  ←  lib.rs (register)               │
└───────────────────────┬──────────────────────────────────┘
                        │ Sidecar JSON-RPC
┌───────────────────────▼──────────────────────────────────┐
│  Python Sidecar (openclaw_wrapper/)                       │
│  sidecar.py  RPC handlers + METHODS map                   │
│  dcc_installer.py  检测 / 安装 / 卸载 / 版本兼容          │
└───────────────────────┬──────────────────────────────────┘
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ DCC Plugin  │ │ DCC Plugin  │ │ DCC Plugin  │
│ Blender     │ │ Maya        │ │ 3ds Max     │
│ (v5.0.0)    │ │ (v2023)     │ │ (v2023)     │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘
       │               │               │
       └───────────────┼───────────────┘
                       │ 共享 SDK
┌──────────────────────▼──────────────────────────────────┐
│  artifex_nexus_sdk/ (packages/dcc/shared/)               │
│  base_adapter.py         → BaseDCCAdapter 基类           │
│  mcp_server.py           → MCPServer 参数化服务器         │
│  trigger_dispatcher_base.py → TriggerDispatcher 基类     │
└──────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  OpenClaw Gateway Plugin (mcp-bridge)                    │
│  gateway-plugin/src/index.ts  +  openclaw.plugin.json    │
│  WebSocket → OpenClaw MCP 桥接                           │
└──────────────────────────────────────────────────────────┘
```

## 2. 模块清单 — 接入新 DCC 必改

下表是接入新 DCC 时**必须触及的每一个模块**。按列顺序执行，跳步则功能不完整。

| # | 模块 | 文件 | 做什么 |
|---|------|------|--------|
| 1 | **DCC 插件源码** | `packages/dcc/{dcc}/src/artifex_nexus/v{ver}/{dcc}_addon/` | `__init__.py` (plugin_info + register/unregister)、`{dcc}_adapter.py`、`mcp_server.py`、`trigger_dispatcher.py` |
| 2 | **共享 SDK** | `packages/dcc/shared/artifex_nexus_sdk/` | 继承 `BaseDCCAdapter`（§3.1）、使用 `MCPServer`（§3.2）、继承 `TriggerDispatcher`（§3.3） |
| 3 | **Python 安装器** | `dcc_installer.py` | 扫描路径 `_DCC_VERSION_SCAN_PATHS`、安装模板 `_DCC_ADDON_PATH_TEMPLATES`、便捷别名函数 |
| 4 | **Python RPC 处理器** | `sidecar.py` | 6 个 handler（detect/install/uninstall）+ `METHODS` map 注册 |
| 5 | **Rust Tauri 命令** | `commands/openclaw.rs` | 6 个 `#[tauri::command]` 函数 |
| 6 | **Rust 命令注册** | `lib.rs` | `invoke_handler` 中注册命令 |
| 7 | **前端 IPC** | `apps/desktop/src/ipc/openclaw.ts` | 类型定义 + `invoke<>()` 函数 |
| 8 | **前端 Registry** | `dccRegistry.ts` | `dccRegistry` 条目 + adapt 函数 |
| 9 | **前端 Fixtures** | `installer.fixtures.ts` | 安装清单条目（`children: []`） |
| 10 | **Gateway Plugin Server** | `gateway-plugin/src/index.ts` | `SERVERS` 配置 + `TOOL_DEFINITIONS` |
| 11 | **Gateway Plugin Contracts** | `openclaw.plugin.json` | `contracts.tools` 添加工具名 |
| 12 | **Sidecar bootstrap** | `bootstrap.py` | `_DCC_PORT_MAP` 端口分配 |
| 13 | **网关配置 RPC** | `dcc_installer.py` → `_patch_openclaw_config_for_mcp_bridge()` | servers 条目 |
| 14 | **前端 DCC 端口** | `openclaw.ts` → `getDCCPort` / `setDCCPort` | 端口读写 IPC |
| 15 | **Sidecar 端口管理** | `sidecar.py` → `_handle_openclaw_dcc_port_*` | 端口 RPC |
| 16 | **预输入/上下文** | `dcc-preinput.ts` | DCC 已连接时的新对话预输入消息 |

## 3. 共享 SDK — API 参考

共享 SDK 位于 `packages/dcc/shared/artifex_nexus_sdk/`，所有 DCC 插件通过 `sys.path` 注入引用。

### 3.1 BaseDCCAdapter

**文件**: `base_adapter.py`

DCC 适配器基类。每个 DCC 必须继承并实现抽象方法。

```python
from artifex_nexus_sdk.base_adapter import BaseDCCAdapter

class MyDCCAdapter(BaseDCCAdapter):
    @property
    def dcc_name(self) -> str: ...
    @property
    def dcc_version(self) -> str: ...

    def execute_python(self, code: str) -> dict: ...
    def get_context(self) -> dict: ...       # 可选
    def get_selection(self) -> list: ...     # 可选

    # 线程调度（3 种模式）
    def execute_in_main_thread(self, fn, *args) -> Any: ...
```

**关键差异 — 主线程调度**：

| DCC | 实现方式 |
|-----|---------|
| Blender | `bpy.app.timers.register` 队列 |
| Maya | `maya.utils.executeInMainThreadWithResult`（原生支持） |
| 3ds Max | `pymxs.callbacks #timeout` 轮询队列 |
| UE | 编辑器主线程，无需调度 |

### 3.2 MCPServer

**文件**: `mcp_server.py`

参数化的 MCP WebSocket 服务器。共享实现，DCC 侧只需调用构造函数并注册工具。

```python
from artifex_nexus_sdk.mcp_server import MCPServer

server = MCPServer(
    dcc_name="maya",           # DCC 标识
    dcc_version="2023",        # DCC 版本
    host="127.0.0.1",          # 绑定地址
    port=18081,                # 端口
    max_port_probe=0,          # 端口探测数（0=固定端口，不探测）
)
server.set_adapter(adapter)
server.start()
```

**关键参数**:

| 参数 | 说明 |
|------|------|
| `dcc_name` | DCC 标识，用于日志和 MCP 服务器名 |
| `dcc_version` | DCC 版本字符串，不影响行为 |
| `port` | 起始端口号 |
| `max_port_probe` | 端口探测上限。`0` = 固定端口（Maya/Max/UE），`10` = 自动探测（Blender） |

**端口分配**:

| DCC | 端口 | max_port_probe |
|-----|------|----------------|
| UE | 18080 | 0 |
| Maya | 18081 | 0 |
| 3ds Max | 18082 | 0 |
| Blender | 18083 | 10 |

### 3.3 TriggerDispatcher

**文件**: `trigger_dispatcher_base.py`

文件保存/打开触发器调度器基类。Maya/Max 侧仅需实现事件钩子注册/注销函数。

```python
from artifex_nexus_sdk.trigger_dispatcher_base import TriggerDispatcher

class MyTriggerDispatcher(TriggerDispatcher):
    def _get_dcc_name(self) -> str:
        return "maya"

# DCC 侧只需注册事件钩子：
def register_maya_callbacks():
    dispatcher = TriggerDispatcher("maya")
    # Maya: cmds.scriptJob(...)
```

**核心方法**:

| 方法 | 功能 |
|------|------|
| `handle_post_save(filepath)` | 文件保存后触发匹配的 nexus-tool |
| `handle_post_open(filepath)` | 文件打开后触发匹配的 nexus-tool |
| `_find_matching_tools(trigger_type, filepath)` | 从 tool-sources.json 查找匹配工具 |
| `_load_tool_sources()` | 懒加载工具元数据 |

## 4. 插件版本号规范

### 4.1 版本号 = DCC 主版本

插件版本号与目标 DCC 的主版本一致，不再使用 `(5, 0, 0)` 三元组：

| DCC | 插件版本 | plugin_info |
|-----|---------|-------------|
| Blender | `v5.0.0` | `version: (5, 0, 0)` |
| Maya | `v2023` | `version: (2023,)` |
| 3ds Max | `v2023` | `version: (2023,)` |

### 4.2 元信息格式

```python
# Blender（bl_info）
bl_info = {
    "name": "Artifex Nexus Bridge",
    "version": (5, 0, 0),
    "blender": (5, 0, 0),       # 最低兼容
    "blender_max": (5, 1, 9),   # 最高兼容（可选）
}

# Maya / Max（plugin_info）
plugin_info = {
    "name": "Artifex Nexus Bridge",
    "version": (2023,),
    "max_min": (2023,),         # 最低兼容
    "max_max": None,            # 无上限
}
```

### 4.3 兼容规则

`dcc_min <= dcc_version <= dcc_max`（缺省无上限），逐位比较，缺失位补 0。

## 5. 安装向导 — 自动检测与手动添加

### 5.1 前端组件

| 文件 | 作用 |
|------|------|
| `apps/desktop/src/routes/InstallerWizard.tsx` | 安装向导主页面 |
| `apps/desktop/src/features/installer/dccRegistry.ts` | DCC 操作注册表（detect/install/uninstall） |
| `apps/desktop/src/features/installer/installer.fixtures.ts` | 安装清单桩数据 |
| `apps/desktop/src/features/installer/installer.types.ts` | 类型定义 |
| `apps/desktop/src/features/installer/installer.i18n.ts` | 国际化文案 |

### 5.2 dccRegistry — 统一操作接口

```typescript
// dccRegistry.ts
export const dccRegistry: Record<string, DCCActions> = {
  blender: {
    detect: async () => adaptBlenderDetect(await detectBlenderVersions()),
    install: (version, force) => installBlenderAddon(version, force),
    uninstall: (version) => uninstallBlenderAddon(version),
  },
  maya: {
    detect: async () => adaptGenericDetect(await detectMayaVersions()),
    install: (version, force) => installMayaAddon(version, force),
    uninstall: (version) => uninstallMayaAddon(version),
  },
  max: {
    detect: async () => adaptGenericDetect(await detectMaxVersions()),
    install: (version, force) => installMaxAddon(version, force),
    uninstall: (version) => uninstallMaxAddon(version),
  },
};

// 新增 DCC 时在此注册即可，InstallerWizard 自动适配
export function isDCCRegistered(id: string): boolean { ... }
export function getDCCActions(id: string): DCCActions | undefined { ... }
```

### 5.3 检测链路（以 Maya 为例）

```
前端 InstallerWizard "检测" 按钮
  → dccRegistry.maya.detect()
    → IPC detectMayaVersions()
      → Tauri invoke "openclaw_dcc_maya_detect"
        → Rust command → Sidecar JSON-RPC
          → sidecar.py _handle_openclaw_dcc_maya_detect()
            → dcc_installer.find_maya_versions()       # 扫描 ~/Documents/maya/
            → dcc_installer.get_dcc_plugin_info("maya") # 读取 plugin_info
            → dcc_installer.is_dcc_addon_installed()    # 检查目标目录
            → dcc_installer.check_dcc_version_compatibility() # 版本比对
```

### 5.4 扫描路径

| DCC | 扫描路径 | 版本目录格式 |
|-----|---------|-------------|
| Blender | `%APPDATA%/Blender Foundation/Blender/` | `5.0` / `5.1` |
| Maya | `~/Documents/maya/` | `2023` / `2024` |
| 3ds Max | `%LOCALAPPDATA%/Autodesk/3dsMax/` | `2024` / `2024 - 64bit` |
| UE | 无自动扫描，用户手动输入工程路径 | — |

> **Max 特殊处理**：目录名可能有 `- 64bit` 后缀，`find_max_versions()` 提取首个空格前的数字并去重。

### 5.5 安装目标路径

| DCC | 模板 | 示例 |
|-----|------|------|
| Blender | `{base}/{ver}/scripts/addons/artifex_nexus/` | `%APPDATA%/Blender Foundation/Blender/5.1/scripts/addons/artifex_nexus/` |
| Maya | `{base}/{ver}/scripts/artifex_nexus/` | `~/Documents/maya/2023/scripts/artifex_nexus/` |
| 3ds Max | `{base}/{ver}/ENU/scripts/artifex_nexus/` | `%LOCALAPPDATA%/Autodesk/3dsMax/2024/ENU/scripts/artifex_nexus/` |
| UE | `{project}/Plugins/ArtifexNexusForUnreal/` | 用户手动指定工程目录 |

> **安装方式**：统一使用 `shutil.copytree` 物理拷贝，不使用 junction/symlink。

### 5.6 Locale 同步（Maya / Max 专有）

| DCC | Locale 模式 | 同步方式 |
|-----|-----------|---------|
| Maya | `{base}/{ver}/xx_XX/scripts/` | 扫描 locale 目录，物理复制到各 locale |
| 3ds Max | `{base}/{ver}/{locale}/scripts/` | 全 locale（ENU/CHS/JPN…），物理复制 |

### 5.7 UE 特殊处理

- **不扫描引擎目录**：UE 插件安装到具体项目，非引擎全局目录
- **用户手动添加**：输入工程路径 + 版本号，标签格式为 `项目名 (UE 版本)`
- **异步检测**：添加后通过 `check_ue_plugin_installed` 检查 `{projectPath}/Plugins/ArtifexNexusForUnreal/` 是否存在
- **Fixtures 无预设子项**：`children` 初始为 `[]`

### 5.8 子项持久化

用户手动添加的 DCC 子项通过 `localStorage` 持久化，key 格式：`artifex_installer:v1:children:{itemId}`。初始化时读取并合并到 fixture 数据，变更自动写入。

### 5.9 子项行显示规范

```
┌─────────────────────────────────────────────────────────┐
│ ▶ Blender                    已安装 2 个版本              │
│   ├─ Blender 5.1  兼容 v5.0.0   [已安装] [卸载]          │
│   ├─ Blender 5.0  兼容 v5.0.0   [未安装] [安装]          │
│   └─ Blender 4.2  不兼容        [强制安装]               │
└─────────────────────────────────────────────────────────┘
```

## 6. Sidecar RPC 接口

### 6.1 通用模板

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `openclaw.dcc.{dcc}.detect` | — | `{versions: [...], addon_info: {...}}` | 检测已安装版本及插件状态 |
| `openclaw.dcc.{dcc}.install` | `version, force?` | `{success, method, target, error?}` | 安装插件 |
| `openclaw.dcc.{dcc}.uninstall` | `version` | `{success, target, error?}` | 卸载插件 |

### 6.2 detect 响应格式

```json
{
  "versions": [{
    "version": "2024",
    "installed": true,
    "compatible": true,
    "compat_reason": "兼容 (>= 2023)"
  }],
  "addon_info": {
    "name": "Artifex Nexus Bridge",
    "version": "2023",
    "dcc_min": "2023",
    "dcc_max": null
  }
}
```

> Blender 使用 `blender_min` / `blender_max` 字段；Maya/Max/UE 使用 `dcc_min` / `dcc_max` 字段。

### 6.3 METHODS 注册表位置

`sidecar.py` → `METHODS` dict：

```python
METHODS = {
    "openclaw.dcc.blender.detect":  _handle_openclaw_dcc_blender_detect,
    "openclaw.dcc.blender.install": _handle_openclaw_dcc_blender_install,
    "openclaw.dcc.blender.uninstall": _handle_openclaw_dcc_blender_uninstall,
    "openclaw.dcc.maya.detect":    _handle_openclaw_dcc_maya_detect,
    "openclaw.dcc.maya.install":   _handle_openclaw_dcc_maya_install,
    "openclaw.dcc.maya.uninstall": _handle_openclaw_dcc_maya_uninstall,
    "openclaw.dcc.max.detect":     _handle_openclaw_dcc_max_detect,
    "openclaw.dcc.max.install":    _handle_openclaw_dcc_max_install,
    "openclaw.dcc.max.uninstall":  _handle_openclaw_dcc_max_uninstall,
    "openclaw.dcc.unreal.detect":  _handle_openclaw_dcc_unreal_detect,
    "openclaw.dcc.unreal.install": _handle_openclaw_dcc_unreal_install,
    "openclaw.dcc.unreal.uninstall": _handle_openclaw_dcc_unreal_uninstall,
    ...
}
```

## 7. Rust 命令注册

### 7.1 命令函数模板

```rust
// commands/openclaw.rs
#[tauri::command]
pub async fn openclaw_dcc_{dcc}_detect(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("openclaw.dcc.{dcc}.detect", json!({}))
}
```

### 7.2 lib.rs 注册

```rust
// lib.rs → invoke_handler
commands::openclaw::openclaw_dcc_{dcc}_detect,
commands::openclaw::openclaw_dcc_{dcc}_install,
commands::openclaw::openclaw_dcc_{dcc}_uninstall,
```

## 8. Gateway MCP Bridge 插件

### 8.1 概述

`mcp-bridge` 是 OpenClaw Gateway 插件，作为 **WebSocket → OpenClaw MCP** 桥接层。所有 DCC 的 MCP Server 都通过此插件接入。

### 8.2 配置文件

| 文件 | 作用 |
|------|------|
| `gateway-plugin/src/index.ts` | Server 配置 + Tool 定义 + 入口函数 |
| `gateway-plugin/openclaw.plugin.json` | 插件清单 + `contracts.tools` |

### 8.3 新增 DCC Server

**index.ts — `SERVERS` 对象**:

```typescript
const SERVERS: Record<string, ServerConfig> = {
  "blender-editor": { type: "websocket", url: "ws://127.0.0.1:18083" },
  "maya-primary":   { type: "websocket", url: "ws://127.0.0.1:18081" },
  "max-primary":    { type: "websocket", url: "ws://127.0.0.1:18082" },
};
```

**index.ts — `TOOL_DEFINITIONS` 对象**: 每个 server 至少注册 `run_python` 工具。

**openclaw.plugin.json — `contracts.tools`**: 精确列出所有工具名：

```json
{
  "contracts": {
    "tools": [
      "mcp_blender-editor_run_python",
      "mcp_maya-primary_run_python",
      "mcp_max-primary_run_python"
    ]
  }
}
```

### 8.4 部署

```python
# dcc_installer.py → _patch_openclaw_config_for_mcp_bridge()
# 安装任意 DCC 时自动检查并部署 mcp-bridge
```

部署后执行 `openclaw plugins registry --refresh`。

## 9. 前端 IPC 接口

### 9.1 类型与函数

`apps/desktop/src/ipc/openclaw.ts`：

```typescript
// ── 通用 DCC 类型 ──
export interface DCCDetectResult {
  versions: Array<{ version: string; installed: boolean; compatible: boolean; compat_reason: string }>;
  addon_info: { name: string; version: string; dcc_min: string; dcc_max: string | null };
}

export interface DCCInstallResult {
  success: boolean;
  method: "copy" | null;
  target: string;
  error: string | null;
  locale_synced?: string[];
  startup_scripts?: string[];
}

// ── 通用 DCC 函数 ──
export async function detectMayaVersions(): Promise<DCCDetectResult> { ... }
export async function installMayaAddon(version: string, force?: boolean): Promise<DCCInstallResult> { ... }
export async function uninstallMayaAddon(version: string): Promise<DCCUninstallResult> { ... }
```

### 9.2 端口管理

```typescript
export async function getDCCPort(dcc: string): Promise<DCCPortConfig> { ... }
export async function setDCCPort(dcc: string, port: number): Promise<DCCPortSetResult> { ... }
```

## 10. 已完成 DCC 详细文档

| DCC | 接入状态 | 详细文档 |
|-----|---------|---------|
| Blender | ✅ 完成 | `docs/specs/blender-plugin-comparison-artclaw-vs-artifex.md` |
| Maya | ✅ 完成 | `docs/specs/maya-max-mcp-integration.md` |
| 3ds Max | ✅ 完成 | `docs/specs/maya-max-mcp-integration.md` |
| Unreal Engine | ✅ 完成 | STORY-0051 系列卡片 |
| 触发器系统 | ✅ 完成 | `docs/specs/dcc-extension-trigger-system.md` |

### SDK 文档

| 文档 | 内容 |
|------|------|
| `docs/sdk/dcc-adapter.md` | BaseDCCAdapter 接口详解 |
| `docs/sdk/dcc-installer.md` | 安装器 API |
| `docs/sdk/dcc-registry.md` | 前端 dccRegistry 详解 |
| `docs/sdk/mcp-bridge.md` | Gateway 插件详解 |
| `docs/sdk/dcc-preinput.md` | 预输入/上下文消息 |

## 11. 端口分配总表

| DCC | 端口 | 备注 |
|-----|------|------|
| UE | 18080 | 固定，`max_port_probe=0` |
| Maya | 18081 | 固定，被占用则跳过启动 + UI 警告 |
| 3ds Max | 18082 | 固定，被占用则跳过启动 + UI 警告 |
| Blender | 18083 | 自动探测，`max_port_probe=10` |
| Gateway | 19789 | OpenClaw Gateway |

## 12. dcc_installer.py 关键函数索引

| 函数 | 用途 |
|------|------|
| `find_dcc_versions(dcc)` | 通用版本扫描 |
| `find_blender_versions()` / `find_maya_versions()` / `find_max_versions()` | DCC 特定版本扫描 |
| `get_dcc_addon_target_dir(dcc, ver)` | 计算安装目标路径 |
| `install_dcc_addon(dcc, ver, force)` | 通用安装 |
| `uninstall_dcc_addon(dcc, ver)` | 通用卸载 |
| `is_dcc_addon_installed(dcc, ver)` | 检查是否已安装 |
| `get_addon_info()` | 读取 Blender bl_info |
| `get_dcc_plugin_info(dcc)` | 读取 Maya/Max plugin_info |
| `check_version_compatibility(ver)` | Blender 版本兼容检查 |
| `check_dcc_version_compatibility(dcc, ver)` | Maya/Max 版本兼容检查 |
| `install_maya_addon(ver, force)` | Maya 安装 + locale 同步 |
| `install_max_addon(ver, force)` | Max 安装 + locale 同步 + 启动脚本 |
| `install_gateway_mcp_bridge()` | 部署 Gateway 插件 |

## 13. 相关文档

- `docs/specs/maya-max-mcp-integration.md` — Maya / Max 接入详细规范
- `docs/specs/dcc-extension-trigger-system.md` — DCC 触发器系统
- `docs/specs/blender-plugin-comparison-artclaw-vs-artifex.md` — Blender 插件对比
- `docs/sdk/README.md` — SDK 索引
- `docs/development/agent-onboarding.md` — 新人上手
