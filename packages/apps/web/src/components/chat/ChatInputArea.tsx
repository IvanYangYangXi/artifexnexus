"use client";

/**
 * ChatInputArea — C3 输入区
 *
 * C3-文件区 + C3-钉选区 + C3a 快捷操作栏 + C3b 输入框 + C3c 发送区
 */

import * as React from "react";
import {
  AtSign,
  FilePlus,
  Paperclip,
  Plus,
  Send,
  Slash,
  Square,
  Play,
  ChevronDown,
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
  onResume: () => void;
  isStreaming: boolean;
  pendingCount: number;
  sessionFiles: SessionFile[];
}

export function ChatInputArea({
  onSend,
  onStop,
  onResume,
  isStreaming,
  pendingCount,
  sessionFiles,
}: ChatInputAreaProps) {
  const [text, setText] = React.useState("");
  const [sendMode, setSendMode] = React.useState<"immediate" | "queue">("immediate");
  const [pinnedTools, setPinnedTools] = React.useState<string[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
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
        <Button variant="ghost" size="icon" className="h-7 w-7" title="附件">
          <Paperclip className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="@提及"
          onClick={() => {
            // Mock: 添加一个示例 tool
            const toolName = prompt("输入 Tool 名称（mock）:");
            if (toolName) setPinnedTools((prev) => [...prev, toolName]);
          }}
        >
          <AtSign className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="命令">
          <Slash className="h-3.5 w-3.5" />
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" title="新对话">
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
          placeholder="输入消息... (Shift+Enter 换行)"
          className="min-h-[80px] max-h-[200px] flex-1 resize-none"
          disabled={isStreaming && sendMode === "immediate"}
        />

        <div className="flex flex-col gap-1">
          {/* 发送/停止/恢复 */}
          {isStreaming ? (
            <>
              <Button
                size="icon"
                variant="destructive"
                className="h-9 w-9"
                onClick={onStop}
                title="停止"
              >
                <Square className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-9"
                onClick={onResume}
                title="恢复"
              >
                <Play className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9"
              onClick={handleSend}
              disabled={!text.trim()}
              title="发送"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}

          {/* 发送方式切换 */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-9"
            onClick={() => setSendMode((m) => (m === "immediate" ? "queue" : "immediate"))}
            title={sendMode === "immediate" ? "立即发送" : "队列发送"}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* 队列提示 */}
      {pendingCount > 0 && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          队列 ({pendingCount}) — 当前生成完成后自动发送
        </div>
      )}
    </div>
  );
}
