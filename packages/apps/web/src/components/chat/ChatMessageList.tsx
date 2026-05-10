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
import { Bot, Copy, ThumbsDown, ThumbsUp, User } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  ToolCallGroup,
  type ToolCallData,
  cn,
} from "@artifex-nexus/ui";
import type { MockMessage } from "../../lib/chatMock";
import { ScrollFade } from "./ScrollFade";

interface ChatMessageListProps {
  messages: MockMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function ChatMessageList({ messages, messagesEndRef }: ChatMessageListProps) {
  return (
    <ScrollFade className="flex-1">
      <div className="px-4 py-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </ScrollFade>
  );
}

// ─── 消息气泡 ──────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: MockMessage }) {
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
      {isUser ? (
        <Avatar className="h-7 w-7 shrink-0" ring="primary">
          <AvatarFallback className="bg-primary/15 text-primary text-[10px]">
            <User className="h-3.5 w-3.5" />
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="rounded-full p-[1.5px] ring-1 ring-primary/50">
          <Avatar className="h-7 w-7 ring-2 ring-card">
            <AvatarFallback className="bg-primary/15 text-primary text-[10px]">
              <Bot className="h-3.5 w-3.5" />
            </AvatarFallback>
          </Avatar>
        </div>
      )}

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
            <MarkdownContent content={message.content} />
          )}
          {/* 流式指示器 */}
          {isStreaming && (
            <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-primary" />
          )}
        </div>

        {/* 工具执行卡片 — 使用 @artifex-nexus/ui ToolCallGroup */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2">
            <ToolCallGroup
              tools={message.toolCalls.map(
                (tc): ToolCallData => ({
                  id: tc.id,
                  name: tc.name,
                  status: tc.status === "completed" ? "done" : tc.status === "error" ? "error" : "running",
                  durationMs: tc.duration ? parseFloat(tc.duration) * 1000 : undefined,
                  args: tc.input ? { code: tc.input } : undefined,
                  result: tc.output,
                }),
              )}
              defaultOpen={message.toolCalls.length < 3}
            />
          </div>
        )}

        {/* 操作栏（仅 AI 消息，非流式） */}
        {!isUser && !isStreaming && (
          <div className="mt-1 flex items-center gap-0.5 px-1">
            <Button variant="ghost" size="icon" className="h-6 w-6">
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
}

// ─── Markdown 渲染 ──────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
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
        // 代码块
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const codeStr = String(children).replace(/\n$/, "");

          if (match) {
            return (
              <div className="my-2 overflow-hidden rounded-md border border-border">
                <div className="flex items-center justify-between bg-muted/50 px-3 py-1 text-[10px] text-muted-foreground">
                  <span>{match[1]}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => navigator.clipboard.writeText(codeStr)}
                  >
                    <Copy className="h-2.5 w-2.5" />
                  </Button>
                </div>
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{ margin: 0, borderRadius: 0, fontSize: "12px" }}
                >
                  {codeStr}
                </SyntaxHighlighter>
              </div>
            );
          }

          return (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]" {...props}>
              {children}
            </code>
          );
        },
        // 段落
        p({ children }) {
          return <p className="my-1 first:mt-0 last:mb-0">{children}</p>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

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
