"use client";

/**
 * ChatMessageList — C2 消息流
 *
 * 用户消息（右对齐蓝色气泡）/ AI 消息（左对齐含头像）/ 系统消息（居中灰字）
 * 支持 Markdown 渲染 + 工具执行卡片（使用 @artifex-nexus/ui ToolCallGroup）
 * 区分流式（streaming）和最终（final）两个状态
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Bot, Copy, Loader2, ThumbsDown, ThumbsUp, User } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  ToolCallGroup,
  type ToolCallData,
  cn,
} from "@artifex-nexus/ui";
import type { ChatMessage } from "../../lib/chat/types";
import { ScrollFade } from "./ScrollFade";

// ─── 代码块展开状态全局缓存 ──────────────────────────────────────────────
// 将 expanded 状态提升到组件树外部，用稳定 key（msgId-codeIndex）索引。
// 避免 ReactMarkdown 重解析导致 CodeBlock unmount/remount 时 useState 重置。
const codeBlockExpandedCache = new Map<string, boolean>();

interface ChatMessageListProps {
  messages: ChatMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  /** 正在切换对话（显示 loading 骨架屏） — 可选，同步缓存方案下通常不需要 */
  loading?: boolean;
}

export function ChatMessageList({ messages, messagesEndRef, loading }: ChatMessageListProps) {
  return (
    <ScrollFade className="flex-1">
      <div className="px-4 py-3">
        {loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mb-2" />
            <span className="text-sm">加载对话历史...</span>
          </div>
        )}
        {messages.map((msg) => (
          <MessageErrorBoundary key={msg.id} messageId={msg.id}>
            <MessageBubble message={msg} />
          </MessageErrorBoundary>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </ScrollFade>
  );
}

/**
 * 单条消息渲染兜底：单条消息抛错时只丢这一条，不影响其它历史消息。
 *
 * 历史排查：CodeBlock / SyntaxHighlighter / ReactMarkdown 在遇到不规范内容时会抛
 * （如 language 不被 Prism 支持、code 是 undefined、Markdown 嵌套 code fence 解析失败）。
 * 没有 ErrorBoundary 时，错误冒泡到 ChatMessageList → 整棵子树 unmount →
 * 用户看到的现象就是"切换对话历史消息全部消失"。
 */
class MessageErrorBoundary extends React.Component<
  { messageId: string; children: React.ReactNode },
  { hasError: boolean; errMsg: string }
> {
  state = { hasError: false, errMsg: "" };
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, errMsg: String(error).slice(0, 200) };
  }
  componentDidCatch(error: unknown) {
    console.warn(`[ChatMessageList] 消息 ${this.props.messageId} 渲染失败:`, error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="my-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-destructive">⚠ 单条消息渲染失败</span>
          <span className="ml-2 opacity-70">（其余消息不受影响）</span>
          <div className="mt-1 font-mono text-[10px] opacity-60">{this.state.errMsg}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── 消息气泡 ──────────────────────────────────────────────────────────────

/**
 * MessageBubble — 单条消息渲染。
 * 用 React.memo + 浅比较 message 引用来避免不必要的重渲染。
 * APPEND_DELTA reducer 中只修改流式消息对象，非流式消息的对象引用不变，
 * 所以 memo 能有效阻止：收发新消息时已完成消息的 MarkdownContent 重解析。
 * 这是代码块展开状态不丢失的核心保障。
 */
const MessageBubble = React.memo(function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    return (
      <div className="my-2 text-center text-[11px] text-muted-foreground">
        {message.content}
      </div>
    );
  }

  const isUser = message.role === "user";
  const isStreaming = message.isStreaming === true;

  return (
    <div className={cn("my-3 flex gap-3", isUser && "flex-row-reverse")}>
      {/* 头像 */}
      <Avatar className="h-7 w-7 shrink-0" ring={isUser ? "primary" : undefined}>
        <AvatarFallback
          className={cn(
            "text-[10px]",
            isUser ? "bg-primary/15 text-primary" : "bg-primary/15 text-primary",
          )}
        >
          {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        </AvatarFallback>
      </Avatar>

      {/* 气泡内容 */}
      <div className={cn("max-w-[75%]", isUser && "items-end")}>
        {/* 消息文本 */}
        <div
          className={cn(
            "rounded-[14px] px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "border border-primary/25 bg-primary/[0.10] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-md"
              : "border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl shadow-[0_4px_16px_-8px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.04)]",
            isStreaming && "border-sky-400/30 shadow-[0_0_12px_-2px_hsl(var(--primary)/0.3))]",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownContent content={message.content} messageId={message.id} />
          )}
          {/* 流式指示器 */}
          {isStreaming && (
            <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-primary" />
          )}
        </div>

        {/* 工具执行卡片 — 超过3条自动折叠 */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2">
            <ToolCallGroup
              tools={message.toolCalls.map(
                (tc): ToolCallData => {
                  const isError = tc.status === "error";
                  return {
                    id: tc.id,
                    name: tc.name,
                    status: isError ? "error" : tc.status === "done" ? "done" : "running",
                    durationMs: tc.durationMs,
                    args: tc.input ? { code: tc.input } : undefined,
                    result: isError ? undefined : tc.output,
                    error: isError ? tc.output : undefined,
                  };
                },
              )}
              defaultOpen={message.toolCalls.length <= 3}
            />
          </div>
        )}

        {/* 操作栏（仅 AI 消息，非流式） */}
        {!isUser && !isStreaming && (
          <div className="mt-1 flex items-center gap-0.5 px-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                navigator.clipboard.writeText(message.content);
              }}
              title="复制对话文字"
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <RefreshIcon className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <ThumbsUp className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <ThumbsDown className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Markdown 渲染 ──────────────────────────────────────────────────────────

/** 代码块组件：超过5行自动折叠，展开状态通过外部缓存持久化 */
function CodeBlock({
  language,
  code,
  cacheKey,
}: {
  language: string;
  code: string;
  /** 稳定的缓存 key（msgId-codeBlockIndex），用于在 remount 后恢复展开状态 */
  cacheKey?: string;
}) {
  // 处理代码字符串（去首尾空白、空值兜底、兼容 Windows 换行符）
  // 历史消息中可能含 undefined/null（react-markdown 在边缘情况下传 undefined），
  // 直接 code.replace 会抛 TypeError 把整棵 ChatMessageList 子树搞崩 → 历史消失。
  const safeCode = (code ?? "").toString().replace(/\r\n/g, "\n");
  const trimmed = safeCode.replace(/\n+$/, "");
  const lines = trimmed.split("\n");
  const shouldCollapse = lines.length > 5;

  // 从外部缓存恢复展开状态，避免 ReactMarkdown 重渲染导致 useState 重置
  const cachedState = cacheKey ? codeBlockExpandedCache.get(cacheKey) : undefined;
  const initialExpanded = cachedState !== undefined ? cachedState : !shouldCollapse;
  const [expanded, setExpanded] = React.useState(initialExpanded);

  // 同步缓存（展开状态变化时写入）
  const handleToggle = React.useCallback((next: boolean) => {
    setExpanded(next);
    if (cacheKey) {
      codeBlockExpandedCache.set(cacheKey, next);
    }
  }, [cacheKey]);

  const displayCode = expanded || !shouldCollapse
    ? trimmed
    : lines.slice(0, 5).join("\n") + "\n";

  // language 兜底：空字符串 / undefined 会让 SyntaxHighlighter 抛错
  const safeLanguage = (language || "text").toLowerCase();

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 font-mono">{safeLanguage}</span>
          {shouldCollapse && (
            <button
              onClick={() => handleToggle(!expanded)}
              className="hover:text-foreground transition-colors truncate"
            >
              {expanded ? "收起" : `${lines.length} 行（点击展开）`}
            </button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0"
          onClick={() => navigator.clipboard.writeText(trimmed)}
          title="复制代码"
        >
          <Copy className="h-2.5 w-2.5" />
        </Button>
      </div>
      <div className={cn(!expanded && shouldCollapse && "max-h-[140px] overflow-hidden")}>
        <SafeSyntaxHighlighter language={safeLanguage} code={displayCode} />
      </div>
      {shouldCollapse && !expanded && (
        <div
          className="cursor-pointer bg-muted/30 py-1.5 text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors border-t border-white/[0.04]"
          onClick={() => handleToggle(true)}
        >
          展开全部 {lines.length} 行
        </div>
      )}
    </div>
  );
}

/**
 * SyntaxHighlighter 包装：捕获高亮失败回退到 <pre>。
 *
 * react-syntax-highlighter 的 Prism 在不支持的 language 或非法字符串上会抛错，
 * 抛错冒泡到 React 顶层 → 整棵 ChatMessageList unmount → 历史消息看似"丢失"。
 * 用 ErrorBoundary 包一层，失败时降级到普通 <pre>，保证 UI 永不崩。
 */
class SafeSyntaxHighlighter extends React.Component<
  { language: string; code: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: unknown) {
    console.warn("[CodeBlock] SyntaxHighlighter 渲染失败，降级为 <pre>:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <pre className="m-0 overflow-x-auto bg-[#282c34] p-3 text-[12px] text-[#abb2bf]">
          <code>{this.props.code}</code>
        </pre>
      );
    }
    try {
      return (
        <SyntaxHighlighter
          style={oneDark}
          language={this.props.language}
          PreTag="div"
          customStyle={{ margin: 0, borderRadius: 0, fontSize: "12px" }}
        >
          {this.props.code}
        </SyntaxHighlighter>
      );
    } catch (err) {
      console.warn("[CodeBlock] SyntaxHighlighter 同步异常，降级:", err);
      return (
        <pre className="m-0 overflow-x-auto bg-[#282c34] p-3 text-[12px] text-[#abb2bf]">
          <code>{this.props.code}</code>
        </pre>
      );
    }
  }
}

/**
 * MarkdownContent — AI 消息的 Markdown 渲染。
 * 用 React.memo 避免 content 不变时重新解析（ReactMarkdown 重解析会重建整棵
 * 组件子树，导致 CodeBlock unmount/remount → 展开状态丢失）。
 */
const MarkdownContent = React.memo(function MarkdownContent({ content, messageId }: { content: string; messageId: string }) {
  // 兜底：content 可能是 undefined / null（流式还没填、或反序列化时缺字段）
  const safeContent = (content ?? "").toString();
  if (!safeContent) return null;

  // 代码块计数器：每条消息内的代码块按出现顺序编号，用于 cacheKey
  const codeBlockIndexRef = React.useRef(0);
  // 每次 content 变化时重置计数器（ReactMarkdown 会重新遍历所有节点）
  codeBlockIndexRef.current = 0;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 标题
        h1({ children }) {
          return <h1 className="mb-2 mt-3 text-lg font-bold first:mt-0">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="mb-1.5 mt-2.5 text-base font-semibold first:mt-0">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>;
        },
        // 加粗
        strong({ children }) {
          return <strong className="font-semibold text-foreground">{children}</strong>;
        },
        // 链接
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          );
        },
        // 表格
        table({ children }) {
          return (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse border border-border text-xs">
                {children}
              </table>
            </div>
          );
        },
        thead({ children }) {
          return <thead className="bg-muted/50">{children}</thead>;
        },
        th({ children }) {
          return (
            <th className="border border-border px-2 py-1 text-left font-medium">
              {children}
            </th>
          );
        },
        td({ children }) {
          return <td className="border border-border px-2 py-1">{children}</td>;
        },
        // 分割线
        hr() {
          return <hr className="my-3 border-border" />;
        },
        // 列表
        ul({ children }) {
          return <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>;
        },
        // 块级代码：直接 hook <pre>，避免 hook <code> 时 ReactMarkdown 把 CodeBlock
        // 包到 <p> 里产生非法嵌套（<div> in <p>）→ React #418 hydration error。
        // ReactMarkdown 对 fenced code 输出 <pre><code class="language-xxx">...</code></pre>，
        // 这里在 pre 层替换为 CodeBlock，p() 完全不会接触到块级代码节点。
        // 注意：fenced code **没有 language 标识符时**，<code> 没有 className，
        // 仅靠 className.includes("language-") 会漏判。这里改为：只要 <pre> 里
        // 包了 <code>，就当代码块处理；language 提取不到就传空字符串（CodeBlock 内 fallback "text"）。
        pre({ children }: any) {
          // 提取嵌套的 <code> 元素（fenced code 总是 <pre><code>...</code></pre>）
          const arr = React.Children.toArray(children);
          // 找第一个像 code 的 child（type 可能是 string "code" 或函数）
          const codeEl: any = arr.find((c: any) => {
            if (!c || typeof c !== "object") return false;
            return c.type === "code" || c.props?.className?.includes("language-");
          });

          if (!codeEl) {
            // 不是标准 fenced code（如纯 <pre> 块），降级为简单 pre 渲染
            return <pre className="my-2 overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-[12px]">{children}</pre>;
          }

          const className: string = codeEl.props?.className ?? "";
          const match = /language-(\w+)/.exec(className);
          const rawChildren = codeEl.props?.children;
          const codeStr = (rawChildren == null ? "" : String(rawChildren)).replace(/\n$/, "");
          const idx = codeBlockIndexRef.current++;
          return <CodeBlock language={match?.[1] ?? ""} code={codeStr} cacheKey={`${messageId}-cb-${idx}`} />;
        },
        // 内联 code（行内反引号）：保持 <code> 标签，安全嵌入 <p>。
        code({ className, children, ...props }) {
          // 不应进入 fenced code 分支（已被 pre() 拦截），但保留兜底以防 React-markdown
          // 把某些边缘 fenced code 直接渲染成裸 <code>。
          if (className?.includes("language-")) {
            const match = /language-(\w+)/.exec(className);
            const codeStr = (children == null ? "" : String(children)).replace(/\n$/, "");
            const idx = codeBlockIndexRef.current++;
            return <CodeBlock language={match?.[1] ?? ""} code={codeStr} cacheKey={`${messageId}-cb-${idx}`} />;
          }
          return (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]" {...props}>
              {children}
            </code>
          );
        },
        // 段落：改用 <div> 避免 react-markdown 在某些场景把块级元素塞进 <p> 触发
        // hydration mismatch（React #418）。视觉与 <p> 等价（用 my-1 替代默认 margin）。
        p({ children }) {
          return <div className="my-1 first:mt-0 last:mb-0">{children}</div>;
        },
      }}
    >
      {safeContent}
    </ReactMarkdown>
  );
});

// ─── 简易刷新图标 ──────────────────────────────────────────────────────────

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
