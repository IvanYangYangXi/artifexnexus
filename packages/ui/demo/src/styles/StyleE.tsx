import { Avatar, AvatarFallback, Textarea, ToolCallGroup, type ToolCallData } from "@artifex-nexus/ui";
import { Send, Sparkles } from "lucide-react";

import { CHAT_USER, OPENCLAW_STATUS, TOOL_CALLS } from "./samples";
import { StylePage } from "./StylePage";

/**
 * 风格 E · A+D 整合 — Glass Layer × Information Hierarchy
 *
 * 整合原则：
 *   保留 A：玻璃分层 / 大圆角 / 浮起阴影 / 顶部 inset 高光 / 模块"前台感"
 *   保留 D：字号梯度强 / 标签 uppercase tracking / 模块内信息分组明确 /
 *           头像装饰环 / 用户气泡有身份背景色
 *   去掉  D：所有渐变（Aurora gradient / 渐变文字 / 渐变按钮 / 渐变描边）
 *   改用 ：单色 primary（钢蓝 213 78% 65%）+ 状态色（emerald/sky/rose 各自单色）
 */
export function StyleE() {
  return (
    <StylePage
      title="E · Glass Layer (A+D 整合)"
      subtitle="A 的玻璃分层 + D 的信息层级 · 去除渐变 · 单色品牌蓝"
      philosophy={[
        "玻璃卡：backdrop-blur + 半透明白底叠加 + 顶部 inset 高光线（A 的分层手法）",
        "字号梯度强：[10px 标签] / [13-14px 正文] / [20px 标题, -0.02em] —— 眼睛立刻识别语义",
        "标签全部 uppercase tracking-[0.18em]：用排印替代色彩做层级",
        "品牌蓝单色（钢蓝 213 78% 65%）；状态色 emerald/sky/rose 单色，不混合",
        "头像 = 1.5px primary 描边环（替代 Aurora 渐变环）；用户气泡 bg-primary/[0.10]",
      ]}
      rootClassName="bg-[radial-gradient(at_top_left,_rgba(70,120,200,0.08),transparent_55%),radial-gradient(at_bottom_right,_rgba(60,100,180,0.06),transparent_55%)] bg-background"
      statusCard={<StatusCardE />}
      toolCallGroup={<ToolCallGroupE />}
      buttons={<ButtonsE />}
      chatInput={<ChatInputE />}
    />
  );
}

/* ─────────────────────────── 样式原子 ─────────────────────────── */

/** 玻璃面（A 的分层精髓） */
const GLASS =
  "rounded-[16px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]";

/** 玻璃面 - 内层（用于嵌套，blur 较弱） */
const GLASS_INNER =
  "rounded-[12px] border border-white/[0.06] bg-white/[0.025] backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]";

/** 玻璃 hover 反馈：边框提亮 + 背景升一档 */
const GLASS_HOVER = "transition hover:border-white/[0.14] hover:bg-white/[0.06]";

/** 标签字（D 的层级哲学） */
const LABEL =
  "text-[10px] uppercase tracking-[0.18em] text-muted-foreground";

/** 大数值/状态字（D 的信息密度哲学） */
const STATEMENT = "text-xl font-semibold tracking-[-0.02em]";

/* ─────────────────────────── 状态卡片 ─────────────────────────── */

