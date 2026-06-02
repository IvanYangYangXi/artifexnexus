---
id: STORY-0041
kind: story
title: OpenClaw 重装流程重构（备份-全新安装-恢复）
status: backlog
priority: P2
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-14
parent: "[[../backlog/EPIC-0004-m4-skill-system]]"
milestone: M4
related_packages:
  - "packages/adapters/openclaw"
  - "packages/apps/web"
  - "apps/desktop"
tags: [story, openclaw, reinstall, backup, restore, migration, M4]
---

# STORY-0041 · OpenClaw 重装流程重构（备份-全新安装-恢复）

## 用户故事
重装 OpenClaw 时能保留用户之前配置的 API Key、Agent 设置、插件、MCP 服务器、自定义 Skill 和记忆，避免每次重装后手动重新配置。

## 背景

> **bootstrap.py 是安装/重装脚本**。位于 `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/bootstrap.py`，负责初始化 `~/.artifexnexus/.openclaw/` 目录布局、生成 `openclaw.json`、安装默认 agent 预设和 MCP Bridge 插件。

当前重装流程使用"就地合并"策略（`_apply_preserve_options`），存在以下问题：

1. ~~**路径漂移**~~（✅ v4.2 已修复）：`_migrate_auth_profiles_files()` 已处理 `state/agents/` → `.openclaw/agents/` 迁移，新路径凭证文件正常。旧路径残留可忽略。

2. **残留污染**（❌ 仍存在，2026-05-14 查证）：
   - 3 个 `.bak` 文件（`openclaw.json.bak` × 2 + `state/cron/jobs.json.bak`）
   - 8 个 `openclaw.json.rejected.*` 文件（2026-05-11 配置写入密集失败遗留）
   - bootstrap.py 无任何清理逻辑，每次重装累积更多垃圾

3. **记忆保留**（⚠️ 事实存在但非设计保障，2026-05-14 查证）：
   - `state/memory/artifex-nexus.sqlite`（720K）和 `workspace/memory/` 梦境数据当前完好
   - 但仅因为 bootstrap 的 `_create_directory_layout()` 不删已有目录 —— 纯属侥幸
   - `_apply_preserve_options()` 只合并 `openclaw.json` 配置，**不备份文件级数据**
   - 如果未来实现"彻底清理"或清理 .bak/rejected 时扫到 memory 目录，数据面临丢失风险
   - 核心缺失：**主动备份机制**，而非依赖"恰好不删"的隐式行为

## 设计：三阶段重装

```
Phase 1: BACKUP → Phase 2: CLEAN INSTALL → Phase 3: RESTORE
```

**核心规则**：先备份到 `~/.artifexnexus/` 下（不在 `.openclaw/` 内），然后**删除整个 `.openclaw/` 目录**，再全新 `bootstrap()`。这样最干净，彻底解决残留污染。

### Phase 1: BACKUP

备份目标：`~/.artifexnexus/backups/<timestamp>/`（新增备份目录，与 `.openclaw/` 完全隔离）

按勾选项收集（5 项，Provider 和 Auth 合并为一条）：

