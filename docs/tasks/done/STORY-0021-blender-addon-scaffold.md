---
id: STORY-0021
kind: story
title: Blender 插件骨架 �?侧栏面板 + 启动/停止按钮
status: done
priority: P1
owner: "@ivan"
assignee: pair
estimate: 0.5d
created: 2026-05-08
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "packages/dcc/blender"
tags: [story, blender, addon, M2]
---

# STORY-0021 · Blender 插件骨架

## 用户故事
作为用户，我能在 Blender 侧栏看到 Artifex Nexus 面板，点�?启动"按钮�?MCP Server 开始监听�?
## 验收标准
- [x] Blender 侧栏（N 面板）出�?"Artifex Nexus" 标签�?- [x] 面板显示：状态指示灯（红/绿）、启�?停止按钮、端口号
- [x] 点击"启动"�?状态变绿，显示 `ws://127.0.0.1:{port}`
- [x] 点击"停止"�?状态变红，端口释放
- [x] 关闭 Blender 时自动停�?MCP Server
- [x] addon 启用时自动启�?MCP Server（无需手动点按钮）

## 技术要�?- 复刻 `artclaw_bridge/subprojects/DCCClawBridge/blender_addon.py`
- 精简：去�?Qt Bridge、事件拦截、Tool Manager 相关代码
- 保留：`bpy.types.Panel` + `bpy.utils.register_class` 注册模式
- 面板布局：`bl_info` �?`register()` �?`unregister()`

## 部署实录�?026-05-09 跑通）

### 安装方式
addon 通过 junction 安装�?Blender addons 扫描目录�?```
mklink /J "<APPDATA>\Blender Foundation\Blender\5.1\scripts\addons\artifex_nexus"
           "packages\dcc\blender\src\artifex_nexus\v5.0.0\blender_addon"
```

### 排查过的问题

1. **目录名含点号**：`artifex_nexus_v5.0.0` �?Python import 解析为子模块访问 �?改为固定�?`artifex_nexus`（不带版本号）�?2. **顶层 `__init__.py` �?`bl_info`**：junction 指向的是 `artifex_nexus/`（namespace 包）而非 `blender_addon/`（真正的 addon）→ junction 改为直接指向 `v5.0.0/blender_addon/`�?3. **相对导入失败**：`blender_adapter.py` �?`from .base_adapter import ...` 在被作为独立模块 import 时报 `no known parent package` �?改为绝对导入 `from base_adapter import ...`（addon 目录已加�?`sys.path`）�?4. **MCP Server 不自动启�?*：旧设计需手动点按�?�?`register()` 末尾�?`_auto_start_server()` 实现 addon 启用即自动启动�?
### 修改的文�?| 文件 | 修改 |
|------|------|
| `packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/__init__.py` | 修复导入路径（`from mcp_server`）；添加 `_auto_start_server()`；`register()` 自动启动 |
| `packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/blender_adapter.py` | `from .base_adapter` �?`from base_adapter`（绝对导入） |
| `packages/adapters/openclaw/wrapper/.../dcc_installer.py` | `_get_addon_dir_name()` 返回固定名不带版本号；`_get_addon_src_dir()` 路径指向 `blender_addon/` 子目�?|

### 验证结果
Blender 5.1 启用 addon 后控制台输出�?```
[Artifex Nexus] MCP Server 已启�? ws://127.0.0.1:18083
```
Gateway 日志确认连接成功�?```
[mcp-bridge] Connected to MCP server "blender-editor" at ws://127.0.0.1:18083
[mcp-bridge] Registered 1 new tool(s) from "blender-editor" (total: 1)
```

