"use client";

/**
 * CollapsiblePanelGroup / CollapsiblePanel — VS Code 风纵向折叠面板组
 *
 * 多个面板纵向堆叠，每个面板可独立折叠 / 展开 / 隐藏；
 * 支持双列模式（column='left'|'right'），支持嵌套 PanelGroup。
 *
 * 三态：展开（内容可见） → 折叠（仅 header 28px） → 隐藏（0px + 边缘标签）
 *
 * 技术栈：基于 react-resizable-panels v2。
 */

import * as React from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ChevronDown, ChevronRight, EyeOff, PanelLeft, PanelRight } from "lucide-react";

import { cn } from "../lib/cn";

/* ─────────────────────── Context ─────────────────────── */

/** 面板隐藏状态注册表：{ panelId → hidden } */
type HiddenRegistry = Record<string, boolean>;

interface GroupContextValue {
  containerHeight: number;
  headerHeight: number;
  /** 父组命令式 panel ref（用于空间转移） */
  outerPanelRef?: React.RefObject<ImperativePanelHandle | null>;
  /** 隐藏态注册表 */
  hiddenRegistry: HiddenRegistry;
  setHidden: (id: string, hidden: boolean) => void;
  /** 列归属注册表 */
  columnRegistry: Record<string, "left" | "right">;
  setColumn: (id: string, col: "left" | "right") => void;
  /** 是否启用双列 */
  dualColumn: boolean;
  /** 是否启用隐藏 */
  hideable: boolean;
}

const GroupContext = React.createContext<GroupContextValue | null>(null);

export function usePanelGroupContext() {
  const ctx = React.useContext(GroupContext);
  if (!ctx) {
    throw new Error("usePanelGroupContext must be used inside <CollapsiblePanelGroup>");
  }
  return ctx;
}

/* ─────────────────────── Group ─────────────────────── */

export interface CollapsiblePanelGroupProps {
  /** 唯一 id，用于 react-resizable-panels 持久化布局（localStorage） */
  autoSaveId?: string;
  /** 子节点（必须是 CollapsiblePanel 或 CollapsiblePanelGroup） */
  children: React.ReactNode;
  className?: string;
  /** 布局方向，默认 vertical */
  direction?: "vertical" | "horizontal";
  /** 是否启用双列模式 */
  dualColumn?: boolean;
  /** 双列默认左列宽度百分比 */
  defaultColumnRatio?: number;
  /** 列归属初始值 */
  columnAssignments?: Record<string, "left" | "right">;
  /** 列归属变更回调 */
  onColumnChange?: (assignments: Record<string, "left" | "right">) => void;
  /** 外部 panel ref（嵌套时父组传入，用于折叠时空间转移） */
  outerPanelRef?: React.RefObject<ImperativePanelHandle | null>;
  /** 是否启用隐藏功能 */
  hideable?: boolean;
}