| 保留项 | 备份的数据源 | 存储位置 / 字段格式 |
|--------|-------------|---------------------|
| 供应商配置 + API 凭据 | **openclaw.json** → `models.providers`（baseUrl/apiKey/models）+ `auth.profiles` + `auth.order`；**文件** → `auth-profiles.json`（新旧双路径） | `models.providers.<id>.apiKey`（内联）或 `auth-profiles.json[].token`；Gateway 读 `state/agents/`，CLI 读 `.openclaw/agents/`，双路径均备份 |
| Agent 配置 | **openclaw.json** → `agents.list[]`（id/name/workspace/agentRuntime/skills/systemPromptOverride）+ `agents.defaults`；**文件** → 每个 agent 的独立工作空间 `workspace-<agent名>/` 下的人格文件（AGENTS.md / IDENTITY.md / SOUL.md / USER.md / TOOLS.md / HEARTBEAT.md） | `agents.list[].workspace` 指向对应目录；通过遍历 `agents.list[]` 推导出需要备份的工作空间目录列表 |
| 插件配置 + Memory | **openclaw.json** → `plugins.entries` 全部条目（browser / file-transfer / memory-core / mcp-bridge 及用户手动启用的其他插件）；**文件** → `state/memory/*.sqlite` + `workspace/memory/`（梦境数据） | `plugins.entries.<pluginId>.enabled` + `.config`；**不备份** `plugins/installs.json`（OpenClaw 可通过 `registry --refresh` 重建） |
| MCP 服务器配置 | **openclaw.json** → `plugins.entries.mcp-bridge.config.servers` **全部条目**（不限于预装的 blender-editor，用户添加的所有 MCP server 连接全部保留） | `servers.<name>.type`（websocket/stdio）+ `.url` / `.command` + `.enabled` |
| Skill | **文件** → `workspace/skills/` **整个目录**（扁平结构，源码端的 official/team/user 分类在安装到 .openclaw 后不存在，每个子目录 = 一个 skill） | `plugin-skills/` 下是 plugin-bundled skill 的 symlink（无需备份） |

输出：`backup-manifest.json`（记录每个备份文件的来源、目标路径、时间戳）

### Phase 2: CLEAN INSTALL

1. 停止 Gateway
2. **删除整个 `~/.artifexnexus/.openclaw/` 目录**（不保留任何内容）
3. 重新 `bootstrap()`（生成全新 openclaw.json + 目录结构）
4. → 残留污染**自动消除**（.bak / .rejected / 死 run/ 全部随目录删除）

### Phase 3: RESTORE

按 `backup-manifest.json` 逐项恢复到新版本**正确的路径**：

- **供应商配置 + API 凭据**（合并恢复）：
  - `models.providers` → `openclaw config patch` 写入新 `openclaw.json`
  - `auth.profiles` + `auth.order` → 同步写入 `openclaw.json`
  - `auth-profiles.json`（新旧双路径兼容）：
    - 恢复时同时写入新路径 `.openclaw/agents/<id>/agent/auth-profiles.json` **和**旧路径 `state/agents/<id>/agent/auth-profiles.json`
    - 背景：Gateway embedded agent 走 `state/agents/`，CLI 走 `.openclaw/agents/`，两者可能读到不同文件
    - 备份时从两条路径都尝试读取（新路径优先，旧路径 fallback）
- **Agent 配置**：
  - `agents.defaults` + `agents.list[]` → patch 写入 `openclaw.json`
  - 独立工作空间 → 遍历 `agents.list[].workspace` 路径，原位复制各 agent 的人格文件
- **插件配置 + Memory**：
  - `plugins.entries`（全部条目，不限于 4 个核心插件）→ 合并写入 `openclaw.json`
  - memory SQLite → 写入 `state/memory/`
  - `workspace/memory/` → 原位复制回去
- **MCP 服务器配置**（全部 servers，不限于预装条目）→ 合并 `openclaw.json` → `plugins.entries.mcp-bridge.config.servers`
- **Skill** → 复制 `workspace/skills/` 整个目录回原位（扁平结构，不区分 official/team/user）
- 验证（`openclaw doctor --json`）→ `openclaw plugins registry --refresh`（重建 `installs.json`）
- 成功后删除 `backups/<timestamp>/`
- 重启 Gateway

## 勾选项 → 备份文件/路径 ↔ openclaw.json 字段 完整映射表

以下两张表覆盖了 STORY-0041 的所有实现细节，是 `bootstrap.py` 和 `sidecar.py` 的编码依据。

### 表 A：勾选项 → 备份文件/路径 映射表

