---
tags: [research, survey, skill, tool, mcp, artclaw]
created: 2026-05-15
status: complete
related_epics: [EPIC-0004, EPIC-0005]
related_stories: [STORY-0040]
---

# ArtClaw Tool Manager — Skill & Tool 调研报告

> **原则声明**：本文档以**代码实现为准**，文档与代码不一致时取代码。所有已测试验证的代码路径均已标注 ✅。

---

## 一、项目背景与架构全景

Artifex Nexus 是 artclaw_bridge 的重构 fork。原项目的 "Tool Manager" 概念已拆分为三个子系统：

| 原概念 | Artifex Nexus 对应 | 状态 |
|--------|-------------------|------|
| Tool Manager（Web UI） | `packages/apps/web` — Artifex Nexus Web UI | ✅ 已实现骨架 |
| Skill 管理 | `packages/platform/skill/` — Skill 子系统 | ⚠️ 骨架已建，子模块为空桩 |
| DCC MCP 通信 | `packages/dcc/blender/` + `adapters/openclaw/gateway-plugin/` | ✅ 已实现端到端 |

### 核心数据流

```
AI Agent (OpenClaw)
    │
    ▼
OpenClaw Gateway
    │  MCP JSON-RPC over WebSocket
    │  工具名: mcp_{server}_{tool} (e.g., mcp_blender-editor_run_python)
    │
    ├──► Gateway MCP Bridge Plugin (TypeScript)
    │        ↕ WebSocket
    └──► DCC MCP Server (Python, 在 Blender/UE 内运行)
             │
             ├── tools/list → [run_python]
             └── tools/call → adapter.execute_code() → DCC API
```

---

## 二、已实现模块详解（代码为准）

### 2.1 MCP Server（DCC 侧）✅

**位置**: `packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/mcp_server.py`

**核心类**: `MCPServer`

**关键特性**:
- WebSocket JSON-RPC 2.0 服务器，运行在独立 daemon 线程
- 端口探测（DEFAULT_PORT=18083，最多探测 10 个偏移）
- 内置 1 个工具：`run_python` + `get_context` 快捷模式
- `register_tool(name, description, input_schema, handler, main_thread)` 注册 API
- 主线程调度通过 `adapter.execute_on_main_thread()` → `queue.Queue` + `bpy.app.timers`

**内置工具注册代码**（实际运行逻辑）:

```python
def register_builtin_tools(server: MCPServer, adapter=None) -> None:
    def _handle_run_python(arguments: dict) -> dict:
        if arguments.get("get_context", False):
            # 返回编辑器上下文（不执行代码）
            info = {
                "software": adapter.get_software_name(),
                "version": adapter.get_software_version(),
                "python": adapter.get_python_version(),
                "current_file": adapter.get_current_file() or "untitled",
                "selected_objects": adapter.get_selected_objects(),
                "scene_info": adapter.get_scene_info(),
            }
            return {"content": [{"type": "text", "text": json.dumps(info, ...)}], "isError": False}
        
        code = arguments.get("code", "")
        if adapter:
            result = adapter.execute_code(code)
            # 返回 output + error 或 result
        ...

    server.register_tool(
        name="run_python",
        description="在 Blender 中执行 Python 代码。\n\n上下文变量: S/W/L/C/D/bpy\n...",
        input_schema={...},
        handler=_handle_run_python,
        main_thread=True,
    )
```

**线程安全机制**:
- MCP Server 线程通过 `asyncio.run_coroutine_threadsafe()` 桥接到 asyncio 事件循环
- `_execute_on_main_thread()`: `loop.run_in_executor(None, adapter.execute_on_main_thread, handler, arguments)` — 不阻塞 asyncio 事件循环
- BlenderAdapter 内 `queue.Queue` + `bpy.app.timers.register()` 实现主线程调度，50ms 轮询间隔

**生命周期**:
- addon 启用 → `_auto_start_server()` → `register_builtin_tools()` → `server.start()`
- addon 禁用 → `server.stop()` → 清理

---

### 2.2 Gateway MCP Bridge Plugin ✅

**位置**: `packages/adapters/openclaw/gateway-plugin/src/index.ts`

**核心类**: `McpWebSocketClient`

**关键特性**:
- WebSocket 客户端，连接 DCC MCP Server
- 自动 `tools/list` 发现 + 注册到 OpenClaw agent tools
- 工具命名规则：`mcp_{server-name}_{tool-name}`
  - 例：`mcp_blender-editor_run_python`
- 预注册策略（OpenClaw 要求同步）：
  - `KNOWN_TOOLS` 硬编码已知工具定义（来自 `openclaw.plugin.json` contracts.tools）
  - `execute` 闭包内检查 client 连接状态 → 转发 `tools/call`
- 后台异步连接（fire-and-forget），支持 late discovery
- 指数退避重连（3s × 1.5^n, max 5s）
- Ping 间隔 15s，连接超时 5s，请求超时 30s
- 统计跟踪：toolCallCount, toolErrorCount, totalReconnects

