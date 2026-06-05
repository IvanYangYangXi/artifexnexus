/**
 * engine.ts — WorkflowEngine 串行执行核心
 *
 * 责任：
 *   - 拓扑排序（已校验循环）
 *   - 按拓扑序串行调用 executor，传入解析后的 config
 *   - 维护节点级 7 态 + 工作流级 6 态
 *   - canPause: WAITING 时挂起 promise，等 resume(input) 后注入 outputs 继续
 *   - canBranch: 根据 selectedBranch（output handle id 或 edge.label）裁剪下游
 *   - canTerminate: terminate=true 时停止后续节点（标 SKIPPED）
 *   - 暴露 run / pause / resume / terminate API + onChange 订阅
 *
 * 不负责：节点 executor 的具体实现（在 nodes/ 下注册），UI（在 React 组件里）
 */

import type {
  AWFF,
  AWFFNode,
  NodeExecutor,
  NodeRuntimeState,
  NodeStatus,
  PauseSignal,
  RunCtx,
  RunResult,
  WorkflowStatus,
} from "./types";
import { resolve } from "./ctx";
import { topoSort, TopologyError } from "./topology";

/** P2-1: 区分用户主动终止与节点 error */
export class TerminatedError extends Error {
  constructor(message = "workflow terminated") {
    super(message);
    this.name = "TerminatedError";
  }
}

interface WaitingResolver {
  resolve: (input: { outputs?: Record<string, unknown>; selectedBranch?: string }) => void;
  reject: (err: Error) => void;
}

export interface EngineOptions {
  /** 节点 executor 注册表：node.type → executor */
  executors: Record<string, NodeExecutor>;
  /** 状态变更订阅 */
  onChange?: (snapshot: EngineSnapshot) => void;
}

export interface EngineSnapshot {
  workflowStatus: WorkflowStatus;
  nodeStates: Record<string, NodeRuntimeState>;
  currentNodeId?: string;
  /** 等待用户输入的节点 id（waiting）*/
  waitingNodeId?: string;
  /** 等待节点的 runtimeUI 形态（panel/modal）+ payload */
  waitingMeta?: { ui?: "panel" | "modal"; payload?: unknown };
}

export class WorkflowEngine {
  private executors: Record<string, NodeExecutor>;
  private onChange?: (snapshot: EngineSnapshot) => void;

  private awff!: AWFF;
  private ctx!: RunCtx;
  private nodeStates: Record<string, NodeRuntimeState> = {};
  private executedOrder: string[] = [];
  private workflowStatus: WorkflowStatus = "idle";

  // 用于 pause/resume：当前等待的 resolver
  private waiting?: { nodeId: string; resolver: WaitingResolver; meta?: { ui?: "panel" | "modal"; payload?: unknown } };
  private terminationRequested = false;

  constructor(opts: EngineOptions) {
    this.executors = opts.executors;
    this.onChange = opts.onChange;
  }

