"use client";

/**
 * MarkdownPreview — 文档预览 Markdown 渲染器
 *
 * 为预览面板（Skill ReadmeTab、文件预览等）提供增强的 Markdown 渲染，
 * 样式对标 GitHub README / 技术文档风格。
 *
 * 与 ChatMessageList 的 MarkdownContent 区别：
 *   - 标题层级更分明（h1 带底部分割线）
 *   - 表格有斑马纹、圆角、表头底色
 *   - 代码块始终展开（collapsible=false），带语法高亮
 *   - 引用块有左侧彩色边框
 *   - 列表间距更宽松
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@artifex-nexus/ui";
import { CodeBlock } from "./CodeBlock";

// ═══════════════════════════════════════════════════════════════════════════
// 计数器：为代码块生成稳定的递增索引 key
// ═══════════════════════════════════════════════════════════════════════════
let globalCodeIndex = 0;

export interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

/**
 * MarkdownPreview — 增强的 Markdown 渲染器
 *
 * 使用自定义 components 替代 Tailwind prose，精细控制每个元素的样式。
 */
export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const safeContent = (content ?? "").toString();
  if (!safeContent) return null;

  // 每次渲染重置计数器
  globalCodeIndex = 0;

  return (
    <div className={cn("markdown-preview", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ── 标题（带级别角标 + 层级视觉区分）────────────────────────
          h1({ children, ...props }) {
            return (
              <h1
                className="mt-6 mb-3 pb-2 text-lg font-bold text-foreground border-b border-border/50 first:mt-0"
                {...props}
              >
                <span className="mr-2 inline-flex items-center rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-mono font-normal text-primary align-middle">
                  H1
                </span>
                {children}
              </h1>
            );
          },
          h2({ children, ...props }) {
            return (
              <h2
                className="mt-5 mb-2 border-l-[3px] border-amber-500/40 pl-3 text-base font-semibold text-foreground/90 first:mt-0"
                {...props}
              >
                <span className="mr-2 inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-mono font-normal text-amber-400 align-middle">
                  H2
                </span>
                {children}
              </h2>
            );
          },
          h3({ children, ...props }) {
            return (
              <h3
                className="mt-4 mb-1.5 pl-1 text-sm font-semibold text-foreground/85 first:mt-0"
                {...props}
              >
                <span className="mr-2 inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono font-normal text-muted-foreground align-middle">
                  H3
                </span>
                {children}
              </h3>
            );
          },
          h4({ children, ...props }) {
            return (
              <h4
                className="mt-3 mb-1 pl-2 text-xs font-semibold text-foreground/80 first:mt-0"
                {...props}
              >
                <span className="mr-1.5 inline-flex items-center rounded bg-muted/30 px-1 py-0.5 text-[9px] font-mono font-normal text-muted-foreground/60 align-middle">
                  H4
                </span>
                {children}
              </h4>
            );
          },

          // ── 段落与内联 ──────────────────────────────────────────────
          p({ children, ...props }) {
            return (
              <div
                className="my-2 text-xs leading-relaxed text-foreground/85 first:mt-0 last:mb-0"
                {...props}
              >
                {children}
              </div>
            );
          },
          strong({ children, ...props }) {
            return (
              <strong
                className="font-semibold text-foreground"
                {...props}
              >
                {children}
              </strong>
            );
          },
          em({ children, ...props }) {
            return (
              <em className="italic text-foreground/75" {...props}>
                {children}
              </em>
            );
          },
          del({ children, ...props }) {
            return (
              <del
                className="line-through text-muted-foreground/60"
                {...props}
              >
                {children}
              </del>
            );
          },
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline underline-offset-2 transition-colors"
                {...props}
              >
                {children}
              </a>
            );
          },

          // ── 行内代码 ────────────────────────────────────────────────
          code({ className, children, ...props }: any) {
            // 块级代码被 pre() 拦截，这里只处理行内代码
            if (className?.includes("language-")) {
              // 兜底：ReactMarkdown 没走 pre 的特殊情况
              const match = /language-(\w+)/.exec(className);
              const codeStr =
                (children == null ? "" : String(children)).replace(/\n$/, "");
              return (
                <CodeBlock
                  language={match?.[1] ?? ""}
                  code={codeStr}
                  collapsible={false}
                  className="my-3"
                />
              );
            }
            return (
              <code
                className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-rose-300/90"
                {...props}
              >
                {children}
              </code>
            );
          },

          // ── 块级代码 ────────────────────────────────────────────────
          pre({ children }: any) {
            const arr = React.Children.toArray(children);
            const codeEl: any = arr.find((c: any) => {
              if (!c || typeof c !== "object") return false;
              return (
                c.type === "code" ||
                c.props?.className?.includes("language-")
              );
            });

            if (!codeEl) {
              // 非标准 fenced code，降级为简单 pre
              return (
                <pre className="my-3 overflow-x-auto rounded-lg border border-border/40 bg-muted/30 p-3 text-[12px]">
                  {children}
                </pre>
              );
            }

            const className: string = codeEl.props?.className ?? "";
            const match = /language-(\w+)/.exec(className);
            const rawChildren = codeEl.props?.children;
            const codeStr = (
              rawChildren == null ? "" : String(rawChildren)
            ).replace(/\n$/, "");

            return (
              <CodeBlock
                language={match?.[1] ?? ""}
                code={codeStr}
                collapsible={false}
                className="my-3"
              />
            );
          },

          // ── 引用块 ──────────────────────────────────────────────────
          blockquote({ children, ...props }) {
            return (
              <blockquote
                className="border-l-[3px] border-primary/40 pl-4 py-2 my-3 bg-primary/[0.04] rounded-r-md text-xs text-muted-foreground [&>div]:text-foreground/80"
                {...props}
              >
                {children}
              </blockquote>
            );
          },

          // ── 表格（斑马纹 + 圆角容器）────────────────────────────────
          table({ children, ...props }) {
            return (
              <div className="my-3 overflow-x-auto rounded-lg border border-border/40">
                <table
                  className="w-full border-collapse text-xs"
                  {...props}
                >
                  {children}
                </table>
              </div>
            );
          },
          thead({ children, ...props }) {
            return (
              <thead className="bg-muted/30" {...props}>
                {children}
              </thead>
            );
          },
          tbody({ children, ...props }) {
            return (
              <tbody
                className="[&_tr:nth-child(even)]:bg-muted/10"
                {...props}
              >
                {children}
              </tbody>
            );
          },
          th({ children, ...props }) {
            return (
              <th
                className="border border-border/30 px-3 py-2 text-left font-semibold text-foreground/90"
                {...props}
              >
                {children}
              </th>
            );
          },
          td({ children, ...props }) {
            return (
              <td
                className="border border-border/30 px-3 py-2 text-foreground/75"
                {...props}
              >
                {children}
              </td>
            );
          },

          // ── 列表 ────────────────────────────────────────────────────
          ul({ children, ...props }) {
            return (
              <ul
                className="my-2 space-y-1 pl-5 text-xs text-foreground/80 list-disc marker:text-muted-foreground first:mt-0"
                {...props}
              >
                {children}
              </ul>
            );
          },
          ol({ children, ...props }) {
            return (
              <ol
                className="my-2 space-y-1 pl-5 text-xs text-foreground/80 list-decimal marker:text-muted-foreground first:mt-0"
                {...props}
              >
                {children}
              </ol>
            );
          },
          li({ children, ...props }) {
            return (
              <li className="leading-relaxed" {...props}>
                {children}
              </li>
            );
          },

          // ── 分割线 ──────────────────────────────────────────────────
          hr(props) {
            return <hr className="my-4 border-border/20" {...props} />;
          },

          // ── 图片 ────────────────────────────────────────────────────
          img({ src, alt, ...props }) {
            return (
              <img
                src={src}
                alt={alt}
                className="rounded-md max-w-full my-3"
                {...props}
              />
            );
          },

          // ── 任务列表 ────────────────────────────────────────────────
          input({ type, checked, ...props }: any) {
            if (type === "checkbox") {
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="mr-1.5 accent-primary"
                  {...props}
                />
              );
            }
            return <input type={type} checked={checked} {...props} />;
          },
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  );
}
