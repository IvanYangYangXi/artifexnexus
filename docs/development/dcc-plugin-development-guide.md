# DCC 插件开发指南

> 记录 Maya / 3ds Max 插件开发的坑位、规范、artclaw 参考。

## 1. Maya 插件

### 1.1 启动链

```
Maya 启动 → scripts/userSetup.py → register() → executeDeferred → 创建 UI + 启动 MCP Server
```

**关键规则**：

1. **userSetup.py 部署**：必须安装到 `~/Documents/maya/{ver}/scripts/userSetup.py`，Maya 启动时自动执行
2. **延迟启动**：`register()` 中所有 UI 操作必须包裹在 `maya.utils.executeDeferred()` 中，等 Maya UI 完全初始化
3. **路径注入**：userSetup.py 中 `sys.path.insert(0, scripts/artifex_nexus/)`
4. **单例 Server**：用模块级 `_mcp_server` 变量防止重复创建

**userSetup.py 模板**：
```python
import sys, os
_addon = os.path.join(os.path.dirname(__file__), "artifex_nexus")
if os.path.exists(_addon) and _addon not in sys.path:
    sys.path.insert(0, _addon)
try:
    from artifex_nexus.v2023.maya_addon import register
    register()
except ImportError:
    pass
```

**register() 模板**：
```python
def register():
    import maya.utils
    maya.utils.executeDeferred(_deferred_startup)

def _deferred_startup():
    _create_menu()
    _create_shelf()
    register_callbacks()
    start_server()
```

### 1.2 安装器集成

- `install_maya_addon()` 安装后必须自动部署 `userSetup.py`
- 已有 userSetup.py 时只追加 Artifex Nexus 代码段，不覆盖原有内容
- `userSetup.py` 同步到所有 locale 目录（zh_CN 等）
- `uninstall_maya_addon()` 卸载时清理 locale 目录中的副本

### 1.3 artclaw 参考

| 维度 | artclaw | artifex-nexus |
|------|---------|---------------|
| 启动入口 | `maya_setup/userSetup.py` | `scripts/userSetup.py`（安装器自动生成） |
| 延迟启动 | `maya.utils.executeDeferred(_deferred_startup)` | 同 |
| 路径查找 | 多策略（MAYA_SCRIPT_PATH / ARTCLAW_BRIDGE_PATH / userScriptDir） | 单策略（相对路径） |
| 依赖管理 | integrity_check + ensure_dependencies | 无（依赖预装） |

## 2. 3ds Max 插件

### 2.1 启动链

```
Max 启动 → scripts/startup/artifex_startup.ms → python.ExecuteFile startup.py
  → _main() → QTimer.singleShot(2000) → _deferred_startup()
  → 创建 adapter → 注册 MacroScript → 创建菜单 → 启动 MCP Server → 注册钩子
```

**关键规则**：

1. **QTimer 延迟**：使用 `QTimer.singleShot(2000, _deferred_startup)` 延迟 2 秒，等 Max UI 完全就绪
2. **进程锁**：用模块级 `_startup_done` 标志防止重复执行
3. **startup.py 不立即执行**：模块顶层只调用 `_main()`，不在顶层直接执行 DCC 操作
4. **MacroScript 先注册再引用**：菜单项必须先通过 `rt.execute('macroScript ...')` 注册，再用 `createActionItem` 引用

### 2.2 菜单注册（正确模式）

```python
# ❌ 错误：直接 createActionItem，MacroScript 未注册
action = rt.menuMan.createActionItem("artifex_nexus_start", "ArtifexNexus")

# ✅ 正确：先用 MaxScript 注册 MacroScript，再用 createActionItem
rt.execute('''
    macroScript artifex_nexus_start
        category:"ArtifexNexus"
    (
        python.execute "from artifex_nexus import start_server; start_server()"
    )
''')
action = rt.menuMan.createActionItem("artifex_nexus_start", "ArtifexNexus")
```

### 2.3 主线程调度（QTimer 轮询）

**artclaw 已验证方案**：用 `QTimer(50ms)` 持久轮询 `_task_queue`，比 `#timeout` 回调可靠。

