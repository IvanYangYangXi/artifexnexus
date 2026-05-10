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
 * 风格 B · Mica + Fluent 2 — Microsoft Windows 11 / Office 灵感
 *
 * 视觉语言：
 *   - 卡片 = 实色 bg-card + 1px 内描边（顶部高光线）+ 极轻投影
 *   - 工具调用卡左侧 2px 状态色色条（绿/红/黄）
 *   - 圆角 6-8px，锐利
 *   - 钢蓝 213 75% 62%
 *   - 字体 Inter 400-600；标题加 letter-spacing -0.01em
 *   - 顶部有 1px primary→透明 渐变线（Mica 信号灯）
 */
export function StyleB() {
  return (
    <StylePage
      title="B · Mica · Fluent 2"
      subtitle="Microsoft Windows 11 / Office Fluent · 几何精准 · 信息密度高"
      philosophy={[
        "卡片实色 + 1px 内描边 + 顶部高光线（inset shadow），极轻投影",
        "工具调用卡左侧 2px 状态色色条 ⇒ 绿（done）/ 蓝（running）/ 红（error）",
        "圆角 6-8px 偏锐利，标题字 letter-spacing -0.01em",
        "适合 Skill/Tool 管理页 / 设置页 / 安装向导（信息密度场景）",
      ]}
      rootClassName="bg-background"
      statusCard={<StatusCardB />}
      toolCallGroup={<ToolCallGroupB />}
      buttons={<ButtonsB />}
      chatInput={<ChatInputB />}
    />
  );
}

const MICA =
  "rounded-md border border-border bg-card shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_2px_6px_-2px_rgba(0,0,0,0.4)]";

/** 顶部 1px primary→transparent 渐变（Mica 信号灯） */
function MicaSignalLine() {
  return (
    <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
  );
}

function StatusCardB() {
  return (
    <div className={`overflow-hidden ${MICA}`}>
      <MicaSignalLine />
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              OpenClaw Gateway
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-base font-semibold tracking-tight">
                运行中
              </span>
            </div>
          </div>
          <span className="rounded-sm border border-border bg-muted/50 px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
            v2026.5.4
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
          <Stat label="端口" value={String(OPENCLAW_STATUS.port)} mono />
          <Stat label="运行" value={OPENCLAW_STATUS.uptime} />
          <Stat label="DCC" value={String(OPENCLAW_STATUS.attached.length)} />
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            已附着
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {OPENCLAW_STATUS.attached.map((d) => (
              <span
                key={d}
                className="rounded-sm border border-border bg-muted/30 px-2 py-0.5 text-xs"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
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
      <dd className={mono ? "mt-0.5 font-mono text-sm" : "mt-0.5 text-sm"}>
        {value}
      </dd>
    </div>
  );
}

function ButtonsB() {
  return (
    <div className={`p-5 ${MICA}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button className="rounded-md border border-primary/40 bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset] transition hover:brightness-110 active:translate-y-px">
          主操作
        </button>
        <button className="rounded-md border border-border bg-muted/40 px-4 py-1.5 text-sm shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] transition hover:bg-accent active:translate-y-px">
          次操作
        </button>
        <button className="rounded-md border border-destructive/50 bg-destructive/15 px-4 py-1.5 text-sm font-medium text-destructive-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset] transition hover:bg-destructive/25 active:translate-y-px">
          删除
        </button>
        <button className="rounded-md border border-transparent px-4 py-1.5 text-sm text-muted-foreground transition hover:border-border hover:bg-accent">
          Ghost
        </button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        几何精准、状态边界清晰；按钮按下时整体下沉 1px（Fluent 触感反馈）。
      </p>
    </div>
  );
}

function ChatInputB() {
  return (
    <div className={`overflow-hidden ${MICA}`}>
      <MicaSignalLine />
      <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Avatar className="h-5 w-5">
          <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
            U
          </AvatarFallback>
        </Avatar>
        <span>You · gpt-4o · workspace://blender-scene-01</span>
      </div>
      <Textarea
        placeholder="问 Artifex 任何关于场景的事…"
        className="min-h-[72px] resize-none rounded-none border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <div className="flex items-center justify-between border-t border-border bg-muted/20 px-3 py-1.5">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded-sm border border-border bg-muted px-1 py-px font-mono text-[10px]">
              Ctrl
            </kbd>
            <kbd className="rounded-sm border border-border bg-muted px-1 py-px font-mono text-[10px]">
              K
            </kbd>
            搜索
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded-sm border border-border bg-muted px-1 py-px font-mono text-[10px]">
              ⏎
            </kbd>
            发送
          </span>
        </div>
        <button className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:brightness-110">
          <Send className="h-3 w-3" />
          发送
        </button>
      </div>
    </div>
  );
}

function ToolCallGroupB() {
  const [groupOpen, setGroupOpen] = useState(true);
  const counts = TOOL_CALLS.reduce(
    (acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <div className={`overflow-hidden ${MICA}`}>
      <MicaSignalLine />
      <div className="space-y-3 p-3">
        {/* 用户消息 */}
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
            {CHAT_USER}
          </div>
        </div>

        {/* AI 回复 */}
        <div className="flex items-start gap-2.5">
          <Avatar className="h-7 w-7 rounded-md">
            <AvatarFallback className="rounded-md bg-primary/15 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <div className="text-sm">好，我来分三步执行：</div>

            {/* 外层折叠 */}
            <div className="overflow-hidden rounded-md border border-border bg-muted/20">
              <button
                onClick={() => setGroupOpen(!groupOpen)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-accent/50"
              >
                {groupOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>🔧</span>
                <span className="font-medium">
                  {TOOL_CALLS.length} 次工具调用
                </span>
                <span className="rounded-sm bg-emerald-500/15 px-1.5 py-px font-mono text-[10px] text-emerald-300">
                  {counts.done || 0} done
                </span>
                {counts.running ? (
                  <span className="rounded-sm bg-sky-500/15 px-1.5 py-px font-mono text-[10px] text-sky-300">
                    {counts.running} running
                  </span>
                ) : null}
              </button>

              {groupOpen && (
                <div className="space-y-px border-t border-border bg-card">
                  {TOOL_CALLS.map((t) => (
                    <ToolItemB key={t.id} tool={t} />
                  ))}
                </div>
              )}
            </div>

            <div className="text-sm">完成。立方体已添加并设置了金属材质。</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolItemB({ tool }: { tool: (typeof TOOL_CALLS)[number] }) {
  const [open, setOpen] = useState(false);
  const stripe =
    tool.status === "done"
      ? "before:bg-emerald-400"
      : tool.status === "running"
        ? "before:bg-sky-400 before:animate-pulse"
        : "before:bg-rose-400";
  const tag =
    tool.status === "done"
      ? "bg-emerald-500/15 text-emerald-300"
      : tool.status === "running"
        ? "bg-sky-500/15 text-sky-300"
        : "bg-rose-500/15 text-rose-300";

  return (
    <div
      className={`relative pl-2 before:absolute before:left-0 before:top-1 before:h-[calc(100%-0.5rem)] before:w-[2px] before:rounded-full ${stripe}`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition hover:bg-accent/30"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="font-mono">{tool.name}</span>
        <span
          className={`ml-auto rounded-sm px-1.5 py-px font-mono text-[10px] ${tag}`}
        >
          {tool.status === "running"
            ? "running…"
            : tool.durationMs
              ? `${tool.durationMs}ms`
              : tool.status}
        </span>
      </button>
      {open && (
        <div className="border-t border-border bg-muted/10 p-2 font-mono text-[11px] text-muted-foreground">
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

void Badge;
void Button;
