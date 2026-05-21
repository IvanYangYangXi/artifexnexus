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
import {
  parseSessionKey,
  getCustomTitle,
  isSentinel,
  formatSessionDate,
  PENDING_NEW_KEY,
  EMPTY_KEY,
  NEW_KEY,
} from "../../lib/chat/session-key";
import { CHAT_MODEL_STORAGE_KEY } from "../../lib/chat/types";

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
  /** 父组件 +1 时重置 agent filter 为全部（新建对话后触发） */
  resetFilterVersion?: number;
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
  resetFilterVersion = 0,
}: ChatControlBarProps) {
  const [sessions, setSessions] = React.useState<SessionSummary[]>([]);
  const [agents, setAgents] = React.useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = React.useState<Array<{ id: string; name: string }>>([]);
  const [agent, setAgent] = React.useState(() => lsGet(AGENT_KEY, ""));
  const [model, setModel] = React.useState(() => lsGet(CHAT_MODEL_STORAGE_KEY, ""));
  const [effort, setEffort] = React.useState(() => lsGet(EFFORT_KEY, "adaptive"));
  const [loading, setLoading] = React.useState(false);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);
  /** Agent 筛选（"__all__" = 不过滤，1 个 agent 时隐藏筛选控件） */
  const [agentFilter, setAgentFilter] = React.useState("__all__");
  const showAgentFilter = agents.length > 1;

  // agentFilter 引用的 agent 被删除时回退到全部
  React.useEffect(() => {
    if (agentFilter !== "__all__" && agents.length > 0 && !agents.find(a => a.id === agentFilter)) {
      setAgentFilter("__all__");
    }
  }, [agents, agentFilter]);

  // 新建对话后由父组件触发：重置为"全部"筛选
  React.useEffect(() => {
    if (resetFilterVersion > 0) {
      setAgentFilter("__all__");
    }
  }, [resetFilterVersion]);

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
          if (target && !isSentinel(target.sessionKey)) {
            onSwitchSession(target.sessionKey);
          }
        }
      } catch (err) {
        // sidecar 不可用时保持空列表
        console.warn("[ChatControlBar] sessions load failed:", err);
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

        // 从配置中提取 models —— 统一用 ``provider/modelId`` 格式，避免同名模型
        // 在不同供应商下混淆（如 custom/gpt-4 vs openai/gpt-4）。
        // name 同样带 provider 前缀，便于下拉菜单清晰显示。
        const providers = (config as any)?.providers ?? {};
        const modelList: Array<{ id: string; name: string }> = [];
        for (const [providerId, provider] of Object.entries(providers)) {
          const p = provider as any;
          if (Array.isArray(p?.models)) {
            for (const m of p.models) {
              if (m?.id) {
                const fqId = `${providerId}/${m.id}`;
                const baseName = m.name ?? m.id;
                modelList.push({ id: fqId, name: `${providerId}/${baseName}` });
              }
            }
          }
        }
        if (modelList.length > 0) {
          setModels(modelList);
          setModel((prev) => {
            // 兼容旧 localStorage 的裸 id（如 "deepseek-v4-pro"），尝试匹配后缀
            const exactMatch = modelList.find((m) => m.id === prev);
            if (exactMatch) return prev;
            const suffixMatch = modelList.find((m) => m.id.split("/").pop() === prev);
            if (suffixMatch) {
              lsSet(CHAT_MODEL_STORAGE_KEY, suffixMatch.id);
              return suffixMatch.id;
            }
            const found = modelList[0].id;
            lsSet(CHAT_MODEL_STORAGE_KEY, found);
            return found;
          });
        }
      } catch (err) {
        // 配置读取失败，保持空
        console.warn("[ChatControlBar] config dump failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [gatewayRunning]);

  // ─── 回调 ──────────────────────────────────────────────────────────────

  const handleConvChange = (key: string) => {
    if (key === EMPTY_KEY || !key) {
      return;
    }
    if (key === NEW_KEY) {
      onOpenNewSessionDialog();
      return;
    }
    if (key === PENDING_NEW_KEY) {
      onSwitchToPending?.();
      return;
    }
    onSwitchSession(key);
    lsSet(ACTIVE_SESSION_KEY, key);
  };

  const selectValue = activeSessionKey === PENDING_NEW_KEY ? PENDING_NEW_KEY : (activeSessionKey || EMPTY_KEY);
  const isPending = activeSessionKey === PENDING_NEW_KEY && !!pendingConfig;

  // 按 agentFilter 筛选后的对话列表
  const filteredSessions = agentFilter === "__all__"
    ? sessions
    : sessions.filter(s => {
        const keyAgentId = parseSessionKey(s.sessionKey)?.agentId;
        return (keyAgentId ?? s.agentId) === agentFilter;
      });

  // 从活跃对话中提取真实的 Agent/Model（而非 localStorage 偏好）
  const activeSession = !isSentinel(activeSessionKey)
    ? sessions.find(s => s.sessionKey === activeSessionKey)
    : null;
  const displayAgentId = isPending
    ? (pendingConfig?.agentId ?? "")
    : activeSession
      ? (activeSession.agentId || parseSessionKey(activeSessionKey)?.agentId || "")
      : agent;
  const displayModelId = isPending
    ? (pendingConfig?.model ?? "")
    : activeSession
      ? (activeSession.model || "")
      : model;

  /** 将会话中的裸 model ID（如 "deepseek-v4-pro"）解析为 Select 可识别的
   *  ``provider/modelId`` 格式（如 "custom/deepseek-v4-pro"）。
   *  已有 ``/`` 的直接返回，没有的在 models 列表中按后缀匹配。 */
  function resolveFullModelId(raw: string): string {
    if (!raw) return "";
    if (raw.includes("/")) return raw;
    const match = models.find((m) => m.id.endsWith("/" + raw) || m.id.endsWith("\\" + raw));
    return match ? match.id : raw;
  }

  // 切换对话时同步 model 到当前会话的实际模型
  React.useEffect(() => {
    const sessionModel = activeSession?.model;
    if (!sessionModel || models.length === 0) return;
    const fullId = resolveFullModelId(sessionModel);
    if (fullId && fullId !== model) {
      setModel(fullId);
    }
  }, [activeSessionKey]); // 仅监听 key 切换，不依赖 model/models 避免回环

  const selectPlaceholder =
    sessionsLoading ? "加载中..." :
    !gatewayRunning ? "Gateway 未启动" :
    isPending ? "📝 新对话 (未发送)" :
    filteredSessions.length === 0 ? "暂无匹配对话" : "选择对话";

  // ─── 渲染 ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      {/* Agent 筛选（仅多 agent 时显示） */}
      {showAgentFilter && (
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="h-7 w-[110px] gap-1 border-0 bg-transparent text-[11px] shadow-none hover:bg-accent/50">
            <SelectValue placeholder="全部 Agent">
              {agentFilter === "__all__" ? "全部 Agent" : agents.find(a => a.id === agentFilter)?.name ?? agentFilter}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部 Agent ({sessions.length})</SelectItem>
            {agents.map(a => {
              const count = sessions.filter(s => (parseSessionKey(s.sessionKey)?.agentId ?? s.agentId) === a.id).length;
              return (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                  <span className="ml-1 text-[10px] text-muted-foreground">({count})</span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}

      {/* 对话列表 */}
      <Select value={selectValue} onValueChange={handleConvChange}>
        <SelectTrigger className="h-7 w-[240px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue placeholder={selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {/* 未发送的新建对话（优先展示） */}
          {pendingConfig && (
            <>
              <SelectItem value={PENDING_NEW_KEY}>
                <span className="flex w-full items-center gap-1 min-w-0">
                  <span className="flex-1 truncate text-left">📝 新对话 (未发送)</span>
                  {onCancelPending && (
                    <button
                      className="shrink-0 p-0.5 rounded text-muted-foreground/40 hover:bg-destructive/20 hover:text-destructive transition-colors"
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
                </span>
              </SelectItem>
              <div className="border-t border-border my-1" />
            </>
          )}
          {!pendingConfig && filteredSessions.length === 0 && (
            <SelectItem value={EMPTY_KEY} disabled className="text-muted-foreground">
              {agentFilter !== "__all__" ? "该 Agent 暂无对话" : "暂无对话"}
            </SelectItem>
          )}
          {filteredSessions.map((s) => {
            const localTitle = getCustomTitle(s.sessionKey);
            const datePrefix = formatSessionDate(s.createdAt || s.updatedAt);
            const textTitle = localTitle || s.title || s.sessionKey;
            const displayTitle = `${datePrefix} ${textTitle}`;
            return (
              <SelectItem key={s.sessionKey} value={s.sessionKey}>
                <span className="flex w-full items-center min-w-0 gap-1.5">
                  <span className="truncate flex-1">{displayTitle}</span>
                  {onDeleteSession && (
                    <>
                      <span
                        className="w-px h-3 bg-border/50 shrink-0"
                        aria-hidden="true"
                      />
                      <button
                        className="shrink-0 p-0.5 rounded text-muted-foreground/20 hover:bg-destructive/15 hover:text-destructive transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onDeleteSession(s.sessionKey);
                        }}
                        title="删除对话"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </span>
              </SelectItem>
            );
          })}
          <div className="border-t border-border mt-1 pt-1">
            <SelectItem value={NEW_KEY}>
              <Plus className="mr-1 h-3.5 w-3.5" />新建对话
            </SelectItem>
          </div>
        </SelectContent>
      </Select>

      <div className="flex-1" />

      {/* ─── Agent / Model / Thinking 只读标签 + [+] 按钮 ─── */}

      {/* Agent 标签 — 来自活跃对话的真实 agent，而非 localStorage 偏好 */}
      <span className="inline-flex items-center rounded bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground shrink-0">
        {loading ? "Agent: 加载中..." : gatewayRunning
          ? `Agent: ${agents.find(a => a.id === displayAgentId)?.name ?? (displayAgentId || "—")}`
          : "Agent: —"}
      </span>

      {/* Model 下拉 — 可切换模型，格式对齐 NewSessionDialog（provider/modelId） */}
      {loading ? (
        <span className="inline-flex items-center rounded bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground shrink-0">
          Model: 加载中...
        </span>
      ) : gatewayRunning && models.length > 0 ? (
        <Select
          value={resolveFullModelId(model || displayModelId)}
          onValueChange={(newModel) => {
            setModel(newModel);
            lsSet(CHAT_MODEL_STORAGE_KEY, newModel);
            onConfigChange?.({ model: newModel });
          }}
        >
          <SelectTrigger className="h-7 gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50 min-w-[160px] max-w-[240px] shrink-0 [&>span]:truncate">
            <span className="text-[10px] text-muted-foreground mr-0.5 shrink-0">Model:</span>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent align="end">
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="inline-flex items-center rounded bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground shrink-0">
          Model: —
        </span>
      )}

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
