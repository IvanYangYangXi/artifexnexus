"use client";

/**
 * ChatControlBar — C1 对话控制栏
 *
 * 数据源：
 *   - 对话列表：sessions prop（chat-service 管理，localStorage 持久化）
 *   - Agent/Model 列表：通过 IPC dumpOpenClawConfig 加载（Gateway 运行时）
 *   - 思考强度：localStorage 持久化用户偏好，分级对齐设置面板
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
import { getIpc } from "../../lib/ipc";
import type { ChatSession } from "../../lib/chat/types";

// ─── 思考强度分级（对齐设置面板 Agent thinking 下拉） ───────────────────

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

function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key: string, val: string): void {
  try { localStorage.setItem(key, val); } catch { /* ignore */ }
}

// ─── Props ─────────────────────────────────────────────────────────────────

export interface ChatControlBarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSwitchSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  gatewayRunning: boolean;
}

// ─── 组件 ─────────────────────────────────────────────────────────────────

export function ChatControlBar({
  sessions,
  activeSessionId,
  onSwitchSession,
  onNewSession,
  onDeleteSession,
  gatewayRunning,
}: ChatControlBarProps) {
  const [agents, setAgents] = React.useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = React.useState<Array<{ id: string; name: string }>>([]);
  const [agent, setAgent] = React.useState(() => lsGet(AGENT_KEY, ""));
  const [model, setModel] = React.useState(() => lsGet(MODEL_KEY, ""));
  const [effort, setEffort] = React.useState(() => lsGet(EFFORT_KEY, "adaptive"));

  // 从 openclaw.json 加载 Agent/Model 列表
  React.useEffect(() => {
    if (!gatewayRunning) return;
    let cancelled = false;
    const load = async () => {
      try {
        const ipc = await getIpc();
        const dump = await ipc.dumpOpenClawConfig();
        if (cancelled) return;

        // Agent 列表
        const agentList: Array<{ id: string; name: string }> = [];
        const rawAgents = dump?.agents?.list;
        if (Array.isArray(rawAgents)) {
          for (const a of rawAgents) {
            if (a?.id) agentList.push({ id: a.id, name: a.name ?? a.id });
          }
        }
        setAgents(agentList);

        // 模型列表
        const modelList: Array<{ id: string; name: string }> = [];
        const providers = dump?.models?.providers;
        if (Array.isArray(providers)) {
          for (const p of providers) {
            const pModels = p?.models;
            if (Array.isArray(pModels)) {
              for (const m of pModels) {
                if (m?.id && !modelList.find((x) => x.id === m.id)) {
                  modelList.push({ id: m.id, name: m.id });
                }
              }
            }
          }
        }
        setModels(modelList);

        // 自动选中默认值
        if (agentList.length > 0) {
          setAgent((prev) => {
            const found = agentList.find((a) => a.id === prev)?.id
              ?? agentList.find((a) => a.id === "artifex-nexus")?.id
              ?? agentList[0].id;
            lsSet(AGENT_KEY, found);
            return found;
          });
        }
        if (modelList.length > 0) {
          setModel((prev) => {
            const found = modelList.find((m) => m.id === prev)?.id ?? modelList[0].id;
            lsSet(MODEL_KEY, found);
            return found;
          });
        }
      } catch {
        // Gateway 未就绪则静默，保持空状态
      }
    };
    load();
    return () => { cancelled = true; };
  }, [gatewayRunning]);

  // ─── 回调 ──────────────────────────────────────────────────────────────

  const handleDeleteConv = (id: string) => {
    if (sessions.length <= 1) return;
    onDeleteSession(id);
  };

  const handleConvChange = (id: string) => {
    if (id === "__new__") onNewSession();
    else onSwitchSession(id);
  };

  // ─── 渲染 ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      {/* 对话列表（来自 chat-service sessions - localStorage 持久化） */}
      <Select value={activeSessionId} onValueChange={handleConvChange}>
        <SelectTrigger className="h-7 w-[180px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sessions.map((s) => (
            <SelectItem key={s.id} value={s.id} className="group">
              <span className="flex-1 truncate max-w-[130px]">{s.title}</span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 h-5 w-5 opacity-0 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); handleDeleteConv(s.id); }}
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </Button>
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
      <Select value={agent} onValueChange={(v) => { setAgent(v); lsSet(AGENT_KEY, v); }} disabled={agents.length === 0}>
        <SelectTrigger className={cn("h-7 w-[140px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50", agents.length === 0 && "text-muted-foreground")}>
          <SelectValue placeholder="加载中..." />
        </SelectTrigger>
        {agents.length > 0 && (
          <SelectContent>
            {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        )}
      </Select>

      {/* Model */}
      <Select value={model} onValueChange={(v) => { setModel(v); lsSet(MODEL_KEY, v); }} disabled={models.length === 0}>
        <SelectTrigger className={cn("h-7 w-[150px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50", models.length === 0 && "text-muted-foreground")}>
          <SelectValue placeholder="加载中..." />
        </SelectTrigger>
        {models.length > 0 && (
          <SelectContent>
            {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        )}
      </Select>

      {/* Effort */}
      <Select value={effort} onValueChange={(v) => { setEffort(v); lsSet(EFFORT_KEY, v); }}>
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
