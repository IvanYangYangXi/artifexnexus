---
tags: [spec, openclaw, nexus-tool, runtime, sidecar, mcp, dependency]
created: 2026-05-19
updated: 2026-05-20
status: stable
related: [[nexus-tool-direct-run-async]], [[openclaw-wrapper-runtime]], [[skill-system]], [[dcc-extension-trigger-system]]
---

# Nexus-Tool 运行时（Runtime）

> 总览：sidecar 接收 `nexus-tool.run` RPC 后，如何把工具脚本送到正确的执行环境
> （通用 Python 子进程 / DCC 进程内 exec），如何处理超时 / 取消 / 编码 / 结果解析。
>
> 本文是 Nexus-Tool 运行流程的**单一权威 spec**——以后改这块**先改这里**再改代码。
> 探索性背景请读 [[nexus-tool-direct-run-async]]。

## 1. 总览：两条执行路径

```
                 ┌────────────────────────────────────────────────────────┐
RPC nexus-tool.run                       后台线程 _run                   │
  │              ▼                                                       │
  │  ┌──────────────────────────┐                                        │
  │  │ _handle_nexus_tool_run   │ ─ 立即返回 task_id（status=started）   │
  │  └──────────────────────────┘                                        │
  │              │                                                       │
  │              ▼                                                       │
  │  ┌──────────────────────────┐                                        │
  │  │ _execute_tool_sync       │                                        │
  │  └──────┬───────────────┬───┘                                        │
  │         │ general       │ blender/maya/ue/...                        │
  │         ▼               ▼                                            │
  │  ┌─────────────┐  ┌────────────────────────────────┐                 │
  │  │ subprocess  │  │ MCP Bridge → DCC.run_python    │                 │
  │  │ + importlib │  │ ws://127.0.0.1:18083 (Blender) │                 │
  │  │ wrapper.py  │  │ exec(code, ns) in DCC main thread               │
  │  └─────────────┘  └────────────────────────────────┘                 │
  │         │                       │                                    │
  │         └─────────┬─────────────┘                                    │
  │                   ▼                                                  │
  │  ┌──────────────────────────┐                                        │
  │  │ _task_store[id] = done   │  ← 5 分钟 TTL 自动 GC                  │
  │  └──────────────────────────┘                                        │
  │                                                                      │
  └─────────────► RPC nexus-tool.result(task_id) 轮询，nexus-tool.cancel 取消
                       前端确认后 nexus-tool.ack 立即清理
```

| 路径 | 触发条件 | 关键文件 | 进程位置 |
| --- | --- | --- | --- |
| **通用工具** | `manifest.targetDCCs` 含 `"general"` 或为空 | `nexus_tool_rpc._execute_general_tool` | 独立 Python 3.x 子进程（与 sidecar 同解释器） |
| **DCC 工具** | `targetDCCs` 含 `blender` / `maya` / `ue` 等 | `nexus_tool_rpc._execute_dcc_tool` + `mcp_bridge.MCPBridgeClient` | 目标 DCC 进程内（通过 MCP WebSocket → `run_python`） |

## 2. 通用工具执行流程

### 2.1 子进程启动模型

```python
proc = subprocess.Popen(
    [sys.executable, "-X", "utf8", "<tempdir>/_nexus_wrapper.py"],
    stdin=PIPE, stdout=PIPE, stderr=PIPE,            # ← bytes 模式，不是 text=True
    cwd=tool_dir,
    env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
    creationflags=CREATE_NEW_PROCESS_GROUP,          # ← Windows，便于 taskkill /T
)
```

**绝不能用 `text=True`**——Windows 中文 locale 下 reader 线程会按 GBK 解码，遇到工具
`print("中文")` 输出的 UTF-8 字节立即 `UnicodeDecodeError` → reader 死掉 →
`communicate()` 返回 `(None, None)` → `len(stdout)` 直接 `TypeError: NoneType`。
这是 2026-05-19 之前的核心 bug 之一。

