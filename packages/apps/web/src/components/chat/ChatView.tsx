"use client";

/**
 * ChatView — Chat 模块主组件（C1 控制栏 + C2 消息流 + C3 输入区）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §4
 * STORY-0039：接入 OpenClaw Gateway WebSocket 实现真实流式对话
 *
 * 对话管理流程（方案 B）：
 * - 对话列表从 sidecar RPC 获取（Gateway sessions.json）
 * - 切换对话时通过 Gateway HTTP /sessions/<key>/history 加载消息
 * - 新建对话时生成新 sessionKey，首条消息发送后 Gateway 自动创建 session
 */

import * as React from "react";
import { ChatControlBar } from "./ChatControlBar";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInputArea } from "./ChatInputArea";
import { RunToolContext, GatewayContext } from "../shell/AppShell";
import { useChatService } from "../../lib/chat/chat-service";

export function ChatView() {
  const { pendingToolName, clearPendingTool } = React.useContext(RunToolContext);
  const { port, token, running: gatewayRunning, authReady } = React.useContext(GatewayContext);
  const pendingHandledRef = React.useRef(false);

  // 当前活跃的 sessionKey（格式 agent:<agentId>:<sessionName>）
  const [activeSessionKey, setActiveSessionKey] = React.useState("");

  // Chat 状态机
  const chat = useChatService({
    gatewayPort: port,
    gatewayToken: token,
    gatewayRunning,
    authReady,
  });

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // 切换对话：中止当前流 → 清空 → 加载 Gateway 侧的历史消息
  const handleSwitchSession = React.useCallback(async (sessionKey: string) => {
    // 如果当前正在流式生成，先中止
    if (chat.isStreaming) {
      await chat.stop();
    }

    setActiveSessionKey(sessionKey);
    // 通过 chat-service 切换到对应 session（清空消息 + 更新 sessionKeyRef）
    chat.switchSession(sessionKey);

    // 从 Gateway WS 加载历史消息（chat.history RPC）
    if (gatewayRunning && chat.wsState === "connected") {
      try {
        const ws = chat.getWs();
        if (ws && ws.state === "connected") {
          const history = await ws.sendRpc("chat.history", { sessionKey });
          const messages = history?.messages ?? history?.items ?? [];
          if (Array.isArray(messages) && messages.length > 0) {
            chat.loadHistoryMessages(messages);
          }
        }
      } catch {
        // 历史加载失败，保持空白
      }
    }
  }, [gatewayRunning, port, chat]);

  // 新建对话
  const handleNewSession = React.useCallback(() => {
    const timestamp = Date.now();
    const newSessionKey = `agent:artifex-nexus:session-${timestamp}`;
    setActiveSessionKey(newSessionKey);
    chat.createNewSession();
  }, [chat]);

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

  // 自动滚动到底部
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