| # | 勾选项 | 勾选 key | 备份的文件/路径 | 备份方式 | 恢复方式 |
|---|--------|----------|----------------|---------|---------|
| 1 | 供应商配置 + API 凭据 | `preserveProvidersAndAuth` | `{home}/openclaw.json` → `models.providers` + `auth.profiles` + `auth.order` 三个字段的 JSON 快照 | `json.dumps` 到 `backups/<ts>/config-providers-auth.json` | `openclaw config patch` 逐字段写入新 openclaw.json |
| | | | `{home}/.openclaw/agents/<id>/agent/auth-profiles.json`（CLI 读的新路径） | 文件复制到 `backups/<ts>/auth-new/` | 写回 `.openclaw/agents/<id>/agent/auth-profiles.json` |
| | | | `{home}/state/agents/<id>/agent/auth-profiles.json`（Gateway 读的旧路径） | 文件复制到 `backups/<ts>/auth-legacy/` | 写回 `state/agents/<id>/agent/auth-profiles.json` |
| 2 | Agent 配置 + 工作空间 | `preserveAgents` | `{home}/openclaw.json` → `agents.list` + `agents.defaults` 两个字段的 JSON 快照 | `json.dumps` 到 `backups/<ts>/config-agents.json` | `openclaw config patch` 写入新 openclaw.json |
| | | | `{home}/workspace-<agent名>/` 下人格文件（AGENTS.md / IDENTITY.md / SOUL.md / USER.md / TOOLS.md / HEARTBEAT.md） | 文件复制到 `backups/<ts>/agent-workspaces/<agent名>/` | 原位复制回 `workspace-<agent名>/` |
| | | | `{home}/workspace/` 下人格文件（同上 6 个文件，默认 agent） | 同上 | 同上 |
| 3 | 插件配置 + Memory | `preservePluginsAndMemory` | `{home}/openclaw.json` → `plugins.entries` 全部条目的 JSON 快照 | `json.dumps` 到 `backups/<ts>/config-plugins.json` | 合并写入：读新 openclaw.json 的 `plugins.entries`，逐条目补充备份中的条目（新默认已存在的保留默认，新默认没有的从备份追加） |
| | | | `{home}/state/memory/*.sqlite` | 文件复制到 `backups/<ts>/memory/` | 写回 `state/memory/` |
| | | | `{home}/workspace/memory/` 整个目录 | 目录复制到 `backups/<ts>/workspace-memory/` | 原位复制回 `workspace/memory/` |
| 4 | MCP 服务器配置 | `preserveMCPServers` | `{home}/openclaw.json` → `plugins.entries.mcp-bridge.config.servers` 字段的 JSON 快照 | `json.dumps` 到 `backups/<ts>/config-mcp-servers.json` | 合并写入：读新 openclaw.json 的 `plugins.entries.mcp-bridge.config.servers`，用备份中的 servers 替换新默认的 servers（用户添加的全部保留，预装的 blender-editor 按用户配置覆盖） |
| 5 | Skill | `preserveSkills` | `{home}/workspace/skills/` 整个目录（扁平结构，每个子目录 = 一个 skill） | 目录复制到 `backups/<ts>/skills/` | 原位复制回 `workspace/skills/` |

### 表 B：勾选项 → openclaw.json 字段读写映射表

恢复时，`openclaw.json` 需要按勾选项精确读取和写入对应字段。

