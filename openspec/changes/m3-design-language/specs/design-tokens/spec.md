## ADDED Requirements

### Requirement: CSS 变量 Token 体系
系统 SHALL 通过 CSS 自定义属性（`--<token-name>`）定义所有视觉令牌，以 HSL 格式存储色彩值，格式为 `<H> <S>% <L>%`（无 `hsl()` 包裹，便于 Tailwind 组合 alpha）。

#### Scenario: Token 定义加载
- **WHEN** 任一前端应用（desktop / web）加载 `@artifex-nexus/ui` 的 globals.css
- **THEN** `:root` 上 SHALL 挂载完整的 CSS 变量集（含 background / foreground / primary / secondary / muted / accent / destructive / card / popover / border / input / ring）

#### Scenario: 深色主题默认
- **WHEN** 页面加载且无用户偏好覆盖
- **THEN** 系统 SHALL 使用 `.dark` class 对应的深色 token 值作为默认外观

### Requirement: 深色/浅色双主题
系统 SHALL 提供两套完整 token（深色 `.dark` + 浅色 `.light`），通过在 `<html>` 元素上切换 class 实现主题切换。

#### Scenario: 主题切换
- **WHEN** 用户或系统将 `<html>` 的 class 从 `dark` 切换为 `light`
- **THEN** 所有依赖 CSS 变量的组件 SHALL 立即反映浅色主题色值，无需页面刷新

#### Scenario: 系统偏好跟随
- **WHEN** 用户未手动设置主题偏好
- **THEN** 系统 SHALL 检测 `prefers-color-scheme` 媒体查询并匹配对应主题

### Requirement: 色彩 Token 表
系统 SHALL 定义以下色彩语义 token：

| Token | 深色默认值 (HSL) | 用途 |
|---|---|---|
| `--background` | 222.2 84% 4.9% | 页面/面板背景 |
| `--foreground` | 210 40% 98% | 主要文字 |
| `--primary` | 217.2 91.2% 59.8% | 品牌强调（按钮、链接） |
| `--primary-foreground` | 222.2 47.4% 11.2% | 品牌色上的文字 |
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

#### Scenario: Token 一致性
- **WHEN** 开发者在组件中使用 `bg-primary text-primary-foreground`
- **THEN** 渲染结果 SHALL 使用上表定义的 HSL 值（或其主题变体）

### Requirement: 间距/圆角/字体 Token
系统 SHALL 定义以下布局 token：

- `--radius`：默认圆角基值，深色 `0.5rem`
- 字体族：`--font-sans: "Inter", system-ui, sans-serif`，`--font-mono: "JetBrains Mono", "Fira Code", monospace`
- 字体大小比例：基于 Tailwind 默认（`text-xs` 到 `text-4xl`），不自定义

#### Scenario: 圆角统一
- **WHEN** 任何组件使用 `rounded-md` / `rounded-lg`
- **THEN** 圆角 SHALL 基于 `--radius` 变量计算（`md = --radius`，`lg = --radius + 2px`）

### Requirement: Tailwind Preset 分发
系统 SHALL 提供 `packages/ui/tailwind.preset.ts` 作为统一配置入口，所有前端 app 的 `tailwind.config` MUST 继承该 preset。

#### Scenario: Preset 继承
- **WHEN** `apps/desktop/tailwind.config.ts` 配置 `presets: [require("@artifex-nexus/ui/tailwind.preset")]`
- **THEN** desktop 应用 SHALL 获得完整的 token 体系 + 组件样式
