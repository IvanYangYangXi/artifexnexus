---
tags: [vision, roadmap]
created: 2026-05-04
updated: 2026-05-28
status: accepted
---

# Artifex Nexus 开发路线图

> 本文是 M0–M12 十三个阶段的**唯一纲领**。每个阶段只写目标、范围、交付与"可分发"定义；
> 细化落在各 EPIC 卡（`docs/tasks/backlog/EPIC-*.md`）里，正式开发前再 `/sdd align` 展开成 STORY / TASK。
>
> **最后更新 2026-05-28**：全量对照实际代码功能更新状态；新增 M10（数据图形视图）、M11（工作流编辑器）、M12（DCC 平台化 API）。

## 核心原则

1. **每阶段都必须可安装分发**：阶段末尾 Tauri 桌面应用应能打包出一个可装的 artifact，便于自测与提前感知最终形态。
2. **UI 先行出结构设计**：所有涉及 GUI 的阶段，先产出 `docs/specs/ui/<module>-structure.md`（信息架构 + 线框/流程图），再写代码。
3. **统一设计语言**：Web UI 阶段（M3）确立一次设计令牌（token）与组件规范，后续所有界面复用，不各画各的。
4. **UI 辅助工具**：允许在 UI 设计步骤引入技能作为参考，但最终规格必须沉淀到 `docs/specs/ui/`。
5. **前序未稳不入下阶段**：每阶段通过"DoD / 出口条件"后才开 EPIC 卡展开下一阶段。

## 阶段总览

| 里程碑 | 标题 | 状态 | EPIC 卡 | 可分发交付 |
|---|---|---|---|---|
| M0 | 安装向导框架 | ✅ DONE | [[../tasks/done/EPIC-0000-m0-installer-wizard]] | 能双击安装的 Tauri 壳，含安装清单 UI |
| M1 | 基地改造 · 一键安装 | 🔄 REVIEW | [[../tasks/done/EPIC-0001-m1-onboarding-install]] | 装 OpenClaw 到 `~/.artifexnexus/.openclaw/`，含设置/WebUI/Agent预设 |
| M2 | 骨架贯通 · Blender MCP | ✅ DONE | [[../tasks/done/EPIC-0002-m2-blender-mcp-e2e]] | Blender MCP 全链路贯通，`run_python` 可用 |
| M3 | Web UI + Chat + 设计语言 | ✅ DONE | [[../tasks/done/EPIC-0003-m3-web-ui-chat]] | 四面板 Web UI（Chat/Skills/Tools/System/Calendar/Settings），设计系统成型 |
| M4 | Skill 系统 | ✅ DONE | [[../tasks/done/EPIC-0004-m4-skill-system]] | SkillHub + Registry + Installer + 66 Skills |
| M5 | Nexus-Tool 系统 | ✅ DONE | [[../tasks/done/EPIC-0005-m5-nexus-tool-system]] | Tool Registry + 触发系统 + 8 Tools |
| M6 | 定制记忆 | ✅ DONE | [[../tasks/done/EPIC-0006-m6-memory-system]] | 三层记忆 + 自动清理 |
| M7 | 多 DCC 接入 | 🔄 IN PROGRESS | [[../tasks/backlog/EPIC-0007-m7-multi-dcc-inapp-chat]] | UE/Maya/Max/Blender 全接通 + 内嵌 Chat |
| M8 | ComfyUI MCP | 📋 PLANNED | [[../tasks/backlog/EPIC-0008-m8-comfyui-workflow]] | ComfyUI MCP 接入 + Workflow 管理 |
| M9 | 扩展 DCC | 📋 PLANNED | [[../tasks/backlog/EPIC-0009-m9-extra-dcc]] | SP/SD/Houdini/Unity 插件 |
| **M10** | **数据图形视图** | 📋 **PLANNED [NEW]** | EPIC-0010（待创建） | ANDF + CSV 导入 + 8 视图 + 反向编辑 |
| **M11** | **工作流编辑器** | 📋 **PLANNED [NEW]** | EPIC-0011（待创建） | WorkflowEngine + 节点画布 + 右侧面板分页 |
| **M12** | **DCC 平台化 API** | 📋 **PLANNED [NEW]** | EPIC-0012（待创建，最后做） | 动态注册/插件 API/端口管理/连接标识 |

## 规划与任务层级

详见 [[../development/task-management]]。采用三级：

