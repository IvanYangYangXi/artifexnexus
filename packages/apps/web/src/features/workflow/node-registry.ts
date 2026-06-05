/**
 * node-registry.ts — 18 个内置节点的能力声明 + executor。
 *
 * 设计要点：
 *  - 声明（declarations）独立于 executor：UI 通过 declarations 渲染节点 palette / inspector
 *  - executor：纯函数，输入 (node, ctx) → NodeResult。对话节点 / Python / Shell 走 mock
 *  - 真实集成（SkillHub / Nexus-Tool）通过依赖注入：调用方从 chat-service / sidecar 传入
 */

import type { AWFFNode, NodeExecutor, NodeResult, PauseSignal, RunCtx } from "./types";

// ---- 节点声明 ----

export interface NodeDeclaration {
  type: string;
  kind:
    | "trigger"
    | "tool"
    | "skill"
    | "ai-chat"
    | "user"
    | "control"
    | "data"
    | "script"
    | "output";
  label: string;
  description: string;
  capabilities: {
    canPause: boolean;
    canBranch: boolean;
    canTerminate: boolean;
    runtimeUI: "none" | "panel" | "modal";
  };
  /** 默认输入端口（拖入新节点时用） */
  inputs: { id: string; name: string; dataType: string; required?: boolean }[];
  /** 默认输出端口 */
  outputs: { id: string; name: string; dataType: string }[];
  /** 是否启用（首版 Python/Shell = false） */
  enabled: boolean;
  /** 禁用原因（disabled 时渲染 tooltip 用） */
  disabledReason?: string;
}

