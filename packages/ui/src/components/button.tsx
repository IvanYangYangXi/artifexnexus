"use client";

/**
 * Button — 主操作按钮 / Primary action button
 *
 * 变体：default / secondary / destructive / outline / ghost / link
 * 尺寸：sm / default / lg / icon
 * 形态：square（默认，rounded-md） / pill（rounded-full，E 风主 CTA）
 *
 * 对齐 docs/specs/ui/component-inventory.md §2.1
 *
 * 2026-05-10 升级（风格 E "跳进式"）：
 *   - default/secondary/destructive 默认带顶部 inset 1px 高光（玻璃感）
 *   - default 投射 primary 色光晕（hover 时 brightness 提升 + 光晕加强）
 *   - outline / ghost 自动玻璃化（半透明白底 + blur）
 *   - 新增 shape="pill" 形态（rounded-full）用于 chat 主 CTA / 成对按钮组
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium",
    "transition-[color,background-color,border-color,box-shadow,filter,transform] duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:scale-[0.98]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        /** 主操作 — 实色 primary + 顶部 inset 高光 + 投射光晕 */
        default: [
          "bg-primary text-primary-foreground",
          "shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.5),inset_0_1px_0_0_rgba(255,255,255,0.18)]",
          "hover:brightness-110 hover:shadow-[0_6px_22px_-4px_hsl(var(--primary)/0.6),inset_0_1px_0_0_rgba(255,255,255,0.22)]",
        ].join(" "),
        /** 次操作 — 玻璃面，hover 提亮 */
        secondary: [
          "border border-white/[0.10] bg-white/[0.05] backdrop-blur-md text-foreground",
          "hover:border-white/[0.16] hover:bg-white/[0.09]",
        ].join(" "),
        /** 危险 — 半透明 destructive 玻璃感，文字保持高可读 */
        destructive: [
          "border border-rose-400/30 bg-rose-500/[0.10] backdrop-blur-md",
          "text-rose-200",
          "hover:border-rose-400/50 hover:bg-rose-500/[0.18]",
        ].join(" "),
        /** outline — 透明背景 + 边框，hover 玻璃化 */
        outline: [
          "border border-border bg-transparent text-foreground",
          "hover:border-white/[0.14] hover:bg-white/[0.05] hover:backdrop-blur-md",
        ].join(" "),
        /** ghost — 无边框，hover 显示淡玻璃 */
        ghost:
          "text-foreground hover:bg-white/[0.05] hover:backdrop-blur-md",
        /** link — 文字按钮 */
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
      shape: {
        square: "rounded-md",
        pill: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "square",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 将样式透传给子元素（如 `<a>`），用于作为链接使用 */
  asChild?: boolean;
  /** loading 状态：禁用点击并可由调用方渲染 spinner */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      shape,
      asChild = false,
      loading,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, shape, className }))}
        disabled={disabled || loading}
        data-loading={loading ? "" : undefined}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
