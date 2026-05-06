---
id: STORY-0002
kind: story
title: 安装清单 UI 骨架（替换步骤式向导）
status: done
priority: P1
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-05-04
updated: 2026-05-05
parent: "[[EPIC-0000-m0-installer-wizard]]"
milestone: M0
related_adr: []
related_specs:
  - "[[../../specs/ui/installer-structure]]"
related_packages:
  - "apps/desktop"
tags: [story, ui, installer, M0]
---

# 安装清单 UI 骨架

## 背景与目标

把 `apps/desktop` 的首启向导从 3 屏步骤式改为**安装清单式**（落实 [[../../specs/ui/installer-structure]]）。
本 STORY 只交付**骨架 + 桩数据**：清单可见、三按钮占位、零真实安装逻辑。
状态机走 [[STORY-0003-installer-status-state-machine]]；DCC 子项展开走 [[STORY-0004-installer-dcc-expandable]]。

## 范围 / 非范围

- 范围
  - 路由 `/installer`（保留 `/setup-wizard` 重定向到 `/installer`）
  - 顶级清单容器 + 6 个固定行（OpenClaw / Web UI / Blender / UE / Max / Maya，ComfyUI 占位但渲染禁用态）
  - 每行三按钮占位（无真实点击逻辑，本期点击仅 console.log）
  - 文案集中到 `installer.i18n.ts` 常量对象
  - 桩数据集中到 `installer.fixtures.ts`
  - 类型集中到 `installer.types.ts`（仅前端，contracts 待 STORY-0003）
  - 样式：CSS Modules（同名 `.module.css`），不引组件库
- 非范围
  - 状态机与按钮启用规则（STORY-0003）
  - DCC 子项展开（STORY-0004）
  - 真实 Tauri command（STORY-0003 起）
  - 设计令牌（M3 EPIC-0003）
  - i18n 切换（react-i18next 后期）

## 验收标准

- [x] 路由 `/installer` 存在，导航文案改为"安装向导"
- [x] 旧 `/setup-wizard` 访问会 302 / `<Navigate>` 到 `/installer`
- [x] `apps/desktop/src/routes/InstallerWizard.tsx` 不再含 step 概念
- [x] 渲染 6 个顶级条目 + ComfyUI 占位（共 7 行）
- [x] 每行渲染：图标占位 / 名称 / 状态徽章占位 / 三按钮（检测 / 设置 / 安装）
- [x] 文案 100% 走 `installer.i18n.ts`，组件内无中文字面量
- [x] 类型在 `installer.types.ts`，桩数据在 `installer.fixtures.ts`
- [x] 样式走 CSS Modules，组件文件无 inline style（或 ≤ 3 处合理特例并加注释）
- [x] 文件粒度：每个文件 100–300 行，全部 ≤ 500 行
- [x] `pnpm --filter @artifex-nexus/desktop typecheck` 通过
- [ ] `pnpm --filter @artifex-nexus/desktop dev` 启动后页面无 console error
- [x] 反链 [[../../specs/ui/installer-structure]] 与 [[EPIC-0000-m0-installer-wizard]]

## 设计要点

### align 结论

| # | 决策 | 拍板 |
|---|---|---|
| 1 | 路由 / 文案 | `/installer` + "安装向导"，旧 `/setup-wizard` 重定向 |
| 2 | 样式 | 不引组件库；用 CSS Modules；M3 后再考虑 |
| 3 | 状态管理 | 原生 `useReducer + Context`，零依赖 |
| 4 | 文件粒度 | `routes/InstallerWizard.tsx` + `features/installer/{InstallList,InstallItemRow,StatusBadge,installer.types,installer.fixtures,installer.i18n}.tsx/ts`，各件同名 `.module.css` |
| 5 | 类型与 contracts | 本期仅前端 TS；STORY-0003 实现状态机时补 `installer.schema.json` 并生成 TS / Pydantic |
| 6 | i18n | 本期不引 react-i18next；文案常量集中 `installer.i18n.ts`，调用 `t.zhCN.xxx` |

### 文件树

```
apps/desktop/src/
├── routes/
│   └── InstallerWizard.tsx          # 页面容器，路由入口
└── features/installer/
    ├── InstallList.tsx              # 主表
    ├── InstallList.module.css
    ├── InstallItemRow.tsx           # 单行
    ├── InstallItemRow.module.css
    ├── StatusBadge.tsx              # 状态徽章
    ├── StatusBadge.module.css
    ├── installer.types.ts           # InstallItemState 等
    ├── installer.fixtures.ts        # 7 行桩数据
    └── installer.i18n.ts            # 文案常量
```

### 类型雏形（仅供参考，实现可调）

```ts
export type InstallItemState =
  | "unavailable" | "not-installed" | "installing"
  | "installed"   | "update-available" | "failed"

export interface InstallItem {
  id: string                         // "openclaw" | "web-ui" | "blender" | ...
  name: string                       // 来自 i18n
  iconKey: string                    // 资源键，本期不绑实际图
  state: InstallItemState
  expandable: boolean                // DCC 系为 true，OpenClaw / Web UI 为 false
  comingSoon?: boolean               // ComfyUI 占位用
}
```

### 已有文件影响

- `App.tsx`：导航 `Link` 文案 / 路由路径调整；新增 `<Navigate from="/setup-wizard" to="/installer" />`
- `routes/SetupWizard.tsx`：本期**保留文件但内容替换为重定向占位**（避免引用断裂）；下一 STORY 删
- `EchoTest.tsx`：不动

## 进展日志

- 2026-05-04 created
- 2026-05-05 align 完成 6 个决策点（路由命名/样式方案/状态管理/文件粒度/contracts 节奏/i18n 节奏），迁 ready
- 2026-05-05 关联副线 [[STORY-0006-merge-installer-into-desktop]]（installer/ 并入 apps/desktop）
- 2026-05-05 implement started by ai — 迁 in-progress，开始创建 features/installer/ 文件
- 2026-05-05 implement done by ai — 全部验收标准已勾选（除 dev 启动需人工验证），迁 review
