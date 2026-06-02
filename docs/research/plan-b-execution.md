# 方案 B 完整执行计划

> 决策：方案 B（删除 systemPromptOverride，启用 OpenClaw 标准引导文件机制）
> + 设置面板扩展支持 .md 文件可视化编辑
> + 安装/重装/备份/恢复链路全链路同步
>
> 日期：2026-06-01 | 版本：v1.0

---

## 1. 改动范围总览

| 层 | 改动 |
|---|---|
| **Python wrapper** | preset 模板重写、新增 AGENTS.md 资产、bootstrap 改为预置 4 文件、PRESET_VERSION→3.0.0、新增 workspace 文件 RPC |
| **Sidecar (RPC)** | 新增 `openclaw.workspace.list_identity_files` / `read_file` / `write_file` |
| **Tauri 桥** | 转发新 RPC、新增 `open_workspace_folder` 命令 |
| **前端 IPC** | 新增 4 个 IPC 函数 + 类型 |
| **Reducer** | 移除 systemPromptOverride 编辑（迁移到 .md 文件）|
| **UI** | Agent Tab 重构：identity 字段（name/theme/emoji）+ 4 个 .md Tab 编辑器 + 打开 Workspace 目录按钮 + 刷新按钮 |
| **备份/恢复** | `_AGENT_IDENTITY_FILES` 加入 `AGENTS.md`；恢复时验证文件完整性 |

---

## 2. 资产文件设计

### 2.1 内容分流原则

| 原 systemPromptOverride 内容 | 新位置 |
|---|---|
| "你是 Artifex Nexus 平台的默认智能助手" | **AGENTS.md** → `## Session Startup` |
| 平台定位、能力板块概览 | **AGENTS.md** → `## Session Startup` |
| Web UI 四面板布局 | **AGENTS.md** → `## 平台界面` |
| Skill 与 Tool 系统说明 | **AGENTS.md** → `## Skill 与 Tool 系统` |
| MCP 连接与 DCC 操作约定 | **AGENTS.md** → `## MCP 连接与 DCC 操作` |
| 安全边界 | **AGENTS.md** → `## Red Lines`（OpenClaw postCompactionSections 默认重注入） |
| 沟通风格 | **SOUL.md** → `## 沟通风格`（已有部分内容，补充） |

### 2.2 文件清单

| 文件 | 路径 | 用途 | 类型 |
|---|---|---|---|
| `AGENTS.md` | `assets/agents/workspace/AGENTS.md` | 平台知识、调用约定、安全边界 | **新增（必需文件）** |
| `IDENTITY.md` | `assets/agents/workspace/IDENTITY.md` | Nex 的名字/性格/emoji | 保留（可选文件） |
| `SOUL.md` | `assets/agents/workspace/SOUL.md` | 核心信条 + 沟通风格 | 保留（增强） |
| `USER.md` | `assets/agents/workspace/USER.md` | 用户称呼/时区 | 保留（可选文件） |
| ~~`artifex-nexus.system-prompt.txt`~~ | ~~`assets/agents/`~~ | ~~systemPromptOverride 字符串~~ | **删除** |

### 2.3 新 preset 模板

```json
{
  "id": "artifex-nexus",
  "default": true,
  "name": "Artifex Nexus (Default Agent)",
  "workspace": "{{OPENCLAW_WORKSPACE}}",
  "agentRuntime": { "id": "pi" },
  "identity": {
    "name": "Nex",
    "theme": "Artifex Nexus 平台默认助手",
    "emoji": "🔗"
  },
  "reasoningDefault": "on",
  "thinkingDefault": "adaptive",
  "verboseDefault": "on",
  "toolProgressDetail": "explain"
}
```
**关键变化**：
- ❌ 删除 `systemPromptOverride`
- ✅ 新增 `identity` 结构化字段（驱动渠道功能：mention 匹配、响应前缀、头像派生）
- 其余字段不变

### 2.4 PRESET_VERSION 升级 → 3.0.0

旧版（2.0.0）安装的 agent 重装后会触发"用户改过"检测：
- 如果用户**没改过**（lock checksum 一致）→ 自动升级到 3.0.0
- 如果用户**改过**（添加了自定义字段）→ 提示用户在设置面板「重置为默认」
- 备份恢复后的 agent 不受影响（用户数据优先）

---

## 3. Python wrapper 改动

### 3.1 `agent_preset.py`

