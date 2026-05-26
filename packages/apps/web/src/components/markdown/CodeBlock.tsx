"use client";

/**
 * CodeBlock — 共享代码块组件
 *
 * 从 ChatMessageList 抽取，同时服务聊天消息和文档预览两个场景。
 *
 * Props:
 *   - collapsible: 是否允许折叠（聊天场景传 true，预览面板传 false）
 *   - cacheKey:   折叠状态持久化 key（仅在 collapsible=true 时需要）
 *   - language:   编程语言标识符
 *   - code:       代码内容
 */

import * as React from "react";
import { Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button, cn } from "@artifex-nexus/ui";

// ─── 折叠状态全局缓存（仅聊天场景使用）──────────────────────────────────
const codeBlockExpandedCache = new Map<string, boolean>();

/**
 * SafeSyntaxHighlighter — 错误边界包装 Prism 高亮器。
 *
 * react-syntax-highlighter 在不支持的 language 或非法输入上会抛错，
 * 抛错冒泡到 React 顶层会导致整棵组件树 unmount。
 * 用 ErrorBoundary + try-catch 双层保护，失败时降级为普通 <pre>。
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

export interface CodeBlockProps {
  language: string;
  code: string;
  /** 是否允许折叠（默认 true，聊天场景）；预览面板传 false */
  collapsible?: boolean;
  /** 折叠状态持久化 key（collapsible=true 时使用） */
  cacheKey?: string;
  /** 外层容器额外 className */
  className?: string;
}

export function CodeBlock({
  language,
  code,
  collapsible = true,
  cacheKey,
  className,
}: CodeBlockProps) {
  // 处理代码字符串（去首尾空白、空值兜底、兼容 Windows 换行符）
  const safeCode = (code ?? "").toString().replace(/\r\n/g, "\n");
  const trimmed = safeCode.replace(/\n+$/, "");
  const lines = trimmed.split("\n");
  const shouldCollapse = collapsible && lines.length > 5;

  // 从外部缓存恢复展开状态
  const cachedState = cacheKey ? codeBlockExpandedCache.get(cacheKey) : undefined;
  const initialExpanded = cachedState !== undefined ? cachedState : !shouldCollapse;
  const [expanded, setExpanded] = React.useState(initialExpanded);

  // 同步缓存
  const handleToggle = React.useCallback(
    (next: boolean) => {
      setExpanded(next);
      if (cacheKey) {
        codeBlockExpandedCache.set(cacheKey, next);
      }
    },
    [cacheKey],
  );

  const displayCode =
    expanded || !shouldCollapse ? trimmed : lines.slice(0, 5).join("\n") + "\n";

  // language 兜底
  const safeLanguage = (language || "text").toLowerCase();

  return (
    <div className={cn("my-2 overflow-hidden rounded-lg border border-border/40", className)}>
      {/* 顶部栏：语言标签 + 复制按钮 */}
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
          {!collapsible && lines.length > 0 && (
            <span className="text-[10px]">{lines.length} 行</span>
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

      {/* 代码内容 */}
      <div
        className={cn(
          !expanded && shouldCollapse && "max-h-[140px] overflow-hidden",
        )}
      >
        <SafeSyntaxHighlighter language={safeLanguage} code={displayCode} />
      </div>

      {/* 折叠提示 */}
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
