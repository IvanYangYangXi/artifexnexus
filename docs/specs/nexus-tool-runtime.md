---
tags: [spec, openclaw, nexus-tool, runtime, sidecar, mcp]
created: 2026-05-19
status: stable
related: [[nexus-tool-direct-run-async]], [[openclaw-wrapper-runtime]], [[skill-system]]
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
