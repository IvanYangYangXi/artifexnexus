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
import { MOCK_SESSION_FILES } from "../../lib/chatMock";

export function ChatView() {
  const { pendingToolName, clearPendingTool } = React.useContext(RunToolContext);
  const { port, token, running: gatewayRunning } = React.useContext(GatewayContext);
  const pendingHandledRef = React.useRef(false);

  // Chat 状态机
  const chat = useChatService({
    gatewayPort: port,
    gatewayToken: token,
  });

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // 处理 pending tool 预输入（预填到输入框，不自动发送）
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

  const handleSend = (text: string) => {
    chat.sendMessage(text);
  };

  const handleStop = () => {
    chat.stop();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* C1 控制栏 */}
      <ChatControlBar />

      {/* C2 消息流 */}
      <ChatMessageList
        messages={chat.messages}
        messagesEndRef={messagesEndRef}
      />

      {/* C3 输入区 */}
      <ChatInputArea
        onSend={handleSend}
        onStop={handleStop}
        onResume={chat.resume}
        isStreaming={chat.isStreaming}
        canResume={chat.cancelledMessageId !== null && !chat.isStreaming}
        pendingCount={chat.pendingQueue.length}
        pendingMessages={chat.pendingQueue}
        sessionFiles={MOCK_SESSION_FILES}
      />
    </div>
  );
}
