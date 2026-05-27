---
tags: [spec, dcc, install, standard, master]
created: 2026-05-08
updated: 2026-05-27 (18:30)
status: active
---

# DCC 插件扩展总文档

> **本文档是 DCC 插件扩展的主入口。** 接入新 DCC 时以此文档为检查清单，确保不遗漏任何模块。
> 已完成接入的 DCC 详细文档链接在 §10 中。

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────┐
│  前端 (Tauri Desktop)                                     │
│  SystemPage.tsx (唯一 UI) ← IPC openclaw.ts              │
│  含三个标签页：安装向导 / 插件版本 / Gateway              │
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
│  dcc_installer.py  检测 / 安装 / 卸载 / 版本兼容 / 插件版本管理│
└───────────────────────┬──────────────────────────────────┘
         ┌──────────────┼──────────────┬──────────────┐
         ▼              ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ DCC Plugin  │ │ DCC Plugin  │ │ DCC Plugin  │ │ DCC Plugin  │
│ Blender     │ │ Maya        │ │ 3ds Max     │ │ UE          │
│ (v5.0.0)    │ │ (v2023)     │ │ (v2023)     │ │ (v5.7)      │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
       │               │               │               │
       └───────────────┼───────────────┼───────────────┘
                       │ 共享 SDK
┌──────────────────────▼──────────────────────────────────┐
│  artifex_nexus_sdk/ (packages/dcc/shared/)               │
│  base_adapter.py         → BaseDCCAdapter 基类           │
│  mcp_server.py           → MCPServer 参数化服务器         │
│  trigger_dispatcher_base.py → TriggerDispatcher 基类     │
│  decorator.py            → @skill_tool 装饰器（唯一源）   │
│  skill_manifest.py       → manifest 解析与验证（唯一源）  │
│  skill_hub.py            → SkillHub 核心（全平台统一）    │
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

插件版本号与目标 DCC 的主版本一致：

| DCC | 插件版本 | plugin_info | 版本号位数 |
|-----|---------|-------------|-----------|
| Blender | `v5.0.0` | `version: (5, 0, 0)` | 3 位 |
| Maya | `v2023` | `version: (2023,)` | 1 位 |
| 3ds Max | `v2023` | `version: (2023,)` | 1 位 |
| UE | `v5.7` | `version: (5, 7)` | 2 位（取 EngineVersion 的 major.minor） |

> **UE 版本号截断规则**：`.uplugin` 的 `EngineVersion` 可能为 `"5.7.0"`，但插件的 `version` 和 `dcc_min` 只保留前两位 `(5, 7)`，忽略 patch 版本号。因为 UE 目录后缀 `_57` 仅编码 major+minor。

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
    "maya_min": (2023,),        # 最低兼容
    "maya_max": None,           # 严格匹配：仅兼容 2023
}

