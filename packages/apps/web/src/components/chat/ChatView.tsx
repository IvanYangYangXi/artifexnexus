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
import { RunToolContext, GatewayContext } from "../shell/AppShell";
import { useChatService } from "../../lib/chat/chat-service";
import { toast } from "@artifex-nexus/ui";

export function ChatView() {
  const { pendingToolName, clearPendingTool } = React.useContext(RunToolContext);
  const { port, token, running: gatewayRunning, authReady, setWsConnected } = React.useContext(GatewayContext);
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

  // ─── 切换对话（纯同步，消息从内存缓存瞬间加载）─────────────────────
  async function handleSwitchSession(sessionKey: string) {
    if (!sessionKey || sessionKey === "__empty__" || sessionKey === "__new__") {
      return;
    }
    if (!sessionKey.startsWith("agent:")) {
      console.warn("[ChatView] 拒绝非法 sessionKey:", sessionKey);
      return;
    }

    if (chat.isStreaming) {
      await chat.stop();
    }

    setActiveSessionKey(sessionKey);
    scrollBehaviorRef.current = "instant";
    chat.switchSession(sessionKey);
    silentLoadHistory(sessionKey);
  }

  // ─── 新建对话（从弹窗获取配置后创建）─────────────────────────────────
  function handleNewSession(config: { agentId: string; model: string; thinking: string }) {
    const newKey = `agent:${config.agentId}:session-${Date.now()}`;
    setActiveSessionKey(newKey);
    // 用 switchSession 而非 createNewSession：统一 sessionKeyRef 管理，
    // 避免 createNewSession 用默认 agentId 生成冲突的 key。
    chat.switchSession(newKey);
    chat.setSelectedConfig(config);
    // 持久化选择到 localStorage
    try { localStorage.setItem("artifex.chat.agent", config.agentId); } catch { /* ignore */ }
    try { localStorage.setItem("artifex.chat.model", config.model); } catch { /* ignore */ }
    try { localStorage.setItem("artifex.chat.effort", config.thinking); } catch { /* ignore */ }
    setNewSessionDialogOpen(false);
  }

  // ─── 删除对话 ──────────────────────────────────────────────────────────
  function handleDeleteSession(sessionKey: string) {
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
        const result = await ipc.getSessionsHistory({ sessionKey, limit: 50 });
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

  // 模块切换回来时重置标记
  React.useEffect(() => {
    pendingHandledRef.current = false;
  });

  // 初始加载：首次选中对话时从 Gateway 拉历史填充缓存
  React.useEffect(() => {
    if (!activeSessionKey || activeSessionKey === "__empty__" || activeSessionKey === "__new__") return;
    if (!activeSessionKey.startsWith("agent:")) return;
    if (chat.messages.length > 0) return;
    scrollBehaviorRef.current = "instant";
    chat.switchSession(activeSessionKey);
    silentLoadHistory(activeSessionKey);
  }, [activeSessionKey]);

  // ─── Gateway 连接状态检测（toast 通知，右下角非阻塞）────────────────
  const prevWsState = React.useRef(chat.wsState);
  const disconnectToastId = React.useRef<string | number | undefined>(undefined);
  // degraded toast 冷却期：防止事件循环频繁抖动导致 toast 刷屏
  const lastDegradedToastRef = React.useRef(0);
  const DEGRADED_TOAST_COOLDOWN_MS = 3 * 60 * 1000;

  // 同步 WS 状态到 GatewayContext（供 Topbar 状态指示使用）
  React.useEffect(() => {
    setWsConnected(chat.wsState === "connected");
  }, [chat.wsState, setWsConnected]);

  React.useEffect(() => {
    const was = prevWsState.current;
    const now = chat.wsState;
    prevWsState.current = now;

    if (was === "connected" && now === "disconnected") {
      // Gateway 崩溃/断连 → 弹出持久 toast（带重启按钮，不自动消失）
      disconnectToastId.current = toast.error("Gateway 连接已断开", {
        description: "可能崩溃，点击重启恢复连接",
        duration: Infinity,
        action: {
          label: "重启 Gateway",
          onClick: () => handleRestartGateway(),
        },
      });
    } else if (now === "connecting" && disconnectToastId.current) {
      // 正在重连 → 替换为 loading toast
      toast.loading("正在重连 Gateway...", { id: disconnectToastId.current });
    } else if (now === "connected" && disconnectToastId.current) {
      // 重连成功 → 替换为成功 toast（2s 后消失）
      toast.success("Gateway 已重新连接", { id: disconnectToastId.current, duration: 2000 });
      disconnectToastId.current = undefined;
    } else if (now === "degraded") {
      // Event Loop 退化 → 警告 toast（冷却期 3 分钟，防抖动刷屏）
      const nowMs = Date.now();
      if (nowMs - lastDegradedToastRef.current > DEGRADED_TOAST_COOLDOWN_MS) {
        lastDegradedToastRef.current = nowMs;
        disconnectToastId.current = toast.warning("Gateway 事件循环繁忙", {
          description: "正在恢复中，消息可能延迟，请稍等片刻...",
          duration: 5000,
        });
      }
    }
  }, [chat.wsState]);

  // 手动重启 Gateway
  async function handleRestartGateway() {
    if (disconnectToastId.current) {
      toast.loading("正在重启 Gateway...", { id: disconnectToastId.current });
    }
    try {
      const { getIpc } = await import("../../lib/ipc");
      const ipc = await getIpc();
      await ipc.restartGateway({ port: port });
    } catch (err) {
      console.warn("[ChatView] restart gateway failed:", err);
      toast.error("重启 Gateway 失败", { description: String(err) });
    }
  }

  // chat.error → toast 通知
  React.useEffect(() => {
    if (chat.error) {
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

  // ─── 会话 Keep-Alive：每隔 7 分钟发送 agentTurn 保持 Gateway 会话常驻 ─
  // 防止 Gateway 因长时间无用户交互回收 agent 会话进程（冷启动 ~120s）。
  // agentTurn 使用 delivery=none 静默执行，不影响消息历史与 UI。
  const KEEPALIVE_INTERVAL_MS = 7 * 60 * 1000;
  React.useEffect(() => {
    if (!activeSessionKey || activeSessionKey === "__empty__" || activeSessionKey === "__new__") return;
    if (!activeSessionKey.startsWith("agent:")) return;
    if (chat.wsState !== "connected") return;

    console.log(`[ChatView] Keep-alive started for session=${activeSessionKey}, interval=${KEEPALIVE_INTERVAL_MS / 1000}s`);
    const timer = setInterval(() => {
      chat.sendAgentTurn(activeSessionKey);
    }, KEEPALIVE_INTERVAL_MS);

    return () => {
      console.log(`[ChatView] Keep-alive stopped for session=${activeSessionKey}`);
      clearInterval(timer);
    };
  }, [activeSessionKey, chat.wsState, chat.sendAgentTurn]);

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
        onConfigChange={(cfg) => chat.setSelectedConfig(cfg)}
        onOpenNewSessionDialog={() => setNewSessionDialogOpen(true)}
        onDeleteSession={handleDeleteSession}
      />

      {/* C2 消息流（relative 容器承载浮层横幅） */}
      <div className="relative flex-1 min-h-0">
        <WsStatusBanner
          wsState={chat.wsState}
          gatewayRunning={gatewayRunning}
          onRestartGateway={handleRestartGateway}
        />
        <ChatMessageList
          messages={chat.messages}
          messagesEndRef={messagesEndRef}
        />
      </div>

      {/* C3 输入区 */}
      <ChatInputArea
        onSend={chat.sendMessage}
        onStop={chat.stop}
        onResume={chat.resume}
        isStreaming={chat.isStreaming}
        canResume={chat.cancelledMessageId !== null && !chat.isStreaming}
        pendingCount={chat.pendingQueue.length}
        pendingMessages={chat.pendingQueue}
        sessionFiles={[]}
        onNewSession={() => setNewSessionDialogOpen(true)}
        isWsConnected={chat.wsState === "connected"}
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

// ─── WS 状态浮层横幅 ────────────────────────────────────────────────────────
//
// 仅在真正的断连/连接中显示，degraded 由 toast 处理（5s 自动消失 + 3min 冷却）。
// 浮于消息流上方，不挤占布局空间。样式匹配项目暗色玻璃态设计语言。

interface WsStatusBannerProps {
  wsState: "disconnected" | "connecting" | "connected" | "degraded";
  gatewayRunning: boolean;
  onRestartGateway: () => void;
}

function WsStatusBanner({ wsState, gatewayRunning, onRestartGateway }: WsStatusBannerProps) {
  // connected → 不显示；degraded → 不显示（仅 toast，不持久横幅）
  if (wsState === "connected" || wsState === "degraded") return null;

  const isConnecting = wsState === "connecting";
  const gwDown = !gatewayRunning && wsState === "disconnected";

  // 连接中/等待连接 → 低关注度信息条（自动消失，不阻塞交互）
  if (!gwDown) {
    return (
      <div className="absolute top-2 left-1/2 z-10 -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/[0.08] bg-card/90 backdrop-blur-md px-3.5 py-1.5 text-xs text-muted-foreground shadow-lg">
        <span className="flex h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span>
          {isConnecting ? "正在建立连接..." : "Gateway 运行中，等待 WebSocket 连接..."}
        </span>
      </div>
    );
  }

  // Gateway 未运行 → 高关注度横幅（全宽浮层 + 启动按钮）
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
