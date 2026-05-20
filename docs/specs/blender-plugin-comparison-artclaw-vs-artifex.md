# Artifex Nexus vs ArtClaw — Blender 插件实现差异分析

> **分析日期**: 2026-05-18  
> **分析目的**: 对照 ArtClaw 已实现的 Blender 事件触发功能，检查 Artifex Nexus 的完整性和优化方向

---

## 目录

1. [总体架构对比](#1-总体架构对比)
2. [事件触发系统对比](#2-事件触发系统对比)
3. [MCP 通信架构对比](#3-mcp-通信架构对比)
4. [Blender 插件 UI 对比](#4-blender-插件-ui-对比)
5. [代码执行与适配器对比](#5-代码执行与适配器对比)
6. [Nexus Tool 集成对比](#6-nexus-tool-集成对比)
7. [部署与生命周期管理对比](#7-部署与生命周期管理对比)
8. [缺失功能清单（Artifex Nexus 待补充）](#8-缺失功能清单)
9. [Artifex Nexus 独有优势](#9-artifex-nexus-独有优势)
10. [优化建议（按优先级排序）](#10-优化建议)

---

## 1. 总体架构对比

| 维度 | ArtClaw | Artifex Nexus |
|------|---------|---------------|
| **插件入口** | `blender_addon.py`（单文件独立） | `__init__.py`（包形式） |
| **事件系统** | **双系统并行**：event_intercept（本地执行）+ DCCEventManager（HTTP 转发 Tool Manager） | **单一系统**：MCP WebSocket 广播到 sidecar |
| **触发器执行位置** | Blender 内部 + Tool Manager 远端 | 仅 sidecar/gateway 远端 |
| **MCP Server 端口** | 8083 | 18083 |
| **Blender 内 UI** | Qt6 Chat Panel（完整聊天界面） | 仅侧栏状态面板（启停 + 端口显示） |
| **Gateway 集成** | 无 Gateway 插件（直连 Tool Manager） | Gateway 插件（TypeScript）+ Sidecar 编排 |
| **SDK 支持** | artclaw_sdk（完整工具开发 SDK） | 无独立 SDK（工具直接 import bpy） |
| **知识库/记忆** | knowledge_base + memory_store | 无 |
| **文件监控** | file_watcher（watchdog） | 无 |
| **反重载保护** | sys.modules wrapper 模式 | **无** — 依赖 Blender 不重载 |

---

## 2. 事件触发系统对比

### 2.1 ArtClaw 事件系统（双系统并行）

#### 系统 A: blender_event_intercept（本地触发执行）

```
┌─────────────────────────────────────────────────────────────┐
│  Blender 事件                                                │
│  ┌──────────┐  ┌──────────┐                                 │
│  │ save_post │  │ load_post │                                 │
│  └────┬─────┘  └────┬─────┘                                 │
│       │              │                                       │
│       ▼              ▼                                       │
│  ┌──────────────────────────────────────┐                    │
│  │  blender_event_intercept.py          │                    │
│  │  - _save_post_impl / _load_post_impl │                    │
│  │  - 防重载 wrapper（sys.modules）     │                    │
│  └──────────────┬───────────────────────┘                    │
│                 │                                            │
│                 ▼                                            │
│  ┌──────────────────────────────────────┐                    │
│  │  dcc_event_intercept_shared.py       │                    │
│  │  - 加载 ~/.artclaw/triggers.json     │                    │
│  │  - 匹配 trigger 规则                 │                    │
│  │  - 执行工具（动态 import）           │                    │
│  │  - 去重保护（500ms 窗口）            │                    │
│  └──────────────┬───────────────────────┘                    │
│                 │                                            │
│                 ▼                                            │
│  ┌──────────────────────────────────────┐                    │
│  │  _notify_blender()                   │                    │
│  │  - popup_menu() 弹窗                 │                    │
│  │  - bpy.app.timers 延迟执行           │                    │
│  └──────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

**支持的事件**：`file.save.post`、`file.open.post`

**特点**：
- 独立于 addon 启动/停止周期（事件一直监听）
- 使用 `sys.modules["__artclaw_blender_wrappers__"]` 防 Blender 模块重载
- 工具执行在 Blender 进程内，可直接操作 bpy
- 结果通过 Blender popup_menu 通知用户

#### 系统 B: DCCEventManager（HTTP 转发 Tool Manager）

```
┌──────────────────────────────────────────────────────────────┐
│  Blender 事件                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ save_pre │ │save_post │ │load_post │ │render_pre│        │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘        │
│       └────────────┴────────────┴────────────┘               │
│                        │                                      │
│                        ▼                                      │
│  ┌──────────────────────────────────────┐                     │
│  │  DCCEventManager (dcc_event_manager) │                     │
│  │  - 加载规则（Tool Manager API）      │                     │
│  │  - 注册 Blender handlers            │                     │
│  │  - HTTP POST → Tool Manager          │                     │
│  └──────────────┬───────────────────────┘                     │
└─────────────────┼─────────────────────────────────────────────┘
                  │
                  ▼  HTTP POST /api/v1/dcc-events
┌──────────────────────────────────────────────────────────────┐
│  ArtClaw Tool Manager (port 9876)                             │
│  - TriggerEngine 评估规则                                     │
│  - 执行匹配的工具                                             │
│  - 返回结果 {triggered, rules_matched, blocked}               │
└──────────────────────────────────────────────────────────────┘
```

**支持的事件**：`file.save.pre`、`file.save.post`、`file.load.post`、`render.pre`、`file.export`（有限）

**特点**：
- pre 事件支持 allow/reject（Blender 中仅通知，不真拦截）
- 规则从 Tool Manager API 实时加载
- 事件转发到外部服务评估

### 2.2 Artifex Nexus 事件系统（单一广播）

```
┌──────────────────────────────────────────────────────────────┐
│  Blender 事件                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │save_post │ │load_post │ │render_pre│ │render_post│        │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘        │
│       └────────────┴────────────┴────────────┘               │
│                        │                                      │
│                        ▼                                      │
│  ┌──────────────────────────────────────┐                     │
│  │  __init__.py: _notify_trigger_event()│                     │
│  │  → MCPServer.broadcast_trigger_event│                     │
│  └──────────────┬───────────────────────┘                     │
│                 │  WebSocket broadcast                        │
│                 ▼  {"type":"trigger_event", "event":"..."}    │
│  ┌──────────────────────────────────────┐                     │
│  │  所有连接的 MCP 客户端               │                     │
│  │  - Gateway Plugin                    │                     │
│  │  - Sidecar                           │                     │
│  └──────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────┘
```

**支持的事件**：`file.save.post`、`file.open.post`、`render.pre`、`render.post`

---

### 2.3 事件覆盖对比表

| 事件 | ArtClaw 系统 A | ArtClaw 系统 B | Artifex Nexus | 差异说明 |
|------|:---:|:---:|:---:|---------|
| `file.save.pre` | — | ✅ | ❌ | **Artifex 缺失**：无法在保存前拦截 |
| `file.save.post` | ✅ | ✅ | ✅ | 三方均支持 |
| `file.open.post` | ✅ | ✅ | ✅ | 三方均支持 |
| `render.pre` | — | ✅ | ✅ | 均支持 |
| `render.post` | — | — | ✅ | **Artifex 独有** |
| `file.export` | — | ✅ (有限) | ❌ | ArtClaw 已标记为"无原生 hook，best-effort" |
| `object.create` | — | — | — | 双方均不支持（Blender 无原生 hook） |
| `object.delete` | — | — | — | 双方均不支持 |
| `object.select` | — | — | — | 双方均不支持 |

### 2.4 事件系统架构差异总结

| 差异点 | ArtClaw | Artifex Nexus | 影响评估 |
|--------|---------|---------------|---------|
| **执行位置** | Blender 内执行 + 远端 API | 仅远端 sidecar | ArtClaw 更可靠（不依赖网络） |
| **用户通知** | Blender popup_menu 弹窗 | 无 UI 反馈 | **Artifex 缺失** |
| **反重载保护** | sys.modules wrapper | 无 | **Artifex 风险点** |
| **去重保护** | 500ms 窗口 | 无 | **Artifex 缺失** |
| **pre 事件** | 支持（仅通知） | 不支持 | **Artifex 缺失** |
| **条件匹配** | path glob + typeFilter | 无（sidecar 侧处理） | 功能等价 |
| **触发器来源** | ~/.artclaw/triggers.json | Nexus Tool manifest | 机制不同 |

---

## 3. MCP 通信架构对比

### 3.1 ArtClaw

```
[Blender: MCPServer] ←WS→ [外部 MCP 客户端]
       ↓ (端口 8083)
       ↓ 注册工具: run_python, get_editor_context, get_selected_objects, get_scene_info

[Blender: DCCEventManager] → HTTP → [Tool Manager: 9876]
```

- MCP Server 功能完整（initialize/tools/list/tools/call/ping）
- 同时注册 4 个工具（vs Artifex 的 1 个）
- 事件转发走 HTTP（不走 MCP）

### 3.2 Artifex Nexus

```
[Blender: MCPServer] ←WS→ [Gateway: MCPBridgeClient] ←→ [Gateway Plugin: TypeScript]
       ↓ (端口 18083)                ↓ (端口 19789)           ↓
       ↓ 注册工具: run_python        ↓ 异步连接             ↓ 同步注册工具名
                                      ↓ 自动重连              ↓ mcp_blender-editor_run_python
```

- 三层桥接（Blender MCP → Python Bridge → TypeScript Gateway）
- 统一事件/命令通道（均走 WebSocket）
- 自动重连 + 健康检查
- 部署清单 SHA-256 校验

### 3.3 MCP 差异

| 差异点 | ArtClaw | Artifex Nexus |
|--------|---------|---------------|
| 注册工具数 | 4 个 | 1 个（run_python） |
| 事件通道 | HTTP（独立通道） | WebSocket（同一通道） |
| Gateway 集成 | 无 | Gateway Plugin + Sidecar |
| 连接管理 | 简单 daemon 线程 | 自动重连 + 心跳 |
| 部署校验 | 无 | SHA-256 deploy-manifest |

---

## 4. Blender 插件 UI 对比

| 维度 | ArtClaw | Artifex Nexus |
|------|---------|---------------|
| **侧栏面板** | View3D > ArtClaw | View3D > Artifex Nexus |
| **显示内容** | 依赖状态、运行状态、Chat Panel 开关、启停按钮 | MCP 状态指示灯、端口号、启停按钮 |
| **Chat Panel** | Qt6 聊天面板（在 Blender 内） | **无** |
| **触发结果通知** | popup_menu（ArtClaw 规范检查） | **无** |
| **依赖管理** | 自动检测 + 后台安装 | 由安装器统一管理 |

---

## 5. 代码执行与适配器对比

| 维度 | ArtClaw | Artifex Nexus |
|------|---------|---------------|
| **基类** | BaseDCCAdapter（抽象类） | BaseDCCAdapter（几乎相同） |
| **execute_code** | ✅ 持久命名空间 + 上下文注入 | ✅ 相同实现 |
| **main_thread 调度** | queue.Queue + bpy.app.timers | ✅ 相同模式 |
| **上下文变量** | bpy/S/W/L/C/D | bpy/S/W/L/C/D（一致） |
| **undo 支持** | bpy.ops.ed.undo_push | ✅ 相同 |
| **stdout 捕获** | io.StringIO | ✅ 相同 |
| **get_context** | 独立工具（get_editor_context） | run_python 的 get_context=True 参数 |
| **SDK Backend** | artclaw_sdk（深度对象内省） | 无 |
| **Legacy 兼容** | ARTCLAW_LEGACY_MCP 模式 | 无需兼容 |

---

## 6. Nexus Tool 集成对比

### 6.1 ArtClaw

**工具位置**：`tools/marketplace/blender/`

**工具开发 SDK**：`artclaw_sdk`
- `event.py` — EventData 事件解析
- `result.py` — success/fail/allow/reject/partial 结果构建
- `context.py` — DCC 上下文查询
- `params.py` — 参数解析
- `filters.py` — 对象过滤
- `progress.py` — 进度追踪
- `logger.py` — 统一日志

**触发器声明**：`~/.artclaw/triggers.json`（由 Tool Manager 同步）

### 6.2 Artifex Nexus

**工具位置**：`tools/marketplace/`

**工具开发**：直接 import bpy（无独立 SDK 层）

**触发器声明**：工具 manifest.json 的 triggers 字段

### 6.3 覆盖的工具

| 工具 | ArtClaw | Artifex Nexus |
|------|:---:|:---:|
| Blender对象命名规范检查 | ✅ | ✅ |
| 模型批量加前缀后缀 | ✅ | ✅ |
| 其他 Blender Skills | 4 个 skills（operation-rules, context, material-ops, viewport-capture） | 0 |

> 注：工具校验逻辑一致，仅 SDK 层封装方式不同。

---

## 7. 部署与生命周期管理对比

| 维度 | ArtClaw | Artifex Nexus |
|------|---------|---------------|
| **安装方式** | addon zip 安装（用户手动） | 自动安装（installer 脚本） |
| **版本检测** | 无 | 多版本检测 + 兼容性判断 |
| **部署校验** | 无 | SHA-256 deploy-manifest |
| **部署修复** | 无 | validate + repair |
| **自动启动** | 仅注册 handlers（不自动启动 MCP） | addon 启用时自动启动 MCP Server |
| **卸载清理** | 基本清理 | 完整清理（路径移除 + 配置清理） |
| **Gateway 集成** | 不涉及 | mcp_bridge 插件部署 + 配置补丁 |

---

## 8. 缺失功能清单（Artifex Nexus 待补充）

以下按照功能重要性和对用户影响排列：

### P0 — 必须补齐（功能缺失，用户可感知）

| # | 缺失功能 | ArtClaw 实现 | 影响 | 建议实现 |
|---|---------|-------------|------|---------|
| 1 | **`file.save.pre` 事件** | save_pre handler 注册 | 无法在保存前检查/提示，部分工具需 pre 事件 | 添加 `save_pre` handler（参考 ArtClaw 但标注"Blender 不支持真拦截"） |
| 2 | **Blender 内触发器执行结果反馈** | popup_menu 弹窗 | 用户无法看到触发器检查结果（如命名违规提示） | 在 MCP 广播后，添加本地结果弹窗回调 |
| 3 | **反重载保护** | sys.modules wrapper | Blender 重载模块时事件 handler 可能丢失 | 采用 ArtClaw 的 `__artclaw_blender_wrappers__` 模式 |

### P1 — 应该补齐（功能完善）

| # | 缺失功能 | ArtClaw 实现 | 建议实现 |
|---|---------|-------------|---------|
| 4 | **事件去重保护** | 500ms 去重窗口 | 防止同一事件快速重复触发（如多次保存） |
| 5 | **多事件类型 payload 格式统一** | EventData 类 | 广播消息增加 scene_name、asset_class 等字段 |
| 6 | **MCP 工具扩展** | get_editor_context / get_selected_objects / get_scene_info | 可选：增加 specialized 工具减少 run_python 简单查询 |
| 7 | **面板增加连接状态详情** | 显示桥接状态 | 显示 Gateway 连接状态、最后活跃时间 |

### P2 — 建议优化（锦上添花）

| # | 缺失功能 | ArtClaw 实现 | 建议实现 |
|---|---------|-------------|---------|
| 8 | **Blender 内 Chat Panel** | Qt6 聊天界面 | 成本较高，可观望用户需求 |
| 9 | **工具开发 SDK** | artclaw_sdk | 如果工具数量增多，考虑抽象统一 SDK |
| 10 | **Knowledge Base / Memory** | knowledge_base + memory_store | 多步骤工作流支持需 memory |
| 11 | **文件监控** | file_watcher (watchdog) | 自动检测外部文件变化 |
| 12 | **依赖自动管理** | dependency_manager | 已由安装器统一管理，暂不需要 |

---

## 9. Artifex Nexus 独有优势

以下是 Artifex Nexus 相比 ArtClaw 做得更好的地方：

| # | 优势 | 说明 |
|---|------|------|
| 1 | **render.post 事件** | ArtClaw 没有；可用于渲染完成后自动通知、截图、上传 |
| 2 | **Gateway Plugin + Sidecar 编排** | 更完整的链路管理，ArtClaw 依赖外部 Tool Manager |
| 3 | **统一事件/命令通道** | 所有通信走 WebSocket，ArtClaw 事件走 HTTP、命令走 MCP，割裂 |
| 4 | **部署清单校验** | SHA-256 验证 + 自动修复，ArtClaw 无此能力 |
| 5 | **多版本兼容** | 版本检测 + 兼容性矩阵，ArtClaw 仅支持 Blender ≥3.0 |
| 6 | **自动启动** | addon 启用即启动 MCP，无需手动点击 |
| 7 | **文档完善度** | 架构文档 + SDK 文档 + 测试覆盖更系统 |
| 8 | **连接状态分层检查** | TCP socket → MCP handshake 多层探测 |

---

## 10. 优化建议（按优先级排序）

### 10.1 建议立即实施（P0 — 本里程碑完成）

#### 1. 添加 `save_pre` handler

```python
# 在 __init__.py 的 _register_trigger_hooks() 中添加
@_bpy.app.handlers.persistent
def _on_save_pre(*_args: object) -> None:
    fp = _bpy.data.filepath or ""
    _notify_trigger_event("file.save.pre", fp)

_bpy.app.handlers.save_pre.append(_on_save_pre)
```

同时更新 `_unregister_trigger_hooks()` 添加 save_pre 的清理逻辑。

**注意事项**：
- Blender 的 `save_pre` 不支持真正拦截（会继续保存）
- 在广播消息中标注 `timing: "pre"` 以便 sidecar 区分

#### 2. 添加反重载保护

参考 ArtClaw 的 `blender_event_intercept.py`（第 163-192 行）实现：

```python
# 使用 sys.modules 存储稳定的 wrapper 函数
_REGISTRY_KEY = "__artifex_blender_wrappers__"

def _get_or_create_wrappers():
    registry = sys.modules.get(_REGISTRY_KEY)
    if registry is not None:
        return registry  # 跨 reload 复用

    import bpy as _bpy
    
    @_bpy.app.handlers.persistent
    def save_post_wrapper(*args):
        mod = sys.modules.get(__name__)
        if mod:
            mod._notify_trigger_event("file.save.post", ...)
    
    # ... 其他 wrappers
    
    registry = {"save_post": save_post_wrapper, ...}
    sys.modules[_REGISTRY_KEY] = registry
    return registry
```

#### 3. 添加事件去重

```python
_dedup_state: dict = {"key": "", "time": 0.0}
_DEDUP_WINDOW = 0.5

def _notify_trigger_event(event_type, filepath):
    # 去重检查
    now = time.monotonic()
    key = f"{event_type}:{filepath}"
    if key == _dedup_state["key"] and (now - _dedup_state["time"]) < _DEDUP_WINDOW:
        return  # 重复事件，跳过
    _dedup_state["key"] = key
    _dedup_state["time"] = now
    # ... 原有逻辑
```

### 10.2 建议本轮实施（P1 — 功能完善）

#### 4. 广播消息 payload 增强

当前格式：
```json
{"type": "trigger_event", "dcc": "blender", "event": "file.save.post", "filepath": "..."}
```

建议增强为：
```json
{
  "type": "trigger_event",
  "dcc": "blender",
  "event": "file.save.post",
  "timing": "post",
  "filepath": "/path/to/scene.blend",
  "data": {
    "asset_name": "Scene",
    "asset_class": "BlendFile",
    "scene_name": "Scene"
  }
}
```

**原因**：
- 与 ArtClaw EventData 格式对齐
- sidecar 侧不需要解析事件字符串提取 timing
- 为条件匹配（asset_class、asset_name）提供更多上下文

#### 5. 侧栏面板增加连接状态详情

在 `ARTIFEX_PT_MainPanel.draw()` 中增加：
- Gateway 连接状态（需 MCP Server 提供 client_count）
- 最后活跃时间

### 10.3 建议下轮实施（P2 — 远期规划）

#### 6. 触发结果本地弹窗

需要机制：
1. MCP 广播触发事件
2. Sidecar 匹配规则 + 执行工具
3. Sidecar 将结果回传 Blender（通过 MCP tools/call 或新 channel）
4. Blender 用 popup_menu 显示结果

**复杂度评估**：中 — 需要双向通信通道

#### 7. 工具执行 SDK 层

当 Nexus Tool 数量超过 5 个时，考虑抽取 artclaw_sdk 等价物。

---

## 总结

### 功能完整性评估

| 类别 | 评分 | 说明 |
|------|:---:|------|
| **事件触发覆盖** | 85% | 缺 save_pre、export；render.post 为独有优势 |
| **触发器执行** | 60% | 仅远端执行，缺本地执行 + UI 反馈 |
| **MCP 通信** | 95% | 架构更优，仅缺工具数量 |
| **代码执行** | 95% | 与 ArtClaw 等价 |
| **部署管理** | 100% | 远优于 ArtClaw |
| **稳定性** | 70% | 缺反重载保护 + 去重 |
| **用户体验** | 60% | 缺 Chat Panel + 触发结果弹窗 |

**综合**: Artifex Nexus 在基础设施（部署、校验、架构）上优于 ArtClaw，但在 Blender 内的事件本地执行和用户反馈方面有差距。**核心路线：补齐 P0 三项（save_pre、反重载、去重）→ 增强 P1（payload 增强、状态面板）→ 远期 P2（UI 体验）**。
