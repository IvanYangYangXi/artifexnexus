"use client";

/**
 * ChatControlBar — C1 对话控制栏
 *
 * 数据源（STORY-0039 M3 方案 B）：
 *   - 对话列表：sidecar RPC openclaw.sessions.list（从 Gateway sessions.json 读取）
 *   - Agent/Model 列表：Gateway HTTP REST API（/v1/agents, /v1/models）
 *   - 思考强度：localStorage 用户偏好，分级对齐设置面板
 *   - 切换 Agent/Model 后持久化到 localStorage
 */

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  cn,
} from "@artifex-nexus/ui";
import type { SessionSummary } from "../../ipc/openclaw";

// ─── 思考强度 ──────────────────────────────────────────────────────────────

const THINKING_OPTIONS = [
  { id: "off", label: "思考: 关" },
  { id: "minimal", label: "思考: 最低" },
  { id: "low", label: "思考: 低" },
  { id: "medium", label: "思考: 中" },
  { id: "high", label: "思考: 高" },
  { id: "xhigh", label: "思考: 很高" },
  { id: "adaptive", label: "思考: 自适应" },
  { id: "max", label: "思考: 最高" },
];

const EFFORT_KEY = "artifex.chat.effort";
const MODEL_KEY = "artifex.chat.model";
const AGENT_KEY = "artifex.chat.agent";
const ACTIVE_SESSION_KEY = "artifex.chat.activeSession";

function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key: string, val: string): void {
  try { localStorage.setItem(key, val); } catch { /* ignore */ }
}

// ─── Props ─────────────────────────────────────────────────────────────────

export interface ChatControlBarProps {
  /** 当前活跃对话 sessionKey（空串 = 无选中） */
  activeSessionKey: string;
  /** 切换到指定对话 */
  onSwitchSession: (sessionKey: string) => void;
  /** 新建对话 */
  onNewSession: () => void;
  /** Gateway HTTP 端口 */
  gatewayPort: number;
  /** Gateway 是否在运行 */
  gatewayRunning: boolean;
  /** Agent/Model/Thinking 变更时通知父组件 */
  onConfigChange?: (cfg: { agentId?: string; model?: string; thinking?: string }) => void;
}

// ─── 组件 ─────────────────────────────────────────────────────────────────

