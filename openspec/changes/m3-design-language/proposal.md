## Why

M3 里程碑的首要任务是**确立 Artifex Nexus 统一设计语言**。当前 `apps/desktop` 使用散乱的 CSS Modules + 内联样式，无统一色彩/字体/间距/组件规范。后续 Web UI（Chat/Skill/Tool/Memory 管理）和桌面壳都需要共用同一套视觉系统。不先建立 design token 和基础组件体系，后续每个模块各画各的，无法达到产品级一致性。

## What Changes

- 新建 `docs/specs/ui/design-language.md`：定义所有设计令牌（色彩/字体/间距/圆角/阴影/动效）
- 新建 `docs/specs/ui/component-inventory.md`：基础组件清单及其状态/变体规格
- 新建 `packages/ui/`：共享 UI 包，基于 shadcn/ui + Tailwind CSS v4 + Radix UI
- 将 Tailwind preset（含 CSS 变量 token）落为代码，`apps/desktop` 和 `packages/apps/web` 共同引用
- M0 安装向导视觉回填（用新 token 重刷样式，不改结构/逻辑）

## Capabilities

### New Capabilities
- `design-tokens`: 颜色/字体/间距/圆角/阴影/动效的统一 CSS 变量体系与 Tailwind preset
- `shared-ui-components`: 基于 shadcn/ui 的共享 React 组件库（Button/Input/Dialog/Toast/Card/ScrollArea 等），双端（web + desktop）可复用

### Modified Capabilities
<!-- 无现有 spec 级别行为变更 -->

## Impact

- **新增包**：`packages/ui`（`@artifex-nexus/ui`）
- **依赖变更**：`apps/desktop` 和 `packages/apps/web` 新增对 `@artifex-nexus/ui` 和 Tailwind CSS v4 的依赖
- **样式迁移**：`apps/desktop/src/` 现有 CSS Modules 逐步迁移到 Tailwind + 共享组件（M3 内完成安装向导部分）
- **构建配置**：两个 app 的 Vite/Next.js 配置需加载 Tailwind preset
- **不影响**：Rust 后端、Python sidecar、contracts schema 均无变动
