---
id: EPIC-0003
kind: epic
title: M3 · Web UI 框架 + Chat（确立统一设计语言）
status: done
priority: P1
owner: "@ivan"
assignee: pair
estimate: 3w
created: 2026-05-04
updated: 2026-05-28
completed: 2026-05-28
parent: "[[../../vision/roadmap]]"
milestone: M3
related_adr: []
related_specs:
  - "[[../../specs/ui/design-language]]"
  - "[[../../specs/ui/installer-structure]]"
related_packages:
  - "packages/apps/web"
  - "packages/ui"
  - "apps/desktop"
tags: [epic, web, ui, chat, design-language, M3, done]
---

# M3 · Web UI 框架 + Chat ✅ DONE

## 背景与目标

搭起 Web UI 主框架与 chat 主界面；**本阶段同时确立 Artifex Nexus 统一设计语言**，
后续所有界面（含 M0 向导）都用这套 token 与组件复刷。

## 实际交付（超出原计划）

### App Shell 四面板布局
- Topbar（40px）：Gateway 状态指示 / 通知 / 设置入口
- Sidebar（48-200px，可折叠）：导航菜单 + 自定义连接
- 主内容区：Chat / Skills / Tools / Calendar / System / Settings 页面路由
- 右侧面板（可调整大小/折叠/隐藏）：资源浏览器 + 详情面板
- 响应式断点：>=900 全展开 / 768-899 窄屏 / <768 移动端

### Chat 子系统（完整实现）
- ChatView / ChatInputArea（含 @提及）/ ChatMessageList（Markdown 渲染 + 语法高亮）
- ChatControlBar（会话下拉/新建/切换）
- Gateway WebSocket 实时通信
- 会话持久化（IndexedDB）+ 自动清理（空会话 >24h + 过期 >30d）
- sessionKey 统一格式管理
- DCC 预输入上下文注入

### Skills / Tools UI
- SkillsPage：浏览/过滤（FiltersTab）/安装/发布（PublishConfirmDialog）/运行（RunPanel）
- ToolDetailPanel / NexusToolList：工具浏览和详情
- ItemCard / TagEditor：通用 UI 组件

### 其他功能模块
- Calendar：月/周/日视图 + 任务列表 + cron 表达式 + 过滤器
- System：Gateway 健康仪表板
- Settings：应用设置面板
- Notifications：铃铛通知中心 + Toast 气泡（sonner）
- QuickLinks：快速链接管理
- Gateway 启动流程：全屏遮罩 + 轮询检查 + 60s 超时

### 设计系统（@artifex-nexus/ui）
- Tailwind CSS v4 + CSS 变量 token（HSL 色彩系统）
- 27 个 shadcn/ui 风格组件（Button/Input/Dialog/DropdownMenu/Tabs/ScrollArea/Tooltip 等）
- 业务组件：ToolCall / CollapsiblePanel
- 全局 CSS 入口（globals.css + tailwind.preset）
- M0 安装向导已用新设计语言回填

### 技术要点
- Next.js 15 + Turbopack + static export（产出 `out/` 目录）
- react-resizable-panels 面板系统
- 多 Context Provider 分层（Gateway/DCCStatus/ChatPrompt 等）
- 双通道通知（Tauri IPC + Gateway WS）
- tailwindcss-animate 动画系统
- 完整 Web 前端开发文档（`docs/development/web-frontend-setup.md`）

## 子节点（STORY 列表，全部完成）

| # | STORY | 状态 |
|---|-------|------|
| S1 | STORY-0031 — 设计令牌 + 基础组件库 | ✅ done |
| S2 | STORY-0032 — 全局布局骨架 A/B/C/D | ✅ done |
| S3 | STORY-0033 — B 区域导航 | ✅ done |
| S4 | STORY-0034 — Chat 模块 UI | ✅ done |
| S5 | STORY-0035 — Skills/Tools UI | ✅ done |
| S6 | STORY-0036 — System 模块 UI | ✅ done |
| S7 | STORY-0037 — Settings + 右侧面板 | ✅ done |
| S8 | STORY-0038 — Desktop 内嵌 | ✅ done |
| S9 | STORY-0039 — Chat API 接线 | ✅ done |
| S10 | STORY-0040 — 功能模块 API 接线 | ✅ done |

## 进展日志

- 2026-05-28 **标记完成**：全量对照代码确认，所有 STORY 已完成且超越原计划交付
- 2026-05-10 STORY 拆分完成
- 2026-05-09 三份 UI spec 完成
- 2026-05-04 created
