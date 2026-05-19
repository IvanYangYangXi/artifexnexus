## ADDED Requirements

### Requirement: 共享 UI 包结构
系统 SHALL 在 `packages/ui/` 维护一个名为 `@artifex-nexus/ui` 的 monorepo 内部包，导出所有基础 UI 组件和样式入口。

#### Scenario: 包引用
- **WHEN** `apps/desktop` 或 `packages/apps/web` 在 package.json 添加 `"@artifex-nexus/ui": "workspace:*"`
- **THEN** 该应用 SHALL 能通过 `import { Button } from "@artifex-nexus/ui"` 引用组件

#### Scenario: 样式入口
- **WHEN** 应用入口文件导入 `@artifex-nexus/ui/globals.css`
- **THEN** 所有 CSS 变量 token + Tailwind base 层 + 组件基础样式 SHALL 注入文档

### Requirement: 基础组件清单
系统 SHALL 提供以下基础组件（shadcn/ui 标准 + 品牌主题）：

| 组件 | 用途 | 优先级 |
|---|---|---|
| Button | 主/次/幽灵/危险/链接变体 | P0 |
| Input | 文本输入框 | P0 |
| Textarea | 多行输入（Chat 用） | P0 |
| Card | 内容卡片容器 | P0 |
| Dialog | 模态对话框 | P0 |
| Toast / Sonner | 通知/提示 | P0 |
| ScrollArea | 自定义滚动条 | P0 |
| Badge | 状态/标签徽章 | P1 |
| Tooltip | 悬浮提示 | P1 |
| Separator | 分隔线 | P1 |
| Skeleton | 加载占位 | P1 |
| DropdownMenu | 下拉菜单 | P1 |
| Tabs | 标签页切换 | P1 |
| Avatar | 头像/用户标识 | P2 |
| Command | 命令面板 | P2 |
| Popover | 弹出层 | P2 |

#### Scenario: Button 变体渲染
- **WHEN** 开发者渲染 `<Button variant="destructive">删除</Button>`
- **THEN** 按钮 SHALL 使用 `--destructive` token 色彩，hover 态有视觉反馈

#### Scenario: Dialog 可访问性
- **WHEN** Dialog 打开
- **THEN** 系统 SHALL 自动陷入焦点（focus trap）、ESC 可关闭、aria-modal 属性正确

### Requirement: 组件 API 一致性
所有组件 SHALL 遵循以下 API 约定：
- 接受 `className` prop 以支持 Tailwind 覆盖
- 使用 `React.forwardRef` 暴露 DOM ref
- 使用 `cva`（class-variance-authority）管理变体
- 导出组件类型（`ButtonProps` 等）

#### Scenario: className 覆盖
- **WHEN** 开发者传入 `<Button className="mt-4 w-full">确认</Button>`
- **THEN** 组件 SHALL 将自定义 className 与内部样式合并（通过 `cn()` 工具函数）

#### Scenario: Ref 透传
- **WHEN** 开发者使用 `const ref = useRef<HTMLButtonElement>(null); <Button ref={ref} />`
- **THEN** ref SHALL 正确指向底层 DOM 元素

### Requirement: 双端兼容
组件 SHALL 在以下两种环境中正确渲染：
- Vite 5 + React 18（apps/desktop Tauri WebView）
- Next.js 15 + React 18（packages/apps/web）

#### Scenario: Tauri WebView 渲染
- **WHEN** 组件在 Tauri WebView（Chromium 内核）中加载
- **THEN** 渲染结果与浏览器端 SHALL 视觉一致

#### Scenario: Next.js SSR/CSR
- **WHEN** 组件在 Next.js Server Component 中使用
- **THEN** 包含交互的组件 SHALL 标注 `"use client"` 指令

### Requirement: 工具函数
包 SHALL 导出以下工具函数：
- `cn(...classes)`: Tailwind class 合并工具（基于 `clsx` + `tailwind-merge`）

#### Scenario: cn 合并冲突
- **WHEN** 调用 `cn("px-4 py-2", "px-6")`
- **THEN** 返回值 SHALL 为 `"py-2 px-6"`（后者覆盖前者同类别）
