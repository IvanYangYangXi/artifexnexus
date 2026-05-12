"use client";

/**
 * ChatView — Chat 模块主组件（C1 控制栏 + C2 消息流 + C3 输入区）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §4
 * STORY-0039：接入 OpenClaw Gateway WebSocket 实现真实流式对话
 */

import * as React from "react";
import { ChatControlBar } from "./ChatControlBar";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInputArea } from "./ChatInputArea";
import { RunToolContext, GatewayContext } from "../shell/AppShell";
import { useChatService } from "../../lib/chat/chat-service";

export function ChatView() {
  const { pendingToolName, clearPendingTool } = React.useContext(RunToolContext);
  const { port, token, running: gatewayRunning } = React.useContext(GatewayContext);
  const pendingHandledRef = React.useRef(false);

  // Chat 状态机
  const chat = useChatService({
    gatewayPort: port,
    gatewayToken: token,
    gatewayRunning,
  });

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

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
        sessions={chat.sessions}
        activeSessionId={chat.activeSessionId}
        onSwitchSession={chat.switchSession}
        onNewSession={chat.createNewSession}
        onDeleteSession={chat.deleteSession}
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