# UE（.uplugin → _parse_ue_plugin_descriptor）
{
    "name": "Artifex Nexus for Unreal",
    "version": (5, 7),          # 只取 major.minor
    "dcc_min": (5, 7),          # 严格匹配 5.7
    "dcc_max": None,
}
```

### 4.3 兼容规则

`dcc_min <= dcc_version <= dcc_max`，版本比较前统一 pad 到 3 位（缺失位补 0）。

**`dcc_max=None` 含义**：严格匹配 `dcc_min` 指定版本，不是"无上限"。如需兼容未来版本，须显式设置 `dcc_max`。

| dcc_max | 语义 |
|---------|------|
| `None` | 仅兼容 `dcc_min` 精确版本（如 Maya/Max 插件） |
| `(5, 7, 9)` | 兼容 `dcc_min` ~ `dcc_max` 范围（如 Blender `(5,0,0)` ~ `(5,1,9)`） |

**用户覆盖**：可在"插件版本"标签页编辑兼容范围，持久化到 `~/.artifexnexus/config/plugin_compat.json`，覆盖内置默认值。

## 5. 安装向导 — 自动检测与手动添加

### 5.1 前端组件

| 文件 | 作用 |
|------|------|
| `packages/apps/web/src/components/system/SystemPage.tsx` | 系统页面（含三个标签页） |
| `packages/apps/web/src/ipc/openclaw.ts` | IPC 封装（类型 + 函数） |

> **历史**. `apps/desktop/src/routes/InstallerWizard.tsx` 和 `features/installer/` 目录已于 2026-05-25 删除。当前唯一 UI 入口是 SystemPage.tsx 的"安装向导"标签页。

### 5.2 安装前版本兼容检查

**所有 DCC（Blender/Maya/Max/UE）安装前都会自动进行版本兼容检查**：

1. 调用 `get_available_plugin_versions(dcc)` 获取所有可用插件版本及兼容范围
2. 数值比较用户输入的 DCC 版本是否在某个插件的 `dcc_min` ~ `dcc_max` 范围内
3. 无匹配 → 弹窗展示可用插件列表及兼容范围，用户可选"强行安装"或"取消"
4. **取消** → 回滚状态为原始值（`not-installed` 或 `installed`），不卡在"安装中"

> 此检查覆盖所有四个 DCC（UE/Maya/Max/Blender），在 `handleChildInstall` 中实现。

### 5.3 检测链路（以 Maya 为例）

```
SystemPage "检测" 按钮
  → handleGlobalDetect()
    → IPC detectMayaVersions()
      → Tauri invoke "openclaw_dcc_maya_detect"
        → Rust command → Sidecar JSON-RPC
          → sidecar.py _handle_openclaw_dcc_maya_detect()
            → dcc_installer.find_maya_versions()       # 注册表 + Program Files + 偏好目录
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
| 3ds Max | `{base}/{ver}/ENU/scripts/artifex_nexus/` | `%LOCALAPPDATA%/Autodesk/3dsMax/2024 - 64bit/ENU/scripts/artifex_nexus/` |
| UE | `{project}/Plugins/ArtifexNexusForUnreal/` | 用户手动指定工程目录 |

> **安装方式**：统一使用 `shutil.copytree` 物理拷贝，不使用 junction/symlink。

> **3ds Max 目录修正**：`get_dcc_addon_target_dir` 会先调用 `_get_max_real_dirs()` 扫描真实目录名，优先选择含 `64bit` 的实际安装目录（如 `2023 - 64bit` 而非 stub `2023`），避免装到 Autodesk 旧版残留目录。

### 5.6 Locale 同步（Maya / Max 专有）

| DCC | Locale 模式 | 同步方式 | 前端日志 |
|-----|-----------|---------|---------|
| Maya | `{base}/{ver}/xx_XX/scripts/` | 扫描 locale 目录，物理复制到各 locale | `✅ 安装成功 → .../scripts/artifex_nexus（已同步 zh_CN）` |
| 3ds Max | `{base}/{ver}/{locale}/scripts/` | 全 locale（ENU/CHS/JPN…），物理复制 | `✅ 安装成功 → .../ENU/scripts/artifex_nexus（已同步 CHS，启动脚本已部署）` |

> **Maya**：`scripts/` 目录即 ENU（英文），`zh_CN/scripts/` 为中文 locale。`_sync_maya_locales` 扫描 `xx_XX/scripts/` 格式子目录，物理复制主目录内容。
>
> **Max**：`{ver}/ENU/scripts/` 和 `{ver}/CHS/scripts/` 两个独立 locale。`_sync_max_locales` 以 ENU 为主，复制到其他 locale（CHS/JPN 等）。启动脚本部署到所有 locale 的 `startup/` 目录。

### 5.7 UE 特殊处理

- **不扫描引擎目录**：UE 插件安装到具体项目，非引擎全局目录
- **用户手动添加**：输入工程路径 + 版本号，标签格式为 `项目名 (UE 版本)`
- **异步检测**：添加后通过 `check_ue_plugin_installed` 检查 `{projectPath}/Plugins/ArtifexNexusForUnreal/` 是否存在
- **Fixtures 无预设子项**：`children` 初始为 `[]`

### 5.8 子项持久化

用户手动添加的 DCC 子项通过 `localStorage` 持久化，key 格式：`artifex_installer:v1:children:{itemId}`。初始化时读取并合并到 fixture 数据，变更自动写入。

### 5.9 插件版本管理标签页

系统页面第三个标签页（📦 插件版本），展示所有 DCC 插件版本及其兼容范围：

