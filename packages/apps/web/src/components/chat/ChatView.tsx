"use client";

/**
 * ChatView — Chat 模块主组件（C1 控制栏 + C2 消息流 + C3 输入区）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §4
 * STORY-0039：接入 OpenClaw Gateway WebSocket 实现真实流式对话
 *
 * 对话管理流程（同步缓存方案）：
 * - chat-service 内部用内存 Map 缓存每个 session 的消息
 * - 切换对话时 switchSession 同步从 Map 读取，零延迟
 * - 新消息（发送/接收/流式）走 WebSocket，完成后自动写回 Map
 * - Gateway history 仅在首次打开（Map 为空）时后台静默加载
 */

import * as React from "react";
import { ChatControlBar } from "./ChatControlBar";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInputArea } from "./ChatInputArea";
import { NewSessionDialog } from "./NewSessionDialog";
import { RunToolContext, ChatPromptContext, GatewayContext } from "../shell/AppShell";
import { useChatService } from "../../lib/chat/chat-service";
import { uiLog } from "../../lib/ui-log";
import { toast } from "@artifex-nexus/ui";
import {
  buildSessionKey,
  newSessionSubKey,
  generateSessionTitle,
  setCustomTitle,
  isValidSessionKey,
  isSentinel,
  PENDING_NEW_KEY,
} from "../../lib/chat/session-key";
import { CHAT_MODEL_STORAGE_KEY } from "../../lib/chat/types";

