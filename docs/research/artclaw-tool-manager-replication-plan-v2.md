---
tags: [plan, replication, skill, tool, m4, m5, sdk, api]
created: 2026-05-15
status: draft
version: 2.1
related_epics: [EPIC-0004, EPIC-0005]
related_stories: [STORY-0040]
replaces: "[[artclaw-tool-manager-replication-plan]]"
---

# ArtClaw Tool Manager — 复刻接入方案 v2

> **核心策略**：以已验证的 `artclaw_bridge` 代码为蓝本，复制 → 适配路径/导入 → 调整命名/架构差异，**禁止重写**。
> **排除范围**：记忆管理（`memory_core.py`、`retry_tracker.py`、`memory-promote-to-team` 等）不迁移。
> **强调**：SDK/API 提前规划，文件映射精确到行级适配量。

---

## 一、SDK / API 总体设计

### 1.1 Python SDK 公开接口

```python
# ================================================================
# 包: artifex_nexus.skill  (packages/platform/skill/)
# 所有对外暴露的 API 如下，不暴露内部子模块
# ================================================================

# --- 装饰器 ---
from artifex_nexus.skill import tool           # @tool(name=..., description=..., ...)
from artifex_nexus.skill import ToolResult      # ToolResult.success(data) / .error(msg)
from artifex_nexus.skill import artclaw_tool    # 兼容别名 → tool

# --- 运行时 ---
from artifex_nexus.skill import execute         # execute(tool_name, arguments) -> ToolResult
from artifex_nexus.skill import list_skills     # list_skills() -> list[SkillInfo]
from artifex_nexus.skill import get_skill       # get_skill(name) -> SkillInfo | None
from artifex_nexus.skill import reload_skills   # reload_skills() -> None

# --- 注册表 ---
from artifex_nexus.skill import SkillRegistry   # 查询/匹配/搜索
from artifex_nexus.skill import ToolRegistry    # 工具发现/查询/执行

# --- 安装管理 ---
from artifex_nexus.skill import SkillInstaller  # install/uninstall/sync/publish
from artifex_nexus.skill import ToolInstaller   # create/delete/publish

# --- 数据模型 ---
from artifex_nexus.skill import SkillManifest   # pydantic v2 model
from artifex_nexus.skill import SkillInfo       # 运行时 Skill 信息
from artifex_nexus.skill import ToolInfo        # 运行时 Tool 信息
```

### 1.2 Sidecar RPC API（Web UI 通过 Tauri invoke 调用）

```
方法命名规范: {domain}.{action}

skill.list      → list_skills(filters) → (items, total)
skill.detail    → get_skill_detail(id)  → SkillDetail
skill.install   → install_skill(id)     → {ok, message}
skill.uninstall → uninstall_skill(id)   → {ok, message}
skill.enable    → enable_skill(id)      → SkillInfo
skill.disable   → disable_skill(id)     → SkillInfo
skill.pin       → pin_skill(id)         → SkillInfo
skill.unpin     → unpin_skill(id)       → SkillInfo
skill.favorite  → favorite_skill(id)    → SkillInfo
skill.unfavorite→ unfavorite_skill(id)  → SkillInfo
skill.sync      → sync_skill(id)        → {ok, synced_files}
skill.publish   → publish_skill(id, ...)→ {ok, version}
skill.batch     → batch_operation(op, ids) → {succeeded, failed, errors}
skill.search    → search_skills(query)  → list[SkillInfo]

tool.list       → list_tools(filters)   → (items, total)
tool.detail     → get_tool_detail(id)   → ToolDetail
tool.create     → create_tool(...)      → ToolInfo
tool.update     → update_tool(id, ...)  → ToolInfo
tool.delete     → delete_tool(id)       → {ok}
tool.enable     → enable_tool(id)       → ToolInfo
tool.disable    → disable_tool(id)      → ToolInfo
tool.pin        → pin_tool(id)          → ToolInfo
tool.unpin      → unpin_tool(id)        → ToolInfo
tool.favorite   → favorite_tool(id)     → ToolInfo
tool.unfavorite → unfavorite_tool(id)   → ToolInfo
tool.publish    → publish_tool(id, ...) → {ok, version}
tool.run        → run_tool(id, args)    → ToolResult
tool.batch      → batch_operation(op, ids) → {succeeded, failed, errors}
```

