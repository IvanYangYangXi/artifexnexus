"use client";

/**
 * ChatControlBar — C1 对话控制栏
 *
 * 布局：对话列表（最左）| 空白 | Agent / Model / Effort（靠右）
 *
 * 所有数据均来自真实 Gateway API，无占位 fallback。
 * Gateway 不可用时显示空状态或不可用提示。
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
import { fetchGatewayModels, fetchGatewayAgents } from "../../lib/chat/gateway-api";
import type { ModelOption, AgentOption, ChatSession } from "../../lib/chat/types";

// ─── Effort / 思考深度 ────────────────────────────────────────────────────

const EFFORTS = [
  { id: "low", name: "思考: 低" },
  { id: "medium", name: "思考: 中" },
  { id: "high", name: "思考: 高" },
];

const EFFORT_STORAGE_KEY = "artifex.chat.effort";

function loadEffort(): string {
  try {
    return localStorage.getItem(EFFORT_STORAGE_KEY) ?? "medium";
  } catch {
    return "medium";
  }
}

function saveEffort(id: string): void {
  try {
    localStorage.setItem(EFFORT_STORAGE_KEY, id);
  } catch { /* ignore */ }
}

// ─── Props ─────────────────────────────────────────────────────────────────

export interface ChatControlBarProps {
  /** 会话列表（来自 chat-service，真实数据） */
  sessions: ChatSession[];
  /** 当前活跃会话 ID */
  activeSessionId: string;
  /** 切换会话 */
  onSwitchSession: (id: string) => void;
  /** 新建会话 */
  onNewSession: () => void;
  /** 删除会话 */
  onDeleteSession: (id: string) => void;
  /** Gateway 端口 */
  gatewayPort: number;
  /** Gateway 是否运行中 */
  gatewayRunning: boolean;
  /** Agent 变更回调 */
  onAgentChange?: (agentId: string) => void;
  /** Model 变更回调 */
  onModelChange?: (modelId: string) => void;
  /** Effort 变更回调 */
  onEffortChange?: (effort: string) => void;
}

// ─── 组件 ─────────────────────────────────────────────────────────────────

export function ChatControlBar({
  sessions,
  activeSessionId,
  onSwitchSession,
  onNewSession,
  onDeleteSession,
  gatewayPort,
  gatewayRunning,
  onAgentChange,
  onModelChange,
  onEffortChange,
}: ChatControlBarProps) {
  const [models, setModels] = React.useState<ModelOption[]>([]);
  const [agents, setAgents] = React.useState<AgentOption[]>([]);
  const [model, setModel] = React.useState("");
  const [agent, setAgent] = React.useState("");
  const [effort, setEffort] = React.useState(loadEffort);
  const [loading, setLoading] = React.useState(false);

  // 从 Gateway 拉取真实模型和 Agent 列表
  React.useEffect(() => {
    if (!gatewayRunning || !gatewayPort) {
      // Gateway 不可用时清空列表
      setModels([]);
      setAgents([]);
      setModel("");
      setAgent("");
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const [modelList, agentList] = await Promise.all([
          fetchGatewayModels(gatewayPort),
          fetchGatewayAgents(gatewayPort),
        ]);

        if (cancelled) return;

        setModels(modelList);
        setAgents(agentList);

        // 选择第一个可用项（不保留无效选中值）
        if (modelList.length > 0) {
          setModel((prev) => modelList.find((m) => m.id === prev)?.id ?? modelList[0].id);
        } else {
          setModel("");
        }
        if (agentList.length > 0) {
          setAgent((prev) => agentList.find((a) => a.id === prev)?.id ?? agentList[0].id);
        } else {
          setAgent("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [gatewayRunning, gatewayPort]);

  // ─── 变更回调 ─────────────────────────────────────────────────────────

  const handleAgentChange = (id: string) => {
    setAgent(id);
    onAgentChange?.(id);
  };

  const handleModelChange = (id: string) => {
    setModel(id);
    onModelChange?.(id);
  };

  const handleEffortChange = (id: string) => {
    setEffort(id);
    saveEffort(id);
    onEffortChange?.(id);
  };

  const handleDeleteConv = (id: string) => {
    if (sessions.length <= 1) return;
    onDeleteSession(id);
  };

  const handleConversationChange = (id: string) => {
    if (id === "__new__") {
      onNewSession();
    } else {
      onSwitchSession(id);
    }
  };

  // ─── 渲染 ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      {/* C1c 对话列表 */}
      <Select value={activeSessionId} onValueChange={handleConversationChange}>
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
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteConv(s.id);
                }}
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </Button>
            </SelectItem>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <SelectItem value="__new__">
              <Plus className="mr-1 h-3.5 w-3.5" />
              新建对话
            </SelectItem>
          </div>
        </SelectContent>
      </Select>

      <div className="flex-1" />

      {/* C1a Agent */}
      <Select value={agent} onValueChange={handleAgentChange} disabled={agents.length === 0}>
        <SelectTrigger
          className={cn(
            "h-7 w-[140px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50",
            agents.length === 0 && "text-muted-foreground",
          )}
        >
          <SelectValue placeholder={loading ? "加载中..." : gatewayRunning ? "无可用 Agent" : "Gateway 未启动"} />
        </SelectTrigger>
        {agents.length > 0 && (
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        )}
      </Select>

      {/* C1b Model */}
      <Select value={model} onValueChange={handleModelChange} disabled={models.length === 0}>
        <SelectTrigger
          className={cn(
            "h-7 w-[150px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50",
            models.length === 0 && "text-muted-foreground",
          )}
        >
          <SelectValue placeholder={loading ? "加载中..." : gatewayRunning ? "无可用模型" : "Gateway 未启动"} />
        </SelectTrigger>
        {models.length > 0 && (
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        )}
      </Select>

      {/* Effort / 思考深度 */}
      <Select value={effort} onValueChange={handleEffortChange}>
        <SelectTrigger className="h-7 w-[90px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EFFORTS.map((e) => (
            <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
