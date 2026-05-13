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
import { Plus, Trash2, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
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
  /** 当前活跃对话 sessionKey（空串 = 无选中，"__pending_new__" = 未发送的新建） */
  activeSessionKey: string;
  /** 切换到指定对话 */
  onSwitchSession: (sessionKey: string) => void;
  /** 新建对话（已废弃，改用 onOpenNewSessionDialog） */
  onNewSession?: () => void;
  /** Gateway HTTP 端口 */
  gatewayPort: number;
  /** Gateway 是否在运行 */
  gatewayRunning: boolean;
  /** Agent/Model/Thinking 变更时通知父组件 */
  onConfigChange?: (cfg: { agentId?: string; model?: string; thinking?: string }) => void;
  /** 点击 [+] 打开新建对话配置面板 */
  onOpenNewSessionDialog: () => void;
  /** 删除指定对话 */
  onDeleteSession?: (sessionKey: string) => void;
  /** 对话列表刷新版本号：父组件 +1 时触发重拉 Gateway sessions */
  sessionsVersion?: number;
  /** 暂存的新建对话配置（用于下拉菜单 pending 条目 + 标签显示） */
  pendingConfig?: { agentId: string; model: string; thinking: string } | null;
  /** 取消新建对话 */
  onCancelPending?: () => void;
  /** 切回未发送的新建对话 */
  onSwitchToPending?: () => void;
}

// ─── 组件 ─────────────────────────────────────────────────────────────────

export function ChatControlBar({
  activeSessionKey,
  onSwitchSession,
  onNewSession: _onNewSession,
  gatewayPort,
  gatewayRunning,
  onConfigChange,
  onOpenNewSessionDialog,
  onDeleteSession,
  sessionsVersion = 0,
  pendingConfig,
  onCancelPending,
  onSwitchToPending,
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

        // 如果没有活跃对话，自动选中最近的那个（但 pending 存在时不抢）
        if (!activeSessionKey && !pendingConfig && result.sessions.length > 0) {
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
  }, [gatewayRunning, activeSessionKey, sessionsVersion]);

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
    if (key === "__empty__" || !key) {
      return;
    }
    if (key === "__new__") {
      onOpenNewSessionDialog();
      return;
    }
    if (key === "__pending_new__") {
      onSwitchToPending?.();
      return;
    }
    onSwitchSession(key);
    lsSet(ACTIVE_SESSION_KEY, key);
  };

  const selectValue = activeSessionKey === "__pending_new__" ? "__pending_new__" : (activeSessionKey || "__empty__");
  const isPending = activeSessionKey === "__pending_new__" && !!pendingConfig;

  const selectPlaceholder =
    sessionsLoading ? "加载中..." :
    !gatewayRunning ? "Gateway 未启动" :
    isPending ? "📝 新对话 (未发送)" :
    sessions.length === 0 ? "暂无对话" : "选择对话";

  // ─── 渲染 ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      {/* 对话列表 */}
      <Select value={selectValue} onValueChange={handleConvChange}>
        <SelectTrigger className="h-7 w-[180px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue placeholder={selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {/* 未发送的新建对话（优先展示） */}
          {pendingConfig && (
            <>
              <SelectItem value="__pending_new__" className="group">
                <span className="flex-1 truncate">📝 新对话 (未发送)</span>
                {onCancelPending && (
                  <button
                    className="shrink-0 ml-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onCancelPending();
                    }}
                    title="取消新建"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </SelectItem>
              <div className="border-t border-border my-1" />
            </>
          )}
          {!pendingConfig && sessions.length === 0 && (
            <SelectItem value="__empty__" disabled className="text-muted-foreground">暂无对话</SelectItem>
          )}
          {sessions.map((s) => {
            // 优先使用 localStorage 中的自定义标题（格式: "MM/DD HH:mm 摘要"）
            const localTitle = (() => {
              try { return localStorage.getItem(`artifex.session.title:${s.sessionKey}`); } catch { return null; }
            })();
            const displayTitle = localTitle || s.title || s.sessionKey;
            return (
              <SelectItem key={s.sessionKey} value={s.sessionKey} className="group">
                <span className="flex-1 truncate">
                  <span>{displayTitle}</span>
                  {s.model && <span className="ml-1 text-[10px] text-muted-foreground">{s.model}</span>}
                </span>
                {onDeleteSession && (
                  <button
                    className="shrink-0 ml-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onDeleteSession(s.sessionKey);
                    }}
                    title="删除对话"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </SelectItem>
            );
          })}
          <div className="border-t border-border mt-1 pt-1">
            <SelectItem value="__new__">
              <Plus className="mr-1 h-3.5 w-3.5" />新建对话
            </SelectItem>
          </div>
        </SelectContent>
      </Select>

      <div className="flex-1" />

      {/* ─── Agent / Model / Thinking 只读标签 + [+] 按钮 ─── */}

      {/* Agent 标签 */}
      <span className="inline-flex items-center rounded bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground shrink-0">
        {isPending ? `Agent: ${pendingConfig!.agentId}` :
         loading ? "Agent: 加载中..." : gatewayRunning
          ? `Agent: ${agents.find(a => a.id === agent)?.name ?? agent}`
          : "Agent: —"}
      </span>

      {/* Model 标签 */}
      <span className="inline-flex items-center rounded bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground shrink-0">
        {isPending ? `Model: ${pendingConfig!.model}` :
         loading ? "Model: 加载中..." : gatewayRunning
          ? `Model: ${models.find(m => m.id === model)?.name ?? model}`
          : "Model: —"}
      </span>

      {/* Thinking 标签 */}
      <span className="inline-flex items-center rounded bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground shrink-0">
        {isPending
          ? `思考: ${THINKING_OPTIONS.find(e => e.id === pendingConfig!.thinking)?.label?.replace("思考: ", "") ?? pendingConfig!.thinking}`
          : THINKING_OPTIONS.find(e => e.id === effort)?.label ?? "思考: 自适应"}
      </span>

      {/* [+] 新建对话 */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onOpenNewSessionDialog}
        title="新建对话"
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
