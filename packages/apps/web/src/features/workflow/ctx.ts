/**
 * ctx.ts — RunCtx 变量解析器
 *
 * 支持模板：
 *   - `{{vars.name}}`     → ctx.vars[name]
 *   - `{{nodeId.outKey}}` → ctx.nodeOutputs[nodeId][outKey]
 *
 * 解析规则：
 *   - 整串就是单个 `{{...}}` → 返回原始 JS 值（不做 stringify）
 *   - 字符串中嵌入多个表达式 → 各自 toString 后拼接
 *   - 引用不存在 → 返回 undefined（写入字符串时变成 ""），不抛异常（首版宽松）
 *   - 对象 / 数组：递归处理
 *
 * P0-4: 避免共享 stateful 正则（`/g` flag + test/replace 之间会泄漏 lastIndex），
 * 全部局部正则 + 直接 includes("{{") 判定。
 */

import type { RunCtx } from "./types";

const SINGLE_TPL_RE = /^\{\{\s*([\w.[\]]+)\s*\}\}$/;

function lookup(path: string, ctx: RunCtx): unknown {
  // 支持 vars.x / nodeId.out / a.b.c
  const parts = path.split(".");
  if (parts.length < 2) return undefined;
  const head = parts[0];
  const rest = parts.slice(1);

  let cursor: unknown;
  if (head === "vars") {
    cursor = ctx.vars;
    for (const p of rest) {
      if (cursor && typeof cursor === "object" && p in (cursor as object)) {
        cursor = (cursor as Record<string, unknown>)[p];
      } else {
        return undefined;
      }
    }
    return cursor;
  }
  // 否则视作 nodeId.outputKey[.subkey...]
  const nodeOut = ctx.nodeOutputs[head];
  if (!nodeOut) return undefined;
  cursor = nodeOut;
  for (const p of rest) {
    if (cursor && typeof cursor === "object" && p in (cursor as object)) {
      cursor = (cursor as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function resolveString(s: string, ctx: RunCtx): unknown {
  // 整串单一表达式 → 返回原始 JS 值
  const single = s.match(SINGLE_TPL_RE);
  if (single) {
    return lookup(single[1], ctx);
  }
  // P0-4: 无模板快速返回；避免共享 /g 正则导致的 lastIndex 状态泄漏
  if (!s.includes("{{")) return s;
  // 每次 replace 用全新的局部正则实例，无副作用
  return s.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, expr) => {
    const v = lookup(expr, ctx);
    if (v === undefined || v === null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
}

export function resolve<T>(value: T, ctx: RunCtx): T {
  if (typeof value === "string") {
    return resolveString(value, ctx) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolve(v, ctx)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolve(v, ctx);
    }
    return out as T;
  }
  return value;
}
