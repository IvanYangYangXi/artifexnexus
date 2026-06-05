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
import { ZoomPanContainer } from "./shared/ZoomPanContainer";

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function SceneHeatmapView() {
  const { andf, heatmapEncoding, dispatch } = React.useContext(DataPageContext);

  // 自动初始化空编码
  React.useEffect(() => {
    if (!heatmapEncoding) {
      dispatch({
        type: "SET_HEATMAP_ENCODING",
        encoding: { x: { field: "" }, y: { field: "" }, bandwidth: 24, opacity: 0.5, colorScale: "viridis", showPoints: true },
      });
    }
  }, [heatmapEncoding, dispatch]);

  if (!heatmapEncoding) return null;
  const enc = heatmapEncoding;
  const cols = andf?.columns ?? [];

  return (
    <div className="flex h-full flex-col">
      <ConfigBar encoding={enc} dispatch={dispatch} columns={cols} />
      {!enc.x.field || !enc.y.field ? (
        <div className="flex flex-1 items-center justify-center text-sm text-foreground/50">
          请在上方选择 X / Y 坐标字段（数值类型）
        </div>
      ) : (
        <div className="relative flex-1">
          <ZoomPanContainer>
            <HeatmapCanvas rows={andf?.rows ?? []} encoding={enc} />
          </ZoomPanContainer>
        </div>
      )}
    </div>
  );
}

// ─── 配置面板 ──────────────────────────────────────────────────────────────

function ConfigBar({
  encoding,
  dispatch,
  columns,
}: {
  encoding: HeatmapEncoding;
  dispatch: React.Dispatch<DataAction>;
  columns: { name: string; type: string; visible?: boolean }[];
}) {
  const set = (patch: Partial<HeatmapEncoding>) => {
    dispatch({ type: "SET_HEATMAP_ENCODING", encoding: { ...encoding, ...patch } });
  };
  const numericCols = columns.filter((c) => c.visible !== false && c.type === "number");

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs">
      {/* X / Y 字段 */}
      <FieldPicker label="X" value={encoding.x.field} options={numericCols.map((c) => c.name)}
        onChange={(v) => set({ x: { field: v } })} />
      <FieldPicker label="Y" value={encoding.y.field} options={numericCols.map((c) => c.name)}
        onChange={(v) => set({ y: { field: v } })} />
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
      <label className="flex items-center gap-1.5 text-foreground/70">
        <input type="checkbox" className="rounded"
          checked={encoding.showPoints}
          onChange={(e) => set({ showPoints: e.target.checked })} />
        显示坐标点
      </label>
      {/* 底图（可选） */}
      <BgButton encoding={encoding} dispatch={dispatch} />
    </div>
  );
}

function FieldPicker({
  label, value, options, onChange,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-foreground/60">{label}:</span>
      <select
        className="rounded border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary/40"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— 选择 —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
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
      <button type="button" className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs text-foreground/80 hover:bg-white/[0.08] hover:text-foreground"
        onClick={() => ref.current?.click()}
        title={encoding.background?.src ? "更换底图" : "上传底图（可选）"}
      >
        {encoding.background?.src ? "换底图" : "上传底图"}
      </button>
      {encoding.background?.src && (
        <button type="button" className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs text-foreground/60 hover:bg-white/[0.08] hover:text-foreground"
          onClick={() => dispatch({ type: "SET_HEATMAP_ENCODING", encoding: { ...encoding, background: undefined } })}>
          移除
        </button>
      )}
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
  const [bgSize, setBgSize] = React.useState({ w: 1000, h: 800 });

  React.useEffect(() => {
    if (encoding.background?.src) {
      const img = new window.Image();
      img.onload = () => setBgSize({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = encoding.background.src;
      return;
    }
    // 无底图：按数据包围盒
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

  // 坐标点列表（showPoints 时）。> 3000 点时按步长抽样，避免 SVG 卡顿
  const points = React.useMemo(() => {
    if (!encoding.showPoints) return [];
    const HEATMAP_POINT_CAP = 3000;
    const step = rows.length > HEATMAP_POINT_CAP ? rows.length / HEATMAP_POINT_CAP : 1;
    const out: { key: number; cx: number; cy: number }[] = [];
    const limit = step > 1 ? HEATMAP_POINT_CAP : rows.length;
    for (let k = 0; k < limit; k++) {
      const i = step > 1 ? Math.floor(k * step) : k;
      const row = rows[i]!;
      const dx = Number(row[encoding.x.field]);
      const dy = Number(row[encoding.y.field]);
      if (isNaN(dx) || isNaN(dy)) continue;
      const { px, py } = dataToPixel(dx, dy, bgSize.w, bgSize.h, {
        x: encoding.x, y: encoding.y,
        background: encoding.background,
      });
      out.push({ key: i, cx: px, cy: py });
    }
    return out;
  }, [rows, encoding.showPoints, encoding.x.field, encoding.y.field, bgSize, encoding.background]);

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden">
      <svg className="flex-1 w-full" viewBox={`0 0 ${bgSize.w} ${bgSize.h}`} preserveAspectRatio="xMidYMid meet">
        {/* 网格（无底图时） */}
        {!encoding.background?.src && (
          <>
            <defs>
              <pattern id="heatmap-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="hsl(var(--border) / 0.3)" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width={bgSize.w} height={bgSize.h} fill="url(#heatmap-grid)" />
          </>
        )}
        {/* 底图 */}
        {encoding.background?.src && <image href={encoding.background.src} width={bgSize.w} height={bgSize.h} preserveAspectRatio="none" />}
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
    <div className="flex items-center justify-center gap-3 border-t border-white/[0.06] px-3 py-2 text-[10px] text-foreground/60">
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
