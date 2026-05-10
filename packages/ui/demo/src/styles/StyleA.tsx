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
 * 风格 A · Liquid Glass — Apple visionOS / macOS Sequoia 灵感
 *
 * 视觉语言：
 *   - 卡片 = backdrop-blur-xl + 半透明白底（4-6%）+ 渐变高光描边
 *   - 圆角大 14-20px（macOS 风）
 *   - 双层叠加阴影：层叠玻璃片
 *   - 字体大胆：标题 1.5×，weight 600
 *   - 品牌蓝：偏天空（亮、不刺眼）
 */
export function StyleA() {
  return (
    <StylePage
      title="A · Liquid Glass"
      subtitle="Apple visionOS / macOS Sequoia 灵感 · 玻璃拟态 · 空间深度"
      philosophy={[
        "卡片 = backdrop-blur-xl + bg-white/[0.04] + 渐变描边（顶部高光）",
        "圆角 14-20px，远离锐利感；阴影双层（外发光 + 内高光）",
        "品牌蓝偏天空（204 80% 70%），气泡浮起、按钮也会“飘”",
        "适合 chat 主界面 / Dialog / Popover 等“前台”场景",
      ]}
      rootClassName="bg-[radial-gradient(at_top_left,_rgba(120,160,255,0.10),transparent_55%),radial-gradient(at_bottom_right,_rgba(180,120,255,0.08),transparent_55%)] bg-background"
      statusCard={<StatusCardA />}
      toolCallGroup={<ToolCallGroupA />}
      buttons={<ButtonsA />}
      chatInput={<ChatInputA />}
    />
  );
}

const GLASS =
  "rounded-[18px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.06)]";

const GLASS_INNER =
  "rounded-[12px] border border-white/[0.06] bg-white/[0.02] backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]";

