---
tags: [spec, ui, components, M3]
created: 2026-05-09
updated: 2026-05-10
status: draft
---

# 基础组件清单 / Component Inventory

> 本 spec 定义 `@artifex-nexus/ui` 包的基础组件集合、变体规格与使用约定。
> 设计令牌见 [[design-language]]。
> **2026-05-10 STORY-0031 完成**：P0 + P1 + P2 共 26 个组件全部交付（含 web-chat-structure 全部依赖）。

> ⚠ **接入本组件库到新前端工程必读** → [[../../development/web-frontend-setup]]
> Tailwind v4 + pnpm workspace 有一个隐蔽坑：`@source` 必须用相对路径直指
> `packages/ui/src` 真实目录，不能走 `node_modules` 的 pnpm symlink，
> 否则 Dialog/Popover/Sheet 等浮层组件**全部不可见**且无任何报错。
> 第一次接入请严格按 setup 文档检查清单走完。

## 1. 技术约定

| 维度 | 规范 |
|------|------|
| 底层 | shadcn/ui（Radix UI + Tailwind CSS） |
| 变体管理 | `cva`（class-variance-authority） |
| 类合并 | `cn()` = `clsx` + `tailwind-merge` |
| Ref 透传 | 所有组件使用 `React.forwardRef` |
| 类型导出 | 每个组件导出 `<Component>Props` 类型 |
| 文件规范 | 每组件一文件，≤ 300 行 |
| 客户端标记 | 含交互的组件顶部 `"use client"` |

## 2. P0 组件（M3 必须交付）

### 2.1 Button

| 变体 | 样式描述 |
|---|---|
| `default` | primary 背景 + primary-foreground 文字 |
| `secondary` | secondary 背景 |
| `destructive` | destructive 背景 |
| `outline` | 透明背景 + border |
| `ghost` | 透明背景，hover 显示 accent |
| `link` | 无背景无边框，下划线 |

**Size**：`sm`(h-9 px-3) / `default`(h-10 px-4 py-2) / `lg`(h-11 px-8) / `icon`(h-10 w-10)

**状态**：default / hover / focus / active / disabled / loading

### 2.2 Input

单行文本输入框。

| Prop | 类型 | 说明 |
|---|---|---|
| `type` | string | 标准 HTML input type |
| `disabled` | boolean | 禁用态 |
| `className` | string | Tailwind 覆盖 |

**样式**：`h-10 rounded-md border-input bg-background px-3 text-sm`

### 2.3 Textarea

多行文本输入（Chat 消息输入核心组件）。

| Prop | 类型 | 说明 |
|---|---|---|
| `rows` | number | 默认行数 |
| `className` | string | Tailwind 覆盖 |

**特殊行为**：支持 `min-h-[80px]` 自适应高度（Chat 场景）。

### 2.4 Card

内容卡片容器，由子组件组合：

- `Card`：外壳，`variant="default"` (实色 L3) / `variant="glass"` (玻璃面，2026-05-10 加入)
- `CardHeader`：顶部区域
- `CardTitle`：标题
- `CardDescription`：副标题/描述
- `CardContent`：主体内容
- `CardFooter`：底部操作区
- `CardSection`：信息分组（带顶部 1px 分割线，`first` prop 跳过分隔线）— **风格 E 沉淀**

