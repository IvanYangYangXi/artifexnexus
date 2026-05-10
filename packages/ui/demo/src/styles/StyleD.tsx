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
 * 风格 D · Aurora Mesh — 自有特色 / 品牌化
 *
 * 视觉语言：
 *   - 主视觉保持纯净（不对所有元素都加渐变）
 *   - 关键节点引入"极光"渐变高光：
 *     · chat 输入框 focus → 顶部 1px 蓝→青渐变
 *     · 主操作按钮 → primary 描边 + hover 时背景渐变 蓝→紫青
 *     · AI 头像 → 渐变环（artistic 信号）
 *     · 工具执行成功 → 边框 1px 绿光（带 breath 动效）
 *   - 圆角 8-10px
 *   - 双色渐变：from 213 78% 65% to 265 60% 70%（蓝→紫青）
 *   - 标题 letter-spacing -0.02em
 */
export function StyleD() {
  return (
    <StylePage
      title="D · Aurora Mesh"
      subtitle="自有特色 · 品牌化 · 极光渐变（蓝→紫青）只在关键点出彩"
      philosophy={[
        "主视觉保持纯净，95% 区域是中性灰，仅 5% 关键节点出现渐变高光",
        "AI 头像 / 主 CTA / 焦点态 = 蓝→紫青双色渐变（DCC 创作领域常见配色）",
        "工具完成时边框一次性 breath 动效，不打扰但有“完成感”",
        "适合作为 chat + 主 CTA 的“出彩点”，与 C 风结合作为产品默认基调",
      ]}
      rootClassName="relative bg-background overflow-hidden"
      statusCard={<StatusCardD />}
      toolCallGroup={<ToolCallGroupD />}
      buttons={<ButtonsD />}
      chatInput={<ChatInputD />}
    />
  );
}

const PANEL = "rounded-[10px] border border-border bg-card";
const AURORA_TEXT =
  "bg-gradient-to-r from-sky-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent";
const AURORA_BG_BTN =
  "bg-gradient-to-br from-sky-500 via-indigo-500 to-violet-500";
const AURORA_RING =
  "bg-gradient-to-br from-sky-400 via-indigo-400 to-fuchsia-400";

function StatusCardD() {
  return (
    <div className={`relative overflow-hidden p-5 ${PANEL}`}>
      {/* 顶部一道极光高光 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/60 to-transparent" />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            OpenClaw Gateway
          </div>
          <div className={`mt-1 text-xl font-semibold tracking-tighter ${AURORA_TEXT}`}>
            运行中
          </div>
        </div>
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Stat label="端口" value={String(OPENCLAW_STATUS.port)} mono />
        <Stat label="版本" value={OPENCLAW_STATUS.version} mono />
        <Stat label="运行" value={OPENCLAW_STATUS.uptime} />
        <Stat label="DCC" value={`${OPENCLAW_STATUS.attached.length} 个`} />
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {OPENCLAW_STATUS.attached.map((d) => (
          <span
            key={d}
            className="rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-xs"
          >
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>{value}</dd>
    </div>
  );
}

function ButtonsD() {
  return (
    <div className={`p-5 ${PANEL}`}>
      <div className="flex flex-wrap items-center gap-2.5">
        {/* 主操作 — 渐变背景，hover 增强 */}
        <button
          className={`relative overflow-hidden rounded-lg ${AURORA_BG_BTN} px-4 py-1.5 text-sm font-medium text-white shadow-[0_4px_18px_-4px_rgba(99,102,241,0.5)] transition hover:shadow-[0_6px_22px_-4px_rgba(139,92,246,0.6)] active:translate-y-px`}
        >
          <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          ⚡ 主操作
        </button>
        {/* 次操作 — 静态用纯色，hover 才出现极光描边 */}
        <button className="group relative rounded-lg border border-border bg-card px-4 py-1.5 text-sm transition hover:border-transparent">
          <span className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-br from-sky-500/0 via-indigo-500/0 to-violet-500/0 opacity-0 transition group-hover:from-sky-500/10 group-hover:via-indigo-500/10 group-hover:to-violet-500/10 group-hover:opacity-100" />
          次操作
        </button>
        {/* 危险 — 红色但用更"温柔"的玫瑰色 */}
        <button className="rounded-lg border border-rose-500/40 bg-rose-500/[0.08] px-4 py-1.5 text-sm font-medium text-rose-200 transition hover:border-rose-400 hover:bg-rose-500/15">
          删除
        </button>
        <button className="rounded-lg px-4 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground">
          Ghost
        </button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        主 CTA 才用渐变；次操作 hover 时极光晕染浮现，静态保持克制。
      </p>
    </div>
  );
}

