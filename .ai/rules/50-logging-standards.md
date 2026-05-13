# 日志埋点强制规则（AI 写代码必读）

> 基于 2026-05-13 全项目日志审计（`docs/specs/logging-spec.md`）制定的 AI 强制执行规则。

## 强制要求

### 1. 零静默 catch 原则

**任何 `catch` / `except` 块不得为空。** 最简形式：

```python
# ✅ 最低要求
except Exception:
    logger.debug("non-critical operation failed, continuing", exc_info=True)
```

```typescript
// ✅ 最低要求
} catch (err) {
  console.debug("[module] non-critical operation failed:", err);
}
```

**禁止**：

```python
except Exception:
    pass          # ❌ 永远禁止
```

```typescript
} catch {
  // ❌ 永远禁止空 catch
}
```

### 2. 公共函数入口日志

每个公共函数（被其他模块调用的函数）的 **关键路径** 必须记录 INFO 级别入口日志：

```python
def install_openclaw(target_dir: Path) -> InstallResult:
    logger.info("installing OpenClaw to %s", target_dir)  # ✅
```

```typescript
export async function switchSession(key: string) {
  console.log(`[ChatView] switchSession: ${key}`);  // ✅
}
```

**例外**：纯 getter、纯数据转换函数、渲染组件可省略。

### 3. 外部调用日志

以下外部调用类型必须记录日志：

| 调用类型 | Python | TypeScript |
|---------|--------|-----------|
| subprocess | `logger.info("spawning: %s", cmd)` | N/A（由 sidecar 处理） |
| HTTP 请求 | `logger.debug("GET %s → %d (%dms)", url, status, ms)` | `console.debug("[module] fetch: url status=code")` |
| WebSocket 消息 | `logger.debug("ws send: %s", msg_type)` | `console.debug("[module] ws send: type payload=B")` |
| 文件 I/O | `logger.debug("writing %d bytes to %s", n, path)` | N/A |

### 4. 状态变更日志

以下状态变更必须 INFO 级别日志：

- 服务/进程启动与停止
- 连接建立与断开（含断开原因码）
- 会话创建/删除
- 配置修改
- 功能降级（degraded / fallback）
- 重连重试（含重试次数和延迟）

### 5. 错误必须 `console.error` / `logger.error`

返回给用户的错误消息 **不等于** 开发诊断日志。错误处理必须：

1. **先 `logger.error()` / `console.error()` 记录**（带错误对象和上下文）
2. **再** 构建用户可见的错误提示

```python
# ✅ 正确
except Exception as e:
    logger.exception("gateway start failed: cmd=%s", cmd)
    return {"ok": False, "error": str(e)}

# ❌ 错误：只返回不记录
except Exception as e:
    return {"ok": False, "error": str(e)}
```

### 6. 异步操作必须日志

所有 `async` 函数的关键路径必须有日志——异步调用栈难以追踪，日志是唯一的诊断手段。

### 7. 提交前自检（追加到 `.ai/rules/30-agent-behavior.md` 的自检清单）

- [ ] 新增/修改的 `try/catch` 或 `try/except` 块是否都有日志？
- [ ] 新增/修改的公共函数是否有关键入口日志？
- [ ] 新增/修改的外部调用（HTTP/WS/subprocess/文件 I/O）是否有日志？
- [ ] 是否存在 `except Exception: pass` 或空 `catch {}`？（必须为零）
- [ ] 错误日志是否包含了足够的上下文（操作名 + 关键参数 + 错误消息）？

## 相关

- [[../../docs/specs/logging-spec]] — 日志规范全文
- [[30-agent-behavior]] — Agent 行为准则（含更新后的自检清单）
