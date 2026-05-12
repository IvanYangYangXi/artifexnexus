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
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { ChatControlBar } from "./ChatControlBar";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInputArea } from "./ChatInputArea";
import { RunToolContext, GatewayContext } from "../shell/AppShell";
import { useChatService } from "../../lib/chat/chat-service";
import { cn } from "@artifex-nexus/ui";

export function ChatView() {
  const { pendingToolName, clearPendingTool } = React.useContext(RunToolContext);
  const { port, token, running: gatewayRunning, authReady } = React.useContext(GatewayContext);
  const pendingHandledRef = React.useRef(false);

  // 当前活跃的 sessionKey
  const [activeSessionKey, setActiveSessionKey] = React.useState("");

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
    scrollBehaviorRef.current = "instant"; // 切对话直接跳底，不播动画
    // switchSession 内部同步：存当前消息 → 从缓存读目标消息 → dispatch
    chat.switchSession(sessionKey);

    // 后台静默从 Gateway 刷新（缓存为空时特别有用，但不阻塞 UI）
    silentLoadHistory(sessionKey);
  }

  // ─── 新建对话 ──────────────────────────────────────────────────────────
  function handleNewSession() {
    const timestamp = Date.now();
    const newSessionKey = `agent:artifex-nexus:session-${timestamp}`;
    setActiveSessionKey(newSessionKey);
    chat.createNewSession();
  }

  // ─── 后台静默从 Gateway 拉历史（不阻塞 UI）───────────────────────────
  function silentLoadHistory(sessionKey: string) {
    (async () => {
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const result = await ipc.getSessionsHistory({ sessionKey, limit: 50 });
        const messages = result?.messages ?? [];
        // 只有当前对话没变且确实拿到了数据才更新
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
    // switchSession 同步读缓存（首次可能为空）
    scrollBehaviorRef.current = "instant"; // 初始加载也直接跳底
    chat.switchSession(activeSessionKey);
    // 后台拉 Gateway 填充
    silentLoadHistory(activeSessionKey);
  }, [activeSessionKey]);

  // ─── Gateway 连接状态检测 ──────────────────────────────────────────
  // 检测 WS 断开（Gateway 崩溃）并显示友好提示
  const prevWsState = React.useRef(chat.wsState);
  const [gatewayDisconnected, setGatewayDisconnected] = React.useState(false);
  const [reconnecting, setReconnecting] = React.useState(false);

  React.useEffect(() => {
    const was = prevWsState.current;
    const now = chat.wsState;
    prevWsState.current = now;

    if (was === "connected" && now === "disconnected") {
      // Gateway 从连接变断开 → 崩溃/断连
      setGatewayDisconnected(true);
      setReconnecting(false);
    } else if (now === "connecting") {
      setReconnecting(true);
    } else if (now === "connected") {
      // 重连成功 → 清除提示
      setGatewayDisconnected(false);
      setReconnecting(false);
    }
  }, [chat.wsState]);

  // 手动重启 Gateway
  async function handleRestartGateway() {
    setReconnecting(true);
    try {
      const { getIpc } = await import("../../lib/ipc");
      const ipc = await getIpc();
      await ipc.restartGateway({ port: port });
    } catch (err) {
      console.warn("[ChatView] restart gateway failed:", err);
    }
    // 重连由 chat-service 的 WS 自动重连机制处理
  }

  // 自动滚动到底部（切对话=instant，新消息=smooth）
  React.useEffect(() => {
    const behavior = scrollBehaviorRef.current;
    messagesEndRef.current?.scrollIntoView({ behavior });
    // 用完 instant 后恢复为 smooth（后续新消息用平滑动画）
    if (behavior === "instant") {
      scrollBehaviorRef.current = "smooth";
    }
  }, [chat.messages]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* C1 控制栏 */}
      <ChatControlBar
        activeSessionKey={activeSessionKey}
        onSwitchSession={handleSwitchSession}
        onNewSession={handleNewSession}
        gatewayPort={port}
        gatewayRunning={gatewayRunning}
        onConfigChange={(cfg) => chat.setSelectedConfig(cfg)}
      />

      {/* C2 消息流 */}
      <ChatMessageList
        messages={chat.messages}
        messagesEndRef={messagesEndRef}
      />

      {/* Gateway 断开/重连提示横幅 */}
      {gatewayDisconnected && (
        <div className={cn(
          "flex items-center gap-2 px-4 py-2 text-xs border-t",
          reconnecting
            ? "bg-amber-500/10 border-amber-500/20 text-amber-200"
            : "bg-destructive/10 border-destructive/20 text-destructive",
        )}>
          {reconnecting ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="flex-1">
            {reconnecting
              ? "正在重连 Gateway..."
              : "Gateway 连接已断开（可能崩溃），无法发送消息"}
          </span>
          {!reconnecting && (
            <button
              onClick={handleRestartGateway}
              className="shrink-0 rounded px-2 py-0.5 text-[11px] bg-destructive/20 hover:bg-destructive/30 transition-colors"
            >
              重启 Gateway
            </button>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {chat.error && !gatewayDisconnected && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs border-t bg-destructive/10 border-destructive/20 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{chat.error}</span>
        </div>
      )}

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
      />
    </div>
  );
}