  /** 主入口 —— 串行跑完返回结果 */
  async run(awff: AWFF, initialVars: Record<string, unknown> = {}): Promise<RunResult> {
    this.awff = awff;
    this.ctx = {
      vars: {
        ...this.collectDefaultVars(awff),
        ...initialVars,
      },
      nodeOutputs: {},
    };
    this.nodeStates = {};
    this.executedOrder = [];
    this.workflowStatus = "idle";
    this.waiting = undefined;
    this.terminationRequested = false;

    // 1. 拓扑
    let order: string[];
    try {
      order = topoSort(awff).order;
    } catch (e) {
      const err = e as TopologyError;
      this.workflowStatus = "error";
      // 把所有节点标 ERROR / 拒绝
      for (const n of awff.nodes) {
        this.nodeStates[n.id] = { status: "error", error: err.message };
      }
      this.emit();
      throw err;
    }

    // 初始化节点态
    for (const n of awff.nodes) {
      this.nodeStates[n.id] = { status: "pending" };
    }
    this.workflowStatus = "running";
    this.emit();

    const skipSet = new Set<string>();

    for (const nid of order) {
      // P2-2: 主动暂停时挂起
      await this.awaitIfPaused();
      if (this.terminationRequested) {
        if (this.nodeStates[nid].status === "pending") {
          this.nodeStates[nid] = { status: "skipped" };
        }
        continue;
      }
      if (skipSet.has(nid)) {
        this.nodeStates[nid] = { status: "skipped" };
        this.emit();
        continue;
      }

      const node = awff.nodes.find((n) => n.id === nid)!;
      this.ctx.currentNodeId = nid;
      const startedAt = Date.now();
      this.nodeStates[nid] = { status: "running", startedAt };
      this.emit();
      this.executedOrder.push(nid);

      try {
        const result = await this.execNode(node);
        if ("__pause" in result) {
          // 不应到达此处：execNode 内部应已处理
          throw new Error(`unexpected pause signal returned for node ${nid}`);
        }
        if (result.error) {
          this.nodeStates[nid] = { status: "error", error: result.error, startedAt, endedAt: Date.now() };
          this.workflowStatus = "error";
          this.emit();
          break;
        }
        // 成功
        const outputs = result.outputs ?? {};
        this.ctx.nodeOutputs[nid] = outputs;
        this.nodeStates[nid] = {
          status: result.selectedBranch ? "branched" : "done",
          outputs,
          selectedBranch: result.selectedBranch,
          startedAt,
          endedAt: Date.now(),
        };

        // 分支裁剪：只保留 selectedBranch 对应的下游
        if (result.selectedBranch) {
          this.applyBranchSkip(node, result.selectedBranch, skipSet, order);
        }
        // 显式 skip
        if (result.skipDownstream?.length) {
          for (const sid of result.skipDownstream) skipSet.add(sid);
        }
        // 终止
        if (result.terminate) {
          this.terminationRequested = true;
          this.workflowStatus = "terminated";
        }
        this.emit();
      } catch (e) {
        // P2-1: 用户主动终止不算节点 error
        if (e instanceof TerminatedError) {
          this.nodeStates[nid] = { status: "skipped", startedAt, endedAt: Date.now() };
          this.workflowStatus = "terminated";
          this.emit();
          break;
        }
        const msg = e instanceof Error ? e.message : String(e);
        this.nodeStates[nid] = { status: "error", error: msg, startedAt, endedAt: Date.now() };
        this.workflowStatus = "error";
        this.emit();
        break;
      }
    }

    // 收尾
    if (this.workflowStatus === "running") {
      this.workflowStatus = "completed";
    }
    this.ctx.currentNodeId = undefined;
    this.emit();

    return {
      status: this.workflowStatus,
      nodeStates: this.nodeStates,
      finalCtx: this.ctx,
      executedOrder: this.executedOrder,
    };
  }

  /** 用户主动终止 */
  terminate() {
    // P0-1: 不覆盖已经到达的终态
    if (
      this.workflowStatus === "completed" ||
      this.workflowStatus === "error" ||
      this.workflowStatus === "terminated"
    ) {
      return;
    }
    this.terminationRequested = true;
    if (this.waiting) {
      // 唤醒并视为 cancel
      const w = this.waiting;
      this.waiting = undefined;
      this.workflowStatus = "terminated";
      w.resolver.reject(new TerminatedError("workflow terminated"));
      this.emit();
      return;
    }
    this.workflowStatus = "terminated";
    this.emit();
  }

  /**
   * 用户主动暂停。
   * P2-2: 真实暂停 = 在 run 主循环每次迭代前 await，直到 status 不再是 paused。
   * 已 waiting 的节点本身就是 paused 的强表达，pause() 主要用于"非 waiting 状态下的主动暂停"。
   */
  pause() {
    if (this.workflowStatus === "running") {
      this.workflowStatus = "paused";
      this.emit();
    }
  }

