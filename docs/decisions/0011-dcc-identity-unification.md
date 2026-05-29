---
tags: [adr, accepted]
created: 2026-05-28
status: accepted
---

# ADR 0011 — DCC Identity 统一到 contracts/data/categories.json

## Context

Artifex Nexus 支持 10 个 DCC 软件（Blender、Unreal Engine、Maya、3ds Max、Houdini 等），
但 DCC 的 displayName、shortName、MCP Server 名称散落在 15+ 处硬编码：

| 位置 | 硬编码内容 |
|------|-----------|
| `sidecar.py` | `DCC_NAME_MAP`、`DCC_PORTS`、`SERVER_DCC_MAP` |
| `dcc_installer.py` | `DCC_DISPLAY`、`_EXPECTED_SERVERS` |
| `dcc_connections.py` | `_DCC_REGISTRY` displayName |
| `mcp_bridge.py` | `DCC_PORTS` |
| `bootstrap.py` | MCP Server URL 配置 |
| `gateway-plugin/index.ts` | `DEFAULT_DCC_SERVERS` |
| `SystemPage.tsx` | `DCC_DISPLAY_NAMES` |

这导致：
- 改一个 DCC 名字要改 5+ 个文件，极易遗漏
- MCP 连接页只显示 2 个 DCC（`startswith` 匹配 `"unreal-editor"` 失败）
- 前端 "UE"/"Max" 短名称、Sidebar 连接状态灯各用各的映射

## Decision

扩展 `contracts/data/categories.json`（已有 `display.software` 英文名），新增 `dcc` 节作为 DCC 身份元数据的**唯一来源**。

### 数据分层

| 数据 | 归属 | 理由 |
|------|------|------|
| `displayName`（英文） | `categories.json` | 已有 `display.software` |
| `shortName`（"UE", "Max"） | `categories.json` | 身份信息，各处引用 |
| `mcpServerId`（"unreal-editor"） | `categories.json` | 身份映射，前后端都需要 |
| 端口号（18080-18083） | 各插件/sidecar 保留 | 运行时配置，非契约 |
| 连接 URL（ws://...） | `openclaw.json` / bootstrap | 部署配置 |

### 新增的 `dcc` 节

```json
"dcc": {
  "blender":       { "shortName": "Blender", "mcpServerId": "blender-editor" },
  "unreal_engine": { "shortName": "UE",      "mcpServerId": "unreal-editor" },
  "maya":          { "shortName": "Maya",     "mcpServerId": "maya-primary" },
  "3ds_max":       { "shortName": "Max",      "mcpServerId": "max-primary" },
  "houdini":       { "shortName": "Houdini",  "mcpServerId": "houdini-primary" },
  "substance_painter":  { "shortName": "SP",   "mcpServerId": null },
  "substance_designer": { "shortName": "SD",   "mcpServerId": null },
  "comfyui":       { "shortName": "Comfy",    "mcpServerId": "comfyui-primary" },
  "unity":         { "shortName": "Unity",    "mcpServerId": "unity-primary" },
  "general":       { "shortName": "通用",       "mcpServerId": null }
}
```

### Python 访问

`categories.py` 新增 5 个函数：
- `get_dcc_display_name()` — 英文显示名
- `get_dcc_short_name()` — 短名称（状态栏徽标）
- `get_dcc_mcp_server_id()` — MCP Server 名称
- `find_dcc_by_mcp_server_id()` — 反向查找
- `get_all_dcc_mcp_servers()` — 所有有 MCP Server 的 DCC

### TypeScript 访问

前端 `SystemPage.tsx` 直接 `import categoriesData from "...contracts/data/categories.json"`，
通过 `getDccDisplayName()`/`getDccShortName()` 函数访问。

## Consequences

**优点**：
- 单一数据源：新增/修改 DCC 只需改 `categories.json` 一处
- MCP 连接页自动显示所有 DCC（不再遗漏 Maya/Max）
- 前后端统一命名，杜绝 "UE" vs "U" vs "Unreal Engine" 不一致
- 延续 ADR 0004 的 "Contracts as Source of Truth" 原则

**代价**：
- `categories.json` 文件增大（约 10 行）
- sidecar 需要额外注入 skill 包路径

**迁移影响**（10 个文件改动）：
| 文件 | 改动 |
|------|------|
| `categories.json` | 新增 `dcc` 节 |
| `categories.py` | 新增 5 个 getter + fallback |
| `sidecar.py` | 删除 DCC_NAME_MAP/SERVER_DCC_MAP，改用 categories |
| `dcc_installer.py` | DCC_DISPLAY → `get_dcc_display_name()` |
| `dcc_connections.py` | _DCC_REGISTRY displayName → 动态获取 |
| `SystemPage.tsx` | DCC_DISPLAY_NAMES → import categories.json |
| `gateway-plugin/index.ts` | 添加注释标记 |
| `mcp_bridge.py` | 无改动（端口保留） |
| `bootstrap.py` | 无改动（初始种子配置保留） |
| `docs/decisions/0011-*.md` | 本文档 |

## Alternatives Considered

- **新建 `dcc_identity.py` + `dcc-identity.ts` 双文件**：被拒，引入双源同步风险。
- **单一 TypeScript 文件**：被拒，Python 消费需要构建步骤。
- **全部放 backends 各自维护**：被拒，这正是要解决的问题。

## Links

- `[[0004-contracts-as-source-of-truth]]`
- `[[../../packages/platform/contracts/data/categories.json]]`