| # | 勾选项 | openclaw.json JSON 路径 | 备份时读取 | 恢复时写入策略 | 恢复时写入路径 |
|---|--------|------------------------|-----------|--------------|--------------|
| 1 | 供应商配置 + API 凭据 | `models.providers` | ✅ 读取完整对象 | **全量替换**：用备份值覆盖新默认值 | `models.providers` |
| | | `auth.profiles` | ✅ 读取完整对象 | **全量替换** | `auth.profiles` |
| | | `auth.order` | ✅ 读取完整对象 | **全量替换** | `auth.order` |
| 2 | Agent 配置 + 工作空间 | `agents.list` | ✅ 读取完整数组 | **全量替换**（用户 agent 列表完全保留） | `agents.list` |
| | | `agents.defaults` | ✅ 读取完整对象 | **全量替换** | `agents.defaults` |
| 3 | 插件配置 + Memory | `plugins.entries` | ✅ 读取完整对象 | **合并策略**：新默认中已有的条目保留，新默认没有的条目从备份追加 | `plugins.entries` |
| 4 | MCP 服务器配置 | `plugins.entries.mcp-bridge.config.servers` | ✅ 读取完整对象 | **合并策略**：读新 openclaw.json 中的 servers → 用备份中的同名 server 替换/新增 | `plugins.entries.mcp-bridge.config.servers` |
| | | ⚠️ 与 #3 的关系 | | 如果 #3 已勾选，`plugins.entries` 全量合并已包含 servers → #4 跳过。仅 #4 单独勾选时独立恢复 servers | |
| 5 | Skill | （无） | — | 不涉及 openclaw.json | — |

### 恢复时字段冲突处理规则

勾选项之间存在字段重叠时，按以下优先级和顺序恢复：

```
恢复顺序：1 → 2 → 3 → 4 → 5

- #3 和 #4 重叠在 `plugins.entries.mcp-bridge.config.servers`
  → 两处都勾选时：#3 已处理全部 plugins.entries（含 mcp-bridge），#4 跳过
  → 仅 #4 勾选时：读当前 openclaw.json 的 plugins.entries → 找到 mcp-bridge 条目 → merge servers

- #1 单独读 `auth.profiles/order` → 不与任何其他勾选项重叠
- #2 单独读 `agents.list/defaults` → 不与任何其他勾选项重叠
```

### 当前 UI 勾选项状态

共 5 条勾选项（Provider + Auth 合并为一条，备份和恢复同时处理）：

```
[x] 供应商配置 + API 凭据                  — baseUrl、API Key、模型列表、auth profiles（含双路径 auth-profiles.json）
[ ] Agent 配置 + 工作空间                  — Agent 预设、system prompt + 各 agent 独立 workspace 文件
[x] 插件配置 + Memory                      — 全部启用插件（不限于 4 个核心）+ AI 长期记忆/梦境数据
[ ] MCP 服务器配置                          — mcp-bridge 下全部外部 MCP server 连接（不限于预装的 blender-editor）
[ ] Skill                                  — workspace/skills/ 全部 skill（扁平结构，不区分 official/team/user）
```

### 系统页备份恢复子页（新增）

除了重装时的自动备份恢复，在系统页新增「数据管理」子页，提供手动操作：

| 功能 | 说明 |
|------|------|
| **备份配置** | 手动导出 providers / auth / agent / plugins 到 `~/.artifexnexus/backups/` |
| **恢复配置** | 从已有 backup 恢复配置到当前 `.openclaw/` |
| **备份记忆** | 手动导出 memory SQLite + 梦境数据 |
| **恢复记忆** | 从已有 backup 恢复记忆数据 |
| **列出备份** | 查看所有 backup 的时间戳、大小、包含项 |
| **删除备份** | 清理旧备份释放空间 |

子页通过 Tauri IPC → sidecar RPC → bootstrap.py 的函数调用实现。

## 数据布局参考（v2026.5.4 实测 ~/.artifexnexus/.openclaw/）