export function ChatControlBar({
  activeSessionKey,
  onSwitchSession,
  onNewSession,
  gatewayPort,
  gatewayRunning,
  onConfigChange,
}: ChatControlBarProps) {
  const [sessions, setSessions] = React.useState<SessionSummary[]>([]);
  const [agents, setAgents] = React.useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = React.useState<Array<{ id: string; name: string }>>([]);
  const [agent, setAgent] = React.useState(() => lsGet(AGENT_KEY, ""));
  const [model, setModel] = React.useState(() => lsGet(MODEL_KEY, ""));
  const [effort, setEffort] = React.useState(() => lsGet(EFFORT_KEY, "adaptive"));
  const [loading, setLoading] = React.useState(false);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);

  // Gateway 运行后通过 sidecar RPC 拉取对话列表
  React.useEffect(() => {
    if (!gatewayRunning) return;

    let cancelled = false;
    setSessionsLoading(true);

    const loadSessions = async () => {
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const result = await ipc.getSessionsList({ limit: 50 });
        if (cancelled) return;
        setSessions(result.sessions);

        // 如果没有活跃对话，自动选中最近的那个
        if (!activeSessionKey && result.sessions.length > 0) {
          const saved = lsGet(ACTIVE_SESSION_KEY, "");
          const target = result.sessions.find((s: SessionSummary) => s.sessionKey === saved)
            ?? result.sessions[0];
          if (target) {
            onSwitchSession(target.sessionKey);
          }
        }
      } catch {
        // sidecar 不可用时保持空列表
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    };

    loadSessions();
    return () => { cancelled = true; };
  }, [gatewayRunning]);

  // Gateway 运行后通过 sidecar 读取配置中的 Agent/Model 列表
  React.useEffect(() => {
    if (!gatewayRunning) return;

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const config = await ipc.dumpOpenClawConfig();
        if (cancelled) return;

        // 从配置中提取 agents（字段名: agentList）
        const agentsList = (config as any)?.agentList ?? [];
        if (Array.isArray(agentsList) && agentsList.length > 0) {
          const list = agentsList
            .filter((a: any) => a?.id)
            .map((a: any) => ({ id: a.id, name: a.name ?? a.id }));
          setAgents(list);
          setAgent((prev) => {
            if (list.find((a: { id: string }) => a.id === prev)) return prev;
            const found = list.find((a: { id: string }) => a.id === "artifex-nexus")?.id ?? list[0].id;
            lsSet(AGENT_KEY, found);
            return found;
          });
        }

        // 从配置中提取 models（字段名: providers，每个 provider 有 models 数组）
        const providers = (config as any)?.providers ?? {};
        const modelList: Array<{ id: string; name: string }> = [];
        for (const [_providerId, provider] of Object.entries(providers)) {
          const p = provider as any;
          if (Array.isArray(p?.models)) {
            for (const m of p.models) {
              if (m?.id) {
                modelList.push({ id: m.id, name: m.name ?? m.id });
              }
            }
          }
        }
        if (modelList.length > 0) {
          setModels(modelList);
          setModel((prev) => {
            if (modelList.find((m: { id: string }) => m.id === prev)) return prev;
            const found = modelList[0].id;
            lsSet(MODEL_KEY, found);
            return found;
          });
        }
      } catch {
        // 配置读取失败，保持空
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [gatewayRunning]);

  // ─── 回调 ──────────────────────────────────────────────────────────────

  const handleConvChange = (key: string) => {
    if (key === "__new__") {
      onNewSession();
    } else {
      onSwitchSession(key);
      lsSet(ACTIVE_SESSION_KEY, key);
    }
  };

  // ─── 渲染 ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      {/* 对话列表 */}
      <Select value={activeSessionKey || undefined} onValueChange={handleConvChange}>
        <SelectTrigger className="h-7 w-[180px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue placeholder={
            sessionsLoading ? "加载中..." :
            !gatewayRunning ? "Gateway 未启动" :
            sessions.length === 0 ? "暂无对话" : "选择对话"
          } />
        </SelectTrigger>
        <SelectContent>
          {sessions.map((s) => (
            <SelectItem key={s.sessionKey} value={s.sessionKey} className="group">
              <span className="flex-1 truncate max-w-[130px]">{s.title}</span>
              {s.model && (
                <span className="ml-1 text-[10px] text-muted-foreground">{s.model}</span>
              )}
            </SelectItem>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <SelectItem value="__new__">
              <Plus className="mr-1 h-3.5 w-3.5" />新建对话
            </SelectItem>
          </div>
        </SelectContent>
      </Select>

      <div className="flex-1" />

      {/* Agent */}
      <Select value={agent} onValueChange={(v) => { setAgent(v); lsSet(AGENT_KEY, v); onConfigChange?.({ agentId: v, model, thinking: effort }); }} disabled={agents.length === 0}>
        <SelectTrigger className={cn("h-7 w-[140px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50", agents.length === 0 && "text-muted-foreground")}>
          <SelectValue placeholder={loading ? "加载中..." : gatewayRunning ? "无可用 Agent" : "Gateway 未启动"} />
        </SelectTrigger>
        {agents.length > 0 && (
          <SelectContent>
            {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        )}
      </Select>

      {/* Model */}
      <Select value={model} onValueChange={(v) => { setModel(v); lsSet(MODEL_KEY, v); onConfigChange?.({ agentId: agent, model: v, thinking: effort }); }} disabled={models.length === 0}>
        <SelectTrigger className={cn("h-7 w-[150px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50", models.length === 0 && "text-muted-foreground")}>
          <SelectValue placeholder={loading ? "加载中..." : gatewayRunning ? "无可用模型" : "Gateway 未启动"} />
        </SelectTrigger>
        {models.length > 0 && (
          <SelectContent>
            {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        )}
      </Select>

      {/* Effort */}
      <Select value={effort} onValueChange={(v) => { setEffort(v); lsSet(EFFORT_KEY, v); onConfigChange?.({ agentId: agent, model, thinking: v }); }}>
        <SelectTrigger className="h-7 w-[100px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THINKING_OPTIONS.map((e) => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