### 1.3 TypeScript 前端 API 封装

```typescript
// packages/apps/web/src/lib/skill/index.ts
export interface SkillAPI {
  list(filters?: SkillFilters): Promise<PaginatedResult<SkillItem>>;
  getDetail(id: string): Promise<SkillDetail>;
  install(id: string): Promise<OpResult>;
  uninstall(id: string): Promise<OpResult>;
  enable(id: string): Promise<SkillItem>;
  disable(id: string): Promise<SkillItem>;
  pin(id: string): Promise<SkillItem>;
  unpin(id: string): Promise<SkillItem>;
  sync(id: string): Promise<SyncResult>;
  publish(id: string, opts: PublishOptions): Promise<PublishResult>;
  batch(operation: string, ids: string[]): Promise<BatchResult>;
  search(query: string): Promise<SkillItem[]>;
}

// packages/apps/web/src/lib/tool/index.ts
export interface ToolAPI {
  list(filters?: ToolFilters): Promise<PaginatedResult<ToolItem>>;
  getDetail(id: string): Promise<ToolDetail>;
  create(opts: CreateToolOptions): Promise<ToolItem>;
  update(id: string, opts: UpdateToolOptions): Promise<ToolItem>;
  delete(id: string): Promise<OpResult>;
  enable(id: string): Promise<ToolItem>;
  disable(id: string): Promise<ToolItem>;
  pin(id: string): Promise<ToolItem>;
  unpin(id: string): Promise<ToolItem>;
  publish(id: string, opts: PublishOptions): Promise<PublishResult>;
  run(id: string, args: Record<string, unknown>): Promise<ToolRunResult>;
  batch(operation: string, ids: string[]): Promise<BatchResult>;
}
```

---

## 二、文件级精确映射表

### 2.1 核心 Skill 子系统

**共有 8 个子模块目录，当前全部为空桩。每个子模块对应原 artclaw_bridge 的具体文件。**

