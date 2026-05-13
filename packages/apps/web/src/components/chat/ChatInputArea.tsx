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
  RotateCcw,
  Send,
  Slash,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button, Textarea, cn } from "@artifex-nexus/ui";
import { PreviewFileContext, PinnedSkillsContext } from "../shell/AppShell";
import { AtMentionDialog, type MentionItem } from "./AtMentionDialog";
import { uiLog } from "../../lib/ui-log";

interface SessionFile {
  name: string;
  action: "新建" | "修改" | "删除";
}

interface ChatInputAreaProps {
  onSend: (text: string) => void;
  onStop: () => void;
  onResume?: () => void;
  isStreaming: boolean;
  canResume: boolean;
  pendingCount: number;
  pendingMessages: string[];
  /** v4.1：删除队列中第 index 条消息 */
  onRemoveFromQueue?: (index: number) => void;
  /** v4.1：清空整个队列 */
  onClearQueue?: () => void;
  sessionFiles: SessionFile[];
  /** 打开新建对话配置面板 */
  onNewSession?: () => void;
  /** WebSocket 是否已连接（未连接时禁用发送） */
  isWsConnected?: boolean;
  /** WS 已连接但 Event Loop 退化（Gateway 繁忙，消息将排队） */
  isWsDegraded?: boolean;
  /** 合并发送开关状态（方案 §3.4） */
  mergeEnabled?: boolean;
  /** 合并发送开关回调 */
  onMergeToggle?: () => void;
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
  onResume,
  isStreaming,
  canResume,
  pendingCount,
  pendingMessages,
  onRemoveFromQueue,
  onClearQueue,
  sessionFiles,
  onNewSession,
  isWsConnected = true,
  isWsDegraded = false,
  mergeEnabled = true,
  onMergeToggle,
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
  const [hoveredPromptId, setHoveredPromptId] = React.useState<string | null>(null);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const { setPreviewFile } = React.useContext(PreviewFileContext);
  const { pinnedSkills, togglePin } = React.useContext(PinnedSkillsContext);

  React.useEffect(() => {
    setQuickPrompts(loadPrompts());
  }, []);

  // v4 重构：队列徽章延迟 500ms 显示，避免一条普通消息（microtask 即发出）的闪烁
  const [showPendingBadge, setShowPendingBadge] = React.useState(false);
  React.useEffect(() => {
    if (pendingCount === 0) {
      setShowPendingBadge(false);
      return;
    }
    // pendingCount > 0 → 500ms 后才显示徽章
    const timer = setTimeout(() => setShowPendingBadge(true), 500);
    return () => clearTimeout(timer);
  }, [pendingCount]);

  // 监听预输入事件（Tool 运行 → 预填输入框）
  React.useEffect(() => {
    const handler = (e: Event) => {
      const { text } = (e as CustomEvent).detail;
      setText(text);
      textareaRef.current?.focus();
    };
    window.addEventListener("artifex:prefillInput", handler);
    return () => window.removeEventListener("artifex:prefillInput", handler);
  }, []);

