# @artifex-nexus/ui

Artifex Nexus 统一设计系统包。提供 **设计令牌 + Tailwind v4 主题 + 基于 shadcn/ui 的组件**。

> 交付于 STORY-0031（M3 阶段）。
> 相关 spec：[[../../docs/specs/ui/design-language]] · [[../../docs/specs/ui/component-inventory]]

## 包形态

**纯源码包（方案 A）**：

- 无 build step，`exports` 直接指向 `src/*.tsx`
- 消费者（`packages/apps/web` / `apps/desktop`）的 bundler 直接编译
- 改组件 → 消费者 HMR 立即生效
- 遵循 shadcn/ui "源码即组件" 哲学

## 目录结构

```
packages/ui/
├── package.json
├── tsconfig.json
├── README.md                 # 本文件
├── src/
│   ├── index.ts              # 统一出口
│   ├── globals.css           # Tailwind v4 @theme + HSL token + 字体
│   ├── tailwind.preset.ts    # v4 元数据（content/stylesheet/tokenVars）
│   ├── lib/
│   │   └── cn.ts             # clsx + tailwind-merge
│   ├── fonts/                # Inter / JetBrains Mono woff2（自托管）
│   └── components/           # 13 个基础组件
└── demo/                     # Vite + React gallery（端口 18791）
    ├── index.html
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── Gallery.tsx
        └── styles.css
```

## 组件清单（26 个）

| 优先级 | 组件 |
|---|---|
| P0 (10) | Button / Input / Textarea / Card / Badge / Dialog / DropdownMenu / Tabs / ScrollArea / Tooltip |
| P1 (3) | Separator / Skeleton / Toast (Sonner) |
| P2 (13) | Avatar / Select / Checkbox / Switch / RadioGroup / Label / Popover / Command / Collapsible / Sheet / ContextMenu / Progress / Resizable |

## 灰阶层级（VS Code 风）

| 层级 | Token | RGB | 用途 |
|---|---|---|---|
| L1 | `--titlebar` | 19/19/19 | A 区顶栏 |
| L2 | `--background` / `--sidebar` | 24/24/24 | 主体页面 / B 区导航 |
| L3 | `--card` / `--popover` / `--input` | 31/31/31 | 卡片 / 弹层 / 输入框 |
| L4 | `--panel` / `--muted` | 37/37/37 | D 区资源管理 / 次级容器 |

Tailwind 工具类：`bg-titlebar` / `bg-sidebar` / `bg-background` / `bg-card` / `bg-panel`。

## 使用（消费者）

```ts
// 1) 应用入口：加载全局 CSS
import "@artifex-nexus/ui/globals.css";

// 2) 任意组件处：按需导入
import { Button, Card, CardHeader, CardTitle } from "@artifex-nexus/ui";
```

### Tailwind v4 content 扫描

消费者若需显式扩展 content 扫描路径，可在自己的 CSS 里：

```css
@import "tailwindcss";
@import "@artifex-nexus/ui/globals.css";

@source "../node_modules/@artifex-nexus/ui/src/**/*.{ts,tsx}";
```

或从 preset 读取：

```ts
import preset from "@artifex-nexus/ui/tailwind.preset";
// preset.content  → 推荐 glob
// preset.stylesheet → 全局 CSS 路径
// preset.tokenVars → 所有 token 变量名
```

## 字体

Inter / JetBrains Mono 作为 woff2 自托管在 `src/fonts/`。
首次 clone 仓库后若 woff2 缺失，请按 `src/fonts/README.md` 下载。

## 开发

```bash
pnpm -C packages/ui dev          # 启动组件 gallery，端口 18791
pnpm -C packages/ui typecheck    # 类型检查
pnpm -C packages/ui build:demo   # 构建 gallery 静态产物
```

## 技术栈

- React 18 + TypeScript 5
- Radix UI（Dialog/DropdownMenu/ScrollArea/Tabs/Tooltip/Separator）
- Tailwind CSS v4（CSS-first，`@theme inline`）
- class-variance-authority（变体）
- clsx + tailwind-merge（cn helper）
- sonner（Toast）
- lucide-react（图标）

## 约束

- 每个组件 ≤ 300 行
- 所有组件 `forwardRef` + 接收 `className` 透传
- 含交互的组件顶部 `"use client"`（兼容 Next.js RSC）
- 颜色仅使用语义 token（`bg-primary` / `text-muted-foreground` / …），禁止硬编码 hex/HSL