```
EPIC (阶段 / 大特性)  ──► STORY (可交付子特性)  ──► TASK (具体编码任务)
```

- EPIC 编号：`EPIC-NNNN-<slug>`，本路线图一个阶段对应一张。
- STORY 编号：`STORY-NNNN-<slug>`，由 EPIC 细化而来。
- TASK 编号：`TASK-NNNN-<slug>`，与现有卡片同一编号空间（续用）。
- 三者共用 `docs/tasks/` 生命周期目录（backlog/ready/review/done/archived），通过 frontmatter 的 `kind` 区分。

## 阶段详情

### M0 · 安装向导框架 ✅ DONE

- **目标**：把现有 `apps/desktop` 的三屏向导改造为 **安装清单式向导**（见 [[../inbox/installer-wizard]]）；
  顶级条目含 OpenClaw / Web UI / DCC 列表，DCC 可展开子项（不同版本 / 工程路径 / 脚本），
  每项三按钮：检测 / 设置 / 安装；自动检测状态（不可用 / 待安装 / 已安装）；
  强制先装 OpenClaw 再装其他。
- **范围**：UI 结构 + 交互骨架 + 状态机。安装真实落地放 M1。
- **UI 先行产物**：`docs/specs/ui/installer-structure.md`。
- **可分发定义**：`tauri build` 出 installer 可执行；启动进向导；清单可点，"安装"按钮走桩数据。
- **出口条件**：向导结构 spec accepted；UI 走查通过；可产出安装包。

### M1 · 基地改造 · 一键安装 🔄 REVIEW

- **目标**：把 M0 的向导接上真实安装逻辑 —— OpenClaw vendor 落位到 `~/.artifexnexus/.openclaw/`，
  端口探测（19789 起），配置文件生成，启停守护。
- **依赖**：[[../specs/openclaw-wrapper-install]]、[[../specs/openclaw-wrapper-runtime]]。
- **当前状态**：核心功能已实现（STORY-0007 至 STORY-0020），审查中发现 5 个 P0 问题。Batch2（设置/WebUI/Agent预设）已在代码中落地。
- **可分发定义**：用户下载安装包 → 双击 → 首启向导 → 点 "安装 OpenClaw" → 能看到 OpenClaw 起来并健康检查通过。
- **出口条件**：P0 审查问题全部解决并验收通过。

### M2 · 骨架贯通 · Blender MCP ✅ DONE

- **目标**：以 Blender 为首个 DCC 跑通"上行 + 下行"全链路。
- **实际交付**：STORY-0021 至 STORY-0030 全部完成。Blender addon 骨架、适配器、MCP Server、Gateway 桥接、E2E 烟雾测试全部通过。
- **可分发定义**：装好后能在 OpenClaw 侧输入一句自然语言，在 Blender 里成功执行操作。

### M3 · Web UI 框架 + Chat + 设计语言 ✅ DONE

- **目标**：搭起 `packages/apps/web`，提供完整 Web UI；**确立统一设计语言**（design tokens / 组件库 / 交互规范）。
- **实际交付（超出原计划）**：
  - **App Shell**：4 面板布局（顶栏/可折叠侧栏/主内容区/右侧面板），响应式断点
  - **Chat 子系统**：完整 AI 聊天界面（ChatView/InputArea/MessageList/ControlBar），@提及/Gateway WS/会话管理/持久化/自动清理
  - **Skills UI**：浏览/过滤/安装/发布/运行管理，完整生命周期界面
  - **Tools UI**：NexusTool 浏览和详情面板
  - **Calendar 模块**：任务调度日历（月/周/日视图），cron 表达式支持
  - **System 页面**：Gateway 健康仪表板
  - **Settings 页面**：应用设置
  - **Notifications**：铃铛通知中心 + Toast 气泡
  - **Quick Links**：快速链接管理
  - **Design System**：`@artifex-nexus/ui` 共享组件库（27 个 shadcn/ui 组件 + 业务组件），Tailwind v4 + CSS 变量 token
- **可分发定义**：Web UI 打包出 artifact，桌面应用内嵌加载，chat 能连通 OpenClaw（已实现，非 mock）。

### M4 · Skill 系统 ✅ DONE

