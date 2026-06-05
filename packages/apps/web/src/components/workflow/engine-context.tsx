"use client";

/**
 * engine-context.tsx — 把 WorkflowEngine 实例 + snapshot 暴露给 UI
 */

import * as React from "react";
import {
  WorkflowEngine,
  createDefaultExecutors,
  type EngineSnapshot,
} from "../../features/workflow";
import { useWorkflow } from "./workflow-store";

interface EngineCtx {
  snapshot: EngineSnapshot;
  run: () => Promise<void>;
  pause: () => void;
  terminate: () => void;
  resume: (input: { outputs?: Record<string, unknown>; selectedBranch?: string }) => void;
  isRunning: boolean;
}

const Ctx = React.createContext<EngineCtx | null>(null);

export function EngineProvider({ children }: { children: React.ReactNode }) {
  const { state } = useWorkflow();
  const [snapshot, setSnapshot] = React.useState<EngineSnapshot>({
    workflowStatus: "idle",
    nodeStates: {},
  });
  const [isRunning, setRunning] = React.useState(false);

  // P1-5: 通过 ref 读取最新 setSnapshot，避免 StrictMode 二次 mount 后 engine 单例
  // 仍调用旧组件实例的 setState 导致 snapshot 不更新。
  const setSnapRef = React.useRef(setSnapshot);
  React.useEffect(() => {
    setSnapRef.current = setSnapshot;
  }, [setSnapshot]);

  const engineRef = React.useRef<WorkflowEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new WorkflowEngine({
      executors: createDefaultExecutors(),
      onChange: (snap) => setSnapRef.current(snap),
    });
  }

  const run = React.useCallback(async () => {
    if (!engineRef.current) return;
    setRunning(true);
    try {
      await engineRef.current.run(state.awff);
    } catch (e) {
      // 顶级捕获，UI 自动从 snapshot 显示 error
      // eslint-disable-next-line no-console
      console.error("[workflow] run failed:", e);
    } finally {
      setRunning(false);
    }
  }, [state.awff]);

  const pause = React.useCallback(() => engineRef.current?.pause(), []);
  const terminate = React.useCallback(() => engineRef.current?.terminate(), []);
  const resume = React.useCallback(
    (input: { outputs?: Record<string, unknown>; selectedBranch?: string }) =>
      engineRef.current?.resume(input),
    [],
  );

  return (
    <Ctx.Provider value={{ snapshot, run, pause, terminate, resume, isRunning }}>
      {children}
    </Ctx.Provider>
  );
}

export function useEngine() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useEngine must be used within <EngineProvider>");
  return v;
}