```
~/.artifexnexus/.openclaw/
├── openclaw.json                              # 主配置
│   ├── models.providers.<id>                  # baseUrl / apiKey / models
│   ├── auth.profiles / auth.order             # 旧 auth 方式（可能被废弃）
│   ├── agents.list[]                          # Agent id / name / workspace / agentRuntime / skills / systemPromptOverride
│   ├── agents.defaults                        # 默认 agent 设置
│   ├── plugins.entries.<pluginId>             # 全部插件 enabled + config
│   └── plugins.entries.mcp-bridge.config.servers  # MCP server 连接
├── .openclaw/                                 # CLI 运行时状态（v2026.5.4 新）
│   ├── agents/<id>/agent/auth-profiles.json   # 凭证文件（新路径，CLI 读）
│   ├── agents/<id>/sessions/                  # 会话历史
│   ├── plugin-skills/                         # plugin-bundled skill symlink（无需备份）
│   ├── plugins/installs.json                  # 全量插件注册表（OpenClaw 自动生成，无需备份）
│   ├── openclaw.json                          # 内层配置（OpenClaw 自管）
│   └── identity/ / logs/ / cron/ / flows/ / tasks/
├── state/                                     # 旧版运行时状态（大量重复 .openclaw/ 内容）
│   ├── agents/<id>/agent/auth-profiles.json   # 凭证文件（旧路径，Gateway embedded agent 读）
│   ├── agents/<id>/agent/auth-state.json      # Auth 状态
│   ├── agents/<id>/sessions/                  # 会话数据（.jsonl / .trajectory.jsonl）
│   ├── memory/<agent>.sqlite                  # memory-core SQLite
│   ├── plugin-skills/                         # 同上 symlink
│   ├── plugins/installs.json                  # 同上 auto-generated
│   └── deploy-manifest.json / session-delivery-queue/ / browser/ / ...
├── workspace/                                 # 默认 agent "artifex-nexus" 工作空间
│   ├── .openclaw/workspace-state.json         # 工作空间引导状态
│   ├── AGENTS.md / IDENTITY.md / SOUL.md / USER.md / TOOLS.md / HEARTBEAT.md / DREAMS.md
│   ├── memory/                                # 梦境数据
│   │   ├── .dreams/{events.jsonl,phase-signals.json,session-corpus/,short-term-recall.json}
│   │   └── dreaming/{deep,light,rem}/         # 梦境整理 markdown
│   └── skills/                               # 扁平结构，每个子目录 = 一个 Skill
├── workspace-<agent名>/                       # 每个额外 agent 的独立 workspace（路径从 agents.list[].workspace 推导）
│   ├── .openclaw/workspace-state.json
│   ├── AGENTS.md / IDENTITY.md / SOUL.md / USER.md / TOOLS.md / HEARTBEAT.md
│   └── .git/（可选）
├── extensions/                                # 扩展目录
├── plugin-skills/ / plugins/                  # 根级镜像（无需备份）
├── cron/ / logs/
└── cli/v2026.5.4/                             # CLI 安装（不清理、不备份）
```

### 备份/恢复关键规则

| 数据 | 备份策略 | 原因 |
|------|----------|------|
| `plugins/installs.json` | ❌ 不备份 | OpenClaw 通过 `registry --refresh` 自动重建 |
| `plugin-skills/` | ❌ 不备份 | 全是 symlink → bunded plugin skills，重装后重建 |
| `cli/` | ❌ 不备份 | 安装/重装脚本负责，体积大（~200MB+） |
| `workspace/skills/` | ✅ 全部备份 | 扁平结构，每个子目录 = 一个 Skill |
| `workspace-<agent>/` | ✅ 人格文件备份 | 每个 agent 独立 workspace，不可丢失 |
| `.git/` | ❌ 不备份 | agent workspace 下可能有 .git，非必要数据 |
| `state/` 下的重复内容 | 仅备份关键项 | `.openclaw/` 已包含大部分运行时状态的新版路径 |

## 解决方案（统一为"先备份再删除再安装"）

残留污染和记忆保留由统一的备份-删除-恢复流程解决，不再需要独立方案。

### 残留污染 → 整目录删除自然消除

Phase 2 删除整个 `.openclaw/` 后，所有 `.bak`、`.rejected.*`、`run/` 死文件随目录一起消失，无需额外清理逻辑。

### 记忆保留 → 纳入备份流程