- **目标**：Skill 子系统（`packages/platform/skill/`）的运行时 + Web UI 管理台接入。
- **实际交付（超出原计划）**：
  - **SkillHub**：运行时加载/执行 Skill 入口，分层加载（`00_official > 01_team > 02_user > 99_custom`）
  - **SkillRegistry**：查询/匹配/最佳版本选择
  - **SkillInstaller**：全生命周期（install/publish/sync/uninstall/enable/disable）
  - **装饰器系统**：`@skill_tool` 统一装饰器
  - **Manifest**：Pydantic v2 解析，双格式支持（manifest.json + SKILL.md frontmatter）
  - **版本管理**：Semver 版本比较
  - **冲突检测**：多层命名冲突检测
  - **66 个 Skills**：5 个官方 + 61 个 marketplace，跨 11 种软件（UE/Blender/Maya/Max/ComfyUI/Houdini/SD/SP/Unity）
  - **Web UI 集成**：完整 SkillsPage，FiltersTab/ItemCard/TagEditor/PublishConfirmDialog/RunPanel
- **可分发定义**：用户在 Web UI 列表装一个官方示例 Skill，Blender 中可调用（已实现）。

### M5 · Nexus-Tool 系统 ✅ DONE

- **目标**：Tool 注册中心与运行时，Web UI 可浏览/启停，Skill 内 `@tool` 发现。
- **实际交付**：
  - **NexusToolRegistry**：工具发现/注册/查询
  - **NexusToolInstaller**：安装/卸载管理
  - **RPC 层**：`nexus_tool_rpc.py` 工具执行 RPC
  - **触发系统**：`trigger_dispatcher.py` 三态触发器（无触发/启动触发/禁用触发）
  - **8 个 Tools**：2 个官方（合规检查器）+ 6 个 marketplace（Blender/通用自动化工具）
  - **Web UI**：ToolDetailPanel + NexusToolList
- **可分发定义**：Web UI 的 Tools 页能列全局 Tool 列表并能单次调用（已实现）。

### M6 · 定制记忆 ✅ DONE

- **目标**：`packages/platform/core` 的 memory 子系统 + Web UI 管理面板。
- **实际交付**：
  - 三层记忆体系：Cloud Memory（服务端）+ User-level Local Memory（`~/.workbuddy/MEMORY.md`）+ Workspace Memory（`.workbuddy/memory/`）
  - 会话跨次保留，可配置策略
  - 对话自动清理（空会话 >24h + 过期 >30d 自动删除）
- **可分发定义**：会话跨次保留，可配置策略，Web UI 可查看/清理（已实现）。

### M7 · 多 DCC 接入 + 软件内 Chat 🔄 IN PROGRESS

- **目标**：UE 5.7 / 3ds Max / Maya / Blender 全部接通；每个 DCC 插件内提供 chat 面板（嵌 Web UI 或子集）。
- **当前状态**：
  - ✅ Blender 插件完整（M2 完成）
  - ✅ Maya 插件骨架已存在（`packages/dcc/maya/`：adapter/UI/MCP Server/trigger）
  - ✅ 3ds Max 插件骨架已存在（`packages/dcc/max/`：adapter/UI/MCP Server/trigger/startup）
  - ✅ Gateway MCP Bridge 已配置 Maya(18081)/Max(18082) 端口
  - ✅ 安装向导 UI 已支持 Maya/Max 子项
  - 🔄 UE 插件增强中（Blueprint API/Editor Subsystem/Control Panel/Trigger System）
  - 🔄 共享 SDK 模块提取（`packages/dcc/shared/artifex_nexus_sdk/`）
  - 📋 内嵌 Chat 面板待推进
- **UI 先行产物**：`docs/specs/ui/inapp-chat-structure.md`（待创建）。
- **可分发定义**：在 UE/3ds Max/Maya/Blender 任一软件内打开面板能直接聊天并触发 DCC 操作。

### M8 · ComfyUI MCP + Workflow 管理 📋 PLANNED

- **目标**：ComfyUI 以 MCP 身份接入；Web UI 提供 workflow 的导入 / 编辑 / 调度 / 执行视图。
- **当前状态**：14 个 ComfyUI Skills 已创建（txt2img/img2img/inpainting/controlnet/hires-fix/workflow-builder/workflow-manager/workflow-repair/workflow-validator/model-manager/node-installer/civitai/operation-rules/context），但 MCP Server 接入和 Workflow 管理 UI 尚未开始。
- **UI 先行产物**：`docs/specs/ui/workflow-manager-structure.md`。
- **可分发定义**：用户能在 Web UI 导入一个 ComfyUI workflow 并一键跑通。

