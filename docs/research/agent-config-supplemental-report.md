# Agent 配置调研补充报告（第二轮）

> 补充调查：Reasoning/Verbose/Tool Progress Detail 字段含义、重装备份恢复逻辑、数据管理功能
> 时间：2026-06-01

---

## 1. Reasoning / Verbose / Tool Progress Detail 字段详解

### 1.1 reasoningDefault — 推理可见性

| 属性 | 详情 |
|---|---|
| **作用** | 控制 AI 推理过程的**可见性**。当模型支持推理（如 o3、deepseek-r1 等 reasoning 模型）时，决定用户能否看到模型的"思考链" |
| **有效值** | `"off"`：不显示推理过程（只给最终答案）<br>`"on"`：显示完整推理过程<br>`"stream"`：流式显示推理过程（实时逐 token 输出） |
| **来源** | OpenClaw 上游 schema `agents.list[].reasoningDefault` |
| **默认值** | Artifex Nexus 预设为 `"on"`（让用户看到推理过程） |
| **用户是否应修改** | ✅ 是 — 高级用户/开发者可能想看推理链；普通用户可能想关掉以简洁输出 |

### 1.2 verboseDefault — 输出详细程度

| 属性 | 详情 |
|---|---|
| **作用** | 控制 AI 输出的**详细程度**。影响：工具调用的解释文字量、步骤说明的详尽度、中间状态报告的频率 |
| **有效值** | `"off"`：精简输出（只给核心内容）<br>`"on"`：标准详细输出（默认平衡）<br>`"full"`：最详细输出（含所有中间步骤、调试信息） |
| **来源** | OpenClaw 上游 schema `agents.list[].verboseDefault` |
| **默认值** | Artifex Nexus 预设为 `"on"` |
| **用户是否应修改** | ✅ 是 — 取决于用户偏好。调试时可能需要 `"full"`，日常使用 `"on"` 即可 |

### 1.3 toolProgressDetail — 工具执行进度展示

| 属性 | 详情 |
|---|---|
| **作用** | 控制工具执行进度的**显示格式**。当 Agent 执行工具（如 run_python、文件操作等）时，决定如何向用户展示进度 |
| **有效值** | `"explain"`：用人类可读的方式解释工具正在做什么（如"正在 Blender 中创建网格…"）<br>`"raw"`：显示工具的原始输出/日志 |
| **来源** | OpenClaw 上游 schema `agents.list[].toolProgressDetail` |
| **默认值** | Artifex Nexus 预设为 `"explain"` |
| **用户是否应修改** | ⚠️ 可选 — `"explain"` 适合大多数场景；开发者调试时可能需要 `"raw"` 查看原始输出 |

### 1.4 关于"是否有必要让用户修改"

**结论：三位字段都有必要让用户修改，但优先级不同。**

- **Reasoning / Verbose** — **强烈建议保留可编辑**。这直接影响 AI 交互体验。有些用户希望看到推理过程、有些希望简洁。需求因人而异。
- **Tool Progress Detail** — **可保留但重要性较低**。默认 `"explain"` 已经足够好，只有调试场景才需要切换到 `"raw"`。
- 这三个字段在 OpenClaw 官方配置示例中都被列为 **"per-agent override"**，明确设计意图就是支持按 Agent/按用户粒度覆盖。

---

## 2. OpenClaw 重装备份恢复逻辑验证

### 2.1 整体流程

```
用户触发「重装/恢复」
  ↓
Phase 0: 停止 Gateway
  ↓
Phase 1: backup (create_full_snapshot + _backup_for_reinstall)
  ↓ Phase 2: _clean_install (删除整个 .openclaw/)
  ↓ Phase 2: install CLI + bootstrap (全新安装)
  ↓ Phase 3: _restore_from_backup (恢复备份数据)
```

### 2.2 备份阶段（Phase 1）

**模式 A：选择性备份（用户可选 5 类数据）**

| 备份项 | 备份内容 | 备份路径 |
|---|---|---|
| preserveProvidersAndAuth | `models.providers` + `auth` | `backups/<ts>/config-providers-auth.json` |
| preserveAgents | `agents.list` + `agents.defaults` + workspace 人格文件 | `backups/<ts>/config-agents.json` + `agent-workspaces/` |
| preservePluginsAndMemory | `plugins.entries` + `state/memory/*.sqlite` + `workspace/memory/` + sessions | `backups/<ts>/config-plugins.json` + `memory/` + `workspace-memory/` + `agent-sessions/` |
| preserveMCPServers | `plugins.entries.mcp-bridge.config.servers` | `backups/<ts>/config-mcp-servers.json` |
| preserveSkills | `workspace/skills/` 整目录 | `backups/<ts>/skills/` |

