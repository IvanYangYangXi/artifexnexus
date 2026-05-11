"use client";

/**
 * ChatControlBar — C1 对话控制栏
 *
 * 布局：对话列表（最左）| 空白 | Agent / Model / Effort（靠右）
 *
 * STORY-0039 v2：接入真实数据源
 *   - 对话列表：chat-service sessions（localStorage 持久化）
 *   - Agent 列表：settings reducer → dumpOpenClawConfig.agents.list
 *   - 模型列表：settings reducer → dumpOpenClawConfig.models.providers[*].models[*]
 *   - 思考强度：settings reducer → agents.defaults.thinkingDefault，分级与设置面板 Agent thinking 下拉一致
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
import {
  settingsReducer,
  createInitialState,
  type SettingsState,
} from "../../features/settings/settings.reducer";

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

const EFFORT_STORAGE_KEY = "artifex.chat.effort";
const MODEL_STORAGE_KEY = "artifex.chat.model";
const AGENT_STORAGE_KEY = "artifex.chat.agent";

function loadStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function storeVal(key: string, val: string): void {
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
  onAgentChange?: (agentId: string) => void;
  onModelChange?: (modelId: string) => void;
  onEffortChange?: (effort: string) => void;
}

// ─── 组件 ─────────────────────────────────────────────────────────────────

export function ChatControlBar({
  sessions,
  activeSessionId,
  onSwitchSession,
  onNewSession,
  onDeleteSession,
  gatewayRunning,
  onAgentChange,
  onModelChange,
  onEffortChange,
}: ChatControlBarProps) {
  // 从 openclaw.json 加载真实配置
  const [settings, dispatch] = React.useReducer(settingsReducer, undefined, createInitialState);
  const [loaded, setLoaded] = React.useState(false);

  // 当前选中值（localStorage 持久化用户偏好）
  const [agent, setAgent] = React.useState(() => loadStored(AGENT_STORAGE_KEY, ""));
  const [model, setModel] = React.useState(() => loadStored(MODEL_STORAGE_KEY, ""));
  const [effort, setEffort] = React.useState(() => loadStored(EFFORT_STORAGE_KEY, "adaptive"));

  // 加载配置
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const ipc = await getIpc();
        const dump = await ipc.dumpOpenClawConfig();
        if (cancelled) return;
        dispatch({ type: "LOAD_SUCCESS", dump });
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true); // 加载失败也视为完成，显示空状态
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Gateway 启动后重新加载配置
  React.useEffect(() => {
    if (!gatewayRunning) return;
    let cancelled = false;
    const reload = async () => {
      try {
        const ipc = await getIpc();
        const dump = await ipc.dumpOpenClawConfig();
        if (cancelled) return;
        dispatch({ type: "LOAD_SUCCESS", dump });
      } catch { /* ignore */ }
    };
    reload();
    return () => { cancelled = true; };
  }, [gatewayRunning]);

  // ─── 派生数据───────────────────────────────────────────────────────────

  // Agent 列表：来自 agents.list
  const agents = React.useMemo(() => {
    const list = settings.agentPresets ?? [];
    if (list.length === 0) return [];
    return list.map((p) => ({ id: p.id, name: p.name ?? p.id }));
  }, [settings.agentPresets]);

  // 模型列表：来自 models.providers[*].models[*]
  const models = React.useMemo(() => {
    const providers = settings.providers ?? [];
    const result: Array<{ id: string; name: string }> = [];
    for (const p of providers) {
      for (const m of p.models ?? []) {
        if (m.id && !result.find((r) => r.id === m.id)) {
          result.push({ id: m.id, name: m.id });
        }
      }
    }
    return result;
  }, [settings.providers]);

  // 默认 agent（agents.list 中 default:true 的项）
  const defaultAgentId = React.useMemo(() => {
    const list = settings.agentPresets ?? [];
    return list.find((p) => p.default)?.id ?? list[0]?.id ?? "";
  }, [settings.agentPresets]);

  // 默认 thinking（agents.defaults.thinkingDefault）
  const defaultThinking = React.useMemo(() => {
    return settings.defaultAgent?.thinkingDefault ?? "adaptive";
  }, [settings.defaultAgent]);

  // 首次加载后自动选中默认值
  React.useEffect(() => {
    if (!loaded) return;
    if (!agent && defaultAgentId) {
      setAgent(defaultAgentId);
      storeVal(AGENT_STORAGE_KEY, defaultAgentId);
    }
    if (!model && models.length > 0) {
      setModel(models[0].id);
      storeVal(MODEL_STORAGE_KEY, models[0].id);
    }
    if (!effort && defaultThinking) {
      // 如果当前 effort 不在 THINKING_OPTIONS 中，使用 defaultThinking
      if (!THINKING_OPTIONS.find((t) => t.id === effort)) {
        setEffort(defaultThinking);
        storeVal(EFFORT_STORAGE_KEY, defaultThinking);
      }
    }
  }, [loaded, agent, model, effort, defaultAgentId, models, defaultThinking]);

  // ─── 回调 ──────────────────────────────────────────────────────────────

  const handleAgentChange = (id: string) => {
    setAgent(id);
    storeVal(AGENT_STORAGE_KEY, id);
    onAgentChange?.(id);
  };

  const handleModelChange = (id: string) => {
    setModel(id);
    storeVal(MODEL_STORAGE_KEY, id);
    onModelChange?.(id);
  };

  const handleEffortChange = (id: string) => {
    setEffort(id);
    storeVal(EFFORT_STORAGE_KEY, id);
    onEffortChange?.(id);
  };

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
      {/* 对话列表 */}
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
      <Select value={agent} onValueChange={handleAgentChange} disabled={agents.length === 0}>
        <SelectTrigger className={cn(
          "h-7 w-[140px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50",
          agents.length === 0 && "text-muted-foreground",
        )}>
          <SelectValue placeholder={agents.length === 0 ? "无可用 Agent" : undefined} />
        </SelectTrigger>
        {agents.length > 0 && (
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        )}
      </Select>

      {/* Model */}
      <Select value={model} onValueChange={handleModelChange} disabled={models.length === 0}>
        <SelectTrigger className={cn(
          "h-7 w-[150px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50",
          models.length === 0 && "text-muted-foreground",
        )}>
          <SelectValue placeholder={models.length === 0 ? "无可用模型" : undefined} />
        </SelectTrigger>
        {models.length > 0 && (
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        )}
      </Select>

      {/* Effort / 思考强度 */}
      <Select value={effort} onValueChange={handleEffortChange}>
        <SelectTrigger className="h-7 w-[100px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THINKING_OPTIONS.map((e) => (
            <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