| # | 目标文件 (Artifex Nexus) | 源文件 (artclaw_bridge) | 行数 | 适配量 | 适配说明 |
|---|--------------------------|------------------------|------|--------|---------|
| S1 | `packages/platform/skill/src/artifex_nexus/skill/__init__.py` | 新写（门面） | ~50 | 全写 | 解锁所有子模块导入 |
| S2 | `packages/platform/skill/src/artifex_nexus/skill/decorator/core.py` | `core/skill_decorator.py` | 192 | **低** | 去 UE skill_hub 回退；`_artclaw_tool_standalone` 改名为 `tool`；加 `ToolResult` 类 |
| S3 | `packages/platform/skill/src/artifex_nexus/skill/decorator/__init__.py` | 新写 | ~10 | 全写 | 导出 `tool`, `ToolResult`, `artclaw_tool` |
| S4 | `packages/platform/skill/src/artifex_nexus/skill/manifest/models.py` | `cli/artclaw_bridge/manifest.py` (§ValidationResult 逻辑) + `contracts/schemas/manifest.schema.json` | ~200 | **中** | 转为 pydantic v2 模型；组合 `SkillManifest` + `ToolRef` + `SoftwareVersionConstraint` |
| S5 | `packages/platform/skill/src/artifex_nexus/skill/manifest/loader.py` | `cli/artclaw_bridge/manifest.py` (`load_manifest()`) | ~50 | **低** | 路径适配 |
| S6 | `packages/platform/skill/src/artifex_nexus/skill/manifest/__init__.py` | 新写 | ~10 | 全写 | 导出 models + loader |
| S7 | `packages/platform/skill/src/artifex_nexus/skill/hub/core.py` | `cli/artclaw_bridge/skill_hub.py` | 400 | **高** | SkillHub 类复制；去 artclaw_bridge.config 依赖 → 用 artifex_nexus 路径；去 SKILL.md frontmatter 解析 → 用 manifest.pydantic |
| S8 | `packages/platform/skill/src/artifex_nexus/skill/hub/instance.py` | 新写 | ~30 | 全写 | `SkillInstance` dataclass（manifest + tools dict + source_path + layer） |
| S9 | `packages/platform/skill/src/artifex_nexus/skill/hub/executor.py` | `core/mcp_server.py` (§ToolCall / `format_tool_result`) | ~80 | **低** | 复制 execute_tool 逻辑，去 MCP WebSocket 相关 |
| S10 | `packages/platform/skill/src/artifex_nexus/skill/hub/__init__.py` | 新写 | ~10 | 全写 | 导出 hub API |
| S11 | `packages/platform/skill/src/artifex_nexus/skill/version/parser.py` | `core/version_manager.py` (§parse_version / compare / version_gt/lt 等) | ~150 | **低** | 纯复制，去 SyncStatus/SyncState（留给 registry 用） |
| S12 | `packages/platform/skill/src/artifex_nexus/skill/version/__init__.py` | 新写 | ~10 | 全写 | 导出版本函数 |
| S13 | `packages/platform/skill/src/artifex_nexus/skill/registry.py` | `core/version_manager.py` (§SkillRegistry 部分：`matches_skill`, `select_best_match`, `LAYER_PRIORITY`) + `cli/artclaw_bridge/skill_hub.py` (§list_skills / get_skill / search) | ~300 | **高** | 组合 VersionManager 查询部分 + SkillHub 查询部分；去 UE 依赖 |
| S14 | `packages/platform/skill/src/artifex_nexus/skill/loader/core.py` | `cli/artclaw_bridge/skill_hub.py` (§scan_all_skills / load_skill) + ToolManager `services/skill_scanner.py` | ~350 | **高** | 组合 cli/skill_hub 的加载逻辑 + ToolManager 的 scanner 逻辑；适配到 Artifex Nexus 路径 |
| S15 | `packages/platform/skill/src/artifex_nexus/skill/loader/__init__.py` | 新写 | ~10 | 全写 | 导出 loader |
| S16 | `packages/platform/skill/src/artifex_nexus/skill/conflict/detector.py` | `core/version_manager.py` (§`detect_layer_conflicts`, `compare_skill_dirs`) | ~120 | **低** | 纯复制 |
| S17 | `packages/platform/skill/src/artifex_nexus/skill/conflict/__init__.py` | 新写 | ~10 | 全写 | 导出冲突检测 |
| S18 | `packages/platform/skill/src/artifex_nexus/skill/installer.py` | `core/skill_sync.py` + ToolManager `services/skill_service.py` (§install/uninstall/sync/publish) | ~600 | **高** | 组合 skill_sync 安装逻辑 + ToolManager skill_service 的业务逻辑；适配到 Artifex Nexus 路径 |
| S19 | `packages/platform/skill/src/artifex_nexus/skill/events.py` | 新写（event enum） | ~30 | 全写 | 定义 SkillEvent 枚举，先 log+callback |
| S20 | `packages/platform/skill/src/artifex_nexus/skill/categories.py` | `skills/categories.py` | ~40 | **低** | 复制 + 补充软件枚举 |

---

### 2.2 Tool 管理子系统（新包）

| # | 目标文件 (Artifex Nexus) | 源文件 (artclaw_bridge) | 行数 | 适配量 | 适配说明 |
|---|--------------------------|------------------------|------|--------|---------|
| T1 | `packages/platform/skill/src/artifex_nexus/skill/tool_registry.py` | ToolManager `services/tool_service.py` + `services/tool_scanner.py` | ~700 | **中** | 组合 ToolService + ToolScanner → 独立 `ToolRegistry` 类（不依赖 FastAPI） |
| T2 | `packages/platform/skill/src/artifex_nexus/skill/tool_installer.py` | ToolManager `services/tool_service.py` (§create/update/delete/publish) | ~300 | **中** | 从中拆出安装/发布逻辑 |

