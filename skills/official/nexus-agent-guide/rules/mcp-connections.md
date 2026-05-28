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

---

## 安全红线

- ❌ 不读写 workspace 外的文件
- ❌ 删除/覆盖工程文件必须先口头确认
- ❌ 不执行任意 shell 命令
- ❌ API Key / token 绝不写入代码

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