| 改动 | 内容 |
|---|---|
| `PRESET_VERSION` | `"2.0.0"` → `"3.0.0"` |
| `_SYSTEM_PROMPT_FILE` | 删除常量 + `_read_system_prompt()` 函数 |
| `render_v1_0_0()` | 删除 `system_prompt` 参数、`{{SYSTEM_PROMPT_JSON}}` 替换逻辑 |
| 文档字符串 | 更新说明：v3.0.0 改用 OpenClaw 标准引导文件机制 |

### 3.2 `bootstrap.py`

| 改动 | 内容 |
|---|---|
| `_AGENT_IDENTITY_FILES` | `["IDENTITY.md", "SOUL.md", "USER.md"]` → `["AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md"]`（恢复 AGENTS.md，但现在有真实模板） |
| `_WORKSPACE_IDENTITY_FILES` | 同上 → 4 个文件 |
| `_install_workspace_identity_files()` | 不变（已经是"目标不存在才写"的安全逻辑） |
| 注释 | 说明 AGENTS.md 现在指代 agent workspace 内的文件，与项目根 AGENTS.md 区分 |

### 3.3 `sidecar.py` 新增 3 个 RPC

```python
# 1. 列出 workspace 中的 identity 文件（含元数据）
openclaw.workspace.list_identity_files
  params: { agentId?: str, openclaw_home?: str }
  returns: {
    workspace: "/abs/path/to/workspace",
    files: [
      { name: "AGENTS.md", exists: true, size: 1234, mtime: "2026-06-01T12:00:00Z" },
      ...
    ]
  }

# 2. 读取 workspace 中的某个文件
openclaw.workspace.read_file
  params: { agentId?: str, filename: str, openclaw_home?: str }
  returns: { content: "...", mtime: "..." }

# 3. 写入 workspace 中的某个文件
openclaw.workspace.write_file
  params: { agentId?: str, filename: str, content: str, openclaw_home?: str }
  returns: { success: true, mtime: "..." }
```

**安全约束**：
- `filename` 必须在白名单 `["AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md", "TOOLS.md"]` 之内
- 不允许路径穿越（包含 `..` / 绝对路径 → 拒绝）
- 文件大小上限：100 KB（防止恶意写入）

---

## 4. Tauri 桥改动

### 4.1 新增 Rust 命令

```rust
// 转发到 sidecar 的 3 个 RPC
list_workspace_identity_files(agentId?, openclaw_home?)
read_workspace_file(agentId?, filename, openclaw_home?)
write_workspace_file(agentId?, filename, content, openclaw_home?)

// 系统级：在文件管理器中打开 workspace 目录
open_workspace_folder(workspace_path)
```

`open_workspace_folder` 用 `tauri::api::shell::open()` 或 `opener::open()`，跨平台。

---

## 5. 前端 IPC + Reducer 改动

### 5.1 `packages/apps/web/src/ipc/openclaw.ts` + `apps/desktop/src/ipc/openclaw.ts`

新增 4 个函数 + 类型（两个文件保持同步）：
```typescript
export interface WorkspaceIdentityFile {
  name: string;
  exists: boolean;
  size: number;
  mtime: string;
}
export interface WorkspaceFilesResult {
  workspace: string;
  files: WorkspaceIdentityFile[];
}

listWorkspaceIdentityFiles(agentId?): Promise<WorkspaceFilesResult>
readWorkspaceFile(filename: string, agentId?): Promise<{content: string; mtime: string}>
writeWorkspaceFile(filename: string, content: string, agentId?): Promise<{success: boolean}>
openWorkspaceFolder(path: string): Promise<void>
```

### 5.2 `settings.reducer.ts`

| 改动 | 内容 |
|---|---|
| `agentPresets` 字段 | 删除 `systemPromptOverride`（不再编辑）|
| `dumpToState` | 不再读 `systemPromptOverride`（如有则 ignore + 提示）|
| `buildPatchFromState` | 不再写 `systemPromptOverride` |
| 新增 state | `workspaceFiles: {[filename]: string}`（编辑中的 .md 文件内容缓存） |
| 新增 action | `LOAD_WORKSPACE_FILE_SUCCESS` / `UPDATE_WORKSPACE_FILE` / `SAVE_WORKSPACE_FILE_SUCCESS` |

### 5.3 兼容性处理

