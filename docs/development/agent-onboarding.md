---
tags: [dev, agent, onboarding]
created: 2026-05-03
status: accepted
---

# Agent 接入指南

> 面向：想在不同 AI 助手里协作开发本项目的人。目标：**新对话 30 秒内让 Agent 具备项目上下文**。

## 1. 两类 Agent 的差别

| 类型 | 能直接读项目文件？ | 做法 |
|------|-----------------|------|
| **本地 IDE/终端集成型**（Claude Code / Cursor / Copilot Chat / Codex / Aider …） | ✅ 能 | 仓内 onboarding 文件 **自动加载**，多数情况零配置 |
| **网页/聊天窗型**（Claude.ai / ChatGPT / Kimi / 通义 …） | ❌ 不能 | 必须手动上传或粘贴 |

## 2. 本地集成型 Agent 自动加载文件对照

| Agent | 自动读取 | 本仓是否已有 |
|---|---|---|
| Claude Code | `CLAUDE.md` + `.claude/` | ✅ |
| Cursor | `.cursor/rules/*.mdc` | ✅ |
| VS Code Copilot Chat | `.github/copilot-instructions.md` | ✅ |
| Codex / AGENTS.md 协议系 | `AGENTS.md` | ✅ |
| Aider | `--read CLAUDE.md`（手工指定） | 需命令行参数 |
| Continue.dev | `.continue/config.json` 的 `systemMessage` | 需用户配置一次 |

**结论**：主流工具打开本仓就已 onboard，无需每次手动喂文件。

## 3. 网页/聊天窗型的两种上手方式

### 3.1 Projects 知识库（推荐，一次配置长期生效）

Claude Projects / ChatGPT Projects / 通义智能体等都支持上传文件做长期知识库。上传以下 **10 个骨干文档** 即可：

```
CLAUDE.md
AGENTS.md
.ai/rules/00-architecture.md
.ai/rules/10-coding-style.md
.ai/rules/20-docs-workflow.md
.ai/rules/30-agent-behavior.md
.ai/context/project-overview.md
.ai/context/glossary.md
docs/development/sdd-workflow.md
docs/vision/north-star.md
```

### 3.2 单次对话开头粘贴（短提示词）

```
我在和你协作开发 Artifex Nexus 项目（AI Agent ↔ DCC 的桥）。

请严格遵守：
1) 接单先追问设计细节，每问给推荐答案（除非可以查代码或文档得出）。
2) 最小改动，不顺手重构；修 bug 先复现。
3) 文档 ≤ 2000 字/文件，代码 ≤ 500 行/文件（黄金区 100–300）。
4) 所有变更必须更新相关 spec/ADR 与交叉引用。
5) 回答中文；代码注释中文；公共 API docstring 中英双语。
6) 任务三级体系 EPIC → STORY → TASK；状态迁移必须同步三处
   （文件位置 / frontmatter.status / board.md 对应列，列名首字母大写）。
   不允许 Agent 自标 done。
7) 涉及 GUI 必须先写 docs/specs/ui/<module>-structure.md（信息架构 / 状态机 /
   线框 / 对接点），再写代码。设计语言由 M3 统一，之前不硬编码视觉。
8) 收到 /sdd triage|align|implement|done 口令时，按 SDD 流程执行
   （想法→任务→规格→实现→合并），任务载体在 docs/tasks/。

现在请接收任务：
<粘贴任务卡 md 全文或相关上下文>
```

## 4. SDD 口令速查

详细定义：`[[sdd-workflow]]`。

| 口令 | 含义 |
|---|---|
| `/sdd triage <inbox 文件>` | 想法 → 任务卡（落 `docs/tasks/backlog/`） |
| `/sdd align [[TASK-NNNN-...]]` | 任务 → 规格对齐（产 spec/ADR，迁 `ready/`） |
| `/sdd implement [[TASK-NNNN-...]]` | 规格 → 代码（迁 `in-progress/` → `review/`） |
| `/sdd done [[TASK-NNNN-...]]` | 合并 → 归档（迁 `done/`，追 changelog） |