```python
class MaxAdapter:
    def __init__(self):
        self._poll_timer = None
        self._main_thread_queue = queue.Queue()

    def _start_poll_timer(self):
        if self._poll_timer is not None:
            return
        from PySide2.QtCore import QTimer
        self._poll_timer = QTimer()
        self._poll_timer.setInterval(50)
        self._poll_timer.timeout.connect(self._pump_tasks)
        self._poll_timer.start()

    def _pump_tasks(self):
        while not self._main_thread_queue.empty():
            task_id, fn, args, result_event = self._main_thread_queue.get_nowait()
            result = fn(*args)
            with self._results_lock:
                self._results[task_id] = result
            result_event.set()

    def execute_on_main_thread(self, fn, *args):
        self._start_poll_timer()
        task_id = self._task_id
        # ... put in queue, wait for result
```

**Fallback**：QTimer 不可用时回退到 `#timeout` 回调（CI 环境等）。

### 2.4 进程重复启动问题

**根因**：Max 的 startup 机制可能多次触发 `artifex_startup.ms`。

**修复**：
1. QTimer.singleShot 天然防重复（单次触发）
2. 模块级 `_startup_done` 标志
3. 不在模块顶层执行 DCC 操作

### 2.5 安装器集成

- `install_max_addon()` 部署 `artifex_startup.ms` 到 `scripts/startup/`
- locale 同步：ENU/CHS/JPN 等目录物理复制
- 启动脚本 sync：`startup/artifex_startup.py` 复制到所有 locale

### 2.6 artclaw 参考

| 维度 | artclaw | artifex-nexus |
|------|---------|---------------|
| 启动入口 | `startup.py` → QTimer 2s → `_deferred_startup()` | 同 |
| 菜单注册 | `register_menu()` → macroScript + createActionItem | `_create_menu()` → macroScript + createActionItem |
| 主线程调度 | QTimer 50ms + task_queue | 同（QTimer fallback #timeout） |
| 进程锁 | QTimer.singleShot 天然单次 | `_startup_done` 标志 + QTimer.singleShot |
| Chat Panel | 有（artclaw_ui/chat_panel） | 暂无 |

## 3. Gateway MCP Bridge 插件

### 3.1 编译

```bash
# 在 gateway-plugin 目录
npx esbuild src/index.ts --bundle --platform=node --outfile=index.js --format=cjs
```

### 3.2 部署触发时机

| 操作 | 触发 |
|------|------|
| Bootstrap（初始化/重装） | ✅ 自动 |
| 安装 UE 插件 | ❌ 已移除（改为独立行） |
| 安装向导 "Gateway Plugin" 行 | ✅ 手动安装 |
| `validate_deployments()` → repair | ✅ 自动修复 |
| Tauri build | ✅ `beforeBuildCommand` 自动编译 |

### 3.3 重新部署后必须重启 Gateway

插件部署后 Gateway 不会自动重载，需手动重启或等待下次启动。

### 3.4 检查安装

```bash
# 已部署文件
ls ~/.artifexnexus/.openclaw/cli/v*/node_modules/openclaw/dist/extensions/mcp-bridge/
# 应包含: index.js openclaw.plugin.json

# 验证 Maya/Max 支持
grep -c "maya-primary\|max-primary" index.js
# 应输出: 4
```

## 4. DCC 插件版本号规范

| DCC | 位数 | 示例 | 来源 |
|-----|------|------|------|
| Blender | 3 位 | (5, 0, 0) | bl_info["version"] |
| Maya | 1 位 | (2023,) | plugin_info["version"] |
| 3ds Max | 1 位 | (2023,) | plugin_info["version"] |
| UE | 2 位 | (5, 7) | .uplugin EngineVersion → major.minor |

## 5. 常见陷阱

1. **Maya userSetup.py 缺失** → 插件不会自动加载
2. **Maya register() 不延迟** → UI 可能创建失败（`$gMainWindow` 未就绪）
3. **Max startup.py 立即执行** → 重复进程、UI 未就绪
4. **Max MacroScript 未注册** → 菜单项不显示
5. **Max #timeout 回调不可靠** → MCP 工具调用超时
6. **Gateway 插件未重编译** → 新增的 DCC 工具不会被注册
7. **版本比较未 pad 对齐** → `(2023,)` vs `(2023, 0, 0)` → `!=` 误判
8. **安装目标目录错误** → Max `2023/` vs `2023 - 64bit/`
