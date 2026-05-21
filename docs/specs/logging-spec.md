---
tags: [spec, logging, standards]
created: 2026-05-13
status: draft
---

# 日志规范

> 统一全项目（Python / TypeScript / Rust）的日志级别、格式、前缀约定和必须埋点的关键节点类型。

## 1. 日志级别定义

| 级别 | Python | TypeScript | 语义 | 使用场景 |
|------|--------|-----------|------|---------|
| **ERROR** | `logger.error()` / `logger.exception()` | `console.error()` | 影响功能的错误，需人工介入 | 外部调用失败、数据损坏、崩溃恢复 |
| **WARN** | `logger.warning()` | `console.warn()` | 非预期但可自愈的情况 | 重试成功、配置降级、超时恢复 |
| **INFO** | `logger.info()` | `console.info()` / `console.log()` | 关键生命周期和状态变更 | 服务启停、连接建立/断开、关键操作完成 |
| **DEBUG** | `logger.debug()` | `console.debug()` | 诊断信息，生产环境默认关闭 | 函数入参/出参、中间状态、分支决策 |

## 2. 日志前缀约定

每条日志必须带方括号前缀，标明来源模块：

### Python

```python
logger = logging.getLogger(__name__)
# 输出示例: [artifex_nexus.openclaw_wrapper.runtime] gateway started pid=12345
```

Python 的 `logging` 模块自动包含 logger 名称，配置 formatter 为：
```
[%(name)s] %(levelname)s %(message)s
```

### TypeScript

手写前缀，格式 `[模块短名]`：

| 模块 | 前缀 | 示例 |
|------|------|------|
| `gateway-ws.ts` | `[gateway-ws]` | `console.log("[gateway-ws] Handshake complete in 1.2s")` |
| `chat-service.ts` | `[chat-service]` | `console.log("[chat-service] delta: session=abc text=512B")` |
| `persistence.ts` | `[persistence]` | `console.error("[persistence] IndexedDB open failed: ", err)` |
| `AppShell.tsx` | `[AppShell]` | `console.info("[AppShell] gateway ready after 3 retries")` |
| `ChatView.tsx` | `[ChatView]` | `console.warn("[ChatView] 拒绝非法 sessionKey:", key)` |
| `ChatControlBar.tsx` | `[ChatControlBar]` | `console.warn("[ChatControlBar] sessions load failed:", err)` |
| `SettingsPage.tsx` | `[Settings]` | `console.error("[Settings] config save failed:", err)` |
| `SystemPage.tsx` | `[System]` | `console.warn("[System] doPoll failed:", err)` |
| `ChatMessageList.tsx` | `[ChatMessageList]` | `console.warn("[ChatMessageList] 消息渲染失败:", err)` |

### Gateway Plugin (Node.js)

前缀 `[mcp-bridge]`（已有，保持）：

```typescript
logger.info(`[mcp-bridge] tool execute: ${serverName}/${toolName}`);
logger.warn(`[mcp-bridge] tool called against disconnected server: ${serverName}`);
logger.error(`[mcp-bridge] tool call failed: ${serverName}/${toolName}`, err);
```

## 3. 必须埋点的关键节点

### 3.1 生命周期节点（必须 INFO）

| 节点类型 | 示例 |
|---------|------|
| 服务/进程启动 | `gateway started pid=12345 port=19789` |
| 服务/进程停止 | `gateway stopped (reason=requested)` |
| 连接建立 | `connected to MCP server blender at ws://127.0.0.1:18083` |
| 连接断开 | `disconnected from MCP server (code=1006)` |
| 会话创建/销毁 | `session created key=abc123`, `session deleted key=abc123` |
| 插件/模块加载 | `plugin registered: mcp-bridge v1.2.3` |

### 3.2 关键操作节点（必须 INFO）

| 节点类型 | 示例 |
|---------|------|
| 工具调用入口/出口 | `tool execute: blender/run_python params=256B` / `tool done: blender/run_python latency=1.2s` |
| 消息发送/接收 | `chat.send: session=abc text=512B` / `delta received: session=abc chunk=128B` |
| 配置变更 | `config patched: gateway.port 19789→19790` |
| 安装/部署操作 | `installing OpenClaw v2026.5.4 to ~/.artifexnexus/.openclaw/` |

### 3.3 错误处理节点（必须 ERROR 或 WARN）

| 规则 | 说明 |
|------|------|
| **禁止静默 `catch`** | 所有 `catch` 块必须输出日志或显式传播异常 |
| **禁止 `except Exception: pass`** | 至少 `logger.debug()` 一条消息 |
| **`logger.exception()`** | Python 中捕获异常时优先用 `logger.exception()` 输出完整堆栈 |
| **错误上下文** | 错误日志必须包含足够上下文（哪个操作、关键参数、错误消息） |

### 3.4 外部调用节点（必须 DEBUG 以上）