**配置结构** (`openclaw.plugin.json` → `openclaw.json`):
```json
{
  "plugins": {
    "entries": {
      "mcp-bridge": {
        "config": {
          "servers": {
            "blender-editor": {
              "type": "websocket",
              "url": "ws://127.0.0.1:18083",
              "enabled": true
            }
          }
        }
      }
    }
  }
}
```

**合约声明** (`openclaw.plugin.json` contracts.tools):
```json
{
  "contracts": {
    "tools": [
      "mcp_blender-editor_run_python",
      "mcp_blender-editor_get_context",
      "mcp_maya-primary_run_python",
      "mcp_unreal-editor_run_python"
    ]
  }
}
```

---

### 2.3 MCP Bridge Client（Sidecar 侧）✅

**位置**: `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/mcp_bridge.py`

**核心类**: `MCPBridgeClient`（单例）

**关键特性**:
- 作为 Python sidecar 的 MCP WebSocket 客户端
- 懒初始化 + 自动重连
- `call_tool(tool_name, arguments, timeout)` — 同步阻塞调用
- 使用独立线程运行 asyncio 事件循环（每次调用创建新 loop）
- 便捷函数：
  - `call_blender_run_python(code, get_context)` — 直接调用 Blender
  - `check_blender_mcp_connection()` — 连通性检测
  - `check_blender_mcp_server_running()` — 端口监听检测（纯 TCP，无 MCP 握手）

---

### 2.4 BaseDCCAdapter + BlenderAdapter ✅

**位置**: `packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/base_adapter.py`
          `packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/blender_adapter.py`

**BaseDCCAdapter (ABC)** 接口:
| 方法 | 职责 |
|------|------|
| `get_software_name()` | 返回 DCC 名称 |
| `get_software_version()` | 返回 DCC 版本 |
| `get_python_version()` | 返回内置 Python 版本 |
| `on_startup()` / `on_shutdown()` | 生命周期回调 |
| `execute_on_main_thread(fn, *args)` | 主线程阻塞执行 |
| `execute_deferred(fn, *args)` | 主线程非阻塞延迟执行 |
| `get_selected_objects()` | 获取选中对象 |
| `get_scene_info()` | 获取场景信息 |
| `get_current_file()` | 当前文件路径 |
| `execute_code(code, context)` | 万能 Python 代码执行器 |

**BlenderAdapter 关键实现**:
- `execute_code()`: 持久化命名空间 `_exec_namespace`，每次刷新上下文变量（S/W/L/C/D/bpy），捕获 stdout，Undo 包装
- `execute_on_main_thread()`: `queue.Queue` + `threading.Event` 阻塞等待，30s 超时，主线程快路径优化

---

### 2.5 Skill 子系统（骨架）⚠️

**位置**: `packages/platform/skill/src/artifex_nexus/skill/`

**当前状态**: 所有子模块目录已建，均为空桩（仅含空 `__init__.py`）

**规划的子模块**（来自 `__init__.py` 文档字符串和 `docs/specs/skill-system.md`）:

```
packages/platform/skill/src/artifex_nexus/skill/
├── __init__.py          # 统一门面（当前所有导入被注释）
├── decorator/           # @tool 装饰器 + 参数 schema 推导
├── manifest/            # SkillManifest pydantic v2 模型 + Category/RiskLevel 枚举
├── loader/              # 分层加载（00_official > 01_team > 02_user > 99_custom）
├── version/             # 版本解析/比较/匹配
├── hub/                 # SkillHub: execute/list/get/reload（运行时入口）
├── conflict/            # 多层级命名冲突检测
├── registry.py          # SkillRegistry: 查询/匹配/最佳版本选择
├── installer.py         # SkillInstaller: install/publish/sync/uninstall/enable/disable
├── events.py            # Skill 事件枚举，通过 core.event_bus 广播
└── categories.py        # 标准 Category 枚举
```

---

### 2.6 Manifest Schema ✅

**位置**: `packages/platform/contracts/schemas/manifest.schema.json`

```json
{
  "$id": "https://artifexnexus.dev/schemas/manifest.schema.json",
  "title": "SkillManifest",
  "type": "object",
  "required": ["manifest_version", "name", "version", "software"],
  "properties": {
    "manifest_version": { "const": "1.0" },
    "name": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,63}$" },
    "display_name": { "type": "string" },
    "description": { "type": "string" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(?:[-+].+)?$" },
    "author": { "type": "string" },
    "license": { "type": "string" },
    "software": { "type": "string", "enum": ["universal", "unreal", "blender"] },
    "software_version": { "type": "object", "properties": { "min": {...}, "max": {...} } },
    "category": { "type": "string" },
    "risk_level": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
    "dependencies": { "type": "array", "items": { "type": "string" } },
    "tags": { "type": "array", "items": { "type": "string" } },
    "entry_point": { "type": "string", "default": "__init__.py" },
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" }
        }
      }
    }
  }
}
```

---

### 2.7 Web UI — ToolCall 组件 ✅

