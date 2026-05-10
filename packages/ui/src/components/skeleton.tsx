"use client";

/**
 * Skeleton — 加载占位动画 / Loading placeholder
 *
 * 对齐 docs/specs/ui/component-inventory.md §3（P1）
 *
 * 2026-05-10 调校：
 *   - 用渐变背景 + 横向移动而非默认 animate-pulse（透明度变化在深色下肉眼几乎看不见）
 *   - 在深色下 muted(L4 14%) → muted-foreground(28%) 之间扫光
 */
import * as React from "react";

import { cn } from "../lib/cn";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        // 横向 shimmer 扫光：用伪元素覆盖一条更亮的渐变带
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_ease-in-out_infinite]",
        "before:bg-gradient-to-r before:from-transparent before:via-foreground/15 before:to-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
