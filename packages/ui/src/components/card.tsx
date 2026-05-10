"use client";

/**
 * Card — 内容卡片容器（子组件组合式）
 * Content card container (compound component)
 *
 * 对齐 docs/specs/ui/component-inventory.md §2.4
 *
 * 2026-05-10 升级：
 *   - 新增 `variant` 区分：default（实色卡）/ glass（玻璃面，A+D 整合风格 E）
 *   - 新增 `<CardSection>` 子组件：模块内信息分组（带顶部 border-t 分隔），
 *     由 D 的"信息层级"哲学沉淀
 */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";

const cardVariants = cva("text-card-foreground", {
  variants: {
    variant: {
      /** 默认：实色卡（L3 灰阶），边框 + 阴影 */
      default: "rounded-lg border bg-card shadow-sm",
      /** 玻璃：风格 E 的玻璃面 — 用于"前台浮起"场景 */
      glass: "glass-surface",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref as unknown as React.Ref<HTMLHeadingElement>}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

/**
 * CardSection — 卡片内信息分组（D 风格沉淀）
 *
 * 用于在同一张 Card 内分隔"头部 / 数据 / 附属"等语义段落，
 * 自动在顶部添加 1px 分割线（`border-t border-white/[0.05]`）。
 *
 * 第一段（首段）传 `first` prop，则不显示顶部分割线。
 */
const CardSection = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { first?: boolean }
>(({ className, first, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "p-5",
      !first && "border-t border-white/[0.05]",
      className,
    )}
    {...props}
  />
));
CardSection.displayName = "CardSection";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardSection,
  cardVariants,
};