**位置**: `packages/ui/src/components/tool-call.tsx`
**Chat 类型**: `packages/apps/web/src/lib/chat/types.ts`

ToolCall 数据结构（TypeScript）:
```typescript
interface ToolCall {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  durationMs?: number;
  input?: string;
  output?: string;
}
```

UI 组件 `ToolCallGroup` + `ToolCallItem`:
- 双层可折叠设计
- 状态指示器（running/done/error）
- 参数和结果显示在代码块中
- ≥3 个工具时默认折叠

---

### 2.8 STORY-0035 已完成的 Skill/Tool UI ✅

**位置**: `docs/tasks/done/STORY-0035-m3-ui-skills-tools.md`

已实现：
- Skill 卡片/列表视图切换（mock 数据）
- Tool 卡片/列表（按 Skill 分组折叠）
- 筛选器：软件/来源/状态/收藏
- 排序：名称/最近更新
- 批量选择 + BatchActionBar
- 视图状态持久化到 localStorage

---

## 三、设计决策速查

### ADR 0003: MCP 工具最小化
- 每个 DCC 只注册 1 个 MCP 工具：`run_python`
- Gateway 端自动加 `mcp_{server}_` 前缀隔离
- 所有领域能力以 Skill 形式提供
- `@tool` 统一装饰器（`@artclaw_tool` 兼容别名）
- **铁律：不许新增 MCP 工具**

### ADR 0004: Contracts as Source of Truth
- 所有跨进程/跨语言数据结构先在 `contracts/schemas/` 定义 JSON Schema
- Python: pydantic v2 模型；TS: 自动生成类型

### Skill ≠ Tool 命名约定
- **Skill** = 包（`SKILL.md` + `manifest.json` + `__init__.py`），分发与版本管理的单位
- **Tool** = Skill 包内被 `@tool` 装饰的函数，实际执行的单位
- 一个 Skill 可暴露多个 Tool

### 安装路径
```
~/.artifexnexus/.openclaw/workspace/skills/{skill-name}/   # 扁平结构
```
由 SkillInstaller 通过 copy 管理，不使用 symlink。

### 加载优先级
- `00_official` ← 项目内官方源码
- `01_team` ← 团队 Git 仓库
- `02_user` ← `~/.artifexnexus/skills/` 用户自建
- `99_custom` ← 运行时动态注册
同名时高优先级覆盖低优先级。

---

## 四、原始 artclaw_bridge 待迁移资产

### 4.1 5 个 OpenClaw Skill
原项目有 5 个内置 Skill 需要迁移（`docs/specs/skill-system.md` §8 TODO）:
- `artifex-context` — 上下文采集
- `artifex-memory` — 记忆管理
- `artifex-knowledge` — 知识库查询
- `artifex-skill-manage` — Skill 管理
- `artifex-highlight` — 语法高亮

### 4.2 原始 `core/version_manager.py`
需按职责拆分为：SkillRegistry + SkillInstaller + conflict + events + loader

### 4.3 原始 `cli/artclaw_bridge/skill_hub.py`
需迁移为：`packages/platform/skill/src/artifex_nexus/skill/hub/`

---

## 五、调用链路分析

### 当前工作链路（M2 已验证 ✅）：
```
用户 Chat 输入 → Web UI → Gateway → LLM 生成
    ↓ (LLM 决定调用工具)
Gateway → MCP Bridge Plugin → WebSocket → Blender MCP Server
    ↓
MCP Server → adapter.execute_on_main_thread() → DCC API
    ↓ (结果返回)
DCC API → MCP Server → WebSocket → Gateway Plugin → LLM → Web UI
```

### 目标 Skill 调用链路（M4 目标）：
```
用户 Chat 输入 → Web UI → Gateway → LLM 生成
    ↓ (LLM 写 Python 代码调 skill_hub)
LLM 生成代码: "from artifex_nexus.skill import execute; execute('create_cube', {...})"
    ↓ (通过 run_python 执行)
Gateway → mcp_blender-editor_run_python(code=上面的代码)
    ↓
Blender MCP Server → adapter.execute_code(code) → skill_hub.execute()
    ↓
SkillHub → 查找 Skill → 执行 @tool 函数 → 返回 ToolResult
```

---

## 六、关键观察与结论

1. **MCP 基础设施已完备**：DCC ↔ Gateway 通信链路经过测试验证，无需改动。
2. **Skill 子系统是纯平台层代码**：与具体 DCC 无关，不依赖 `bpy`/`unreal`，可以独立开发。
3. **Skill 骨架已建但全部为空桩**：8 个子模块需要从零实现或从 artclaw_bridge 迁移。
4. **Web UI 的 Skill/Tool Tab 已做 UI（mock 数据）**：STORY-0040 需要接真实 API。
5. **5 个内置 Skill 需要迁移**：来自原 artclaw_bridge 项目。
6. **AI 调用 Skill 通过代码执行，不通过 MCP 工具发现**：这是架构关键——Skill 对 AI 是"写代码调用"而非"工具选择"。
