"use client";

/**
 * SceneHeatmapView — 密度热力图（STORY-0073）
 *
 * 复用 STORY-0072 Spatial Plot 底图 + 坐标系底座，叠加密度热力层。
 * 对齐 docs/specs/ui/data-view-structure.md §6。
 *
 * 渲染层：[底图] → [密度色块层] → [可选坐标点层]
 * 计算在 shared/heatmap-kde.ts，配色在 shared/heatmap-colors.ts。
 */

import * as React from "react";
import { DataPageContext, type HeatmapEncoding, type DataAction } from "./DataPage";
import { computeDensityGrid, colorFromScale, DEFAULT_GRID_SIZE } from "./shared/heatmap-kde";
import { COLOR_SCALES, type ColorScaleId } from "./shared/heatmap-colors";
import { dataToPixel } from "./shared/spatial-encoding";
import { uiLog } from "../../lib/ui-log";

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function SceneHeatmapView() {
  const { andf, heatmapEncoding, dispatch } = React.useContext(DataPageContext);

  if (!heatmapEncoding) return <NoEncoding dispatch={dispatch} />;
  const enc = heatmapEncoding;
  if (!enc.background) return <BgUploader dispatch={dispatch} enc={enc} />;
  if (!enc.x.field || !enc.y.field) return <EmptyMsg text="请绑定 X/Y 坐标字段" />;

  return (
    <div className="flex h-full flex-col">
      <ConfigBar encoding={enc} dispatch={dispatch} />
      <HeatmapCanvas rows={andf?.rows ?? []} encoding={enc} />
    </div>
  );
}

// ─── 配置面板 ──────────────────────────────────────────────────────────────

function ConfigBar({
  encoding,
  dispatch,
}: {
  encoding: HeatmapEncoding;
  dispatch: React.Dispatch<DataAction>;
}) {
  const set = (patch: Partial<HeatmapEncoding>) => {
    dispatch({ type: "SET_HEATMAP_ENCODING", encoding: { ...encoding, ...patch } });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] bg-white/[0.01] px-3 py-2 text-xs">
      {/* bandwidth */}
      <LabeledSelect label="带宽" value={String(encoding.bandwidth)}
        options={["8", "16", "24", "48"]}
        onChange={(v) => set({ bandwidth: Number(v) })} />
      {/* opacity */}
      <LabeledSelect label="透明度" value={String(encoding.opacity)}
        options={["0", "0.3", "0.5", "0.7", "1"]}
        onChange={(v) => set({ opacity: Number(v) })} />
      {/* colorScale */}
      <LabeledSelect label="色阶" value={encoding.colorScale}
        options={["viridis", "inferno", "blues"]}
        onChange={(v) => set({ colorScale: v as ColorScaleId })} />
      {/* showPoints */}
      <label className="flex items-center gap-1.5 text-muted-foreground">
        <input type="checkbox" className="rounded"
          checked={encoding.showPoints}
          onChange={(e) => set({ showPoints: e.target.checked })} />
        显示坐标点
      </label>
      {/* 底图更换 */}
      <BgButton encoding={encoding} dispatch={dispatch} />
    </div>
  );
}

function LabeledSelect({
  label, value, options, onChange,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-muted-foreground/60">{label}:</span>
      <select className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary/40"
        value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function BgButton({ encoding, dispatch }: {
  encoding: HeatmapEncoding;
  dispatch: React.Dispatch<DataAction>;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs text-muted-foreground hover:bg-white/[0.08]"
        onClick={() => ref.current?.click()}>换底图</button>
      <input ref={ref} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => dispatch({ type: "SET_HEATMAP_ENCODING", encoding: { ...encoding, background: { src: r.result as string, origin: "top-left" } } });
        r.readAsDataURL(f);
      }} />
    </>
  );
}

// ─── 画布 ──────────────────────────────────────────────────────────────────

