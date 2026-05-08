---
tags: [spec, dcc, install, blender, standard]
created: 2026-05-08
status: draft
---

# DCC 插件安装与版本管理规范

> 统一标准：所有 DCC（Blender / Maya / Max / Houdini / UE / ...）的插件安装、版本检测、兼容性检查均遵循此规范。

## 1. 核心原则

1. **版本隔离**：插件按版本分目录存储，不同版本互不覆盖
2. **链接优先**：安装优先使用 junction/symlink，失败时 fallback 到复制
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
%APPDATA%/Blender Foundation/Blender/{dcc_version}/scripts/addons/artifex_nexus_v{addon_version}/

# Maya（M7 实现）
~/Documents/maya/{dcc_version}/scripts/artifex_nexus_v{addon_version}/

# 3ds Max（M7 实现）
%LOCALAPPDATA%/Autodesk/3dsMax/{dcc_version}/scripts/artifex_nexus_v{addon_version}/
```

**规则**：
- 目标目录名 = `artifex_nexus_v{addon_version}`（如 `artifex_nexus_v5.0.0`）
- 不同插件版本安装到不同目录，互不覆盖
- 同一 DCC 版本可同时安装多个插件版本（但 Blender 只会加载一个）

## 4. 安装方式

### 4.1 优先级

```
junction (Windows) > symlink > copy (fallback)
```

| 方式 | 平台 | 权限要求 | 优点 | 缺点 |
|------|------|---------|------|------|
| junction | Windows | 无 | 无需管理员，自动同步源码变更 | 仅目录，不可跨盘符 |
| symlink | macOS/Linux | 无（开发者模式） | 自动同步 | Windows 需开发者模式 |
| copy | 全平台 | 无 | 独立稳定 | 不自动同步 |

### 4.2 安装流程

```
1. 检测 DCC 版本 → 获取已安装版本列表
2. 版本兼容检查 → blender_min <= dcc_version <= blender_max
3. 兼容 → 直接安装
4. 不兼容 → 提示用户（force=True 可跳过）
5. 清理旧安装 → 删除已有 junction/symlink/目录
6. 创建链接 → junction → symlink → copy
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
  "method": "junction",
  "target": "C:\\Users\\...\\addons\\artifex_nexus_v5.0.0",
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
| `scriptPath` | 插件目录名 | `artifex_nexus_v5.0.0` |
| `projectPath` | UE 工程路径（仅 UE） | `D:\Projects\MyGame\` |

## 7. 扩展：新 DCC 接入清单

当接入新 DCC（如 Maya）时，需要：

1. **创建版本目录**：`packages/dcc/{dcc}/src/artifex_nexus/v{x.y.z}/`
2. **实现 adapter**：`{dcc}_adapter.py`（继承 `BaseDCCAdapter`）
3. **注册 RPC**：在 `sidecar.py` 的 METHOD_TABLE 中添加 `openclaw.dcc.{dcc}.*`
4. **注册 Tauri command**：在 `commands/openclaw.rs` 中添加对应函数
5. **更新安装向导**：在 `installer.fixtures.ts` 中添加 DCC 条目
6. **更新本文档**：补充 DCC 特定的目标路径

## 相关

- `[[install]]` — 整体安装与部署规范
- `[[系统架构设计]]` — 分层依赖与 MCP 工具最小化
- `[[../decisions/0003-adr-blender-mcp]]` — Blender MCP 架构决策
