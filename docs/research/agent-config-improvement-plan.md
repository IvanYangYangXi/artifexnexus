# Agent 配置改进计划

> 基于 `docs/research/agent-config-research-report.md` 和 `docs/research/agent-config-supplemental-report.md` 的调研结论
> 版本：v4.0 | 2026-06-01（QA 三审通过）

---

## 1. 问题汇总（合并两轮调研）

| # | 问题 | 严重程度 | 类型 | 来源 |
|---|---|---|---|---|
| P1 | `OpenClawConfigDump` TypeScript 类型缺少 `agentList` 字段 | P1 | 类型安全 | 第一轮 |
| P2 | `_AGENT_IDENTITY_FILES` 包含 3 个无模板的幽灵文件 | P2 | 代码清理 | 第一轮 |
| P3 | Agent 页面缺少 `model` 字段（per-agent 模型绑定） | P2 | 功能缺失 | 第一轮 |
| P4 | Agent Tab 未使用已有的 `defaultAgent` 表单状态 | P3 | 架构一致性 | 第一轮 |
| P5 | 保存时整体替换 `agents.list`（多 agent 场景理论风险） | P3 | 健壮性 | 第一轮 |
| B1 | `_restore_agents` 直接写 openclaw.json 绕过 schema 校验 | P2 | 安全性 | 第二轮 |
| B2 | 恢复成功后自动删除选择性备份 | P3 | 用户体验 | 第二轮 |
| B3 | `_clean_install` 用 `shutil.rmtree` 可能残留文件 | P3 | 健壮性 | 第二轮 |
| **U1** | **UI 上每个字段缺少含义说明，用户看不懂** | **P2** | **用户体验** | **第三轮 (用户提出)** |

---

## 2. Reasoning/Verbose/Tool 字段评估结论

### 是否真实存在
✅ **全部是 OpenClaw 真实字段**，来自 `agents.list[]` schema。

### 是否有必要让用户修改
✅ **有。** 三个字段都是 OpenClaw 官方 "per-agent override" 设计。

- **reasoningDefault**（推理可见性）：高级用户想看推理链，普通用户想简洁。需求因人而异。
- **verboseDefault**（输出详细度）：调试时需要 full，日常 on 即可。场景差异大。
- **toolProgressDetail**（工具进度展示）：默认 explain 足够好，但开发者可能需要 raw。

**建议：保持当前所有字段可编辑，不做删减。**

---

## 3. 备份恢复评估结论

**整体可靠。** 核心设计（选择性备份 + 全量安全网 + SQLite 在线备份 + 文件锁容错）非常扎实。B1/B2/B3 是边际改进点，优先级低。

**数据管理功能：完整且正确。** 备份/恢复/列表/删除四个核心功能正确实现。

---

## 4. 执行计划

### Phase 1：类型安全修复（P1） · 10 min

**目标**：修正 TypeScript 类型定义，使 `agentList` 成为 `OpenClawConfigDump` 的正式字段。

**根据**：sidecar `config_io.ConfigDump.to_dict()` 第 107 行确实返回 `agentList`，前端类型定义遗漏。

**涉及文件**：
- `packages/apps/web/src/ipc/openclaw.ts`（前端 IPC 类型）
- `apps/desktop/src/ipc/openclaw.ts`（Tauri 复制版，必须保持完全一致）
- `packages/apps/web/src/features/settings/settings.reducer.ts`（移除 `as any` hack）

**修改内容**：
1. 在 `OpenClawConfigDump` 接口中添加：
   ```typescript
   /** agents.list 节点（agent 预设数组，含 id / name / model / thinkingDefault 等） */
   agentList: Record<string, unknown>[];
   ```
2. 在 `dumpToState` 中将 `(dump as any).agentList ?? []` 改为 `dump.agentList ?? []`（保留 `?? []` 兼容旧 dump）
3. 同步更新 `apps/desktop/src/ipc/openclaw.ts`（两处 IPC 类型必须同步）