function HeatmapCanvas({
  rows,
  encoding,
}: {
  rows: Record<string, unknown>[];
  encoding: HeatmapEncoding;
}) {
  const [bgSize, setBgSize] = React.useState({ w: 800, h: 600 });

  React.useEffect(() => {
    if (!encoding.background?.src) return;
    const img = new window.Image();
    img.onload = () => setBgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = encoding.background.src;
  }, [encoding.background?.src]);

  // 密度计算（带宽 / 坐标字段 / 底图原点 / 单位变化时重算）
  const grid = React.useMemo(
    () => computeDensityGrid(rows, encoding, bgSize.w, bgSize.h, DEFAULT_GRID_SIZE),
    [
      rows,
      encoding.bandwidth,
      encoding.x.field,
      encoding.y.field,
      encoding.background?.origin,
      encoding.background?.unitPerPx,
      bgSize.w,
      bgSize.h,
    ],
  );

  // 热力色块列表
  const heatRects = React.useMemo(() => {
    const scale = COLOR_SCALES[encoding.colorScale];
    const result: { key: string; x: number; y: number; color: string }[] = [];
    for (let r = 0; r < grid.gridSize; r++) {
      for (let c = 0; c < grid.gridSize; c++) {
        const d = grid.density[r * grid.gridSize + c];
        if (d <= 0) continue;
        result.push({
          key: `${r}-${c}`,
          x: c * grid.cellW,
          y: r * grid.cellH,
          color: colorFromScale(scale, d),
        });
      }
    }
    return result;
  }, [grid, encoding.colorScale]);

  // 坐标点列表（showPoints 时）
  const points = React.useMemo(() => {
    if (!encoding.showPoints) return [];
    return rows.map((row, i) => {
      const dx = Number(row[encoding.x.field]);
      const dy = Number(row[encoding.y.field]);
      if (isNaN(dx) || isNaN(dy)) return null;
      const { px, py } = dataToPixel(dx, dy, bgSize.w, bgSize.h, {
        x: encoding.x, y: encoding.y,
        background: encoding.background,
      });
      return { key: i, cx: px, cy: py };
    }).filter((p): p is { key: number; cx: number; cy: number } => p !== null);
  }, [rows, encoding.showPoints, encoding.x.field, encoding.y.field, bgSize, encoding.background]);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <svg className="flex-1 w-full" viewBox={`0 0 ${bgSize.w} ${bgSize.h}`} preserveAspectRatio="xMidYMid meet">
        {/* 底图 */}
        {encoding.background?.src && <image href={encoding.background.src} width={bgSize.w} height={bgSize.h} />}
        {/* 热力色块 */}
        <g opacity={encoding.opacity}>
          {heatRects.map((r) => (
            <rect key={r.key} x={r.x} y={r.y} width={grid.cellW + 1} height={grid.cellH + 1} fill={r.color} />
          ))}
        </g>
        {/* 坐标点层 */}
        {encoding.showPoints && points.map((p) => (
          <circle key={p.key} cx={p.cx} cy={p.cy} r={2.5} fill="hsl(var(--foreground))" opacity={0.6} />
        ))}
      </svg>
      {/* 图例 */}
      <Legend grid={grid} colorScale={encoding.colorScale} />
    </div>
  );
}

// ─── 图例 ──────────────────────────────────────────────────────────────────

function Legend({ grid, colorScale }: { grid: ReturnType<typeof computeDensityGrid>; colorScale: ColorScaleId }) {
  const scale = COLOR_SCALES[colorScale];
  const stops = 8;

  return (
    <div className="flex items-center justify-center gap-3 border-t border-white/[0.06] px-3 py-2 text-[10px] text-muted-foreground">
      <span>{grid.minDensity.toFixed(1)}</span>
      <div className="flex h-3 w-48 rounded-sm overflow-hidden">
        {Array.from({ length: stops }).map((_, i) => (
          <div key={i} className="flex-1" style={{ background: colorFromScale(scale, i / (stops - 1)) }} />
        ))}
      </div>
      <span>{grid.maxDensity.toFixed(1)}</span>
    </div>
  );
}

// ─── 空态 ──────────────────────────────────────────────────────────────────

function EmptyMsg({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</div>;
}

function BgUploader({ dispatch, enc }: { dispatch: React.Dispatch<DataAction>; enc: HeatmapEncoding }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="text-3xl">📷</span>
        <p className="text-sm text-muted-foreground">上传底图以开始热力可视化</p>
        <button type="button" className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs hover:bg-white/[0.08]"
          onClick={() => ref.current?.click()}>选择图片</button>
        <input ref={ref} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const r = new FileReader();
          r.onload = () => dispatch({ type: "SET_HEATMAP_ENCODING", encoding: { ...enc, background: { src: r.result as string, origin: "top-left" } } });
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
        <span className="text-3xl">▨</span>
        <p>请选择 X/Y 坐标字段并上传底图</p>
        <button type="button" className="rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-xs text-primary hover:bg-primary/[0.12]"
          onClick={() => dispatch({
            type: "SET_HEATMAP_ENCODING",
            encoding: { x: { field: "" }, y: { field: "" }, bandwidth: 24, opacity: 0.5, colorScale: "viridis", showPoints: true },
          })}>
          开始配置
        </button>
      </div>
    </div>
  );
}
