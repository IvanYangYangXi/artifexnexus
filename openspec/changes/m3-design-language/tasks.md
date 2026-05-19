## 1. Spec 文档产出

- [ ] 1.1 编写 `docs/specs/ui/design-language.md`（设计令牌 token 表，含深/浅色双套完整值）
- [ ] 1.2 编写 `docs/specs/ui/component-inventory.md`（基础组件清单、变体、状态规格）
- [ ] 1.3 更新 `docs/specs/ui/` 目录 README 索引

## 2. packages/ui 包初始化

- [ ] 2.1 创建 `packages/ui/package.json`（`@artifex-nexus/ui`，依赖 react / tailwindcss / radix / class-variance-authority / clsx / tailwind-merge）
- [ ] 2.2 创建 `packages/ui/tsconfig.json`（strict 模式，路径别名 `@/`）
- [ ] 2.3 创建 `packages/ui/tailwind.preset.ts`（完整 token 定义：色彩/字体/圆角/间距）
- [ ] 2.4 创建 `packages/ui/src/globals.css`（@tailwind 指令 + CSS 变量双套主题）
- [ ] 2.5 创建 `packages/ui/src/lib/utils.ts`（`cn()` 工具函数）
- [ ] 2.6 创建 `packages/ui/src/index.ts`（统一导出入口）

## 3. shadcn/ui 组件生成（P0 优先级）

- [ ] 3.1 生成 Button 组件（含 default / secondary / destructive / outline / ghost / link 变体）
- [ ] 3.2 生成 Input 组件
- [ ] 3.3 生成 Textarea 组件
- [ ] 3.4 生成 Card 组件（Card / CardHeader / CardTitle / CardContent / CardFooter）
- [ ] 3.5 生成 Dialog 组件（Dialog / DialogTrigger / DialogContent / DialogHeader / DialogFooter）
- [ ] 3.6 生成 Toast / Sonner 通知组件
- [ ] 3.7 生成 ScrollArea 组件

## 4. shadcn/ui 组件生成（P1 优先级）

- [ ] 4.1 生成 Badge 组件
- [ ] 4.2 生成 Tooltip 组件
- [ ] 4.3 生成 Separator 组件
- [ ] 4.4 生成 Skeleton 组件
- [ ] 4.5 生成 DropdownMenu 组件
- [ ] 4.6 生成 Tabs 组件

## 5. apps/desktop 集成 Tailwind + @artifex-nexus/ui

- [ ] 5.1 在 `apps/desktop/package.json` 添加依赖：tailwindcss v4 / @artifex-nexus/ui / postcss / autoprefixer
- [ ] 5.2 创建 `apps/desktop/tailwind.config.ts`（继承 packages/ui preset）
- [ ] 5.3 创建 `apps/desktop/postcss.config.js`
- [ ] 5.4 在 `apps/desktop/src/main.tsx` 导入 `@artifex-nexus/ui/globals.css`
- [ ] 5.5 验证 `pnpm -C apps/desktop build` 通过（Tailwind 正确编译）

## 6. packages/apps/web 集成 Tailwind + @artifex-nexus/ui

- [ ] 6.1 在 `packages/apps/web/package.json` 添加依赖
- [ ] 6.2 配置 Next.js 15 的 Tailwind（postcss / tailwind.config）
- [ ] 6.3 在 layout.tsx 导入 globals.css + 设置 Inter 字体
- [ ] 6.4 验证 `pnpm -C packages/apps/web build` 通过

## 7. M0 安装向导视觉回填

- [ ] 7.1 将 `InstallerWizard` 路由页面的导航栏/布局换用 @artifex-nexus/ui 组件 + Tailwind
- [ ] 7.2 将 `InstallList` 中的 StatusBadge 换用 Badge 组件 + token 色彩
- [ ] 7.3 将 Button（检测/设置/安装）换用 @artifex-nexus/ui Button
- [ ] 7.4 将 LogPanel 换用 ScrollArea + token 色彩
- [ ] 7.5 将 Dialog（重装确认等）换用 @artifex-nexus/ui Dialog
- [ ] 7.6 删除不再使用的 .module.css 文件
- [ ] 7.7 验证 `pnpm -C apps/desktop tauri build` 通过，产物可运行