如果 dump 返回的 agent 还带有旧的 `systemPromptOverride`（升级前用户）：
- 加载时显示警告卡片："检测到 systemPromptOverride（已弃用），建议迁移到 IDENTITY/SOUL/USER.md，或在设置面板清空。"
- 提供"一键迁移"按钮（把 override 内容写入 AGENTS.md，然后清空 override）

---

## 6. UI 设计

### 6.1 Agent Tab 新结构

```
┌─ Agent 设置 ─────────────────────────────────────────┐
│ [刷新] [打开 Workspace 目录] [重置为默认]              │
│ ─────────────────────────────────────────────────── │
│ 已注册 Agent（1）                                     │
│                                                     │
│ ┌─ Artifex Nexus (Default Agent) [默认] ─────────┐  │
│ │ 基本信息                                          │  │
│ │ 名称 [Artifex Nexus...]   ID [artifex-nexus]     │  │
│ │                                                  │  │
│ │ 身份（identity，结构化字段）                       │  │
│ │ 名字 [Nex]  主题 [Artifex...]  Emoji [🔗]        │  │
│ │ 这些字段驱动 OpenClaw 渠道功能（mention/头像/前缀）│  │
│ │                                                  │  │
│ │ 模型                                              │  │
│ │ Model [...]  Image Model [...]                  │  │
│ │                                                  │  │
│ │ 运行时行为                                        │  │
│ │ Thinking / Reasoning / Verbose / Tool Progress  │  │
│ │                                                  │  │
│ │ ─ Workspace 引导文件 ──────────────────────── │  │
│ │ [AGENTS.md] [IDENTITY.md] [SOUL.md] [USER.md]   │  │
│ │ ┌────────────────────────────────────────────┐  │  │
│ │ │ # AGENTS - Artifex Nexus 平台约定           │  │  │
│ │ │ ## Session Startup                          │  │  │
│ │ │ ...                                         │  │  │
│ │ │ (Markdown 编辑器，800字符提示)               │  │  │
│ │ └────────────────────────────────────────────┘  │  │
│ │ 当前 1234 / 12000 字符 · 上次修改 2026-06-01    │  │
│ │ [保存此文件]                                      │  │
│ └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 6.2 关键 UI 元素

1. **顶栏新增 2 个按钮**：
   - 「刷新」(RefreshCw) → `loadConfig()`
   - 「打开 Workspace 目录」(FolderOpen) → `openWorkspaceFolder(preset.workspace)`

2. **identity 字段编辑**：3 个 Input（name / theme / emoji）

3. **删除「系统提示词（人格信息）」textarea**，替换为 **Workspace 文件 Tab 编辑器**：
   - 子 Tab：AGENTS.md / IDENTITY.md / SOUL.md / USER.md
   - 内容用 `<textarea>` 编辑（首版不引入富文本/Monaco，避免依赖膨胀）
   - 每个文件独立「保存此文件」按钮（增量保存，不必整体提交）
   - 显示当前字符数 / 上限（12000 字符警告）
   - 文件不存在时显示「该文件未创建，点击创建」按钮

---

## 7. 备份恢复同步

### 7.1 当前备份逻辑（已有）

`bootstrap.py::_create_backup()` 中已用 `_AGENT_IDENTITY_FILES` 备份这些文件。**只需把 `AGENTS.md` 加入列表**，备份逻辑自动覆盖。

### 7.2 恢复逻辑

`_restore_agents()` 中复制回 workspace 目录，**逻辑不变**，只需确保 `_AGENT_IDENTITY_FILES` 包含 4 个文件。

### 7.3 兼容旧备份

- 旧备份只有 3 个文件（无 AGENTS.md）→ 恢复后 AGENTS.md 缺失 → bootstrap 的 `_install_workspace_identity_files` 会自动补齐默认 AGENTS.md（"仅在目标文件不存在时写入"）
- ✅ 无破坏性

### 7.4 重装流程

```
1. 用户点击「重装」
2. _create_backup 备份 4 个 .md 文件 + memory + plugins
3. _clean_install 清空 OpenClaw 目录
4. install_openclaw 安装新版
5. bootstrap:
   a. _create_directory_layout
   b. _install_workspace_identity_files（补齐 4 个默认文件）
   c. agent_preset.install_default_preset（PRESET_VERSION=3.0.0）
6. _restore_agents（用户原 4 个 .md 文件覆盖默认）
   ↑ 关键：用户的自定义内容**最终生效**
