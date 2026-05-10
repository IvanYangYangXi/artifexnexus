"use client";

/**
 * Toast — 通知提示（基于 sonner）
 * Toast notifications based on sonner
 *
 * 对齐 docs/specs/ui/component-inventory.md §2.6
 * 使用方式：
 *   1) 应用根部挂一次 `<Toaster />`（来自本文件）
 *   2) 调用处 `import { toast } from "@artifex-nexus/ui"` 触发通知
 */
import * as React from "react";
import { Toaster as SonnerToaster, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * Toaster — 应用根部 Provider，负责渲染 toast 实例。
 * 默认位置右下角，持续 4s，主题跟随当前 html class。
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <SonnerToaster
      theme="system"
      position="bottom-right"
      duration={4000}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
export type { ToasterProps };
