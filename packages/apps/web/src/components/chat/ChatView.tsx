"use client";

/**
 * ChatView — Chat 模块主组件（C1 控制栏 + C2 消息流 + C3 输入区）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §4
 * STORY-0034 范围：全部 mock 数据
 */

import * as React from "react";
import { ChatControlBar } from "./ChatControlBar";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInputArea } from "./ChatInputArea";
import type { MockMessage } from "../../lib/chatMock";
import { MOCK_MESSAGES, MOCK_SESSION_FILES } from "../../lib/chatMock";

export function ChatView() {
  const [messages, setMessages] = React.useState<MockMessage[]>(MOCK_MESSAGES);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [pendingQueue, setPendingQueue] = React.useState<string[]>([]);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // 自动滚动到底
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (text: string) => {
    if (!text.trim()) return;

    const userMsg: MockMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    if (isStreaming) {
      // 队列模式
      setPendingQueue((q) => [...q, text]);
      setMessages((prev) => [...prev, userMsg]);
      return;
    }

    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    // Mock AI 回复（1.5s 延迟模拟）
    setTimeout(() => {
      const aiMsg: MockMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: `收到你的消息："${text}"\n\n这是一个 mock 回复。STORY-0039 将接入 OpenClaw API 实现真实对话。`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setIsStreaming(false);

      // 处理队列
      setPendingQueue((q) => {
        if (q.length > 0) {
          const next = q[0];
          const rest = q.slice(1);
          // 延迟发送队列中的下一条
          setTimeout(() => handleSend(next), 100);
          return rest;
        }
        return [];
      });
    }, 1500);
  };

  const handleStop = () => {
    setIsStreaming(false);
  };

  const handleResume = () => {
    setIsStreaming(true);
    // Mock 恢复
    setTimeout(() => {
      const aiMsg: MockMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: "已恢复生成。（mock）",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setIsStreaming(false);
    }, 800);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* C1 控制栏 */}
      <ChatControlBar />

      {/* C2 消息流 */}
      <ChatMessageList
        messages={messages}
        messagesEndRef={messagesEndRef}
      />

      {/* C3 输入区 */}
      <ChatInputArea
        onSend={handleSend}
        onStop={handleStop}
        onResume={handleResume}
        isStreaming={isStreaming}
        pendingCount={pendingQueue.length}
        sessionFiles={MOCK_SESSION_FILES}
      />
    </div>
  );
}