## 5. OpenSpec 软链初始化（新机器必做）

OpenSpec 入口在 `openspec/`，但所有内容的真身在 `docs/`（单一信息源）。
为避免双源漂移，`openspec/changes/` 与 `openspec/specs/` 的实际文件由本机软链生成，
**不进 git**。

### 一键初始化

```bash
pnpm openspec:link        # 创建/刷新所有软链（首次拉仓后必跑）
pnpm openspec:check       # 仅验证不修改（CI / 健康检查）
pnpm openspec:clean       # 删除所有软链（仅删 link，不动 docs/ 真身）
```

### Windows 注意事项

- Node 的 `fs.symlinkSync` 在 Win 上**对文件需要管理员权限或开启"开发者模式"**
- 推荐：**设置 → 隐私和安全性 → 开发者选项 → 开发者模式开启**（一次性，无需管理员跑命令）
- 否则脚本会报 `EPERM`，请按提示二选一

### 链接清单维护

软链清单在 `scripts/setup-openspec-links.mjs` 顶部的 `LINKS` 常量。
新增 OpenSpec change 时手工加一条 `{ link, target, type, note? }` 即可。

### 故障排查

| 症状 | 解法 |
|---|---|
| `EPERM` 报错 | Win 开发者模式开启，或管理员权限运行 |
| `MISSING` 报错 | docs/ 里的目标文件路径错了，校对脚本里的 target |
| `DRIFT` 报错 | 软链指向不一致，再跑一次 `pnpm openspec:link` 自动修 |
| Obsidian 在 `openspec/` 看到的是空目录 | 你还没跑 link 脚本 |

## 6. SDK / API 快速开始

> Artifex Nexus 是对 artclaw 项目的重构，核心目标之一是建立**完善的 SDK 和通用 API**。
> 以下是最常用的扩展点。

### 6.1 接入新 DCC（3 步）

**Step 1**：在 `dccRegistry.ts` 注册 DCC 操作

```ts
// apps/desktop/src/features/installer/dccRegistry.ts
export const dccRegistry: Record<string, DCCActions> = {
  blender: { detect, install, uninstall },
  // 新增 Maya：
  maya: {
    detect: detectMayaVersions,
    install: (v) => installMayaAddon(v),
    uninstall: (v) => uninstallMayaAddon(v),
  },
};
```

**Step 2**：实现 sidecar RPC（Python 端）

```python
# packages/adapters/openclaw/wrapper/src/.../dcc_installer.py
def find_maya_versions() -> List[str]: ...
def install_maya_addon(version: str) -> Dict: ...
```

**Step 3**：注册到 METHOD_TABLE

```python
# sidecar.py METHOD_TABLE
"openclaw.dcc.maya.detect": _handle_openclaw_dcc_maya_detect,
"openclaw.dcc.maya.install": _handle_openclaw_dcc_maya_install,
```

注册后安装向导自动适配：检测按钮 → 子项填充 → 安装按钮 → 批量安装。

### 6.2 Blender 插件安装 API

**Python 端**（`dcc_installer.py`）：

```python
from artifex_nexus.openclaw_wrapper.dcc_installer import (
    find_blender_versions,        # → List[str]  扫描本机 Blender 版本
    install_blender_addon,        # → Dict       安装插件（junction/symlink/copy）
    uninstall_blender_addon,      # → Dict       卸载插件
    is_addon_installed,           # → bool       检查是否已安装
    get_addon_info,               # → Dict       读取 bl_info 元信息
    check_version_compatibility,  # → (bool, str) 版本兼容检查
    install_gateway_mcp_bridge,   # → Dict       部署 mcp-bridge 插件 + patch 配置
    is_gateway_mcp_bridge_installed,  # → bool
)
```

**TypeScript 端**（`dccRegistry.ts` + `ipc/openclaw.ts`）：