**验收标准**：
- `dumpToState` 函数不再使用 `as any` 访问 `agentList`
- `pnpm -C packages/apps/web type-check` 通过
- 现有 agent 数据加载行为完全不变

---

### Phase 2：清理幽灵文件引用（P2） · 5 min

**目标**：清理 `_AGENT_IDENTITY_FILES` 中无对应模板的文件名。

**涉及文件**：
- `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/bootstrap.py`

**修改内容**：
1. 将 `_AGENT_IDENTITY_FILES` 从 `["AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "TOOLS.md", "HEARTBEAT.md"]` 改为 `["IDENTITY.md", "SOUL.md", "USER.md"]`
2. 在代码注释中说明：`AGENTS.md`（项目根）≠ Agent 配置；`TOOLS.md` / `HEARTBEAT.md` 无对应模板
3. **回归验证**：grep 整个 wrapper 包，确保 `_AGENT_IDENTITY_FILES` 没有其他引用方依赖于这 3 个被删的文件名

**验收标准**：
- `_AGENT_IDENTITY_FILES` 仅包含确实存在模板的三个文件
- 备份/恢复流程在测试环境跑一遍不报错
- bootstrap 流程不报 "template not found"

---

### Phase 3：Agent Tab 功能增强（P3 + P4 + U1） · 50 min

> **QA 备注**：原计划这一阶段把 3 个并列子任务合在一起，但 U1（UI 字段说明）和 P3（model 字段）的修改面差异大，必须细分。

#### 3a. UI 字段含义说明（U1） · 15 min

**目标**：每个 Agent 配置字段下方增加内联说明文字，让用户看懂每个选项的作用。

**涉及文件**：
- `packages/apps/web/src/components/settings/SettingsPage.tsx`

**修改内容**：

每个 `<select>` 和 `<textarea>` 下方增加一行 `text-[10px] text-muted-foreground/60 leading-snug` 的提示文字，文案如下：

| 字段 | Label 调整 | 字段下方说明 |
|---|---|---|
| Thinking | 保持 `Thinking` | 控制扩展思考的深度。off=关闭 / minimal-xhigh=深度递增 / adaptive=自适应 / max=最大深度（仅支持的模型生效，如 Claude Extended Thinking） |
| Reasoning | 改为 `Reasoning（推理可见性）` | 仅对 reasoning 模型生效（o3 / deepseek-r1 等）。off=隐藏 / on=完整显示 / stream=流式实时显示 |
| Verbose | 改为 `Verbose（输出详细度）` | off=精简 / on=标准 / full=含调试信息 |
| Tool Progress Detail | 改为 `Tool Progress（工具进度）` | explain=人类可读的进度描述 / raw=原始工具调用日志（开发者调试用） |
| 系统提示词 | 保持现状 | 已有"· N 字符"。新增说明：覆盖 Agent 的默认系统提示词，定义 Agent 的人格、专业领域、行为约束。留空表示使用 OpenClaw 内置默认 |

**实现细节**：
- 使用统一的 hint 组件或 inline `<span>`，避免每处复制样式类
- 推荐做法：在 `SettingsPage.tsx` 内定义一个内部 `<FieldHint>` 组件
- 文案需要在中文 UI 风格下保持简洁（不超过 60 字）

**验收标准**：
- 5 个字段下方都有中文说明
- 说明文字使用 `text-[10px] text-muted-foreground/60`，不影响主控件的视觉重心
- Reasoning/Verbose/Tool Progress 的 label 后括号补充中文释义

#### 3b. 新增 model / imageModel 字段（P3） · 25 min

**目标**：Agent 卡片中支持选择 per-agent 模型。

**根据 OpenClaw schema 真实情况（QA 二审确认）**：
- `agents.list[].model` **同时接受** `string` 和 `{primary: string, fallbacks: string[]}` 两种形式
- 字符串和单 `primary` 对象都**不继承** defaults 的 fallbacks（严格模式）
- artifex-nexus 模板当前**不写 model**，agent 完全继承 `agents.defaults.model`