**何时用 `glass`**：参见 [[design-language#3.5 玻璃面策略]]。简言之：弹层 / 卡片 / 浮起元素 → glass；主框架 / 列表行 → default 或灰阶 token。

### 2.5 Dialog

模态对话框（基于 Radix Dialog）。

- `Dialog`：根容器
- `DialogTrigger`：触发器
- `DialogContent`：内容面板（居中，带遮罩）
- `DialogHeader` / `DialogFooter`：布局辅助
- `DialogTitle` / `DialogDescription`：标题/描述

**行为**：ESC 关闭 / 点遮罩关闭 / 焦点陷阱 / aria-modal

### 2.6 Toast（Sonner）

通知提示组件，使用 `sonner` 库。

| 类型 | 图标 | 色彩 |
|---|---|---|
| `success` | ✓ | green |
| `error` | ✕ | destructive |
| `info` | ℹ | primary |
| `warning` | ⚠ | yellow |

**位置**：右下角。**持续**：4s 自动消失，可手动关闭。

### 2.7 ScrollArea

自定义滚动条（基于 Radix ScrollArea）。

- 深色主题下滚动条轨道半透明
- 支持垂直/水平方向
- 鼠标悬停时滚动条加粗显示

## 3. P1 组件（M3 应交付）

| 组件 | 简述 |
|---|---|
| **Badge** | 状态/标签徽章（`default` / `secondary` / `destructive` / `outline`） |
| **Tooltip** | 悬浮提示（Radix Tooltip，延迟 200ms 显示） |
| **Separator** | 水平/垂直分隔线 |
| **Skeleton** | 加载占位动画（`animate-pulse` 背景闪烁） |
| **DropdownMenu** | 下拉菜单（Radix DropdownMenu，含子菜单/分隔/快捷键） |
| **Tabs** | 标签页切换（`TabsList` / `TabsTrigger` / `TabsContent`） |

## 4. P2 组件（web-chat-structure 显式依赖，2026-05-10 已交付）

| 组件 | 简述 | 主要消费场景 |
|---|---|---|
| **Avatar** | 头像/用户标识（Radix Avatar） | C2 用户/AI 消息头像、B3 用户区 |
| **Select** | 下拉选择器（Radix Select） | C1 Agent/Model/对话下拉、设置项下拉 |
| **Checkbox** | 复选框（Radix Checkbox） | Skill/Tool 卡片批量选择 |
| **Switch** | 开关（Radix Switch） | 设置中"启用高级模式"等布尔开关 |
| **RadioGroup** | 单选组（Radix RadioGroup） | 设置中互斥选项 / 视图模式切换 |
| **Label** | 表单标签（Radix Label） | 表单字段绑定 |
| **Popover** | 弹出层（非模态，Radix Popover） | A3 通知铃铛 / D 区轻量信息浮层 |
| **Command** | 命令面板（cmdk） | A2 全局搜索（Ctrl+K） |
| **Collapsible** | 折叠容器（Radix Collapsible） | C2-A-c 工具卡折叠、D3 Tool 分组折叠 |
| **Sheet** | 侧边滑入抽屉（基于 Radix Dialog） | < 768px 响应式 B 区抽屉 / 移动端 D 区 |
| **ContextMenu** | 右键菜单（Radix ContextMenu） | D2/D3 列表右键 / B1-自定义条目 |
| **Progress** | 进度条（Radix Progress） | 安装进度 / 上传进度 |
| **Resizable** | 可拖拽分隔（react-resizable-panels） | A/B/C/D 区域比例 + D 区内部面板分隔 |
| **CollapsiblePanel / CollapsiblePanelGroup** | VS Code 风纵向折叠面板组（多个面板独立折叠 + 多个展开时可拖拽调高度） | D 区资源管理：OUTLINE / TIMELINE / TOOL CALLS / MEMORY |

## 5. 业务组件（chat / agent log 专用，2026-05-10 加入）

### 5.1 ToolCallGroup / ToolCallItem

工具调用双层折叠组件，用于 Chat 主界面 + Agent log 渲染连续工具调用。

**双层结构**：
- 外层 `ToolCallGroup`：合并显示连续多次调用，标题"🔧 Tool Calls N"，右侧 Tag 汇总 done / running / error 计数
- 内层 `ToolCallItem`：单次调用，左侧 2px 状态色 stripe（artclaw 风），展开显示参数 / 结果 / 错误

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

**视觉规格**：风格 E（A+D 整合），见 [[design-language#3.5 玻璃面策略]]。

### 5.2 CollapsiblePanelGroup / CollapsiblePanel

VS Code 风纵向折叠面板组（D 区资源管理核心）。

**特性**：
- 多个面板纵向堆叠，每个独立折叠 / 展开
- 多个展开时相邻面板间出现拖拽柄，可调各自高度
- 折叠的面板只占 28px header，不参与拖拽
- 支持 `autoSaveId` 持久化用户拖拽后的尺寸（localStorage）
- 受控 / 非受控 open 态都支持

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

**底层**：基于 `react-resizable-panels` v2 的 `collapsible` / `collapsedSize` / `onCollapse` / `onExpand`，
通过 `ResizeObserver` 动态计算 `collapsedSize` 百分比，确保折叠态精准等于 28px header。

## 5. 使用示例

```tsx
import { Button, Card, CardHeader, CardTitle, CardContent } from "@artifex-nexus/ui";

function ExampleCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenClaw 状态</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">Gateway 运行中</p>
        <Button variant="secondary" size="sm">查看详情</Button>
      </CardContent>
    </Card>
  );
}
```

## 6. 文件组织（packages/ui）

```
packages/ui/src/components/
├── button.tsx
├── input.tsx
├── textarea.tsx
├── card.tsx
├── dialog.tsx
├── toast.tsx              # Sonner provider + toast()
├── scroll-area.tsx
├── badge.tsx
├── tooltip.tsx
├── separator.tsx
├── skeleton.tsx
├── dropdown-menu.tsx
├── tabs.tsx
│
├── avatar.tsx             # P2
├── select.tsx             # P2
├── checkbox.tsx           # P2
├── switch.tsx             # P2
├── radio-group.tsx        # P2
├── label.tsx              # P2
├── popover.tsx            # P2
├── command.tsx            # P2
├── collapsible.tsx        # P2
├── sheet.tsx              # P2
├── context-menu.tsx       # P2
├── progress.tsx           # P2
├── resizable.tsx          # P2
├── collapsible-panel.tsx  # P2 业务（VS Code 风折叠面板组，2026-05-10）
└── tool-call.tsx          # 业务（chat 工具调用双层折叠，2026-05-10）
```

## 相关

- [[design-language]] — Token 规格
- [[web-chat-structure]] — Chat 界面（主要消费方）
- [[installer-structure]] — 安装向导（回填消费方）