记忆数据（`state/memory/*.sqlite` + `workspace/memory/`）在 Phase 1 与插件配置一起备份（UI 已合并为一条勾选项），Phase 3 原位恢复。

### bootstrap.py 改动

```
新增：
  _backup_for_reinstall(openclaw_home, preserve_options, backup_dir)
    → 读取 openclaw.json（models.providers + auth.profiles/order + agents.list/defaults + plugins.entries）
    → 读取 auth-profiles.json（新旧双路径）+ memory SQLite + 梦境数据
    → 遍历 agents.list[] 备份各 agent 独立 workspace 人格文件
    → 复制 workspace/skills/ 整个目录 + plugins.entries.mcp-bridge.config.servers
    → 复制到 ~/.artifexnexus/backups/<timestamp>/
    → 生成 backup-manifest.json

  _restore_from_backup(openclaw_home, backup_dir, manifest)
    → 按 manifest 逐项恢复：config patch 写 openclaw.json + auth 双路径写入 + Skill/workspace 原位复制
    → 验证 SQLite 完整性 / config 有效性
    → openclaw plugins registry --refresh（重建 installs.json）

  _clean_install(openclaw_home)
    → shutil.rmtree(.openclaw/)（已在 Phase 2 描述）

修改：
  bootstrap() — 不再需要 _apply_preserve_options() 的"就地合并"
    旧流程: bootstrap() + 合并旧配置 → 新旧混杂
    新流程: _backup → rm -rf .openclaw → bootstrap() → _restore → 干净

  _apply_preserve_options() — 可标记 deprecated，由 backup/restore 替代
```

### 系统页「数据管理」子页

```
系统页
├── 安装向导（现有，含运行时状态）
├── Gateway 控制（现有）
└── 数据管理（新增）
    ├── 备份数据 → 选择要备份的类别 → 执行备份
    ├── 恢复数据 → 选择 backup → 预览内容 → 执行恢复
    ├── 备份列表 → 时间戳 / 大小 / 内容摘要 / 删除按钮
    └── 重装 OpenClaw → 一键触发 Phase 1→2→3 完整流程
```

### 前置依赖：模型/Provider 信息存储方式优化

> **这两个任务必须在「模型/Provider 信息存储方式优化」完成后才能做。**
>
> 原因：当前 auth 信息分散在 `openclaw.json`（auth.profiles）和 `auth-profiles.json` 两个文件中，路径不统一（`state/agents/` vs `.openclaw/agents/`）。如果不先统一为内联 `apiKey` 方式（直接写入 `models.providers.<id>.apiKey`），备份恢复时会面临：
> - 备份时需要同时读取两个文件 → 容易遗漏
> - 恢复时需要判断写入哪个文件 → 逻辑复杂
> - 旧路径残留 → 恢复后 CLI 和 Gateway 可能读到不同文件
>
> 统一后的好处：备份只需读 `openclaw.json` 一个文件，恢复只需 `openclaw config patch` 一条命令，干净简单。

## 涉及文件

- `bootstrap.py` — 新增 `_backup_for_reinstall()` / `_restore_from_backup()`，废弃 `_apply_preserve_options()`
- `packages/apps/web/src/components/settings/` — Provider 存储优化（前置）+ 重装 UI 调整（新增 MCP / Skill 勾选项）
- `packages/apps/web/src/components/system/` — 新增「数据管理」子页（备份/恢复/重装/列表/删除）
- `packages/apps/web/src/ipc/openclaw.ts` — 新增 backup/restore/list-backups/delete-backup IPC
- `apps/desktop/src-tauri/src/commands/` — 新增对应 Tauri 命令

## 执行顺序（依赖链）

```
模型/Provider 信息存储方式优化（前置阻断）
        ↓
bootstrap.py 重构（backup/restore 替代 _apply_preserve_options）
        ↓
系统页「数据管理」子页（手动备份/恢复/重装 UI）
```

## 优先级

