---
tags: [spec, ui, workflow, node-editor, M11]
created: 2026-06-04
updated: 2026-06-04
status: draft
---

# 节点式工作流编辑器 — UI 结构设计 / Workflow Editor UI Structure

> 范围：本 spec 定义 M11「工作流」模块的**信息架构 / 状态机 / 节点能力 / 端口规则 /
> 连线校验 / 运行时 UI / 反向编辑 / 与 AppShell 的对接点**。
> 不含具体视觉值（颜色 / 字号 / 圆角）— 后者沿用 [[design-language]]。
> 实现归 [[../../tasks/backlog/EPIC-0011-m11-workflow-editor]]。
> 数据契约（AWFF schema）见 [[../awff-format]]（由 STORY-0076 创建）。

## 1. 信息架构

工作流模块挂在现有 AppShell（参见 [[web-chat-structure]] 的 ABCD 区域命名）。
作为 Sidebar (B) 的一级模块入口，C 区渲染 WorkflowPage 主壳，D 区接入 RuntimePanel / NodeInspector / EdgeInspector / WorkflowMetaInspector 分页。

```
工作流模块（id="workflow"）
├── B 区 Sidebar：模块入口（图标 Workflow，紧邻"数据"）
├── C 区 WorkflowPage
│   ├── C1 顶部工具条（运行状态徽标 + 导入 + 导出菜单 + 运行/暂停/终止）
│   ├── C2 左：节点库（按 9 大类分组的 NodePalette，可拖拽）
│   ├── C3 中：React Flow 画布（节点 + 边 + 缩放 + 平移 + 迷你地图 + 对齐线 + 多选）
│   └── C4 底：SummaryBar（节点数 / 边数 / 当前运行进度 / Diff 计数）
└── D 区 InspectorPanel（与 M10 共用抽象，分页）
    ├── 节点属性页（NodeInspector）— 选中节点时显示
    ├── 连线属性页（EdgeInspector）— 选中连线时显示
    ├── 元数据页（WorkflowMetaInspector）— 空选中时显示
    └── 运行态页（RuntimePanel）— 运行中自动切到此页，节点 runtimeUI 弹出此处
```

### 1.1 节点分类（9 大类，与 inbox 对齐 + 1 类系统）

| 类别 | 内置节点（首版） | capabilities 默认 | Gateway 依赖 |
|------|-----------------|------------------|-------------|
| **Trigger** | `On Demand`（手动触发）/ `On Schedule`（cron 骨架） | - | 无 |
| **Tool** | `Run Tool`（接 Nexus-Tool Registry） | - | 无（Tool Runtime） |
| **Skill** | `Run Skill`（接 SkillHub） | - | 无（SkillHub） |
| **AI Chat** | `Send to Chat` / `Get Chat Response` / `AI Analysis` | runtimeUI / canPause+runtimeUI / - | **需要 Gateway** |
| **User** | `User Choice`（多选一）/ `Input Form`（参数表单） | canPause + runtimeUI | 无 |
| **Control** | `Condition`（if/else 分支）/ `Loop`（循环骨架）/ `Terminate`（终止） | canBranch / - / canTerminate | 无 |
| **Data** | `Parse JSON` / `Transform`（JSONPath/简单 mapping） | - | 无 |
| **Script** | `Run Python` / `Run Shell` | - | 无（沙箱） |
| **Output** | `Save File` / `Notification` | - | 无 |

> 首版以"覆盖能力维度"为目标，非"节点数最多"；Loop/Run Python/Run Shell 等高风险节点首版可只放骨架 + 友好"未实现"提示。

## 2. 状态机

### 2.1 工作流级状态（WorkflowState）

```
       ┌────────┐  drop AWFF / new blank
       │ empty  │ ──────────────────────► editing
       └────────┘                              │
            ▲                                  │ click run
            │ clear                            ▼
            │                          ┌──────────────┐
            │                          │   running    │ ──┐
            │                          └──────────────┘   │ pause
            │                                  │          ▼
            │                            done │   ┌──────────────┐
            │                            term │   │   paused     │
            │                                  │   └──────┬───────┘
            │                                  ▼          │ resume
            │                          ┌──────────────┐   │
            │                          │   finished   │ ◄─┘
            │                          └──────────────┘
            │                                  │
            └─── reset ────────────────────────┘
                       (engine error at any time → error)
```

| 状态 | 描述 | 允许动作 |
|------|------|---------|
| `empty` | 未创建工作流 | 拖入节点 / 导入 AWFF |
| `editing` | 编辑中 | 拖节点 / 连线 / 改参数 / 运行 |
| `running` | 运行中 | 暂停 / 终止 |
| `paused` | 暂停（含 WAITING 节点） | 继续 / 终止 / 提交节点输入 |
| `finished` | 全部 DONE 或被终止 | 查看结果 / 回到 editing / 重置 |
| `error` | 引擎错误 | 查看错误详情 / 回到 editing |

