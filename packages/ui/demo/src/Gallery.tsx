import { useState } from "react";

import {
  // P0
  Badge,
  Button,
  Card,
  CardSection,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  // P1
  Separator,
  Skeleton,
  toast,
  // P2
  Avatar,
  AvatarFallback,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  CollapsiblePanel,
  CollapsiblePanelGroup,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  RadioGroup,
  RadioGroupItem,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Switch,
  // 业务
  ToolCallGroup,
  type ToolCallData,
} from "@artifex-nexus/ui";

const SAMPLE_TOOLS: ToolCallData[] = [
  {
    id: "tc1",
    name: "mcp_blender_run_python",
    status: "done",
    durationMs: 312,
    args: { code: "bpy.ops.mesh.primitive_cube_add(size=2)" },
    result: "<bpy_struct, Object('Cube')>",
  },
  {
    id: "tc2",
    name: "mcp_blender_run_python",
    status: "done",
    durationMs: 184,
    args: { code: "obj.location = (2, 0, 0)" },
    result: "OK",
  },
  {
    id: "tc3",
    name: "mcp_blender_run_python",
    status: "running",
    args: { code: 'mat = bpy.data.materials.new("Steel")' },
  },
];

/**
 * Gallery — 组件展厅（2026-05-10 升级到风格 E）
 *
 * 全部 26 个组件 + 业务组件 ToolCallGroup 的展示。
 * 默认应用风格 E（A+D 整合）：玻璃面 + 标签字 + 单色品牌蓝 + 状态色单色。
 */
