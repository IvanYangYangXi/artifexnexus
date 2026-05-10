"use client";

/**
 * CollapsiblePanelGroup / CollapsiblePanel — VS Code 风纵向折叠面板组
 *
 * 多个面板纵向堆叠，每个面板可独立折叠 / 展开；
 * 多个展开时，相邻面板间出现拖拽柄，可调高度。
 * 折叠的面板只占 header 高度（约 28px），不参与拖拽。
 *
 * 设计参考：VS Code 资源管理器栏（OUTLINE / TIMELINE / NPM SCRIPTS）。
 *
 * 技术栈：基于 react-resizable-panels v2 的 collapsible/collapsedSize/onCollapse/onExpand 原生能力。
 *
 * 关键算法：
 *   - collapsedSize 在 v2 中是百分比；为了让折叠态精准等于 header 高度（28px），
 *     用 ResizeObserver 监听容器实际高度，动态计算 collapsedSize = 28 / containerHeight * 100。
 *   - 折叠态隐藏拖拽柄（`data-collapsed="true"` 时 ResizableHandle 不显示）。
 */
import * as React from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "../lib/cn";

/* ─────────────────────── Group ─────────────────────── */

export interface CollapsiblePanelGroupProps {
  /** 唯一 id，用于 react-resizable-panels 持久化布局（localStorage） */
  autoSaveId?: string;
  /** 子节点（必须是 CollapsiblePanel） */
  children: React.ReactNode;
  className?: string;
}

interface GroupContextValue {
  /** 容器像素高度（实时） */
  containerHeight: number;
  /** 默认 header 高度（px） */
  headerHeight: number;
}

const GroupContext = React.createContext<GroupContextValue | null>(null);

export function CollapsiblePanelGroup({
  autoSaveId,
  children,
  className,
}: CollapsiblePanelGroupProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = React.useState(400);
  const HEADER_HEIGHT = 28;

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const h = e.contentRect.height;
        if (h > 0) setContainerHeight(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 把孩子拆分出来，在每两个 panel 之间插入 ResizeHandle（不在头尾加）
  const panels = React.Children.toArray(children).filter(Boolean);

  return (
    <GroupContext.Provider
      value={{ containerHeight, headerHeight: HEADER_HEIGHT }}
    >
      <div
        ref={containerRef}
        className={cn("flex h-full w-full flex-col", className)}
      >
        <PanelGroup
          direction="vertical"
          autoSaveId={autoSaveId}
          className="flex-1"
        >
          {panels.map((p, i) => (
            <React.Fragment key={i}>
              {i > 0 && <CollapsibleResizeHandle />}
              {p}
            </React.Fragment>
          ))}
        </PanelGroup>
      </div>
    </GroupContext.Provider>
  );
}

/** 内部使用：折叠面板间的拖拽柄；可在折叠态视觉淡化。 */
function CollapsibleResizeHandle() {
  return (
    <PanelResizeHandle
      className={cn(
        "relative flex h-px w-full items-center justify-center",
        "bg-border transition-colors",
        "hover:bg-primary/40 data-[resize-handle-state=hover]:bg-primary/40 data-[resize-handle-state=drag]:bg-primary",
        "after:absolute after:inset-x-0 after:-top-1 after:h-2 after:cursor-row-resize",
      )}
    />
  );
}

/* ─────────────────────── Panel ─────────────────────── */

export interface CollapsiblePanelProps {
  /** 面板标题（VS Code 风全大写显示） */
  title: string;
  /** 左侧图标 */
  icon?: React.ReactNode;
  /** 右侧附加角标（如计数、状态点） */
  badge?: React.ReactNode;
  /** 右侧操作区（按钮组，仅展开时显示） */
  actions?: React.ReactNode;

  /** 默认是否展开 */
  defaultOpen?: boolean;
  /** 受控展开态 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  /** 默认展开高度（百分比），传入 react-resizable-panels */
  defaultSize?: number;
  /** 展开时最小高度（百分比） */
  minSize?: number;
  /** 用于 autoSave 的固定 id（建议传） */
  id?: string;
  /** 渲染顺序（多个 panel 同 group 时） */
  order?: number;

  children?: React.ReactNode;
  className?: string;
  /** body padding，默认 p-2；设为 false 完全无 padding */
  bodyClassName?: string;
}

export const CollapsiblePanel = React.forwardRef<
  ImperativePanelHandle,
  CollapsiblePanelProps
>(function CollapsiblePanel(
  {
    title,
    icon,
    badge,
    actions,
    defaultOpen = true,
    open: controlledOpen,
    onOpenChange,
    defaultSize = 30,
    minSize = 10,
    id,
    order,
    children,
    className,
    bodyClassName,
  },
  ref,
) {
  const ctx = React.useContext(GroupContext);
  if (!ctx) {
    throw new Error(
      "<CollapsiblePanel> must be used inside <CollapsiblePanelGroup>",
    );
  }

  // collapsedSize 百分比 = headerHeight / containerHeight * 100
  // 容器高度太小会导致 collapsedSize > minSize，react-resizable-panels 会拒绝；做下限保护。
  const collapsedSize = React.useMemo(() => {
    if (!ctx.containerHeight) return 5;
    const pct = (ctx.headerHeight / ctx.containerHeight) * 100;
    return Math.max(2, Math.min(pct, 20));
  }, [ctx.containerHeight, ctx.headerHeight]);

  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setUncontrolledOpen(next);
  };

  const panelRef = React.useRef<ImperativePanelHandle>(null);
  React.useImperativeHandle(ref, () => panelRef.current!, []);

  // 同步外部 open 态 → react-resizable-panels imperative API
  React.useEffect(() => {
    const p = panelRef.current;
    if (!p) return;
    if (open && p.isCollapsed()) {
      p.expand();
    } else if (!open && p.isExpanded()) {
      p.collapse();
    }
  }, [open]);

  const toggle = () => setOpen(!open);

  return (
    <Panel
      ref={panelRef}
      collapsible
      collapsedSize={collapsedSize}
      defaultSize={defaultOpen ? defaultSize : collapsedSize}
      minSize={minSize}
      id={id}
      order={order}
      onCollapse={() => {
        if (open) setOpen(false);
      }}
      onExpand={() => {
        if (!open) setOpen(true);
      }}
      className={cn(
        "flex flex-col overflow-hidden",
        "border-y border-border first:border-t-0 last:border-b-0",
        className,
      )}
      data-collapsed={!open || undefined}
    >
      {/* Header — 整行点击切换。
       * 用 <div role="button"> 而非 <button>，以避免 actions 槽里嵌真按钮造成
       * "<button> cannot be a descendant of <button>" 的 hydration 报错。 */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className={cn(
          "group/header flex h-7 w-full shrink-0 cursor-pointer items-center gap-1.5 px-2 text-left",
          "transition-colors hover:bg-white/[0.04]",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
          "select-none",
        )}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {icon && (
          <span className="shrink-0 text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">
            {icon}
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/90">
          {title}
        </span>
        {badge !== undefined && (
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
            {badge}
          </span>
        )}
        {open && actions ? (
          <span
            className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100"
            // 阻止 actions 内的点击冒泡到 header（避免触发 toggle）
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {actions}
          </span>
        ) : null}
      </div>

      {/* Body — 仅展开时占空间 */}
      {open && (
        <div
          className={cn(
            "min-h-0 flex-1 overflow-auto",
            bodyClassName ?? "p-2",
          )}
        >
          {children}
        </div>
      )}
    </Panel>
  );
});
CollapsiblePanel.displayName = "CollapsiblePanel";
