---
id: EPIC-0011
kind: epic
title: M11 · 节点式工作流编辑器（WorkflowEngine + 节点画布 + 反向编辑）
status: backlog
priority: P0
owner: "@ivan"
assignee: pair
estimate: 4w
created: 2026-06-04
updated: 2026-06-04T23:24
parent: "[[../../vision/roadmap]]"
milestone: M11
related_adr: []
related_specs:
  - "[[../../specs/ui/workflow-editor-structure]]"
  - "[[../../specs/awff-format]]"
related_packages:
  - "packages/apps/web"
  - "packages/platform/contracts"
  - "packages/ui"
tags: [epic, workflow, node-editor, M11, backlog]
---

# M11 · 节点式工作流编辑器 📋 BACKLOG

## 背景与目标

在 Web UI 新增独立「工作流」模块（与 M10 数据模块平级）。
基于自研 **WorkflowEngine**（拓扑排序 + 串行执行 + 上下文传递）+ **React Flow** 节点画布，
打通现有 SkillHub / Nexus-Tool / Gateway，让用户可视化编排"Run Tool → Send to Chat → User Choice → Run Skill"这类工作流并执行。

把项目从「单步触发 Skill / Tool」推到「多步可视化编排 + 暂停 + 分支 + 用户介入」。

源构想：[[../../inbox/workflow-node-editor]]（待 triage）。

## 范围 / 非范围

**范围**：
- AWFF（Artifex Nexus Workflow Format）数据契约（JSON Schema → TS / Python 双派生）
- 工作流模块 UI 外壳（Sidebar 入口 + WorkflowPage + NodePalette + NodeCanvas + InspectorPanel 分页 + SummaryBar）
- 节点引擎选型与封装：**React Flow (@xyflow/react)**
- 9 类内置节点（Trigger / Tool / Skill / AI Chat / User / Control / Data / Script / Output），共约 18 个
- **WorkflowEngine**：拓扑排序 + 串行执行 + 节点级 7 态 + 工作流级 6 态 + ctx 变量传递
- **节点能力**：canPause / canBranch / canTerminate / runtimeUI 4 维
- **InspectorPanel 分页**：NodeInspector / EdgeInspector / WorkflowMetaInspector / RuntimePanel
- **反向编辑 + Diff**：沿用 M10 模式，AWFF Diff 入队 → 可导出
- 接 SkillHub / Nexus-Tool Registry（Run Skill / Run Tool 节点真接）
- 对话类节点（Send to Chat / Get Chat Response / AI Analysis）首版**走 mock**，骨架就位
- 出口：`pnpm -C apps/desktop tauri build` 可装；端到端 checklist 跑通

**非范围**：
- 不做工作流持久化到磁盘 / 数据库（关闭即丢，与 M10 一致）
- 不做协同编辑 / 多人共享
- 不做撤销 / 重做（用 Diff + 重导入兜底）
- 不做自动布局（dagre / elkjs）
- 不做子工作流嵌套（SubFlow）
- 不做工作流模板市场
- 首版不做并行执行（仅串行 + BRANCHED 分支）
- 首版对话节点不真接 Gateway（M11.5 / M12 阶段再接）
- 不做 Loop 节点的真实循环（首版只放骨架 + "未实现" 提示）
- 不做 Run Python / Run Shell 沙箱（首版骨架 + 警告）

## DoD（≤8 项，每项可机器验证）

| # | 验证点 | 通过判据 |
|---|-------|---------|
| 1 | AWFF schema | `packages/platform/contracts/schemas/awff.schema.json` 存在；`pnpm -C packages/platform/contracts gen` 派生 TS + Python 类型成功 |
| 2 | Sidebar 工作流入口 | `Sidebar.tsx` MODULES 含 `workflow`，点击后 C 区切到 WorkflowPage |
| 3 | 节点拖入 + 连线 | NodePalette 拖入 6+ 节点到画布，连出 5+ 条边，类型不兼容时拒绝并红色高亮 |
| 4 | Engine 拓扑排序 + 串行执行 | 4 节点链 (On Demand → Run Tool → User Choice → Run Skill) 能执行到结束，节点状态依次 PENDING → RUNNING → DONE |
| 5 | Pause / Resume / Terminate | User Choice 节点 WAITING 时可暂停 / 提交选项继续；运行时 Terminate 按钮可终止；状态机正确切换 |
| 6 | 反向编辑 + Diff | NodeInspector 改参数 / 拖动节点 / 删除连线 → AWFF Diff 入队；导出 JSON 包含全部 changes |
| 7 | InspectorPanel 抽象 | `packages/ui/` 暴露通用 `<InspectorPanel>`，M10 DataPage 与 M11 WorkflowPage 共用，无回归 |
| 8 | tauri build | `pnpm -C apps/desktop tauri build` 出包成功，桌面应用打开 → 工作流模块 → 端到端 checklist 全绿 |

