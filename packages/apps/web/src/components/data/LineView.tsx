/**
 * LineView — 折线图（Recharts）
 *
 * 槽位：xAxis (string|number|datetime) + yAxis (number)，支持多选 yAxis = 多线。
 * xAxis 类型自动检测：string → category 轴，number → number 轴。
 * encoding 来自 DataPageContext.encodings["line"]。
 * 多线选择用 FieldMapping.multiYAxis 存储。
 */

import * as React from "react";
import type { Column } from "@artifex-nexus/contracts";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { DataPageContext } from "./DataPage";
import { FieldMapping } from "./shared/FieldMapping";
import { mapColumnsToSlots } from "./shared/slot-mapping";
import { chartColor } from "./shared/chart-colors";

// ─── 组件 ──────────────────────────────────────────────────────────────────

export function LineView() {
  const { andf, encodings, dispatch } = React.useContext(DataPageContext);
  const cols: Column[] = andf?.columns ?? [];
  const rows = andf?.rows ?? [];

  const slots = React.useMemo(() => mapColumnsToSlots("line", cols), [cols]);
  const encoding = React.useMemo(() => encodings["line"] || {}, [encodings]);

  const handleEncodingChange = (enc: Record<string, string>) =>
    dispatch({ type: "SET_VIEW_ENCODING", view: "line", encoding: enc });

  // 多线字段列表：用 encoding["line_yAxis_fields"] JSON 字符串持久化
  const rawFields = encoding["line_yAxis_fields"];
  const [multiFields, setMultiFields] = React.useState<string[]>(
    rawFields ? JSON.parse(rawFields) : []
  );

  const handleMultiChange = (fields: string[]) => {
    setMultiFields(fields);
    dispatch({
      type: "SET_VIEW_ENCODING",
      view: "line",
      encoding: { ...encoding, line_yAxis_fields: JSON.stringify(fields) },
    });
  };

  const xField = encoding["xAxis"];
  const yField = encoding["yAxis"];
  const allYFields = multiFields.length > 0 ? multiFields : (yField ? [yField] : []);

  // 检测 xAxis 类型（不依赖 hook 但要求 xField 存在；缺失时退化为 string）
  const xCol = cols.find((c) => c.name === xField);
  const xType = xCol?.type ?? "string";
  const isXNumber = xType === "number";

  // ⚠️ Hooks 必须在所有 early return 之前调用（rules-of-hooks）
  const sortedRows = React.useMemo(() => {
    if (!xField || allYFields.length === 0) return rows;
    const copy = [...rows];
    if (isXNumber) {
      copy.sort((a, b) => (Number(a[xField]) || 0) - (Number(b[xField]) || 0));
    }
    return copy;
  }, [rows, xField, isXNumber, allYFields.length]);

  if (!xField || allYFields.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <FieldMapping
          slots={slots}
          encoding={encoding}
          onEncodingChange={handleEncodingChange}
          columns={cols}
          multiYAxis={multiFields}
          onMultiYAxisChange={handleMultiChange}
        />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/50">
          {!xField ? "请选择 X 轴字段映射" : "请至少选择一个 Y 轴字段"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <FieldMapping
        slots={slots}
        encoding={encoding}
        onEncodingChange={handleEncodingChange}
        columns={cols}
        multiYAxis={multiFields}
        onMultiYAxisChange={handleMultiChange}
      />
      <div className="flex-1 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sortedRows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
            <XAxis
              dataKey={xField}
              type={isXNumber ? "number" : "category"}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
            {allYFields.map((f, i) => (
              <Line
                key={f}
                type="monotone"
                dataKey={f}
                stroke={chartColor(i)}
                strokeWidth={2}
                dot={{ r: 3, fill: chartColor(i) }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
