# MCP 连接与 DCC 操作指南

## 核心概念

平台通过 MCP（Model Context Protocol）Server 连接 DCC 软件。
每个 DCC 启动时拉起一个 MCP Server，Gateway 自动发现并暴露对应的 `run_python` 工具。

---

## 已支持的 DCC 与工具名

| DCC | MCP 工具名 | 原生 API 模块 | 端口 |
|-----|-----------|-------------|------|
| Unreal Engine 5.7 | `mcp_unreal_run_python` | `unreal.*` | 18080 |
| Blender | `mcp_blender_run_python` | `bpy.*` | 18083 |
| Maya | `mcp_maya_run_python` | `maya.cmds` / `pymel` | 18081 |
| 3ds Max | `mcp_max_run_python` | `pymxs.*` / `MaxPlus` | 18082 |

> 工具名前缀由 Gateway 根据 MCP Server 注册名自动生成。

---

## 调用约定

### 执行前
1. **判断目标 DCC**：用户意图指向哪个软件？不明确就追问，不默认假设。
2. **检查连接状态**：见 `connection-status.md`。
3. **说明操作意图**：用一句话告诉用户你要做什么、预期结果、可能的副作用。

### 执行中
4. **一次一个原子操作**：多步任务拆成多次 run_python 调用，不要一段脚本干多件事。
5. **try/except 兜底**：始终包裹异常处理。
6. **结构化返回值**：用 `print(json.dumps(result_dict))` 返回结果，便于解析。

### 代码规范
7. **中文沟通，英文代码**：与用户交流用中文；代码注释用中文；变量名和 API 调用用 DCC 原生英文名。
8. **UE Python UENUM 命名**：UE 把 C++ PascalCase UENUM 暴露成 Python 时会转成
   `UPPER_SNAKE_CASE`（大写字母之间插下划线）。例如 C++ `PerceptualHash` →
   Python `unreal.PerceptualHashAlgorithm.PERCEPTUAL_HASH`；`SCS_BaseColor` →
   `unreal.SceneCaptureSource.SCS_BASE_COLOR`。**不要直接套 PascalCase**，
   不确定时先 `print(dir(unreal.MyEnum))` 列举可用值。

---

## 安全红线

- ❌ 不读写 workspace 外的文件
- ❌ 删除/覆盖工程文件必须先口头确认
- ❌ 不执行任意 shell 命令
- ❌ API Key / token 绝不写入代码

---

## 长任务行为

DCC MCP Server 多为单线程 asyncio（universal_proxy 在 loop 中同步 exec(code)），
长 Python 任务会阻塞整个 loop。

平台已做两项关键防护：
1. **客户端 WebSocket 禁用 keep-alive ping**（`mcp_bridge._async_connect: ping_interval=None`）
   —— DCC 长任务期间不会被误判为"连接断开"
2. **超时由平台统一管理** —— 「设置 → 默认工具超时」（默认 300s），nexus-tool 不再
   读 manifest.implementation.timeout

因此 AI 可以放心调用预计运行较长的脚本（项目扫描、批量重命名、PCG 生成等），
但仍应：
- 估算时长 > 300s 的任务，提示用户去设置里调大「默认工具超时」
- 避免在单次 run_python 中执行可拆分的"组合操作"（拆成多次原子调用便于失败重试）

---

## 最佳实践

```
用户: "在 UE 里选中的 Actor 周围生成 10 个立方体"

你的流程:
1. 先确认: "你 UE 编辑器开着吗？当前有选中 Actor 吗？"
2. 获取上下文: mcp_unreal_run_python(get_context=true) → 拿到选中对象
3. 说明意图: "我会在选中的 Actor 周围生成 10 个 100x100x100 的立方体，间隔 150"
4. 执行: mcp_unreal_run_python(code="import unreal; ...")
5. 确认: "10 个立方体已生成在 Actor 周围，需要调整位置或大小吗？"
```
