"use client";

/**
 * ToolCallGroup / ToolCallItem — 工具调用双层折叠
 *
 * 业务组件，用于 Chat 主界面 + Agent log 的工具调用渲染。
 * 视觉来自 STORY-0031 风格 E（A+D 整合）的最终方案。
 *
 * 双层结构：
 *   - 外层 ToolCallGroup：连续多次工具调用合并显示，标题"🔧 N 次工具调用"
 *     右侧 Tag 汇总 done / running / error 计数。
 *   - 内层 ToolCallItem：单次调用，左侧 2px 状态色 stripe，
 *     展开后显示 args / result（黑底 mono 代码块）。
 *
 * 受控 / 非受控两套 API：
 *   - groupOpen / onGroupOpenChange ⇒ 外层折叠
 *   - 内层项默认非受控；如要受控，外部包一层自管 state
 *
 * 设计参考：
 *   - artclaw_bridge ToolCallWidget / ToolCallGroupWidget（双层折叠雏形）
 *   - docs/specs/ui/web-chat-structure.md §C 工具调用渲染
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "../lib/cn";

/* ─────────────────────── Types ─────────────────────── */

export type ToolCallStatus = "running" | "done" | "error";

export interface ToolCallData {
  /** 调用唯一 ID（与 contracts 对齐） */
  id: string;
  /** 工具名（带 mcp_ 前缀的完整名） */
  name: string;
  /** 状态机当前态 */
  status: ToolCallStatus;
  /** 完成时长（ms），running 时未知 */
  durationMs?: number;
  /** 调用参数（JSON 可序列化） */
  args?: Record<string, unknown>;
  /** 执行结果（纯文本或序列化结果） */
  result?: string;
  /** 错误信息（status=error 时） */
  error?: string;
}

/* ─────────────────────── Tag（状态统计） ─────────────────────── */

interface TagProps {
  color: "emerald" | "sky" | "rose";
  pulse?: boolean;
  children: React.ReactNode;
}

function StatusTag({ color, pulse, children }: TagProps) {
  const styles = {
    emerald: {
      box: "border-emerald-400/30 bg-emerald-500/[0.10] text-emerald-300",
      dot: "bg-emerald-400",
    },
    sky: {
      box: "border-sky-400/35 bg-sky-500/[0.10] text-sky-300",
      dot: "bg-sky-400",
    },
    rose: {
      box: "border-rose-400/35 bg-rose-500/[0.10] text-rose-300",
      dot: "bg-rose-400",
    },
  } as const;
  const s = styles[color];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9px] leading-none",
        s.box,
      )}
    >
      {pulse && <span className={cn("h-1 w-1 rounded-full animate-pulse", s.dot)} />}
      {children}
    </span>
  );
}

/* ─────────────────────── ToolCallItem（内层） ─────────────────────── */

export interface ToolCallItemProps {
  tool: ToolCallData;
  /** 默认折叠 */
  defaultOpen?: boolean;
  className?: string;
}

const STATUS_STYLES = {
  running: {
    border: "border-sky-400/35",
    bg: "bg-sky-500/[0.06]",
    hover: "hover:bg-sky-500/[0.10]",
    stripe: "bg-sky-400 animate-pulse",
    text: "text-sky-300",
    label: "running",
  },
  done: {
    border: "border-emerald-400/30",
    bg: "bg-emerald-500/[0.05]",
    hover: "hover:bg-emerald-500/[0.08]",
    stripe: "bg-emerald-400",
    text: "text-emerald-300/95",
    label: "done",
  },
  error: {
    border: "border-rose-400/40",
    bg: "bg-rose-500/[0.07]",
    hover: "hover:bg-rose-500/[0.12]",
    stripe: "bg-rose-400",
    text: "text-rose-300",
    label: "error",
  },
} as const;