**首版决策**：
1. **读取**：兼容两种格式
   - 字符串 → 直接用
   - 对象 → 取 `primary`（fallbacks 信息暂不展示，但保留在 `preset._modelRaw` 中以便回写时不丢）
2. **编辑**：UI 只暴露字符串选择（下拉框）
3. **保存**：
   - 如果用户选择了 model → 写字符串形式 `"provider/model"`
   - 如果用户清空了 model → 不写 `model` 字段（继承 defaults）
   - 如果原始数据是对象格式且用户没改 → 原样回写（不破坏用户手动配置的 fallbacks）

**涉及文件**：
- `packages/apps/web/src/features/settings/settings.reducer.ts`：
  - `dumpToState` 第 263 行附近：增加 model / imageModel 字段读取（兼容两种格式）
  - `buildPatchFromState` 第 453 行附近：增加 model / imageModel 字段写出
- `packages/apps/web/src/components/settings/SettingsPage.tsx`：
  - Agent 卡片第 316 行附近：在 Thinking 之前插入 model / imageModel 下拉框

**reducer 修改示例**：
```typescript
// dumpToState（增加读取）
const modelRaw = obj.model;
const modelStr =
  typeof modelRaw === "string" ? modelRaw :
  (modelRaw && typeof modelRaw === "object" && typeof (modelRaw as any).primary === "string")
    ? (modelRaw as any).primary : "";
return {
  ...
  model: modelStr,
  imageModel: asString(obj.imageModel),
  _modelRaw: modelRaw, // 保留原始结构，回写时如果用户没改就用原值
  _imageModelRaw: obj.imageModel,
  ...
};

// buildPatchFromState（增加写出）
if (preset.model) {
  // 用户选了具体模型 → 始终写字符串形式（首版简化）
  // 但如果用户没动 _modelRaw 且 _modelRaw 是对象，保留对象（未来可在 UI 详细模式编辑）
  if (preset.model === extractPrimary(preset._modelRaw) && isObjectModel(preset._modelRaw)) {
    entry.model = preset._modelRaw;
  } else {
    entry.model = preset.model;
  }
}
if (preset.imageModel) entry.imageModel = preset.imageModel;
```

**UI 示例**：
```tsx
<div>
  <label className="text-[11px] text-muted-foreground">Model（模型）</label>
  <select className={SEL} value={preset.model || ""}
          onChange={e => dispatch({type:"UPDATE_AGENT_PRESET", agentId:preset.id, patch:{model:e.target.value}})}>
    <option value="">未设置（继承 Agent 默认 → {state.defaultAgent.defaultModel || "未配置"}）</option>
    {modelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
  <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-snug">
    Agent 使用的主模型。留空则继承 Agent 默认（在常规设置中配置）。格式：provider/model-id
  </p>
</div>
```

**验收标准**：
- 模型下拉来源是 `modelOptions`（已存在）
- 首次加载时，artifex-nexus 卡片 model 显示"未设置（继承 …）"
- 选择模型 → 保存 → 重新加载，model 字段持久化
- 清空 model → 保存 → 重新加载，回到"未设置"状态
- **回归**：手动在 openclaw.json 把 model 改成对象形式 `{primary: "x", fallbacks: ["y"]}` → UI 加载不崩溃，显示 "x"，保存后 fallbacks 不丢失

#### 3c. defaults 继承提示（P4） · 10 min

**目标**：让用户清楚哪些字段是 per-agent 设置、哪些继承自 defaults。

**修改内容**：
1. Agent 卡片顶部添加一行说明：
   ```
   未设置（空白）的字段将继承「常规设置 → Agent 默认值」
   ```
2. 每个继承字段的下拉默认选项保持现在的"未设置（继承 defaults）"格式

**注意**：本子任务**不**重构 defaultAgent 表单状态本身。reducer 中的 `defaultAgent` 状态由"常规"Tab 使用，Agent Tab 仅做只读的展示参考。

**验收标准**：
- Agent 卡片顶部有继承关系说明
- 不破坏现有"常规"Tab 中的 defaultAgent 编辑功能

