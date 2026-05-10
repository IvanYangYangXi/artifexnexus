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
> 新接入工程必读 [[../../development/web-frontend-setup]]。

## 1. 总体策略

| 维度 | 决策 |
|------|------|
| 色调 | **深色主题为主**（默认，并已验证）；浅色 token 已定义**尚未验证启用** |
| 样式框架 | **Tailwind CSS v4（CSS-first 模式）** + CSS 变量 token + `@theme inline` |
| 色彩格式 | HSL（`H S% L%`，无 `hsl()` 包裹） |
| 字体 | Inter（UI）+ JetBrains Mono（代码/日志），自托管（当前 `local()` fallback） |
| 圆角 | 基于 `--radius` 变量，组件级梯度 |
| 组件库 | shadcn/ui → `packages/ui`（`@artifex-nexus/ui`，source-only 包） |
| 分发 | **`@import "@artifex-nexus/ui/globals.css"` + `@source` 相对路径**（见 §9） |
| 风格 | **风格 E · A+D 整合**（苹果玻璃分层 + 微软信息层级，去渐变，单色钢蓝） |
| 灰阶哲学 | **VS Code 风 4 层中性灰**（19/24/31/37），品牌蓝为唯一彩色强调 |
| 玻璃面策略 | **方案 1 · 灰阶 + 玻璃共存**（见 §3.5） |

## 2. 色彩 Token 表

> 下列值为 `packages/ui/src/globals.css` 的实际真实值（2026-05-10 STORY-0031 第三/四轮调校后定稿）。

### 2.1 灰阶层级（深色主题）

参考 VS Code 暗色主题，采用 4 层中性灰阶分隔不同区域，避免大块同色造成视觉扁平：

| 层级 | HSL | 近似 RGB | 主要用途 | 关联 token |
|---|---|---|---|---|
| L1 最暗 | `0 0% 7.5%` | rgb(19, 19, 19) | A 区顶栏 | `--titlebar` |
| L2 主体 | `0 0% 9.4%` | rgb(24, 24, 24) | 页面背景 / B 区导航 | `--background` / `--sidebar` |
| L3 卡片 | `0 0% 12.2%` | rgb(31, 31, 31) | 卡片 / 弹层 / 输入框 | `--card` / `--popover` / `--input` |
| L4 次级 | `0 0% 14.5%` | rgb(37, 37, 37) | D 区资源管理器 / 列表分组 | `--panel` / `--muted` |

**原则**：
- 同一层级内不再叠加 shadow（深色下阴影几乎不可见），靠 `border-border` 与灰阶差形成层次
- 品牌强调色（`--primary` 蓝）是**唯一**彩色高亮，用于焦点环 / 主按钮 / 链接 / 激活态
- 状态色（绿/黄/红/蓝信息）见 §2.5

### 2.2 语义色彩（深色主题，默认 `:root`）

| Token | HSL 值 | 用途 |
|---|---|---|
| `--background` | 0 0% 9.4% | 页面/面板背景（L2） |
| `--foreground` | 0 0% 96% | 主要文字 |
| `--primary` | 213 78% 65% | **品牌钢蓝（2026-05-10 调校 v2）**；原 217.2 91.2% 59.8% → 提亮、降饱和更高级 |
| `--primary-foreground` | 0 0% 98% | 品牌色上文字（白色，高对比） |
| `--secondary` | 0 0% 20% | 次要操作背景 |
| `--secondary-foreground` | 0 0% 96% | 次要操作文字 |
| `--muted` | 0 0% 14.5% | 弱化元素背景（L4） |
| `--muted-foreground` | 0 0% 64% | 弱化文字/占位符 |
| `--accent` | 0 0% 24% | hover/激活高亮（与 secondary 拉开 4%） |
| `--accent-foreground` | 0 0% 98% | 高亮上文字 |
| `--destructive` | 0 72% 51% | 危险操作（**调亮至可配白文字**，原 30.6% L 太暗） |
| `--destructive-foreground` | 0 0% 98% | 危险操作文字 |
| `--border` | 0 0% 22% | 边框（提亮至轮廓清晰） |
| `--input` | 0 0% 12.2% | 输入框底色（L3） |
| `--ring` | 213 78% 65% | 焦点环（= primary） |
| `--card` | 0 0% 12.2% | 卡片背景（L3） |
| `--card-foreground` | 0 0% 96% | 卡片文字 |
| `--popover` | 0 0% 12.2% | 弹出层背景（L3） |
| `--popover-foreground` | 0 0% 96% | 弹出层文字 |

