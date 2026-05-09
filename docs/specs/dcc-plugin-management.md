---
tags: [spec, dcc, install, blender, standard]
created: 2026-05-08
status: draft
---

# DCC 插件安装与版本管理规范

> 统一标准：所有 DCC（Blender / Maya / Max / Houdini / UE / ...）的插件安装、版本检测、兼容性检查均遵循此规范。

## 1. 核心原则

1. **版本隔离**：插件按版本分目录存储，不同版本互不覆盖
2. **物理拷贝优先**：安装统一使用 copy 模式（OpenClaw v2026.5.4 的 trusted-root 安全检查不兼容 junction/symlink）
3. **精确匹配**：插件声明兼容的 DCC 版本范围，安装时自动校验
4. **统一接口**：所有 DCC 通过相同的 sidecar RPC 接口管理

## 2. 插件版本号规范

### 2.1 版本号格式

采用 `(MAJOR, MINOR, PATCH)` 三元组，与 Blender `bl_info["version"]` 格式一致。

```
version: (5, 0, 0)   # 主版本 5，次版本 0，补丁 0
```

### 2.2 兼容范围声明

插件在 `bl_info`（或等效元信息）中声明兼容的 DCC 版本范围：

```python
bl_info = {
    "version": (5, 0, 0),          # 插件自身版本
    "blender": (5, 0, 0),          # 最低兼容的 DCC 版本（必填）
    "blender_max": (5, 1, 9),      # 最高兼容的 DCC 版本（可选，不填则无上限）
}
```

**兼容规则**：`dcc_min <= dcc_version <= dcc_max`

| DCC 版本 | 插件版本 | 兼容？ |
|----------|---------|--------|
| 5.0.0 | 5.0.0 | ✅ 等于最低 |
| 5.1.0 | 5.0.0 | ✅ 在范围内 |
| 5.1.9 | 5.0.0 | ✅ 等于最高 |
| 4.2.0 | 5.0.0 | ❌ 低于最低 |
| 5.2.0 | 5.0.0 | ❌ 高于最高 |

### 2.3 版本号比较

按 `(MAJOR, MINOR, PATCH)` 逐位比较，缺失位补 0：

```
"5.1" → (5, 1, 0)
"5"   → (5, 0, 0)
```

## 3. 项目工程目录结构

### 3.1 源码目录

```
packages/dcc/{dcc_name}/src/artifex_nexus/
├── v5.0.0/                          # 插件版本目录
│   ├── __init__.py                  # DCC 包入口（含 bl_info）
│   └── blender_addon/               # DCC 适配代码
│       ├── __init__.py
│       ├── base_adapter.py
│       ├── {dcc}_adapter.py
│       └── mcp_server.py
├── v5.1.0/                          # 下一个版本
│   └── ...
└── README.md                        # 版本变更记录
```

**规则**：
- 每个插件版本一个 `v{MAJOR}.{MINOR}.{PATCH}/` 目录
- 目录名与 `bl_info["version"]` 严格对应
- 安装时自动选择最新版本目录

### 3.2 安装目标目录

```
# Blender
%APPDATA%/Blender Foundation/Blender/{dcc_version}/scripts/addons/artifex_nexus/

# Maya（M7 实现）
~/Documents/maya/{dcc_version}/scripts/artifex_nexus/

# 3ds Max（M7 实现）
%LOCALAPPDATA%/Autodesk/3dsMax/{dcc_version}/scripts/artifex_nexus/
```

**规则**：
- 目标目录名 = `artifex_nexus`（固定名，不含版本号后缀，避免 Python 模块名包含点号导致 import 失败）
- 同一 DCC 版本只保留一份插件安装（覆盖式更新）

## 4. 安装方式

### 4.1 统一使用物理拷贝（copy）

> **决策变更（2026-05-09）**：全面弃用 junction/symlink，统一使用 copy。
>
> **原因**：OpenClaw v2026.5.4 的插件 discovery 对 Gateway plugin 和 DCC addon 均做
> `fs.realpathSync` / 安全沙箱检查，junction/symlink 导致路径解析逃逸 trusted-root。
> 物理拷贝更稳健且避免跨卷问题。

| 方式 | 说明 |
|------|------|
| copy | 物理拷贝整个目录树。独立稳定，不受路径解析影响 |

### 4.2 安装流程

```
1. 检测 DCC 版本 → 获取已安装版本列表
2. 版本兼容检查 → blender_min <= dcc_version <= blender_max
3. 兼容 → 直接安装
4. 不兼容 → 提示用户（force=True 可跳过）
5. 清理旧安装 → 删除已有 junction/symlink/目录
6. 物理拷贝 → shutil.copytree(src, target)
7. 验证 → 检查目标目录存在且内容正确
```

