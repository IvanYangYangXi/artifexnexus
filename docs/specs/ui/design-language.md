---
tags: [spec, ui, design-language, M3]
created: 2026-05-09
status: draft
---

# 设计语言 — Token 规格 / Design Language Token Spec

> 本 spec 定义 Artifex Nexus 统一设计令牌体系。所有 UI（Web / Desktop / 未来 DCC 内嵌）
> 必须基于此 token 表渲染，禁止硬编码视觉值。
> 配套组件清单见 [[component-inventory]]。

## 1. 总体策略

| 维度 | 决策 |
|------|------|
| 色调 | **深色主题为主**，浅色为辅（运行时可切换） |
| 样式框架 | Tailwind CSS v4 + CSS 变量 token |
| 色彩格式 | HSL（`H S% L%`，无 `hsl()` 包裹） |
| 字体 | Inter（UI）+ JetBrains Mono（代码/日志） |
| 圆角 | 基于 `--radius` 变量，组件级梯度 |
| 组件库 | shadcn/ui → `packages/ui`（`@artifex-nexus/ui`） |
| 分发 | Tailwind preset（`packages/ui/tailwind.preset.ts`） |

## 2. 色彩 Token 表

### 2.1 语义色彩（深色主题 `.dark`）

| Token | HSL 值 | 用途 |
|---|---|---|
| `--background` | 222.2 84% 4.9% | 页面/面板背景 |
| `--foreground` | 210 40% 98% | 主要文字 |
| `--primary` | 217.2 91.2% 59.8% | 品牌强调（按钮/链接/焦点） |
| `--primary-foreground` | 222.2 47.4% 11.2% | 品牌色上文字 |
| `--secondary` | 217.2 32.6% 17.5% | 次要操作背景 |
| `--secondary-foreground` | 210 40% 98% | 次要操作文字 |
| `--muted` | 217.2 32.6% 17.5% | 弱化元素背景 |
| `--muted-foreground` | 215 20.2% 65.1% | 弱化文字/占位符 |
| `--accent` | 217.2 32.6% 17.5% | hover/焦点高亮 |
| `--accent-foreground` | 210 40% 98% | 高亮上文字 |
| `--destructive` | 0 62.8% 30.6% | 危险操作 |
| `--destructive-foreground` | 210 40% 98% | 危险操作文字 |
| `--border` | 217.2 32.6% 17.5% | 边框 |
| `--input` | 217.2 32.6% 17.5% | 输入框边框 |
| `--ring` | 224.3 76.3% 48% | 焦点环 |
| `--card` | 222.2 84% 4.9% | 卡片背景 |
| `--card-foreground` | 210 40% 98% | 卡片文字 |
| `--popover` | 222.2 84% 4.9% | 弹出层背景 |
| `--popover-foreground` | 210 40% 98% | 弹出层文字 |

### 2.2 语义色彩（浅色主题 `.light`）

| Token | HSL 值 |
|---|---|
| `--background` | 0 0% 100% |
| `--foreground` | 222.2 84% 4.9% |
| `--primary` | 217.2 91.2% 59.8% |
| `--primary-foreground` | 210 40% 98% |
| `--secondary` | 210 40% 96.1% |
| `--secondary-foreground` | 222.2 47.4% 11.2% |
| `--muted` | 210 40% 96.1% |
| `--muted-foreground` | 215.4 16.3% 46.9% |
| `--accent` | 210 40% 96.1% |
| `--accent-foreground` | 222.2 47.4% 11.2% |
| `--destructive` | 0 84.2% 60.2% |
| `--destructive-foreground` | 210 40% 98% |
| `--border` | 214.3 31.8% 91.4% |
| `--input` | 214.3 31.8% 91.4% |
| `--ring` | 217.2 91.2% 59.8% |
| `--card` | 0 0% 100% |
| `--card-foreground` | 222.2 84% 4.9% |
| `--popover` | 0 0% 100% |
| `--popover-foreground` | 222.2 84% 4.9% |

### 2.3 状态色（共用，不随主题切换）

