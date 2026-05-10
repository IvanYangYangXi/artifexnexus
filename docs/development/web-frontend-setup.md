---
tags: [development, frontend, web, tailwind, pnpm, troubleshooting]
created: 2026-05-10
updated: 2026-05-10
status: stable
---

# Web 前端开发 · Tailwind v4 + pnpm Monorepo 集成必读

> 适用范围：`packages/apps/web`（Next 15 / React 18 / Tailwind v4）消费 `@artifex-nexus/ui`（source-only 包）。
> 本文档由 STORY-0033 联调期沉淀（2026-05-10），**违反这里的约定 100% 会导致 Dialog/Popover/Sheet 等浮层组件"看不见"或样式错位**，且报错信息极不直观（dialog 元素在 DOM 里、computed style 里 position: static、肉眼无法察觉），**调试代价极高**，请认真阅读。

---

## 1. 核心问题：Tailwind v4 不跟随 pnpm workspace 软链

### 现象

- `<Dialog>` 打开后 DOM 里有 `role="dialog"` 元素，data-state="open"，但屏幕上看不到
- DevTools Elements 里能找到该元素（往往作为 `<body>` 的直接子节点）
- 在 DevTools Console 跑 `getComputedStyle($('[role=dialog]'))` 看到：
  ```
  position: "static"     ← 应当是 "fixed"
  top/left/right/bottom: "auto"
  margin: "0px"
  zIndex: "auto"
  ```
- 同时该元素 class 字符串里**明明写着** `class="fixed inset-0 z-50 ..."` 等

### 根因

Tailwind v4 通过 `@source` 指令扫源码文件来决定生成哪些 utility CSS。pnpm monorepo 下，被 workspace 包 `@artifex-nexus/ui` 在消费方 `node_modules/` 里是 **junction / symlink**，**Tailwind v4 默认跳过 node_modules 内的 symlinked 目录**（性能保护）。

结果：

1. `@source "node_modules/@artifex-nexus/ui/src/**/*"` 看似配了，**实际并未扫到**
2. ui 包里 dialog/popover/sheet 等组件用到的 utility（`fixed`, `inset-0`, `z-50`, `translate-x-*`, `backdrop-blur-xl` ...）一律没生成对应 CSS 规则
3. dialog 写了 class 但 class 是空规则 → CSS 默认 `position: static` → dialog 排在文档流末尾，肉眼不可见

### 唯一可靠的修复

**用相对路径直接指向 `packages/ui/src` 真实目录**，不要走 `node_modules`：

```css
/* packages/apps/web/src/app/globals.css */
@import "@artifex-nexus/ui/globals.css";

/* ✅ 正确：相对路径直指 packages/ui/src 真实目录 */
@source "../**/*.{ts,tsx}";                   /* web 自己 src */
@source "../../../../ui/src/**/*.{ts,tsx}";   /* packages/ui/src 真实目录 */

/* ❌ 错误（Tailwind v4 不跟 symlink，扫不到内容）：
@source "../../../node_modules/@artifex-nexus/ui/src/**/*.{ts,tsx}";
*/
```

路径换算：
- `globals.css` 在 `packages/apps/web/src/app/`
- `../` = `packages/apps/web/src/`
- `../../../../ui/src/` = 上 4 级到 `packages/`，再进 `ui/src`

---

## 2. 验证 Tailwind 是否扫到 ui 包

如果你新接入了一个用了某 utility 的 ui 组件，怀疑没生成 CSS，可以快速验证：

### 方法 A：grep 生成的 CSS

```powershell
# Next dev / build 后看产物：
findstr "\.fixed" packages\apps\web\.next\static\css\*.css
```

如果完全没匹配，说明 `.fixed` 这个 utility 没被 Tailwind 收进来 → `@source` 配置漏了。

### 方法 B：DevTools Console 跑诊断脚本

```js
const d = document.querySelector('[role="dialog"]');
const cs = getComputedStyle(d);
console.log({
  position: cs.position,    // 期望 "fixed"
  top: cs.top, left: cs.left,
  zIndex: cs.zIndex,         // 期望 "50"
  transform: cs.transform,
  opacity: cs.opacity,
});
```

如果 `position` 是 `static`，class 里却写了 `fixed` → 100% 是 source 扫描问题。

---

## 3. 配套依赖：`tailwindcss-animate` 必须在消费方 node_modules

### 现象

`@artifex-nexus/ui/globals.css` 里有：
```css
@plugin "tailwindcss-animate";
```

Tailwind v4 解析 `@plugin` 时按**当前编译进程的 cwd** 找 node_modules（即 `packages/apps/web`）。pnpm 不会把仅 ui 包用到的 `tailwindcss-animate` hoist 到 web 的 node_modules → Tailwind **静默忽略** plugin → 所有 `animate-in` / `fade-in-0` / `zoom-in-95` 等 class 没有规则。

### 修复

在消费 ui 包的所有前端工程的 `package.json` `devDependencies` 里**显式加上**：

```json
{
  "devDependencies": {
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "tailwindcss-animate": "^1.0.7"
  }
}
```

> 已在 `packages/apps/web/package.json` 落地（2026-05-10）。
> 未来新增 `apps/desktop` Web View 接入 ui 包时，**必须同样配齐**。

---

## 4. Next.js 15 + source-only ui 包的标准接入清单

把 `@artifex-nexus/ui` 这种 source-only（exports 直指 .tsx）workspace 包接入新 Next.js 工程时，**全套配置如下**（少一项就会出问题）：