**前置阻断**：必须先完成「模型/Provider 信息存储方式优化」（统一为内联 `apiKey`），否则备份恢复 auth 信息时路径混乱（`state/agents/` vs `.openclaw/agents/` 双路径不一致）。

M4 前期。三个子任务按依赖链顺序执行：
1. ~~路径漂移~~（✅ v4.2 已解决）
2. **模型/Provider 存储优化**（前置依赖，阻断 STORY-0041）
3. **bootstrap.py 重构**（backup/restore 替代 preserve，依赖 #2）
4. **数据管理子页**（前端 UI，依赖 #3）

## 附加问题（同 STORY 一起解决）

### 模型/Provider 信息存储方式优化

**当前问题**：
- 前端 Settings UI 使用 `auth.profiles` + `auth.order` + 独立 `auth-profiles.json` 的复杂多文件方式存储 API Key
- Gateway embedded agent 实际查找 auth 走的是 `state/agents/<id>/agent/auth-profiles.json`
- CLI 的 `models auth paste-token` 写的是 `.openclaw/agents/<id>/agent/auth-profiles.json`
- 两个路径不一致导致 CLI 能找到 token 但 Gateway 找不到

**参考旧版本**（`C:\Users\yangjili\.openclaw\openclaw.json`）：
- 旧版直接在 `models.providers.<id>.apiKey` 内联存储 token
- 简单、一个文件管理、Gateway 直接支持
- 新版也兼容这种方式（已验证 `infer model run` 成功）

**修复方案**：
1. bootstrap 生成的默认配置改用内联 `apiKey` 方式
2. Settings UI 保存 API Key 时直接 patch `models.providers.<id>.apiKey`（走 `openclaw config patch`）
3. 不再依赖 `auth-profiles.json` 文件（或作为 fallback）
4. 对齐旧版配置格式，provider id 用有意义的名称（如 `netease-codemaker`）而非 `custom`

## 关联

- STORY-0039：Chat/Gateway 连接问题（触发发现本问题）
- STORY-0020：原始 preserve 逻辑实现

## 查证记录（2026-05-14）

### 路径漂移 — ✅ 已修复

```
旧路径: state/agents/artifex-nexus/agent/auth-profiles.json
  内容: provider "custom-default"（旧命名，已过时）

新路径: .openclaw/agents/artifex-nexus/agent/auth-profiles.json
  内容: provider "netease-codemaker-default"（当前有效）
```

`bootstrap.py:_migrate_auth_profiles_files()` 使用 `shutil.copy2` 迁移，旧文件未自动删除但不影响功能。

### 残留污染 — ❌ 仍存在

实测环境残留文件清单：
```
openclaw.json.bak                                          # 1
.openclaw/openclaw.json.bak                                # 2
state/cron/jobs.json.bak                                   # 3
openclaw.json.rejected.2026-05-11T12-48-06-592Z            # 4
openclaw.json.rejected.2026-05-11T12-48-13-205Z            # 5
...（共 8 个 rejected 文件）
```

bootstrap.py 无任何清理逻辑（`grep "\.bak\|rejected\|clean\|rmtree" bootstrap.py` 仅返回 port-heal 场景的临时 .bak 创建和 rmdir 回滚，与清理无关）。

### 记忆保留 — ⚠️ 事实存在但无保障

```
state/memory/artifex-nexus.sqlite  720K  ← 当前幸存
workspace/memory/.dreams/                 ← 当前幸存
  ├── events.jsonl (34KB)
  ├── session-corpus/ (7 个 txt)
  └── short-term-recall.json (301KB)
workspace/memory/dreaming/{deep,light,rem}/  ← 空目录
```

幸存原因：bootstrap 的 `_create_directory_layout()` 只 `mkdir(parents=True)` 不删除已有目录。
风险：无显式备份恢复机制，`_apply_preserve_options()` 只处理 openclaw.json 合并。