### 4.3 卸载流程

```
1. 检测目标目录 → 是否为 junction/symlink/普通目录
2. junction/symlink → os.rmdir()（不删除目标内容）
3. 普通目录 → shutil.rmtree()
4. 验证 → 目标目录已不存在
```

## 5. Sidecar RPC 接口

### 5.1 通用接口（所有 DCC 共用）

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `openclaw.dcc.{dcc}.detect` | — | `{versions: [...], addon_info: {...}}` | 检测已安装的 DCC 版本及插件状态 |
| `openclaw.dcc.{dcc}.install` | `version, force?` | `{success, method, target, error?}` | 安装插件到指定 DCC 版本 |
| `openclaw.dcc.{dcc}.uninstall` | `version` | `{success, target, error?}` | 卸载插件 |

### 5.2 detect 响应格式

```json
{
  "versions": [
    {
      "version": "5.1",
      "installed": true,
      "compatible": true,
      "compat_reason": "兼容 (5.0.0 ~ 5.1.9)"
    }
  ],
  "addon_info": {
    "name": "Artifex Nexus Bridge",
    "version": "5.0.0",
    "blender_min": "5.0.0",
    "blender_max": "5.1.9"
  }
}
```

### 5.3 install 响应格式

```json
{
  "success": true,
  "method": "copy",
  "target": "C:\\Users\\...\\addons\\artifex_nexus",
  "error": null
}
```

## 6. 安装向导 UI 集成

### 6.1 DCC 条目行为

| 按钮 | 行为 |
|------|------|
| 检测 | 调用 `openclaw.dcc.{dcc}.detect` → 子项自动填充为检测到的版本 |
| 安装 | 兼容版本直接安装；不兼容版本弹窗确认（force=true） |
| 设置 | M7+ 接真实配置面板 |

### 6.2 子项行显示

```
┌─────────────────────────────────────────────────────────┐
│ ▶ Blender                    ● 已安装 2 个版本           │
│   ├─ Blender 5.1  [兼容 v5.0.0]  [已安装] [卸载]        │
│   ├─ Blender 5.0  [兼容 v5.0.0]  [未安装] [安装]        │
│   └─ Blender 4.2  [不兼容]       [强制安装]              │
└─────────────────────────────────────────────────────────┘
```

### 6.3 手动添加子项规则

| DCC | 输入框 | 提示 | 子项行数 |
|-----|--------|------|---------|
| Blender | 版本号 | 插件路径：`%APPDATA%/Blender Foundation/Blender/{version}/scripts/addons/` | 1 行/版本 |
| Maya | 版本号 | 插件路径：`~/Documents/maya/{version}/scripts/` + 中英文自动同步 | 1 行/版本（自动处理 locale） |
| Max | 版本号 | 插件路径：`%LOCALAPPDATA%/Autodesk/3dsMax/{version}/ENU/scripts/` + 中英文自动同步 | 1 行/版本（自动处理 locale） |
| UE | 工程路径 | 插件路径：`{project}/Plugins/` | 1 行/工程 |

**规则**：
- Blender/Maya/Max：插件安装路径根据版本号**自动计算**，用户只需输入版本号
- Maya/Max 中英文版本路径不同（如 `scripts/` vs `zh_CN/scripts/`），安装器自动同步两份
- 其他语言默认不安装，用户可手动添加子项指定路径
- UE 不扫描引擎目录，每个工程一个子项，用户输入工程根目录

### 6.4 子项行字段

| 字段 | 来源 | 示例 |
|------|------|------|
| `label` | `{DCC名} {版本号}` | `Blender 5.1` |
| `version` | 版本号 | `5.1` |
| `installPath` | 自动计算的插件安装路径 | `%APPDATA%/.../5.1/scripts/addons/` |
| `scriptPath` | 插件目录名 | `artifex_nexus` |
| `projectPath` | UE 工程路径（仅 UE） | `D:\Projects\MyGame\` |

## 7. Gateway MCP Bridge 插件

### 7.1 概述

`mcp-bridge` 是 OpenClaw Gateway 插件，作为 **WebSocket → OpenClaw MCP** 的桥接层。
所有 DCC 的 MCP Server（Blender / Maya / Max / UE）都通过此插件接入 OpenClaw。

**为什么需要 mcp-bridge**：
- OpenClaw v2026.5.4 原生 `mcp.servers` 只支持 `sse` 和 `streamable-http` transport
- DCC MCP Server 使用 WebSocket（双向通信、实时性更好）
- mcp-bridge 作为中间层，将 WebSocket 工具注册为 OpenClaw agent tools

### 7.2 架构

```
OpenClaw Agent
  │ （不设 tools.allow，使用所有已注册工具）
  ▼
