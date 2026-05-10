"use client";

/**
 * ChatMessageList — C2 消息流
 *
 * 用户消息（右对齐蓝色气泡）/ AI 消息（左对齐含头像）/ 系统消息（居中灰字）
 * 支持 Markdown 渲染 + 工具执行卡片
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Bot, Copy, ThumbsDown, ThumbsUp, User, ChevronDown, ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback, Button, cn } from "@artifex-nexus/ui";
import type { MockMessage, MockToolCall } from "../../lib/chatMock";

interface ChatMessageListProps {
  messages: MockMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function ChatMessageList({ messages, messagesEndRef }: ChatMessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={messagesEndRef} />
    </div>
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

  return (
    <div className={cn("my-3 flex gap-3", isUser && "flex-row-reverse")}>
      {/* 头像 */}
      <Avatar className="h-7 w-7 shrink-0" ring={isUser ? "primary" : undefined}>
        <AvatarFallback
          className={cn(
            "text-[10px]",
            isUser ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
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
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MarkdownContent content={message.content} />
          )}
        </div>

        {/* 工具执行卡片 */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallCards toolCalls={message.toolCalls} />
        )}

        {/* 操作栏（仅 AI 消息） */}
        {!isUser && (
          <div className="mt-1 flex items-center gap-1 px-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" title="复制">
              <Copy className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" title="重新生成">
              <RefreshIcon className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" title="点赞">
              <ThumbsUp className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" title="点踩">
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
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    fontSize: "12px",
                  }}
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
        // 链接在新窗口打开
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
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ─── 工具执行卡片 ──────────────────────────────────────────────────────────

function ToolCallCards({ toolCalls }: { toolCalls: MockToolCall[] }) {
  const [collapsed, setCollapsed] = React.useState(toolCalls.length >= 3);

  if (collapsed) {
    return (
      <div className="mt-2">
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50"
          onClick={() => setCollapsed(false)}
        >
          <ChevronRight className="h-3 w-3" />
          <span>🔧 工具调用 ({toolCalls.length})</span>
          <span className="flex-1" />
          <span className="text-[10px]">
            {toolCalls.filter((t) => t.status === "completed").length}/{toolCalls.length} 完成
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <button
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setCollapsed(true)}
        >
          <ChevronDown className="h-3 w-3" />
          折叠工具调用
        </button>
      </div>
      {toolCalls.map((tc) => (
        <ToolCallCard key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: MockToolCall }) {
  const [expanded, setExpanded] = React.useState(false);

  const statusIcon = {
    pending: "⏳",
    running: "⏳",
    completed: "✅",
    error: "❌",
  }[toolCall.status];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/50">
      {/* 头部 */}
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/30"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{statusIcon}</span>
        <span className="font-mono text-[11px]">{toolCall.name}</span>
        {toolCall.duration && (
          <span className="text-[10px] text-muted-foreground">({toolCall.duration})</span>
        )}
        <span className="flex-1" />
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 text-xs">
          {toolCall.input && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] text-muted-foreground">输入</div>
              <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px]">
                {toolCall.input}
              </pre>
            </div>
          )}
          {toolCall.output && (
            <div>
              <div className="mb-1 text-[10px] text-muted-foreground">输出</div>
              <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px]">
                {toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
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
