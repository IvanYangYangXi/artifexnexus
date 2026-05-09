---
tags: [spec, ui, components, M3]
created: 2026-05-09
status: draft
---

# 基础组件清单 / Component Inventory

> 本 spec 定义 `@artifex-nexus/ui` 包的基础组件集合、变体规格与使用约定。
> 设计令牌见 [[design-language]]。

## 1. 技术约定

| 维度 | 规范 |
|------|------|
| 底层 | shadcn/ui（Radix UI + Tailwind CSS） |
| 变体管理 | `cva`（class-variance-authority） |
| 类合并 | `cn()` = `clsx` + `tailwind-merge` |
| Ref 透传 | 所有组件使用 `React.forwardRef` |
| 类型导出 | 每个组件导出 `<Component>Props` 类型 |
| 文件规范 | 每组件一文件，≤ 300 行 |
| 客户端标记 | 含交互的组件顶部 `"use client"` |

## 2. P0 组件（M3 必须交付）

### 2.1 Button

| 变体 | 样式描述 |
|---|---|
| `default` | primary 背景 + primary-foreground 文字 |
| `secondary` | secondary 背景 |
| `destructive` | destructive 背景 |
| `outline` | 透明背景 + border |
| `ghost` | 透明背景，hover 显示 accent |
| `link` | 无背景无边框，下划线 |

**Size**：`sm`(h-9 px-3) / `default`(h-10 px-4 py-2) / `lg`(h-11 px-8) / `icon`(h-10 w-10)

**状态**：default / hover / focus / active / disabled / loading

### 2.2 Input

单行文本输入框。

| Prop | 类型 | 说明 |
|---|---|---|
| `type` | string | 标准 HTML input type |
| `disabled` | boolean | 禁用态 |
| `className` | string | Tailwind 覆盖 |

**样式**：`h-10 rounded-md border-input bg-background px-3 text-sm`

### 2.3 Textarea

多行文本输入（Chat 消息输入核心组件）。

| Prop | 类型 | 说明 |
|---|---|---|
| `rows` | number | 默认行数 |
| `className` | string | Tailwind 覆盖 |

**特殊行为**：支持 `min-h-[80px]` 自适应高度（Chat 场景）。

### 2.4 Card

内容卡片容器，由子组件组合：

- `Card`：外壳，`rounded-lg border bg-card`
- `CardHeader`：顶部区域
- `CardTitle`：标题
- `CardDescription`：副标题/描述
- `CardContent`：主体内容
- `CardFooter`：底部操作区

### 2.5 Dialog

模态对话框（基于 Radix Dialog）。

- `Dialog`：根容器
- `DialogTrigger`：触发器
- `DialogContent`：内容面板（居中，带遮罩）
- `DialogHeader` / `DialogFooter`：布局辅助
- `DialogTitle` / `DialogDescription`：标题/描述

**行为**：ESC 关闭 / 点遮罩关闭 / 焦点陷阱 / aria-modal

### 2.6 Toast（Sonner）

通知提示组件，使用 `sonner` 库。

| 类型 | 图标 | 色彩 |
|---|---|---|
| `success` | ✓ | green |
| `error` | ✕ | destructive |
| `info` | ℹ | primary |
| `warning` | ⚠ | yellow |

**位置**：右下角。**持续**：4s 自动消失，可手动关闭。

### 2.7 ScrollArea

自定义滚动条（基于 Radix ScrollArea）。

- 深色主题下滚动条轨道半透明
- 支持垂直/水平方向
- 鼠标悬停时滚动条加粗显示

## 3. P1 组件（M3 应交付）

| 组件 | 简述 |
|---|---|
| **Badge** | 状态/标签徽章（`default` / `secondary` / `destructive` / `outline`） |
| **Tooltip** | 悬浮提示（Radix Tooltip，延迟 200ms 显示） |
| **Separator** | 水平/垂直分隔线 |
| **Skeleton** | 加载占位动画（`animate-pulse` 背景闪烁） |
| **DropdownMenu** | 下拉菜单（Radix DropdownMenu，含子菜单/分隔/快捷键） |
| **Tabs** | 标签页切换（`TabsList` / `TabsTrigger` / `TabsContent`） |

## 4. P2 组件（按需交付）

| 组件 | 简述 | 主要消费场景 |
|---|---|---|
| **Avatar** | 头像/用户标识 | Chat 消息头像 |
| **Command** | 命令面板（Ctrl+K 搜索） | 快捷操作 |
| **Popover** | 弹出层（非模态） | 设置/选项 |

## 5. 使用示例

```tsx
import { Button, Card, CardHeader, CardTitle, CardContent } from "@artifex-nexus/ui";

function ExampleCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenClaw 状态</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">Gateway 运行中</p>
        <Button variant="secondary" size="sm">查看详情</Button>
      </CardContent>
    </Card>
  );
}
```

## 6. 文件组织（packages/ui）

```
packages/ui/src/components/
├── button.tsx
├── input.tsx
├── textarea.tsx
├── card.tsx
├── dialog.tsx
├── toast.tsx          # Sonner provider + useToast
├── scroll-area.tsx
├── badge.tsx
├── tooltip.tsx
├── separator.tsx
├── skeleton.tsx
├── dropdown-menu.tsx
├── tabs.tsx
├── avatar.tsx
├── command.tsx
└── popover.tsx
```

## 相关

- [[design-language]] — Token 规格
- [[web-chat-structure]] — Chat 界面（主要消费方）
- [[installer-structure]] — 安装向导（回填消费方）