export function Gallery() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [progress, setProgress] = useState(60);
  const [cmdOpen, setCmdOpen] = useState(false);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.remove(theme);
    document.documentElement.classList.add(next);
    setTheme(next);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(at_top_left,_rgba(70,120,200,0.08),transparent_55%),radial-gradient(at_bottom_right,_rgba(60,100,180,0.06),transparent_55%)] bg-background text-foreground">
      <header className="sticky top-12 z-30 flex h-12 items-center justify-between border-b border-white/[0.06] bg-titlebar/80 px-6 text-titlebar-foreground backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight">
            @artifex-nexus/ui
          </span>
          <Badge variant="secondary">M3 · STORY-0031 · 26 组件 + 1 业务</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCmdOpen(true)}
          >
            ⌘K 搜索
          </Button>
          <Button variant="outline" size="sm" onClick={toggleTheme}>
            切换到 {theme === "dark" ? "浅色" : "深色"}
          </Button>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden h-[calc(100vh-6rem)] w-48 shrink-0 border-r border-white/[0.05] bg-sidebar/80 p-3 text-sidebar-foreground backdrop-blur-md md:block">
          <nav className="space-y-1 text-sm">
            {[
              ["#layers", "🎨 灰阶层级"],
              ["#tool-call", "🔧 ToolCallGroup（业务）"],
              ["#collapsible-panel-group", "📚 CollapsiblePanelGroup（D 区）"],
              ["#button", "💠 Button"],
              ["#input", "✏️ Input/Textarea"],
              ["#card", "🗂 Card"],
              ["#avatar", "👤 Avatar"],
              ["#select", "📋 Select / Forms"],
              ["#dialog", "🪟 Dialog/Sheet"],
              ["#menus", "📜 Menus"],
              ["#layout", "🧱 Layout"],
              ["#feedback", "💬 Feedback"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="block rounded px-2 py-1.5 transition hover:bg-white/[0.05]"
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="flex-1 space-y-8 px-6 py-8">
          <SectionLayers />
          <SectionToolCall tools={SAMPLE_TOOLS} />
          <SectionButton />
          <SectionInput />
          <SectionCard />
          <SectionAvatar />
          <SectionFormControls />
          <SectionSelect />
          <SectionBadge />
          <SectionDialog />
          <SectionSheet />
          <SectionPopover />
          <SectionDropdownMenu />
          <SectionContextMenu />
          <SectionCommand cmdOpen={cmdOpen} setCmdOpen={setCmdOpen} />
          <SectionTabs />
          <SectionCollapsible />
          <SectionCollapsiblePanelGroup />
          <SectionScrollArea />
          <SectionResizable />
          <SectionProgress progress={progress} setProgress={setProgress} />
          <SectionTooltip />
          <SectionSeparator />
          <SectionSkeleton />
          <SectionToast />
        </main>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      <Card variant="glass" className="p-5">
        {children}
      </Card>
    </section>
  );
}

/* ────────────────── 灰阶层级演示 ────────────────── */
function SectionLayers() {
  const layers = [
    { name: "L1 titlebar", rgb: "rgb(19,19,19)", token: "--titlebar", bg: "bg-titlebar text-titlebar-foreground" },
    { name: "L2 sidebar / background", rgb: "rgb(24,24,24)", token: "--background", bg: "bg-background" },
    { name: "L3 card / popover / input", rgb: "rgb(31,31,31)", token: "--card", bg: "bg-card" },
    { name: "L4 panel", rgb: "rgb(37,37,37)", token: "--panel", bg: "bg-panel text-panel-foreground" },
  ];
  return (
    <Section id="layers" title="🎨 灰阶层级（VS Code 风）">
      <div className="grid gap-3 md:grid-cols-2">
        {layers.map((l) => (
          <div
            key={l.name}
            className={`rounded-md border border-white/[0.06] p-4 ${l.bg}`}
          >
            <div className="text-eyebrow">{l.name}</div>
            <div className="mt-1 font-mono text-sm">{l.rgb}</div>
            <div className="text-xs text-muted-foreground">{l.token}</div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        玻璃面（Card / Dialog / Popover / Sheet）会叠加在 L2 主体之上，
        通过 backdrop-blur 自然融合不同灰阶。品牌蓝（钢蓝
        <span className="mx-1 inline-block h-2 w-2 rounded-full bg-primary align-middle" />
        ）作为唯一彩色高亮。
      </p>
    </Section>
  );
}

/* ────────────────── 工具调用业务组件 ────────────────── */
function SectionToolCall({ tools }: { tools: ToolCallData[] }) {
  return (
    <Section id="tool-call" title="🔧 ToolCallGroup（业务组件）">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          双层折叠：外层"Tool Calls 计数 + 状态 Tag"，内层每条调用左侧 2px
          状态色 stripe，展开显示参数 / 结果。
        </p>
        <ToolCallGroup tools={tools} />
        <p className="text-xs text-muted-foreground">
          API：<code className="font-mono text-foreground/80">{`<ToolCallGroup tools={...} defaultOpen itemDefaultOpen />`}</code>
        </p>
      </div>
    </Section>
  );
}

/* ────────────────── P0 ────────────────── */
function SectionButton() {
  return (
    <Section id="button" title="Button">
      <div className="flex flex-wrap items-center gap-3">
        <Button>主操作</Button>
        <Button variant="secondary">次操作</Button>
        <Button variant="destructive">删除</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button shape="pill">Pill 主操作</Button>
        <Button variant="secondary" shape="pill">
          Pill 次
        </Button>
        <Button disabled>Disabled</Button>
      </div>
    </Section>
  );
}

function SectionInput() {
  return (
    <Section id="input" title="Input / Textarea">
      <div className="grid gap-4 md:grid-cols-2">
        <Input placeholder="请输入内容…" />
        <Input placeholder="disabled" disabled />
        <Textarea
          placeholder="Chat 消息输入（min-h-80）…"
          className="md:col-span-2"
        />
      </div>
    </Section>
  );
}

function SectionCard() {
  return (
    <Section id="card" title="Card · default vs glass · CardSection">
      <div className="grid gap-4 md:grid-cols-2">
        <Card variant="default">
          <CardSection first>
            <div className="text-eyebrow">默认（实色卡）</div>
            <div className="mt-1 text-base font-medium">OpenClaw Gateway</div>
            <div className="mt-1 text-xs text-muted-foreground">运行中</div>
          </CardSection>
        </Card>
        <Card variant="glass">
          <CardSection first>
            <div className="text-eyebrow">玻璃面（A+D 整合）</div>
            <div className="mt-1 text-base font-medium">OpenClaw Gateway</div>
            <div className="mt-1 text-xs text-muted-foreground">运行中</div>
          </CardSection>
          <CardSection>
            <div className="text-eyebrow">已附着</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {["Blender 4.2", "Unreal 5.7"].map((d) => (
                <span
                  key={d}
                  className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-0.5 text-xs"
                >
                  {d}
                </span>
              ))}
            </div>
          </CardSection>
        </Card>
      </div>
    </Section>
  );
}

function SectionBadge() {
  return (
    <Section id="badge" title="Badge">
      <div className="flex flex-wrap gap-2">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </div>
    </Section>
  );
}

function SectionDialog() {
  return (
    <Section id="dialog" title="Dialog（弹层玻璃化）">
      <Dialog>
        <DialogTrigger asChild>
          <Button>打开对话框</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认操作</DialogTitle>
            <DialogDescription>
              此操作不可撤销，请确认后继续。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline">取消</Button>
            <Button variant="destructive">确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function SectionDropdownMenu() {
  return (
    <Section id="menus" title="DropdownMenu / ContextMenu">
      <div className="flex flex-wrap gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">下拉菜单</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>我的账户</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>个人资料</DropdownMenuItem>
            <DropdownMenuItem>设置</DropdownMenuItem>
            <DropdownMenuItem>退出登录</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Section>
  );
}

function SectionTabs() {
  return (
    <Section id="tabs" title="Tabs">
      <Tabs defaultValue="chat" className="w-full">
        <TabsList>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>
        <TabsContent value="chat">Chat 模块内容</TabsContent>
        <TabsContent value="skills">Skills 模块内容</TabsContent>
        <TabsContent value="system">System 模块内容</TabsContent>
      </Tabs>
    </Section>
  );
}

function SectionScrollArea() {
  return (
    <Section id="scroll-area" title="ScrollArea">
      <ScrollArea className="h-36 w-full rounded-md border border-white/[0.06] bg-panel/60 p-3">
        <div className="space-y-2 font-mono text-xs">
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i}>[log] line {i + 1} — openclaw bridge tick</div>
          ))}
        </div>
      </ScrollArea>
    </Section>
  );
}

function SectionTooltip() {
  return (
    <Section id="tooltip" title="Tooltip">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">悬停查看提示</Button>
        </TooltipTrigger>
        <TooltipContent>这是一条说明</TooltipContent>
      </Tooltip>
    </Section>
  );
}

function SectionSeparator() {
  return (
    <Section id="separator" title="Separator">
      <div>
        <div className="text-sm">上方内容</div>
        <Separator className="my-3" />
        <div className="text-sm">下方内容</div>
        <div className="mt-4 flex h-8 items-center gap-3">
          <span className="text-sm">左</span>
          <Separator orientation="vertical" />
          <span className="text-sm">右</span>
        </div>
      </div>
    </Section>
  );
}

function SectionSkeleton() {
  return (
    <Section id="skeleton" title="Skeleton（shimmer 扫光）">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
    </Section>
  );
}

function SectionToast() {
  return (
    <Section id="feedback" title="Toast (Sonner)">
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => toast("默认通知：已保存")}>默认</Button>
        <Button variant="secondary" onClick={() => toast.success("操作成功")}>
          Success
        </Button>
        <Button
          variant="destructive"
          onClick={() => toast.error("操作失败：端口被占用")}
        >
          Error
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.info("OpenClaw Gateway 正在启动")}
        >
          Info
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.warning("版本不匹配，建议更新")}
        >
          Warning
        </Button>
      </div>
    </Section>
  );
}

