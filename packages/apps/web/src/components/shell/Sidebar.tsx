"use client";

/**
 * Sidebar — B 区左侧导航
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §3
 *   B1 模块列表：Chat / 技能 / 系统 / 设置（4 项）
 *   B1-自定义：用户快捷链接（网页/目录/文件/脚本）
 *   B2 折叠按钮
 *   B3 用户区（头像 + 设置）
 *
 * 状态：collapsed (48px) ↔ expanded (200px)，由父组件 state 控制
 */

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Puzzle,
  Settings,
  Settings2,
  Terminal,
  Trash2,
  User,
} from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "@artifex-nexus/ui";

import { QuickLinkDialog } from "./QuickLinkDialog";
import {
  type QuickLink,
  type QuickLinkType,
  QUICK_LINK_TYPE_META,
  loadQuickLinks,
  saveQuickLinks,
  createQuickLink,
} from "../../lib/quickLinks";

export type ModuleId = "chat" | "skills" | "system" | "settings";

interface ModuleEntry {
  id: ModuleId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | string;
}

const MODULES: ModuleEntry[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "skills", label: "技能", icon: Puzzle, badge: 12 },
  { id: "system", label: "系统", icon: Terminal },
  { id: "settings", label: "设置", icon: Settings },
];

/** 点击自定义连接的处理 */
function handleQuickLinkClick(link: QuickLink) {
  if (link.type === "url") {
    window.open(link.target, "_blank");
    return;
  }

  // 文件夹/文件：通过 Tauri shell_open 打开
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tauri = (window as any).__TAURI__;
  if (tauri?.invoke) {
    tauri.invoke("plugin:shell|open", { path: link.target }).catch((e: unknown) => {
      alert(`无法打开: ${link.target}\n${e}`);
    });
  } else {
    // 浏览器环境：复制路径到剪贴板并提示
    navigator.clipboard.writeText(link.target).then(() => {
      alert(`路径已复制到剪贴板:\n${link.target}\n\n（在 Tauri 桌面应用中可直接打开）`);
    }).catch(() => {
      alert(`路径:\n${link.target}\n\n（在 Tauri 桌面应用中可直接打开）`);
    });
  }
}

interface SidebarProps {
  collapsed: boolean;
  currentModule: ModuleId;
  onSelect: (id: ModuleId) => void;
  onToggleCollapsed: () => void;
}