function StatusCardA() {
  return (
    <div className={`p-5 ${GLASS}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            OpenClaw Gateway
          </div>
          <div className="mt-1 text-lg font-semibold tracking-tight">
            运行中
          </div>
        </div>
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.6)]" />
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Stat label="端口" value={String(OPENCLAW_STATUS.port)} mono />
        <Stat label="版本" value={OPENCLAW_STATUS.version} mono />
        <Stat label="运行时长" value={OPENCLAW_STATUS.uptime} />
        <Stat
          label="附着 DCC"
          value={`${OPENCLAW_STATUS.attached.length} 个`}
        />
      </dl>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {OPENCLAW_STATUS.attached.map((d) => (
          <span
            key={d}
            className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-xs"
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
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>{value}</dd>
    </div>
  );
}

function ButtonsA() {
  return (
    <div className={`p-5 ${GLASS}`}>
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-full bg-gradient-to-b from-sky-400 to-sky-500 px-5 py-2 text-sm font-medium text-white shadow-[0_4px_16px_-4px_rgba(56,189,248,0.5),inset_0_1px_0_0_rgba(255,255,255,0.25)] transition hover:brightness-110 active:scale-[0.98]">
          ⚡ 主操作
        </button>
        <button className="rounded-full border border-white/[0.10] bg-white/[0.06] px-5 py-2 text-sm backdrop-blur-md transition hover:bg-white/[0.10] active:scale-[0.98]">
          次操作
        </button>
        <button className="rounded-full border border-rose-400/30 bg-rose-400/10 px-5 py-2 text-sm text-rose-300 backdrop-blur-md transition hover:bg-rose-400/20 active:scale-[0.98]">
          删除
        </button>
        <button className="rounded-full px-5 py-2 text-sm text-muted-foreground transition hover:bg-white/[0.04]">
          Ghost
        </button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        所有按钮带"飘起来"效果：渐变背景 + inset 顶部高光 + 投射光晕。
      </p>
    </div>
  );
}

function ChatInputA() {
  return (
    <div className={`p-4 ${GLASS}`}>
      <div className="flex items-start gap-3">
        <div className="relative">
          <Avatar className="h-9 w-9 ring-2 ring-white/[0.08]">
            <AvatarFallback className="bg-gradient-to-br from-sky-400 to-violet-500 text-white">
              U
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex-1">
          <Textarea
            defaultValue=""
            placeholder="问 Artifex 任何关于场景的事…"
            className="min-h-[64px] resize-none border-white/[0.06] bg-white/[0.02] backdrop-blur-md placeholder:text-muted-foreground/70 focus-visible:ring-sky-400/40"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <kbd className="rounded border border-white/[0.10] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
                ⌘
              </kbd>
              <kbd className="rounded border border-white/[0.10] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
                K
              </kbd>
              <span>命令面板</span>
            </div>
            <button className="flex items-center gap-1.5 rounded-full bg-gradient-to-b from-sky-400 to-sky-500 px-3 py-1 text-xs font-medium text-white shadow-[0_2px_8px_-2px_rgba(56,189,248,0.5)] hover:brightness-110">
              <Send className="h-3 w-3" />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCallGroupA() {
  const [groupOpen, setGroupOpen] = useState(true);
  const counts = TOOL_CALLS.reduce(
    (acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <div className={`p-1 ${GLASS}`}>
      {/* 用户消息（玻璃气泡） */}
      <div className="m-3 mb-2 flex justify-end">
        <div className="max-w-[80%] rounded-[14px] border border-sky-400/20 bg-gradient-to-br from-sky-500/15 to-sky-400/5 px-4 py-2.5 text-sm shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-md">
          {CHAT_USER}
        </div>
      </div>

      {/* AI 回复区 */}
      <div className="m-3 flex items-start gap-3">
        <Avatar className="h-8 w-8 ring-2 ring-white/[0.08]">
          <AvatarFallback className="bg-gradient-to-br from-violet-400 to-fuchsia-500 text-white">
            <Sparkles className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-2">
          <div className="text-sm text-foreground">
            好，我来分三步执行：
          </div>

          {/* 外层折叠组 */}
          <div className={`overflow-hidden ${GLASS_INNER}`}>
            <button
              onClick={() => setGroupOpen(!groupOpen)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-white/[0.03]"
            >
              {groupOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="text-base">🔧</span>
              <span className="font-medium">
                {TOOL_CALLS.length} 次工具调用
              </span>
              <span className="text-xs text-muted-foreground">
                ({counts.done || 0} 完成
                {counts.running ? `, ${counts.running} 运行中` : ""})
              </span>
            </button>

            {groupOpen && (
              <div className="space-y-1.5 border-t border-white/[0.04] p-2">
                {TOOL_CALLS.map((t) => (
                  <ToolItemA key={t.id} tool={t} />
                ))}
              </div>
            )}
          </div>

          <div className="text-sm text-foreground">
            完成。立方体已添加并设置了金属材质。
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolItemA({ tool }: { tool: (typeof TOOL_CALLS)[number] }) {
  const [open, setOpen] = useState(false);
  const statusStyles = {
    running: "border-sky-400/30 bg-sky-400/[0.06]",
    done: "border-emerald-400/25 bg-emerald-400/[0.05]",
    error: "border-rose-400/30 bg-rose-400/[0.06]",
  } as const;
  const dotStyles = {
    running: "bg-sky-400 animate-pulse",
    done: "bg-emerald-400",
    error: "bg-rose-400",
  } as const;

  return (
    <div
      className={`overflow-hidden rounded-[10px] border backdrop-blur-md ${statusStyles[tool.status]}`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-white/[0.03]"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[tool.status]}`} />
        <span className="font-mono">{tool.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {tool.status === "running"
            ? "running…"
            : tool.durationMs
              ? `${tool.durationMs}ms`
              : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/[0.05] p-2 font-mono text-[11px] text-muted-foreground">
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">
            参数
          </div>
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(tool.args, null, 2)}
          </pre>
          {tool.result && (
            <>
              <div className="mb-1 mt-2 text-[10px] uppercase tracking-wider opacity-60">
                结果
              </div>
              <pre className="whitespace-pre-wrap break-all text-emerald-300/90">
                {tool.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 用一下 Badge / Button 让 import 不报警（保险）
void Badge;
void Button;