function ChatInputD() {
  return (
    <div className={`group relative overflow-hidden ${PANEL}`}>
      {/* focus 时顶部出现极光线（hover 演示） */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400 to-transparent opacity-40 transition-opacity group-focus-within:opacity-100" />
      <div className="flex items-start gap-3 p-3">
        <div className={`relative rounded-full p-[1.5px] ${AURORA_RING}`}>
          <Avatar className="h-9 w-9 ring-2 ring-card">
            <AvatarFallback className="bg-card text-foreground">U</AvatarFallback>
          </Avatar>
        </div>
        <div className="flex-1">
          <Textarea
            placeholder="问 Artifex 任何关于场景的事…"
            className="min-h-[64px] resize-none border-none bg-transparent p-0 placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  ⌘K
                </kbd>{" "}
                命令
              </span>
              <span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  /
                </kbd>{" "}
                工具
              </span>
              <span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  @
                </kbd>{" "}
                提及
              </span>
            </div>
            <button
              className={`flex items-center gap-1.5 rounded-lg ${AURORA_BG_BTN} px-3 py-1 text-xs font-medium text-white shadow-[0_2px_10px_-2px_rgba(99,102,241,0.5)] hover:shadow-[0_3px_14px_-2px_rgba(139,92,246,0.6)]`}
            >
              <Send className="h-3 w-3" />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCallGroupD() {
  const [groupOpen, setGroupOpen] = useState(true);
  const counts = TOOL_CALLS.reduce(
    (acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <div className={`p-4 ${PANEL}`}>
      {/* 用户消息：右对齐渐变气泡 */}
      <div className="mb-3 flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-gradient-to-br from-sky-500/15 via-indigo-500/12 to-violet-500/15 px-4 py-2 text-sm shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-sm">
          {CHAT_USER}
        </div>
      </div>

      {/* AI 回复 */}
      <div className="flex items-start gap-3">
        <div className={`rounded-full p-[1.5px] ${AURORA_RING}`}>
          <Avatar className="h-8 w-8 ring-2 ring-card">
            <AvatarFallback className="bg-card">
              <Sparkles className="h-4 w-4 text-violet-300" />
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex-1 space-y-2 text-sm">
          <div>好，我来分三步执行：</div>

          {/* 外层折叠组（极光描边） */}
          <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/60 to-transparent" />
            <button
              onClick={() => setGroupOpen(!groupOpen)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-accent/30"
            >
              {groupOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="text-base">🔧</span>
              <span className={`font-medium ${AURORA_TEXT}`}>
                {TOOL_CALLS.length} 次工具调用
              </span>
              <span className="text-muted-foreground">
                ({counts.done || 0} 完成
                {counts.running ? `, ${counts.running} 运行中` : ""})
              </span>
            </button>

            {groupOpen && (
              <div className="space-y-1.5 border-t border-border/60 p-2">
                {TOOL_CALLS.map((t) => (
                  <ToolItemD key={t.id} tool={t} />
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

function ToolItemD({ tool }: { tool: (typeof TOOL_CALLS)[number] }) {
  const [open, setOpen] = useState(false);
  const styles = {
    running: {
      ring:
        "ring-1 ring-sky-400/40 bg-sky-500/[0.05] before:bg-sky-400 before:animate-pulse",
      text: "text-sky-300",
    },
    done: {
      ring:
        "ring-1 ring-emerald-400/30 bg-emerald-500/[0.04] before:bg-emerald-400",
      text: "text-emerald-300/90",
    },
    error: {
      ring:
        "ring-1 ring-rose-400/40 bg-rose-500/[0.06] before:bg-rose-400",
      text: "text-rose-300",
    },
  } as const;
  const s = styles[tool.status];

  return (
    <div
      className={`relative overflow-hidden rounded-md ${s.ring} pl-2.5 before:absolute before:left-0 before:top-1.5 before:h-[calc(100%-0.75rem)] before:w-[2px] before:rounded-full`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition hover:bg-white/[0.02]"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="font-mono">{tool.name}</span>
        <span className={`ml-auto font-mono text-[10px] ${s.text}`}>
          {tool.status === "running"
            ? "running…"
            : tool.durationMs
              ? `${tool.durationMs}ms`
              : tool.status}
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
