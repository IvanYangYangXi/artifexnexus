"use client";

/**
 * ScrollFade — 滚动容器 + 底部过渡光晕
 *
 * 当内容溢出且未滚动到底时，底部显示渐变遮罩。
 * 使用 ResizeObserver + scroll 事件双重检测。
 */

import * as React from "react";
import { cn } from "@artifex-nexus/ui";

interface ScrollFadeProps {
  children: React.ReactNode;
  className?: string;
  /** 光晕背景色（默认 background） */
  fadeFrom?: string;
  /** 光晕高度（默认 h-6 = 24px） */
  fadeHeight?: string;
}

export function ScrollFade({ children, className, fadeFrom = "from-background", fadeHeight = "h-6" }: ScrollFadeProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = React.useState(false);

  const check = React.useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
      setShowFade(!atBottom && el.scrollHeight > el.clientHeight + 16);
    }
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener("scroll", check, { passive: true });

    // ResizeObserver 监听内容高度变化（面板展开/折叠时）
    // 用双 requestAnimationFrame 确保动画/布局完成后才判断，避免遮罩抖动。
    let pendingRaf1 = 0;
    let pendingRaf2 = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(pendingRaf1);
      cancelAnimationFrame(pendingRaf2);
      pendingRaf1 = requestAnimationFrame(() => {
        pendingRaf2 = requestAnimationFrame(() => check());
      });
    });
    ro.observe(el);

    setTimeout(check, 100);
    return () => {
      el.removeEventListener("scroll", check);
      cancelAnimationFrame(pendingRaf1);
      cancelAnimationFrame(pendingRaf2);
      ro.disconnect();
    };
  }, [check]);

  return (
    <div className={cn("relative flex min-h-0 flex-col", className)}>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        {children}
      </div>
      {showFade && (
        <div
          className={cn(
            "pointer-events-none absolute bottom-0 left-0 right-0",
            fadeHeight,
            fadeFrom,
          )}
          style={{
            background:
              "linear-gradient(to top, hsl(var(--background)) 0%, hsl(var(--background)/0.6) 30%, transparent 100%)",
            maskImage:
              "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
          }}
        />
      )}
    </div>
  );
}

