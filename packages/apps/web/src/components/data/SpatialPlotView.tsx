"use client";

/**
 * SpatialPlotView — 空间散点视图（STORY-0072）
 *
 * 对齐 docs/specs/ui/data-view-structure.md §3.3 / §5。
 * 编码工具在 shared/spatial-encoding.ts，形状在 shared/point-shapes.tsx，
 * 编码栏在 shared/SpatialEncodingBar.tsx。
 */

import * as React from "react";
import { DataPageContext, type SpatialEncoding, type DataAction } from "./DataPage";
import {
  createColorMapper,
  createShapeMapper,
  createSizeMapper,
  getThumbnailUrl,
  dataToPixel,
  pixelToData,
  DEFAULT_POINT_RADIUS,
} from "./shared/spatial-encoding";
import { PointShapeSvg } from "./shared/point-shapes";
import { EncodingBar } from "./shared/SpatialEncodingBar";
import { uiLog } from "../../lib/ui-log";

// ─── 拖动状态 ─────────────────────────────────────────────────────────────

interface DragState {
  rowIdx: number;
  startX: number;
  startY: number;
  originPx: number;
  originPy: number;
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function SpatialPlotView() {
  const { andf, spatialEncoding, dispatch } = React.useContext(DataPageContext);

  if (!spatialEncoding) return <NoEncoding dispatch={dispatch} />;
  const enc = spatialEncoding;
  if (!enc.background) return <BgUploader dispatch={dispatch} enc={enc} />;
  if (!enc.x.field || !enc.y.field) return <EmptyMsg text="请绑定 X/Y 坐标字段" />;

  return (
    <div className="flex h-full flex-col">
      <EncodingBar encoding={enc} columns={andf?.columns ?? []} dispatch={dispatch} />
      <Canvas rows={andf?.rows ?? []} encoding={enc} dispatch={dispatch} />
    </div>
  );
}

// ─── SVG 画布 ──────────────────────────────────────────────────────────────

function Canvas({
  rows,
  encoding,
  dispatch,
}: {
  rows: Record<string, unknown>[];
  encoding: SpatialEncoding;
  dispatch: React.Dispatch<DataAction>;
}) {
  const [bgSize, setBgSize] = React.useState({ w: 800, h: 600 });
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [offset, setOffset] = React.useState({ dx: 0, dy: 0 });
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const [selIdx, setSelIdx] = React.useState<number | null>(null);

  // 底图尺寸
  React.useEffect(() => {
    if (!encoding.background?.src) return;
    const img = new window.Image();
    img.onload = () => setBgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = encoding.background.src;
  }, [encoding.background?.src]);

  // 编码映射器
  const toColor = React.useMemo(() => createColorMapper(rows, encoding), [rows, encoding]);
  const toShape = React.useMemo(() => createShapeMapper(rows, encoding), [rows, encoding]);
  const toSize = React.useMemo(() => createSizeMapper(rows, encoding), [rows, encoding]);

  // Esc 取消拖动
  React.useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrag(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  const onDown = (e: React.PointerEvent, i: number, px: number, py: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ rowIdx: i, startX: e.clientX, startY: e.clientY, originPx: px, originPy: py });
    setOffset({ dx: 0, dy: 0 });
    setSelIdx(i);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setOffset({ dx: e.clientX - drag.startX, dy: e.clientY - drag.startY });
  };
  const onUp = () => {
    if (!drag) return;
    const newPx = drag.originPx + offset.dx;
    const newPy = drag.originPy + offset.dy;
    const { dataX, dataY } = pixelToData(newPx, newPy, bgSize.w, bgSize.h, encoding);
    dispatch({ type: "APPLY_UPDATE", rowIndex: drag.rowIdx, column: encoding.x.field, value: dataX });
    dispatch({ type: "APPLY_UPDATE", rowIndex: drag.rowIdx, column: encoding.y.field, value: dataY });
    dispatch({ type: "ADD_DIFF", change: { op: "update", row: drag.rowIdx, column: encoding.x.field, value: dataX } });
    dispatch({ type: "ADD_DIFF", change: { op: "update", row: drag.rowIdx, column: encoding.y.field, value: dataY } });
    uiLog.custom("SpatialPlot", "pointDragged", { idx: drag.rowIdx, x: dataX, y: dataY });
    setDrag(null);
  };