export const NODE_DECLARATIONS: NodeDeclaration[] = [
  // Trigger
  {
    type: "trigger.on-demand",
    kind: "trigger",
    label: "On Demand",
    description: "手动触发（点击运行按钮启动）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [],
    outputs: [{ id: "out", name: "trigger", dataType: "trigger" }],
    enabled: true,
  },
  {
    type: "trigger.on-schedule",
    kind: "trigger",
    label: "On Schedule",
    description: "定时触发（首版仅骨架，未真正接 cron）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [],
    outputs: [{ id: "out", name: "trigger", dataType: "trigger" }],
    enabled: true,
  },
  // Tool
  {
    type: "tool.run-tool",
    kind: "tool",
    label: "Run Tool",
    description: "调用 Nexus-Tool（首版 mock，集成时由调用方注入 hub）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "in", name: "trigger", dataType: "any", required: false }],
    outputs: [{ id: "result", name: "result", dataType: "object" }],
    enabled: true,
  },
  // Skill
  {
    type: "skill.run-skill",
    kind: "skill",
    label: "Run Skill",
    description: "调用 SkillHub 注册的 skill（首版 mock）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "input", name: "input", dataType: "any" }],
    outputs: [{ id: "result", name: "result", dataType: "any" }],
    enabled: true,
  },
  // AI Chat (mock)
  {
    type: "ai-chat.send-to-chat",
    kind: "ai-chat",
    label: "Send to Chat",
    description: "向当前 Chat 发消息（首版 mock，仅 console.log）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "text", name: "text", dataType: "string", required: true }],
    outputs: [{ id: "messageId", name: "messageId", dataType: "string" }],
    enabled: true,
  },
  {
    type: "ai-chat.get-chat-response",
    kind: "ai-chat",
    label: "Get Chat Response",
    description: "等待 Chat 回复（mock：直接返回 'mocked response'）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "messageId", name: "messageId", dataType: "string" }],
    outputs: [{ id: "text", name: "text", dataType: "string" }],
    enabled: true,
  },
  {
    type: "ai-chat.ai-analysis",
    kind: "ai-chat",
    label: "AI Analysis",
    description: "对输入做 AI 分析（mock：echo + 标签）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "input", name: "input", dataType: "any", required: true }],
    outputs: [{ id: "analysis", name: "analysis", dataType: "string" }],
    enabled: true,
  },
  // User
  {
    type: "user.user-choice",
    kind: "user",
    label: "User Choice",
    description: "暂停 → 用户选项 → 继续，可分支",
    capabilities: { canPause: true, canBranch: true, canTerminate: false, runtimeUI: "panel" },
    inputs: [{ id: "items", name: "items", dataType: "array" }],
    outputs: [{ id: "selected", name: "selected", dataType: "any" }],
    enabled: true,
  },
  {
    type: "user.input-form",
    kind: "user",
    label: "Input Form",
    description: "暂停 → 用户填表 → 继续",
    capabilities: { canPause: true, canBranch: false, canTerminate: false, runtimeUI: "panel" },
    inputs: [],
    outputs: [{ id: "values", name: "values", dataType: "object" }],
    enabled: true,
  },
  // Control
  {
    type: "control.condition",
    kind: "control",
    label: "Condition",
    description: "根据表达式选 true/false 分支",
    capabilities: { canPause: false, canBranch: true, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "value", name: "value", dataType: "any", required: true }],
    outputs: [
      { id: "true", name: "true", dataType: "any" },
      { id: "false", name: "false", dataType: "any" },
    ],
    enabled: true,
  },
  {
    type: "control.terminate",
    kind: "control",
    label: "Terminate",
    description: "立即终止整个工作流",
    capabilities: { canPause: false, canBranch: false, canTerminate: true, runtimeUI: "none" },
    inputs: [{ id: "in", name: "in", dataType: "any" }],
    outputs: [],
    enabled: true,
  },
  {
    type: "control.loop",
    kind: "control",
    label: "Loop",
    description: "循环（首版骨架，未实现真实循环）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "items", name: "items", dataType: "array" }],
    outputs: [{ id: "item", name: "item", dataType: "any" }],
    enabled: false,
    disabledReason: "Loop 节点未实现，首版 EPIC-0011 不交付。",
  },
  // Data
  {
    type: "data.set-variable",
    kind: "data",
    label: "Set Variable",
    description: "设置工作流变量",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "value", name: "value", dataType: "any", required: true }],
    outputs: [{ id: "value", name: "value", dataType: "any" }],
    enabled: true,
  },
  {
    type: "data.transform",
    kind: "data",
    label: "Transform",
    description: "JS 表达式转换（mock：直接 echo）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "input", name: "input", dataType: "any", required: true }],
    outputs: [{ id: "output", name: "output", dataType: "any" }],
    enabled: true,
  },
  // Script (disabled)
  {
    type: "script.run-python",
    kind: "script",
    label: "Run Python",
    description: "运行 Python 脚本（首版 disabled，无沙箱）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "input", name: "input", dataType: "any" }],
    outputs: [{ id: "stdout", name: "stdout", dataType: "string" }],
    enabled: false,
    disabledReason: "Python 节点首版不交付（无沙箱），骨架占位。",
  },
  {
    type: "script.run-shell",
    kind: "script",
    label: "Run Shell",
    description: "运行 Shell 命令（首版 disabled，无沙箱）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "input", name: "input", dataType: "any" }],
    outputs: [{ id: "stdout", name: "stdout", dataType: "string" }],
    enabled: false,
    disabledReason: "Shell 节点首版不交付（无沙箱），骨架占位。",
  },
  // Output
  {
    type: "output.show-result",
    kind: "output",
    label: "Show Result",
    description: "在 RuntimePanel 展示最终结果",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "panel" },
    inputs: [{ id: "value", name: "value", dataType: "any", required: true }],
    outputs: [],
    enabled: true,
  },
  {
    type: "output.export-file",
    kind: "output",
    label: "Export File",
    description: "导出文件（mock：仅 console.log）",
    capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
    inputs: [{ id: "content", name: "content", dataType: "any", required: true }],
    outputs: [{ id: "path", name: "path", dataType: "string" }],
    enabled: true,
  },
];

// ---- 集成钩子 ----

/** 真实集成时由调用方注入 */
export interface IntegrationHooks {
  /** 调 Nexus-Tool；toolId / params 由 node.config 提供 */
  runTool?: (toolId: string, params: unknown) => Promise<unknown>;
  /** 调 SkillHub */
  runSkill?: (skillName: string, params: unknown) => Promise<unknown>;
  /** Send to Chat */
  sendToChat?: (text: string) => Promise<{ messageId: string }>;
  /** Get Chat Response */
  getChatResponse?: (messageId: string) => Promise<{ text: string }>;
  /** AI Analysis */
  aiAnalyze?: (input: unknown) => Promise<{ analysis: string }>;
}

// ---- Executor 工厂 ----