**模式 B：全量安全网快照（自动 + 手动均触发）**
- 在每次备份前自动执行，路径 `~/.artifexnexus/full-snapshots/<timestamp>/`
- 保留最近 3 份
- 排除 `cli/`（可重新下载，200MB+）、`state/browser/`（Chromium 用户数据巨大）、`.git/`

### 2.3 恢复阶段（Phase 2-3）

恢复顺序按优先级：

1. **providersAuth** → `_restore_providers_auth` → 走 `config patch --stdin`（正常路径）
2. **agents** → `_restore_agents` → **直接读写 openclaw.json**（异常路径）
3. **pluginsAndMemory** → `_restore_plugins_and_memory` → 合并策略 + 文件复制
4. **mcpServers** → `_restore_mcp_servers` → 合并策略（仅当 #3 未勾选）
5. **skills** → 文件复制

### 2.4 发现的问题

| # | 问题 | 严重程度 | 详细说明 |
|---|---|---|---|
| **B1** | `_restore_agents` 直接修改 `openclaw.json` 而非走 `config patch` | P2 | 代码注释说是因为"agents.list 是保护配置，config patch 会拒绝写入"。但如果用户仅在设置面板修改 agent 并保存，用的是 `config patch --stdin --replace-path agents.list`，这是**可以成功的**。实际上 Artifex Nexus 的预设注入也走 `config patch`。绕过 schema 校验直接写文件有风险 |
| **B2** | 恢复成功后自动删除备份 | P3 | `_handle_openclaw_restore` 第 2035 行：`shutil.rmtree(str(backup_dir_resolved), ignore_errors=True)`。这意味着如果用户恢复后不满意，无法再从同一个备份恢复。好在每次都同时创建 full-snapshot 安全网 |
| **B3** | `_AGENT_IDENTITY_FILES` 包含 3 个幽灵文件 | P2 | 已在第一轮报告中指出。备份时这 3 个文件不存在，会静默跳过（不报错），但 restore 时不会恢复（因为没备份自然没恢复） |
| **B4** | `_clean_install` 用 `shutil.rmtree` 删整个 `.openclaw/` | P3 | 极端情况下如果 Windows 文件锁导致部分文件删不掉，`ignore_errors=True` 会静默跳过，可能导致后续 bootstrap 写文件时与残留文件冲突 |
| **B5** | agents 恢复不校验 checksum | P3 | `_restore_agents` 直接替换整个 `agents` 字段，不做内容校验。如果备份的 config-agents.json 已损坏，可能导致 openclaw.json 的 agents 节点不可用 |

### 2.5 备份恢复综合评价

| 维度 | 评分 | 说明 |
|---|---|---|
| **备份完整性** | 🟢 优秀 | 5 类选择性备份 + 全量安全网双重保障 |
| **SQLite 备份安全性** | 🟢 优秀 | 优先用 sqlite3 backup API（跨进程一致性快照），回退文件拷贝 |
| **文件锁容错** | 🟢 优秀 | `_safe_copy_file` 有 Windows 共享读写回退逻辑 |
| **全量安全网** | 🟢 优秀 | 自动保留最近 3 份，排除大体积无关目录 |
| **恢复安全性** | 🟡 良好 | B1(agent 直写) 是已知权衡，B2(成功删备份) 有安全网兜底 |
| **整体可依赖性** | 🟢 可靠 | 正常使用场景完全可靠 |

---

## 3. 数据管理功能验证

### 3.1 UI 功能清单

系统页 → 数据管理 Tab（`DataManagementTab`）：

| 功能 | 状态 | 实现路径 |
|---|---|---|
| 备份数据按钮 | ✅ | 弹窗选 5 项 → `ipc.backupOpenClaw(preserveOptions)` |
| 备份列表展示 | ✅ | `ipc.listOpenClawBackups()` → 卡片列表 |
| 恢复备份 | ✅ | 确认 → `ipc.restoreOpenClaw({backupTimestamp, preserveOptions})` |
| 删除备份 | ✅ | 确认 → `ipc.deleteOpenClawBackup(timestamp)` |
| 刷新列表 | ✅ | 重新调用 `listOpenClawBackups()` |

### 3.2 数据流

