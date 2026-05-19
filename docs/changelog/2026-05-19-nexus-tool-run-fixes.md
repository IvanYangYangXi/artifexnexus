---
tags: [changelog, bugfix, sidecar, nexus-tool, mcp-bridge, blender]
created: 2026-05-19
severity: critical
affects: [packages/adapters/openclaw, apps/desktop]
spec: [[../specs/nexus-tool-runtime]]
---

# 2026-05-19 Nexus-Tool 运行流程修复合集

> 一次 session 内连续定位并修复 **6 个独立 bug**，把"工具点击运行"端到端跑通：
> 通用工具（official/marketplace 的 Python 脚本）+ DCC 工具（Blender / Maya / UE 内 exec）
> 全部可用。修复后端到端时延约 0.7s（DCC 工具）/ 5s（通用工具，含 Python cold start）。
>
> 修复后落地的权威 spec：[[../specs/nexus-tool-runtime]]。

## 触发场景

用户报告：

1. 通用工具运行报错 `TypeError("object of type 'NoneType' has no len()")`
2. DCC（blender）工具报错 `received 1001 (going away) Server shutting down; then sent 1001`
3. DCC 工具点击后**一直转圈**，task 永远 running
4. DCC 工具报错 `ModuleNotFoundError: No module named 'artifex_nexus_sdk'`
5. DCC 工具报错 `NameError: name '__file__' is not defined`
6. DCC 工具报错 `NameError: name 'false' is not defined`

每个症状对应一个独立的根因。这次 session 把它们全部修完，并把易踩坑的设计约束沉淀到
spec 不变量章节。

## 修复一览表

| # | 症状 | 真正根因 | 修复处 |
| --- | --- | --- | --- |
| 1 | `len(NoneType)` + GBK 解码崩 | Windows `text=True` 让 reader 线程按 GBK 解码工具的 UTF-8 输出，reader 死掉后 `communicate()` 返回 `(None, None)` | `nexus_tool_rpc._execute_general_tool` 改 bytes 管道 + UTF-8 三重保险 |
| 2 | "received 1001 going away" 直接吐给前端 | `call_tool` 不重连：旧 ws 已死但 `_connected=True`，一 send 就拿到 ConnectionClosedOK | `mcp_bridge.call_tool` 拆 `_call_tool_once` + `_classify_exception` + 自动重连重试 |
| 3 | DCC 工具"一直转圈" | `_async_connect` 在 `create_task(_message_reader)` 之前**还没设** `_connected=True`，reader 启动即退出；`finally` 又用 `if was_connected` 守卫导致 sentinel 漏推 | `_async_connect` 状态设值时序调整 + `_message_reader` finally 去守卫 |
| 4 | `ModuleNotFoundError: artifex_nexus_sdk` | `_execute_dcc_tool` 的 `injected_code` 不注入 `sys.path`，DCC 进程没办法 import SDK | injected_code 头部加 `sys.path.insert(tool_dir, sdk_parent)` |
| 5 | `NameError: '__file__'` | Blender `run_python` 走 `exec(code, ns)`，`__file__` 默认不存在 | injected_code 显式设 `__file__ = "<main.py 绝对路径>"` |
| 6 | `NameError: 'false'` | `json.dumps(args)` 出 `false`/`true`/`null` 是合法 JSON，但**不是合法 Python 字面量** | 新增 `_python_literal()`（`repr() + ast.literal_eval` 双向校验），injected_code 用它替代 `json.dumps` |

## 附带优化（同一 session 落地）