export function createDefaultExecutors(hooks: IntegrationHooks = {}): Record<string, NodeExecutor> {
  return {
    "trigger.on-demand": async () => ({ outputs: { trigger: true } }),
    "trigger.on-schedule": async () => ({ outputs: { trigger: true } }),

    "tool.run-tool": async (node) => {
      const cfg = (node.config ?? {}) as { toolId?: string; params?: unknown };
      if (!cfg.toolId) return { error: "tool.run-tool: missing config.toolId" };
      if (hooks.runTool) {
        const result = await hooks.runTool(cfg.toolId, cfg.params);
        return { outputs: { result } };
      }
      // mock
      return { outputs: { result: { __mock: true, toolId: cfg.toolId, params: cfg.params } } };
    },

    "skill.run-skill": async (node) => {
      const cfg = (node.config ?? {}) as { skillName?: string; params?: unknown };
      if (!cfg.skillName) return { error: "skill.run-skill: missing config.skillName" };
      if (hooks.runSkill) {
        const result = await hooks.runSkill(cfg.skillName, cfg.params);
        return { outputs: { result } };
      }
      return { outputs: { result: { __mock: true, skillName: cfg.skillName, params: cfg.params } } };
    },

    "ai-chat.send-to-chat": async (node) => {
      const cfg = (node.config ?? {}) as { text?: string };
      const text = cfg.text ?? "";
      if (hooks.sendToChat) {
        const r = await hooks.sendToChat(text);
        return { outputs: { messageId: r.messageId } };
      }
      // mock
      const messageId = `mock-msg-${Math.random().toString(36).slice(2, 8)}`;
      // eslint-disable-next-line no-console
      console.log("[mock] sendToChat:", text, "→", messageId);
      return { outputs: { messageId } };
    },
    "ai-chat.get-chat-response": async (node) => {
      const cfg = (node.config ?? {}) as { messageId?: string };
      if (hooks.getChatResponse && cfg.messageId) {
        const r = await hooks.getChatResponse(cfg.messageId);
        return { outputs: { text: r.text } };
      }
      return { outputs: { text: "[mocked response]" } };
    },
    "ai-chat.ai-analysis": async (node) => {
      const cfg = (node.config ?? {}) as { input?: unknown };
      if (hooks.aiAnalyze) {
        const r = await hooks.aiAnalyze(cfg.input);
        return { outputs: { analysis: r.analysis } };
      }
      return { outputs: { analysis: `[mock-analysis] ${JSON.stringify(cfg.input ?? null)}` } };
    },

    "user.user-choice": async (): Promise<PauseSignal> => ({
      __pause: true,
      ui: "panel",
      payload: { kind: "user-choice" },
    }),
    "user.input-form": async (): Promise<PauseSignal> => ({
      __pause: true,
      ui: "panel",
      payload: { kind: "input-form" },
    }),

    "control.condition": async (node) => {
      const cfg = (node.config ?? {}) as { value?: unknown };
      const v = cfg.value;
      const truthy = !!v;
      return { outputs: { value: v }, selectedBranch: truthy ? "true" : "false" };
    },
    "control.terminate": async () => ({ outputs: {}, terminate: true }),
    "control.loop": async () => ({ error: "Loop 节点首版未实现" }),

    "data.set-variable": async (node, ctx) => {
      const cfg = (node.config ?? {}) as { name?: string; value?: unknown };
      if (!cfg.name) return { error: "data.set-variable: missing config.name" };
      ctx.vars[cfg.name] = cfg.value;
      return { outputs: { value: cfg.value } };
    },
    "data.transform": async (node) => {
      const cfg = (node.config ?? {}) as { input?: unknown };
      // 首版只 echo（不解析 JS 表达式）
      return { outputs: { output: cfg.input } };
    },

    "script.run-python": async () => ({ error: "Run Python 节点首版 disabled" }),
    "script.run-shell": async () => ({ error: "Run Shell 节点首版 disabled" }),

    "output.show-result": async (node) => {
      const cfg = (node.config ?? {}) as { value?: unknown };
      // eslint-disable-next-line no-console
      console.log("[show-result]", cfg.value);
      return { outputs: {} };
    },
    "output.export-file": async (node) => {
      const cfg = (node.config ?? {}) as { path?: string; content?: unknown };
      const path = cfg.path ?? "(mock-path)";
      // eslint-disable-next-line no-console
      console.log("[export-file mock] →", path, cfg.content);
      return { outputs: { path } };
    },
  };
}

// ---- 查询辅助 ----

export function getDeclaration(type: string): NodeDeclaration | undefined {
  return NODE_DECLARATIONS.find((d) => d.type === type);
}

export function newNodeFromDeclaration(decl: NodeDeclaration, id: string, position: { x: number; y: number }): AWFFNode {
  return {
    id,
    kind: decl.kind,
    type: decl.type as AWFFNode["type"],
    name: decl.label,
    position,
    capabilities: { ...decl.capabilities },
    inputs: decl.inputs.map((p) => ({ ...p })) as AWFFNode["inputs"],
    outputs: decl.outputs.map((p) => ({ ...p })) as AWFFNode["outputs"],
    config: {},
  } as AWFFNode;
}

// reference for type-checking
export type { AWFFNode, NodeResult, RunCtx };
