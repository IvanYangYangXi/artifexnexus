import { useState } from "react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Textarea,
} from "@artifex-nexus/ui";
import { ChevronDown, ChevronRight, Send, Sparkles } from "lucide-react";

import { CHAT_USER, OPENCLAW_STATUS, TOOL_CALLS } from "./samples";
import { StylePage } from "./StylePage";

/**
 * 风格 C · Cursor / Linear — 设计师向开发工具
 *
 * 视觉语言：
 *   - 卡片几乎贴平背景，靠 1px 细描边 + hover 强反馈划分区域
 *   - 工具调用卡 = artclaw 风：状态色边框 + 状态色微背景
 *   - 圆角 6-8px，工具感
 *   - Linear 蓝（225 85% 68%，偏紫蓝）
 *   - JetBrains Mono 大量出现：工具名 / 状态 / 路径
 *   - 键盘 kbd 元素无处不在
 */
export function StyleC() {
  return (
    <StylePage
      title="C · Cursor / Linear"
      subtitle="设计师向开发者工具 · 精准 · 克制 · 键盘第一"
      philosophy={[
        "卡片几乎贴平背景；hover 时边框变 primary、背景升级一档（强反馈）",
        "工具调用卡用 artclaw 风：状态色 1px 边框 + 状态色 6% 背景渲染",
        "JetBrains Mono 在工具名/路径/快捷键大量出现，营造 IDE 氛围",
        "圆角 6px、动效 150ms（crisp 不墨迹），键盘快捷键随处可见",
      ]}
      rootClassName="bg-background"
      statusCard={<StatusCardC />}
      toolCallGroup={<ToolCallGroupC />}
      buttons={<ButtonsC />}
      chatInput={<ChatInputC />}
    />
  );
}

const PANEL =
  "rounded-md border border-border/60 bg-background transition-colors hover:border-border";

