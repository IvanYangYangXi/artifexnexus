"use client";

/**
 * ZoomPanContainer — 通用图表缩放/平移容器
 *
 * 适用于任何"画在子元素里"的图表（Recharts SVG / 自绘 SVG / Canvas）。
 * 通过 CSS transform 实现，不破坏子图表自身的事件/坐标系。
 *
 * 用法：
 *   <ZoomPanContainer>
 *     <ResponsiveContainer><BarChart .../></ResponsiveContainer>
 *   </ZoomPanContainer>
 *
 * 交互：
 *   - 滚轮：缩放（以鼠标位置为中心）
 *   - 中键拖 / 空格+左键拖 / 普通左键拖空白处：平移
 *   - 双击：重置
 *   - 右上角浮动按钮：+/-/重置
 *
 * 关键设计：transform 用 translate 在前 scale 在后，事件层用 wrapper 拦截。
 */

import * as React from "react";
import { Plus, Minus, Maximize2 } from "lucide-react";

interface Props {
  children: React.ReactNode;
  /** 是否允许平移（false 时只允许缩放） */
  pannable?: boolean;
  /** 缩放最小值（默认 0.2） */
  minScale?: number;
  /** 缩放最大值（默认 8） */
  maxScale?: number;
  /** 重置后的初始 scale（默认 1） */
  initialScale?: number;
  /** 容器额外 className */
  className?: string;
}

export function ZoomPanContainer({
  children,
  pannable = true,
  minScale = 0.2,
  maxScale = 8,
  initialScale = 1,
  className = "",
}: Props) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(initialScale);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const dragRef = React.useRef<{ sx: number; sy: number; tx0: number; ty0: number } | null>(null);

  const reset = React.useCallback(() => {
    setScale(initialScale);
    setTx(0);
    setTy(0);
  }, [initialScale]);

  // 滚轮缩放：以鼠标位置为锚点
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = Math.min(maxScale, Math.max(minScale, scale * factor));
    // 锚点：缩放后让鼠标指向同一数据点
    const k = next / scale;
    setTx(mx - (mx - tx) * k);
    setTy(my - (my - ty) * k);
    setScale(next);
  };

  // 平移：button 1 (中键) 或 button 0 (左键) + 点击在 wrapper 自身（不在子元素上）
  const onPointerDown = (e: React.PointerEvent) => {
    if (!pannable) return;
    // 左键时只接受点空白处（避免和子图表的交互冲突）
    // 中键或带 Alt/Space 总是开启平移
    const isMiddle = e.button === 1;
    const isAlt = e.altKey;
    if (!isMiddle && !isAlt) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragRef.current = { sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !dragRef.current) return;
    setTx(dragRef.current.tx0 + (e.clientX - dragRef.current.sx));
    setTy(dragRef.current.ty0 + (e.clientY - dragRef.current.sy));
  };

  const onPointerUp = () => {
    setDragging(false);
    dragRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // 双击空白处重置
    if (e.target === wrapperRef.current) reset();
  };

  const zoomIn = () => setScale((s) => Math.min(maxScale, s * 1.25));
  const zoomOut = () => setScale((s) => Math.max(minScale, s / 1.25));

  return (
    <div
      ref={wrapperRef}
      className={`relative h-full w-full overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-default"} ${className}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title={pannable ? "滚轮缩放 · Alt+拖动 或 中键拖动平移 · 双击空白处重置" : "滚轮缩放"}
    >
      <div
        className="h-full w-full"
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: "0 0",
          transition: dragging ? "none" : "transform 0.05s linear",
        }}
      >
        {children}
      </div>

      {/* 控制器：右上角浮动按钮 */}
      <div className="pointer-events-auto absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-white/[0.08] bg-background/80 p-0.5 backdrop-blur-sm">
        <button
          type="button"
          className="rounded p-1 text-foreground/70 hover:bg-white/[0.08] hover:text-foreground"
          onClick={zoomOut}
          title="缩小 (滚轮向下)"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-10 select-none text-center font-mono text-[10px] text-foreground/60">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          className="rounded p-1 text-foreground/70 hover:bg-white/[0.08] hover:text-foreground"
          onClick={zoomIn}
          title="放大 (滚轮向上)"
        >
          <Plus className="h-3 w-3" />
        </button>
        <div className="mx-0.5 h-3 w-px bg-white/10" />
        <button
          type="button"
          className="rounded p-1 text-foreground/70 hover:bg-white/[0.08] hover:text-foreground"
          onClick={reset}
          title="重置 (双击空白处)"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