### 2.3 区域专用 Token（深色主题）

| Token | HSL 值 | 用途 |
|---|---|---|
| `--titlebar` | 0 0% 7.5% | A 区顶栏（L1，最暗） |
| `--titlebar-foreground` | 0 0% 88% | 顶栏文字（略减对比，不喧宾夺主） |
| `--sidebar` | 0 0% 9.4% | B 区左侧导航（L2，与背景齐） |
| `--sidebar-foreground` | 0 0% 88% | 导航文字 |
| `--panel` | 0 0% 14.5% | D 区右侧面板 / 资源管理器（L4） |
| `--panel-foreground` | 0 0% 92% | 面板文字 |

Tailwind 用法：`bg-titlebar` / `bg-sidebar` / `bg-panel` / `text-panel-foreground` 等（v4 `@theme inline` 已自动派生）。

### 2.4 状态语义 Token（深色主题，2026-05-10 新增）

> 原本仅用 Tailwind class `text-green-500` 等直接写硬色；现改用语义 token，支持主题切换与未来调色。

| Token | HSL 值 | 用途 | Tailwind class |
|---|---|---|---|
| `--success` | 142 65% 45% | 成功 / 已安装 / running-ok | `bg-success` / `text-success` |
| `--success-foreground` | 0 0% 98% | 成功背景上的文字 | `text-success-foreground` |
| `--warning` | 38 92% 56% | 警告 / 可更新 | `bg-warning` / `text-warning` |
| `--warning-foreground` | 0 0% 12% | 警告上文字（深色） | `text-warning-foreground` |
| `--info` | 200 90% 60% | 信息 / 检测中（与 primary 略区分） | `bg-info` / `text-info` |
| `--info-foreground` | 0 0% 98% | 信息上文字 | `text-info-foreground` |

**说明**：
- 状态色通过 `@theme inline` 的 `--color-success` 等自动映射为 Tailwind class
- ToolCallItem 的 status stripe、Sidebar 状态点、Topbar Gateway 指示等均应走这组 token
- 沿用 Tailwind `text-green-500 / text-red-500` 仅在"临时/一次性"场景允许

### 2.5 语义色彩（浅色主题 `.light`，⚠ **已定义但暂未验证**）

> 当前 `packages/apps/web` / `packages/ui/demo` 均强制 `<html class="dark">`，浅色主题尚未做 UI 验收。
> Token 值已按 HSL 做了浅色化对应，但**切换后可能存在对比度/玻璃面可读性问题**。
> 启用浅色前需要：a) 去掉 AppShell 强制 dark class；b) 过一遍所有 `bg-white/[0.04]` 类玻璃写法（浅色下需反色）；c) demo gallery 增加浅色切换 review。

| Token | HSL 值 |
|---|---|
| `--background` | 0 0% 100% |
| `--foreground` | 222.2 84% 4.9% |
| `--primary` | 213 78% 55% |
| `--primary-foreground` | 0 0% 98% |
| `--secondary` | 210 40% 96.1% |
| `--secondary-foreground` | 222.2 47.4% 11.2% |
| `--muted` | 210 40% 96.1% |
| `--muted-foreground` | 215.4 16.3% 46.9% |
| `--accent` | 210 40% 96.1% |
| `--accent-foreground` | 222.2 47.4% 11.2% |
| `--destructive` | 0 72% 51% |
| `--destructive-foreground` | 0 0% 98% |
| `--border` | 214.3 31.8% 91.4% |
| `--input` | 214.3 31.8% 91.4% |
| `--ring` | 213 78% 55% |
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
| `--success` | 142 60% 38% |
| `--warning` | 38 92% 50% |
| `--info` | 200 90% 50% |

