"use client";

/**
 * ScrollFade — 滚动容器 + 底部过渡光晕
 *
 * 当内容溢出且未滚动到底时，底部显示渐变遮罩。
 */

import * as React from "react";
import { cn } from "@artifex-nexus/ui";

interface ScrollFadeProps {
  children: React.ReactNode;
  className?: string;
}

export function ScrollFade({ children, className }: ScrollFadeProps) {
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
    if (el) {
      el.addEventListener("scroll", check, { passive: true });
      setTimeout(check, 100);
      return () => el.removeEventListener("scroll", check);
    }
  }, [check]);

  return (
    <div className={cn("relative", className)}>
      <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden">
        {children}
      </div>
      {showFade && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-panel via-panel/70 to-transparent" />
      )}
    </div>
  );
}
