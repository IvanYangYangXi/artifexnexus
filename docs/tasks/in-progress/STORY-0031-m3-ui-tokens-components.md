---
id: STORY-0031
kind: story
title: M3-UI-01 · 设计令牌 + 基础组件库
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-10
updated: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/design-language]]"
  - "[[../../specs/ui/component-inventory]]"
related_packages:
  - "packages/apps/web"
  - "packages/ui"
tags: [story, ui, tokens, components, M3]
---

# STORY-0031 · 设计令牌 + 基础组件库

## 用户故事
作为开发者，我能使用统一的 Tailwind CSS token 和 shadcn/ui 组件搭建所有界面，后续任何页面都基于此组件库构建。

## 验收标准
- [x] `packages/ui/tailwind.preset.ts` 导出完整 Tailwind preset（颜色/字体/间距/圆角/阴影）
- [x] CSS 变量 token 表落地（`globals.css`），深色主题为主
- [x] P0 组件全部实现：Button / Input / Textarea / Card / Badge / Dialog / DropdownMenu / Tabs / ScrollArea / Tooltip
- [x] P1 补齐：Separator / Skeleton / Toast(Sonner)（本 STORY 一次做足）
- [x] **P2 补齐（2026-05-10 扩展）**：Avatar / Select / Checkbox / Switch / RadioGroup / Label / Popover / Command / Collapsible / Sheet / ContextMenu / Progress / Resizable —— 覆盖 web-chat-structure.md 全部组件依赖
- [x] **VS Code 风格 4 层灰阶 token**：新增 `--titlebar` / `--sidebar` / `--panel` 区域专用 token（19/24/31/37 灰度）
- [x] **风格 E（A+D 整合）落地为组件默认外观**：Card glass variant / Button 玻璃化 / Dialog/Popover/Sheet 玻璃面 / Avatar primary 描边环 / Skeleton shimmer
- [x] **业务组件 ToolCallGroup**：受 `ToolCallData` 类型驱动的双层折叠（chat 工具调用渲染）
- [x] **业务组件 CollapsiblePanelGroup**：VS Code 风纵向折叠面板组（D 区资源管理：多个展开时支持拖拽调高度，autoSave 持久化）
- [x] 每个组件 ≤ 300 行，使用 `cva` 变体 + `cn()` 类合并 + `forwardRef`
- [x] 组件 demo 页面可预览（`pnpm -C packages/ui dev` 端口 18791）
- [x] `pnpm -C packages/ui typecheck` 通过（方案 A 纯源码包，无 build 步骤）

## 技术要点
- 基于 `design-language.md` 的 HSL token 表（含 4 层灰阶 + 区域专用 token + 玻璃面策略）
- 基于 `component-inventory.md` 的 P0/P1/P2 + 业务组件清单（共 28 个）
- shadcn/ui（Radix UI + Tailwind CSS v4）为底层
- 字体：Inter（UI）+ JetBrains Mono（代码/日志），本地自托管 woff2
- 风格 E：A 玻璃分层 + D 信息层级，去渐变，单色品牌钢蓝（213 78% 65%）

## 关键设计决策（2026-05-10 对齐）

| 决策点 | 结论 | 备注 |
|---|---|---|
| 包形态 | 方案 A：纯源码包，`exports` 直指 `.tsx` | 无 build step，HMR 秒级；消费者 bundler 直接编译 |
| Tailwind 版本 | **v4**（CSS `@theme` + `@tailwindcss/vite`） | design-language.md 指定 |
| demo 预览 | Vite + React，`packages/ui/demo/`，端口 18791 | 与 apps/desktop 前端栈一致 |
| 字体分发 | 本地 woff2 自托管（`packages/ui/src/fonts/`） | 离线可用，DCC 内嵌无网 OK |
| **灰阶层级** | **VS Code 风 4 层中性灰**（19/24/31/37） | 保留 primary 蓝为唯一彩色高亮 |
| **设计风格** | **风格 E（A+D 整合）** —— A 玻璃分层 + D 信息层级，去渐变 | 经过 A/B/C/D 4 版风格探索后定稿 |
| **玻璃面 vs 灰阶共存** | **方案 1（2026-05-10 决议）**：灰阶 token 不动 + 玻璃只用于卡片 / 弹层 | 见 `design-language.md` §3.5 |
| **业务组件抽象** | ToolCallGroup（chat 工具调用）+ CollapsiblePanelGroup（D 区折叠面板）封装入 packages/ui | 全局复用，对接 contracts 类型 |