---

### Phase 4：QA 终审 · 10 min

**审核清单**：

#### 数据正确性
- [ ] sidecar 返回的 `agentList` 字段在前端被正确读取（无 `as any`）
- [ ] model 字段读取兼容 string 和 `{primary, fallbacks}` 两种格式
- [ ] 保存后再加载，所有字段能正确回显

#### 不破坏性
- [ ] 现有的 Thinking/Reasoning/Verbose/ToolProgress/systemPromptOverride 编辑功能不受影响
- [ ] 模板文件 `artifex-nexus.preset.json.tpl` 不需要修改（model 字段保持可选）
- [ ] 重置 agent 预设功能不受影响

#### 用户体验
- [ ] 5 个字段下方都有中文说明，文字简洁清晰
- [ ] model 下拉显示"继承默认"提示
- [ ] 字符计数（系统提示词）正常工作

#### 规范合规
- [ ] 所有写入走 `openclaw config patch --stdin`（不直写 openclaw.json）
- [ ] 仅修改本计划列出的文件，无副作用扩散
- [ ] 没有引入新的 `as any` 类型逃生

---

## 5. 不修改项（明确排除）

| 项 | 理由 |
|---|---|
| P5 多 agent 数组替换风险 | 当前仅 1 个 agent（artifex-nexus），不构成实际风险。多 agent 时再处理 |
| B1 `_restore_agents` 直写 openclaw.json | 代码注释已说明原因（agents.list 是保护配置字段，config patch 会拒写）。仅 restore 流程触发（低频），保持现状 |
| B2 恢复后自动删备份 | full-snapshot 安全网兜底。如需恢复失败场景重新尝试，用户可重新做备份 |
| B3 `_clean_install` rmtree 残留 | `ignore_errors=True` 是合理的容错策略 |
| Reasoning/Verbose/Tool 字段删减 | ✅ 已确认全部应保留，用户有修改需求 |
| 新增 fallbacks 编辑 UI | 首版简化为 string，对象格式仅做兼容读取/原样回写 |
| 新增 `fastModeDefault` / `memorySearch` 等其它 schema 字段 | 用户未要求，且这些字段对当前功能无影响 |
| 修改 identity 文件（IDENTITY/SOUL/USER.md） | 这些是 workspace 上下文文件，不是配置字段 |
| 重构 Agent Tab 结构 | 当前结构够用，无需大改动 |
| 重构 defaultAgent 表单状态 | 「常规」Tab 已使用，Agent Tab 仅做继承提示，无需统一 |

---

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `agentList` 类型变更导致编译错误 | 低 | 中 | 前后端同步修改 + 编译验证 |
| `_AGENT_IDENTITY_FILES` 清理影响备份恢复 | 低 | 低 | 仅清理无模板文件，依然存在的文件不受影响 |
| **model 字段对象格式被破坏** | **中** | **中** | **保留 `_modelRaw` 原值；用户未修改时原样回写** |
| **model 编辑 UI 与 modelOptions 格式不匹配** | **中** | **低** | **modelOptions 已是 `provider/model` 格式，与 schema 一致** |
| UI 字段说明文案不准确 | 低 | 低 | 文案以 OpenClaw 官方文档为准，开发后再核对一遍 |
| 双 IPC 类型文件不同步 | 中 | 中 | 修改时强制双更新 + grep 验证 |

---

## 7. 开发顺序

```
Phase 1 (10min, 类型修复)
   └→ Phase 2 (5min, 幽灵文件清理) ‖ Phase 3a (15min, UI 说明)
        └→ Phase 3b (25min, model 字段) [依赖 Phase 1 类型]
             └→ Phase 3c (10min, 继承提示)
                  └→ Phase 4 (10min, QA 终审)
```

**总计：50-65 min**

并行性：
- Phase 2 和 Phase 3a 可并行（涉及不同文件）
- Phase 3b 必须在 Phase 1 之后（用到正确类型）
- Phase 3c 在 3b 后做（在 3b 添加的 UI 上加提示）