### 2.2 节点级状态（NodeStatus，每个节点独立）

```
PENDING ──► RUNNING ──┬──► DONE
                      ├──► WAITING ──(user input)──► RUNNING
                      ├──► BRANCHED ──► (chosen branch RUNNING)
                      ├──► TERMINATED
                      └──► ERROR
```

| 状态 | 视觉（CSS 变量） | 说明 |
|------|----------------|------|
| `pending` | `hsl(var(--muted))` ring | 等待上游 |
| `running` | `hsl(var(--primary))` ring（脉冲动效可选） | 执行中 |
| `waiting` | `hsl(var(--warning))` ring | 暂停等用户 |
| `done` | `hsl(var(--success))` ring | 完成 |
| `branched` | `hsl(var(--info))` ring | 已选分支，未选分支保持 pending |
| `terminated` | `hsl(var(--muted-foreground))` ring | 用户/Terminate 节点终止 |
| `error` | `hsl(var(--destructive))` ring | 执行失败 |

> 颜色 token 必须存在于 `@artifex-nexus/ui` token 表中；如 `--info` 缺失，由 STORY-0078 在 token 表补齐。

## 2.1 编辑态线框 / Editing Wireframe

```
┌────────────────────────────────────────────────────────────────────┐
│ C1: ⬤ editing  [新建] [导入 AWFF] [导出 ▾] [▶ 运行] [⏸] [⏹]        │
├──────────────┬──────────────────────────────────────────┬──────────┤
│ C2 节点库    │ C3 画布                                  │ D 元数据 │
│              │                                          │ 页       │
│  ▾ Trigger   │   ┌─────────┐                           │          │
│   On Demand  │   │ On Demand│                           │ 名称：   │
│   On Schedule│   └────┬─────┘                           │  示例 wf │
│              │        ▼                                  │          │
│  ▾ Tool      │   ┌──────────┐                           │ 描述：   │
│   Run Tool   │   │Run Tool  │                           │  ...     │
│              │   │scene-stat│                           │          │
│  ▾ Skill     │   └────┬─────┘                           │ 变量：   │
│   Run Skill  │        ▼                                  │  + 添加  │
│              │   ┌──────────┐                           │          │
│  ▾ AI Chat   │   │User Choi.│ ←─ 选中（高亮）           │ 创建于： │
│   Send       │   └────┬─────┘                           │  ...     │
│   GetReply   │        ▼                                  │          │
│   Analysis   │   ┌──────────┐                           │          │
│              │   │Run Skill │                           │          │
│  ▾ User      │   │optimize  │                           │          │
│   Choice     │   └──────────┘                           │          │
│   Input      │                                          │          │
│              │   迷你地图 ▭                             │          │
│  ▾ Control   │                                          │          │
│   ...        │                                          │          │
├──────────────┴──────────────────────────────────────────┴──────────┤
│ C4 Summary: 4 节点 | 3 边 | Diff 0 | editing                        │
└────────────────────────────────────────────────────────────────────┘
```

## 2.2 运行态线框 / Running Wireframe

```
┌────────────────────────────────────────────────────────────────────┐
│ C1: ⬤ running  当前: User Choice (3/5)  [⏸ 暂停] [⏹ 终止]          │
├──────────────┬──────────────────────────────────────────┬──────────┤
│ C2 节点库    │ C3 画布（节点按 status 着色）            │ D 运行态 │
│  （灰化）    │                                          │ 页       │
│              │   [On Demand]  ●● done                   │          │
│              │       ▼                                   │ 工作流： │
│              │   [Run Tool]   ●● done                    │  示例 wf │
│              │       ▼                                   │          │
│              │   [User Choi.] ◐◐ waiting ←─ 当前        │ 当前节点 │
│              │       ▼                                   │ User Cho.│
│              │   [Run Skill]  ○○ pending                 │          │
│              │                                           │ ┌──────┐ │
│              │                                           │ │○方案A│ │
│              │                                           │ │●方案B│ │
│              │                                           │ │○方案C│ │
│              │                                           │ └──────┘ │
│              │                                           │          │
│              │                                           │ [确认]   │
│              │                                           │ [跳过]   │
├──────────────┴──────────────────────────────────────────┴──────────┤
│ C4 Summary: 5 节点 | 4 边 | 进度 3/5 | running                      │
└────────────────────────────────────────────────────────────────────┘
```

## 3. 端口槽位规则

每个节点声明 `inputs[] / outputs[]`，端口写入 `AWFF.nodes[i].ports`。
**节点类型决定可绑端口类型与数量**，端口类型由白名单 + `any` 通配定义。

