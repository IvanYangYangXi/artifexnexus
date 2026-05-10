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
}

export function ScrollFade({ children, className, fadeFrom = "from-background" }: ScrollFadeProps) {
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
    const ro = new ResizeObserver(() => {
      setTimeout(check, 50);
    });
    ro.observe(el);

    setTimeout(check, 100);
    return () => {
      el.removeEventListener("scroll", check);
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
            "pointer-events-none absolute bottom-0 left-0 right-0 h-6",
            "bg-gradient-to-t from-background via-background/60 to-transparent",
            fadeFrom,
          )}
        />
      )}
    </div>
  );
}

