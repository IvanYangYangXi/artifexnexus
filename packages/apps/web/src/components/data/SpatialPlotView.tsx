"use client";

/**
 * SpatialPlotView — 空间散点视图（STORY-0072）
 *
 * v3（2026-06-05）变化：
 *   - 底图不再强制：未上传时按数据自动包围盒 + 1000×800 默认视口
 *   - EncodingBar 增加坐标系参数输入：origin (top-left|center) + unitPerPx
 *   - 整体接入 ZoomPanContainer，支持缩放/平移
 *   - 选好 X/Y 字段即可立即看到散点（之前必须先 background 才进 Canvas）
 *   - 仍然支持上传底图 + 拖拽点反向更新数据
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
import { ZoomPanContainer } from "./shared/ZoomPanContainer";
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

  // 首次进入：自动初始化空编码，不阻塞 Canvas（之前是返回 NoEncoding 卡住）
  React.useEffect(() => {
    if (!spatialEncoding) {
      dispatch({
        type: "SET_SPATIAL_ENCODING",
        encoding: { x: { field: "" }, y: { field: "" } },
      });
    }
  }, [spatialEncoding, dispatch]);

  if (!spatialEncoding) return null;
  const enc = spatialEncoding;
  const rows = andf?.rows ?? [];
  const cols = andf?.columns ?? [];

  return (
    <div className="flex h-full flex-col">
      <EncodingBar encoding={enc} columns={cols} dispatch={dispatch} />
      {!enc.x.field || !enc.y.field ? (
        <div className="flex flex-1 items-center justify-center text-sm text-foreground/50">
          请在上方选择 X / Y 坐标字段（数值类型）
        </div>
      ) : (
        <div className="relative flex-1">
          <ZoomPanContainer>
            <Canvas rows={rows} encoding={enc} dispatch={dispatch} />
          </ZoomPanContainer>
        </div>
      )}
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
  const [bgSize, setBgSize] = React.useState({ w: 1000, h: 800 });
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [offset, setOffset] = React.useState({ dx: 0, dy: 0 });
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const [selIdx, setSelIdx] = React.useState<number | null>(null);

  // 底图尺寸：有底图 → 用底图真实分辨率；无底图 → 按数据包围盒推算
  React.useEffect(() => {
    if (encoding.background?.src) {
      const img = new window.Image();
      img.onload = () => setBgSize({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = encoding.background.src;
      return;
    }
    // 无底图：按数据范围算包围盒（边距 10%）
    if (!encoding.x.field || !encoding.y.field || rows.length === 0) {
      setBgSize({ w: 1000, h: 800 });
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const r of rows) {
      const x = Number(r[encoding.x.field]);
      const y = Number(r[encoding.y.field]);
      if (Number.isFinite(x)) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
      if (Number.isFinite(y)) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      setBgSize({ w: 1000, h: 800 });
      return;
    }
    const dx = Math.max(1, maxX - minX);
    const dy = Math.max(1, maxY - minY);
    setBgSize({ w: Math.max(400, Math.round(dx * 1.2)), h: Math.max(300, Math.round(dy * 1.2)) });
  }, [encoding.background?.src, encoding.x.field, encoding.y.field, rows]);

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
    e.stopPropagation(); // 防止触发 ZoomPanContainer 平移
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
    <div className="relative h-full w-full">
      {rows.length > 3000 && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
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
        {/* 无底图时画浅色网格作为参考 */}
        {!encoding.background?.src && (
          <>
            <defs>
              <pattern id="spatial-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="hsl(var(--border) / 0.3)" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width={bgSize.w} height={bgSize.h} fill="url(#spatial-grid)" />
          </>
        )}
        {encoding.background?.src && (
          <image href={encoding.background.src} width={bgSize.w} height={bgSize.h} preserveAspectRatio="none" />
        )}
        {rows.map((row, i) => {
          const dx = Number(row[encoding.x.field]);
          const dy = Number(row[encoding.y.field]);
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
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
      {fields.length === 0 && <span className="text-foreground/60">无扩展字段</span>}
      {fields.map((f) => (
        <div key={f} className="flex gap-2">
          <span className="text-foreground/60">{f}:</span>
          <span className="text-foreground">{String(row[f] ?? "--")}</span>
        </div>
      ))}
    </div>
  );
}

// ─── 选中行扩展面板 ────────────────────────────────────────────────────────

function SelectionPanel({
  row,
  encoding,
  onClose,
}: {
  row: Record<string, unknown>;
  encoding: SpatialEncoding;
  onClose: () => void;
}) {
  const fields = encoding.tooltipFields && encoding.tooltipFields.length > 0
    ? encoding.tooltipFields
    : [encoding.x.field, encoding.y.field,
       encoding.color?.field, encoding.shape?.field,
       encoding.size?.field, encoding.thumbnail?.field]
      .filter((f): f is string => Boolean(f));

  return (
    <div className="absolute right-2 top-2 max-w-[260px] rounded-md border border-white/[0.08] bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-foreground/70">选中行</span>
        <button
          type="button"
          className="text-foreground/60 hover:text-foreground"
          onClick={onClose}
          aria-label="取消选中"
        >×</button>
      </div>
      {fields.length === 0 && <div className="text-foreground/50">无字段可展示</div>}
      {fields.map((f) => (
        <div key={f} className="flex gap-2 py-0.5">
          <span className="shrink-0 text-foreground/60">{f}:</span>
          <span className="truncate text-foreground">{String(row[f] ?? "--")}</span>
        </div>
      ))}
    </div>
  );
}