```ts
// 注册新 DCC（一行）
dccRegistry["maya"] = { detect: detectMayaVersions, install: installMayaAddon, uninstall: uninstallMayaAddon };

// IPC 函数
detectBlenderVersions(): Promise<BlenderDetectResult>
installBlenderAddon(version: string, force?: boolean): Promise<BlenderInstallResult>
uninstallBlenderAddon(version: string): Promise<BlenderUninstallResult>
```

**安装流程**：检测 → 版本兼容检查 → junction/symlink/copy → 自动部署 mcp-bridge → patch openclaw.json。

### 6.3 Gateway MCP Bridge API

**插件源码**：`packages/adapters/openclaw/gateway-plugin/`（`index.ts` + `openclaw.plugin.json`）

**部署**：`install_gateway_mcp_bridge()` 自动完成：
1. junction/symlink `gateway-plugin/` → `OPENCLAW_HOME/plugins/mcp-bridge/`
2. patch `openclaw.json`：`plugins.allow += "mcp-bridge"` + `plugins.entries.mcp-bridge`

**工具命名**：`mcp_{server-name}_{tool-name}`（如 `mcp_blender-editor_run_python`）

**新增 DCC Server**：在 `_patch_openclaw_config_for_mcp_bridge()` 的 `servers` 中添加条目即可。

### 6.4 接入新 MCP 工具（Gateway 侧）

```python
# packages/adapters/openclaw/wrapper/src/.../mcp_bridge.py
client = MCPBridgeClient.get_instance(host="127.0.0.1", port=8083)
result = client.call_tool("run_python", {"code": "print('hello')"})
```

### 6.5 DCC Adapter 接口

所有 DCC adapter 继承 `BaseDCCAdapter`（`packages/dcc/blender/src/.../base_adapter.py`）：

```python
class BaseDCCAdapter(ABC):
    def execute_code(self, code: str) -> Dict: ...      # 万能执行器
    def execute_on_main_thread(self, fn, *args): ...     # 主线程调度
    def get_selected_objects(self) -> List[Dict]: ...    # 上下文采集
    def get_scene_info(self) -> Dict: ...
```

### 6.6 关键注册表

| 注册表 | 位置 | 用途 |
|--------|------|------|
| `dccRegistry` | `apps/desktop/src/features/installer/dccRegistry.ts` | DCC 检测/安装/卸载 |
| `METHOD_TABLE` | `sidecar.py` | Sidecar JSON-RPC 方法路由 |
| `invoke_handler` | `apps/desktop/src-tauri/src/lib.rs` | Tauri command 注册 |
| `_tools` | `mcp_server.py` | MCP 工具注册（`register_tool()`） |
| `mcp-bridge servers` | `openclaw.json` → `plugins.entries.mcp-bridge.config.servers` | Gateway 侧 MCP 服务器连接 |

### 6.7 统一规范

- **DCC 插件安装**：`[[../specs/dcc-plugin-management]]` — 版本号格式、兼容范围、安装方式、目录结构
- **MCP 协议**：`[[../specs/blender-mcp]]` — WebSocket + JSON-RPC 2.0 + tools/list/call
- **安装向导 UI**：`[[../specs/ui/installer-structure]]` — 状态机、依赖门禁、子项行

## 7. 故障排查

| 症状 | 原因 | 解法 |
|---|---|---|
| Agent 不按规则改代码 | 没读到规则文件 | 把 `.ai/rules/30-agent-behavior.md` 直接贴到对话 |
| Obsidian `[[wiki-link]]` 跳不到 `.ai/` 里的文件 | Vault 根指向了 `docs/` 而不是仓库根 | Vault 改为仓库根，Excluded files 排除 `node_modules/.git/dist/target` |
| Kanban 卡片信息太少 | 未开 Linked Page Metadata | Kanban board settings → Linked Page Metadata → 加 `status/priority/owner/estimate` |
| Agent 自作主张合并 done | 忽略了 done 仅由人类触发 | 在对话中重申："done 不能自己标" |

## 相关

- `[[sdd-workflow]]`
- `[[task-management]]`
- `[[../../.ai/rules/30-agent-behavior]]`