| # | 优化 | 文件 |
| --- | --- | --- |
| A | 临时 wrapper 写到 `tempfile.mkdtemp` 而非工具源码目录（不污染只读官方目录、并发安全） | `_execute_general_tool` |
| B | 结果协议：`===NEXUS_RESULT_BEGIN===` / `===NEXUS_RESULT_END===` marker，向后兼容退回旧"最后一行 JSON" | wrapper + `_parse_tool_stdout` |
| C | 超时三级回退：`manifest.implementation.timeout` > `app.settings.nexusToolDefaultTimeoutSec` > 120s | `_resolve_timeout` |
| D | 并发上限可在设置页配置：`app.settings.nexusToolMaxConcurrent` | `_resolve_max_concurrent` |
| E | `_task_store` 5 分钟 TTL GC，在 run/result 入口主动触发 | `_cleanup_expired_tasks` |
| F | cancel 走 `_kill_process_tree`（Windows `taskkill /F /T` / POSIX `killpg(SIGKILL)` / 优先 psutil） | `_kill_process_tree` |
| G | DCC 工具异常上报带 `error_type` + `traceback`，前端能直接看堆栈 | injected_code except 分支 |
| H | 新增 `app_settings` 模块 + 3 个 RPC（get/set/reset）+ 原子写 + 缓存 + 损坏自动备份 | `app_settings.py` |
| I | 前端设置页改写为分页（"常规" + "关于"），含保存 / 重置 / 丢弃修改 / 持久化路径展示 | `routes/Settings.tsx` |
| J | Tauri Commands 透传 3 个 app.settings RPC | `commands/app_settings.rs` |
| K | 新增前端 IPC 包装 + AppSettings TypeScript 类型 | `ipc/app_settings.ts` |
| L | 新增端到端诊断脚本，模拟前端运行流程 | `tools/diagnose_dcc_tool_run.py` |

## 关键根因详解

### 根因 1：Windows `text=True` reader 线程死锁连锁

```python
# 旧版（错误）
proc = Popen([...], text=True, stdout=PIPE, stderr=PIPE)
stdout, stderr = proc.communicate(input=json.dumps(args), timeout=120)
len(stdout)   # ← stdout 可能是 None
```

Windows 中文 locale 下 `text=True` 让 Python 内部 reader 线程按
`locale.getpreferredencoding()` (= GBK) 解码。工具 `print("中文")` 输出
UTF-8 字节 → reader 抛 `UnicodeDecodeError` → 线程退出 → `communicate()`
对应那路返回 `None` 而不是字符串 → `len(None)` 崩。

**修复**：bytes 管道 + UTF-8 三重保险（`-X utf8` + `PYTHONIOENCODING` +
`PYTHONUTF8` + wrapper 内 `reconfigure`）。

### 根因 3：MCP Bridge reader 启动时序竞态

```
旧 _async_connect 末尾：                旧 connect() 末尾：
  ...                                     future = run_coroutine_threadsafe(_async_connect)
  self._response_queue = Queue()          self._ws = future.result()      ← 太晚
  self._reader_task = create_task(reader) self._connected = True          ← 太晚
                                          (reader 已经先看到 _connected=False 然后 break 退出)
```

Reader 第一次 `while self._connected and self._ws:` 条件为 `False/None`，
直接 `break` 进 `finally`。`finally` 又用了 `if was_connected` 守卫
（此时 `was_connected = self._connected = False`），sentinel **没推**。

后续 `_async_call_tool` 在空 queue 上 `await get()`——永远等不到响应，
Blender server 端响应回来（27ms 内）但**没人 recv**，躺在 websocket 内部缓冲区。
前端轮询永远拿到 `status=running` → "一直转圈"。

**修复**：

1. `_async_connect` 先设状态后 `create_task`：

```python
# 必须按这个顺序
self._ws = ws
self._connected = True
self._response_queue = _asyncio.Queue()
self._reader_task = _asyncio.create_task(self._message_reader())
```

2. `_message_reader.finally` 去掉 `was_connected` 守卫，**只要 queue 还在就推 sentinel**。

### 根因 6：JSON 字面量 ≠ Python 字面量

```python
# 旧版（错误）
injected_code = f"_nexus_tool_args = {json.dumps(run_args)}"
# 当 run_args = {"skip_default_names": False}：
# injected_code 实际内容：
#   _nexus_tool_args = {"skip_default_names": false}
#                                              ^^^^^ NameError in Python
```

JSON 的 `false`/`true`/`null` 对应 Python 的 `False`/`True`/`None`。
直接把 JSON 字符串当 Python 代码 exec 一定炸。

**修复**：新增 `_python_literal()`，用 `repr() + ast.literal_eval` 双向校验
保证输出既是合法 Python 字面量、又只能是字面量（防 RCE）。fallback 走
`json.dumps + 正则替换 true/false/null`。

```python
def _python_literal(obj):
    try:
        text = repr(obj)
        ast.literal_eval(text)   # ← 反向解析校验
        return text
    except Exception:
        text = json.dumps(obj, ensure_ascii=False, default=str)
        text = re.sub(r"\btrue\b", "True", text)
        text = re.sub(r"\bfalse\b", "False", text)
        text = re.sub(r"\bnull\b", "None", text)
        return text
```

