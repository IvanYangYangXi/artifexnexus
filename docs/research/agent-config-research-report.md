# Agent 配置调研报告

> 调研时间：2026-06-01
> 范围：OpenClaw agent 配置文件的路径、格式、UI 字段真实性验证、保存逻辑正确性

---

## 1. Agent 相关配置文件全景

### 1.1 主配置：openclaw.json

| 属性 | 说明 |
|---|---|
| **路径** | `~/.artifexnexus/.openclaw/openclaw.json` |
| **格式** | JSON（遵循 OpenClaw v2026.5.4 schema） |
| **Agent 节点** | `agents.defaults`（Agent 默认值）+ `agents.list[]`（Agent 预设数组） |

`agents.list[]` 中每条支持的字段（来源：上游调研 §15.2）：

```
id                    (string)   - Agent 唯一 ID
name                  (string)   - 显示名
default               (bool)     - 是否为默认 Agent
workspace             (string)   - 工作区路径
agentDir              (string)   - state 目录
agentRuntime          ({id: runtime_id}) - 运行时
model                 (string|{primary, fallbacks[], timeoutMs})
imageModel            (string|{...})
imageGenerationModel  (string|{...})
thinkingDefault       ("off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"adaptive"|"max")
reasoningDefault      ("on"|"off"|"stream")
verboseDefault        ("off"|"on"|"full")
toolProgressDetail    ("explain"|"raw")
fastModeDefault       (bool)
systemPromptOverride  (string)   - 系统提示词（多行）
skills                ([skill_id])
memorySearch          ({...})
```

### 1.2 Agent 预设模板

| 属性 | 说明 |
|---|---|
| **路径** | `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/assets/agents/artifex-nexus.preset.json.tpl` |
| **格式** | JSON，含 `{{OPENCLAW_WORKSPACE}}` 和 `{{SYSTEM_PROMPT_JSON}}` 占位符 |
| **当前值** | 包含 `id/name/default/workspace/agentRuntime/reasoningDefault/thinkingDefault/verboseDefault/toolProgressDetail/systemPromptOverride` |

### 1.3 System Prompt 文本

| 属性 | 说明 |
|---|---|
| **路径** | `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/assets/agents/artifex-nexus.system-prompt.txt` |
| **格式** | 纯文本（中文），描述 Artifex Nexus 平台五大能力板块 |

### 1.4 Workspace 人格文件（Identity Files）

| 文件 | 模板路径 | 目标路径 | 作用 |
|---|---|---|---|
| **IDENTITY.md** | `.../assets/agents/workspace/IDENTITY.md` | `~/.artifexnexus/.openclaw/workspace/IDENTITY.md` | Agent 身份定义（名字、类型、emoji） |
| **SOUL.md** | `.../assets/agents/workspace/SOUL.md` | `~/.artifexnexus/.openclaw/workspace/SOUL.md` | 核心信条、行为准则、边界 |
| **USER.md** | `.../assets/agents/workspace/USER.md` | `~/.artifexnexus/.openclaw/workspace/USER.md` | 用户画像（称呼、时区、上下文） |

**关键发现**：
- 这些文件是 Agent **运行时读取**的上下文文件（injected into workspace context）
- bootstrap.py 中 `_AGENT_IDENTITY_FILES` 还包含 `AGENTS.md`、`TOOLS.md`、`HEARTBEAT.md`，但**没有对应的模板文件**
- 项目根目录 `AGENTS.md` 是项目协作规范文件，**不是 Agent 配置**

### 1.5 Lock 文件

| 属性 | 说明 |
|---|---|
| **路径** | `~/.artifexnexus/.openclaw/state/artifex-nexus-preset.lock` |
| **格式** | JSON：`{"version": "2.0.0", "installedAt": "...", "checksum": "sha256:..."}` |
| **作用** | Agent 预设的幂等注入三态管理（首次安装 / 重复跳过 / 用户改过警告） |

### 1.6 Extras 文件

| 属性 | 说明 |
|---|---|
| **路径** | `~/.artifexnexus/.openclaw/state/artifex-nexus-extras.json` |
| **格式** | JSON：`{"providerExtras": {...}, "authExtras": {...}, "modelExtras": {...}}` |
| **作用** | 存放 OpenClaw schema 不支持的 UI 展示字段（displayName、notes、modelExtras 等） |

---

## 2. Agent 页面 UI 字段真实性验证

### 2.1 Thinking（思考模式）