export function ChatView() {
  const { pendingToolName, clearPendingTool } = React.useContext(RunToolContext);
  const { prompt: aiPrompt, clearPrompt } = React.useContext(ChatPromptContext);
  const { port, token, running: gatewayRunning, authReady, setWsConnected, setWsDegraded } = React.useContext(GatewayContext);
  const pendingHandledRef = React.useRef(false);

  // 当前活跃的 sessionKey
  const [activeSessionKey, setActiveSessionKey] = React.useState("");

  // 新建对话弹窗状态
  const [newSessionDialogOpen, setNewSessionDialogOpen] = React.useState(false);

  // Chat 状态机
  const chat = useChatService({
    gatewayPort: port,
    gatewayToken: token,
    gatewayRunning,
    authReady,
  });

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // 区分"切对话跳底"（instant）和"新消息平滑滚动"（smooth）
  const scrollBehaviorRef = React.useRef<ScrollBehavior>("instant");

  // 记住上一个真实 sessionKey，取消新建时回退
  const lastRealSessionKeyRef = React.useRef<string>("");

  // ─── 切换对话（纯同步，消息从内存缓存瞬间加载）─────────────────────
  const handleSwitchSession = React.useCallback(async (sessionKey: string) => {
    uiLog.click("ChatView", "switchSession", { sessionKey: sessionKey.slice(0, 30) });
    if (!sessionKey) return;
    // 哨兵：切到未发送的新建对话
    if (sessionKey === PENDING_NEW_KEY) {
      handleSwitchToPending();
      return;
    }
    // 其他哨兵 / 非法格式 → 忽略
    if (isSentinel(sessionKey)) return;
    if (!isValidSessionKey(sessionKey)) {
      console.warn("[ChatView] 拒绝非法 sessionKey:", sessionKey);
      return;
    }

    if (chat.isStreaming) {
      uiLog.state("ChatView", "stopStreamingForSwitch");
      await chat.stop();
    }

    // 保留 pendingNewConfigRef，让用户之后能切回来
    lastRealSessionKeyRef.current = sessionKey;

    setActiveSessionKey(sessionKey);
    scrollBehaviorRef.current = "instant";
    chat.switchSession(sessionKey);
    silentLoadHistory(sessionKey);
  }, [chat]);

  // ─── 新建对话（从弹窗获取配置后暂存，第一条消息时才真正创建 session）──
  const pendingNewConfigRef = React.useRef<{ agentId: string; model: string; thinking: string } | null>(null);
  /** 用于触发 ChatControlBar 刷新对话列表 */
  const [sessionsVersion, setSessionsVersion] = React.useState(0);
  /** 用于触发 ChatControlBar 重置 agent 筛选为"全部"（新建对话后） */
  const [resetFilterVersion, setResetFilterVersion] = React.useState(0);

  function handleNewSession(config: { agentId: string; model: string; thinking: string }) {
    uiLog.dialog("NewSessionDialog", "confirm", { agentId: config.agentId, model: config.model, thinking: config.thinking });
    // 记住从哪个对话来的（用于取消时回退）
    lastRealSessionKeyRef.current = activeSessionKey && activeSessionKey !== PENDING_NEW_KEY ? activeSessionKey : lastRealSessionKeyRef.current;
    // 暂存配置，不创建 sessionKey（等第一条消息发送时再创建）
    pendingNewConfigRef.current = config;
    chat.setSelectedConfig(config);
    chat.clearMessages();
    setActiveSessionKey(PENDING_NEW_KEY);
    setNewSessionDialogOpen(false);
    // 持久化选择到 localStorage
    try { localStorage.setItem("artifex.chat.agent", config.agentId); } catch { /* ignore */ }
    try { localStorage.setItem(CHAT_MODEL_STORAGE_KEY, config.model); } catch { /* ignore */ }
    try { localStorage.setItem("artifex.chat.effort", config.thinking); } catch { /* ignore */ }
  }

  // ─── 从已有对话切回未发送的新建状态 ─────────────────────────────────
  function handleSwitchToPending() {
    uiLog.click("ChatView", "switchToPending");
    if (!pendingNewConfigRef.current) return;
    chat.clearMessages();
    setActiveSessionKey(PENDING_NEW_KEY);
  }

  // ─── 取消新建对话，回退到上一个真实对话 ──────────────────────────────
  function handleCancelPending() {
    uiLog.click("ChatView", "cancelPending");
    pendingNewConfigRef.current = null;
    const fallback = lastRealSessionKeyRef.current;
    if (fallback && isValidSessionKey(fallback)) {
      setActiveSessionKey(fallback);
      chat.switchSession(fallback);
      silentLoadHistory(fallback);
    } else {
      setActiveSessionKey("");
      chat.clearMessages();
    }
  }

  // ─── 包装 sendMessage：新对话时先创建 sessionKey + 生成标题 + 设置模型 ─────────
  async function handleSendMessage(text: string) {
    uiLog.send("ChatView", "userMessage", { textLen: text.length, hasPending: !!pendingNewConfigRef.current, sessionKey: activeSessionKey.slice(0, 30) });
    if (pendingNewConfigRef.current) {
      const config = pendingNewConfigRef.current;
      const newKey = buildSessionKey(config.agentId, newSessionSubKey());
      pendingNewConfigRef.current = null;

      // 切换为真实 sessionKey
      setActiveSessionKey(newKey);
      lastRealSessionKeyRef.current = newKey;
      chat.switchSession(newKey);
      chat.setSelectedConfig(config);

      // 新会话：先通过 sessions.create 设置模型，再发首条消息
      await chat.changeModel(config.model);

      // 生成标题文本（日期前缀由 ChatControlBar 渲染时统一添加）
      const title = generateSessionTitle(text);
      setCustomTitle(newKey, title);

      // 发送后触发对话列表刷新 + 重置筛选为全部
      setTimeout(() => {
        setSessionsVersion((v) => v + 1);
        setResetFilterVersion((v) => v + 1);
      }, 2000);
    }

    chat.sendMessage(text);
  }

  // ─── 删除对话 ──────────────────────────────────────────────────────────
  function handleDeleteSession(sessionKey: string) {
    uiLog.click("ChatView", "deleteSession", { sessionKey: sessionKey.slice(0, 30) });
    chat.deleteSession(sessionKey);
    // 如果删除的是当前对话，切换到剩余第一个或弹新建面板
    if (sessionKey === activeSessionKey) {
      // 从 chat 内部获取剩余 sessions（通过 ChatControlBar 传递）
      // 当前简单处理：清空当前对话状态
      chat.switchSession("");
      setActiveSessionKey("");
    }
  }

  // ─── 后台静默从 Gateway 拉历史（不阻塞 UI）───────────────────────────
  function silentLoadHistory(sessionKey: string) {
    (async () => {
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const { parseSessionKey } = await import("../../lib/chat/session-key");
        const agentId = parseSessionKey(sessionKey)?.agentId;
        const result = await ipc.getSessionsHistory({ sessionKey, agentId, limit: 50 });
        const messages = result?.messages ?? [];
        if (messages.length > 0 && chat.getSessionKey() === sessionKey) {
          chat.loadHistoryMessages(messages);
        }
      } catch (err) {
        console.warn("[ChatView] Gateway history 后台刷新失败（非致命）:", err);
      }
    })();
  }

  // 处理 pending tool 预输入
  React.useEffect(() => {
    if (pendingToolName && !pendingHandledRef.current) {
      pendingHandledRef.current = true;
      window.dispatchEvent(new CustomEvent("artifex:prefillInput", {
        detail: { text: `请帮我运行工具 "${pendingToolName}"` },
      }));
      clearPendingTool();
    }
  }, [pendingToolName, clearPendingTool]);

  // 处理 AI 辅助运行 prompt 预输入
  const aiPromptHandledRef = React.useRef(false);
  React.useEffect(() => {
    if (aiPrompt && !aiPromptHandledRef.current) {
      aiPromptHandledRef.current = true;
      window.dispatchEvent(new CustomEvent("artifex:prefillInput", {
        detail: { text: aiPrompt },
      }));
      clearPrompt();
    }
  }, [aiPrompt, clearPrompt]);

  // 模块切换回来时重置标记
  React.useEffect(() => {
    pendingHandledRef.current = false;
  });

  // 初始加载：首次选中对话时从 Gateway 拉历史填充缓存
  React.useEffect(() => {
    if (!activeSessionKey || isSentinel(activeSessionKey)) return;
    if (!isValidSessionKey(activeSessionKey)) return;
    if (chat.messages.length > 0) return;
    scrollBehaviorRef.current = "instant";
    chat.switchSession(activeSessionKey);
    silentLoadHistory(activeSessionKey);
  }, [activeSessionKey]);

  // ─── Gateway 连接状态检测（toast 通知，右下角非阻塞）────────────────
  const prevWsState = React.useRef(chat.wsState);
  const disconnectToastId = React.useRef<string | number | undefined>(undefined);
  // 首次成功连接标志：防止"已重新连接"在首次连接时误报
  const wasEverConnectedRef = React.useRef(false);
  // degraded toast 30 秒延迟：短暂抖动不弹 toast，持续退化才提示
  // FIX: 5s 太敏感，正常对话期间偶发的 health degraded（不到 5s 恢复）也会弹 toast
  const degradedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const degradedToastShownRef = React.useRef(false);
  const DEGRADED_DEBOUNCE_MS = 30000;

  // 同步 WS 状态到 GatewayContext（供 Topbar 状态指示使用）
  // "degraded" 也是已连接状态（WS 活跃，仅 Event Loop 繁忙），Topbar 应显示"已连接"
  // v4 修复：wsConnected=false 加 3s 去抖，避免短暂 reconnect（< 3s）让 Topbar 闪黄
  const wsConnectedDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    const isConnected = chat.wsState === "connected" || chat.wsState === "degraded";
    const isDegraded = chat.wsState === "degraded";
    setWsDegraded(isDegraded); // degraded 是真实状态，立即同步
    if (isConnected) {
      // 连上了 → 立即更新（清除可能正在进行的去抖）
      if (wsConnectedDebounceRef.current) {
        clearTimeout(wsConnectedDebounceRef.current);
        wsConnectedDebounceRef.current = null;
      }
      setWsConnected(true);
    } else {
      // 断开 → 3s 去抖（短暂重连不报黄）
      if (wsConnectedDebounceRef.current) clearTimeout(wsConnectedDebounceRef.current);
      wsConnectedDebounceRef.current = setTimeout(() => {
        setWsConnected(false);
        wsConnectedDebounceRef.current = null;
      }, 3000);
    }
    return () => {
      // unmount 不清理（让去抖有机会完成）
    };
  }, [chat.wsState, setWsConnected, setWsDegraded]);

  React.useEffect(() => {
    const was = prevWsState.current;
    const now = chat.wsState;
    prevWsState.current = now;

    // 诊断日志：打印所有 WS 状态转换，方便排查误报
    if (was !== now) {
      console.log(`[ChatView] wsState: "${was}" → "${now}" (wasEverConnected=${wasEverConnectedRef.current}, disconnectToastId=${disconnectToastId.current ? "set" : "none"})`);
    }

    if (was === "connected" && now === "disconnected") {
      // 仅在曾经成功连接过后才弹断连 toast（首次启动 wsState 抖动忽略）
      if (!wasEverConnectedRef.current) return;
      // Gateway 崩溃/断连 → 弹出持久 toast（带重启按钮 + 取消按钮）
      // FIX-BUG1: 之前用 duration:Infinity 且默认 dismissible=false（带 action 时），导致卡片永久无法关闭
      console.log(`[toast] error: Gateway 连接已断开`);
      disconnectToastId.current = toast.error("Gateway 连接已断开", {
        description: "可能崩溃，点击重启恢复连接",
        duration: 60_000, // 60s 后自动消失，避免永久卡屏
        dismissible: true, // 允许手动关闭
        closeButton: true, // 显示 ✕ 按钮
        action: {
          label: "重启 Gateway",
          onClick: () => handleRestartGateway(),
        },
        cancel: {
          label: "关闭",
          onClick: () => {
            if (disconnectToastId.current) {
              toast.dismiss(disconnectToastId.current);
              disconnectToastId.current = undefined;
            }
          },
        },
      });
    } else if (now === "connecting" && disconnectToastId.current) {
      // 正在重连 → 替换为 loading toast（保留可关闭）
      console.log(`[toast] loading: 正在重连 Gateway...`);
      toast.loading("正在重连 Gateway...", {
        id: disconnectToastId.current,
        duration: 30_000,
        dismissible: true,
        closeButton: true,
      });
    } else if ((now === "connected" || now === "degraded") && disconnectToastId.current) {
      // 重连成功（含 degraded）→ 强制清理重启卡片
      // FIX-BUG1: 原代码只处理 connected 不处理 degraded，导致重连后立刻进入 degraded 时卡片不消失
      console.log(`[toast] success: Gateway 已重新连接 (state=${now})`);
      toast.success("Gateway 已重新连接", { id: disconnectToastId.current, duration: 2000 });
      // 防御性 dismiss：500ms 后强制移除（即使 success 渲染失败）
      const idToClear = disconnectToastId.current;
      setTimeout(() => {
        if (idToClear) toast.dismiss(idToClear);
      }, 2500);
      disconnectToastId.current = undefined;
    } else if (now === "connected" && was === "degraded") {
      // degraded → connected：取消待弹 toast
      if (degradedTimerRef.current) {
        clearTimeout(degradedTimerRef.current);
        degradedTimerRef.current = null;
      }
      degradedToastShownRef.current = false;
    } else if (now === "degraded") {
      // Event Loop 退化：延迟 5 秒再弹 toast，短暂恢复则取消
      if (!degradedTimerRef.current && !degradedToastShownRef.current) {
        degradedTimerRef.current = setTimeout(() => {
          degradedTimerRef.current = null;
          degradedToastShownRef.current = true;
          console.log(`[toast] warning: Gateway 事件循环繁忙 (延迟=${DEGRADED_DEBOUNCE_MS}ms 持续退化)`);
          disconnectToastId.current = toast.warning("Gateway 事件循环繁忙", {
            description: "消息可能延迟响应，请稍等片刻...",
            duration: 5000,
          });
          // 3 分钟后允许再次提示
          setTimeout(() => { degradedToastShownRef.current = false; }, 3 * 60 * 1000);
        }, DEGRADED_DEBOUNCE_MS);
      } else if (degradedTimerRef.current) {
        console.log(`[toast] degraded debouncing (${Math.round((Date.now() - (prevWsState.current === "degraded" ? 0 : Date.now())) / 1000)}s remaining)`);
      }
    }

    // 标记已连接（用于判别首次/重连）
    if (now === "connected" || now === "degraded") {
      wasEverConnectedRef.current = true;
    }
  }, [chat.wsState]);

  // 手动重启 Gateway
  async function handleRestartGateway() {
    uiLog.click("ChatView", "restartGateway", { port });
    if (disconnectToastId.current) {
      console.log(`[toast] loading: 正在重启 Gateway...`);
      toast.loading("正在重启 Gateway...", { id: disconnectToastId.current });
    }
    try {
      const { getIpc } = await import("../../lib/ipc");
      const ipc = await getIpc();
      await ipc.restartGateway({ port: port });
      uiLog.state("ChatView", "restartGateway:success");
    } catch (err) {
      uiLog.error("ChatView", "restartGateway:fail", { err: String(err) });
      console.warn("[ChatView] restart gateway failed:", err);
      console.log(`[toast] error: 重启 Gateway 失败 err=${String(err)}`);
      toast.error("重启 Gateway 失败", { description: String(err) });
    }
  }

  // chat.error → toast 通知
  React.useEffect(() => {
    if (chat.error) {
      console.log(`[toast] error (chat.error): ${chat.error}`);
      toast.error(chat.error, { duration: 5000 });
    }
  }, [chat.error]);

  // 自动滚动到底部（切对话=instant，新消息=smooth）
  React.useEffect(() => {
    const behavior = scrollBehaviorRef.current;
    messagesEndRef.current?.scrollIntoView({ behavior });
    if (behavior === "instant") {
      scrollBehaviorRef.current = "smooth";
    }
  }, [chat.messages]);

  // 监听外部会话切换事件（来自右侧面板等）
  React.useEffect(() => {
    function onSwitchSession(e: Event) {
      const detail = (e as CustomEvent<{ sessionKey: string }>).detail;
      if (detail?.sessionKey) {
        handleSwitchSession(detail.sessionKey);
      }
    }
    window.addEventListener("artifex:switch-session", onSwitchSession);
    return () => window.removeEventListener("artifex:switch-session", onSwitchSession);
  }, [handleSwitchSession]);

  // v4.1.7 已废弃：Keep-Alive useEffect
  //
  // 之前：每 2 分钟发送 agent.turn RPC 保活会话。
  // 实测发现 Gateway 不接受 agent.turn 方法，每次都返回 INVALID_REQUEST，
  // 反而污染 gateway.log（每 2 分钟一条 ws res ✗ agent.turn 错误）。
  //
  // 现在：依赖 gateway-ws 的 _startPing()（每 30 秒发 type:"ping" 帧）+
  // Gateway 自身的 event=heartbeat（约每 10 秒）已经足够保活 WS 连接。
  // Agent 会话进程的常驻由 Gateway 内部生命周期管理，前端无需干预。

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* P2-8：MCP Bridge 不可用警告横幅（聊天正常，DCC 工具禁用） */}
      {!chat.mcpBridgeAvailable && chat.wsState === "connected" && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.06] px-3 py-1.5 text-xs text-amber-400">
          <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span className="flex-1">MCP Bridge 不可用 — 工具/命令已禁用，纯文本聊天仍可正常使用</span>
        </div>
      )}

      {/* C1 控制栏 */}
      <ChatControlBar
        activeSessionKey={activeSessionKey}
        onSwitchSession={handleSwitchSession}
        gatewayPort={port}
        gatewayRunning={gatewayRunning}
        onConfigChange={(cfg) => {
          chat.setSelectedConfig(cfg);
          if (cfg.model) chat.changeModel(cfg.model);
        }}
        onOpenNewSessionDialog={() => setNewSessionDialogOpen(true)}
        onDeleteSession={handleDeleteSession}
        sessionsVersion={sessionsVersion}
        pendingConfig={pendingNewConfigRef.current}
        onCancelPending={handleCancelPending}
        onSwitchToPending={handleSwitchToPending}
        resetFilterVersion={resetFilterVersion}
        onCleanupComplete={(cleanedKeys) => {
          chat.cleanExpiredSessions(cleanedKeys);
          setSessionsVersion((v) => v + 1);
        }}
      />

      {/* C2 消息流（relative 容器承载浮层横幅） */}
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        <WsStatusBanner
          wsState={chat.wsState}
          gatewayRunning={gatewayRunning}
          onRestartGateway={handleRestartGateway}
        />
        {activeSessionKey === PENDING_NEW_KEY && pendingNewConfigRef.current ? (
          <PendingSessionBanner
            agentId={pendingNewConfigRef.current.agentId}
            model={pendingNewConfigRef.current.model}
            thinking={pendingNewConfigRef.current.thinking}
            onCancel={handleCancelPending}
          />
        ) : (
          <ChatMessageList
            messages={chat.messages}
            messagesEndRef={messagesEndRef}
          />
        )}
      </div>

      {/* C3 输入区 */}
      <ChatInputArea
        onSend={handleSendMessage}
        onStop={chat.stop}
        onResume={chat.resume}
        isStreaming={chat.isStreaming}
        canResume={chat.cancelledMessageId !== null && !chat.isStreaming}
        pendingCount={chat.pendingQueue.length}
        pendingMessages={chat.pendingQueue}
        onRemoveFromQueue={chat.removeFromQueue}
        onClearQueue={chat.clearQueue}
        sessionFiles={[]}
        onNewSession={() => setNewSessionDialogOpen(true)}
        isWsConnected={chat.wsState === "connected" || chat.wsState === "degraded"}
        isWsDegraded={chat.wsState === "degraded"}
        mergeEnabled={chat.mergeEnabled}
        onMergeToggle={chat.toggleMerge}
      />

      {/* 新建对话弹窗 */}
      <NewSessionDialog
        open={newSessionDialogOpen}
        onClose={() => setNewSessionDialogOpen(false)}
        onConfirm={handleNewSession}
        gatewayPort={port}
        gatewayRunning={gatewayRunning}
      />
    </div>
  );
}

