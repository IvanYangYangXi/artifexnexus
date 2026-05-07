---
tags: [vision, roadmap]
created: 2026-05-04
status: accepted
---

# Artifex Nexus 开发路线图

> 本文是 M0–M8 九个阶段的**唯一纲领**。每个阶段只写目标、范围、交付与"可分发"定义；
> 细化落在各 EPIC 卡（`docs/tasks/backlog/EPIC-*.md`）里，正式开发前再 `/sdd align` 展开成 STORY / TASK。

## 核心原则

1. **每阶段都必须可安装分发**：阶段末尾 Tauri 桌面应用应能打包出一个可装的 artifact，便于自测与提前感知最终形态。
2. **UI 先行出结构设计**：所有涉及 GUI 的阶段，先产出 `docs/specs/ui/<module>-structure.md`（信息架构 + 线框/流程图），再写代码。
3. **统一设计语言**：Web UI 阶段（M3）确立一次设计令牌（token）与组件规范，后续所有界面复用，不各画各的。
4. **UI 辅助工具**：允许在 UI 设计步骤引入 [`ui-ux-pro-max-skill`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 作为参考，但最终规格必须沉淀到 `docs/specs/ui/`。
5. **前序未稳不入下阶段**：每阶段通过"DoD / 出口条件"后才开 EPIC 卡展开下一阶段。

## 阶段总览

| 里程碑 | 标题 | EPIC 卡 | 可分发交付 |
|---|---|---|---|
| M0 | 安装向导框架 | [[../tasks/backlog/EPIC-0000-m0-installer-wizard]] | 能双击安装的 Tauri 壳，含安装清单 UI（无真实安装逻辑） |
| M1 | 基地改造 · 一键安装 | [[../tasks/backlog/EPIC-0001-m1-onboarding-install]] | 真正装上 OpenClaw 到 `~/.artifexnexus/.openclaw/` |
| M2 | 骨架贯通 · Blender MCP | [[../tasks/backlog/EPIC-0002-m2-blender-mcp-e2e]] | 装完能从 OpenClaw 调到 Blender 跑 `run_python` |
| M3 | Web UI 框架 + Chat | [[../tasks/backlog/EPIC-0003-m3-web-ui-chat]] | Web UI 可用，内含 chat，**确立设计语言** |
| M4 | Skill 系统 | [[../tasks/backlog/EPIC-0004-m4-skill-system]] | 能从 Web UI 装 / 卸 / 调 Skill |
| M5 | Tool 系统 | [[../tasks/backlog/EPIC-0005-m5-tool-system]] | Tool 定义 / 发现 / 调用闭环，与 Skill 解耦管理 |
| M6 | 定制记忆 | [[../tasks/backlog/EPIC-0006-m6-memory-system]] | 记忆层可配置，跨会话持久 |
| M7 | 多 DCC 接入 + 内嵌 Chat | [[../tasks/backlog/EPIC-0007-m7-multi-dcc-inapp-chat]] | UE / Max / Maya / Blender 都连通，软件内可直接聊 |
| M8 | ComfyUI MCP + Workflow 管理 | [[../tasks/backlog/EPIC-0008-m8-comfyui-workflow]] | ComfyUI 作为 MCP 接入，Web UI 管理 workflow |
| M9 | 扩展 DCC（SP / SD / Houdini） | [[../tasks/backlog/EPIC-0009-m9-extra-dcc]] | 安装向导新增三类 DCC，至少一个 E2E 通 |

## 阶段详情

### M0 · 安装向导框架

- **目标**：把现有 `apps/desktop` 的三屏向导改造为 **安装清单式向导**（见 [[../inbox/安装向导]]）；
  顶级条目含 OpenClaw / Web UI / DCC 列表，DCC 可展开子项（不同版本 / 工程路径 / 脚本），
  每项三按钮：检测 / 设置 / 安装；自动检测状态（不可用 / 待安装 / 已安装）；
  强制先装 OpenClaw 再装其他。
- **范围**：UI 结构 + 交互骨架 + 状态机。安装真实落地放 M1。
- **UI 先行产物**：`docs/specs/ui/installer-structure.md`。
- **可分发定义**：`tauri build` 出 installer 可执行；启动进向导；清单可点，"安装"按钮走桩数据。
- **出口条件**：向导结构 spec accepted；UI 走查通过；可产出安装包。

### M1 · 基地改造 · 一键安装

- **目标**：把 M0 的向导接上真实安装逻辑 —— OpenClaw vendor 落位到 `~/.artifexnexus/.openclaw/`，
  端口探测（19789 起），配置文件生成，启停守护。
- **依赖**：[[../specs/openclaw-wrapper-install]]、[[../specs/openclaw-wrapper-runtime]]。
- **可分发定义**：用户下载安装包 → 双击 → 首启向导 → 点 "安装 OpenClaw" → 能看到 OpenClaw 起来并健康检查通过。
- **出口条件**：[[../tasks/review/TASK-0001-openclaw-wrapper]] 的 M3+ 验收合并。

### M2 · 骨架贯通 · Blender MCP

- **目标**：以 Blender 为首个 DCC 跑通"上行 + 下行"全链路。先选 Blender 是因为它脚本调起最轻、验证成本最低。
- **范围**：`packages/adapters/openclaw/uplink` 的 Blender 侧、`gateway-plugin` 工具前缀、
  `packages/dcc/blender` 插件注入、`run_python` 单工具。
- **可分发定义**：装好后能在 OpenClaw 侧输入一句自然语言，在 Blender 里成功 print hello。

### M3 · Web UI 框架 + Chat（确立设计语言）

- **目标**：搭起 `packages/apps/web`，提供 chat 主界面；**本阶段确立统一设计语言**（design tokens / 组件库 / 交互规范）。
- **UI 先行产物**：
  - `docs/specs/ui/design-language.md`（颜色 / 字体 / 间距 / 圆角 / 阴影 / 动效，token 表）
  - `docs/specs/ui/component-inventory.md`（基础组件清单与状态）
  - `docs/specs/ui/web-chat-structure.md`
- **辅助工具**：允许引入 [`ui-ux-pro-max-skill`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 做 UX 探索；结论沉淀回上述三份 spec。
- **回填**：M0 安装向导在本阶段用新设计语言**重刷一遍**视觉（不改结构）。
- **可分发定义**：Web UI 打包出 artifact，桌面应用能内嵌加载，chat 能连通 OpenClaw（mock 模型亦可）。

### M4 · Skill 系统

- **目标**：Skill 子系统（`packages/platform/skill/`）的运行时 + Web UI 管理台接入。
- **依赖**：[[../specs/skill-system]]。
- **可分发定义**：用户在 Web UI 列表装一个官方示例 Skill，Blender 中可调用。

### M5 · Tool 系统

- **目标**：Tool 注册中心与运行时，Web UI 可浏览/启停，Skill 内 `@tool` 发现。
- **可分发定义**：Web UI 的 Tools 页能列全局 Tool 列表并能单次调用。

### M6 · 定制记忆

- **目标**：`packages/platform/core` 的 memory 子系统 + Web UI 管理面板。
- **可分发定义**：会话跨次保留，可配置策略，Web UI 可查看 / 清理。

### M7 · 多 DCC 接入 + 软件内 Chat

- **目标**：UE 5.7 / Max / Maya / Blender 全部接通；每个 DCC 插件内提供 chat 面板（嵌 Web UI 或子集）。
- **UI 先行产物**：`docs/specs/ui/inapp-chat-structure.md`（桌面端与 DCC 内的差异）。
- **可分发定义**：在 UE/Max/Maya/Blender 任一软件内打开面板能直接聊天并触发 DCC 操作。

### M8 · ComfyUI MCP + Workflow 管理

- **目标**：ComfyUI 以 MCP 身份接入；Web UI 提供 workflow 的导入 / 编辑 / 调度 / 执行视图。
- **UI 先行产物**：`docs/specs/ui/workflow-manager-structure.md`。
- **可分发定义**：用户能在 Web UI 导入一个 ComfyUI workflow 并一键跑通。

## 规划与任务层级

详见 [[../development/task-management]]。采用三级：

```
EPIC (阶段 / 大特性)  ──► STORY (可交付子特性)  ──► TASK (具体编码任务)
```

- EPIC 编号：`EPIC-NNNN-<slug>`，本路线图一个阶段对应一张。
- STORY 编号：`STORY-NNNN-<slug>`，由 EPIC 细化而来。
- TASK 编号：`TASK-NNNN-<slug>`，与现有卡片同一编号空间（续用）。
- 三者共用 `docs/tasks/` 生命周期目录（backlog/ready/in-progress/review/done/archived），通过 frontmatter 的 `kind` 区分。

## 相关

- [[north-star]] — 北极星目标
- [[../specs/系统架构设计]]
- [[../development/task-management]]
- [[../development/sdd-workflow]]
- [[../inbox/安装向导]] — M0 新需求入口
