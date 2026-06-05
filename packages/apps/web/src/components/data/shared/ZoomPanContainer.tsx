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
 *   - 中键拖 / Alt+左键拖：平移
 *   - 双击空白处：重置
 *   - 右上角浮动按钮：+/-/重置
 *
 * 关键点：
 *   1. wheel 必须用 native addEventListener + {passive:false}，React 的 onWheel
 *      被注册为 passive，preventDefault 不生效且会报警告。
 *   2. transform 应用在一个绝对定位的"内层"上，外层尺寸不受影响，
 *      ResponsiveContainer 的 ResizeObserver 才能拿到逻辑像素。
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
  const innerRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(initialScale);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const dragRef = React.useRef<{ sx: number; sy: number; tx0: number; ty0: number } | null>(null);

  // 用 ref 同步 state 给 native wheel handler（避免闭包过期）
  const scaleRef = React.useRef(scale);
  const txRef = React.useRef(tx);
  const tyRef = React.useRef(ty);
  React.useEffect(() => { scaleRef.current = scale; }, [scale]);
  React.useEffect(() => { txRef.current = tx; }, [tx]);
  React.useEffect(() => { tyRef.current = ty; }, [ty]);

  const reset = React.useCallback(() => {
    setScale(initialScale);
    setTx(0);
    setTy(0);
  }, [initialScale]);

  // Native wheel 监听（React 的 onWheel 是 passive，无法 preventDefault）
  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const cur = scaleRef.current;
      const next = Math.min(maxScale, Math.max(minScale, cur * factor));
      if (next === cur) return;
      const k = next / cur;
      // 锚点：缩放后让鼠标指向同一数据点
      setTx(mx - (mx - txRef.current) * k);
      setTy(my - (my - tyRef.current) * k);
      setScale(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [maxScale, minScale]);

  // 平移：中键 或 Alt+左键
  const onPointerDown = (e: React.PointerEvent) => {
    if (!pannable) return;
    const isMiddle = e.button === 1;
    const isAlt = e.altKey && e.button === 0;
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
    // 双击 wrapper 或 inner 容器（非图表子元素）重置
    if (e.target === wrapperRef.current || e.target === innerRef.current) reset();
  };

  const zoomIn = () => setScale((s) => Math.min(maxScale, s * 1.25));
  const zoomOut = () => setScale((s) => Math.max(minScale, s / 1.25));

  return (
    <div
      ref={wrapperRef}
      className={`relative h-full w-full overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-default"} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title={pannable ? "滚轮缩放 · Alt+拖动 或 中键拖动平移 · 双击空白处重置" : "滚轮缩放"}
    >
      {/* inner: 真正承载 transform，绝对定位填满外层，宽高固定为外层尺寸
          这样 ResponsiveContainer 内部的 ResizeObserver 测到的是逻辑像素 */}
      <div
        ref={innerRef}
        className="absolute inset-0"
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