/* ────────────────── P2 ────────────────── */
function SectionAvatar() {
  return (
    <Section id="avatar" title="Avatar（默认 ring=primary）">
      <div className="flex items-center gap-4">
        <Avatar>
          <AvatarFallback>U</AvatarFallback>
        </Avatar>
        <Avatar ring="accent">
          <AvatarFallback>NX</AvatarFallback>
        </Avatar>
        <Avatar ring="none">
          <AvatarFallback>AI</AvatarFallback>
        </Avatar>
        <span className="text-xs text-muted-foreground">
          ring: primary（默认） · accent · none
        </span>
      </div>
    </Section>
  );
}

function SectionFormControls() {
  return (
    <Section id="form-controls" title="Checkbox / Switch / RadioGroup / Label">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox id="cb1" defaultChecked />
            <Label htmlFor="cb1">启用钉选</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="cb2" />
            <Label htmlFor="cb2">批量选择</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="sw1" defaultChecked />
            <Label htmlFor="sw1">高级模式</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="sw2" />
            <Label htmlFor="sw2">自动滚动</Label>
          </div>
        </div>
        <div>
          <Label className="mb-2 block">视图模式</Label>
          <RadioGroup defaultValue="card">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="list" id="r-list" />
              <Label htmlFor="r-list">📋 列表</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="card" id="r-card" />
              <Label htmlFor="r-card">🗂 卡片</Label>
            </div>
          </RadioGroup>
        </div>
      </div>
    </Section>
  );
}