### 3.1 端口类型白名单

| 类型 | 描述 | 兼容 |
|------|------|------|
| `string` | 字符串 | string, any |
| `number` | 数字 | number, any |
| `boolean` | 布尔 | boolean, any |
| `json` | 任意 JSON 对象 | json, any |
| `array` | 数组 | array, any |
| `binary` | 二进制（dataURL / blob ref） | binary, any |
| `signal` | 仅控制流（无数据） | signal |
| `any` | 通配 | * |

**校验规则**：`isValidConnection(src.output.type, tgt.input.type)` →
- src 或 tgt 任一为 `any` → 通过
- src === tgt → 通过
- 否则 → 拒绝（画布给红色高亮 + tooltip "类型不兼容"）

### 3.2 内置节点端口模板

| 节点 | 输入端口 | 输出端口 |
|------|---------|---------|
| `On Demand` | - | `signal` |
| `On Schedule` | - | `signal` |
| `Run Tool` | `signal`, `params: json` | `result: json`, `signal` |
| `Run Skill` | `signal`, `params: json` | `result: json`, `signal` |
| `Send to Chat` | `signal`, `prompt: string` | `messageId: string`, `signal` |
| `Get Chat Response` | `signal`, `messageId: string` | `text: string`, `signal` |
| `AI Analysis` | `signal`, `text: string` | `parsed: json`, `signal` |
| `User Choice` | `signal`, `options: array` | `choice: string`, `signal` |
| `Input Form` | `signal`, `schema: json` | `values: json`, `signal` |
| `Condition` | `signal`, `expr: string` | `true: signal`, `false: signal` |
| `Loop` | `signal`, `items: array` | `item: any`, `done: signal` |
| `Terminate` | `signal`, `reason?: string` | - |
| `Parse JSON` | `signal`, `text: string` | `parsed: json`, `signal` |
| `Transform` | `signal`, `input: json`, `expr: string` | `output: json`, `signal` |
| `Run Python` | `signal`, `code: string` | `stdout: string`, `signal` |
| `Run Shell` | `signal`, `cmd: string` | `stdout: string`, `signal` |
| `Save File` | `signal`, `path: string`, `content: string` | `signal` |
| `Notification` | `signal`, `title: string`, `body?: string` | `signal` |

> 第一个 `signal` 输入端口为流程触发位；缺该输入则节点不会被执行。多个 `signal` 输入按 OR 语义（任一上游 DONE 即触发）。

## 4. 节点能力声明（NodeCapabilities）

```ts
interface NodeCapabilities {
  canPause: boolean;       // 进入 WAITING 等用户输入
  canBranch: boolean;      // 输出 true/false 或 case：分支选择
  canTerminate: boolean;   // 提前终止整个工作流
  runtimeUI: boolean;      // 运行时弹 UI 到 RuntimePanel
}
```

| 节点 | canPause | canBranch | canTerminate | runtimeUI |
|------|---------|-----------|--------------|-----------|
| User Choice | ✅ | ✅ | ❌ | ✅ |
| Input Form | ✅ | ❌ | ❌ | ✅ |
| Get Chat Response | ✅ | ❌ | ❌ | ✅ |
| Send to Chat | ❌ | ❌ | ❌ | ✅（进度） |
| AI Analysis | ❌ | ❌ | ❌ | ✅（思考中） |
| Condition | ❌ | ✅ | ❌ | ❌ |
| Terminate | ❌ | ❌ | ✅ | ❌ |
| 其余 | ❌ | ❌ | ❌ | ❌ |

## 5. 上下文变量与表达式

### 5.1 上下文 ctx

```ts
interface WorkflowContext {
  variables: Record<string, unknown>;       // WorkflowMetaInspector 配置的全局变量
  nodeOutputs: Record<string, NodeResult>;  // 已 DONE 节点的输出 by nodeId
  runState: WorkflowState;
  startedAt: number;
}
```

### 5.2 表达式语法

仅支持 `{{nodeId.outputKey}}` 与 `{{vars.name}}`，首版**不支持**算式 / 函数调用。
解析顺序：先变量替换 → 再传入节点 executor。

例：
```
prompt: "分析数据：{{run-tool-1.result}}，参考 {{vars.style}}"
```

未解析的 `{{...}}` 留作字面量并在 NodeInspector 给黄色提示。

## 6. 反向编辑细则

### 6.1 通用规则

- 反向编辑目标只有内存中的 AWFF 对象
- 每次修改 in-place 更新 + **入队** AWFF Diff
- Diff 队列在 WorkflowPage 顶层 state 维护，可清空、可导出 JSON
- 关闭页面 / 切模块即丢失（首版无持久化，与 M10 一致）

