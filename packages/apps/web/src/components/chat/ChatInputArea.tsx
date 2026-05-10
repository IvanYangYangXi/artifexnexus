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
  Pencil,
  Plus,
  Send,
  Slash,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button, Textarea, cn } from "@artifex-nexus/ui";
import { PreviewFileContext } from "../shell/AppShell";
import { AtMentionDialog, type MentionItem } from "./AtMentionDialog";

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

interface QuickPrompt {
  id: string;
  label: string;
  text: string;
}

const DEFAULT_PROMPTS: QuickPrompt[] = [
  { id: "1", label: "优化代码", text: "请帮我优化这段代码：" },
  { id: "2", label: "解释概念", text: "请解释以下概念：" },
  { id: "3", label: "调试错误", text: "请帮我调试这个错误：" },
];

const PROMPTS_STORAGE_KEY = "artifex.chat.quickPrompts";

function loadPrompts(): QuickPrompt[] {
  if (typeof window === "undefined") return DEFAULT_PROMPTS;
  try {
    const raw = localStorage.getItem(PROMPTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_PROMPTS;
  } catch {
    return DEFAULT_PROMPTS;
  }
}

function savePrompts(prompts: QuickPrompt[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROMPTS_STORAGE_KEY, JSON.stringify(prompts));
}

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
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [quickPrompts, setQuickPrompts] = React.useState<QuickPrompt[]>([]);
  const [promptDialogOpen, setPromptDialogOpen] = React.useState(false);
  const [promptLabel, setPromptLabel] = React.useState("");
  const [promptText, setPromptText] = React.useState("");
  const [editingPromptId, setEditingPromptId] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const { setPreviewFile } = React.useContext(PreviewFileContext);

  React.useEffect(() => {
    setQuickPrompts(loadPrompts());
  }, []);

  const persistPrompts = (prompts: QuickPrompt[]) => {
    setQuickPrompts(prompts);
    savePrompts(prompts);
  };

  const openAddPrompt = () => {
    setEditingPromptId(null);
    setPromptLabel("");
    setPromptText("");
    setPromptDialogOpen(true);
  };

  const openEditPrompt = (p: QuickPrompt) => {
    setEditingPromptId(p.id);
    setPromptLabel(p.label);
    setPromptText(p.text);
    setPromptDialogOpen(true);
  };

  const handleSavePrompt = () => {
    const label = promptLabel.trim();
    const text = promptText.trim();
    if (!label || !text) return;
    if (editingPromptId) {
      persistPrompts(
        quickPrompts.map((q) =>
          q.id === editingPromptId ? { ...q, label, text } : q,
        ),
      );
    } else {
      persistPrompts([...quickPrompts, { id: `qp_${Date.now()}`, label, text }]);
    }
    setPromptDialogOpen(false);
  };

  const handleDeletePrompt = (id: string) => {
    persistPrompts(quickPrompts.filter((q) => q.id !== id));
  };

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
            <button
              key={f.name}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors hover:brightness-110",
                f.action === "新建" && "border-emerald-500/30 text-emerald-400",
                f.action === "修改" && "border-amber-500/30 text-amber-400",
                f.action === "删除" && "border-red-500/30 text-red-400",
              )}
              onClick={() => {
                // 点击联动 D5 预览
                setPreviewFile({
                  name: f.name,
                  content: getMockFileContent(f.name),
                  language: getFileLanguage(f.name),
                });
              }}
            >
              <FilePlus className="h-2.5 w-2.5" />
              {f.name}
              <span className="text-muted-foreground">({f.action})</span>
            </button>
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
          onClick={() => setMentionOpen(true)}
        >
          <AtSign className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Slash className="h-3.5 w-3.5" />
        </Button>
        {/* 快捷输入 */}
        {quickPrompts.map((p) => (
          <div key={p.id} className="group relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs group-hover:pr-12"
              onClick={() => setText(p.text)}
            >
              {p.label}
            </Button>
            <div className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => openEditPrompt(p)}
              >
                <Pencil className="h-2.5 w-2.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-destructive"
                onClick={() => handleDeletePrompt(p.id)}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </Button>
            </div>
          </div>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={openAddPrompt}
        >
          <Plus className="h-3.5 w-3.5" />
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

      {/* @提及选择器 */}
      <AtMentionDialog
        open={mentionOpen}
        onClose={() => setMentionOpen(false)}
        onSelect={(item) => {
          const label = item.type === "tool" ? `@${item.name}` : `@${item.name}`;
          setPinnedTools((prev) => {
            if (prev.includes(label)) return prev;
            return [...prev, label];
          });
        }}
      />

      {/* 快捷输入 添加/编辑 对话框 */}
      {promptDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[360px] rounded-xl border border-border bg-card p-5 shadow-2xl">
            <h3 className="mb-3 text-sm font-semibold">
              {editingPromptId ? "编辑快捷输入" : "添加快捷输入"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">名称</label>
                <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                  value={promptLabel}
                  onChange={(e) => setPromptLabel(e.target.value)}
                  placeholder="如：优化代码"
                  onKeyDown={(e) => e.key === "Enter" && handleSavePrompt()}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">内容</label>
                <textarea
                  className="h-20 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="如：请帮我优化这段代码："
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSavePrompt();
                  }}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPromptDialogOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={handleSavePrompt} disabled={!promptLabel.trim() || !promptText.trim()}>
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mock 文件内容 */
function getMockFileContent(name: string): string {
  if (name.endsWith(".blend")) return "[二进制文件 — Blender 场景数据]";
  if (name === "RedMaterial") {
    return `# RedMaterial — Blender 材质节点

import bpy

mat = bpy.data.materials.new(name="RedMaterial")
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links

# 清空默认节点
nodes.clear()

# 创建 Principled BSDF
bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
bsdf.inputs[0].default_value = (1, 0, 0, 1)  # 红色
bsdf.location = (0, 300)

# 创建输出节点
output = nodes.new(type="ShaderNodeOutputMaterial")
output.location = (300, 300)

# 连接
links.new(bsdf.outputs[0], output.inputs[0])

print("红色材质创建完成")`;
  }
  return `# ${name}\n\n[文件内容占位 — STORY-0038 接入真实文件系统]`;
}

function getFileLanguage(name: string): string | undefined {
  if (name.endsWith(".py")) return "python";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "typescript";
  if (name.endsWith(".md")) return "markdown";
  return undefined;
}
