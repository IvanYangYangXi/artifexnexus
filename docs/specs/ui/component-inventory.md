---
tags: [spec, ui, components, M3]
created: 2026-05-09
updated: 2026-05-10
status: draft
---

# 基础组件清单 / Component Inventory

> 本 spec 定义 `@artifex-nexus/ui` 包的基础组件集合、变体规格与使用约定。
> 设计令牌见 [[design-language]]。
> **2026-05-10 STORY-0031 完成**：P0 + P1 + P2 共 26 个基础组件 + 2 个业务组件全部交付（含 web-chat-structure 全部依赖）。
> **风格**：风格 E · A+D 整合（玻璃分层 + 信息层级，去渐变），已作为所有组件默认外观。

> ⚠ **接入本组件库到新前端工程必读** → [[../../development/web-frontend-setup]]
> Tailwind v4 + pnpm workspace 有一个隐蔽坑：`@source` 必须用相对路径直指
> `packages/ui/src` 真实目录，不能走 `node_modules` 的 pnpm symlink，
> 否则 Dialog/Popover/Sheet 等浮层组件**全部不可见**且无任何报错。
> 第一次接入请严格按 setup 文档检查清单走完。

## 1. 技术约定

| 维度 | 规范 |
|------|------|
| 底层 | shadcn/ui（Radix UI + Tailwind CSS v4） |
| 变体管理 | `cva`（class-variance-authority） |
| 类合并 | `cn()` = `clsx` + `tailwind-merge` |
| Ref 透传 | 所有组件使用 `React.forwardRef` |
| 类型导出 | 每个组件导出 `<Component>Props` 类型 |
| 文件规范 | 每组件一文件，≤ 300 行 |
| 客户端标记 | 含交互的组件顶部 `"use client"` |
| 包形态 | **source-only**，`exports` 直指 `.tsx`，由消费方 bundler 编译 |

## 2. P0 组件（M3 必须交付）

### 2.1 Button

**Variant（2026-05-10 风格 E 落地）**：

| 变体 | 视觉 | 代码要点 |
|---|---|---|
| `default` | **"跳进式" primary**：实色钢蓝 + 顶部 1px inset 高光 + 投射光晕 shadow + hover brightness | `bg-primary` + `shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.5),inset_0_1px_0_0_rgba(255,255,255,0.18)]` + `hover:brightness-110` |
| `secondary` | **玻璃面次操作**：半透明白底 + backdrop-blur + hover 提亮 | `border-white/[0.10] bg-white/[0.05] backdrop-blur-md` + `hover:border-white/[0.16]` |
| `destructive` | **玻璃化危险**：rose 半透明 + rose 文字（高可读） | `border-rose-400/30 bg-rose-500/[0.10] text-rose-200` |
| `outline` | 透明 + 边框，hover 玻璃化 | `border-border bg-transparent` + `hover:bg-white/[0.05] hover:backdrop-blur-md` |
| `ghost` | 无边框，hover 淡玻璃 | `hover:bg-white/[0.05] hover:backdrop-blur-md` |
| `link` | 文字按钮 | `text-primary underline-offset-4 hover:underline` |

**Size**：`default`(h-10 px-4 py-2) / `sm`(h-9 px-3) / `lg`(h-11 px-8) / `icon`(h-10 w-10)

**Shape（2026-05-10 新增）**：`square`（默认，`rounded-md`）/ `pill`（`rounded-full`，用于 chat 主 CTA / 成对按钮组）

**状态**：default / hover / focus / active(`scale-[0.98]`) / disabled / loading

**Props**：
```ts
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  shape?: 'square' | 'pill';
  asChild?: boolean;   // Slot 透传样式到子元素（如 <a>）
  loading?: boolean;   // 禁用点击，可由调用方渲染 spinner
}
```

### 2.2 Input

单行文本输入框。

- 默认 `h-10 rounded-md border-input bg-background px-3 text-sm`
- `focus-visible:ring-2 ring-ring ring-offset-2` 焦点环
- 透传所有标准 HTML input 属性

### 2.3 Textarea

多行文本输入（Chat 消息输入核心组件）。

- 默认最小 `min-h-[80px]`，`resize-none` 由父级 layout 处决
- Chat 场景常用 `className="min-h-[64px] resize-none"` 配合外层 grid

### 2.4 Card

内容卡片容器，由子组件组合：

| 子组件 | 用途 |
|---|---|
| `Card` | 外壳，`variant="default"`（实色 L3 card）/ `variant="glass"`（玻璃面，风格 E 沉淀） |
| `CardHeader` | 顶部区域 |
| `CardTitle` | 标题 |
| `CardDescription` | 副标题/描述 |
| `CardContent` | 主体内容 |
| `CardFooter` | 底部操作区 |
| `CardSection` | **信息分组**，带顶部 1px 分割线；`first` prop 跳过分隔线（**风格 E 沉淀**，用于状态卡内多段 KV） |