export const ToolCallItem = React.forwardRef<HTMLDivElement, ToolCallItemProps>(
  ({ tool, defaultOpen = false, className }, ref) => {
    const [open, setOpen] = React.useState(defaultOpen);
    const s = STATUS_STYLES[tool.status];

    return (
      <div
        ref={ref}
        className={cn(
          "relative overflow-hidden rounded-[6px] border backdrop-blur-md",
          s.border,
          s.bg,
          className,
        )}
      >
        {/* 左侧 2px 状态色 stripe */}
        <span
          className={cn(
            "absolute left-0 top-0.5 h-[calc(100%-0.25rem)] w-[2px] rounded-full",
            s.stripe,
          )}
        />
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(!open);
            }
          }}
          className={cn(
            "flex w-full cursor-pointer items-center gap-1.5 pl-2.5 pr-2 py-1 text-left transition",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
            s.hover,
          )}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span className="font-mono text-[11px] leading-none tracking-tight">
            {tool.name}
          </span>
          <span
            className={cn(
              "ml-auto rounded-full border px-1.5 py-px font-mono text-[9px] leading-none",
              s.border,
              s.text,
            )}
          >
            {tool.status === "running"
              ? "running…"
              : tool.durationMs
                ? `${tool.durationMs}ms`
                : s.label}
          </span>
        </div>
        {open && (
          <div className="border-t border-white/[0.05] bg-black/20 p-2 font-mono text-[11px]">
            {tool.args && (
              <>
                <div className="mb-1 text-eyebrow">参数</div>
                <pre className="whitespace-pre-wrap break-all text-foreground/90">
                  {JSON.stringify(tool.args, null, 2)}
                </pre>
              </>
            )}
            {tool.result && (
              <>
                <div className={cn("mb-1 text-eyebrow", tool.args && "mt-2")}>
                  结果
                </div>
                <pre className="whitespace-pre-wrap break-all text-emerald-300/90">
                  {tool.result}
                </pre>
              </>
            )}
            {tool.error && (
              <>
                <div className={cn("mb-1 text-eyebrow", (tool.args || tool.result) && "mt-2")}>
                  错误
                </div>
                <pre className="whitespace-pre-wrap break-all text-rose-300/90">
                  {tool.error}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    );
  },
);
ToolCallItem.displayName = "ToolCallItem";

/* ─────────────────────── ToolCallGroup（外层） ─────────────────────── */

export interface ToolCallGroupProps {
  /** 工具调用列表（连续多次合并显示） */
  tools: ToolCallData[];
  /** 受控外层折叠 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 非受控初始态，默认展开 */
  defaultOpen?: boolean;
  /** 内层项默认是否展开 */
  itemDefaultOpen?: boolean;
  className?: string;
}

export const ToolCallGroup = React.forwardRef<
  HTMLDivElement,
  ToolCallGroupProps
>(
  (
    {
      tools,
      open: controlledOpen,
      onOpenChange,
      defaultOpen = true,
      itemDefaultOpen = false,
      className,
    },
    ref,
  ) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
    const open = controlledOpen ?? uncontrolledOpen;
    const setOpen = (next: boolean) => {
      onOpenChange?.(next);
      if (controlledOpen === undefined) setUncontrolledOpen(next);
    };

    const counts = React.useMemo(() => {
      return tools.reduce(
        (acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }),
        {} as Record<ToolCallStatus, number>,
      );
    }, [tools]);

    return (
      <div ref={ref} className={cn("glass-surface-inner overflow-hidden", className)}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(!open);
            }
          }}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition hover:bg-white/[0.03]",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
          )}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm leading-none">🔧</span>
          <span className="text-eyebrow">Tool Calls</span>
          <span className="text-[13px] font-medium leading-none tracking-tight">
            {tools.length}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {counts.done ? (
              <StatusTag color="emerald">{counts.done} done</StatusTag>
            ) : null}
            {counts.running ? (
              <StatusTag color="sky" pulse>
                {counts.running} running
              </StatusTag>
            ) : null}
            {counts.error ? (
              <StatusTag color="rose">{counts.error} error</StatusTag>
            ) : null}
          </div>
        </div>

        {open && (
          <div className="space-y-1 border-t border-white/[0.05] p-1">
            {tools.map((t) => (
              <ToolCallItem
                key={t.id}
                tool={t}
                defaultOpen={itemDefaultOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);
ToolCallGroup.displayName = "ToolCallGroup";
