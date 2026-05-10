"use client";

/**
 * ChatInputArea — C3 输入区
 *
 * C3-队列区 + C3-文件区 + C3-钉选区 + C3a 快捷操作栏 + C3b 输入框 + C3c 发送区
 * 发送方式：Enter 发送 / Ctrl+Enter 发送（通过下拉切换）
 * 队列：AI 生成中自动转为队列，生成完成后自动发送
 * 停止/恢复按钮常驻
 */

import * as React from "react";
import {
  AtSign,
  ChevronDown,
  Clock,
  FilePlus,
  Paperclip,
  Plus,
  Send,
  Slash,
  Square,
  X,
} from "lucide-react";
import { Button, Textarea, cn } from "@artifex-nexus/ui";

interface SessionFile {
  name: string;
  action: "新建" | "修改" | "删除";
}

interface ChatInputAreaProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  pendingCount: number;
  pendingMessages: string[];
  sessionFiles: SessionFile[];
}

type SendKey = "enter" | "ctrl-enter";

export function ChatInputArea({
  onSend,
  onStop,
  isStreaming,
  pendingCount,
  pendingMessages,
  sessionFiles,
}: ChatInputAreaProps) {
  const [text, setText] = React.useState("");
  const [sendKey, setSendKey] = React.useState<SendKey>("enter");
  const [pinnedTools, setPinnedTools] = React.useState<string[]>([]);
  const [showSendMenu, setShowSendMenu] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (sendKey === "enter" && e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      handleSend();
    } else if (sendKey === "ctrl-enter" && e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 自动调整高度
  React.useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 80), 200)}px`;
    }
  }, [text]);

  return (
    <div className="shrink-0 border-t border-border bg-background px-4 pb-3 pt-2">
      {/* 信息队列区 — AI 生成中时显示 */}
      {pendingCount > 0 && (
        <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-1.5">
          <div className="flex items-center gap-2 text-xs">
            <Clock className="h-3 w-3 text-amber-400" />
            <span className="text-amber-300">
              队列中 ({pendingCount}) — 当前生成完成后自动发送
            </span>
          </div>
          {pendingMessages.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {pendingMessages.map((msg, i) => (
                <div
                  key={i}
                  className="truncate pl-5 text-[10px] text-muted-foreground"
                >
                  {msg}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* C3-文件区：会话文件 */}
      {sessionFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">会话文件:</span>
          {sessionFiles.map((f) => (
            <span
              key={f.name}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
                f.action === "新建" && "border-emerald-500/30 text-emerald-400",
                f.action === "修改" && "border-amber-500/30 text-amber-400",
                f.action === "删除" && "border-red-500/30 text-red-400",
              )}
            >
              <FilePlus className="h-2.5 w-2.5" />
              {f.name}
              <span className="text-muted-foreground">({f.action})</span>
            </span>
          ))}
        </div>
      )}

      {/* C3-钉选区：@提及标签 */}
      {pinnedTools.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {pinnedTools.map((tool) => (
            <span
              key={tool}
              className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
            >
              @{tool}
              <button
                onClick={() => setPinnedTools((prev) => prev.filter((t) => t !== tool))}
                className="ml-0.5 hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* C3a 快捷操作栏 */}
      <div className="mb-1.5 flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Paperclip className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            const toolName = prompt("输入 Tool 名称（mock）:");
            if (toolName) setPinnedTools((prev) => [...prev, toolName]);
          }}
        >
          <AtSign className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Slash className="h-3.5 w-3.5" />
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" />
          新对话
        </Button>
      </div>

      {/* C3b 输入框 + C3c 发送区 */}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            sendKey === "enter"
              ? "输入消息... (Enter 发送, Shift+Enter 换行)"
              : "输入消息... (Ctrl+Enter 发送, Enter 换行)"
          }
          className="min-h-[80px] max-h-[200px] flex-1 resize-none border-white/[0.12] bg-muted/30 focus-visible:border-primary/40 focus-visible:bg-background"
        />

        {/* C3c 发送区 */}
        <div className="flex items-center gap-1.5">
          {/* 停止按钮 — 常驻 */}
          <Button
            size="icon"
            variant={isStreaming ? "destructive" : "ghost"}
            className="h-9 w-9"
            onClick={onStop}
            disabled={!isStreaming}
          >
            <Square className={cn("h-4 w-4", isStreaming && "fill-current")} />
          </Button>

          {/* 发送按钮 */}
          <Button
            size="icon"
            className="h-9 w-9"
            onClick={handleSend}
            disabled={!text.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>

          {/* 发送方式切换 */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-7"
              onClick={() => setShowSendMenu(!showSendMenu)}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            {showSendMenu && (
              <div className="absolute bottom-full right-0 mb-1 w-36 rounded-md border border-border bg-popover p-1 shadow-lg">
                <button
                  className={cn(
                    "flex w-full items-center rounded px-2 py-1 text-xs",
                    sendKey === "enter"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                  onClick={() => {
                    setSendKey("enter");
                    setShowSendMenu(false);
                  }}
                >
                  Enter 发送
                </button>
                <button
                  className={cn(
                    "flex w-full items-center rounded px-2 py-1 text-xs",
                    sendKey === "ctrl-enter"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                  onClick={() => {
                    setSendKey("ctrl-enter");
                    setShowSendMenu(false);
                  }}
                >
                  Ctrl+Enter 发送
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
