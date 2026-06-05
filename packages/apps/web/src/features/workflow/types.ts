/**
 * workflow/types.ts — WorkflowEngine 运行态类型
 *
 * 与 AWFF schema (`packages/platform/contracts/schemas/awff.schema.json`) 联用：
 * AWFF 是「持久化数据契约」，本文件定义「运行态扩展」（NodeStatus / WorkflowStatus / NodeResult / RunCtx 等）。
 */

import type {
  ArtifexNexusWorkflowFormat,
  AWFFNode,
  AWFFEdge,
  NodeStatus,
  PortDataType,
} from "@artifex-nexus/contracts";

export type AWFF = ArtifexNexusWorkflowFormat;

/** 工作流级 6 态状态机 */
export type WorkflowStatus =
  | "idle" // 未运行
  | "running" // 至少 1 节点 RUNNING
  | "paused" // 至少 1 节点 WAITING
  | "completed" // 全部 DONE / SKIPPED，无 ERROR
  | "terminated" // 用户主动终止 / Terminate 节点
  | "error"; // 任一节点 ERROR

/** 节点级 7 态（与 AWFF schema NodeStatus 对齐） */
export type { NodeStatus };

/** 节点执行结果 —— executor 必须返回 */
export interface NodeResult {
  /** 输出端口 → 值，键名应与 node.outputs[*].id 对齐 */
  outputs?: Record<string, unknown>;
  /** 选中的分支：`canBranch` 节点必须设置；值为 outputHandle id 或 edge.label */
  selectedBranch?: string;
  /** 是否触发整个工作流终止（Terminate 节点） */
  terminate?: boolean;
  /** 跳过的下游节点 id 列表（手动 SKIP，少数场景使用） */
  skipDownstream?: string[];
  /** 错误（如果有，节点状态置 ERROR） */
  error?: string;
}

/** 暂停时 executor 返回的特殊值 —— 由 Engine 内部处理，executor 不直接返回 */
export interface PauseSignal {
  __pause: true;
  /** runtimeUI 形态（panel/modal） */
  ui?: "panel" | "modal";
  /** 给 RuntimePanel 显示的载荷（如可选项列表） */
  payload?: unknown;
}

/** 节点 executor 签名 */
export type NodeExecutor = (
  node: AWFFNode,
  ctx: RunCtx,
) => Promise<NodeResult | PauseSignal>;

/** 运行态上下文：变量 + 已完成节点输出 */
export interface RunCtx {
  /** 全局变量（来自 AWFF.variables[*].default 或运行时注入） */
  vars: Record<string, unknown>;
  /** 节点 id → outputs（已完成节点暴露给下游的值） */
  nodeOutputs: Record<string, Record<string, unknown>>;
  /** 由 Engine 调度时填充：当前正在执行的节点 id（debug 用） */
  currentNodeId?: string;
}

/** 节点运行态记录（对外暴露） */
export interface NodeRuntimeState {
  status: NodeStatus;
  outputs?: Record<string, unknown>;
  selectedBranch?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

/** Engine 运行结果 */
export interface RunResult {
  status: WorkflowStatus;
  nodeStates: Record<string, NodeRuntimeState>;
  finalCtx: RunCtx;
  /** 执行顺序（实际跑过的节点 id，按时间顺序） */
  executedOrder: string[];
}

/** 拓扑排序结果 */
export interface TopoResult {
  /** 拓扑顺序（节点 id 数组） */
  order: string[];
  /** 邻接表：source → target[] */
  adjacency: Record<string, string[]>;
  /** 反向邻接：target → source[] */
  inverse: Record<string, string[]>;
}

export type { AWFFNode, AWFFEdge, PortDataType };