export function CollapsiblePanelGroup({
  autoSaveId,
  children,
  className,
  direction = "vertical",
  dualColumn = false,
  defaultColumnRatio = 40,
  columnAssignments: initialColumnAssignments,
  onColumnChange,
  outerPanelRef,
  hideable = true,
}: CollapsiblePanelGroupProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = React.useState(400);
  const HEADER_HEIGHT = 28;

  // 隐藏状态（由子 panel 注册）
  const [hiddenRegistry, setHiddenRegistry] = React.useState<HiddenRegistry>({});
  // 列归属（由子 panel 注册，外部传入仅用于初始值）
  const [columnRegistry, setColumnRegistry] = React.useState<Record<string, "left" | "right">>(
    initialColumnAssignments || {},
  );

  const setHidden = React.useCallback((id: string, hidden: boolean) => {
    setHiddenRegistry((prev) => ({ ...prev, [id]: hidden }));
  }, []);

  // setColumn — 仅更新内部状态，不调用外部回调（避免 render 阶段 setState）
  const setColumn = React.useCallback((id: string, col: "left" | "right") => {
    setColumnRegistry((prev) => {
      if (prev[id] === col) return prev; // 值相同则跳过重渲染
      return { ...prev, [id]: col };
    });
  }, []);

  // 列归属变化时，单向同步给父组件（useEffect 在 render 后执行，安全）
  React.useEffect(() => {
    if (Object.keys(columnRegistry).length > 0) {
      onColumnChange?.(columnRegistry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnRegistry]);

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

  const ctxValue = React.useMemo<GroupContextValue>(() => ({
    containerHeight,
    headerHeight: HEADER_HEIGHT,
    outerPanelRef,
    hiddenRegistry,
    setHidden,
    columnRegistry,
    setColumn,
    dualColumn,
    hideable,
  }), [containerHeight, outerPanelRef, hiddenRegistry, setHidden, columnRegistry, setColumn, dualColumn, hideable]);

  // 拆分 children，过滤隐藏的面板
  const allPanels = React.Children.toArray(children).filter(Boolean);
  const visiblePanels = allPanels.filter((child) => {
    if (!React.isValidElement(child)) return true;
    // CollapsiblePanelGroup 嵌套子组始终可见
    if ((child.type as any)?.displayName === "CollapsiblePanelGroup") return true;
    const panelId = (child.props as any)?.id;
    if (panelId && hiddenRegistry[panelId]) return false;
    return true;
  });

  // ── 双列模式布局 ──
  if (dualColumn && direction === "vertical") {
    return renderDualColumnLayout();
  }

  return (
    <GroupContext.Provider value={ctxValue}>
      <div
        ref={containerRef}
        className={cn("flex h-full w-full flex-col", className)}
      >
        <PanelGroup
          key={visiblePanels.map(p => (p as React.ReactElement)?.props?.id).filter(Boolean).join(",")}
          direction={direction}
          className="flex-1"
        >
          {visiblePanels.map((p, i) => {
            const panelId = (p as React.ReactElement)?.props?.id;
            return (
              <React.Fragment key={panelId || i}>
                {i > 0 && <CollapsibleResizeHandle direction={direction} />}
                {p}
              </React.Fragment>
            );
          })}
        </PanelGroup>

        {/* 隐藏面板的标签指示器 */}
        <HiddenTabBar panels={allPanels} hiddenRegistry={hiddenRegistry} ctx={ctxValue} />
      </div>
    </GroupContext.Provider>
  );

  /** 双列水平 + 垂直嵌套布局 */
  function renderDualColumnLayout() {
    const leftPanels: React.ReactElement[] = [];
    const rightPanels: React.ReactElement[] = [];

    allPanels.forEach((child) => {
      if (!React.isValidElement(child)) return;
      const panelId = (child.props as any)?.id;
      if (!panelId) { rightPanels.push(child as React.ReactElement); return; }
      const col = columnRegistry[panelId] || "left";
      if (col === "left") leftPanels.push(child as React.ReactElement);
      else rightPanels.push(child as React.ReactElement);
    });

    // 过滤隐藏面板——隐藏即释放空间给展开面板
    const leftVisible = leftPanels.filter((p) => {
      const pid = p.props?.id;
      return !pid || !hiddenRegistry[pid];
    });
    const rightVisible = rightPanels.filter((p) => {
      const pid = p.props?.id;
      return !pid || !hiddenRegistry[pid];
    });

    const hasLeft = leftVisible.length > 0;
    const hasRight = rightVisible.length > 0;

    // 计算列标识 key — 面板移列时强制 PanelGroup 重新初始化
    const leftKey = leftVisible.map(p => (p.props as any)?.id).filter(Boolean).join(",");
    const rightKey = rightVisible.map(p => (p.props as any)?.id).filter(Boolean).join(",");

    // 单列退化：全在右列则只渲染右列
    if (!hasLeft && hasRight) {
      return (
        <GroupContext.Provider value={ctxValue}>
          <div ref={containerRef} className={cn("flex h-full w-full flex-col", className)}>
            <PanelGroup key={rightVisible.map(p => (p.props as any)?.id).filter(Boolean).join(",")} direction="vertical" className="flex-1">
              {rightVisible.map((p, i) => {
                const panelId = (p.props as any)?.id;
                return (
                  <React.Fragment key={panelId || i}>
                    {i > 0 && <CollapsibleResizeHandle direction="vertical" />}
                    {p}
                  </React.Fragment>
                );
              })}
            </PanelGroup>
            <HiddenTabBar panels={allPanels} hiddenRegistry={hiddenRegistry} ctx={ctxValue} />
          </div>
        </GroupContext.Provider>
      );
    }

    // 双列模式
    return (
      <GroupContext.Provider value={ctxValue}>
        <div ref={containerRef} className={cn("flex h-full w-full flex-col", className)}>
          <PanelGroup key={`dual-${leftKey}-${rightKey}`} direction="horizontal" className="flex-1">
            {hasLeft && (
              <Panel key={`left-${leftKey}`} defaultSize={defaultColumnRatio} minSize={15}>
                <PanelGroup direction="vertical" className="h-full">
                  {leftVisible.map((p, i) => {
                    const panelId = (p.props as any)?.id;
                    return (
                      <React.Fragment key={panelId || i}>
                        {i > 0 && <CollapsibleResizeHandle direction="vertical" />}
                        {p}
                      </React.Fragment>
                    );
                  })}
                </PanelGroup>
              </Panel>
            )}
            {hasLeft && hasRight && (
              <PanelResizeHandle
                className={cn(
                  "relative flex w-px items-center justify-center bg-border",
                  "hover:bg-primary/40 data-[resize-handle-state=hover]:bg-primary/40 data-[resize-handle-state=drag]:bg-primary",
                  "after:absolute after:inset-y-0 after:-left-1 after:w-2 after:cursor-col-resize",
                )}
              />
            )}
            {hasRight && (
              <Panel key={`right-${rightKey}`} defaultSize={hasLeft ? 100 - defaultColumnRatio : 100} minSize={15}>
                <PanelGroup direction="vertical" className="h-full">
                  {rightVisible.map((p, i) => {
                    const panelId = (p.props as any)?.id;
                    return (
                      <React.Fragment key={panelId || i}>
                        {i > 0 && <CollapsibleResizeHandle direction="vertical" />}
                        {p}
                      </React.Fragment>
                    );
                  })}
                </PanelGroup>
              </Panel>
            )}
          </PanelGroup>
          <HiddenTabBar panels={allPanels} hiddenRegistry={hiddenRegistry} ctx={ctxValue} />
        </div>
      </GroupContext.Provider>
    );
  }
}

CollapsiblePanelGroup.displayName = "CollapsiblePanelGroup";

/** 内部使用：折叠面板间的拖拽柄 */
function CollapsibleResizeHandle({ direction }: { direction?: "vertical" | "horizontal" }) {
  const isVertical = direction !== "horizontal";
  return (
    <PanelResizeHandle
      className={cn(
        isVertical
          ? cn(
              "relative flex h-px w-full items-center justify-center",
              "after:absolute after:inset-x-0 after:-top-1 after:h-2 after:cursor-row-resize",
            )
          : cn(
              "relative flex w-px items-center justify-center",
              "after:absolute after:inset-y-0 after:-left-1 after:w-2 after:cursor-col-resize",
            ),
        "bg-border transition-colors",
        "hover:bg-primary/40 data-[resize-handle-state=hover]:bg-primary/40 data-[resize-handle-state=drag]:bg-primary",
      )}
    />
  );
}

/* ─────────────────────── Hidden Tab Bar ─────────────────────── */

/** 在面板组底部渲染隐藏面板的恢复标签 */
function HiddenTabBar({
  panels,
  hiddenRegistry,
  ctx,
}: {
  panels: React.ReactNode[];
  hiddenRegistry: HiddenRegistry;
  ctx: GroupContextValue;
}) {
  if (!ctx.hideable) return null;

  const hiddenPanels = panels.filter((child) => {
    if (!React.isValidElement(child)) return false;
    const panelId = (child.props as any)?.id;
    return panelId && hiddenRegistry[panelId];
  });

  if (hiddenPanels.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap gap-px border-t border-border bg-panel px-1 py-px">
      {hiddenPanels.map((child) => {
        if (!React.isValidElement(child)) return null;
        const props = child.props as any;
        return (
          <button
            key={props.id}
            className={cn(
              "flex h-5 cursor-pointer items-center gap-1 rounded px-1.5 text-[10px]",
              "bg-muted/30 text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground",
            )}
            onClick={() => ctx.setHidden(props.id, false)}
            title={`显示 ${props.title}`}
          >
            {props.icon}
            <span className="truncate max-w-[80px] uppercase tracking-[0.06em]">
              {props.title}
            </span>
          </button>
        );
      })}
    </div>
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

  // ── 隐藏功能 ──
  /** 是否可隐藏（需要 Group 启用 hideable） */
  hideable?: boolean;
  /** 受控隐藏态 */
  hidden?: boolean;
  onHiddenChange?: (hidden: boolean) => void;

  // ── 双列模式 ──
  /** 双列模式下列归属：'left' | 'right'，默认 'right' */
  column?: "left" | "right";
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
    hideable: panelHideable,
    hidden: controlledHidden,
    onHiddenChange,
    column = "left",
  },
  ref,
) {
  const ctx = React.useContext(GroupContext);
  if (!ctx) {
    throw new Error(
      "<CollapsiblePanel> must be used inside <CollapsiblePanelGroup>",
    );
  }

  const canHide = ctx.hideable && (panelHideable !== false);

  // ── 列归属注册 ──
  // 只在 registry 中尚无此 id 时写入默认列，防止 remount（列切换导致）
  // 时用默认 column="left" 覆盖用户选择的结果
  React.useEffect(() => {
    if (id && ctx.dualColumn && !(id in ctx.columnRegistry)) {
      ctx.setColumn(id, column);
    }
  }, [id, column, ctx.dualColumn, ctx.setColumn, ctx.columnRegistry]);

  // ── 展开/折叠态（持久化到 localStorage）──
  const panelStorageKey = React.useMemo(() => id ? `artifex.shell.dpanel.${id}` : "", [id]);
  const loadPersistentState = React.useCallback(<T,>(key: string, field: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw)[field] ?? fallback) : fallback;
    } catch { return fallback; }
  }, []);
  const savePersistentState = React.useCallback((openVal: boolean, hiddenVal: boolean) => {
    if (!panelStorageKey) return;
    try { localStorage.setItem(panelStorageKey, JSON.stringify({ open: openVal, hidden: hiddenVal })); } catch {}
  }, [panelStorageKey]);

  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(() =>
    panelStorageKey ? loadPersistentState<boolean>(panelStorageKey, "open", defaultOpen) : defaultOpen
  );
  const open = controlledOpen ?? uncontrolledOpen;

  // defaultOpen 变化（如预览从无到有）→ 自动展开面板
  const prevDefaultOpenRef = React.useRef(defaultOpen);
  React.useEffect(() => {
    if (controlledOpen !== undefined) return;
    if (defaultOpen && !prevDefaultOpenRef.current) {
      setUncontrolledOpen(true);
    }
    prevDefaultOpenRef.current = defaultOpen;
  }, [defaultOpen, controlledOpen]);

  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
      savePersistentState(next, hidden ?? false);
    }
  };

  // ── 隐藏态持久化 ──
  // 源：localStorage → fallback: ctx.hiddenRegistry（HiddenTabBar 通过 ctx 恢复）
  const [localHidden, setLocalHidden] = React.useState(() =>
    panelStorageKey ? loadPersistentState<boolean>(panelStorageKey, "hidden", false) : false
  );
  // context 作为 secondary sync
  const ctxHidden = React.useMemo(() => id ? ctx.hiddenRegistry[id] === true : false, [id, ctx.hiddenRegistry]);
  const hidden = controlledHidden ?? (localHidden || ctxHidden);

  // 启动时将 localStorage 隐藏态同步到 context 的 hiddenRegistry
  React.useEffect(() => {
    if (id && localHidden) {
      ctx.setHidden(id, true);
    }
  }, []); // 仅 mount 时执行一次

  const setHidden = (next: boolean) => {
    onHiddenChange?.(next);
    if (controlledHidden === undefined) {
      setLocalHidden(next);
      savePersistentState(open, next);
      if (id && !next) ctx.setHidden(id, false); // 从隐藏恢复时同步 ctx
      if (id && next) ctx.setHidden(id, true);
    }
  };

  const panelRef = React.useRef<ImperativePanelHandle>(null);
  React.useImperativeHandle(ref, () => panelRef.current!, []);

  // ── 折叠百分比（恒定值，不随 containerHeight 变化，防止触发 react-resizable-panels 约束重算）──
  const COLLAPSED_PCT = 4;
  const collapsedSize = COLLAPSED_PCT;

  // ── 声明式尺寸锁定 ──
  // 展开态:  minSize=minSize,  maxSize=undefined → 可拖拽
  // 折叠态:  minSize=COLLAPSED_PCT, maxSize=COLLAPSED_PCT → 锁定 header 高度
  const effectiveMinSize = open ? minSize : COLLAPSED_PCT;
  const effectiveMaxSize = open ? undefined : COLLAPSED_PCT;

  const toggle = () => {
    if (hidden) {
      // 从隐藏恢复 → 回到折叠态（header 可见，内容折叠）
      setHidden(false);
      setOpen(false);
    } else {
      setOpen(!open);
    }
  };

  const handleHide = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // 先折叠再隐藏，恢复时回到折叠态
    setOpen(false);
    setHidden(true);
  };

  // 当前列归属
  const currentColumn = id && ctx.dualColumn ? (ctx.columnRegistry[id] || column) : column;

  return (
    <Panel
      ref={panelRef}
      collapsible
      collapsedSize={collapsedSize}
      defaultSize={open ? defaultSize : COLLAPSED_PCT}
      minSize={effectiveMinSize}
      maxSize={effectiveMaxSize}
      order={order}
      className={cn(
        "flex flex-col overflow-hidden",
        "border-y border-border first:border-t-0 last:border-b-0",
        hidden && "border-0",
        className,
      )}
      data-collapsed={!open || undefined}
      data-hidden={hidden || undefined}
    >
      {!hidden && (
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
          <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/90">
            {title}
          </span>
          {badge !== undefined && (
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              {badge}
            </span>
          )}

          {/* Header 右侧操作区 */}
          <span
            className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* 双列切换按钮 */}
            {ctx.dualColumn && (
              <button
                className="h-4 w-4 rounded p-0 hover:bg-accent/40"
                onClick={(e) => {
                  e.stopPropagation();
                  if (id) {
                    const newCol = currentColumn === "left" ? "right" : "left";
                    ctx.setColumn(id, newCol);
                  }
                }}
                title={currentColumn === "left" ? "移到右列" : "移到左列"}
              >
                {currentColumn === "left" ? (
                  <PanelRight className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <PanelLeft className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            )}

            {/* 隐藏按钮 */}
            {canHide && (
              <button
                className="h-4 w-4 rounded p-0 hover:bg-accent/40"
                onClick={handleHide}
                title="隐藏面板"
              >
                <EyeOff className="h-3 w-3 text-muted-foreground" />
              </button>
            )}

            {/* 用户自定义 actions */}
            {open && actions}
          </span>
        </div>
      )}

      {/* Body — 仅展开时占空间 */}
      {open && !hidden && (
        <div
          className={cn(
            "min-h-0 flex-1 overflow-auto",
            bodyClassName ?? "px-2 pt-0.5 pb-1",
          )}
        >
          {children}
        </div>
      )}
    </Panel>
  );
});
CollapsiblePanel.displayName = "CollapsiblePanel";