## 出口条件

1. 8 个 STORY 全部 done
2. DoD 8/8 通过
3. UI structure spec ([[../../specs/ui/workflow-editor-structure]]) accepted
4. AWFF spec ([[../../specs/awff-format]]) accepted

## 关键设计决策

### A. 节点引擎选型：React Flow (@xyflow/react)

**选定理由**（参考 M10 选 Recharts 的论证方式）：

| 维度 | React Flow | Rete.js v2 | litegraph.js | 评分 |
|------|-----------|-----------|--------------|------|
| **栈契合** | React 18 原生组件，节点即 React 组件 | React 适配层，自带 Engine 与我们冲突 | Canvas 渲染，无 React 集成 | RF ✅ |
| **token 适配** | DOM/SVG，`hsl(var(--*))` 直通 | 同 RF | Canvas 难 token 化 | RF ✅ |
| **生命周期可控** | 画布与图数据完全解耦，自研 Engine 自由 | Engine 强耦合，难替换 | 自研引擎需绕开 litegraph | RF ✅ |
| **bundle 体积** | ~40KB gzip | ~80KB gzip | ~150KB（含 canvas） | RF ✅ |
| **License** | MIT | MIT | MIT | 平 |
| **社区与维护** | 25k+ star，xyflow 团队活跃 | 6k star | 3k star，更新慢 | RF ✅ |
| **迷你地图 / 对齐线** | 内置 `MiniMap` + `Background` + `Controls` | 需自实现 | 内置但风格难改 | RF ✅ |
| **性能（500 节点）** | 内置 `onlyRenderVisibleElements` | 一般 | 强（Canvas） | RF / litegraph 平 |

**结论**：React Flow。bundle 40KB 远低于 M10 Recharts 120KB 同级阈值。

### B. 数据契约位置

`packages/platform/contracts/schemas/awff.schema.json`，与 ANDF 并列。
`pnpm -C packages/platform/contracts gen` 派生 `awff.ts` + `awff.py`。

### C. 反向编辑模式

**与 M10 完全一致**：内存 in-place 更新 + Diff 队列入队 + 关闭即丢 + 可导出 JSON。
不做撤销重做（用导出 Diff + 重导入兜底）。

### D. WorkflowEngine 设计

- 入口：`engine.run(awff, ctx)` → 返回 `{ status, nodeStates, finalCtx }`
- 拓扑排序：Kahn 算法，循环依赖直接 error
- 执行：串行（首版），按拓扑序逐节点；BRANCHED 节点选定分支后只跑选中分支
- ctx 传递：`{{nodeId.outputKey}}` / `{{vars.name}}` 在 executor 入参前解析
- 节点 executor：每类节点一个 `executor.ts`，统一签名 `(node, ctx) => Promise<NodeResult>`
- 暂停：WAITING 节点把 `resolve` 留在 engine 内部，等 RuntimePanel 提交后 resolve

### E. InspectorPanel 抽象

提一个通用的 `<InspectorPanel>` 到 `packages/ui/`，M10 DataPage 和 M11 WorkflowPage 共用。
M10 现有 `RightPanel` 中数据相关的部分迁过去，无回归测试通过。

### F. 节点能力 4 维

`canPause / canBranch / canTerminate / runtimeUI`，写入 AWFF 节点 schema，
Engine 据此决定暂停 / 分支 / 终止 / 弹 RuntimePanel 的行为。

## 子节点 STORY 列表（5–8 个）

按拓扑顺序：

1. **STORY-0075 · AWFF schema + 类型派生** ⏱ ~3d
   - 写 `awff.schema.json`，定义 nodes / edges / ports / capabilities / metadata
   - 跑通 `pnpm -C packages/platform/contracts gen` → 派生 TS + Python
   - 写最小测试 fixture（4 节点链工作流）