### 6.2 Diff 操作集

```jsonc
{
  "type": "awff-diff/v1",
  "changes": [
    { "op": "node-update", "nodeId": "n1", "field": "params.path", "value": "/tmp/x" },
    { "op": "node-add",    "node": { "id": "n5", "type": "run-tool", "..." } },
    { "op": "node-delete", "nodeId": "n3" },
    { "op": "edge-add",    "edge": { "id": "e9", "source": "n1", "target": "n2", "..." } },
    { "op": "edge-delete", "edgeId": "e7" },
    { "op": "meta-update", "field": "name", "value": "新名称" }
  ]
}
```

### 6.3 提交语义

| 操作 | 提交方式 | 取消方式 |
|------|---------|---------|
| NodeInspector 字段编辑 | 失焦 + Enter | Esc |
| 拖入节点 | drop 时立即 | 撤销靠 delete |
| 连线 | drop 时立即（先校验） | 拒绝时不入 Diff |
| 删除节点/边 | 选中 + Delete 键 | 二次确认（仅删除节点） |

## 7. 与现有架构的对接点

| 对接位置 | 改动 |
|---------|------|
| `Sidebar.tsx` MODULES | 加 `{ id: "workflow", label: "工作流", icon: Workflow }` |
| `Sidebar.tsx` ModuleId 类型 | 加 `\| "workflow"` |
| `ContentArea.tsx` | 加 `<div className={module === "workflow" ? "contents" : "hidden"}><WorkflowPage /></div>` |
| `RightPanel.tsx` | **接入**：根据 WorkflowPage 选中态切换 NodeInspector / EdgeInspector / WorkflowMetaInspector / RuntimePanel；与 Skills/Tools 默认行为隔离 |
| `Topbar.tsx` | **不动** |
| `packages/apps/web/src/components/workflow/` | 新建目录：WorkflowPage / NodePalette / NodeCanvas / NodeInspector / EdgeInspector / RuntimePanel / WorkflowMetaInspector |
| `packages/apps/web/src/features/workflow/` | 新建目录：engine.ts / topo-sort.ts / context.ts / node-executors/ / node-registry.ts / awff-parse.ts |
| `packages/platform/contracts/schemas/` | 加 `awff.schema.json`（STORY-0076） |
| `packages/platform/contracts/src/` | 派生 `awff.ts` |
| `packages/platform/contracts/python/` | 派生 `awff.py`（pydantic） |

## 8. 错误与边界

| 场景 | 处理 |
|------|------|
| AWFF 导入有循环依赖 | error 状态 + 文案"检测到节点循环依赖：a → b → a" |
| 节点端口类型不兼容 | 连线时拒绝 + 红色高亮 + tooltip |
| 节点缺必填参数 | 运行前校验，红色 ring + NodeInspector 高亮缺项 |
| 节点 executor 抛错 | 节点 ERROR 状态 + 错误冒泡到顶栏 toast + 工作流 error 状态 |
| Gateway 不可用 / AI 节点失败 | 节点 ERROR + 给重试按钮 + 不影响其他分支已 DONE 节点 |
| 缺失变量 `{{x.y}}` 解析失败 | 节点 ERROR + 提示"未解析的变量：{{x.y}}" |
| 节点 > 500 个 | 自动开启 `onlyRenderVisibleElements`，迷你地图保持全图 |

## 9. 性能

- 默认渲染：节点数 < 200 时全量 DOM 渲染（M11 典型规模）
- 200–500 节点：开启 React Flow 的 `onlyRenderVisibleElements`
- > 500 节点：弹提示"建议拆分子工作流"（首版仅提示，不限制）
- 单次 Diff 入队 O(1)，导出时 O(N) 序列化

## 10. 非目标（重申）

- 不做工作流持久化到磁盘（关闭即丢）
- 不做协同编辑 / 多人共享
- 不做撤销 / 重做（用 Diff + 重导入兜底）
- 不做自动布局（dagre / elkjs，留 P2）
- 不做子工作流嵌套（SubFlow，留后续）
- 不做工作流模板市场
- 首版不做并行执行（仅串行 + BRANCHED 分支）
- 首版对话节点接 mock，不真接 Gateway

## 相关

- [[../../tasks/backlog/EPIC-0011-m11-workflow-editor]] — EPIC 卡
- [[../../inbox/workflow-node-editor]] — 原始构想（已 triage）
- [[design-language]] — 设计令牌
- [[web-chat-structure]] — AppShell 区域命名
- [[data-view-structure]] — M10 同款 spec，复用 InspectorPanel / Diff / 反向编辑模式
- [[../awff-format]] — AWFF 数据契约（待 STORY-0076 创建）