  return (
    <div className="relative flex-1 overflow-auto">
      {rows.length > 3000 && (
        <div className="absolute left-2 top-2 z-10 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
          数据量 {rows.length.toLocaleString()} 较大，拖拽可能卡顿，建议先过滤
        </div>
      )}
      <svg
        viewBox={`0 0 ${bgSize.w} ${bgSize.h}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        style={{ touchAction: "none" }}
      >
        {encoding.background?.src && <image href={encoding.background.src} width={bgSize.w} height={bgSize.h} />}
        {rows.map((row, i) => {
          const dx = Number(row[encoding.x.field]);
          const dy = Number(row[encoding.y.field]);
          if (isNaN(dx) || isNaN(dy)) return null;
          const { px, py } = dataToPixel(dx, dy, bgSize.w, bgSize.h, encoding);
          const isDragging = drag?.rowIdx === i;
          const cx = isDragging ? px + offset.dx : px;
          const cy = isDragging ? py + offset.dy : py;
          const r = toSize(row) || DEFAULT_POINT_RADIUS;
          const thumb = getThumbnailUrl(row, encoding);

          return (
            <g key={i} style={{ cursor: "grab" }}
              onPointerDown={(e) => onDown(e, i, px, py)}
              onPointerEnter={() => setHoverIdx(i)}
              onPointerLeave={() => setHoverIdx(null)}
            >
              {thumb ? (
                <ThumbPoint cx={cx} cy={cy} r={r} src={thumb} sel={selIdx === i} />
              ) : (
                <>
                  <PointShapeSvg shape={toShape(row)} cx={cx} cy={cy} radius={r} fill={toColor(row)} opacity={isDragging ? 0.7 : 1} />
                  {selIdx === i && (
                    <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke="hsl(var(--ring))" strokeWidth={2} />
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
      {hoverIdx != null && !drag && (
        <Tooltip row={rows[hoverIdx]} fields={encoding.tooltipFields ?? []} />
      )}
      {selIdx != null && rows[selIdx] && (
        <SelectionPanel row={rows[selIdx]} encoding={encoding} onClose={() => setSelIdx(null)} />
      )}
    </div>
  );
}

// ─── 缩略图点 ──────────────────────────────────────────────────────────────

function ThumbPoint({ cx, cy, r, src, sel }: { cx: number; cy: number; r: number; src: string; sel: boolean }) {
  const cid = React.useId();
  return (
    <g>
      <defs><clipPath id={cid}><circle cx={cx} cy={cy} r={r} /></clipPath></defs>
      <image href={src} x={cx - r} y={cy - r} width={r * 2} height={r * 2} clipPath={`url(#${cid})`} preserveAspectRatio="xMidYMid slice" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={sel ? "hsl(var(--ring))" : "hsl(var(--border))"} strokeWidth={sel ? 2 : 1} />
    </g>
  );
}

// ─── Tooltip ───────────────────────────────────────────────────────────────

function Tooltip({ row, fields }: { row: Record<string, unknown>; fields: string[] }) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-white/[0.08] bg-black/85 px-3 py-2 text-xs shadow-lg">
      {fields.length === 0 && <span className="text-muted-foreground">无扩展字段</span>}
      {fields.map((f) => (
        <div key={f} className="flex gap-2">
          <span className="text-muted-foreground/60">{f}:</span>
          <span className="text-foreground">{String(row[f] ?? "--")}</span>
        </div>
      ))}
    </div>
  );
}

// ─── 选中行扩展面板（点击点选中后右上浮动展示） ────────────────────────────

function SelectionPanel({
  row,
  encoding,
  onClose,
}: {
  row: Record<string, unknown>;
  encoding: SpatialEncoding;
  onClose: () => void;
}) {
  // 选中面板默认展示 tooltipFields；若用户未配置则展示编码用到的字段
  const fields = encoding.tooltipFields && encoding.tooltipFields.length > 0
    ? encoding.tooltipFields
    : [encoding.x.field, encoding.y.field,
       encoding.color?.field, encoding.shape?.field,
       encoding.size?.field, encoding.thumbnail?.field]
      .filter((f): f is string => Boolean(f));

  return (
    <div className="absolute right-2 top-2 max-w-[260px] rounded-md border border-white/[0.08] bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-muted-foreground/70">选中行</span>
        <button
          type="button"
          className="text-muted-foreground/60 hover:text-foreground"
          onClick={onClose}
          aria-label="取消选中"
        >×</button>
      </div>
      {fields.length === 0 && <div className="text-muted-foreground/50">无字段可展示</div>}
      {fields.map((f) => (
        <div key={f} className="flex gap-2 py-0.5">
          <span className="shrink-0 text-muted-foreground/60">{f}:</span>
          <span className="truncate text-foreground">{String(row[f] ?? "--")}</span>
        </div>
      ))}
    </div>
  );
}

// ─── 空态组件 ──────────────────────────────────────────────────────────────

function EmptyMsg({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</div>;
}

function BgUploader({ dispatch, enc }: { dispatch: React.Dispatch<DataAction>; enc: SpatialEncoding }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="text-3xl">📷</span>
        <p className="text-sm text-muted-foreground">上传底图以开始空间可视化</p>
        <button type="button" className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs hover:bg-white/[0.08]"
          onClick={() => ref.current?.click()}>选择图片</button>
        <input ref={ref} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const r = new FileReader();
          r.onload = () => dispatch({ type: "SET_SPATIAL_ENCODING", encoding: { ...enc, background: { src: r.result as string, origin: "top-left" } } });
          r.readAsDataURL(f);
        }} />
      </div>
    </div>
  );
}

function NoEncoding({ dispatch }: { dispatch: React.Dispatch<DataAction> }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <span className="text-3xl">📍</span>
        <p>请选择 X/Y 坐标字段并上传底图</p>
        <button type="button" className="rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-xs text-primary hover:bg-primary/[0.12]"
          onClick={() => dispatch({ type: "SET_SPATIAL_ENCODING", encoding: { x: { field: "" }, y: { field: "" } } })}>
          开始配置
        </button>
      </div>
    </div>
  );
}