export function Sidebar({
  collapsed,
  currentModule,
  onSelect,
  onToggleCollapsed,
}: SidebarProps) {
  // 自定义连接状态
  const [quickLinks, setQuickLinks] = React.useState<QuickLink[]>([]);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingLink, setEditingLink] = React.useState<QuickLink | undefined>(
    undefined,
  );

  // mount 后加载
  React.useEffect(() => {
    setQuickLinks(loadQuickLinks());
  }, []);

  const persist = (links: QuickLink[]) => {
    setQuickLinks(links);
    saveQuickLinks(links);
  };

  // 添加
  const handleAdd = React.useCallback(() => {
    setEditingLink(undefined);
    setDialogOpen(true);
  }, []);

  // 编辑
  const handleEdit = (link: QuickLink) => {
    setEditingLink(link);
    setDialogOpen(true);
  };

  // 删除
  const handleDelete = (link: QuickLink) => {
    persist(quickLinks.filter((l) => l.id !== link.id));
  };

  // 复制路径
  const handleCopyPath = (link: QuickLink) => {
    navigator.clipboard.writeText(link.target).catch(() => {});
  };

  // 保存（新增或编辑）
  const handleSave = (
    data: Omit<QuickLink, "id" | "order"> & { id?: string },
  ) => {
    if (data.id) {
      // 编辑
      persist(
        quickLinks.map((l) =>
          l.id === data.id
            ? { ...l, type: data.type, name: data.name, target: data.target }
            : l,
        ),
      );
    } else {
      // 新增
      const link = createQuickLink(data.type, data.name, data.target, quickLinks);
      persist([...quickLinks, link]);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "flex h-full flex-col border-r border-border bg-sidebar text-sidebar-foreground",
        )}
      >
        {/* B1 模块列表 */}
        <nav className="flex flex-col gap-0.5 px-1.5 py-2">
          {MODULES.map((m) => (
            <ModuleItem
              key={m.id}
              module={m}
              active={currentModule === m.id}
              collapsed={collapsed}
              onClick={() => onSelect(m.id)}
            />
          ))}
        </nav>

        {/* 分隔线 */}
        <div className="mx-2 my-1 border-t border-border/60" />

        {/* B1-自定义：快捷链接 */}
        <div className="flex-1 overflow-y-auto px-1.5 py-1">
          {!collapsed && (
            <div className="mb-1 px-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              快捷
            </div>
          )}

          {/* 已有链接 */}
          {quickLinks.map((link) => (
            <QuickLinkItem
              key={link.id}
              link={link}
              collapsed={collapsed}
              onClick={() => handleQuickLinkClick(link)}
              onEdit={() => handleEdit(link)}
              onDelete={() => handleDelete(link)}
              onCopyPath={() => handleCopyPath(link)}
            />
          ))}

          {/* 添加按钮 */}
          <button
            type="button"
            className={cn(
              "flex h-8 w-full items-center rounded-md text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
              collapsed ? "justify-center" : "gap-2 px-2",
            )}
            onClick={handleAdd}
            title="添加快捷链接"
          >
            <Plus className="h-3.5 w-3.5" />
            {!collapsed && <span>添加</span>}
          </button>
        </div>

        {/* B2 折叠按钮 */}
        <div className="border-t border-border/60 px-1.5 py-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className={cn("h-8 w-full justify-center")}
                onClick={onToggleCollapsed}
                aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
              >
                {collapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">展开</TooltipContent>}
          </Tooltip>
        </div>

        {/* B3 用户区 */}
        <div
          className={cn(
            "flex items-center gap-2 border-t border-border/60 px-2 py-2",
            collapsed && "justify-center",
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="h-7 w-7 cursor-pointer" ring="primary">
                <AvatarFallback className="bg-primary/15 text-[10px] text-primary">
                  <User className="h-3.5 w-3.5" />
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">未登录</TooltipContent>}
          </Tooltip>
          {!collapsed && (
            <div className="flex-1 truncate text-xs">
              <div className="font-medium">未登录</div>
              <div className="text-[10px] text-muted-foreground">点击登录</div>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => onSelect("settings")}
                aria-label="设置"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">设置</TooltipContent>}
          </Tooltip>
        </div>
      </aside>

      {/* 添加/编辑对话框 */}
      <QuickLinkDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        existing={editingLink}
      />
    </TooltipProvider>
  );
}

// ─── 子组件 ────────────────────────────────────────────────────────────────

function ModuleItem({
  module,
  active,
  collapsed,
  onClick,
}: {
  module: ModuleEntry;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = module.icon;
  const button = (
    <button
      onClick={onClick}
      className={cn(
        "flex h-8 items-center rounded-md text-sm transition-colors",
        collapsed ? "w-full justify-center" : "w-full gap-2 px-2",
        active
          ? "bg-accent text-accent-foreground shadow-[inset_2px_0_0_0_hsl(var(--primary))]"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">{module.label}</span>
          {module.badge !== undefined && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {module.badge}
            </span>
          )}
        </>
      )}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">
          {module.label}
          {module.badge !== undefined && ` · ${module.badge}`}
        </TooltipContent>
      </Tooltip>
    );
  }
  return button;
}

/** 自定义连接行（含右键菜单） */
function QuickLinkItem({
  link,
  collapsed,
  onClick,
  onEdit,
  onDelete,
  onCopyPath,
}: {
  link: QuickLink;
  collapsed: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
}) {
  const meta = QUICK_LINK_TYPE_META[link.type];
  const typeIcon = getQuickLinkIcon(link.type);

  const row = (
    <button
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center rounded-md text-xs transition-colors hover:bg-accent/50 hover:text-foreground",
        collapsed ? "justify-center" : "gap-1.5 px-2",
      )}
      title={link.target}
    >
      {typeIcon}
      {!collapsed && (
        <span className="flex-1 truncate text-left">{link.name}</span>
      )}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="right">
          {meta.label}: {link.name}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem onClick={onClick}>
          <ExternalLink className="mr-2 h-3.5 w-3.5" />
          打开
        </ContextMenuItem>
        <ContextMenuItem onClick={onEdit}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          编辑
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyPath}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          复制路径
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** 根据类型返回图标 */
function getQuickLinkIcon(type: QuickLinkType): React.ReactNode {
  switch (type) {
    case "url":
      return <ExternalLink className="h-3 w-3 shrink-0 text-blue-400" />;
    case "folder":
      return <FolderOpen className="h-3 w-3 shrink-0 text-amber-400" />;
    case "file":
      return <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />;
    case "script":
      return <Play className="h-3 w-3 shrink-0 text-emerald-400" />;
  }
}