## 文件改动清单

### Python（sidecar）

| 文件 | 改动类型 |
| --- | --- |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/nexus_tool_rpc.py` | 大改 `_execute_general_tool` + `_execute_dcc_tool`；新增 `_parse_tool_stdout` / `_resolve_timeout` / `_resolve_max_concurrent` / `_kill_process_tree` / `_python_literal`；`_cleanup_expired_tasks` 线程安全化；cancel 走进程树 |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/mcp_bridge.py` | `_async_connect` 状态设值时序修复；`_message_reader` finally 去守卫；`call_tool` 拆 `_call_tool_once` + 加自动重连重试；新增 `_classify_exception` / `_is_connection_failure` |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/app_settings.py` | **新增**：get/set/reset RPC，原子写，5s 缓存，损坏备份 |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py` | 注册 `APP_SETTINGS_METHODS` |

### Rust / 前端

| 文件 | 改动类型 |
| --- | --- |
| `apps/desktop/src-tauri/src/commands/app_settings.rs` | **新增** 3 个 Tauri commands |
| `apps/desktop/src-tauri/src/commands/mod.rs` | 注册 `app_settings` 模块 |
| `apps/desktop/src-tauri/src/lib.rs` | `invoke_handler` 注册 3 个 commands |
| `apps/desktop/src/ipc/app_settings.ts` | **新增** IPC 包装 + AppSettings interface |
| `apps/desktop/src/routes/Settings.tsx` | 重写为分页：常规（4 个字段 + 持久化路径）+ 关于 |

### 工具

| 文件 | 改动类型 |
| --- | --- |
| `tools/diagnose_dcc_tool_run.py` | **新增**：端到端复现脚本，绕过 Tauri 直接走 sidecar RPC |

## 验证

### 自动化

- `python -c "import ast; ast.parse(...)"` —— 3 个 Python 文件语法 OK
- `pnpm typecheck` —— TypeScript OK
- `cargo check` —— Rust OK
- `python tools/diagnose_dcc_tool_run.py` —— 端到端跑通 2 个工具（改名 + 命名检查）

### 端到端结果

**改名工具** `marketplace/Example-Blender-模型批量加前缀后缀`：

```
[poll #1] running   0.2s
[poll #2] done      0.7s
{"renamed_count": 1, "renamed_objects": [{"old": "Cube", "new": "sm_Cube"}]}
```

**命名检查工具** `marketplace/Example-Blender对象命名规范检查`（含 boolean 参数）：

```
[poll #1] running   0.2s
[poll #2] done      0.7s
{"total": 3, "violations": [
  {"name": "Cuesf", "type": "MESH", "reason": "缺少规范前缀..."},
  {"name": "Light", "type": "LIGHT", ...},
  {"name": "Camera", "type": "CAMERA", ...}
]}
```

## 构建与发布

按 [[../../.ai/rules/40-build-and-release]]：

- Python 改动**不需要** `pnpm tauri build`，dev/prod 重启 sidecar 即生效；
- 前端 + Tauri 改动**必须** `pnpm tauri build`，并在 PR/release 描述里贴出
  `target/release/bundle/` 下 `.exe` / `.msi` 的大小与时间戳。

## 影响面与回滚

| 项 | 评估 |
| --- | --- |
| 向后兼容 | ✅ 所有改动对**工具脚本零侵入**，老脚本无需任何修改 |
| RPC 协议 | ✅ 完全兼容，仅新增 `app.settings.*` 三个方法 |
| 数据迁移 | ✅ `app-settings.json` 不存在时返回默认值，不主动创建 |
| 回滚 | 单文件回滚即可（每条 bug 修复都在独立函数里） |

## 参考

- 权威 spec：[[../specs/nexus-tool-runtime]]
- 相关历史 spec：[[../specs/nexus-tool-direct-run-async]]
- ArtClaw 类似实现对比：`d:/MyProject_D/artclaw_bridge/subprojects/ArtClawToolManager/src/server/api/tools.py`
- 触发器路径的 SDK 注入参考实现：`packages/dcc/blender/.../trigger_dispatcher.py::_load_tools`