// ─── 新建对话待发送横幅 ────────────────────────────────────────────────────
//
// 当用户从弹窗确认了新建配置但尚未发送第一条消息时显示。
// 展示当前选中的 Agent / Model / 思考模式 + 操作提示 + 取消按钮。

interface PendingSessionBannerProps {
  agentId: string;
  model: string;
  thinking: string;
  onCancel: () => void;
}

const THINKING_LABELS: Record<string, string> = {
  off: "关", minimal: "最低", low: "低", medium: "中",
  high: "高", xhigh: "很高", adaptive: "自适应", max: "最高",
};

function PendingSessionBanner({ agentId, model, thinking, onCancel }: PendingSessionBannerProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 px-6 text-center">
      <div className="rounded-full bg-primary/10 p-3">
        <svg className="h-6 w-6 text-primary/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      <div>
        <h3 className="text-sm font-medium text-foreground/90">新对话已就绪</h3>
        <p className="mt-1 text-xs text-muted-foreground">输入第一条消息后将自动创建对话</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <span className="inline-flex items-center rounded bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
          Agent: {agentId}
        </span>
        <span className="inline-flex items-center rounded bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
          Model: {model}
        </span>
        <span className="inline-flex items-center rounded bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
          思考: {THINKING_LABELS[thinking] ?? thinking}
        </span>
      </div>
      <button
        onClick={onCancel}
        className="mt-1 text-[11px] text-muted-foreground/60 underline-offset-2 hover:underline hover:text-muted-foreground transition-colors"
      >
        取消新建
      </button>
    </div>
  );
}