**强制 UTF-8 三重保险**：
1. `-X utf8`（命令行）
2. `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1`（环境变量）
3. wrapper 内部 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`

### 2.2 临时 wrapper 文件

写到 `tempfile.mkdtemp(prefix="nexus-tool-<task_id>-")`，**不写到工具源码目录**——
- 不污染只读官方工具目录
- 同名工具并发不互相覆盖
- `finally: shutil.rmtree(workdir, ignore_errors=True)` 杜绝残留

### 2.3 参数传递

父进程把 `run_args` 序列化为 UTF-8 JSON bytes → `stdin`；wrapper 内 `sys.stdin.buffer.read().decode("utf-8")` → `json.loads`。**全程 JSON，不走 Python 字面量**。

### 2.4 入口函数调用

wrapper 用 `importlib.util.spec_from_file_location` 加载工具 `main.py`，绕过
`if __name__ == "__main__"` 守卫，然后 `func(**args)`。

### 2.5 ⭐ 结果协议：BEGIN/END Marker

```
<工具任意 print 输出，例如进度日志……>
===NEXUS_RESULT_BEGIN===
{"success": true, "data": {...}}
===NEXUS_RESULT_END===
```

父进程按 marker 抠出中间 JSON。**向后兼容**：未带 marker 时退回"整个 stdout 是 JSON
→ 最后一行是 JSON"两段式 fallback。

**工具脚本不需要关心 marker**——wrapper 在调用入口函数后自动包裹返回值。

### 2.6 超时与取消

| 来源 | 优先级 | 上限 |
| --- | --- | --- |
| `manifest.implementation.timeout`（秒） | 高 | 1 ~ 86400 |
| `app.settings.nexusToolDefaultTimeoutSec` | 中 | 1 ~ 86400 |
| 模块 fallback 120 | 低 | — |

`TimeoutExpired` → `_kill_process_tree(pid)` 递归杀（见 §4）→ `communicate(timeout=5)` 回收僵尸。

## 3. DCC 工具执行流程（以 Blender 为例）

### 3.1 链路

```
sidecar
  └─► MCPBridgeClient (ws://127.0.0.1:18083)
       └─► Blender addon MCP server (主线程 exec)
             └─► run_python(injected_code)
                   └─► exec(injected_code, namespace)
                         ├─ namespace 预填充: bpy, S, C, D, L, W ...
                         ├─ namespace 注入：__file__, __name__, sys.path, _nexus_tool_args
                         └─ 自动调用 manifest.implementation.function(**args)
```

### 3.2 ⭐ 注入头：`injected_code` 的结构

```python
# --- nexus-tool context injected ---
import sys as _sys
for _p in ["<tool_dir>", "<sdk_parent>"]:
    if _p and _p not in _sys.path:
        _sys.path.insert(0, _p)
__name__ = '__nexus_dcc_tool__'
__file__ = "<tool_dir>/main.py"           # ← exec 默认无 __file__，必须显式注入
_nexus_tool_args = {'skip_default_names': False, ...}   # ← repr() 出来，不是 json.dumps

<原始 main.py 代码>

# --- auto-call entry function ---
import json as _json
try:
    _nexus_tool_result = check_naming(**_nexus_tool_args)
    print(_json.dumps(_nexus_tool_result, ensure_ascii=False, default=str))
except Exception as _nexus_tool_err:
    import traceback as _tb
    print(_json.dumps({"success": False, "error": str(_nexus_tool_err),
                       "error_type": type(_nexus_tool_err).__name__,
                       "traceback": _tb.format_exc()}, ensure_ascii=False))
```

#### 注入头的每一项都不能少

| 注入项 | 不注入会导致 |
| --- | --- |
| `sys.path += [tool_dir, sdk_parent]` | `ModuleNotFoundError: No module named 'artifex_nexus_sdk'`；工具脚本不能 import 本地兄弟模块 |
| `__file__ = main.py` | `NameError: name '__file__' is not defined`（工具用 `os.path.dirname(__file__)` 找同目录 manifest 资源时） |
| `__name__ = '__nexus_dcc_tool__'` | `if __name__ == "__main__":` 守卫被意外触发 → 工具自跑两遍 |
| **`_nexus_tool_args = repr(...)`** | **boolean 参数**用 `json.dumps` 拼会写出 `{"x": false}` → exec 时 `NameError: name 'false' is not defined`。**必须用 `_python_literal()`（基于 `repr()` + `ast.literal_eval` 双向校验）** |
| `traceback` 透传 | 出错只看到一行 `str(err)`，定位极难 |

> **历史教训**：以上 5 个注入项每个都对应过一个独立 bug，是 2026-05-19 修复批次的主体。
> 详见 [[../changelog/2026-05-19-nexus-tool-run-fixes]]。

### 3.3 MCP Bridge 连接与重试

**单例长连接**：整个 sidecar 进程共享一个 `MCPBridgeClient` 实例，避免每次 call_tool 都
重新握手。WebSocket + JSON-RPC 2.0 + MCP 协议握手（`initialize` → `initialized` 通知）。

**`_async_connect` 启动顺序（关键时序）**：

```
1. await websockets.connect()                   ← 建链
2. await send(initialize) + await recv()        ← MCP 握手
3. await send(initialized notification)
4. self._ws = ws                                ← 必须早于 reader create_task！
5. self._connected = True                       ← 必须早于 reader create_task！
6. self._response_queue = asyncio.Queue()
7. self._reader_task = asyncio.create_task(_message_reader)   ← 最后
```

> **历史 bug**：之前 4/5 步在外层 `connect()` 拿到 `future.result()` **之后**才设，
> 时序上晚于 reader 首次 `while self._connected and self._ws:` 判断 → reader 启动即退出
> → `_async_call_tool` 在空 queue 上永远 `.get()` → 前端"一直转圈"。

**自动重连重试**（`call_tool` → `_call_tool_once`）：

| 错误种类 | 是否重试 | 原因 |
| --- | --- | --- |
| `ConnectionClosed*`（含 1001 going away） | ✅ 一次 | server 端 addon reload / 用户停 MCP server，新连接通常马上能起 |
| `ConnectionReset/Refused/BrokenPipe` | ✅ 一次 | 网络层瞬态错误 |
| 异常文本含 `1001` / `1006` / `going away` | ✅ 一次 | 不同 websockets 版本异常类名不一致的兜底 |
| `asyncio.TimeoutError` | ❌ | 通常是 DCC 主线程在跑长任务，重试会叠加阻塞 |
| MCP 业务 error | ❌ | 重试也不会变好 |

`_message_reader` 退出时**无条件**向 queue 推 sentinel None，唤醒所有等待者
（旧版用 `if was_connected` 守卫，race 下会漏推 → 死锁）。

## 4. 进程树管理

**Windows 必须递归杀**——工具脚本经常 spawn 孙子进程（`subprocess.run(...)` 调外部
工具），`proc.kill()` 只杀直接子进程，孙子会成为孤儿。

```
_kill_process_tree(pid):
    1. 优先 psutil.Process(pid).children(recursive=True) + .kill()
    2. 回退到平台命令：
       - Windows: taskkill /F /T /PID <pid> （+ CREATE_NO_WINDOW 不弹黑框）
       - POSIX:   os.killpg(os.getpgid(pid), SIGKILL)
```

启动时 Windows 用 `CREATE_NEW_PROCESS_GROUP` flag，让进程树可以被 `/T` 整组结束。

## 5. 任务存储与 GC

```python
_task_store: Dict[task_id, {
    "task_id": str,
    "status": "running" | "done" | "error" | "cancelled",
    "created_at": float,
    "result"?: dict,
    "error"?: str,
    "cancel_event"?: threading.Event,
    "subprocess_handle"?: Popen,                # 仅通用工具，DCC 工具走 MCP 无 handle
}]
```

**GC 策略**：
- `TASK_TTL = 300s`（已完成/出错/取消 5 分钟后清理）
- `_cleanup_expired_tasks()` 在 `nexus-tool.run` 与 `nexus-tool.result` 入口处主动触发
- 前端调 `nexus-tool.ack(task_id)` 立即清理（不等 TTL）

**并发上限**：`app.settings.nexusToolMaxConcurrent`（默认 3），超出返回业务错误，不阻塞 RPC。
**只统计 `status=running`**，已完成的不计入。

## 6. 应用级设置（`app.settings.*`）

> RPC：`app.settings.get`、`app.settings.set`、`app.settings.reset`。前端入口：
> Tauri Settings 路由 → "常规" Tab。

**存储位置**：`<openclaw_home>/state/artifex/app-settings.json`，原子写、损坏自动备份为
`.broken-<timestamp>`。后端读取走 `app_settings.get_runtime_settings()`，带 5s 进程内缓存
（高频调用不打文件）。

**当前字段**（与前端 `AppSettings` interface 1:1）：

| 字段 | 类型 | 默认 | 用途 |
| --- | --- | --- | --- |
| `nexusToolDefaultTimeoutSec` | int [1, 86400] | 120 | 通用 nexus-tool 默认超时；manifest 可覆盖 |
| `nexusToolMaxConcurrent` | int [1, 64] | 3 | 同时运行的 nexus-tool 数 |
| `nexusToolKillProcessTree` | bool | true | cancel 是否递归杀子进程（保留位，目前总是 true） |
| `logLevel` | enum | INFO | sidecar 日志等级（热更新待实现，需重启 sidecar） |

**新增字段流程**（必须 4 步全做）：
1. `app_settings.py` 的 `DEFAULT_SETTINGS` 加默认值 + `_validate` 加校验；
2. 后端读取处用 `get_runtime_settings()[key]`；
3. `apps/desktop/src/ipc/app_settings.ts` 的 `AppSettings` interface 加字段；
4. `apps/desktop/src/routes/Settings.tsx` 的 `GeneralForm` 加输入控件。

## 7. RPC 表（前端 ↔ sidecar）

| Method | params | result | 说明 |
| --- | --- | --- | --- |
| `nexus-tool.run` | `{id, args}` | `{task_id, status: "started"}` | 立即返回，后台线程跑 |
| `nexus-tool.result` | `{task_id}` | `{task_id, status, result?, error?}` | 前端轮询；同时触发 GC |
| `nexus-tool.cancel` | `{task_id}` | `{task_id, status: "cancelling"}` | 设 cancel_event + 杀进程树 |
| `nexus-tool.ack` | `{task_id}` | `{task_id, acked: true}` | 前端收到结果后立即清理 |
| `app.settings.get` | `{}` | `{settings, defaults, path}` | 读 + 默认值合并 |
| `app.settings.set` | `{patch}` | `{settings, path}` | 部分更新 |
| `app.settings.reset` | `{}` | `{settings, path}` | 恢复默认 |

## 8. 诊断工具

`tools/diagnose_dcc_tool_run.py` —— 不经过 Tauri，直接走 sidecar 内的 nexus-tool RPC
handler，模拟前端"点击运行 → 轮询"全过程，打印 DEBUG 级别完整日志（websockets 协议、
MCP RPC、task 状态变化、最终结果）。

```cmd
python tools\diagnose_dcc_tool_run.py marketplace/<工具id>
python tools\diagnose_dcc_tool_run.py marketplace/<工具id> "{\"key\":\"value\"}"
```

任何 nexus-tool 跑不通的 bug，先用它复现，再决定改哪一层。

## 10. Python 依赖检查与自动安装

> **状态**：spec（2026-05-20），尚未实现。

### 10.1 问题背景

DCC 软件的 Python 环境（Blender bundled Python、Maya mayapy、UE Python 等）与用户
系统 Python 完全隔离。Nexus Tool 脚本可能依赖第三方库（如 `numpy`、`scipy`、
`Pillow`、`requests` 等），这些库在 DCC Python 环境中**默认不存在**。

当前工具运行流程**完全没有依赖检查**：
- 手动运行 → 子进程 `import numpy` 报错 → `ModuleNotFoundError` → 前端只看到
  `"success: false, error: No module named 'numpy'"` —— 用户无法自行修复
- 触发器运行 → DCC 进程内 `import numpy` 报错 → 工具静默失败 → 用户完全不知情

### 10.2 依赖声明格式

在 `manifest.json` 中新增 **`dependencies`** 字段（顶层，已预留：`_rpc_helpers.py` line 230）：

```jsonc
{
  "id": "marketplace/my-tool",
  // ... 其他已有字段 ...
  "dependencies": [
    "numpy>=1.21",
    "Pillow>=9.0",
    "requests"
  ]
}
```

**字段规范**：
| 规则 | 说明 |
|------|------|
| 格式 | 字符串列表，每个元素是 PEP 508 格式的包名（`"numpy>=1.21"`） |
| 空值 | `[]` 或字段不存在 → 不触发依赖检查 |
| 安装源 | `pip install`（从 `pypi.org`，未来可扩展企业内部 mirror） |
| 安装目标 | 当前工具的 Python 可执行文件对应的 `site-packages` |

#### 10.2.1 版本约束检查

除了 `importlib.import_module` 检查包是否可导入，还需验证已安装版本满足约束：

```python
import importlib, re, json

_PEP508_PAT = re.compile(
    r'^([A-Za-z0-9_.-]+)'          # package name
    r'\s*(([<>=!~]+)\s*([\w.*]+))?' # optional version constraint
    r'(\s*;\s*.*)?$'                # optional extras marker (ignored)
)

def _parse_dep(dep: str):
    """拆分 PEP 508 声明为 (pkg_name, op, version)"""
    m = _PEP508_PAT.match(dep)
    if not m:
        return dep, None, None
    return m.group(1), m.group(3), m.group(4)

def _check_version_satisfied(pkg_name: str, constraint: str, version: str) -> bool:
    """检查已安装版本是否满足约束。"""
    from packaging.version import Version, parse as parse_ver
    try:
        installed = parse_ver(version)
        if constraint == ">=":
            return installed >= parse_ver(constraint)
        elif constraint == ">":
            return installed > parse_ver(constraint)
        elif constraint in ("<=", "=<"):
            return installed <= parse_ver(constraint)
        elif constraint == "<":
            return installed < parse_ver(constraint)
        elif constraint in ("==", "="):
            return installed == parse_ver(constraint)
        elif constraint == "!=":
            return installed != parse_ver(constraint)
        return True
    except Exception:
        return False  # 解析失败保守拒绝

def _check_single_dep(dep: str) -> Optional[str]:
    """检查单个依赖。返回 None 表示满足，返回 dep 表示不满足。"""
    pkg_name, op, ver = _parse_dep(dep)
    try:
        mod = importlib.import_module(pkg_name)
    except ImportError:
        return dep  # 包未安装
    if op and ver:
        installed_ver = getattr(mod, "__version__", None)
        if installed_ver is None:
            # 无 __version__ → 无法验证 → 保守允许
            return None
        if not _check_version_satisfied(pkg_name, ver, installed_ver):
            return f"{dep}（已安装: {installed_ver}）"
    return None
```

**`packaging` 依赖**：`_check_version_satisfied` 使用标准库无 `packaging` 时降级为简单字符串比较，但推荐在依赖检查脚本中先 `pip install packaging`。后续开发中可改为纯字符串解析（避免循环依赖）。

### 10.3 手动运行流程（pre-flight check）

新的运行流程在**工具执行前**插入依赖检查步骤：

```
nexus-tool.run 请求
  │
  ├─ 1. 读取 manifest.dependencies
  ├─ 2. 若为空 → 跳过依赖检查 → 直接执行工具
  ├─ 3. 确定目标 Python 可执行文件
  │     ├─ 通用工具：sys.executable（sidecar 同版本 python）
  │     └─ DCC 工具：MCP Bridge → DCC 进程内检查（不启动外部 Python）
  ├─ 4. 逐个检查依赖（含版本约束，见 §10.2.1）
  │     └─ 记录缺失 / 版本不满足的包名列表
  ├─ 5. 若有缺失：
  │     ├─ 返回 task 状态 "dependency_missing"，携带 missing 列表
  │     ├─ 前端展示缺失列表 + [一键修复] [忽略并运行] [AI辅助运行]
  │     ├─ 用户点击"忽略并运行" → 重新调用 run({install_deps: false, force: true})
  │     └─ 用户点击"一键修复" → install-deps RPC → 重新运行
  └─ 6. 若全部满足：
        └─ 进入原有执行路径（§2 / §3）
```

步骤 4 的检测脚本（含版本约束检查）：

```python
# subprocess.run 调用，批量检查所有依赖
import_check = f'''
import importlib, json, sys

# 降级版版本检查：无 packaging 时只做包存在检查
_PEPS = {json.dumps(dependencies)}
missing = []
for dep in _PEPS:
    pkg = dep.split(">=")[0].split("==")[0].split("<=")[0].split(">")[0].split("<")[0].split("!=")[0].strip()
    try:
        mod = importlib.import_module(pkg)
        if ">=" in dep:
            ver = dep.split(">=")[1].strip()
            inst = getattr(mod, "__version__", None) or "0"
            if not inst >= ver:
                missing.append(dep + " (installed: " + inst + ")")
        elif "==" in dep:
            ver = dep.split("==")[1].strip()
            inst = getattr(mod, "__version__", None) or "0"
            if inst != ver:
                missing.append(dep + " (installed: " + inst + ")")
    except ImportError:
        missing.append(dep)
print(json.dumps({{"ok": len(missing)==0, "missing": missing}}))
'''
result = subprocess.run(
    [target_python, "-c", import_check],
    capture_output=True, text=True, timeout=30,  # 批量检查，30s 超时
)
```

**超时策略**（区分两种路径）：
| 路径 | 检查方式 | 超时 | 原因 |
|------|---------|------|------|
| 通用工具 subprocess | `subprocess.run` 启动外部 Python | 30s | 冷启动 + 多个 import 检查 |
| DCC 工具 MCP Bridge | DCC 进程内 `importlib` | 10s | 进程内 import，单个包 < 1s |
| 触发器 (importlib) | 进程内 `importlib` | 2s/包 | DCC 主线程不可阻塞 |

步骤 5 的代码更新：
```python
def _execute_general_tool(ntd, run_args, func_name, task_id=""):
    manifest = ntd.manifest or {}
    dependencies = manifest.get("dependencies", [])

    if dependencies:
        missing = _check_dependencies(ntd, target_python=sys.executable, dependencies)
        if missing:
            return _dependency_missing_result(task_id, missing)

    # ... 原有工具执行逻辑 ...

def _execute_general_tool_force(ntd, run_args, func_name, task_id=""):
    """忽略依赖检查，强制执行（force=true 调用）"""
    # 跳过 _check_dependencies，直接进入执行路径
    # ...
```

### 10.4 通用工具 subprocess 环境修复

通用工具每次以子进程运行，**可以在 wrapper 生成前进行依赖安装**：

```python
def _execute_general_tool(ntd, run_args, func_name, task_id=""):
    # ... 现有路径 ...
    manifest = ntd.manifest or {}
    dependencies = manifest.get("dependencies", [])

    if dependencies:
        # ── Pre-flight：检查 + 安装依赖 ──
        missing = _check_dependencies(ntd, target_python=sys.executable, dependencies)
        if missing:
            # 返回 dependency_missing 状态，交由前端处理（见 §10.7）
            return _dependency_missing_result(task_id, missing)

    # ... 原有工具执行逻辑 ...
```

**若用户点击"一键修复"，则在此路径中主动安装**：

```python
def _execute_general_tool_with_fix(ntd, run_args, func_name, task_id=""):
    manifest = ntd.manifest or {}
    dependencies = manifest.get("dependencies", [])

    if dependencies:
        # 安装缺失依赖
        for pkg in dependencies:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", pkg, "--quiet"],
                timeout=120,
            )
    # 继续原有执行路径
    return _execute_general_tool(ntd, run_args, func_name, task_id)