---

### 2.3 Sidecar RPC 接口

| # | 目标文件 (Artifex Nexus) | 源文件 (artclaw_bridge) | 行数 | 适配量 | 适配说明 |
|---|--------------------------|------------------------|------|--------|---------|
| R1 | `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/skill_rpc.py` | ToolManager `server/api/skills.py` + `server/api/tools.py` | ~500 | **高** | 将 FastAPI REST 端点转为 sidecar JSON-RPC handler；去掉 HTTP 相关 |
| R2 | `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py` | 已存在（修改） | +50 | **低** | 注册新 RPC 方法 |

---

### 2.4 Web UI 前端

| # | 目标文件 (Artifex Nexus) | 源文件 (artclaw_bridge) | 行数 | 适配量 | 适配说明 |
|---|--------------------------|------------------------|------|--------|---------|
| U1 | `packages/apps/web/src/lib/skill/skill-api.ts` | 新写 | ~150 | 全写 | 封装 invoke("skill.*") |
| U2 | `packages/apps/web/src/lib/tool/tool-api.ts` | 新写 | ~150 | 全写 | 封装 invoke("tool.*") |
| U3 | `packages/apps/web/src/app/skills/page.tsx` | 现有（修改） | ~+100 | **低** | 替换 mock → 真实 API |
| U4 | `packages/apps/web/src/components/skills/SkillCard.tsx` | 现有（修改） | ~+50 | **低** | 操作按钮接真实 API |
| U5 | `packages/apps/web/src/components/skills/ToolCard.tsx` | 现有（修改） | ~+50 | **低** | 操作按钮接真实 API |
| U6 | `packages/apps/web/src/components/shell/RightPanel.tsx` | 现有（修改） | ~+200 | **中** | D5 重构为上下文预览容器（事件驱动 + 渲染器注册表）；D2/D3 接真实 API |
| U7 | `packages/apps/web/src/components/shell/AppShell.tsx` | 现有（修改） | ~+30 | **低** | 新增 `PreviewContext.Provider` 全局暴露 `setPreview` / `clearPreview` |

---

### 2.5 配置管理

| # | 目标文件 (Artifex Nexus) | 源文件 (artclaw_bridge) | 行数 | 适配量 | 适配说明 |
|---|--------------------------|------------------------|------|--------|---------|
| C1 | `packages/platform/core/src/artifex_nexus/core/skill_config.py` | ToolManager `services/config_manager.py` | 150 | **中** | 线程安全 JSON 配置读写；路径 `~/.artclaw/config.json` → `~/.artifexnexus/config/skills.json` |

---

## 三、Skill/Tool 内容迁移清单

### 3.1 Official Skills（官方 Skill）

| Skill 名称 | 源路径 | DCC | 迁移 |
|-----------|--------|-----|------|
| `ue57-get-material-nodes` | `skills/official/unreal/ue57_get_material_nodes/` | UE5 | ✅ |
| `ue57-material-node-edit` | `skills/official/unreal/ue57_material_node_edit/` | UE5 | ✅ |
| `comfyui-node-installer` | `skills/official/comfyui/comfyui-node-installer/` | ComfyUI | ✅ |

### 3.2 Marketplace Skills（市集 Skill）

| Skill 名称 | 源路径 | DCC | 迁移 |
|-----------|--------|-----|------|
| `ue57-generate-material-documentation` | `skills/marketplace/unreal/ue57_generate_material_documentation/` | UE5 | ✅ |
| `ue57-viewport-capture` | `skills/marketplace/unreal/ue57_viewport_capture/` | UE5 | ✅ |
| `ue5-architecture` | `skills/marketplace/unreal/ue5-architecture/` | UE5 | ✅ |
| `ue5-debug-validation` | `skills/marketplace/unreal/ue5-debug-validation/` | UE5 | ✅ |
| `scene-vision-analyzer` | `skills/marketplace/universal/scene-vision-analyzer/` | Universal | ✅ |

### 3.3 Official Tools（官方 Tool）