  /** 内部：在主循环开头调用，将 paused 状态卡住 */
  private async awaitIfPaused(): Promise<void> {
    while (this.workflowStatus === "paused" && !this.terminationRequested && !this.waiting) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** 提交等待节点的输入 → 唤醒 */
  resume(input: { outputs?: Record<string, unknown>; selectedBranch?: string }) {
    if (!this.waiting) return;
    const w = this.waiting;
    this.waiting = undefined;
    if (this.workflowStatus === "paused") this.workflowStatus = "running";
    w.resolver.resolve(input);
  }

  /** 当前快照（用于测试 / UI 同步） */
  snapshot(): EngineSnapshot {
    return {
      workflowStatus: this.workflowStatus,
      nodeStates: { ...this.nodeStates },
      currentNodeId: this.ctx?.currentNodeId,
      waitingNodeId: this.waiting?.nodeId,
      waitingMeta: this.waiting?.meta,
    };
  }

  // ---- 内部 ----

  private collectDefaultVars(awff: AWFF): Record<string, unknown> {
    const vars: Record<string, unknown> = {};
    for (const v of awff.variables ?? []) {
      vars[v.name] = v.default;
    }
    return vars;
  }

  private async execNode(node: AWFFNode) {
    const executor = this.executors[node.type];
    if (!executor) {
      return { error: `no executor registered for type "${node.type}"` };
    }
    // 解析 config 中的模板
    const resolvedConfig = resolve(node.config ?? {}, this.ctx);
    const exposedNode: AWFFNode = { ...node, config: resolvedConfig };

    const result = await executor(exposedNode, this.ctx);
    if (result && typeof result === "object" && "__pause" in result) {
      // 进入 WAITING
      const ps = result as PauseSignal;
      this.nodeStates[node.id] = {
        ...(this.nodeStates[node.id] ?? { status: "pending" }),
        status: "waiting",
      };
      this.workflowStatus = "paused";
      const meta = { ui: ps.ui, payload: ps.payload };
      this.emit();

      const userInput = await new Promise<{ outputs?: Record<string, unknown>; selectedBranch?: string }>(
        (resolve, reject) => {
          this.waiting = { nodeId: node.id, resolver: { resolve, reject }, meta };
          // 重新发一次 emit，确保 waitingMeta 已更新
          this.emit();
        },
      );
      // 唤醒后回到 RUNNING（emit 已在 resume 内做）
      this.workflowStatus = "running";
      this.emit();
      return {
        outputs: userInput.outputs,
        selectedBranch: userInput.selectedBranch,
      };
    }
    return result as Exclude<typeof result, PauseSignal>;
  }

  /** 分支裁剪：只保留从当前节点出发、走 selectedBranch 边的下游 */
  private applyBranchSkip(
    node: AWFFNode,
    selectedBranch: string,
    skipSet: Set<string>,
    order: string[],
  ) {
    const keepEdges = this.awff.edges.filter(
      (e) => e.source === node.id && (e.sourceHandle === selectedBranch || e.label === selectedBranch),
    );
    const keptTargets = new Set(keepEdges.map((e) => e.target));
    const droppedEdges = this.awff.edges.filter(
      (e) => e.source === node.id && !keepEdges.includes(e),
    );

    // P1-4: reachable 结果按 source 缓存，避免每条 dropped edge 都做一次全图 DFS
    const reachCache = new Map<string, Set<string>>();
    const reachable = (from: string): Set<string> => {
      const cached = reachCache.get(from);
      if (cached) return cached;
      const seen = new Set<string>();
      const stack = [from];
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const e of this.awff.edges) {
          if (e.source === cur) stack.push(e.target);
        }
      }
      reachCache.set(from, seen);
      return seen;
    };

    // keep 路径上可达的所有节点不能 skip
    const keepReach = new Set<string>();
    for (const t of keptTargets) for (const x of reachable(t)) keepReach.add(x);

    for (const e of droppedEdges) {
      const dropReach = reachable(e.target);
      for (const x of dropReach) {
        if (!keepReach.has(x)) skipSet.add(x);
      }
    }
    void order;
  }

  private emit() {
    this.onChange?.(this.snapshot());
  }
}