```

### 10.5 DCC 工具依赖检查（MCP 通道）

DCC 工具的依赖安装在 DCC Python 环境中，需要特殊处理：

```python
def _execute_dcc_tool(ntd, run_args, func_name):
    manifest = ntd.manifest or {}
    dependencies = manifest.get("dependencies", [])

    if dependencies:
        # ── 通过 MCP Bridge 在 DCC 进程内检查依赖 ──
        check_code = _generate_dep_check_code(dependencies)
        bridge = MCPBridgeClient.get_instance()
        check_result = bridge.call_tool("run_python", {"code": check_code}, timeout=30)

        if not check_result.get("success") or check_result.get("missing"):
            # 返回 dependency_missing 状态
            return _dependency_missing_result(task_id, check_result.get("missing", []))

    # ... 原有 exec 执行路径 ...
```

**DCC 内检查脚本**（通过 MCP run_python 在 Blender/Maya 内执行）：

```python
def _generate_dep_check_code(dependencies: List[str]) -> str:
    return f'''
import importlib, json
missing = []
for dep in {json.dumps(dependencies)}:
    pkg_name = dep.split(">=")[0].split("==")[0].split("<")[0].strip()
    try:
        importlib.import_module(pkg_name)
    except ImportError:
        missing.append(dep)
print(json.dumps({"success": len(missing)==0, "missing": missing}))
'''
```

**DCC 内一键修复**：通过 MCP run_python 调用 `pip._internal.main` 或 `subprocess.run`：

```python
# 在 DCC Python 进程中执行 pip install
def _generate_dep_install_code(dependencies: List[str]) -> str:
    return f'''
import subprocess, sys, json
pkgs = {json.dumps(dependencies)}
try:
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install"] + pkgs + ["--quiet"],
        capture_output=True, text=True, timeout=300,
    )
    print(json.dumps({"success": result.returncode==0, "stdout": result.stdout, "stderr": result.stderr}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
'''
```

**注意**：如果 DCC 的 bundled Python 没有 `pip` 模块，需使用 `ensurepip` 引导。

### 10.6 RPC 扩展

**`_nt_data_to_dict` 序列化更新**（`_rpc_helpers.py`）：

需在 `_nt_data_to_dict()` 返回值中新增 `dependencies` 字段：
```python
result = {
    # ... 现有字段 ...
    "dependencies": manifest.get("dependencies", []),  # ← 新增
}
```

**`installer.py` manifest safe keys**：`update_nexus_tool` 的 manifest 安全字段列表需加入 `"dependencies"`。

新增 RPC 方法：

| Method | params | result | 说明 |
| --- | --- | --- | --- |
| `nexus-tool.check-deps` | `{id}` | `{all_ok: bool, missing: [...]}` | 只检查依赖，不运行工具 |
| `nexus-tool.run` | `{id, args, install_deps?: bool, force?: bool}` | `{task_id, status}` | 现有方法；新增 `install_deps`（安装后运行）和 `force`（跳过依赖检查） |
| `nexus-tool.install-deps` | `{id}` | `{success, installed, errors}` | 安装指定工具的依赖 |

**`nexus-tool.run` 的 status 扩展**：

| status | 含义 |
| --- | --- |
| `"started"` | 已启动（依赖检查通过） |
| `"dependency_missing"` | 依赖缺失，携带 `missing` 列表 |
| `"installing_deps"` | 正在安装依赖（`install_deps=true` 时） |

**`nexus-tool.result` 的 result 扩展**：

```jsonc
// 依赖缺失时
{
  "task_id": "abc-123",
  "status": "dependency_missing",
  "missing_deps": ["numpy>=1.21", "Pillow>=9.0"],
  "message": "2 个 Python 依赖缺失"
}