## 3. 字体 Token

| Token | 值 | 用途 |
|---|---|---|
| `--font-sans` | `"Inter", ui-sans-serif, system-ui, sans-serif` | 正文/UI |
| `--font-mono` | `"JetBrains Mono", "Fira Code", ui-monospace, monospace` | 代码/日志/终端 |

**字体自托管现状**：`@font-face` 当前使用 `local("Inter Variable"), local("Inter")` 仅命中系统字体，woff2 待入库（独立小工单）。未装系统字体时自然 fallback 到字体栈。

**字号比例**：沿用 Tailwind 默认（`text-xs` 12px / `text-sm` 14px / `text-base` 16px / `text-lg` 18px / `text-xl` 20px / `text-2xl` 24px）。

**行高**：默认 1.5（正文），紧凑型 1.25（表格/列表）。

**字重**：`font-normal`(400) / `font-medium`(500) / `font-semibold`(600) / `font-bold`(700)。

**信息层级 utility**（已作为全局 CSS utility 定义于 `globals.css`）：

| 类 | 用途 | 字号 / 字距 |
|---|---|---|
| `text-eyebrow` | 标签字（区分语义段，"OPENCLAW GATEWAY" / "TOOL CALLS"） | 10px uppercase tracking-0.18em text-muted-foreground |

## 3.5 玻璃面策略（风格 E · 2026-05-10 决议）

> **决议**：灰阶 token 不动 + 玻璃只用于卡片 / 弹层（共存方案 1）

### 何时用玻璃面（强约束）

**应该用 `glass-surface` / `<Card variant="glass">` / 玻璃化弹层**：
- `<Card variant="glass">`：内容卡片、状态卡片、统计块等
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

### 与 transform 的冲突（⚠ 必读）

`tailwindcss-animate` 的 `animate-in` keyframes 用 `transform: translate3d(...) scale3d(...)` 整体重写 transform 属性。因此：

- **不要**用 `translate-x-[-50%] translate-y-[-50%]` 居中后再加 `zoom-in-95` / `slide-in-from-*` 动画类，否则 keyframe 会把居中 translate 抹掉，元素飘出视口
- **正确做法**：居中用 `inset-0 m-auto h-fit w-[...]`（margin auto 居中，与 transform 解耦）
- 已在 Dialog/Sheet 组件中落地；自定义浮层组件务必遵守

## 4. 间距系统

沿用 Tailwind 4px 基准（`spacing-1` = 4px, `spacing-2` = 8px, ...）。

**常用间距语义**：

| 场景 | 推荐值 |
|---|---|
| 组件内 padding | `p-3`(12px) ~ `p-4`(16px) |
| 卡片间距 | `gap-4`(16px) ~ `gap-6`(24px) |
| 页面边距 | `px-6`(24px) ~ `px-8`(32px) |
| 紧凑列表行 | `py-1`(4px) ~ `py-2`(8px) |
| 宽松区块 | `py-8`(32px) ~ `py-12`(48px) |

**紧凑列表的行高决策**（2026-05-10 STORY-0031 定稿）：
- VS Code 风折叠面板 header = **28px**（外层）
- 工具调用 Item header = **22px**（内层）
- 两级之间刻意保持可见差，遵循信息层级

## 5. 圆角

| Token / Class | 值 | 用途 |
|---|---|---|
| `--radius` | 0.5rem (8px) | 基值 |
| `rounded-sm` | calc(var(--radius) - 4px) = 4px | 小组件（Badge） |
| `rounded-md` | calc(var(--radius) - 2px) = 6px | 输入框、按钮（shape="square"） |
| `rounded-lg` | var(--radius) = 8px | 卡片/对话框 |
| `rounded-xl` | calc(var(--radius) + 4px) = 12px | 大容器（glass-surface-inner 用 12px） |
| `rounded-[16px]` | 16px | glass-surface 大圆角（风格 E 沉淀） |
| `rounded-full` | — | Button shape="pill" / Avatar / 状态 badge |

