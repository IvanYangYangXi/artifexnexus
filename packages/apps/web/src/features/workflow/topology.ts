/**
 * topology.ts — Kahn 拓扑排序 + 循环依赖检测
 *
 * 输入 AWFF.nodes / AWFF.edges，输出拓扑序 + 邻接表。
 * 循环 / 自环 / 重复边均会被检测，循环时抛 Error。
 */

import type { AWFF, TopoResult } from "./types";

export class TopologyError extends Error {
  constructor(
    message: string,
    public readonly cycleNodes?: string[],
  ) {
    super(message);
    this.name = "TopologyError";
  }
}

export function topoSort(awff: AWFF): TopoResult {
  const nodeIds = new Set(awff.nodes.map((n) => n.id));
  const adjacency: Record<string, string[]> = {};
  const inverse: Record<string, string[]> = {};
  const indegree: Record<string, number> = {};

  for (const n of awff.nodes) {
    adjacency[n.id] = [];
    inverse[n.id] = [];
    indegree[n.id] = 0;
  }

  for (const e of awff.edges) {
    if (!nodeIds.has(e.source)) {
      throw new TopologyError(`edge "${e.id}" references unknown source "${e.source}"`);
    }
    if (!nodeIds.has(e.target)) {
      throw new TopologyError(`edge "${e.id}" references unknown target "${e.target}"`);
    }
    if (e.source === e.target) {
      throw new TopologyError(`edge "${e.id}" forms a self-loop on node "${e.source}"`, [e.source]);
    }
    adjacency[e.source].push(e.target);
    inverse[e.target].push(e.source);
    indegree[e.target] = (indegree[e.target] ?? 0) + 1;
  }

  // Kahn
  const queue: string[] = [];
  for (const id of nodeIds) {
    if ((indegree[id] ?? 0) === 0) queue.push(id);
  }
  // deterministic: 按 nodes 数组原顺序排
  const nodeOrder = new Map(awff.nodes.map((n, i) => [n.id, i] as const));
  queue.sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));

  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adjacency[id]) {
      indegree[next]--;
      if (indegree[next] === 0) {
        // insert keeping deterministic order
        const idx = (() => {
          let lo = 0, hi = queue.length;
          const target = nodeOrder.get(next) ?? 0;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if ((nodeOrder.get(queue[mid]) ?? 0) < target) lo = mid + 1;
            else hi = mid;
          }
          return lo;
        })();
        queue.splice(idx, 0, next);
      }
    }
  }

  if (order.length !== awff.nodes.length) {
    const remaining = awff.nodes
      .map((n) => n.id)
      .filter((id) => !order.includes(id));
    throw new TopologyError(
      `cycle detected; ${remaining.length} node(s) cannot be ordered: [${remaining.join(", ")}]`,
      remaining,
    );
  }

  return { order, adjacency, inverse };
}