| Tool 名称 | 源路径 | DCC | 迁移 |
|-----------|--------|-----|------|
| `artclaw-skill-compliance-checker` | `tools/official/universal/artclaw-skill-compliance-checker/` | Universal | ✅ |
| `tool-compliance-checker` | `tools/official/universal/tool-compliance-checker/` | Universal | ✅ |
| ~~`memory-promote-to-team`~~ | `tools/official/universal/memory-promote-to-team/` | Universal | ❌ 记忆管理 |

### 3.4 Marketplace Tools（市集 Tool）

| Tool 名称 | 源路径 | DCC | 迁移 |
|-----------|--------|-----|------|
| `Blender对象命名规范检查` | `tools/marketplace/blender/Blender对象命名规范检查/` | Blender | ✅ |
| `模型批量加前缀后缀` | `tools/marketplace/blender/模型批量加前缀后缀/` | Blender | ✅ |
| `SM命名检查` | `tools/marketplace/unreal/SM命名检查/` | UE5 | ✅ |
| `UV & 贴图利用率优化-UV重排` | `tools/marketplace/unreal/UV & 贴图利用率优化-UV重排/` | UE5 | ✅ |
| `UV & 贴图利用率优化-贴图裁切` | `tools/marketplace/unreal/UV & 贴图利用率优化-贴图裁切/` | UE5 | ✅ |
| `资产批量改名` | `tools/marketplace/unreal/资产批量改名/` | UE5 | ✅ |

---

## 四、关键适配点（跨文件一致修改）

### 4.1 路径替换

所有从 artclaw_bridge 复制的文件，统一做以下路径替换：

| 旧路径 | 新路径 |
|--------|--------|
| `~/.artclaw/` | `~/.artifexnexus/` |
| `~/.artclaw/config.json` | `~/.artifexnexus/config/skills.json` |
| `~/.openclaw/workspace/skills/` | `~/.artifexnexus/.openclaw/workspace/skills/` |
| `~/.artclaw/tools/` | `~/.artifexnexus/tools/` |

### 4.2 导入路径替换

| 旧 import | 新 import |
|-----------|-----------|
| `from core.version_manager import ...` | `from artifex_nexus.skill.version import ...` |
| `from core.skill_decorator import ...` | `from artifex_nexus.skill.decorator import ...` |
| `from core.skill_sync import ...` | `from artifex_nexus.skill.installer import ...` |
| `from cli.artclaw_bridge.skill_hub import ...` | `from artifex_nexus.skill.hub import ...` |
| `from cli.artclaw_bridge.manifest import ...` | `from artifex_nexus.skill.manifest import ...` |
| `from ..core.config import settings` | `from artifex_nexus.core.skill_config import ...` |
| `from ..models.data import SkillData` | `from artifex_nexus.skill.hub.instance import SkillInfo` |
| `from ..services.config_manager import ConfigManager` | `from artifex_nexus.core.skill_config import SkillConfig` |

### 4.3 命名收敛

| artclaw_bridge 名称 | Artifex Nexus 名称 | 说明 |
|---------------------|-------------------|------|
| `@artclaw_tool` | `@tool`（`@artclaw_tool` 为别名） | ADR 0003 |
| `artclaw_bridgeConfig` | `SkillConfig` | 配置类 |
| `SkillData` | `SkillInfo` | 运行时信息 |
| `ToolData` | `ToolInfo` | 运行时信息 |
| `ScannedSkill` | `SkillEntry` | 扫描中间结果 |
| `ScannedTool` | `ToolEntry` | 扫描中间结果 |
| `VersionManager` | 拆分为 `SkillRegistry` + `version.parser` | SDK 拆分 |
| `skill_hub` (模块) | `artifex_nexus.skill.hub` | 包重命名 |
| `settings` (ToolManager) | 合并到 `artifex_nexus.core.skill_config` | 配置统一 |

### 4.4 架构差异适配