## 6. 阴影

| Class | 用途 |
|---|---|
| `shadow-sm` | 轻微浮起（卡片默认） |
| `shadow-md` | 中等浮起（弹出层） |
| `shadow-lg` | 重要浮起（对话框） |
| `shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.5),inset_0_1px_0_0_rgba(255,255,255,0.18)]` | **Button default "跳进式"投射光晕 + inset 高光**（风格 E） |
| `shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]` | **glass-surface 浮起阴影 + inset 高光** |

深色主题下阴影效果较弱（背景已暗），建议搭配 `border` 增强层次，或使用上面的复合 shadow。

## 7. 动效

| 场景 | 推荐 | Tailwind class |
|---|---|---|
| hover 过渡 | 150ms ease | `transition-colors duration-150` |
| hover 亮度 | 150ms | `hover:brightness-110`（Button default 用） |
| active 按下 | 同步 | `active:scale-[0.98]`（所有可点元素） |
| 展开/折叠 | 200ms ease-out | `transition-all duration-200` |
| B 区侧栏宽度 | 200ms ease-out | `transition-[width] duration-200 ease-out` |
| 对话框入场 | 200ms ease-out | `animate-in fade-in-0 zoom-in-95` |
| 对话框出场 | 150ms ease-in | `animate-out fade-out-0 zoom-out-95` |
| Toast 滑入 | 200ms ease-out | `animate-in slide-in-from-top-2`（**Toast 无 translate 居中，可用 slide**） |

**原则**：
- 动效为辅助理解服务，不做纯装饰性动画
- 超过 300ms 的动效需有明确交互理由
- **涉及 translate 居中的弹层禁用 slide-in/out**（见 §3.5 与 transform 的冲突）

## 8. 主题切换机制

```html
<!-- 深色（默认，直接 :root 生效，无需 .dark 类） -->
<html>

<!-- 浅色 -->
<html class="light">
```

- `:root {}` 即定义深色默认值；`.light {}` 做浅色覆盖
- 当前 `packages/apps/web` AppShell 仍显式加 `className="dark"`，效果等同 `:root`，但保留以备未来加 `.light` 切换
- 用户手动切换后持久化到 `localStorage("theme")` **（尚未实现，浅色未验证）**

## 9. 分发与接入（Tailwind v4 CSS-first 模式）

> ⚠ **重要变更（对齐 2026-05-10 实现）**：我们不使用 Tailwind JS config + preset 的传统方式，而用 **Tailwind v4 的 CSS-first 模式**，通过 `@import + @source + @theme inline`。

### 9.1 消费方 `package.json`

```jsonc
{
  "dependencies": {
    "@artifex-nexus/ui": "workspace:*"
  },
  "devDependencies": {
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "tailwindcss-animate": "^1.0.7" // 必须显式声明，ui 包的 @plugin 需在消费方 node_modules 找到
  }
}
```

### 9.2 `postcss.config.mjs`

```js
export default {
  plugins: { "@tailwindcss/postcss": {} }
};
```

### 9.3 消费方 `globals.css`

```css
@import "@artifex-nexus/ui/globals.css";

/* ⚠ 必须用相对路径直指 ui 包真实目录，不能走 node_modules symlink
 * （Tailwind v4 默认不跟随 symlink 扫描，会导致 ui 包所有 utility 丢失） */
@source "../**/*.{ts,tsx}";
@source "../../../../ui/src/**/*.{ts,tsx}";
```

### 9.4 `layout.tsx`（Next）

```tsx
import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body
        className="min-h-screen bg-background font-sans text-foreground antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
```

完整接入检查清单与常见坑速查 → [[../../development/web-frontend-setup]]

## 相关

- [[component-inventory]] — 基础组件清单
- [[web-chat-structure]] — Chat 界面结构
- [[installer-structure]] — 安装向导结构（M0，将用本 token 回填）
- [[../../development/web-frontend-setup]] — Tailwind v4 + pnpm 接入必读
- [[../../../packages/ui/]] — 代码落位
