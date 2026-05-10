---
tags: [spec, ui, design-language, M3]
created: 2026-05-09
updated: 2026-05-10
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
| 灰阶哲学 | **VS Code 风格中性灰 4 层**（19/24/31/37），保留品牌蓝为唯一彩色强调 |

## 2. 色彩 Token 表

### 2.1 灰阶层级（深色主题，2026-05-10 加入）

参考 VS Code 暗色主题，采用 4 层中性灰阶分隔不同区域，避免大块同色造成视觉扁平：

| 层级 | HSL | 近似 RGB | 主要用途 | 关联 token |
|---|---|---|---|---|
| L1 最暗 | `0 0% 7.5%` | rgb(19, 19, 19) | A 区顶栏 | `--titlebar` |
| L2 主体 | `0 0% 9.4%` | rgb(24, 24, 24) | 页面背景 / B 区导航 | `--background` / `--sidebar` |
| L3 卡片 | `0 0% 12.2%` | rgb(31, 31, 31) | 卡片 / 弹层 / 输入框 | `--card` / `--popover` / `--input` |
| L4 次级 | `0 0% 14.5%` | rgb(37, 37, 37) | D 区资源管理器 / 列表分组 | `--panel` / `--muted` |

**原则**：
- 同一层级内不再叠加 shadow（深色下阴影几乎不可见），靠 `border-border` 与灰阶差形成层次。
- 品牌强调色（`--primary` 蓝）是**唯一**彩色高亮，用于焦点环 / 主按钮 / 链接 / 激活态。
- 状态色（绿/黄/红/蓝信息）见 §2.4。

### 2.2 语义色彩（深色主题 `.dark` / 默认 `:root`）

| Token | HSL 值 | 用途 |
|---|---|---|
| `--background` | 0 0% 9.4% | 页面/面板背景（L2） |
| `--foreground` | 0 0% 96% | 主要文字 |
| `--primary` | 217.2 91.2% 59.8% | 品牌强调（按钮/链接/焦点） |
| `--primary-foreground` | 222.2 47.4% 11.2% | 品牌色上文字 |
| `--secondary` | 0 0% 16% | 次要操作背景（按钮态） |
| `--secondary-foreground` | 0 0% 96% | 次要操作文字 |
| `--muted` | 0 0% 14.5% | 弱化元素背景（L4） |
| `--muted-foreground` | 0 0% 60% | 弱化文字/占位符 |
| `--accent` | 0 0% 18% | hover/焦点高亮 |
| `--accent-foreground` | 0 0% 96% | 高亮上文字 |
| `--destructive` | 0 62.8% 30.6% | 危险操作 |
| `--destructive-foreground` | 0 0% 96% | 危险操作文字 |
| `--border` | 0 0% 18% | 边框（与 accent 同灰，确保可视） |
| `--input` | 0 0% 12.2% | 输入框底色（L3） |
| `--ring` | 217.2 91.2% 59.8% | 焦点环（同 primary） |
| `--card` | 0 0% 12.2% | 卡片背景（L3） |
| `--card-foreground` | 0 0% 96% | 卡片文字 |
| `--popover` | 0 0% 12.2% | 弹出层背景（L3） |
| `--popover-foreground` | 0 0% 96% | 弹出层文字 |

### 2.3 区域专用 Token（深色主题，新增）

| Token | HSL 值 | 用途 |
|---|---|---|
| `--titlebar` | 0 0% 7.5% | A 区顶栏（L1，最暗） |
| `--titlebar-foreground` | 0 0% 88% | 顶栏文字（略减对比，不喧宾夺主） |
| `--sidebar` | 0 0% 9.4% | B 区左侧导航（L2，与背景齐） |
| `--sidebar-foreground` | 0 0% 88% | 导航文字 |
| `--panel` | 0 0% 14.5% | D 区右侧面板 / 资源管理器（L4） |
| `--panel-foreground` | 0 0% 92% | 面板文字 |

Tailwind 用法：`bg-titlebar` / `bg-sidebar` / `bg-panel` / `text-panel-foreground` 等（v4 `@theme inline` 自动派生）。

### 2.4 语义色彩（浅色主题 `.light`）

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
| `--titlebar` | 210 40% 98% |
| `--titlebar-foreground` | 222.2 84% 4.9% |
| `--sidebar` | 210 40% 99% |
| `--sidebar-foreground` | 222.2 84% 4.9% |
| `--panel` | 210 40% 96.1% |
| `--panel-foreground` | 222.2 84% 4.9% |

### 2.5 状态色（共用，不随主题切换）

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

**信息层级 utility**：

| 类 | 用途 | 字号 / 字距 |
|---|---|---|
| `text-eyebrow` | 标签字（区分语义段，"OPENCLAW GATEWAY" / "TOOL CALLS"） | 10px uppercase tracking-0.18em |

## 3.5 玻璃面策略（风格 E · 2026-05-10 决议）

> **决议**：灰阶 token 不动 + 玻璃只用于卡片 / 弹层（共存方案 1）

### 何时用玻璃面（强约束）

**应该用 `glass-surface` / `<Card variant="glass">` / 玻璃化弹层**：
- `<Card>`：内容卡片、状态卡片、统计块等
- `<Dialog>` / `<Popover>` / `<Sheet>`：所有弹层（已默认玻璃化）
- `<ToolCallGroup>`：工具调用气泡（chat 内）
- 任何"飘起来"、需要"前台浮起"姿态的元素

**禁止用玻璃面**：
- 全屏主框架背景（用 `bg-background` L2）
- A 顶栏（用 `bg-titlebar` L1）
- B 左侧导航（用 `bg-sidebar` L2）
- D 区面板根容器（用 `bg-panel` L4）
- 列表项行（用透明 + hover `bg-white/[0.04]`）

### 实现 utility

| 类 | 等价于 |
|---|---|
| `glass-surface` | rounded-16 + border-white/[0.08] + bg-white/[0.04] + backdrop-blur-xl + 顶部 inset 高光 + 浮起阴影 |
| `glass-surface-inner` | rounded-12 + border-white/[0.06] + bg-white/[0.025] + backdrop-blur-md + 顶部 inset 高光（用于嵌套场景） |
| `glass-hover` | hover 时边框提亮 + 背景升一档 |

### 多层叠加规则

- 玻璃面**不能嵌套超过 2 层**（避免"灰糊"）
- 嵌套时外层用 `glass-surface`，内层用 `glass-surface-inner`
- 内层不再加单独阴影

### 性能注意

- `backdrop-blur` 在弱机器（集成显卡）会有 5-10% 帧率开销
- 不要在长列表行（如 100+ Skill 卡片墙）每行都用玻璃；用 `bg-card` 实色即可
- D 区分组面板（`<CollapsiblePanel>`）的 header 不用玻璃

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