// ─── WS 状态浮层横幅 ────────────────────────────────────────────────────────
//
// 连接中 / 断连 / 繁忙 统一在此显示浮层横幅，确保用户能感知 Gateway/WS 的实际状态。
// degraded 不再仅依赖 toast（5s 后自动消失），同时显示持久横幅。

interface WsStatusBannerProps {
  wsState: "disconnected" | "connecting" | "connected" | "degraded";
  gatewayRunning: boolean;
  onRestartGateway: () => void;
}

function WsStatusBanner({ wsState, gatewayRunning, onRestartGateway }: WsStatusBannerProps) {
  // connected → 不显示
  if (wsState === "connected") return null;

  const isConnecting = wsState === "connecting";
  const isDegraded = wsState === "degraded";
  const gwDown = !gatewayRunning && wsState === "disconnected";

  // Gateway 未运行 → 高关注度横幅（全宽浮层 + 启动按钮）
  if (gwDown) {
    return (
      <div className="absolute top-2 left-2 right-2 z-10 flex items-center gap-2.5 rounded-lg border border-destructive/30 bg-card/95 backdrop-blur-md px-3 py-2 text-xs shadow-lg">
        <svg className="h-3.5 w-3.5 shrink-0 text-destructive" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
        </svg>
        <span className="flex-1 text-foreground/80">Gateway 未运行，聊天功能不可用</span>
        <button
          onClick={onRestartGateway}
          className="shrink-0 rounded-md border border-white/[0.10] bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-white/[0.12] hover:text-foreground"
        >
          启动 Gateway
        </button>
      </div>
    );
  }

  // WS 已连接但 Event Loop 退化 → 琥珀色"繁忙"横幅
  if (isDegraded) {
    return (
      <div className="absolute top-2 left-1/2 z-10 -translate-x-1/2 flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/[0.08] backdrop-blur-md px-3.5 py-1.5 text-xs shadow-lg">
        <span className="flex h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.6)]" />
        <span className="text-amber-400 font-medium">Gateway 繁忙</span>
        <span className="text-amber-400/60">— 消息将排队等待，请稍候...</span>
      </div>
    );
  }

  // 连接中/等待连接 → 低关注度信息条
  return (
    <div className="absolute top-2 left-1/2 z-10 -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/[0.08] bg-card/90 backdrop-blur-md px-3.5 py-1.5 text-xs text-muted-foreground shadow-lg">
      <span className="flex h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
      <span>
        {isConnecting ? "正在建立连接..." : "Gateway 运行中，等待 WebSocket 连接..."}
      </span>
    </div>
  );
}