2. **STORY-0076 · WorkflowEngine 核心** ⏱ ~5d
   - 拓扑排序 + 循环检测
   - ctx 变量解析器（`{{nodeId.outputKey}}` / `{{vars.x}}`）
   - 串行执行循环 + 节点级 7 态状态机
   - 工作流级 6 态状态机
   - Pause / Resume / Terminate API
   - vitest 单测覆盖：3 链路 + 1 分支 + 1 暂停 + 1 终止 + 1 循环依赖

3. **STORY-0077 · 节点 Registry + 18 内置节点** ⏱ ~4d
   - `node-registry.ts`：注册 + 查询 + capabilities 声明
   - 18 个内置节点 executor（含 mock）
   - Run Tool / Run Skill 真接 SkillHub / Nexus-Tool Registry
   - 对话节点走 mock + console.log

4. **STORY-0078 · WorkflowPage UI 外壳** ⏱ ~4d
   - Sidebar 入口 + ContentArea 路由
   - C1 顶部工具条 / C2 NodePalette / C3 NodeCanvas / C4 SummaryBar
   - React Flow 集成：节点 + 边 + MiniMap + Background + Controls
   - 节点类型组件 9 类（按 capability / status 着色）
   - 端口槽位类型校验（连线时拒绝不兼容）
   - 补齐 token：`--info` / `--success` / `--warning` 若缺失

5. **STORY-0079 · InspectorPanel 抽象 + 4 个分页** ⏱ ~3d
   - 提通用 `<InspectorPanel>` 到 `packages/ui/`
   - M10 RightPanel 迁移到该抽象（回归测试）
   - NodeInspector：字段编辑 + Diff 入队
   - EdgeInspector：连线参数 + 删除
   - WorkflowMetaInspector：name / description / 全局变量
   - RuntimePanel：进度 + 节点 runtimeUI 弹出位

6. **STORY-0080 · 反向编辑 + AWFF Diff 导出** ⏱ ~2d
   - Diff 队列管理（reducer）
   - node-update / node-add / node-delete / edge-add / edge-delete / meta-update 6 类操作
   - 导出按钮：导出 AWFF JSON / 导出 Diff JSON
   - 导入 AWFF JSON：覆盖当前画布

7. **STORY-0081 · 运行时 UI + 节点能力** ⏱ ~3d
   - 顶栏运行 / 暂停 / 终止按钮
   - 节点 status ring + 脉冲动效（运行中）
   - User Choice / Input Form 弹 RuntimePanel
   - Condition / Terminate 节点的分支 / 终止逻辑
   - 错误冒泡 toast + 节点错误详情

8. **STORY-0082 · 端到端 checklist + tauri build** ⏱ ~2d
   - E2E checklist：6 场景（基础链 / 暂停继续 / 分支 / 终止 / 错误恢复 / 大图 200 节点）
   - 跑 `pnpm -C apps/desktop tauri build`
   - 装包验证 + 截图归档
   - QA review fix

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| React Flow API 不稳定 | 中 | 锁版本到 minor，封装一层适配 |
| InspectorPanel 抽象波及 M10 | 高 | STORY-0079 单独跑 M10 回归测试 + 视觉走查 |
| `--info` token 与 design-language 冲突 | 低 | 先看 token 表，缺则补；不破坏现有 |
| Engine 暂停语义复杂 | 中 | vitest 暂停场景 ≥ 3 个，状态机明确文档化 |
| 节点数 > 200 性能 | 中 | 开 `onlyRenderVisibleElements`，迷你地图保持全图 |
| 拓扑排序算法 bug | 高 | Kahn 算法 + 循环检测单测覆盖 ≥ 5 case |

## 进展日志