function SectionSelect() {
  return (
    <Section id="select" title="Select">
      <div className="grid max-w-md gap-3">
        <Label>Model</Label>
        <Select defaultValue="gpt-4o">
          <SelectTrigger>
            <SelectValue placeholder="选择模型…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gpt-4o">gpt-4o</SelectItem>
            <SelectItem value="gpt-4">gpt-4</SelectItem>
            <SelectItem value="deepseek-chat">deepseek-chat</SelectItem>
            <SelectItem value="claude-3.5-sonnet">claude-3.5-sonnet</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </Section>
  );
}

function SectionSheet() {
  return (
    <Section id="sheet" title="Sheet（侧边抽屉，玻璃化）">
      <div className="flex flex-wrap gap-3">
        {(["right", "left", "top", "bottom"] as const).map((side) => (
          <Sheet key={side}>
            <SheetTrigger asChild>
              <Button variant="outline">从 {side} 滑入</Button>
            </SheetTrigger>
            <SheetContent side={side}>
              <SheetHeader>
                <SheetTitle>设置面板</SheetTitle>
                <SheetDescription>
                  Sheet 演示 — 从 {side} 方向滑入。
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        ))}
      </div>
    </Section>
  );
}

function SectionPopover() {
  return (
    <Section id="popover" title="Popover（玻璃化）">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">通知</Button>
        </PopoverTrigger>
        <PopoverContent>
          <div className="space-y-2">
            <div className="text-eyebrow">系统通知</div>
            <div className="text-sm">Blender 4.2 检测完成。</div>
            <Button size="sm">查看详情</Button>
          </div>
        </PopoverContent>
      </Popover>
    </Section>
  );
}

function SectionContextMenu() {
  return (
    <Section id="context-menu" title="ContextMenu（右键菜单）">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-white/[0.10] bg-panel/40 text-sm text-muted-foreground">
            在此区域右键
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>启用</ContextMenuItem>
          <ContextMenuItem>禁用</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem>配置</ContextMenuItem>
          <ContextMenuItem className="text-destructive">卸载</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </Section>
  );
}

function SectionCommand({
  cmdOpen,
  setCmdOpen,
}: {
  cmdOpen: boolean;
  setCmdOpen: (v: boolean) => void;
}) {
  return (
    <Section id="command" title="Command（⌘K 命令面板）">
      <div className="space-y-3">
        <div>
          <Button onClick={() => setCmdOpen(true)}>打开命令面板</Button>
        </div>
        <div className="rounded-md border border-white/[0.06]">
          <Command>
            <CommandInput placeholder="搜索 Skill / Tool / 文件…" />
            <CommandList>
              <CommandEmpty>无结果</CommandEmpty>
              <CommandGroup heading="Skills">
                <CommandItem>blender-modeling</CommandItem>
                <CommandItem>ue-blueprint</CommandItem>
              </CommandGroup>
              <CommandGroup heading="Tools">
                <CommandItem>create_cube</CommandItem>
                <CommandItem>set_material</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </div>

      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="全局搜索…" />
        <CommandList>
          <CommandEmpty>无结果</CommandEmpty>
          <CommandGroup heading="快捷">
            <CommandItem onSelect={() => setCmdOpen(false)}>新对话</CommandItem>
            <CommandItem onSelect={() => setCmdOpen(false)}>打开设置</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </Section>
  );
}

function SectionCollapsible() {
  return (
    <Section id="collapsible" title="Collapsible（单个折叠）">
      <Collapsible className="rounded-md border border-white/[0.06] bg-panel/40">
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-white/[0.03]">
            <span>📦 详细信息</span>
            <span className="text-muted-foreground">▼</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 border-t border-white/[0.05] p-3 text-xs">
          <div>这里是详细内容…</div>
        </CollapsibleContent>
      </Collapsible>
    </Section>
  );
}