// 安装完成后
{
  "task_id": "abc-123",
  "status": "done",
  "result": { "success": true, "data": {...} },
  "deps_installed": ["numpy", "Pillow"]
}
```

### 10.7 前端 RunPanel 展示

在 RunPanel 运行结果区域（`RunPanel.tsx` line 362-386），新增依赖缺失状态呈现：

```
┌─────────────────────────────────────┐
│ ⚠ 依赖缺失                          │
│                                     │
│ 工具运行前发现 2 个 Python 依赖缺失： │
│  ┌───────────────────────────────┐  │
│  │ 📦 numpy>=1.21    ⬜ 未安装   │  │
│  │ 📦 Pillow>=9.0    ⬜ 未安装   │  │
│  └───────────────────────────────┘  │
│                                     │
│  [🔧 一键修复] [⚠ 忽略并运行]       │
│  [🤖 AI 辅助运行]                   │
│                                     │
│  💡 一键修复失败？试试 AI 辅助运行   │
└─────────────────────────────────────┘
```

**交互流程**：
1. 用户点击工具卡片上的「▶ 运行」
2. 右侧 RunPanel 显示依赖缺失列表
3. 用户选择：
   - 「🔧 一键修复」→ 调用 `nexus-tool.install-deps` → 安装完成提示重新运行
   - 「⚠ 忽略并运行」→ 调用 `nexus-tool.run({force: true})` → 跳过检查强制执行
   - 「🤖 AI 辅助运行」→ 切换到 Chat 界面，让 AI 处理
4. 如果一键修复失败 → 仍显示错误 + [忽略并运行][AI辅助运行]

**UI 状态枚举**（RunPanel 新增依赖相关状态）：

| 状态 | 显示 |
|------|------|
| `checking_deps` | 依赖检查中...（Loader2 动画） |
| `deps_ok` | 依赖就绪 → 进入执行 |
| `deps_missing` | 显示缺失列表 + [一键修复][AI辅助运行] |
| `installing` | 安装中...（带进度指示） |
| `install_success` | 安装完成 ✓ → 提示用户重新运行 |
| `install_failed` | 安装失败 ✗ → 显示错误详情 + [AI辅助运行] |

### 10.8 应用设置

新增 `app.settings` 字段：

| 字段 | 类型 | 默认 | 用途 |
| --- | --- | --- | --- |
| `nexusToolAutoInstallDeps` | bool | `false` | 运行时是否自动安装缺失依赖（无需用户确认） |
| `nexusToolPipMirror` | string | `""` | pip 安装镜像源（为空时使用默认 PyPI） |

**安全性考虑**：
- 默认 `nexusToolAutoInstallDeps = false` —— 用户需手动确认
- pip 安装只限 `manifest.dependencies` 声明的包，不随意安装
- 安装日志完整记录到 sidecar 日志

### 10.9 触发器路径（Sidecar TriggerDispatcher）

在 `sidecar/trigger_dispatcher.py` 的 `_execute_tool()` 中新增依赖检查：

```python
def _execute_tool(self, tool_id: str, payload: dict) -> dict:
    reg = self._tool_registry.get(tool_id)
    manifest = reg["manifest"]
    dependencies = manifest.get("dependencies", [])

    if dependencies:
        # 通用工具：sidecar Python 环境
        # DCC 工具：需要 MCP Bridge 在 DCC 内检查
        missing = self._check_and_resolve_deps(tool_id, manifest, dependencies)
        if missing:
            logger.warning("[Trigger] dependencies missing: %s", missing)
            return {
                "tool_id": tool_id,
                "action": "error",
                "reason": f"依赖缺失，请手动修复: {', '.join(missing)}",
                "missing_deps": missing,
            }
    # ... 原有执行逻辑 ...