| 维度 | 结论 |
|---|---|
| **是否存在** | ✅ 是 OpenClaw 真实字段 |
| **配置路径** | `agents.list[].thinkingDefault` |
| **枚举来源** | OpenClaw 上游 schema：`"off"\|"minimal"\|"low"\|"medium"\|"high"\|"xhigh"\|"adaptive"\|"max"` |
| **UI 枚举一致性** | ✅ 完全一致（SettingsPage.tsx 第 278 行 THINKING_OPTIONS） |
| **作用** | 控制 AI 推理"思考"过程的详细程度（深度思考预算） |

### 2.2 Reasoning（推理模式）

| 维度 | 结论 |
|---|---|
| **是否存在** | ✅ 是 OpenClaw 真实字段 |
| **配置路径** | `agents.list[].reasoningDefault` |
| **枚举来源** | OpenClaw 上游 schema：`"off" \| "on" \| "stream"` |
| **UI 枚举一致性** | ✅ 完全一致（SettingsPage.tsx 第 279 行 REASONING_OPTIONS） |
| **作用** | 控制是否使用推理模型以及是否流式输出推理过程 |

### 2.3 Verbose（详细程度）

| 维度 | 结论 |
|---|---|
| **是否存在** | ✅ 是 OpenClaw 真实字段 |
| **配置路径** | `agents.list[].verboseDefault` |
| **枚举来源** | OpenClaw 上游 schema：`"off" \| "on" \| "full"` |
| **UI 枚举一致性** | ✅ 完全一致（SettingsPage.tsx 第 280 行 VERBOSE_OPTIONS） |
| **作用** | 控制工具调用和推理步骤的输出详细程度 |

### 2.4 Tool Progress Detail（工具进度详情）

| 维度 | 结论 |
|---|---|
| **是否存在** | ✅ 是 OpenClaw 真实字段 |
| **配置路径** | `agents.list[].toolProgressDetail` |
| **枚举来源** | OpenClaw 上游 schema：`"explain" \| "raw"` |
| **UI 枚举一致性** | ✅ 完全一致（SettingsPage.tsx 第 281 行 TOOL_DETAIL_OPTIONS） |
| **作用** | 控制工具执行进度的显示格式（解释模式 vs 原始模式） |

### 2.5 系统提示词（人格信息）

| 维度 | 结论 |
|---|---|
| **是否存在** | ✅ 是 OpenClaw 真实字段 |
| **配置路径** | `agents.list[].systemPromptOverride` |
| **数据来源** | `openclaw.json` 中该字段的完整文本 |
| **UI 显示** | 多行 textarea + 字符数统计 |
| **字符计数** | ✅ 正确：`(preset.systemPromptOverride\|\|"").length` |

### 2.6 Skills 显示

| 维度 | 结论 |
|---|---|
| **是否存在** | ✅ 真实数据，来自 `openclaw.json` → `agents.list[].skills` |
| **显示格式** | 逗号分隔的 code 标签列表 |

### 2.7 Workspace 显示

| 维度 | 结论 |
|---|---|
| **是否存在** | ✅ 真实数据，来自 `openclaw.json` → `agents.list[].workspace` |
| **显示格式** | code 标签 |

---

## 3. 编辑保存逻辑验证

### 3.1 数据流向

```
[Agent Tab UI 编辑]
  → dispatch({type:"UPDATE_AGENT_PRESET", agentId, patch})
     → reducer: state.agentPresets[idx] = {...updated, ...patch}
  → 用户点击「保存」
     → buildPatchFromState(state)
        → agents.list = state.agentPresets.map(...)  // 完整列表序列化
        → patch = {agents: {defaults: ..., list: agentsList}}
     → ipc.patchOpenClawConfig(patch, extrasPatch, replacePaths)
        → Tauri: invoke("openclaw_config_patch", ...)
           → Python Sidecar: config_io.patch_config()
              → strip_unchanged_secrets(patch)
              → strip_auth_profile_secrets(patch)
              → openclaw config patch --stdin --replace-path agents.list
                 → 写入 openclaw.json
```

### 3.2 保存逻辑正确性评估

