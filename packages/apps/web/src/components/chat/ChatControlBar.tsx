"use client";

/**
 * ChatControlBar — C1 对话控制栏
 *
 * 数据源：
 *   - 对话列表：sessions prop（chat-service localStorage 持久化）
 *   - Agent/Model 列表：Gateway WS RPC（WebSocket 连接成功后获取）
 *   - 思考强度：localStorage 用户偏好
 *
 * 关键设计：Gateway 启动需要 ~6s（sidecar spawn + HTTP + plugins），
 * WebSocket 在 gateway.ready 之前会被拒绝。数据加载等待 WS 成功连接后触发。
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
import type { ChatSession } from "../../lib/chat/types";
import { GatewayWebSocket, type WsConnectionState } from "../../lib/chat/gateway-ws";

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
  gatewayPort: number;
  gatewayToken: string;
}

// ─── 组件 ─────────────────────────────────────────────────────────────────

export function ChatControlBar({
  sessions,
  activeSessionId,
  onSwitchSession,
  onNewSession,
  onDeleteSession,
  gatewayPort,
  gatewayToken,
}: ChatControlBarProps) {
  const [agents, setAgents] = React.useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = React.useState<Array<{ id: string; name: string }>>([]);
  const [agent, setAgent] = React.useState(() => lsGet(AGENT_KEY, ""));
  const [model, setModel] = React.useState(() => lsGet(MODEL_KEY, ""));
  const [effort, setEffort] = React.useState(() => lsGet(EFFORT_KEY, "adaptive"));
  const [wsState, setWsState] = React.useState<WsConnectionState>("disconnected");

  // 通过 Gateway WS RPC 获取 Agent/Model 列表
  React.useEffect(() => {
    if (!gatewayPort) return;

    const wsUrl = `ws://127.0.0.1:${gatewayPort}`;
    const ws = new GatewayWebSocket(wsUrl, gatewayToken);
    let unsubState: (() => void) | undefined;
    let unsubMsg: (() => void) | undefined;

    // 监听连接状态
    unsubState = ws.onStateChange((state) => {
      setWsState(state);
    });

    // 监听 RPC 响应获取模型和 agent 列表
    unsubMsg = ws.onMessage((event) => {
      // Gateway 在握手后主动推送 models.list 和 agents.list
      // 这些事件在 chat-service 的 wsRef 上也会收到，但我们需要在 ControlBar 独立监听
      // 当前方案：通过 Gateway REST API 获取（更简单可靠）
    });

    // 连接 + 等待连接成功
    let cancelled = false;
    const doConnect = async () => {
      const ok = await ws.connect();
      if (cancelled || !ok) return;

      // 连接成功后通过 HTTP REST 拉取数据
      try {
        // Agent 列表：从 Gateway 的 /v1/models 和预设配置获取
        const [modelResp, agentResp] = await Promise.allSettled([
          fetch(`http://127.0.0.1:${gatewayPort}/v1/models`, {
            headers: { "Accept": "application/json" },
          }),
          fetch(`http://127.0.0.1:${gatewayPort}/v1/agents`, {
            headers: { "Accept": "application/json" },
          }),
        ]);

        if (!cancelled && modelResp.status === "fulfilled" && modelResp.value.ok) {
          const data = await modelResp.value.json();
          const rawModels = data?.data ?? [];
          if (Array.isArray(rawModels) && rawModels.length > 0) {
            const list: Array<{ id: string; name: string }> = [];
            for (const m of rawModels) {
              if (m?.id && !list.find((x) => x.id === m.id)) {
                list.push({ id: m.id, name: m.id });
              }
            }
            setModels(list);
            // 自动选中
            setModel((prev) => {
              if (list.find((m) => m.id === prev)) return prev;
              const found = list[0].id;
              lsSet(MODEL_KEY, found);
              return found;
            });
          }
        }

        if (!cancelled && agentResp.status === "fulfilled" && agentResp.value.ok) {
          const data = await agentResp.value.json();
          const rawAgents = data?.data ?? [];
          if (Array.isArray(rawAgents) && rawAgents.length > 0) {
            const list: Array<{ id: string; name: string }> = [];
            for (const a of rawAgents) {
              if (a?.id) list.push({ id: a.id, name: a.name ?? a.id });
            }
            setAgents(list);
            setAgent((prev) => {
              if (list.find((a) => a.id === prev)) return prev;
              const found = list.find((a) => a.id === "artifex-nexus")?.id ?? list[0].id;
              lsSet(AGENT_KEY, found);
              return found;
            });
          }
        }
      } catch { /* REST API 不可用则保持空状态 */ }
    };

    doConnect();

    return () => {
      cancelled = true;
      unsubState?.();
      unsubMsg?.();
      ws.disconnect();
    };
  }, [gatewayPort, gatewayToken]);

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

  const loading = wsState !== "connected";

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      {/* 对话列表 */}
      <Select value={activeSessionId} onValueChange={handleConvChange}>
        <SelectTrigger className="h-7 w-[180px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue placeholder={sessions.length === 0 ? "暂无对话" : undefined} />
        </SelectTrigger>
        {sessions.length > 0 && (
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
        )}
      </Select>

      <div className="flex-1" />

      {/* Agent */}
      <Select value={agent} onValueChange={(v) => { setAgent(v); lsSet(AGENT_KEY, v); }} disabled={agents.length === 0}>
        <SelectTrigger className={cn("h-7 w-[140px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50", agents.length === 0 && "text-muted-foreground")}>
          <SelectValue placeholder={loading ? "等待 Gateway..." : "无可用 Agent"} />
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
          <SelectValue placeholder={loading ? "等待 Gateway..." : "无可用模型"} />
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