| 列 | 内容 | 示例 |
|----|------|------|
| DCC | DCC 标识 + 颜色徽标 | `Blender` (绿) / `UE` (紫) |
| 插件版本 | 插件自身版本号 | `v5.0.0` / `v2023` / `5.7` |
| 兼容范围 | `dcc_min` ~ `dcc_max`（可编辑） | `5.0.0 ~ 5.1.9` / `仅 2023` |
| 操作 | 编辑 / 重置 | 弹窗修改范围或恢复内置默认值 |

**数据来源**：
- Python `get_all_plugins_with_compat(dcc)` → 返回所有插件版本 + 内置兼容范围 + 用户覆盖
- 覆盖持久化到 `~/.artifexnexus/config/plugin_compat.json`
- 前端通过 IPC `getAllPluginsWithCompat` / `updatePluginCompatibility` / `resetPluginCompatibility` 读写

**交互**：
- 点击"编辑" → 弹出表单：最低版本 / 最高版本（留空 = 严格匹配最低版本）
- 点击"重置" → 恢复内置默认兼容范围，删除用户覆盖
- 修改即时生效，下一次安装或版本检查时使用新范围

### 5.10 子项行显示规范

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
    # 安装/检测/卸载
    "openclaw.dcc.blender.detect":  ...,
    "openclaw.dcc.blender.install": ...,
    "openclaw.dcc.blender.uninstall": ...,
    "openclaw.dcc.maya.detect":    ...,
    "openclaw.dcc.maya.install":   ...,
    "openclaw.dcc.maya.uninstall": ...,
    "openclaw.dcc.max.detect":     ...,
    "openclaw.dcc.max.install":    ...,
    "openclaw.dcc.max.uninstall":  ...,
    "openclaw.dcc.unreal.detect":  ...,
    "openclaw.dcc.unreal.install": ...,
    "openclaw.dcc.unreal.uninstall": ...,
    # 插件版本管理
    "openclaw.dcc.plugin.all":       _handle_openclaw_dcc_plugin_all,
    "openclaw.dcc.plugin.compat_update": _handle_openclaw_dcc_plugin_compat_update,
    "openclaw.dcc.plugin.compat_reset":  _handle_openclaw_dcc_plugin_compat_reset,
    # 部署校验
    "openclaw.dcc.validate_deployments": _handle_openclaw_dcc_validate_deployments,
    ...
}
```

### 6.4 插件版本管理 RPC

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `openclaw.dcc.plugin.all` | — | `[{dcc, name, version, dcc_min, dcc_max, overridden}, ...]` | 获取所有插件版本及兼容范围 |
| `openclaw.dcc.plugin.compat_update` | `{dcc, version, dcc_min, dcc_max}` | `{ok, message}` | 更新兼容范围（写入用户覆盖） |
| `openclaw.dcc.plugin.compat_reset` | `{dcc, version}` | `{ok, message}` | 重置为内置默认值 |
| `openclaw.dcc.validate_deployments` | — | `[{dcc, id, status, ...}]` | 部署校验（静默清理过期条目） |

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
| `find_blender_versions()` / `find_maya_versions()` / `find_max_versions()` | DCC 特定版本扫描（注册表 + Program Files + 偏好目录） |
| `get_dcc_addon_target_dir(dcc, ver)` | 计算安装目标路径（Max 优先 64bit 目录） |
| `install_dcc_addon(dcc, ver, force)` | 通用安装（含版本兼容检查） |
| `uninstall_dcc_addon(dcc, ver)` | 通用卸载（先清理 manifest） |
| `is_dcc_addon_installed(dcc, ver)` | 检查是否已安装 |
| `get_addon_info()` | 读取 Blender bl_info |
| `get_dcc_plugin_info(dcc)` | 读取 Maya/Max/UE 插件信息 |
| `get_available_plugin_versions(dcc)` | 获取所有可用插件版本及兼容范围 |
| `find_best_plugin_for_dcc(dcc, ver)` | 查找最佳匹配的插件版本 |
| `check_version_compatibility(ver)` | Blender 版本兼容检查 |
| `check_dcc_version_compatibility(dcc, ver)` | Maya/Max/UE 版本兼容检查（pad 对齐 + 用户覆盖） |
| `get_all_plugins_with_compat()` | 获取所有 DCC 插件版本及兼容范围（供前端插件版本标签页） |
| `update_plugin_compatibility(dcc, ver, min, max)` | 更新插件兼容范围（写入用户覆盖） |
| `reset_plugin_compatibility(dcc, ver)` | 重置为内置默认兼容范围 |
| `install_maya_addon(ver, force)` | Maya 安装 + locale 同步 |
| `install_max_addon(ver, force)` | Max 安装 + locale 同步 + 启动脚本 |
| `install_ue_plugin(ver, path, force)` | UE 安装 + MCP Bridge 自动部署 |
| `install_gateway_mcp_bridge()` | 部署 Gateway 插件 |
| `_sync_maya_locales(ver)` | Maya locale 物理复制 |
| `_sync_max_locales(ver)` | Max locale 物理复制 + 启动脚本 |
| `_get_max_real_dirs(ver)` | Max 真实目录扫描（支持 64bit 变体） |
| `_parse_ue_plugin_descriptor(path)` | 解析 .uplugin JSON（版本截断到 2 位） |
| `validate_all_deployments()` | 全面部署校验 + 静默清理过期条目 |

### 3.4 @skill_tool 装饰器

**文件**: `decorator.py`（共享 SDK）

全平台统一的 Skill-Tool 装饰器。纯 Python 实现，零 DCC 依赖。
所有 Hub 通过 walk ``module.__dict__`` 查找 ``_artifex_skill_tool = True`` 标记发现工具。

```python
from artifex_nexus_sdk.decorator import skill_tool, SkillToolResult