function SectionCollapsiblePanelGroup() {
  return (
    <Section
      id="collapsible-panel-group"
      title="📚 CollapsiblePanelGroup（VS Code 风 · D 区资源管理）"
    >
      <p className="mb-3 text-xs text-muted-foreground">
        多个面板纵向堆叠，每个可独立折叠 / 展开。
        <strong className="text-foreground"> 多个展开时</strong>
        ，相邻面板间出现拖拽柄，可调整各自高度（试着拖动）。
        折叠的面板只占 28px header，不参与拖拽。
      </p>
      <div className="h-[480px] overflow-hidden rounded-md border border-white/[0.06] bg-panel/40">
        <CollapsiblePanelGroup autoSaveId="gallery-d-area">
          <CollapsiblePanel
            title="OUTLINE"
            badge={12}
            defaultOpen
            defaultSize={30}
            minSize={10}
            id="outline"
            order={1}
          >
            <ul className="space-y-0.5 font-mono text-[11px]">
              {[
                "📁 src/",
                "  📄 main.ts",
                "  📄 app.ts",
                "  📁 components/",
                "    📄 button.tsx",
                "    📄 card.tsx",
                "    📄 input.tsx",
                "  📁 lib/",
                "    📄 cn.ts",
                "  📄 globals.css",
                "📄 package.json",
                "📄 README.md",
              ].map((line) => (
                <li
                  key={line}
                  className="cursor-default rounded px-1.5 py-0.5 hover:bg-white/[0.05]"
                >
                  {line}
                </li>
              ))}
            </ul>
          </CollapsiblePanel>

          <CollapsiblePanel
            title="TIMELINE"
            defaultOpen={false}
            defaultSize={20}
            minSize={10}
            id="timeline"
            order={2}
          >
            <ul className="space-y-1 text-xs">
              {[
                ["10:24", "添加金属立方体"],
                ["10:18", "调整摄像机位置"],
                ["09:55", "导入 .blend 场景"],
              ].map(([t, txt]) => (
                <li key={t} className="flex gap-2">
                  <span className="font-mono text-muted-foreground">{t}</span>
                  <span>{txt}</span>
                </li>
              ))}
            </ul>
          </CollapsiblePanel>

          <CollapsiblePanel
            title="TOOL CALLS"
            badge={3}
            defaultOpen
            defaultSize={30}
            minSize={10}
            id="tool-calls"
            order={3}
          >
            <ul className="space-y-1 font-mono text-[11px]">
              {[
                ["✓", "create_cube", "312ms", "text-emerald-300"],
                ["✓", "set_location", "184ms", "text-emerald-300"],
                ["⚙", "create_material", "running", "text-sky-300 animate-pulse"],
              ].map(([s, name, t, cls]) => (
                <li
                  key={name}
                  className="flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-white/[0.05]"
                >
                  <span className={`${cls} w-3 text-center`}>{s}</span>
                  <span>{name}</span>
                  <span className="ml-auto text-muted-foreground">{t}</span>
                </li>
              ))}
            </ul>
          </CollapsiblePanel>

          <CollapsiblePanel
            title="MEMORY"
            badge={5}
            defaultOpen
            defaultSize={20}
            minSize={10}
            id="memory"
            order={4}
          >
            <ul className="space-y-1 text-xs">
              {[
                "用户偏好：使用米制单位",
                "最近 Skill：blender-modeling",
                "工作目录：D:/projects/scene-01",
              ].map((m) => (
                <li
                  key={m}
                  className="rounded border-l-2 border-primary/40 bg-primary/[0.04] px-2 py-0.5"
                >
                  {m}
                </li>
              ))}
            </ul>
          </CollapsiblePanel>
        </CollapsiblePanelGroup>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        默认展开 OUTLINE / TOOL CALLS / MEMORY 三个 → 之间出现拖拽柄；
        点击 TIMELINE header 展开后会出现第 4 块拖拽空间；
        autoSaveId 让用户拖完的尺寸下次自动恢复（localStorage）。
      </p>
    </Section>
  );
}

function SectionResizable() {
  return (
    <Section id="layout" title="Resizable（A/B/C/D 区域分隔）">
      <div className="h-48 overflow-hidden rounded-md border border-white/[0.06]">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={20} minSize={10}>
            <div className="flex h-full items-center justify-center bg-sidebar/60 p-4 text-sm text-sidebar-foreground">
              B 导航
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={55}>
            <div className="flex h-full items-center justify-center p-4 text-sm">
              C 内容
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={25} minSize={15}>
            <div className="flex h-full items-center justify-center bg-panel/60 p-4 text-sm text-panel-foreground">
              D 面板
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </Section>
  );
}

function SectionProgress({
  progress,
  setProgress,
}: {
  progress: number;
  setProgress: (v: number) => void;
}) {
  return (
    <Section id="progress" title="Progress">
      <div className="space-y-3">
        <Progress value={progress} />
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setProgress(Math.max(0, progress - 10))}
          >
            -10
          </Button>
          <span className="font-mono">{progress}%</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setProgress(Math.min(100, progress + 10))}
          >
            +10
          </Button>
        </div>
      </div>
    </Section>
  );
}