| 差异点 | artclaw_bridge | Artifex Nexus | 适配方案 |
|--------|---------------|---------------|---------|
| Service 层 | FastAPI Service 类（依赖 HTTP request） | 纯 Python SDK（无 HTTP 依赖） | SkillService → SkillRegistry + SkillInstaller；ToolService → ToolRegistry + ToolInstaller |
| REST → RPC | FastAPI `@app.get("/api/skills")` | Sidecar JSON-RPC `rpc.register("skill.list", handler)` | 拆出 handler 函数 + 注册 |
| 多平台适配 | `platforms/openclaw/` `platforms/cursor/` ... | 仅 OpenClaw | 删掉 cursor/lobster/claudecode/workbuddy 适配器 |
| 配置读取 | `~/.artclaw/config.json` | `~/.artifexnexus/config/skills.json` | 全局替换 |
| DCC 检测 | health_check.py 探测 UE/Maya 等 | 已独立（bootstrap.py + doctor.py） | 不迁移 health_check.py |
| UE 集成 | 大量 unreal.* 导入 | UE 插件独立包 | Skill 代码内保留 `import unreal`（运行时条件导入） |

---

## 五、排除清单（不迁移）

| 文件/模块 | 原因 |
|-----------|------|
| `core/memory_core.py` (2309 行) | 记忆管理，不在 M4/M5 范围 |
| `core/retry_tracker.py` (354 行) | 依赖 memory_core |
| `core/bridge_core.py` (916 行) | 已独立为 gateway-ws.ts + mcp_bridge.py |
| `core/bridge_config.py` (1007 行) | 已独立为 bootstrap.py + config_io.py |
| `core/bridge_diagnostics.py` (239 行) | 已独立为 doctor.py |
| `core/device_auth.py` (150 行) | 已独立为 sidecar auth |
| `core/health_check.py` (517 行) | 已独立为 doctor.py |
| `core/integrity_check.py` (249 行) | 已独立为 deploy 校验 |
| `core/mcp_server.py` (302 行) | 已迁移到 `packages/dcc/blender/.../mcp_server.py` |
| `core/tool_event_writer.py` (184 行) | 已由 Chat ToolCall 组件替代 |
| `core/tool_manager_launcher.py` (239 行) | 已由 sidecar.py 替代 |
| `core/interfaces/` | 已由 `packages/dcc/blender/.../base_adapter.py` 替代 |
| `platforms/*/` (全部) | 仅需要 OpenClaw，已独立实现 |
| `tools/official/universal/memory-promote-to-team/` | 记忆管理 Tool |
| `memory/` 目录 | 记忆管理 |
| `team_memory/` 目录 | 记忆管理 |
| `subprojects/ArtClawToolManager/`（整体 FastAPI 服务） | 不需要独立 HTTP 服务器；功能已由 Sidecar RPC + Web UI 替代 |
| `subprojects/DCCClawBridge/` | 已迁移到 `packages/dcc/blender/` |
| `subprojects/UnityClawBridge/` | Unity 项目，单独维护 |

---

## 六、实施阶段

### 阶段 1: SDK 核心（5 天）

```
Day 1:  decorator (S2-S3) + manifest models (S4-S6)
         └─ 先让 @tool 和 manifest 可用
Day 2:  version (S11-S12) + categories (S20) + events (S19)
         └─ 版本解析和基础枚举
Day 3:  hub (S7-S10)
         └─ SkillHub 运行时（加载/执行/查询）
Day 4:  registry (S13) + conflict (S16-S17)
         └─ 查询/匹配/冲突检测
Day 5:  installer (S18) + loader (S14-S15)
         └─ 安装/卸载/同步/发布
```

### 阶段 2: Tool 子系统（2 天）

```
Day 6:  tool_registry (T1)
         └─ Tool 发现/查询/执行
Day 7:  tool_installer (T2)
         └─ Tool 创建/删除/发布
```

### 阶段 3: Sidecar RPC + 配置（1.5 天）

```
Day 8:  skill_config (C1) + RPC handler (R1)
Day 9:  sidecar 注册 (R2) + 测试
```

### 阶段 4: Web UI 接线（2 天）

```
Day 10: skill-api.ts (U1) + tool-api.ts (U2)
Day 11: Skill/Tool 页面替换 mock (U3-U5)
```

