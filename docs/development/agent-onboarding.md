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
> 完整的 SDK 文档在 `[[../sdk/README]]`，以下是最常用的扩展点。

### 6.1 接入新 DCC（3 步）

详见 `[[../sdk/dcc-installer]]` + `[[../sdk/dcc-registry]]`。

**Step 1**：在 `dccRegistry.ts` 注册 DCC 操作

```ts
dccRegistry["maya"] = { detect, install, uninstall };
```

**Step 2**：实现 sidecar RPC（Python 端）

```python
def find_maya_versions() -> List[str]: ...
def install_maya_addon(version: str) -> Dict: ...
```

**Step 3**：注册到 METHOD_TABLE

```python
"openclaw.dcc.maya.detect": _handle_openclaw_dcc_maya_detect,
```

注册后安装向导自动适配。

### 6.2 Blender 插件安装 API

详见 `[[../sdk/dcc-installer]]`。

### 6.3 Gateway MCP Bridge API

详见 `[[../sdk/mcp-bridge]]`。

### 6.4 DCC Adapter 接口

详见 `[[../sdk/dcc-adapter]]`。

### 6.5 关键注册表

详见 `[[../sdk/README]]` 注册表速查。

### 6.6 统一规范

- **DCC 插件安装**：`[[../specs/dcc-plugin-management]]`
- **MCP 协议**：`[[../specs/blender-mcp]]`
- **安装向导 UI**：`[[../specs/ui/installer-structure]]`

## 7. 故障排查

| 症状 | 原因 | 解法 |
|---|---|---|
| Agent 不按规则改代码 | 没读到规则文件 | 把 `.ai/rules/30-agent-behavior.md` 直接贴到对话 |
| Obsidian `[[wiki-link]]` 跳不到 `.ai/` 里的文件 | Vault 根指向了 `docs/` 而不是仓库根 | Vault 改为仓库根，Excluded files 排除 `node_modules/.git/dist/target` |
| Kanban 卡片信息太少 | 未开 Linked Page Metadata | Kanban board settings → Linked Page Metadata → 加 `status/priority/owner/estimate` |
| Agent 自作主张合并 done | 忽略了 done 仅由人类触发 | 在对话中重申："done 不能自己标" |
| Web 工程 Dialog/Popover/Sheet 看不见 / 动画失效 / dev 崩溃 | Tailwind v4 + pnpm workspace symlink + tailwindcss-animate 缺失 等 | 严格按 `[[web-frontend-setup]]` §4 接入清单走完 |

## 8. WorkBuddy 协作注意（双存储模型）

> **关键认知**：WorkBuddy 有自己的内存/任务系统（`~/.workbuddy/` + `.workbuddy/`），**与项目 Obsidian Vault（`docs/`）是两套独立体系**。
> 换用其他 AI 工具（Claude Code / Cursor / Copilot）时，WorkBuddy 的文件不会被读取。

### 8.1 两套存储的分工

```
─── WorkBuddy 体系（工具专属，换工具即丢失）───
~/.workbuddy/
├── SOUL.md           AI 人格定义
├── IDENTITY.md       身份标识
├── USER.md           用户画像
├── workbuddy.db      SQLite（automations 等）
├── teams/            多 Agent 团队配置
├── tasks/            WorkBuddy 内部任务（非项目任务）
└── mcp.json          MCP Server 配置

项目根/.workbuddy/
├── HANDOFF.md        会话接续提示词
├── memory/
│   ├── MEMORY.md     长期记忆（项目偏好/约定）
│   └── YYYY-MM-DD.md 每日工作日志
└── probe_sidecar.py  调试探针

─── 项目体系（工具无关，所有 AI 可读）───
docs/
├── tasks/            Obsidian Kanban 任务卡
├── specs/            架构/子系统设计
├── development/      开发规范/角色定义
├── decisions/        ADR 决策记录
├── inbox/            灵感/需求草稿
└── ...
```

### 8.2 文档写入铁律

| 写什么 | 落哪里 | 为什么 |
|--------|--------|--------|
| 项目方案/规格/ADR | `docs/specs/` / `docs/decisions/` | 工具无关，Obsidian Vault 可见 |
| 任务卡片（EPIC/STORY/TASK） | `docs/tasks/<status>/` | Kanban 系统驱动，所有工具可读 |
| 开发规范/角色定义 | `docs/development/` | 项目级约定，新人/AI 必读 |
| WorkBuddy 会话上下文 | `HANDOFF.md` | 换对话时粘贴，仅 WorkBuddy 用 |
| 项目偏好/用户约定 | `.workbuddy/memory/MEMORY.md` | WorkBuddy 跨会话记忆 |
| 调试日志/每日进展 | `.workbuddy/memory/YYYY-MM-DD.md` | 仅 WorkBuddy 需要的历史 |
| Python 调试脚本 | `.workbuddy/probe_sidecar.py` | 开发期探针，不进 docs |

### 8.3 WorkBuddy 特有的自动生成文件

WorkBuddy 会在执行任务时自动创建一些文件，**不要把它们当作项目文档**：

| 文件/目录 | 性质 | 说明 |
|-----------|------|------|
| `~/.workbuddy/artifact-index/` | 缓存 | 产物索引，自动生成 |
| `~/.workbuddy/traces/` | 缓存 | 执行跟踪，自动生成 |
| `~/.workbuddy/tasks/<uuid>/` | 内部任务 | WorkBuddy 内置任务系统 JSON |
| `~/.workbuddy/teams/<name>/` | 团队配置 | 多 Agent 团队定义 |
| `~/.workbuddy/blobs/` | 缓存 | 二进制缓存 |

### 8.4 跨工具协作实践

**场景 A：在 WorkBuddy 开发，换到 Claude Code 继续**

1. 确保所有项目级别文档都在 `docs/`（不在 `~/.workbuddy/`）
2. 复制 `.workbuddy/HANDOFF.md` 内容作为新对话首条消息
3. Claude Code 会自动读取 `CLAUDE.md` + `AGENTS.md`，无需额外配置

**场景 B：多个 AI 工具混用**

- 项目知识放 `docs/` — 这是唯一的事实来源
- WorkBuddy 专属内容（每日日志、会话记录）放 `.workbuddy/memory/` — 不需要其他工具知道
- 团队配置（`teams/`、`tasks/`）是 WorkBuddy 独有功能，其他工具没有等价物

### 8.5 HANDOFF.md 使用

`.workbuddy/HANDOFF.md` 是项目级的会话接续文件。当需要在 WorkBuddy 中开启新对话继续之前的工作时：

1. 复制 `HANDOFF.md` 中分隔线之间的全部内容
2. 粘贴到新对话的第一条消息
3. 它会包含：当前任务、已完成项、关键文件位置、下一步操作

该文件由 AI 在每次重大进展后更新，确保始终可用。

## 相关

- `[[sdd-workflow]]`
- `[[task-management]]`
- `[[team-roles]]` — 团队角色定义与协作流程
- `[[web-frontend-setup]]` — Web 工程接入 `@artifex-nexus/ui` 必读
- `[[../../.ai/rules/30-agent-behavior]]`