## 非范围
- 业务页面逻辑
- `packages/apps/web` / `apps/desktop` 的实际消费接线（S2 及后续 STORY 做）

## 进展日志

- 2026-05-10 created
- 2026-05-10 kickoff：完成 5 项关键设计对齐（包形态/Tailwind 版本/demo 方案/组件范围/字体分发），开始实现
- 2026-05-10 第一轮实现完成：13 个组件（P0×10 + P1×3）+ 设计令牌 + Vite demo gallery。
  - 产物：`packages/ui/src/`（globals.css + tailwind.preset.ts + 13 components + cn lib）+ `packages/ui/demo/`（Vite gallery，端口 18791）+ `packages/ui/README.md`
  - 验证：`pnpm -C packages/ui typecheck` 零错误；`pnpm -C packages/ui run build:demo` 成功（1665 modules，CSS 27.68KB/gzip 5.76KB）
- 2026-05-10 第二轮扩展（用户反馈触发）：
  - **视觉**：原深蓝灰色调 → VS Code 风中性灰 4 层（19/24/31/37）；新增 `--titlebar` / `--sidebar` / `--panel` 三组区域 token
  - **组件**：再补 P2 共 13 个（覆盖 web-chat-structure.md 全部依赖）
  - **依赖**：新增 11 个 Radix 包 + cmdk + react-resizable-panels
  - 验证：typecheck 零；build 1699 modules
- 2026-05-10 第三轮风格探索：
  - **token 调校**：钢蓝 `213 78% 65%`（去刺眼 + 提亮配白文字）；destructive 提亮到 51% L 配白文字；新增 success/warning/info/shimmer
  - **4 版风格对比**：A · Liquid Glass / B · Mica Fluent 2 / C · Cursor Linear / D · Aurora Mesh，用同一组样本（OpenClaw 状态卡 + 工具调用双层折叠 + 3 状态按钮 + chat 输入）
  - **用户决策**：A+D 整合（保留 A 的玻璃分层、保留 D 的信息层级 / 字号梯度 / 头像装饰，去除 D 的渐变）→ 风格 E 定稿
  - **行高调校**：工具调用外层折叠头取 A/D 中间值（28px）；内层项压到 22px
- 2026-05-10 第四轮：风格 E 应用到全工程
  - **utility**：globals.css 加 `glass-surface` / `glass-surface-inner` / `glass-hover` / `text-eyebrow` 四个 utility
  - **组件升级**：Card 加 glass variant + CardSection 子组件；Button 加 inset 高光 + brightness hover + shape pill；Dialog/Popover/Sheet 玻璃面；Avatar 加 ring prop（默认 primary）；Skeleton shimmer
  - **业务组件 ToolCallGroup**：双层折叠 + 状态色 stripe + Tag 计数（chat 工具调用渲染）
  - **业务组件 CollapsiblePanelGroup（VS Code 风）**：基于 react-resizable-panels v2 的 collapsible/collapsedSize 原生能力 + ResizeObserver 动态计算 collapsedSize 百分比；多个展开时支持拖拽调高度，autoSaveId 持久化用户尺寸
  - **共存方案决议**：灰阶 + 玻璃方案 1（灰阶不动，玻璃只用卡片/弹层），写入 `design-language.md` §3.5
  - **Gallery 整体回填 E 风** + 新增 `#/region-tokens` 共存方案对比页
  - 验证：全工程 5/5 包 typecheck；build 1710 modules，CSS 98.74KB/gzip 14KB
  - **总组件数**：26 基础 + 2 业务 = **28 个**
  - 已知遗留：字体 woff2 未入库；待人类 review 后迁 review/done
