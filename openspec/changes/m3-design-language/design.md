## Context

当前 `apps/desktop` 前端使用散乱的 CSS Modules（`.module.css`）+ 内联 style 对象，无统一 token 体系。`packages/apps/web` 是 Next.js 空壳，未设样式。M3 要求建立统一设计语言，覆盖两个前端应用。

**现有技术栈**：
- `apps/desktop`：Vite 5 + React 18 + react-router-dom + CSS Modules
- `packages/apps/web`：Next.js 15 + React 18

**目标**：引入 Tailwind CSS v4 + shadcn/ui 组件 + 共享 `packages/ui` 包，实现双端视觉一致。

## Goals / Non-Goals

**Goals:**
- 建立统一 CSS 变量 token 体系（色彩/字体/间距/圆角/阴影/动效），以 Tailwind preset 形式分发
- 创建 `packages/ui`（`@artifex-nexus/ui`）共享组件包，基于 shadcn/ui 生成 + 品牌定制
- 让 `apps/desktop` 和 `packages/apps/web` 都能引用同一套组件
- 深色主题为主、浅色为辅（运行时可切换，深色优先实现）
- M0 安装向导用新组件/token 重刷视觉

**Non-Goals:**
- 不重写安装向导的业务逻辑/状态机/路由结构
- 不做 i18n 框架（仅中文文案不变）
- 不做动画库（动效只用 CSS transition/Tailwind animate）
- 不做移动端适配

## Decisions

### D1：样式框架 — Tailwind CSS v4

**选择**：Tailwind CSS v4 + CSS 变量定义 token
**替代方案**：CSS Modules（现状）/ Vanilla Extract / Emotion
**理由**：
- v4 原生支持 CSS 变量作为 theme source，与 shadcn/ui 天然配合
- Vite 和 Next.js 都有成熟 Tailwind 插件
- 两个 app 共用一个 `tailwind.preset.ts`，token 变更一处全局生效
- 零运行时 CSS-in-JS 开销

### D2：组件库 — shadcn/ui 生成到 packages/ui

**选择**：用 shadcn/ui CLI 生成组件源码到 `packages/ui/src/components/`
**替代方案**：Radix + 全手写 / Ark UI / 全自建
**理由**：
- shadcn 生成的代码在我们仓库，可完全控制修改
- 底层 Radix UI 提供 a11y 保障（键盘/焦点/ARIA）
- M3 预估 3 周，预生成组件能显著节省时间
- 社区生态大，后续贡献者上手容易

### D3：共享包结构 — packages/ui

**选择**：新建 `packages/ui/` 作为 monorepo 内部包（`@artifex-nexus/ui`）
**结构**：
```
packages/ui/
├── package.json          # name: @artifex-nexus/ui
├── tailwind.preset.ts    # token 定义：色彩/字体/间距/圆角/阴影
├── src/
│   ├── index.ts          # 统一导出
│   ├── globals.css       # @tailwind base/components/utilities + CSS 变量
│   └── components/       # shadcn/ui 生成的组件
│       ├── button.tsx
│       ├── input.tsx
│       ├── dialog.tsx
│       └── ...
├── tsconfig.json
└── tailwind.config.ts
```

**引用方式**：两个 app 在 `package.json` 加 `"@artifex-nexus/ui": "workspace:*"`

### D4：色彩体系 — HSL 变量 + 深/浅双套

**选择**：用 HSL 格式 CSS 变量（shadcn 标准做法），深色主题优先
- `--background`: 深色 `222.2 84% 4.9%`
- `--foreground`: 浅色文字 `210 40% 98%`
- `--primary`: 品牌蓝 `217.2 91.2% 59.8%`（≈ #3b82f6）
- 浅色主题作为 `.light` class 覆盖

### D5：字体 — Inter + 等宽

**选择**：Inter（UI）+ JetBrains Mono / Fira Code（代码/日志）
**加载方式**：`@fontsource/inter`（npm 包，本地加载，无 CDN 依赖）

### D6：apps/desktop 迁移策略 — 渐进式

**选择**：不一次性删除所有 CSS Modules，而是：
1. 先加入 Tailwind 配置 + 引入 `@artifex-nexus/ui`
2. 安装向导页面用新组件重写视觉
3. 其他页面（Status/Settings）后续迁移

## Risks / Trade-offs

- **[双构建配置复杂度]** → Tailwind v4 在 Vite 和 Next.js 的配置略有差异。Mitigation：统一 preset，各 app 只写最小 tailwind.config 引入 preset。
- **[shadcn 升级维护]** → shadcn 不是 npm 包，升级需手动 diff。Mitigation：组件在我们仓库，控制在手；锁定初始版本，按需 cherry-pick 上游改动。
- **[包体积]** → Tailwind + Radix 增加约 50-80KB（gzip）。Mitigation：Tailwind v4 的按需编译 + tree-shaking 可控制在合理范围。
- **[CSS Modules 混用期]** → 迁移期间新旧样式共存可能冲突。Mitigation：Tailwind 的 class 不会与 CSS Modules 的 scoped 类名冲突；保持现有 `.module.css` 可工作，新增页面直接用 Tailwind。
