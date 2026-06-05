"use client";

/**
 * useProgressiveRender — 渐进渲染 hook（性能优化）
 *
 * 适用于大数据量的 List/Card 视图：首屏只渲染 initialChunk 条，
 * 用户滚动到底部时自动追加下一批。利用 IntersectionObserver。
 *
 * 用法：
 *   const { visibleCount, sentinelRef, hasMore } = useProgressiveRender(rows.length, { chunk: 200 });
 *   {rows.slice(0, visibleCount).map(...)}
 *   {hasMore && <div ref={sentinelRef} />}
 */

import * as React from "react";

export interface ProgressiveRenderOptions {
  /** 首屏条数 */
  initialChunk?: number;
  /** 每次追加条数 */
  chunk?: number;
}

export function useProgressiveRender(total: number, opts: ProgressiveRenderOptions = {}) {
  const initialChunk = opts.initialChunk ?? 200;
  const chunk = opts.chunk ?? 200;

  const [visibleCount, setVisibleCount] = React.useState(() => Math.min(initialChunk, total));
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  // 数据变化时重置
  React.useEffect(() => {
    setVisibleCount(Math.min(initialChunk, total));
  }, [total, initialChunk]);

  // 滚动到底部时追加
  React.useEffect(() => {
    if (visibleCount >= total) return;
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + chunk, total));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, total, chunk]);

  return {
    visibleCount,
    sentinelRef,
    hasMore: visibleCount < total,
  };
}
