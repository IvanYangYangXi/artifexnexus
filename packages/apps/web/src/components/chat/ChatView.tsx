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
import { RunToolContext, GatewayContext } from "../shell/AppShell";
import { useChatService } from "../../lib/chat/chat-service";
import { toast } from "@artifex-nexus/ui";

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
    scrollBehaviorRef.current = "instant";
    chat.switchSession(sessionKey);
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
