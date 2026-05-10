---
id: STORY-0032
kind: story
title: M3-UI-02 · 全局布局骨架（A/B/C/D 四区域 + 响应式）
status: review
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1.5d
created: 2026-05-10
updated: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/web-chat-structure]]"
  - "[[../../specs/ui/design-language]]"
  - "[[../../specs/ui/component-inventory]]"
related_packages:
  - "packages/apps/web"
tags: [story, ui, layout, shell, M3]
---

# STORY-0032 · 全局布局骨架（A/B/C/D 四区域 + 响应式）

## 用户故事
打开 Web UI 后看到完整的四区域布局，顶栏/左侧导航/中央内容/右侧面板各就各位，窗口缩放时自动适配。

## 验收标准
- [x] A 区域：顶栏 40px 全宽，含 A1 菜单区 + A2 搜索框 + A3 控制区（状态指示 + Gateway 启动按钮 + 面板开关 + 通知铃铛）
- [x] B 区域：左侧导航栏，展开 200px / 折叠 48px，含 B1 模块列表 + B1-自定义占位 + B2 折叠按钮 + B3 用户区
- [x] C 区域：中央内容区 flex:1，根据 B 选中模块渲染不同占位（Chat/技能/系统/设置）
- [x] D 区域：右侧面板 320px（25-30% 宽度），可拖拽 240–640px（minSize 18% / maxSize 50%），可由顶栏按钮整体隐藏
- [x] **D 区内部接入 CollapsiblePanelGroup**：D1 最近 / D2 Skill / D3 Tool / D4 资源管理器 / D5 文件预览 五个折叠面板（VS Code 风）
- [x] 响应式断点：≥1280 全展开 / 1024–1279 D 隐藏 / 768–1023 B 折叠+D 隐藏 / <768 B 隐藏+D 隐藏
- [x] B 区域折叠/展开动画平滑（CSS transition-[width] 200ms ease-out）
- [x] D 区域拖拽调整宽度流畅（react-resizable-panels v2）
- [x] B 折叠态、D 显示态持久化到 localStorage

## 技术要点
- 实现策略（混合方案）：
  - A 顶栏 sticky 固定 40px
  - B 导航宽度由 React state 控制 200/48px，CSS transition
  - C/D 用 ResizablePanelGroup 包裹（D 拖拽 + collapsible），D 隐藏时直接渲染单 ContentArea
- D 区内部：复用 STORY-0031 产出的 `<CollapsiblePanelGroup>` / `<CollapsiblePanel>`
- 响应式：useBreakpoint 双轨（CSS media + React state）
- 持久化：B 折叠态 / D 显隐 各自一个 localStorage key；D 区内部 panel 尺寸由 react-resizable-panels 的 autoSaveId 自动持久化

## 决策记录（2026-05-10 对齐）

| 决策点 | 结论 |
|---|---|
| A/B/C/D 实现 | 混合：A 固定 / B state-driven 200-48 / C/D 用 ResizablePanelGroup |
| D 区内部 | 一上来就接入 CollapsiblePanelGroup 渲染 5 个面板（含占位数据） |
| B 区范围 | 顶部模块列表 + B1-自定义占位 + B2 折叠按钮 + B3 用户区 全拼出来 |
| 字体策略（临时） | woff2 文件未入库，全局 @font-face 改为 `local()` only，系统字体 fallback；后续工单补 woff2 |

## 依赖
- ← STORY-0031（基础组件库 + CollapsiblePanelGroup） ✅

## 非范围
- 各区域内部真实业务内容（C 各模块 / D 各面板的真实数据接入）
- 路由 / 导航 URL 同步
- A 区全局搜索的实际功能（仅 UI 占位）

## 进展日志