  // 清理 hover 延迟计时器
  React.useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
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
    // 仅当完全未连接时阻止发送；degraded 状态下允许发送（消息进入队列）
    if (!text.trim() || (!isWsConnected && !isWsDegraded)) {
      uiLog.warn("ChatInput", "sendBlocked", { hasText: !!text.trim(), isWsConnected, isWsDegraded });
      return;
    }
    uiLog.send("ChatInput", "send", { textLen: text.length, isStreaming, pendingCount, isWsDegraded });
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
      {/* 信息队列区 — AI 生成中 / WS 不可用时显示
       * v4.1：消息可见可操作（删除/清空整个队列）
       * 队列徽章 500ms 延迟显示（避免普通消息闪烁） */}
      {showPendingBadge && pendingCount > 0 && (
        <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-1.5">
          <div className="flex items-center gap-2 text-xs">
            <Clock className="h-3 w-3 text-amber-400" />
            <span className="text-amber-300">
              队列中 ({pendingCount}) — 当前生成完成后自动发送
            </span>
            {onClearQueue && pendingCount > 1 && (
              <button
                onClick={() => { uiLog.click("ChatInput", "clearQueue", { pendingCount }); onClearQueue(); }}
                className="text-[10px] text-amber-400/70 hover:text-amber-300 underline-offset-2 hover:underline transition-colors"
                title="清空整个队列"
              >
                清空
              </button>
            )}
            <div className="flex-1" />
            <label
              className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none whitespace-nowrap"
              title="多条排队消息合并为一条发送"
            >
              <input
                type="checkbox"
                checked={mergeEnabled}
                onChange={(e) => { uiLog.click("ChatInput", "mergeToggle", { newVal: e.target.checked, pendingCount }); onMergeToggle?.(); }}
                className="h-3 w-3 cursor-pointer accent-primary"
              />
              合并发送
            </label>
          </div>
          {pendingMessages.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {pendingMessages.map((msg, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-1.5 rounded bg-amber-500/[0.05] px-2 py-1 text-[11px]"
                >
                  <span className="shrink-0 text-amber-400/70 font-mono">#{i + 1}</span>
                  <span className="flex-1 truncate text-foreground/80">{msg}</span>
                  {onRemoveFromQueue && (
                    <button
                      onClick={() => { uiLog.click("ChatInput", "removeFromQueue", { index: i, msgPreview: msg.slice(0, 30) }); onRemoveFromQueue(i); }}
                      className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 transition-all"
                      title="从队列移除该消息"
                      aria-label="删除该队列消息"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
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

      {/* C3-钉选区：钉选的 Skill */}
      {pinnedSkills.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {pinnedSkills.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
            >
              @{name}
              <button
                onClick={() => togglePin(name)}
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
        {quickPrompts.map((p) => {
          const isHovered = hoveredPromptId === p.id;
          const handleMouseEnter = () => {
            if (hideTimerRef.current) {
              clearTimeout(hideTimerRef.current);
              hideTimerRef.current = null;
            }
            setHoveredPromptId(p.id);
          };
          const handleMouseLeave = () => {
            hideTimerRef.current = setTimeout(() => {
              setHoveredPromptId(null);
            }, 250);
          };
          return (
            <div key={p.id} className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
              {/* 编辑/删除浮动栏 — 显示在按钮上方，不影响按钮宽度 */}
              <div
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 bottom-full mb-1 flex items-center gap-0.5 rounded-md border border-border bg-popover px-1 py-0.5 shadow-md transition-opacity duration-150",
                  isHovered ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
                )}
              >
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
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => {
                  setText(p.text);
                  textareaRef.current?.focus();
                }}
              >
                {p.label}
              </Button>
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={openAddPrompt}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { uiLog.click("ChatInput", "newSession"); onNewSession?.(); }}>
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
          className="min-h-[80px] max-h-[200px] flex-1 resize-none border-white/[0.08] bg-white/[0.03] backdrop-blur-md focus-visible:border-primary/40 focus-visible:bg-white/[0.05]"
        />

        {/* C3c 发送区 */}
        <div className="flex items-center gap-1.5">
          {/* 停止按钮 — 仅在流式生成中显示 */}
          {isStreaming && (
            <Button
              size="icon"
              variant="destructive"
              className="h-9 w-9"
              onClick={() => { uiLog.click("ChatInput", "stop"); onStop(); }}
              title="停止生成"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          )}

          {/* 恢复按钮 — 已停止可恢复时显示 */}
          {!isStreaming && canResume && onResume && (
            <Button
              size="icon"
              variant="default"
              className="h-9 w-9"
              onClick={() => { uiLog.click("ChatInput", "resume"); onResume(); }}
              title="继续生成"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}

          {/* 发送按钮 — WS 完全断连或输入为空时禁用；degraded 时可用（消息排队） */}
          <Button
            size="icon"
            className={cn(
              "h-9 w-9 rounded-full",
              isWsDegraded && "bg-amber-600/80 hover:bg-amber-600 text-amber-100",
            )}
            onClick={handleSend}
            disabled={!text.trim() || (!isWsConnected && !isWsDegraded)}
            title={!isWsConnected && !isWsDegraded ? "WebSocket 未连接" : isWsDegraded ? "Gateway 繁忙，消息将排队发送" : undefined}
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
          if (item.type === "skill") {
            togglePin(item.name);
          } else {
            // Tool: 预输入提示词到 Chat 输入框
            setText(`请帮我运行工具 "${item.name}"`);
          }
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