| 用途 | Tailwind class | 近似 Hex |
|---|---|---|
| 成功/已安装 | `text-green-500` | #22c55e |
| 警告/可更新 | `text-yellow-500` | #eab308 |
| 错误/失败 | `text-red-500` | #ef4444 |
| 信息/检测中 | `text-blue-400` | #60a5fa |

## 3. 字体 Token

| Token | 值 | 用途 |
|---|---|---|
| `--font-sans` | `"Inter", ui-sans-serif, system-ui, sans-serif` | 正文/UI |
| `--font-mono` | `"JetBrains Mono", "Fira Code", ui-monospace, monospace` | 代码/日志/终端 |

**字号比例**：沿用 Tailwind 默认（`text-xs` 12px / `text-sm` 14px / `text-base` 16px / `text-lg` 18px / `text-xl` 20px / `text-2xl` 24px）。

**行高**：默认 1.5（正文），紧凑型 1.25（表格/列表）。

**字重**：`font-normal`(400) / `font-medium`(500) / `font-semibold`(600) / `font-bold`(700)。

## 4. 间距系统

沿用 Tailwind 4px 基准（`spacing-1` = 4px, `spacing-2` = 8px, ...）。

**常用间距语义**：

| 场景 | 推荐值 |
|---|---|
| 组件内 padding | `p-3`(12px) ~ `p-4`(16px) |
| 卡片间距 | `gap-4`(16px) ~ `gap-6`(24px) |
| 页面边距 | `px-6`(24px) ~ `px-8`(32px) |
| 紧凑列表行 | `py-2`(8px) |
| 宽松区块 | `py-8`(32px) ~ `py-12`(48px) |

## 5. 圆角

| Token / Class | 值 | 用途 |
|---|---|---|
| `--radius` | 0.5rem (8px) | 基值 |
| `rounded-sm` | calc(var(--radius) - 4px) = 4px | 小组件（Badge） |
| `rounded-md` | calc(var(--radius) - 2px) = 6px | 输入框 |
| `rounded-lg` | var(--radius) = 8px | 卡片/对话框 |
| `rounded-xl` | calc(var(--radius) + 4px) = 12px | 大容器 |

## 6. 阴影

| Class | 用途 |
|---|---|
| `shadow-sm` | 轻微浮起（卡片默认） |
| `shadow-md` | 中等浮起（弹出层） |
| `shadow-lg` | 重要浮起（对话框） |

深色主题下阴影效果较弱（背景已暗），建议搭配 `border` 增强层次。

## 7. 动效

| 场景 | 推荐 | Tailwind class |
|---|---|---|
| hover 过渡 | 150ms ease | `transition-colors duration-150` |
| 展开/折叠 | 200ms ease-out | `transition-all duration-200` |
| 对话框入场 | 200ms ease-out | `animate-in fade-in-0 zoom-in-95` |
| 对话框出场 | 150ms ease-in | `animate-out fade-out-0 zoom-out-95` |
| Toast 滑入 | 200ms ease-out | `animate-in slide-in-from-top-2` |

**原则**：动效为辅助理解服务，不做纯装饰性动画。超过 300ms 的动效需有明确交互理由。

## 8. 主题切换机制

```html
<!-- 深色（默认） -->
<html class="dark">

<!-- 浅色 -->
<html class="light">
```

- 默认跟随 `prefers-color-scheme`
- 用户手动切换后持久化到 `localStorage("theme")`
- Token 在 `globals.css` 中通过 `.dark {}` / `.light {}` 选择器切换

## 9. Tailwind Preset 分发

所有前端 app 的 `tailwind.config.ts` MUST 继承：

```ts
// apps/desktop/tailwind.config.ts
import preset from "@artifex-nexus/ui/tailwind.preset";
export default { presets: [preset], content: [...] };
```

## 相关

- [[component-inventory]] — 基础组件清单
- [[web-chat-structure]] — Chat 界面结构（待产出）
- [[installer-structure]] — 安装向导结构（M0，将用本 token 回填）
- [[../../../packages/ui/]] — 代码落位