- 2026-05-10 created
- 2026-05-10 kickoff：与用户对齐三项决策（D 区接入 CollapsiblePanelGroup / 混合实现策略 / B 区全拼），开始实现
- 2026-05-10 实现完成：
  - **依赖升级**：`packages/apps/web` 加 `@artifex-nexus/ui` (workspace) + `lucide-react` + `react-resizable-panels` + Tailwind v4 PostCSS plugin (`tailwindcss@4` + `@tailwindcss/postcss` + `postcss`)
  - **配置**：`next.config.mjs` 加 `transpilePackages: ["@artifex-nexus/ui"]`（处理 source-only 包）；`postcss.config.mjs` 启 `@tailwindcss/postcss`
  - **全局样式**：`src/app/globals.css` 转发 `@artifex-nexus/ui/globals.css` + `@source` 指令扫描两侧源码
  - **RootLayout**：加 `className="dark"` + `bg-background font-sans text-foreground antialiased`
  - **Shell 组件**：5 个文件（`shell/AppShell.tsx` 主控 / `shell/Topbar.tsx` A 区 / `shell/Sidebar.tsx` B 区 / `shell/ContentArea.tsx` C 区 / `shell/RightPanel.tsx` D 区）
  - **Topbar**：Logo + 全局搜索（⌘K）+ Gateway 状态指示 + 启动按钮 + 面板开关 + 通知铃铛
  - **Sidebar**：4 个模块入口（Chat / 技能/12 / 系统 / 设置）+ 自定义快捷占位 + 折叠按钮 + B3 用户区（Avatar + 设置）；折叠态全部 Tooltip
  - **ContentArea**：4 模块共用占位骨架（C1 控制条 + 主区图标 + 标题 + 副标题）
  - **RightPanel**：CollapsiblePanelGroup 渲染 D1-D5 五个面板，含占位数据（最近 4 项 / 3 个 Skill / 5 个 Tool 含分组 / 资源管理器 / 文件预览）
  - **字体临时修复**：ui 包 globals.css 字体 `@font-face` 从 url() 改为 local() only（woff2 待补工单）
  - 验证：`pnpm -r typecheck` 5/5 ✅；`pnpm -C packages/apps/web build` 成功（路由 `/` 42.1KB，First Load 144KB，全 Static SSG）
  - 已知遗留：字体 woff2 文件入库（独立小工单）；A 搜索框 ⌘K 实际功能（后续 STORY）；B1-自定义快捷链接编辑（后续 STORY）
- 2026-05-10 联调修复（用户验收阶段）：
  - **Hydration error · `<button> in <button>`**：CollapsiblePanel header 是 `<button>`、actions 槽传入真按钮（如刷新）触发嵌套违例。修复：packages/ui 把 CollapsiblePanel / ToolCallItem / ToolCallGroup 三处 header 从 `<button>` 改为 `<div role="button" tabIndex={0} aria-expanded onKeyDown>`，actions 加 `onPointerDown stopPropagation` 防冒泡；保留键盘 Enter/Space 切换 + focus-visible 焦点环
  - **Webpack dev 崩溃**：webpack dev server `__webpack_modules__[moduleId] is not a function` —— Next 15 webpack 对 source-only workspace 包 + 反复 HMR 不友好。修复：`pnpm dev` 改用 `--turbopack`（启动 1.5s vs 5s+，HMR 更稳）
  - **SSR/CSR mismatch**：AppShell 的 useState 初值读 localStorage 导致两侧不一致。修复：useState 改用静态默认值，mount 后用 useEffect 异步恢复偏好；持久化加 mounted 守卫
  - **浏览器扩展注入 `data-haptic-enabled`**：导致 hydration warning（实测无痕窗口正常）。修复：`<html>` / `<body>` 加 `suppressHydrationWarning`（React 官方做法）；告知用户在 chrome://extensions 禁用相关 haptic/震动反馈扩展可彻底消除子树警告
  - 验证：无痕窗口完全无警；用户已确认正常窗口体验 OK
  - 用户决议：本 STORY 验收通过，迁 review/