### M9 · 扩展 DCC（SP / SD / Houdini / Unity）📋 PLANNED

- **目标**：安装向导新增 Substance Painter、Substance Designer、Houdini、Unity 四类 DCC。
- **当前状态**：所有四款软件的 Skills 已创建（SP 4 个、SD 9 个、Houdini 4 个、Unity 5 个），但 DCC 插件和安装器逻辑尚未开发。
- **可分发定义**：安装向导新增四类 DCC，至少一个 E2E 通。

### M10 · 数据图形视图 📋 PLANNED [NEW]

- **目标**：定义 ANDF 数据格式，支持从 CSV 导入数据，渲染多种图形视图，支持数据直展型视图的反向编辑。
- **设计要点**：
  - ANDF（Artifex Nexus Data Format）：列定义 + 行数组 + 视图配置
  - 8 种视图类型：Table / Card / List / Tree（可编辑） + Bar / Pie / Line / Scatter（只读）
  - 视图样式决定可用字段，字段名可自定义，扩展字段视图支持即支持
  - 反向编辑：单元格修改 → ANDF Diff → 导出 CSV
  - 基础统计：min/max/avg/sum/median/count/unique
- **UI 先行产物**：`docs/specs/ui/data-view-structure.md`（待创建）
- **可分发定义**：用户拖入 CSV → 选择视图 → 编辑数据 → 导出

### M11 · 节点式工作流编辑器 📋 PLANNED [NEW]

- **目标**：可视化节点编辑工作流，参考 ComfyUI 体验。平台编码控制生命周期，节点能力控制暂停/分支/终止。
- **设计要点**：
  - WorkflowEngine：拓扑排序 → 按序执行 → 上下文传递（`{{nodeId.outputKey}}`）
  - 节点分类：触发 / 工具 / AI 对话 / 用户交互 / 控制流 / 数据 / 脚本 / 输出
  - 右侧面板 Workflow 分页：运行状态 + 节点 UI + 按钮控制（暂停/继续/终止）
  - Gateway 仅参与对话类节点（Send to Chat / Get Chat Response / AI Analysis）
  - AWF（Artifex Nexus Workflow Format）：节点 + 连线 JSON 序列化
- **UI 先行产物**：`docs/specs/ui/workflow-editor-structure.md`（待创建）
- **可分发定义**：用户编排一个"Run Tool → Send to Chat → User Choice → Run Skill"工作流并完整执行

### M12 · DCC 平台化 API 📋 PLANNED [NEW]（最后做）

- **目标**：开放全套 DCC 接入 API，用户通过 Chat + AI 引导即可接入任意新 DCC 软件。
- **设计要点**：
  - 动态枚举注册 / Gateway Plugin API / MCP Server 启动 API
  - 端口动态分配 / 连接状态注册 / 安装检测插件化
  - 新增 `dcc-platform-integration` 指引 Skill
- **可分发定义**：用户与 AI 对话"接入 Rhino"，自动完成全流程接入

## 当前焦点

| 优先级 | 工作项 | 说明 |
|---|---|---|
| P0 | **M10 数据图形视图** | ANDF 格式 + CSV 导入 + 8 种视图 + 反向编辑 |
| P0 | **M11 节点式工作流编辑器** | WorkflowEngine + 节点画布 + 右侧面板分页 |
| P1 | M1 EPIC-0001 审查修复 | 5 个 P0 问题待解决 |
| P1 | M7 UE 插件增强 | Blueprint API / Trigger System / Control Panel |
| P2 | M7 Maya/Max E2E 验证 | 端到端流程贯通 |
| P2 | M7 内嵌 Chat 面板 | DCC 软件内 AI 对话面板 |
| P3 | M8 ComfyUI MCP 接入 | MCP Server + Workflow UI |
| P3 | M9 扩展 DCC 插件 | SP/SD/Houdini/Unity |
| P3 | M12 DCC 平台化 API | 最后做 |

## 相关

- [[north-star]] — 北极星目标
- [[../specs/系统架构设计]]
- [[../development/task-management]]
- [[../development/sdd-workflow]]
- [[../inbox/data-visualization-view]] — M10 inbox
- [[../inbox/workflow-node-editor]] — M11 inbox
- [[../inbox/platform-extension-api]] — M12 inbox