**何时用 `glass`**：参见 [[design-language#3.5 玻璃面策略]]。简言之：弹层 / 卡片 / 浮起元素 → glass；主框架 / 列表行 → default 或灰阶 token。

### 2.5 Dialog

模态对话框（基于 Radix Dialog）。

| 子组件 | 用途 |
|---|---|
| `Dialog` | 根容器 |
| `DialogTrigger` | 触发器 |
| `DialogPortal` | **已强制挂 `document.body`**（防 portal 漂移） |
| `DialogContent` | 内容面板（**居中用 `inset-0 m-auto h-fit`，与 transform 解耦**） |
| `DialogHeader` / `DialogFooter` | 布局辅助 |
| `DialogTitle` / `DialogDescription` | 标题/描述 |

**视觉**：玻璃面（`bg-card/80 backdrop-blur-xl`）+ 顶部 inset 高光 + 浮起阴影。

**动画**：`fade-in-0 zoom-in-95`（**不使用 `slide-in-from-*`**，理由见 [[design-language#3.5]] 与 transform 的冲突）。

**行为**：ESC 关闭 / 点遮罩关闭 / 焦点陷阱 / aria-modal。

### 2.6 Toast（Sonner）

通知提示组件，使用 `sonner` 库。

| 类型 | 图标 | token |
|---|---|---|
| `success` | ✓ | `--success` |
| `error` | ✕ | `--destructive` |
| `info` | ℹ | `--info` |
| `warning` | ⚠ | `--warning` |

**位置**：右下角。**持续**：4s 自动消失，可手动关闭。**动画**：`slide-in-from-top-2`（Toast 非居中浮层，可放心用 slide）。

### 2.7 ScrollArea

自定义滚动条（基于 Radix ScrollArea）。

- 深色主题下滚动条轨道半透明
- 支持垂直/水平方向
- 鼠标悬停时滚动条加粗显示

## 3. P1 组件（M3 应交付）

| 组件 | 视觉 / 变体 | 备注 |
|---|---|---|
| **Badge** | `default` / `secondary` / `destructive` / `outline` | 状态/标签 |
| **Tooltip** | Radix Tooltip，**延迟 200ms** | 配 TooltipProvider 使用 |
| **Separator** | 水平/垂直，`bg-border` | — |
| **Skeleton** | **渐变 shimmer 扫光**（`muted → muted-foreground` 横向移动，1.6s infinite） | **2026-05-10 调校**：原 `animate-pulse` 在深色下透明度变化肉眼几乎看不见，改用渐变扫光 |
| **DropdownMenu** | Radix DropdownMenu；含子菜单 / 分隔 / 快捷键标记 | — |
| **Tabs** | `TabsList` / `TabsTrigger` / `TabsContent` | — |

## 4. P2 组件（web-chat-structure 显式依赖，2026-05-10 已交付）

| 组件 | 亮点 / 变体 | 主要消费场景 |
|---|---|---|
| **Avatar** | **`ring="primary"`**（默认，1px primary/40 描边环）/ `"accent"`（白色淡环，深色玻璃面上用）/ `"none"`；AvatarFallback 默认 `bg-primary/15 text-primary`（风格 E 身份色） | C2 用户/AI 消息头像、B3 用户区、Topbar 用户触发器 |
| **Select** | Radix Select，玻璃化 content | C1 Agent/Model/对话下拉、设置项下拉 |
| **Checkbox** | Radix Checkbox | Skill/Tool 卡片批量选择 |
| **Switch** | Radix Switch | 设置中"启用高级模式"等布尔开关 |
| **RadioGroup** | Radix RadioGroup | 设置中互斥选项 / 视图模式切换 |
| **Label** | Radix Label | 表单字段绑定 |
| **Popover** | Radix Popover，玻璃化 content | A3 通知铃铛 / D 区轻量信息浮层 |
| **Command** | cmdk | A2 全局搜索（⌘K） |
| **Collapsible** | Radix Collapsible（原子级） | 用在 ContextMenu 项组、C2-A-c 工具卡行内折叠；D 区复合折叠走 §5.2 |
| **Sheet** | 基于 Radix Dialog，四方向侧滑 | < 768px 响应式 B 区抽屉 / 移动端 D 区 |
| **ContextMenu** | Radix ContextMenu | D2/D3 列表右键 / B1-自定义条目 |
| **Progress** | Radix Progress | 安装进度 / 上传进度 |
| **Resizable** | `react-resizable-panels` | A/B/C/D 区域比例 + D 区内部面板分隔 |

## 5. 业务组件（chat / d-panel 专用，2026-05-10 加入）

### 5.1 ToolCallGroup / ToolCallItem

工具调用双层折叠组件，用于 Chat 主界面 + Agent log 渲染连续工具调用。

**双层结构**：
- 外层 `ToolCallGroup`：合并显示连续多次调用，标题"🔧 Tool Calls N"，右侧 Tag 汇总 done / running / error 计数
- 内层 `ToolCallItem`：单次调用，**左侧 2px 状态色 stripe**（artclaw 风），展开显示参数 / 结果 / 错误

**Header 实现**：为规避 `<button> in <button>` hydration 错误，header 使用 `<div role="button" tabIndex={0} aria-expanded onKeyDown>` 代替 `<button>`，保留 Enter/Space 键盘支持 + focus-visible ring。

**接口（受 contracts 驱动）**：

```ts
interface ToolCallData {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  durationMs?: number;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
}

<ToolCallGroup
  tools={ToolCallData[]}
  open?={boolean}             // 受控外层折叠
  onOpenChange?={(v)=>void}
  defaultOpen?={true}
  itemDefaultOpen?={false}    // 内层默认是否展开
/>
```

**行高规格**：外层 header 28px（`py-1.5`），内层 item 22px（`py-1 leading-none`）。

**视觉规格**：风格 E（A+D 整合） + `glass-surface-inner`，见 [[design-language#3.5 玻璃面策略]]。

### 5.2 CollapsiblePanelGroup / CollapsiblePanel

VS Code 风纵向折叠面板组（D 区资源管理核心）。

**特性**：
- 多个面板纵向堆叠，每个独立折叠 / 展开
- 多个展开时相邻面板间出现拖拽柄，可调各自高度
- 折叠的面板只占 **28px header**，不参与拖拽
- 支持 `autoSaveId` 持久化用户拖拽后的尺寸（localStorage）
- 受控 / 非受控 open 态都支持

**Header 实现**：同 ToolCallItem 采用 `<div role="button">` 模式，避免 `<button>` 嵌 `<Button>`（actions 槽）的嵌套违例。actions 容器带 `onPointerDown stopPropagation` 防止点击冒泡到 header 触发 toggle。

**接口**：

```tsx
<CollapsiblePanelGroup autoSaveId="d-area">
  <CollapsiblePanel
    title="OUTLINE"          // 全大写显示
    icon={<Icon />}
    badge={12}                // 右侧角标
    actions={<Button .../>}   // 展开时显示的右侧操作区
    defaultOpen={true}
    defaultSize={30}          // 百分比
    minSize={10}
    id="outline"              // autoSave 用
    order={1}
  >
    {/* body 内容 */}
  </CollapsiblePanel>
  ...
</CollapsiblePanelGroup>
```

**底层**：基于 `react-resizable-panels` v2 的 `collapsible` / `collapsedSize` / `onCollapse` / `onExpand`，通过 `ResizeObserver` 动态计算 `collapsedSize` 百分比，确保折叠态精准等于 28px header。

## 6. 使用示例

```tsx
import {
  Card,
  CardSection,
  Button,
  Avatar,
  AvatarFallback,
  ToolCallGroup,
  type ToolCallData,
} from "@artifex-nexus/ui";

function StatusCard() {
  return (
    <Card variant="glass">
      <CardSection first>
        <div className="text-eyebrow">OpenClaw Gateway</div>
        <div className="mt-1.5 text-xl font-semibold tracking-[-0.02em]">
          运行中
        </div>
      </CardSection>
      <CardSection>
        <div className="flex items-center gap-2">
          <Avatar className="h-5 w-5">
            <AvatarFallback className="text-[10px]">U</AvatarFallback>
          </Avatar>
          <Button size="sm" shape="pill">
            查看详情
          </Button>
        </div>
      </CardSection>
    </Card>
  );
}
```

## 7. 文件组织（packages/ui）

```
packages/ui/src/components/
├── button.tsx
├── input.tsx
├── textarea.tsx
├── card.tsx                  # P0 + CardSection（风格 E 沉淀）
├── dialog.tsx                # P0 + DialogPortal 强制挂 body + inset 居中
├── toast.tsx                 # Sonner provider + toast()
├── scroll-area.tsx
│
├── badge.tsx                 # P1
├── tooltip.tsx               # P1
├── separator.tsx             # P1
├── skeleton.tsx              # P1（shimmer 扫光版）
├── dropdown-menu.tsx         # P1
├── tabs.tsx                  # P1
│
├── avatar.tsx                # P2（ring variant）
├── select.tsx                # P2
├── checkbox.tsx              # P2
├── switch.tsx                # P2
├── radio-group.tsx           # P2
├── label.tsx                 # P2
├── popover.tsx               # P2
├── command.tsx               # P2
├── collapsible.tsx           # P2（Radix 原子级）
├── sheet.tsx                 # P2
├── context-menu.tsx          # P2
├── progress.tsx              # P2
├── resizable.tsx             # P2
│
├── collapsible-panel.tsx     # 业务：VS Code 风折叠面板组（2026-05-10）
└── tool-call.tsx             # 业务：chat 工具调用双层折叠（2026-05-10）
```

## 相关

- [[design-language]] — Token 规格
- [[web-chat-structure]] — Chat 界面（主要消费方）
- [[installer-structure]] — 安装向导（回填消费方）
- [[../../development/web-frontend-setup]] — Tailwind v4 + pnpm 接入必读
