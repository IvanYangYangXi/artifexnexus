"use client";

/**
 * ChatControlBar — C1 对话控制栏
 *
 * 布局：对话列表（最左）| 空白 | Agent / Model / Effort（靠右）
 *
 * STORY-0039：移除所有占位 mock 数据，接入 Gateway 真实 API。
 *   - 模型列表：Gateway GET /v1/models
 *   - Agent 列表：Gateway + 预设 fallback
 *   - 对话列表：chat-service 会话管理
 *   - Effort：用户偏好（localStorage）
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
} from "@artifex-nexus/ui";
import { fetchGatewayModels, fetchGatewayAgents } from "../../lib/chat/gateway-api";
import type { ModelOption, AgentOption, ChatSession } from "../../lib/chat/types";

const EFFORTS = [
  { id: "low", name: "低" },
  { id: "medium", name: "中" },
  { id: "high", name: "高" },
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

export interface ChatControlBarProps {
  /** 会话列表（来自 chat-service） */
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
}

/** 默认模型（Gateway 不可用时的 fallback） */
const DEFAULT_MODELS: ModelOption[] = [
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "deepseek-chat", name: "DeepSeek Chat" },
  { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
];

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
}: ChatControlBarProps) {
  const [models, setModels] = React.useState<ModelOption[]>(DEFAULT_MODELS);
  const [agents, setAgents] = React.useState<AgentOption[]>([
    { id: "artifex-nexus", name: "Artifex Nexus" },
  ]);
  const [model, setModel] = React.useState(DEFAULT_MODELS[0].id);
  const [agent, setAgent] = React.useState("artifex-nexus");
  const [effort, setEffort] = React.useState(loadEffort);

  // 从 Gateway 拉取真实模型和 Agent 列表
  React.useEffect(() => {
    if (!gatewayRunning || !gatewayPort) return;

    let cancelled = false;

    const load = async () => {
      const [modelList, agentList] = await Promise.all([
        fetchGatewayModels(gatewayPort),
        fetchGatewayAgents(gatewayPort),
      ]);

      if (cancelled) return;

      if (modelList.length > 0) {
        setModels(modelList);
        // 检查当前选中的模型是否在列表中
        if (!modelList.find((m) => m.id === model)) {
          setModel(modelList[0].id);
        }
      }

      if (agentList.length > 0) {
        setAgents(agentList);
        if (!agentList.find((a) => a.id === agent)) {
          setAgent(agentList[0].id);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [gatewayRunning, gatewayPort]);

  // Agent / Model / Effort 变更回调
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
  };

  const handleDeleteConv = (id: string) => {
    if (sessions.length <= 1) return; // 保留至少一个会话
    onDeleteSession(id);
  };

  const handleConversationChange = (id: string) => {
    if (id === "__new__") {
      onNewSession();
    } else {
      onSwitchSession(id);
    }
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      {/* C1c 对话列表 — 最左边 */}
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

      {/* C1a Agent 选择 */}
      <Select value={agent} onValueChange={handleAgentChange}>
        <SelectTrigger className="h-7 w-[140px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* C1b Model 选择 */}
      <Select value={model} onValueChange={handleModelChange}>
        <SelectTrigger className="h-7 w-[150px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Effort 下拉 */}
      <Select value={effort} onValueChange={handleEffortChange}>
        <SelectTrigger className="h-7 w-[80px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EFFORTS.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              思考: {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