Gateway Plugin (mcp-bridge)
  │ plugins.entries.mcp-bridge.config.servers
  │   blender-editor: ws://127.0.0.1:18083
  │   maya-primary:   ws://127.0.0.1:18084
  ▼
DCC MCP Server (WebSocket)
  │ tools: [run_python]
  ▼
DCC Adapter → DCC API
```

> **重要**：v2026.5.4 要求插件在 `contracts.tools` 中精确声明工具名，
> 且入口函数必须同步完成所有 `registerTool()` 调用。
> 详见 `docs/sdk/mcp-bridge.md` "OpenClaw v2026.5.4 插件开发关键约束"。

### 7.3 配置格式

```json
{
  "plugins": {
    "entries": {
      "mcp-bridge": {
        "enabled": true,
        "config": {
          "servers": {
            "blender-editor": {
              "type": "websocket",
              "url": "ws://127.0.0.1:18083",
              "enabled": true
            }
          }
        }
      }
    }
  }
}
```

### 7.4 工具命名规则

```
mcp_{server-name}_{tool-name}

示例：
  mcp_blender-editor_run_python
  mcp_blender-editor_get_context
  mcp_maya-primary_run_python
  mcp_max-primary_run_python
```

> 注意：不再使用 Agent 的 `tools.allow` 通配符过滤。
> 原因：mcp-bridge 工具注册与 Agent session 创建存在时序竞态，
> `tools.allow` 匹配失败时会直接阻断对话（`No callable tools remain`）。

### 7.5 部署方式

- **源码**：`packages/adapters/openclaw/gateway-plugin/`（`src/index.ts` + `openclaw.plugin.json`）
- **编译**：esbuild CJS bundle → `index.js`
- **目标**：`~/.artifexnexus/.openclaw/cli/{version}/node_modules/openclaw/dist/extensions/mcp-bridge/`
- **方式**：**物理拷贝**（不使用 junction/symlink，原因同 §4.1）
- **部署后**：必须执行 `openclaw plugins registry --refresh` 更新注册表缓存
- **触发**：安装任意 DCC 插件时自动检查并部署（`install_gateway_mcp_bridge()`）

### 7.6 自动安装规则

安装任意 DCC 插件时（父行或子项），自动执行：

```
1. 检查 mcp-bridge 状态（openclaw_gateway_mcp_bridge_status）
2. 未安装 → 自动部署（openclaw_gateway_mcp_bridge_install）
3. 已安装 → 跳过
4. 重装 DCC 插件时 mcp-bridge 也重新部署
```

此规则对所有 DCC 通用（Blender / Maya / Max / UE）。

### 7.7 新增 DCC Server

在 `_patch_openclaw_config_for_mcp_bridge()` 的 `servers` 中添加：

```python
"maya-primary": {
    "type": "websocket",
    "url": "ws://127.0.0.1:18084",
    "enabled": True,
}
```

同时在 `openclaw.plugin.json` → `contracts.tools` 中添加工具名：
```json
"mcp_maya-primary_run_python"
```

并在 `index.ts` 的 `TOOL_DEFINITIONS` 中添加对应工具定义。

> ⚠️ 不再需要修改 agent preset 的 `tools.allow`（已移除该字段）。

## 8. 扩展：新 DCC 接入清单

当接入新 DCC（如 Maya）时，需要：

1. **创建版本目录**：`packages/dcc/{dcc}/src/artifex_nexus/v{x.y.z}/`
2. **实现 adapter**：`{dcc}_adapter.py`（继承 `BaseDCCAdapter`）
3. **注册 RPC**：在 `sidecar.py` 的 METHOD_TABLE 中添加 `openclaw.dcc.{dcc}.*`
4. **注册 Tauri command**：在 `commands/openclaw.rs` 中添加对应函数
5. **更新安装向导**：在 `installer.fixtures.ts` 中添加 DCC 条目
6. **注册 mcp-bridge server**：在 `_patch_openclaw_config_for_mcp_bridge()` 的 `servers` 中添加条目
7. **声明工具名**：在 `openclaw.plugin.json` → `contracts.tools` 中精确添加工具名
8. **添加工具定义**：在 `index.ts` 的 `TOOL_DEFINITIONS` 中添加条目
9. **刷新注册表**：部署后执行 `openclaw plugins registry --refresh`
10. **更新本文档**：补充 DCC 特定的目标路径

## 9. 相关

- `[[install]]` — 整体安装与部署规范
- `[[系统架构设计]]` — 分层依赖与 MCP 工具最小化
- `[[../decisions/0003-adr-blender-mcp]]` — Blender MCP 架构决策