@skill_tool(name="my_tool", description="工具描述", risk_level="low")
def my_tool(arg1: str) -> SkillToolResult:
    ...
    return SkillToolResult.success({"result": "ok"})
```

**装饰器使用决策**：

| 场景 | 写装饰器？ | 调用方式 |
|------|-----------|---------|
| 稳定、高频、可复用的工具（查询、获取信息、通用编辑） | ✅ | SkillHub 按名调用 ``execute_skill()`` |
| 定制化脚本、一次性需求 | ❌ | AI 读代码 → ``run_python`` 执行 |

### 3.5 SkillHub 运行时

全平台统一的 Skill 服务注册中心。核心实现在共享 SDK 的 ``skill_hub.py`` 中，
每个 DCC 启动时通过 ``init_skill_hub()`` 初始化单例。

**启动流程**：MCP Server 启动 → ``_init_skill_hub()`` → ``scan_and_register()`` →
``start_watching()``（轮询热重载）

**AI 调用方式**（通过 ``run_python``）：
```python
from artifex_nexus_sdk.skill_hub import get_skill_hub
hub = get_skill_hub()
hub.execute_skill("skill_name", {"arg": "value"})
hub.list_skills()
```

| DCC | SkillHub 状态 | 实现位置 |
|-----|-------------|---------|
| Blender | ✅ 已实现 | ``__init__.py`` → ``_init_skill_hub()`` |
| Maya | ✅ 已实现 | ``__init__.py`` → ``_init_skill_hub()`` |
| 3ds Max | ✅ 已实现 | ``__init__.py`` + ``startup.py`` → ``_init_skill_hub()`` |
| UE | ✅ 已实现 | ``skill_hub.py``（独立实现，复用共享 ``skill_manifest``） |
| Houdini / ComfyUI / Substance / Unity | 📋 规划中 | 同上模式，参考现有实现 |

详见 `docs/specs/skill-system.md`。

- `docs/specs/maya-max-mcp-integration.md` — Maya / Max 接入详细规范
- `docs/specs/dcc-extension-trigger-system.md` — DCC 触发器系统
- `docs/specs/blender-plugin-comparison-artclaw-vs-artifex.md` — Blender 插件对比
- `docs/development/dcc-detection-guide.md` — DCC 检测指南（注册表格式、版本映射、ID 陷阱）
- `docs/sdk/README.md` — SDK 索引
- `docs/development/agent-onboarding.md` — 新人上手
- `docs/specs/skill-system.md` — Skill 系统总规范（装饰器、SkillHub）