7. _restore_plugins_and_memory
```

---

## 8. 实施步骤（按依赖排序）

| # | 任务 | 文件 | 时长 | 依赖 |
|---|---|---|---|---|
| **T1** | 新增 AGENTS.md 资产 | `assets/agents/workspace/AGENTS.md` | 15 min | - |
| **T2** | 增强 SOUL.md（加沟通风格） | `assets/agents/workspace/SOUL.md` | 5 min | - |
| **T3** | 重写 preset 模板（删 systemPromptOverride + 加 identity） | `assets/agents/artifex-nexus.preset.json.tpl` | 5 min | - |
| **T4** | 删除 `system-prompt.txt` 资产 | `assets/agents/artifex-nexus.system-prompt.txt` | 1 min | T3 |
| **T5** | `agent_preset.py`：升级 PRESET_VERSION + 简化 render | `agent_preset.py` | 10 min | T3 |
| **T6** | `bootstrap.py`：扩展 `_AGENT_IDENTITY_FILES` / `_WORKSPACE_IDENTITY_FILES` 至 4 个 | `bootstrap.py` | 5 min | T1 |
| **T7** | `sidecar.py`：新增 3 个 workspace 文件 RPC | `sidecar.py` | 20 min | T6 |
| **T8** | Tauri Rust：转发 3 个 RPC + `open_workspace_folder` | `src-tauri/...` | 15 min | T7 |
| **T9** | 前端 IPC：4 个函数 + 类型（dual 同步） | `ipc/openclaw.ts` × 2 | 10 min | T8 |
| **T10** | reducer：移除 systemPromptOverride 编辑、新增 workspaceFiles state | `settings.reducer.ts` | 15 min | T9 |
| **T11** | UI 重构 Agent Tab：identity 字段 + .md 编辑器 + 顶栏按钮 | `SettingsPage.tsx` | 30 min | T10 |
| **T12** | 兼容性提示（检测旧 systemPromptOverride 给迁移按钮） | `SettingsPage.tsx` | 10 min | T11 |
| **T13** | QA 终审 | - | 15 min | All |

**总计：约 2.5 小时**

---

## 9. 风险与回滚

### 9.1 主要风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| AGENTS.md 内容设计不充分 → AI 平台知识不足 | 中 | 中 | 把原 systemPromptOverride 内容完整迁移 + 加 Session Startup / Red Lines 分节 |
| 旧用户 systemPromptOverride 数据丢失 | 中 | 高 | UI 检测到旧字段时**保留不动**并提供「迁移」按钮，用户主动操作才清空 |
| 4 个 .md 文件 + identity 字段交互复杂 | 中 | 中 | UI Tab 切换 + 独立保存 + 字符数提示 |
| 备份恢复 4 个文件兼容旧备份（只有 3 个） | 低 | 低 | bootstrap 补齐默认 AGENTS.md 兜底 |
| sidecar 文件读写安全性 | 低 | 高 | 白名单 + 路径穿越检查 + 大小上限 |

### 9.2 回滚预案

如果发现严重问题：
- 把 `PRESET_VERSION` 降回 `"2.0.0"`
- 还原 `assets/agents/system-prompt.txt`
- 还原 `preset.json.tpl` 的 `systemPromptOverride` 字段
- UI 改动可保留（删除 systemPromptOverride 编辑这块用 feature flag 控制）

---

## 10. QA 审核清单

### 数据正确性
- [ ] AGENTS.md 内容完整覆盖原 systemPromptOverride 知识点
- [ ] preset 模板 JSON 解析无错
- [ ] PRESET_VERSION = "3.0.0"
- [ ] identity 字段格式符合 OpenClaw schema

### 不破坏性
- [ ] 旧用户的 systemPromptOverride 不会被静默删除
- [ ] 备份恢复 4 个文件正常
- [ ] OpenClaw 升级路径平滑

### UI 完整性
- [ ] 4 个 .md 文件 Tab 切换正常
- [ ] 字符数计数正确
- [ ] 「打开 Workspace 目录」打开系统文件管理器
- [ ] 「刷新」按钮触发 loadConfig
- [ ] 旧 systemPromptOverride 检测到时给迁移按钮

### 安全
- [ ] 文件白名单生效
- [ ] 路径穿越被拒绝
- [ ] 文件大小上限生效

### 规范
- [ ] 双 IPC 文件同步
- [ ] 所有写入走 `openclaw config patch --stdin`
- [ ] 无新增 `as any` 逃生
