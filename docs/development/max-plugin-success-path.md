# 3ds Max 插件成功路径

> 本文档记录 Artifex Nexus 3ds Max 插件从启动到正常工作的完整链路，
> 以及已知陷阱和调试方法。

## 架构概览

```
Max 启动
  └─ scripts/startup/artifex_startup.ms → 调用 startup.py
       ├─ 路径注入（scripts/ + scripts/artifex_nexus/）
       ├─ QTimer.singleShot(2000) 延迟启动
       └─ _deferred_startup()
            ├─ sys.path 优先级修复（防 artclaw 模块劫持）
            ├─ 创建 MaxAdapter + MCPServer（端口 18082）
            ├─ 注册内置工具（run_python, get_editor_context）
            ├─ _create_menu() → MaxScript macroScript + menuMan
            ├─ 注册事件钩子（trigger_dispatcher）
            ├─ adapter.on_startup() + server.start()
            ├─ 共享实例给 artifex_nexus 模块（供 UI 面板使用）
            └─ QTimer.singleShot(500) → show_panel()
```

## 文件部署结构

```
%LOCALAPPDATA%/Autodesk/3dsMax/{version}/CHS/
├── scripts/
│   ├── startup/
│   │   ├── artifex_startup.ms    ← 入口（MaxScript → Python）
│   │   └── startup.py            ← 延迟启动逻辑
│   └── artifex_nexus/           ← 插件主目录
│       ├── __init__.py           ← 菜单 + MCP Server 生命周期
│       ├── startup.py            ← 启动链（与 startup/ 中的相同）
│       ├── max_adapter.py        ← Max 适配器
│       ├── mcp_server.py         ← Max MCP Server 入口
│       ├── max_ui.py             ← PySide2 UI 面板
│       ├── trigger_dispatcher.py ← 事件钩子
│       └── artifex_nexus_sdk/    ← 共享 SDK（自包含）
│           └── mcp_server.py     ← MCPServer 基类
```

**重要**：CHS + ENU 两个 locale 目录都需部署。安装器通过 `_sync_max_locales()` 处理。

## 成功检查清单

| # | 检查项 | 预期 |
|---|--------|------|
| 1 | Max 启动无"启动失败检测"对话框 | ✓ |
| 2 | Max Listener 显示：`Artifex Nexus: 延迟启动已注册（2s 后执行）` | ✓ |
| 3 | 2s 后显示工具注册日志 | ✓ |
| 4 | Max Listener 显示：`MCP Server 已启动 (端口 18082)` | ✓ |
| 5 | 顶部菜单栏出现 "Artifex Nexus" 菜单 | ✓ |
| 6 | UI 面板自动弹出，显示 "MCP Server 运行中" (绿色) | ✓ |
| 7 | 面板状态每 2s 刷新一次 | ✓ |
| 8 | 面板关闭后可重启：Artifex Nexus → Show Panel | ✓ |

## 已知陷阱

### 1. MaxScript 注释语法
MaxScript 只支持 `--` 行注释，不支持 `/* */` 块注释。
`/* */` 会导致"启动失败检测"对话框。

### 2. locale 目录漏同步
安装器有 `_sync_max_locales()` 负责从 ENU 同步到其他 locale。
但之前存在 bug：选了不存在的 ENU 目录当同步源 → OSError 被静默吞掉。
已修复（优先选实际存在 `artifex_nexus/` 的 locale）。

### 3. 端口探测 for...else bug
SDK `_start_server()` 中 `for attempt in range(max_port_probe)` 当 `max_port_probe=0`
时空循环 → `for...else` 触发 → 从不绑定端口。已修复为 `max(self._max_port_probe, 1)`。

### 4. Server 实例不同步
`startup.py` 自己创建 server，`__init__.py` 的 `_get_mcp_server()` 创建另一个。
UI 面板点"启动"时发现端口已被占用。已修复：startup.py 完成后写入共享全局变量。

### 5. artclaw 模块劫持
同目录名的 `DCCClawBridge/core/mcp_server.py` 被注入 sys.path → artifex 的
`from mcp_server import create_server` 找到 artclaw 的版本 → ImportError。
修复：`startup.py` 始终把 `_addon_dir` 提到 sys.path[0]。

### 6. `2023` vs `2023 - 64bit` 双目录
部分安装有 `2023/` 和 `2023 - 64bit/` 两个 Max 用户目录。
安装器优先选 64bit 变体。`_sync_max_locales()` 跨目录同步需处理这种情况。

## 调试方法

### 查看 Max 日志
```
%LOCALAPPDATA%/Autodesk/3dsMax/{version}/CHS/Network/Max.log
```
搜索 `artifex` 关键词。

### 手动测试启动
```python
# 在 Max Script Editor → Python 中执行：
from artifex_nexus import start_server, get_status
start_server()
print(get_status())
```

### 手动显示面板
```python
from max_ui import show_panel
show_panel()
```

### 检查端口
```bash
netstat -an | findstr 18082
```

## 端口分配

| 端口 | 用途 |
|------|------|
| 18080 | Unreal Engine MCP Server |
| 18081 | Maya MCP Server |
| 18082 | 3ds Max MCP Server |
| 18083 | Blender MCP Server |