```

**触发器自动安装**（当 `nexusToolAutoInstallDeps = true` 时）：

```python
def _auto_install_deps(self, tool_id, dependencies):
    for pkg in dependencies:
        logger.info("[Trigger] installing dep: %s", pkg)
        subprocess.run(
            [sys.executable, "-m", "pip", "install", pkg, "--quiet"],
            timeout=120,
        )
```

**DCC 本地 TriggerDispatcher**（Blender trigger_dispatcher.py）的类似处理：
- 检查依赖在 Blender Python 进程内完成（`importlib.import_module`）
- 安装依赖通过 `subprocess.run([sys.executable, "-m", "pip", ...])`
- 若 Blender Python 无 pip → 先 `ensurepip` → 再 `pip install`

### 10.10 不变量（新增）

在修这块代码前必须保证：

1. **依赖检查不能阻塞工具执行主路径**——超时 10s、失败降级为跳过检查
2. **pip install 必须在正确的 Python 环境中**——通用工具用 `sys.executable`，DCC 工具用 DCC 的 Python
3. **安装失败不阻止工具尝试运行**——用户可手动忽略依赖问题
4. **依赖列表必须从 manifest 读取**——不允许运行时动态推断（安全 + 确定性）
5. **触发器自动安装只读 `nexusToolAutoInstallDeps` 设置**——未开启则不安装

---

## 9. 不变量（修这块代码前必须保证）

1. **通用工具子进程绝不用 `text=True`**——见 §2.1。
2. **`_execute_dcc_tool` 注入 `_nexus_tool_args` 用 `_python_literal()`，绝不用 `json.dumps()`**——见 §3.2。
3. **`_async_connect` 在 `create_task(_message_reader)` 之前**必须把 `_ws / _connected / _response_queue` 都设上——见 §3.3。
4. **`_message_reader` finally 推 sentinel 时不带 `was_connected` 守卫**——避免 race 漏推。
5. **`_kill_process_tree` 必须在 cancel / timeout 两条路径都调**，Windows 下尤其。
6. **`_task_store` 写入必须持锁**；GC 不能在持锁的代码块里递归调用（旧版死锁过）。

---

## 参考

- 历史修复合集：[[../changelog/2026-05-19-nexus-tool-run-fixes]]
- 桥接层 spec：[[openclaw-wrapper-runtime]] §"sidecar"
- Skill 子系统总览：[[skill-system]]
- ArtClaw 端类似实现对比：`d:/MyProject_D/artclaw_bridge/subprojects/ArtClawToolManager/src/server/api/tools.py::_execute_locally`
