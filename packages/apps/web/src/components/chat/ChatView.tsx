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

    // 先添加一个空的 streaming AI 消息
    const streamingMsg: MockMessage = {
      id: `msg-${Date.now() + 1}`,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };
    setMessages((prev) => [...prev, streamingMsg]);

    // Mock 流式逐字输出
    const fullText = `收到你的消息："${text}"\n\n这是一个 mock 流式回复。STORY-0039 将接入 OpenClaw API 实现真实流式对话。`;
    let charIndex = 0;
    const interval = setInterval(() => {
      charIndex += 1;
      if (charIndex <= fullText.length) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMsg.id
              ? { ...m, content: fullText.slice(0, charIndex) }
              : m,
          ),
        );
      } else {
        clearInterval(interval);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMsg.id ? { ...m, isStreaming: false } : m,
          ),
        );
        setIsStreaming(false);

        // 处理队列
        setPendingQueue((q) => {
          if (q.length > 0) {
            const next = q[0];
            const rest = q.slice(1);
            setTimeout(() => handleSend(next), 100);
            return rest;
          }
          return [];
        });
      }
    }, 30);
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