| 调用类型 | 至少记录 |
|---------|---------|
| HTTP 请求 | URL、方法、状态码、耗时 |
| WebSocket 消息 | 方向（收/发）、类型、大小 |
| subprocess 启动 | 命令、PID、工作目录 |
| 文件 I/O | 路径、操作类型（读/写）、文件大小 |

### 3.5 分支决策节点（必须 DEBUG）

| 决策类型 | 示例 |
|---------|------|
| 功能降级 | `fallback: using default port 19789 (config unreadable)` |
| 重试/退避 | `reconnect attempt 3/5 delay=8s` |
| 配置无效跳过 | `skipping server 'xxx': invalid type (not websocket)` |
| 状态转换 | `wsState: connected → degraded` |

## 4. 日志内容规范

- **包含关键参数**：不止说"操作失败"，要包括操作名 + 参数摘要 + 错误消息
- **包含耗时**：关键操作记录开始和结束时间差
- **敏感信息脱敏**：Token、密钥只输出前 4 位 + `...`
- **避免日志洪水**：高频路径（如心跳）用 DEBUG 级别；批量操作汇总后一条 INFO
  - **重连场景**：DCC 离线时的重连循环是典型洪水源。采用"前 N 次正常日志 + 之后静默重试 + 连接成功计数器归零"的抑制策略。详见 `[[../sdk/mcp-bridge]]` §重连策略与日志抑制
- **中文描述 + 英文 key**：日志可搜索性优先，关键字段用英文 key（如 `pid=`, `port=`, `session=`）

## 5. 反例

### ❌ 禁止的模式

```python
# 反例 1: 静默吞异常
try:
    config = json.load(f)
except Exception:
    pass  # 永远不要这样！

# 反例 2: 日志无上下文
logger.error("failed")  # 什么失败？为什么？

# 反例 3: 错误不记录
except Exception as e:
    return {"ok": False, "error": str(e)}  # 返回给调用方但自己不记日志
```

```typescript
// 反例 4: catch 块静默
try {
  await loadSessions();
} catch {
  // 什么也不做，用户看到空列表却不知道为什么
}

// 反例 5: 工具调用无日志
async execute({ toolName, params }: ToolCall) {
  return await client.callTool(toolName, params);
  // 没有入口日志、没有出口日志、没有错误日志 — 完全黑盒
}
```

### ✅ 正确的模式

```python
# 正确 1: 记录异常并传播
try:
    config = json.load(f)
except json.JSONDecodeError as e:
    logger.warning("config parse failed, falling back to defaults: %s", e)
    config = DEFAULT_CONFIG

# 正确 2: 带上下文的错误日志
logger.error("gateway start failed: cmd=%s exit_code=%d stderr=%s", cmd, rc, err)

# 正确 3: 函数入口/出口
def install_openclaw(target_dir: Path) -> InstallResult:
    logger.info("installing OpenClaw to %s", target_dir)
    try:
        _do_install(target_dir)
        logger.info("OpenClaw installed successfully: version=%s", version)
        return InstallResult(ok=True)
    except Exception:
        logger.exception("OpenClaw install failed")
        return InstallResult(ok=False, error=str(e))
```

```typescript
// 正确 4: 带上下文的异步操作
async function loadSessions() {
  try {
    const sessions = await persistence.loadAllSessions();
    console.log(`[ChatControlBar] sessions loaded: count=${sessions.length}`);
    return sessions;
  } catch (err) {
    console.warn("[ChatControlBar] sessions load failed:", err);
    return [];
  }
}

// 正确 5: 工具调用的完整日志链路
async execute({ _id, toolName, params }: ToolCall) {
  console.log(`[mcp-bridge] tool execute: ${serverName}/${toolName} id=${_id} params=${paramsSize}B`);
  try {
    const result = await client.callTool(toolName, params);
    console.log(`[mcp-bridge] tool done: ${serverName}/${toolName} id=${_id} latency=${latency}ms`);
    return result;
  } catch (err) {
    console.error(`[mcp-bridge] tool failed: ${serverName}/${toolName} id=${_id}`, err);
    throw err;
  }
}
```

## 6. 各模块日志覆盖自检清单

Agent 编写或修改代码时必须自检：

- [ ] 所有 `try/catch` 或 `try/except` 块是否都有日志输出？
- [ ] 所有公共函数入口是否有 INFO 日志（或明确不需要的理由）？
- [ ] 所有外部调用（HTTP/WS/subprocess/文件 I/O）是否有日志？
- [ ] 所有状态变更（连接断开、服务重启、配置变更）是否有日志？
- [ ] 关键用户操作（发送消息、工具调用、配置保存）是否有日志？
- [ ] 错误日志是否包含足够的上下文信息？
- [ ] 是否有 `except Exception: pass` 或空 `catch {}` 的静默吞异常？

## 相关

- [[../../.ai/rules/50-logging-standards]] — AI 执行规则
- [[../../.ai/rules/30-agent-behavior]] — Agent 行为准则
- [[../../.ai/rules/10-coding-style]] — 编码规范