| 检查项 | 结论 | 备注 |
|---|---|---|
| **写入路径** | ✅ `openclaw config patch --stdin` | 符合 OpenClaw 规范（不直接写文件），走上游 schema 校验 |
| **agents.list 替换策略** | ⚠️ `--replace-path agents.list` 整体替换整个数组 | 正确但危险：如果后台有其他 agent 注册，保存会覆盖掉。当前本项目只有一个 agent，暂无问题 |
| **空值处理** | ✅ 空字符串 option 值表示"未设置（继承 defaults）" | 构建 patch 时用了 `if (preset.xxx)` 判空，空值不写入 |
| **agentRuntime 保留** | ✅ `buildPatchFromState` 保留 `agentRuntime` 字段原值回传 | 该字段 UI 不可编辑但保存时必须保留 |
| **systemPromptOverride** | ✅ 完整保留并回传 | 支持多行文本 |
| **dirty 跟踪** | ✅ 有 `markDirty` 机制 | 但直接调用 reducer action 时不会自动标记，依赖 `UPDATE_AGENT_PRESET` 中的 `markDirty` |
| **保存后 reload** | ✅ 保存成功后 `loadConfig()` 重新拉取 | 确保 UI 与后端一致 |

### 3.3 发现的潜在问题

| # | 问题 | 严重程度 | 说明 |
|---|---|---|---|
| P1 | `_AGENT_IDENTITY_FILES` 包含不存在的文件 | P2 | bootstrap.py 第 360 行列出了 `AGENTS.md`、`TOOLS.md`、`HEARTBEAT.md`，但 assets 中没有对应模板 |
| P2 | Agent 页面不展示 `model` 字段 | P2 | OpenClaw 支持 per-agent `model` 绑定，但 UI 不显示/不支持编辑 |
| P3 | 保存时整体替换 `agents.list` | P3 | 理论风险：多 agent 场景下可能互相覆盖。当前单 agent 无影响 |
| P4 | `dumpToState` 解析 `agentPresets` 来自 `dump.agentList` | P1 | TypeScript 类型 `OpenClawConfigDump` 中**未声明** `agentList` 字段 | 运行时通过 `(dump as any).agentList` 读取 |
| P5 | `agentDefaults` 表单（state.defaultAgent）未被 Agent Tab 使用 | P3 | reducer 中有 `defaultAgent` 状态但 Agent Tab 直接展示 `agentPresets` |

---

## 4. 安装配置流程验证

### 4.1 现有 bootstrap 流程

```
1. 安装 OpenClaw CLI → cli/v2026.5.4/
2. 创建目录布局 (workspace/, state/, cli/)
3. 生成默认 openclaw.json
4. 写入 gateway 端口 (19789) + controlUi 配置
5. 注入 Provider 配置模板（无 AI provider，全部禁用）
6. 注入 MCP Bridge 插件（含 DCC Server 配置）
7. 注入 Agent 预设 → agents.list[] = [artifex-nexus]
8. 写入 workspace 人格文件 (IDENTITY.md/SOUL.md/USER.md)
9. 写 lock 文件
```

### 4.2 流程验证

| 步骤 | 是否正确 | 说明 |
|---|---|---|
| **CLI 安装** | ✅ | 走 install-cli.sh，指定 `--prefix` + `--version v2026.5.4` |
| **目录隔离** | ✅ | `OPENCLAW_HOME` = `~/.artifexnexus/.openclaw/`，与默认 `~/.openclaw/` 完全隔离 |
| **端口隔离** | ✅ | base 19789（默认 18789+1000） |
| **Agent 预设注入** | ✅ | 走 `openclaw config patch --stdin`，非直接写文件 |
| **幂等性** | ✅ | lock 文件 + checksum 三态管理 |
| **人格文件** | ✅ | 仅在目标不存在时写入（保护用户修改） |

### 4.3 配置流程建议

现有流程整体正确，建议：

1. 清理 `_AGENT_IDENTITY_FILES` 中不存在的文件引用
2. 考虑在 Agent Tab 增加 `model` 字段支持
3. 修正 `OpenClawConfigDump` TypeScript 类型，添加 `agentList` 字段

---

## 5. 总结

### 所有字段真实性

| 字段 | 真实 | 枚举正确 | 保存路径正确 |
|---|---|---|---|
| Thinking | ✅ | ✅ | ✅ `agents.list[].thinkingDefault` |
| Reasoning | ✅ | ✅ | ✅ `agents.list[].reasoningDefault` |
| Verbose | ✅ | ✅ | ✅ `agents.list[].verboseDefault` |
| Tool Progress Detail | ✅ | ✅ | ✅ `agents.list[].toolProgressDetail` |
| 系统提示词（人格信息） | ✅ | N/A | ✅ `agents.list[].systemPromptOverride` |
| 字符计数 | ✅ | N/A | ✅ 实时计算 |

### 结论

**Agent 页面所有字段均为 OpenClaw 真实字段，枚举值完全匹配上游 schema，编辑保存逻辑整体正确。**

发现的 5 个潜在问题均为低-中严重程度，建议在后续迭代中逐步修复。
