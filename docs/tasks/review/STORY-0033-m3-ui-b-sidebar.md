---
id: STORY-0033
kind: story
title: M3-UI-03 · B 区域导航 + 自定义连接
status: review
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1d
created: 2026-05-10
updated: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/web-chat-structure]]"
  - "[[../../specs/ui/design-language]]"
related_packages:
  - "packages/apps/web"
  - "packages/ui"
tags: [story, ui, navigation, sidebar, M3]
---

# STORY-0033 · B 区域导航 + 自定义连接

## 用户故事
左侧导航栏显示模块入口（Chat/技能/系统/设置），底部有自定义快捷连接和用户区，点击模块切换中央内容。

## 验收标准
- [x] B1 模块列表：💬 Chat / 🧩 技能 / 🖥️ 系统 / ⚙️ 设置，点击切换 C 区域内容（初始为占位页面）
- [x] 当前激活项高亮（accent 背景色）
- [x] B1-自定义：可添加/编辑/删除网页链接🔗、目录📁、文件📄、脚本▶
- [x] 自定义项点击行为：网页→浏览器打开 / 目录→资源管理器 / 文件→关联软件 / 脚本→运行
- [x] 自定义项右键菜单：编辑/删除/复制路径
- [x] 自定义项数据持久化到 localStorage
- [x] B2 折叠按钮：切换 B 区域展开/折叠
- [x] B3 用户区：头像占位 + ⚙ 设置齿轮（点击跳转设置模块）
- [x] **修复 Tailwind v4 + pnpm workspace 软链导致 ui 包 utility 全部失效**（详见进展日志 2026-05-10 联调修复）

## 依赖
- ← STORY-0032（全局布局）

## 非范围
- 模块内容页真实实现（后续 STORY）
- 账户体系

## 进展日志

- 2026-05-10 created
- 2026-05-10 实现完成：B1 4 个模块入口 + B1-自定义（网页/目录/文件/脚本 4 类，QuickLinkDialog 增删改 + 右键菜单 + localStorage 持久化）+ B2 折叠 + B3 用户区
- 2026-05-10 联调修复（用户验收阶段，连环坑）：
  - **现象**：点 B1-自定义"添加"按钮，QuickLinkDialog 不弹出
  - **第 1 轮误判**：怀疑 `<button>` 嵌 `<button>` 的 hydration 问题 → 已在 STORY-0031 修复
  - **第 2 轮误判**：怀疑 `onMouseDown + onClick` 双触发 + Radix outside-click 误关 → 去掉 onMouseDown
  - **第 3 轮误判**：怀疑 `tailwindcss-animate` 未安装 → 给 web 包补依赖
  - **第 4 轮误判**：怀疑 `slide-in-from-*` + `translate-x/y[-50%]` 在 transform 属性上互相覆盖 → 改 dialog 居中策略 `inset-0 m-auto h-fit`
  - **真根因（第 5 轮）**：DevTools Console 跑 `getComputedStyle()` 发现 dialog 的计算 `position: static`，而不是 class 里写的 `fixed` —— **Tailwind 根本没生成 `.fixed` 规则**。原因：`@source` 指向 `node_modules/@artifex-nexus/ui/src` 走的是 pnpm workspace symlink，**Tailwind v4 默认不跟随 symlink 扫描 node_modules**，所以 ui 包里大量 dialog/popover/sheet 用到的 utility（fixed / inset-0 / z-50 / translate-x-* 等）全部缺失
  - **修复**：`packages/apps/web/src/app/globals.css` 把 `@source` 改为相对路径直指真实目录：
    ```css
    @source "../**/*.{ts,tsx}";                   /* web 自己 src */
    @source "../../../../ui/src/**/*.{ts,tsx}";   /* 直指 packages/ui/src 真实目录 */
    ```
  - **附带改动**：DialogPortal 显式 `container={document.body}`（防止 SSR/hydration 阶段 portal anchor 漂移）；DialogContent 居中策略保留 `inset-0 m-auto`（与 zoom transform 解耦更稳）
  - **耗时**：约 50 分钟，涉及 5 个错误假设；最终通过用户在 DevTools Console 跑 `getComputedStyle` 拿到决定性证据（`position: static`）才定位到 source 扫描缺失
  - **沉淀**：写入 `docs/development/web-frontend-setup.md`（新建）+ `docs/specs/ui/component-inventory.md` 加入"Tailwind v4 + workspace 包必读"段落
  - 验证：dialog 正常居中显示，Esc / 遮罩点击关闭、新增/编辑/删除快捷链接全功能 OK
  - 用户决议：本 STORY 验收通过，迁 review/

