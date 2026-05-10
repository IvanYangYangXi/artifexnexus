"use client";

/**
 * Avatar — 头像（基于 Radix Avatar）
 * Avatar based on Radix Avatar
 *
 * 对齐 docs/specs/ui/component-inventory.md §4
 *
 * 2026-05-10 升级（风格 E "跳进式"）：
 *   - 新增 ring prop：默认 'primary'（1px primary/40 描边环），
 *     可选 'none' / 'accent'（白色光环）
 *   - AvatarFallback 默认 bg-primary/15 + text-primary（D 风的"身份色"）
 */
import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";

const avatarVariants = cva(
  "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
  {
    variants: {
      ring: {
        /** 默认：primary 描边环（D 风装饰，去渐变） */
        primary:
          "ring-1 ring-primary/40 ring-offset-2 ring-offset-background",
        /** 白色淡环：用于深色玻璃面背景（更柔和） */
        accent:
          "ring-1 ring-white/[0.10] ring-offset-2 ring-offset-background",
        /** 无装饰环 */
        none: "",
      },
    },
    defaultVariants: {
      ring: "primary",
    },
  },
);

export interface AvatarProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {}

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(({ className, ring, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(avatarVariants({ ring }), className)}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      // 默认身份色（D 风沉淀）：primary 微底 + primary 文字
      "flex h-full w-full items-center justify-center rounded-full bg-primary/15 text-sm font-medium text-primary",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback, avatarVariants };