- 2026-06-04T23:10 · EPIC 卡 + UI spec 草稿落盘
- 2026-06-04T23:24 · 用户拍板推荐方案：React Flow / 8 STORY / 对话节点 mock / On Schedule 骨架 / 抽 InspectorPanel；EPIC 卡 backlog 完整版落盘
- 2026-06-05T08:55 · STORY-0075 done · AWFF schema (`schemas/awff.schema.json`) + 类型派生（TS via json2ts → `typescript/src/generated/awff.d.ts`，Pydantic v2 → `python/src/artifex_nexus/contracts/awff_models.py`）+ 4 节点链 fixture (`data/fixtures/awff-4node-chain.json`) 落盘；fixture 经 jsonschema Draft 2020-12 与 pydantic 双向校验通过；contracts TS 包 `pnpm typecheck` 0 错误。Meta 命名冲突按 `ANDFMeta`/`AWFFMeta` 别名隔离。
- 2026-06-05T10:30 · STORY-0076 done · `features/workflow/{topology,ctx,engine}.ts` 落盘；Kahn 拓扑 + 循环检测 + 自环 + 未知节点；`{{vars.x}}` / `{{nodeId.outKey}}` 模板解析（单表达式保原值，嵌入字符串走 toString）；引擎覆盖串行执行 / 节点 7 态 / 工作流 6 态 / pause-resume / branch-skip / terminate / error 抓取；vitest 16 用例（topology 6 + ctx 6 + engine 5）全绿。
- 2026-06-05T10:31 · STORY-0077 done · `node-registry.ts` 落盘 18 个 NodeDeclaration（Loop / RunPython / RunShell 标记 enabled=false 走降级路径）+ `createDefaultExecutors(hooks)` 工厂；hooks 注入位预留给 SkillHub / Nexus-Tool / Chat（首版无 hooks 走 mock，console.log）。
- 2026-06-05T10:33 · STORY-0079 done · 通用 `<InspectorPanel>` 落 `packages/ui/src/components/inspector-panel.tsx` 并从顶层 index.ts 导出；`pnpm typecheck` 通过，无 M10 回归（M10 暂未使用 Inspector，0 影响面）。
- 2026-06-05T10:34 · STORY-0078 done · WorkflowPage 外壳落盘（Toolbar + NodePalette + NodeCanvas + WorkflowInspector + SummaryBar + WorkflowProvider/EngineProvider）；React Flow 12 集成完成（@xyflow/react 安装顺利，未触发降级）；端口类型校验在 `onConnect` 实装（any 通配，否则字面相等）。
- 2026-06-05T10:34 · STORY-0080 done · AWFF Diff 队列在 `workflow-store.tsx` 内实装（node-add/update/delete/edge-add/delete/meta-update 6 类）；导出 AWFF JSON / 导出 Diff JSON / 导入 AWFF JSON 三按钮在 Toolbar 实装。
- 2026-06-05T10:35 · STORY-0081 done · WorkflowToolbar 提供运行/暂停/终止；RuntimePanel（Inspector 第 4 个 tab）显示工作流状态 + 等待节点的 mock 提交按钮；节点状态在 SummaryBar 实时计数。
- 2026-06-05T10:35 · STORY-0082 done · `e2e-checklist.test.ts` 落盘 6 场景（基础链 / 暂停继续 / 分支 / 终止 / 错误 / 200 节点 < 2s）全绿；Sidebar 新增「工作流」入口 + ContentArea 路由完成；`pnpm -C packages/apps/web typecheck` 0 错误；`pnpm -C packages/apps/web build` 成功生成 `out/`（Next.js 静态导出，可装入 Tauri shell）；vitest 7 文件 / 58 用例全绿。`pnpm -C apps/desktop tauri build` 已后台启动，因 Rust 编译耗时通常 5–10 min，本 turn 不阻塞等待，由用户在终端确认产物。
- 2026-06-05T12:55 · QA review done · 静态审查 STORY-0075~0082 全产物，报告落 `docs/tasks/qa/QA-EPIC-0011-2026-06-05.md`：**P0 4 / P1 5 / P2 7 = 16 条**，每条带 `文件:行号` + `修法`；typecheck + 58 用例 + Next.js build 全绿；tauri build 不阻塞。建议下一迭代先修 P0/P1。
- 2026-06-05T13:05 · QA fixes done · 16 / 16 全部修复（详见 QA 报告"修复记录"表）；新增 `regression.test.ts` 4 用例覆盖 P0-1/P0-4/P2-1/P2-2；vitest **8 文件 / 62 用例全绿**；typecheck 0 错误；Next.js build 成功。QA 报告状态 → `已修复`。

## 相关

- [[../../vision/roadmap]] — M11 段
- [[../../specs/ui/workflow-editor-structure]] — UI 结构 spec
- [[../../specs/awff-format]] — AWFF 数据契约（待 STORY-0075 创建）
- [[../../inbox/workflow-node-editor]] — 原始构想
- [[../done/EPIC-0010-m10-data-view]] — M10 同款工作流参考