### 阶段 5: Skill/Tool 内容迁移（1.5 天）

```
Day 12: 迁移官方 + 市集 Skill（3 official + 5 marketplace = 8 个）
Day 13: 迁移官方 + 市集 Tool（2 official + 6 marketplace = 8 个）
```

---

## 七、风险与缓解

| # | 风险 | 缓解 |
|---|------|------|
| 1 | `core/skill_sync.py` 依赖 artclaw_bridge 的 project_root 发现逻辑 | 适配为 Artifex Nexus 的 `workspace/skills/` 结构 |
| 2 | ToolManager `skill_scanner.py` 的 `_scan_source_directories()` 依赖 `skills/{layer}/{dcc}/{name}/` 目录结构 | 已确认 Artifex Nexus skills/ 目录结构兼容 |
| 3 | Sidecar RPC 未提供 `invoke` 注册机制 | 需在 `sidecar.py` 先确认 RPC 注册入口 |
| 4 | `@tool` 装饰器在 DCC 环境（Blender/UE）需要支持主线程标记 | 从 mcp_server.py 的 `register_tool(main_thread=True)` 获取 inspiration |
| 5 | 大量文件复制导致导入路径不一致 | 统一用 sed 脚本批量替换 + CI 校验 |

---

## 八、待确认项（已全部确认 ✅）

1. **[x] sidecar.py RPC 注册机制**
   **结论**：无需 `rpc.register()` API。sidecar.py 使用**纯 dict 注册**模式：
   ```python
   # 1. 写 handler 函数
   def _handle_skill_list(req_id, params) -> dict: ...
   # 2. 加入 METHOD_TABLE
   METHOD_TABLE["skill.list"] = _handle_skill_list
   ```
   主循环 `main()` 读 stdin → `json.loads()` → `handle_request()` → 查 METHOD_TABLE → 调用 handler。
   新增 `skill.*` / `tool.*` 方法只需：写 `skill_rpc.py` handler 函数 + 在 `sidecar.py` 导入并加入 METHOD_TABLE。

2. **[x] `platform/core` event_bus**
   **结论**：尚不存在。`packages/platform/core/src/artifex_nexus/core/__init__.py` 仅含 `__version__ = "0.0.0"`。
   **决策**：事件总线不与本次 Skill/Tool 任务耦合。Skill 内部事件通过 `events.py` 的 `SkillEvent` 枚举 + 直接 log 实现，后续 M6+ 再迁移到 event_bus。

3. **[x] `packages/platform/skill/` pyproject.toml**
   **结论**：✅ 依赖声明已就绪：
   ```toml
   dependencies = [
       "artifex-nexus-core",
       "artifex-nexus-contracts",
       "pydantic>=2.8",     # ✅ pydantic v2
       "packaging>=24.0",   # ✅ 版本比较
   ]
   ```
   无需额外修改，可直接开始开发。

4. **[x] Tauri invoke 通道**
   **结论**：✅ 通道已通。完整调用链：
   ```
   前端 invoke("command_name", params)
   → Tauri Rust #[tauri::command] async fn
   → manager.call("method.name", json!({...}))
   → SidecarClient JSON-RPC over stdio
   → sidecar.py handle_request() → METHOD_TABLE 分发
   ```
   新增 `skill.*` / `tool.*` 方法需要三步：
   - ① `commands/` 下加 `#[tauri::command]` 函数（可新建 `commands/skill.rs`）
   - ② `lib.rs` `generate_handler![]` 注册
   - ③ 前端 `invoke("skill_list", { filters })` 调用

---

## 相关文档

- `[[../../research/artclaw-tool-manager-skill-tool-survey]]` — 调研报告
- `[[../../specs/skill-system]]` — Skill 子系统设计
- `[[../../decisions/0003-mcp-tools-minimization]]` — MCP 最小化 ADR
- `../../tasks/backlog/EPIC-0004-m4-skill-system.md`
- `../../tasks/backlog/EPIC-0005-m5-tool-system.md`