```
[UI] → invoke("openclaw_backup", options)
       → [Tauri Rust] → manager.call(...)
         → [Python sidecar] → _handle_openclaw_backup()
           → create_full_snapshot()  // 全量安全网
           → _backup_for_reinstall()  // 选择性备份
           → 写入 ~/.artifexnexus/backups/<ts>/

[UI] → invoke("openclaw_backups_list")
       → [sidecar] _handle_openclaw_backups_list()
         → 扫描 ~/.artifexnexus/backups/*/backup-manifest.json
         → 返回 [{timestamp, items, total_size_bytes, ...}]

[UI] → invoke("openclaw_backups_delete", {timestamp})
       → [sidecar] _handle_openclaw_backups_delete()
         → shutil.rmtree(backups/<ts>)
```

### 3.3 功能正确性评估

| 检查项 | 结论 | 备注 |
|---|---|---|
| 备份文件路径 | ✅ `~/.artifexnexus/backups/<timestamp>/` | 独立于 `.openclaw/`，重装不丢 |
| manifest 格式 | ✅ `backup-manifest.json` | 含 `items` / `skipped` / `timestamp` |
| 备份列表排序 | ✅ 按时间倒序 | 最新的排最前 |
| 备份大小计算 | ✅ 支持缓存（5min TTL） | `_get_backups_cache()` + 缓存失效 |
| 删除确认 | ✅ 有确认弹窗 | "删除后不可恢复" |
| 重装流程集成 | ✅ 完整的 Phase 0-3 | 停止 → 备份 → 清理 → 重装 → 恢复 |
| 安全网快照隔离 | ✅ `~/.artifexnexus/full-snapshots/` | 永久保留，最近 3 份 |
| 恢复后自动清理 | ✅ 恢复成功后清备份目录 | 但保留 full-snapshots |

### 3.4 潜在改进点

1. **备份列表缓存**：当前缓存 TTL 5 分钟，手动备份/恢复/删除后调用 `_invalidate_backups_cache()` 立即失效。✅ 正确
2. **全量安全网不会被删除**：`full-snapshots/` 仅在 `create_full_snapshot` 中自动清理（保留最近 3 份），不会被恢复流程删除。✅ 正确
3. **备份恢复中的 Gateway 状态**：恢复流程包含 `_clean_install`（停止 Gateway），但重装时可能 gateway 进程已僵死。→ 有 `ignore_errors=True` 兜底。✅ 可接受

---

## 4. 更新后的完整问题列表

合并两轮调研的所有发现：

| # | 问题 | 严重程度 | 类型 | 来源 |
|---|---|---|---|---|
| P1 | `OpenClawConfigDump` 类型缺少 `agentList` 字段 | P1 | 类型安全 | 第一轮 |
| P2 | `_AGENT_IDENTITY_FILES` 有 3 个幽灵文件 | P2 | 代码清理 | 第一轮 |
| P3 | Agent 页面缺少 `model` 字段 | P2 | 功能缺失 | 第一轮 |
| P4 | `defaultAgent` 表单状态未被 Agent Tab 使用 | P3 | 架构一致 | 第一轮 |
| P5 | 保存整体替换 `agents.list`（多 agent 理论风险） | P3 | 健壮性 | 第一轮 |
| B1 | `_restore_agents` 直接写 openclaw.json 绕过 schema 校验 | P2 | 安全性 | 第二轮 |
| B2 | 恢复成功后自动删除选择性备份 | P3 | 用户体验 | 第二轮 |
| B3 | `_clean_install` 用 `shutil.rmtree` 可能残留文件 | P3 | 健壮性 | 第二轮 |

---

## 5. 总结

### 字段真实性：全部确认

| 字段 | 真实 | 枚举正确 | 用途 |
|---|---|---|---|
| Thinking | ✅ | ✅ | 思考深度预算 |
| Reasoning | ✅ | ✅ | 推理过程可见性 |
| Verbose | ✅ | ✅ | 输出详细程度 |
| Tool Progress Detail | ✅ | ✅ | 工具进度展示格式 |
| 系统提示词 | ✅ | N/A | Agent 人格 prompt |

### 用户修改权限：全部应保留

所有四个字段都是 OpenClaw 官方支持的 "per-agent override" 字段，设计意图就是让用户自定义。当前 Agent Tab 的编辑体验已经良好。

### 备份恢复：整体可靠，有 2 个改进点

核心设计（选择性备份 + 全量安全网 + SQLite 在线备份 + 文件锁容错）非常扎实。B1/B2 是边际改进点。

### 数据管理功能：完整且正确

备份/恢复/列表/删除 四个核心功能均正确实现，数据流从前端到 sidecar 到文件系统完整闭环。