function StatusCardC() {
  return (
    <div className={`p-4 ${PANEL} hover:bg-card`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
            openclaw.gateway
          </div>
          <div className="mt-1 text-base font-medium tracking-tight">
            running
          </div>
        </div>
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          {OPENCLAW_STATUS.version}
        </kbd>
      </div>
      <div className="mt-3 space-y-1.5 font-mono text-xs">
        <KV k="port" v={String(OPENCLAW_STATUS.port)} />
        <KV k="uptime" v={OPENCLAW_STATUS.uptime} />
        <KV k="attached" v={OPENCLAW_STATUS.attached.join(", ")} />
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}

function ButtonsC() {
  return (
    <div className={`p-4 ${PANEL}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] transition hover:brightness-110">
          主操作
          <kbd className="ml-2 rounded-sm bg-black/25 px-1 py-px font-mono text-[10px] opacity-70">
            ⌘⏎
          </kbd>
        </button>
        <button className="rounded-md border border-border bg-card px-3 py-1.5 text-xs transition hover:border-primary/40 hover:bg-accent">
          次操作
        </button>
        <button className="rounded-md border border-destructive/50 bg-destructive/[0.08] px-3 py-1.5 text-xs font-medium text-destructive-foreground/95 transition hover:border-destructive hover:bg-destructive/15">
          删除
        </button>
        <button className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground">
          Ghost
        </button>
      </div>
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">
        // hover 强反馈、按钮内置快捷键提示、过渡 150ms ease-out
      </p>
    </div>
  );
}

function ChatInputC() {
  return (
    <div className={`overflow-hidden ${PANEL}`}>
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        <span className="text-emerald-400">●</span>
        <span>blender-scene-01</span>
        <span className="opacity-40">·</span>
        <span>gpt-4o</span>
        <span className="ml-auto opacity-60">3 messages</span>
      </div>
      <Textarea
        placeholder="问 Artifex 任何关于场景的事…"
        className="min-h-[64px] resize-none rounded-none border-none bg-transparent placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex items-center justify-between border-t border-border/60 bg-muted/10 px-3 py-1.5">
        <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
          <span>
            <kbd className="rounded border border-border bg-muted px-1 py-px text-[10px]">
              ⌘
            </kbd>
            <kbd className="ml-0.5 rounded border border-border bg-muted px-1 py-px text-[10px]">
              K
            </kbd>{" "}
            command
          </span>
          <span>
            <kbd className="rounded border border-border bg-muted px-1 py-px text-[10px]">
              ⏎
            </kbd>{" "}
            send
          </span>
          <span>
            <kbd className="rounded border border-border bg-muted px-1 py-px text-[10px]">
              ⇧⏎
            </kbd>{" "}
            newline
          </span>
        </div>
        <button className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:brightness-110">
          <Send className="h-3 w-3" />
          send
        </button>
      </div>
    </div>
  );
}

function ToolCallGroupC() {
  const [groupOpen, setGroupOpen] = useState(true);
  const counts = TOOL_CALLS.reduce(
    (acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <div className={`overflow-hidden p-3 ${PANEL}`}>
      {/* 用户消息：纯文本 + 左竖线（IDE 引用风） */}
      <div className="mb-3 border-l-2 border-primary/50 pl-3 text-sm">
        {CHAT_USER}
      </div>

      <div className="flex items-start gap-2.5">
        <Avatar className="h-6 w-6 rounded-md">
          <AvatarFallback className="rounded-md bg-primary/15 text-primary">
            <Sparkles className="h-3 w-3" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-2 text-sm">
          <div>好，我来分三步执行：</div>

          {/* 外层折叠组 — artclaw 风暗黄色调 */}
          <div className="overflow-hidden rounded-md border border-amber-500/25 bg-amber-500/[0.04]">
            <button
              onClick={() => setGroupOpen(!groupOpen)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs transition hover:bg-amber-500/[0.06]"
            >
              {groupOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-amber-400/80" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-amber-400/80" />
              )}
              <span>🔧</span>
              <span className="font-medium text-amber-200">
                {TOOL_CALLS.length} tool calls
              </span>
              <span className="text-muted-foreground">
                ({counts.done || 0} done
                {counts.running ? `, ${counts.running} running` : ""})
              </span>
            </button>

            {groupOpen && (
              <div className="space-y-1 border-t border-amber-500/15 p-1.5">
                {TOOL_CALLS.map((t) => (
                  <ToolItemC key={t.id} tool={t} />
                ))}
              </div>
            )}
          </div>

          <div>完成。立方体已添加并设置了金属材质。</div>
        </div>
      </div>
    </div>
  );
}

function ToolItemC({ tool }: { tool: (typeof TOOL_CALLS)[number] }) {
  const [open, setOpen] = useState(false);
  const styles = {
    running: {
      border: "border-sky-500/30",
      bg: "bg-sky-500/[0.05]",
      text: "text-sky-300",
      tag: "[running]",
    },
    done: {
      border: "border-emerald-500/25",
      bg: "bg-emerald-500/[0.04]",
      text: "text-emerald-300/90",
      tag: "[done]",
    },
    error: {
      border: "border-rose-500/35",
      bg: "bg-rose-500/[0.06]",
      text: "text-rose-300",
      tag: "[error]",
    },
  } as const;
  const s = styles[tool.status];

  return (
    <div className={`overflow-hidden rounded-sm border ${s.border} ${s.bg}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-[11px] transition hover:bg-white/[0.02]"
      >
        {open ? (
          <ChevronDown className={`h-3 w-3 ${s.text}`} />
        ) : (
          <ChevronRight className={`h-3 w-3 ${s.text}`} />
        )}
        <span>🔧</span>
        <span className="text-amber-200/90">{tool.name}</span>
        <span className={`ml-auto ${s.text}`}>
          {s.tag}
          {tool.durationMs ? ` ${tool.durationMs}ms` : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/[0.04] p-2 font-mono text-[11px] text-muted-foreground">
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">
            参数
          </div>
          <pre className="whitespace-pre-wrap break-all rounded-sm bg-black/30 p-2">
            {JSON.stringify(tool.args, null, 2)}
          </pre>
          {tool.result && (
            <>
              <div className="mb-1 mt-2 text-[10px] uppercase tracking-wider opacity-60">
                结果
              </div>
              <pre className="whitespace-pre-wrap break-all rounded-sm bg-black/30 p-2 text-emerald-300/90">
                {tool.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

void Badge;
void Button;
