# 连接状态感知

## 统一查询 API（Sidecar RPC）

### 全部 DCC 列表查询
调用 `openclaw.dcc.connections.list`（无需参数），返回所有已注册 DCC 的连接状态：

```json
{
  "gatewayOnline": true,
  "dccs": {
    "blender": {
      "dcc": "blender",
      "displayName": "Blender",
      "port": 18083,
      "address": "ws://127.0.0.1:18083",
      "serverRunning": true,
      "mcpConnected": true,
      "error": null
    },
    "unreal_engine": { "...": "..." },
    "maya": { "...": "..." },
    "3ds_max": { "...": "..." },
    "houdini": { "...": "..." }
  },
  "summary": {
    "total": 5,
    "online": 1,
    "listening": 1
  },
  "cached": false
}
```

字段说明：
- `gatewayOnline`：Gateway 是否在运行
- `dccs.<name>.serverRunning`：DCC 进程是否在监听端口（TCP 探测）
- `dccs.<name>.mcpConnected`：MCP 握手是否成功（WebSocket + MCP initialize）
- `summary.online`：mcpConnected=true 的 DCC 数量
- `summary.listening`：serverRunning=true 的 DCC 数量
- `cached`：结果是否来自缓存（5s TTL），避免连续探测

### 单个 DCC 详细查询
`openclaw.dcc.connections.status`，参数 `{"dcc": "blender"}`，额外返回：
- `status`：`"connected"` / `"listening"` / `"offline"`
- `statusLabel`：中文状态描述

### 刷新（跳过缓存）
`openclaw.dcc.connections.refresh`，强制重新探测所有 DCC。

### 事件日志
`openclaw.dcc.connections.events`，参数 `{"limit": 20}`，返回最近的连接状态变更记录。

---

## 辅助检测方式

### Gateway 在线状态
- `gateway_health_check` → TCP 连通性 + WebSocket 握手 + 配置
- `gateway_ping` → 3 次 TCP 延迟测量
- `gateway_sessions` → 活跃会话列表

### UE 编辑器状态（仅 UE 支持）
`mcp_unreal_run_python` 设置 `get_context=true`，返回 active_panel / selected / mode / total_actors。

---

## 最佳实践

当需要判断 DCC 连接状态时：
1. **首选** `openclaw.dcc.connections.list` 或 `.status`（统一 API，一次调用覆盖所有 DCC）
2. **需要最新状态** → 调 `.refresh`（跳过缓存）
3. **需要验证某个 DCC 是否真的可操作** → 调对应 run_python 空操作

对用户询问"XX 软件是否连上了"时：
1. 调 `openclaw.dcc.connections.status({"dcc": "blender"})`
2. 如果 `status="connected"` → "已连接，可以操作"
3. 如果 `status="listening"` → "端口监听中但 MCP 未就绪，请确认软件已完全启动"
4. 如果 `status="offline"` → "未检测到运行，请启动软件并确保插件已启用"