### 4.1 `package.json`

```json
{
  "scripts": {
    "dev": "next dev -p <port> --turbopack",
    "build": "next build"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@artifex-nexus/ui": "workspace:*",
    "lucide-react": "^0.453.0",
    "react-resizable-panels": "^2.1.6"
  },
  "devDependencies": {
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "tailwindcss-animate": "^1.0.7",
    "postcss": "^8.4.47"
  }
}
```

**关键点**：
- `dev` 必须用 `--turbopack`（webpack dev 对 source-only workspace 包 + 反复 HMR 不稳，会报 `__webpack_modules__[moduleId] is not a function`）
- `tailwindcss-animate` 必须在消费方显式声明（理由见 §3）

### 4.2 `next.config.mjs`

```js
/** @type {import("next").NextConfig} */
export default {
  reactStrictMode: true,
  /** ui 包 exports 直指 .tsx，需要 Next 编译 */
  transpilePackages: ["@artifex-nexus/ui"],
};
```

### 4.3 `postcss.config.mjs`

```js
/** @type {import('postcss-load-config').Config} */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

### 4.4 `src/app/globals.css`

```css
@import "@artifex-nexus/ui/globals.css";

/* ⚠ 必须：相对路径直指 ui 包真实目录，不能走 node_modules symlink */
@source "../**/*.{ts,tsx}";
@source "../../../../ui/src/**/*.{ts,tsx}";

html, body { height: 100%; }
```

> 路径以 `globals.css` 自身为基准计算。如果 web 工程位置不在 `packages/apps/web/src/app/`，需要重新数路径层级到 `packages/ui/src`。

### 4.5 `src/app/layout.tsx`

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

`suppressHydrationWarning` 必加 —— 防止浏览器扩展（如 haptic feedback 类）注入属性导致 hydration warning（详见 STORY-0032 联调日志）。

---

## 5. 常见坑 · 速查表

| 现象 | 真正原因 | 快速诊断 | 修复 |
|---|---|---|---|
| Dialog/Popover/Sheet 不可见，DOM 里却有 `data-state="open"` | Tailwind 没扫 ui 包 → utility 缺失 | DevTools Console: `getComputedStyle($('[role=dialog]')).position` 是不是 `static` | `globals.css` 用相对路径 `@source "../../../../ui/src/**"` |
| 所有动画完全无效（dialog 突显、tooltip 突现） | `tailwindcss-animate` 没在消费方 node_modules | grep `[data-state=open]\:animate-in` 在生成的 CSS 里找不到 | web `package.json` 加 `tailwindcss-animate` |
| `__webpack_modules__[moduleId] is not a function` | webpack dev 对 source workspace 包 + HMR 不稳 | 出现在 `next dev`（无 --turbopack） | dev script 加 `--turbopack` |
| Hydration mismatch · `data-haptic-enabled="true"` | 浏览器扩展（手势/震动反馈类）注入 | 无痕窗口下消失 | layout.tsx `<body suppressHydrationWarning>` + 用户禁用扩展 |
| `<button>` cannot be a descendant of `<button>` | shadcn 默认 dialog/collapsible header 用 `<button>`，actions 槽里又是 `<Button>` | 看 React error 中嵌套链路 | header 改用 `<div role="button" tabIndex={0} aria-expanded onKeyDown>`（见 ui 包 CollapsiblePanel/ToolCallItem 的实现） |
| Dialog 飘到视口左上角 | `tailwindcss-animate` 的 keyframes 用 `transform: translate3d(...) scale3d(...)`，覆盖了 `translate-x/y[-50%]` 居中 | dialog computed `transform: none` 或异常 | 居中改用 `inset-0 m-auto h-fit`，与 transform 解耦 |
| AppShell hydration error · localStorage 初值不一致 | useState 初始值读了 localStorage（SSR 没有） | 看 React hydration 警告 | useState 用静态默认值，mount 后 useEffect 异步恢复 |

---

## 6. 调试 dialog "看不见" 的标准流程

下次再遇到 dialog 不可见，按这个顺序排查（避免重复踩坑）：

```
1. DOM 里有没有 role="dialog"？
   ├─ 没有 → Dialog 组件本身没 mount，查 React state / open prop
   └─ 有 → 进入第 2 步

2. dialog 元素的父链是不是 body 直接子节点？
   ├─ 不是 → portal 没挂到 body，检查 DialogPortal container 配置
   └─ 是 → 进入第 3 步

3. DevTools Console 跑 getComputedStyle，看 position 字段：
   ├─ "static"（class 里写了 fixed） → Tailwind 没生成 .fixed 规则
   │                                    → 99% 是 @source 扫描漏了 ui 包（本文档 §1）
   ├─ "fixed" 但 transform 异常       → tailwindcss-animate 与 translate 居中冲突
   │                                    → 改用 inset-0 m-auto 居中
   └─ "fixed" 且 transform 正常       → 检查 z-index 被谁覆盖、检查祖先 transform/filter
```

**最关键的一步是第 3 步**：永远先看 `getComputedStyle()` 而不是 class 字符串。class 写了不代表生效。

---

## 相关

- [[../specs/ui/design-language]] § 玻璃面策略
- [[../specs/ui/component-inventory]] § 业务组件
- [[../tasks/review/STORY-0033-m3-ui-b-sidebar]] § 联调修复日志（本文档来源）
- [[../tasks/review/STORY-0032-m3-ui-global-layout]] § 浏览器扩展 hydration / webpack→turbopack 切换
