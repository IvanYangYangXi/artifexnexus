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
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_packages:
  - "packages/adapters/openclaw"
  - "packages/apps/web"
  - "apps/desktop"
tags: [story, openclaw, reinstall, backup, restore, migration, M3]
---

# STORY-0041 · OpenClaw 重装流程重构（备份-全新安装-恢复）

## 用户故事
重装 OpenClaw 时能保留用户之前配置的 API Key、Agent 设置、插件和记忆，避免每次重装后手动重新配置。

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

按勾选项收集：

| 保留项 | 备份的数据源 | 说明 |
|--------|-------------|------|
| 供应商 + API 凭据 | `openclaw.json` → `models.providers` 片段 + `.openclaw/agents/*/agent/auth-profiles.json` | 合并为一条（UI 已实现） |
| Agent 配置 | `openclaw.json` → `agents.defaults` + `agents.list` 片段 | |
| 插件配置 + 记忆 | `openclaw.json` → `plugins.entries` 片段 + `state/memory/*.sqlite` + `workspace/memory/` | 合并为一条（UI 已实现） |

输出：`backup-manifest.json`（记录每个备份文件的来源、目标路径、时间戳）

### Phase 2: CLEAN INSTALL

1. 停止 Gateway
2. **删除整个 `~/.artifexnexus/.openclaw/` 目录**（不保留任何内容）
3. 重新 `bootstrap()`（生成全新 openclaw.json + 目录结构）
4. → 残留污染**自动消除**（.bak / .rejected / 死 run/ 全部随目录删除）

### Phase 3: RESTORE

按 `backup-manifest.json` 逐项恢复到新版本**正确的路径**：

- providers/auth → `openclaw config patch` 写入新 `openclaw.json`
- `auth-profiles.json` → 写入 `.openclaw/agents/<id>/agent/`（新路径）
- memory SQLite → 写入 `state/memory/`
- `workspace/memory/` → 原位复制回去
- 验证（`openclaw doctor --json`）
- 成功后删除 `backups/<timestamp>/`
- 重启 Gateway

### 当前 UI 勾选项状态

已实现，插件配置和记忆合并为一条：

```
[x] 供应商配置 + API 凭据（Provider + Auth）  — baseUrl、API Key、模型列表
[ ] Agent 配置                                — Agent 预设、system prompt
[x] 插件配置 + Memory                         — MCP Bridge + AI 长期记忆/梦境数据
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

## 数据布局参考（v2026.5.4 实测）

```
~/.artifexnexus/.openclaw/
├── openclaw.json                              # 主配置
├── .openclaw/                                 # CLI 运行时状态（v2026.5.4 新）
│   ├── agents/<id>/agent/auth-profiles.json   # 凭证文件（新路径）
│   ├── identity/device.json
│   └── logs/
├── state/                                     # 旧版运行时状态
│   ├── agents/<id>/agent/auth-profiles.json   # 凭证文件（旧路径，可能被新版忽略）
│   ├── agents/<id>/sessions/                  # 会话历史
│   ├── memory/<agent>.sqlite                  # memory-core SQLite
│   └── plugin-skills/
├── workspace/
│   ├── memory/.dreams/                        # 梦境系统（session-corpus/）
│   ├── memory/dreaming/{deep,light,rem}/      # 梦境整理 markdown
│   └── skills/{official,team,user}/           # 用户技能
└── cli/v2026.5.4/                             # CLI 安装（不清理）
```

## 解决方案

### 方案 A：残留污染清理

在 `bootstrap.py` 新增 `_cleanup_residual_files(openclaw_home)` 函数，重装时自动调用：

```
重装时（preserve_options 非空时）自动清理：
  ✅ *.bak                    → 删除所有 .bak 文件
  ✅ *.rejected.*             → 删除所有 rejected 配置
  ✅ run/ 目录                → 清理空目录（ports.json / gateway.pid 等死文件）
  ✅ state/cron/jobs.json.bak → 删除

不清理：
  ❌ cli/                     → CLI 安装目录
  ❌ state/memory/            → 记忆数据
  ❌ workspace/memory/        → 梦境数据
  ❌ openclaw.json            → 当前配置
```

**实现要点**：
- 清理前打印报告：列出将删除的文件清单
- 日志输出 `[cleanup] removed N residual files (X .bak + Y .rejected + Z stale)`
- 放在 `bootstrap()` 流程 Step 3（读旧配置之后、生成新配置之前）

### 方案 B：记忆显式备份

在 `bootstrap.py` 新增 `_backup_memory()` / `_restore_memory()`，增强 `preserve_options`：

```
preserve_options 新增：
  preserveMemory: bool   → 是否保留 AI 长期记忆数据

Phase 1: BACKUP
  → _backup_memory() 将以下数据打包到 ~/.artifexnexus/.reinstall-backup/memory/
    ├── state/memory/artifex-nexus.sqlite    # memory-core SQLite（~720KB）
    ├── workspace/memory/.dreams/            # 梦境 corpus + events
    └── workspace/memory/dreaming/           # 梦境整理输出

Phase 3: RESTORE
  → _restore_memory() 原位写回
    ├── state/memory/*.sqlite   → state/memory/
    ├── workspace/memory/       → workspace/memory/
    └── 验证 SQLite 完整性（sqlite3 打开检查无 corrupt）

失败处理：
  - 备份失败 → 报告但继续安装（记忆丢失可接受，config 丢失不可接受）
  - 恢复失败 → 报告 + 保留 backup 供手动恢复
  - 安装成功 → 删除 backup 目录
```

**与现有行为的区别**：

| | 当前（隐式） | 方案 B（显式） |
|---|---|---|
| memory SQLite | 因 bootstrap 不删目录幸存 | 主动备份 → 安装后恢复 |
| 梦境数据 | 同上 | 同上 |
| 保障级别 | 侥幸，未来可能被清理逻辑误伤 | 显式设计，有 backup-manifest 追踪 |
| 清理重装兼容 | ❌ 如果 clean install 真的删目录，数据丢失 | ✅ cleanup 先备份，再清理，再恢复 |

**实现量估算**：`_backup_memory()` ~30 行 + `_restore_memory()` ~40 行 + UI 勾选项 1 个 toggle

- `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/bootstrap.py` — 重构 `bootstrap()` + 新增 `backup_for_reinstall()` / `restore_from_backup()`
- `packages/apps/web/src/components/settings/` — 重装 UI 增加"记忆"勾选项
- `packages/apps/web/src/ipc/openclaw.ts` — 新增 backup/restore IPC
- `apps/desktop/src-tauri/src/commands/` — 新增对应 Tauri 命令

## 优先级

M3 后期 / M4 前期。当前阻塞问题：
- **残留污染**为首要解决项（每次重装累积 .bak + .rejected 垃圾）
- **记忆显式备份**次之（当前靠隐式行为幸存，非长期方案）
- 路径漂移已在 v4.2 通过 `_migrate_auth_profiles_files()` 解决

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
openclaw.json.rejected.2026-05-11T12-48-1