function StatusCardE() {
  return (
    <div className={`p-5 ${GLASS}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className={LABEL}>OpenClaw Gateway</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.55)]" />
            </span>
            <span className={STATEMENT}>运行中</span>
          </div>
        </div>
        <span className="rounded-md border border-white/[0.10] bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground">
          {OPENCLAW_STATUS.version}
        </span>
      </div>

      {/* 中段：KV 列阵 */}
      <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3">
        <KV label="端口" value={String(OPENCLAW_STATUS.port)} mono />
        <KV label="运行" value={OPENCLAW_STATUS.uptime} />
        <KV label="DCC" value={String(OPENCLAW_STATUS.attached.length)} />
      </dl>

      {/* 底部：附着列表（独立分区） */}
      <div className="mt-4 border-t border-white/[0.05] pt-3">
        <div className={LABEL}>已附着</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {OPENCLAW_STATUS.attached.map((d) => (
            <span
              key={d}
              className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-0.5 text-xs"
            >
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function KV({
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
      <dt className={LABEL}>{label}</dt>
      <dd className={mono ? "mt-1 font-mono text-sm" : "mt-1 text-sm"}>
        {value}
      </dd>
    </div>
  );
}

/* ─────────────────────────── 按钮组 ─────────────────────────── */

function ButtonsE() {
  return (
    <div className={`p-5 ${GLASS}`}>
      <div className={LABEL}>按钮 · 4 状态</div>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        {/* 主操作 — 单色 primary，玻璃式高光 */}
        <button className="group relative overflow-hidden rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.5),inset_0_1px_0_0_rgba(255,255,255,0.18)] transition hover:brightness-110 active:scale-[0.98]">
          <span className="absolute inset-x-0 top-0 h-px bg-white/30" />
          ⚡ 主操作
        </button>
        {/* 次操作 — 玻璃面，hover 提亮 */}
        <button
          className={`rounded-full border border-white/[0.10] bg-white/[0.05] px-5 py-2 text-sm backdrop-blur-md ${GLASS_HOVER} active:scale-[0.98]`}
        >
          次操作
        </button>
        {/* 危险 — 玻璃化的 destructive，文字保持高可读 */}
        <button className="rounded-full border border-rose-400/30 bg-rose-500/[0.10] px-5 py-2 text-sm font-medium text-rose-200 backdrop-blur-md transition hover:border-rose-400/50 hover:bg-rose-500/[0.18] active:scale-[0.98]">
          删除
        </button>
        {/* Ghost */}
        <button className="rounded-full px-5 py-2 text-sm text-muted-foreground transition hover:bg-white/[0.05] hover:text-foreground active:scale-[0.98]">
          Ghost
        </button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        主操作 = 纯色 primary + 顶部 inset 1px 高光（玻璃感）；hover 用 brightness 而非渐变。
      </p>
    </div>
  );
}

/* ─────────────────────────── chat 输入框 ─────────────────────────── */

function ChatInputE() {
  return (
    <div className={`overflow-hidden ${GLASS}`}>
      {/* 顶部信息条：上下文 + 模型，借鉴 D 的"分组明确" */}
      <div className="flex items-center gap-2 border-b border-white/[0.05] bg-white/[0.02] px-4 py-2 text-[11px]">
        <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="font-mono text-muted-foreground">
          blender-scene-01
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="font-mono text-muted-foreground">gpt-4o</span>
        <span className="ml-auto rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
          3 messages
        </span>
      </div>

      {/* 输入区 */}
      <div className="flex items-start gap-3 p-4">
        <div className="rounded-full p-[1.5px] ring-1 ring-primary/40">
          <Avatar className="h-9 w-9 ring-2 ring-card">
            <AvatarFallback className="bg-primary/15 text-primary">
              U
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex-1">
          <Textarea
            placeholder="问 Artifex 任何关于场景的事…"
            className="min-h-[64px] resize-none border-white/[0.06] bg-white/[0.02] backdrop-blur-md placeholder:text-muted-foreground/70 focus-visible:ring-primary/40"
          />
          <div className="mt-2.5 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-white/[0.10] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
                  ⌘K
                </kbd>
                命令
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-white/[0.10] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
                  /
                </kbd>
                工具
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-white/[0.10] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
                  @
                </kbd>
                提及
              </span>
            </div>
            <button className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1 text-xs font-medium text-primary-foreground shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.5),inset_0_1px_0_0_rgba(255,255,255,0.18)] hover:brightness-110">
              <Send className="h-3 w-3" />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── 工具调用双层折叠 ─────────────────────────── */

function ToolCallGroupE() {
  // 适配 demo samples 类型 → contracts 类型
  const tools: ToolCallData[] = TOOL_CALLS.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    durationMs: t.durationMs,
    args: t.args,
    result: t.result,
  }));

  return (
    <div className={`p-4 ${GLASS}`}>
      {/* 用户消息：身份色背景气泡 */}
      <div className="mb-4 flex justify-end">
        <div className="max-w-[80%] rounded-[14px] border border-primary/25 bg-primary/[0.10] px-4 py-2.5 text-sm shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-md">
          {CHAT_USER}
        </div>
      </div>

      {/* AI 回复区：玻璃 + 头像装饰环（纯色） */}
      <div className="flex items-start gap-3">
        <div className="rounded-full p-[1.5px] ring-1 ring-primary/50">
          <Avatar className="h-9 w-9 ring-2 ring-card">
            <AvatarFallback className="bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="flex-1 space-y-3">
          <div className="text-sm leading-relaxed">好，我来分三步执行：</div>

          {/* 业务组件：双层折叠工具调用（沉淀自此风格的最终方案） */}
          <ToolCallGroup tools={tools} />

          <div className="text-sm leading-relaxed">
            完成。立方体已添加并设置了金属材质。
          </div>
        </div>
      </div>
    </div>
  );
}
